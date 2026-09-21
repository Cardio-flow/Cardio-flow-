import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  templateByKey,
  cleanAnswers,
  visibleFields,
  type Answers,
} from "../src/guided.js";
import {
  rcriPreview,
  apixabanPreview,
  medicationChecks,
  reusableFacts,
} from "../src/clinical-review.js";
import {
  cleanRegistry,
  registryVisible,
  type RegistryPackage,
} from "../src/registry-forms.js";

test("Hidden descendants and contradictory multi-select choices cannot silently survive", async () => {
  const t = templateByKey.get("procedure.pci")!;
  const a = {
    procedure: "Diagnostic angiography",
    strategy: "Stent",
    stent_count: 2,
  };
  assert.deepEqual(cleanAnswers(t, a), { procedure: "Diagnostic angiography" });
  assert.ok(!visibleFields(t, a).some((f) => f.key === "stent_count"));
});
test("RCRI original criteria respect population, missing inputs, strict creatinine boundary and units", () => {
  const a: Answers = {
    urgency: "Elective",
    magnitude: "Major noncardiac surgery",
    expected_stay: "At least 2 days",
    operation: "Intraperitoneal",
    high_risk: "Yes",
    ihd: "No",
    hf: "Yes",
    stroke: "No",
    insulin: "No",
    creatinine: 2,
    creatinine_unit: "mg/dL",
    lab_current: "Confirmed for this assessment",
    inputs_confirmed: "Confirmed",
  };
  const run = (extra: Answers = {}, birth = "1970-01-01") =>
    rcriPreview({ ...a, ...extra }, birth, "2025-01-01");
  assert.equal(run().points, 2);
  assert.equal(run({ creatinine: 2.001 }).points, 3);
  assert.equal(run({ creatinine: 176.8, creatinine_unit: "µmol/L" }).points, 2);
  const invalidInputs: Answers[] = [
    { ihd: "Unknown / not assessed" },
    { urgency: "Emergency" },
    { operation: "Other" },
    { expected_stay: "Less than 2 days" },
    { inputs_confirmed: "Not yet confirmed" },
    { creatinine_unit: "" },
    { creatinine: NaN },
  ];
  for (const extra of invalidInputs) assert.equal(run(extra).points, undefined);
  assert.equal(run({}, "1990-01-01").points, undefined);
});
test("Apixaban NVAF label preview requires all safety checks and two reduction criteria", () => {
  const a: Answers = {
    indication: "Nonvalvular AF",
    weight: 61,
    creatinine: 1.4,
    creatinine_unit: "mg/dL",
    crcl: 50,
    lab_current: "Confirmed for this assessment",
    inputs_confirmed: "Confirmed",
    ...Object.fromEntries(
      medicationChecks.map(([k]) => [k, "Reviewed — absent / not applicable"]),
    ),
  };
  const run = (extra: Answers = {}, birth = "1945-01-01") =>
    apixabanPreview({ ...a, ...extra }, birth, "2025-01-01");
  assert.equal(run().reference, "5 mg orally twice daily");
  assert.equal(run({ weight: 60 }).reference, "2.5 mg orally twice daily");
  assert.equal(run({ creatinine: 1.5 }).reference, "2.5 mg orally twice daily");
  assert.equal(
    run({ creatinine: 132.6, creatinine_unit: "µmol/L" }).reference,
    "2.5 mg orally twice daily",
  );
  assert.equal(
    run({ weight: 60 }, "1945-01-02").reference,
    "5 mg orally twice daily",
  );
  for (const [k] of medicationChecks)
    assert.equal(run({ [k]: "Not yet reviewed" }).reference, undefined);
  const invalidInputs: Answers[] = [
    { indication: "VTE treatment" },
    { crcl: 29 },
    { crcl: NaN },
    { weight: NaN },
    { lab_current: "Not yet reviewed" },
    { creatinine_unit: "" },
  ];
  for (const extra of invalidInputs)
    assert.equal(run(extra).reference, undefined);
  assert.equal(run({}, "2010-01-01").reference, undefined);
});

test("Guided multi-save, provenance, registry branching and immutable drafts enforce scope and versions", async () => {
  const db = await createDb(undefined, false),
    server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = "",
    csrf = "";
  async function call(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await r.json();
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie")!.split(";")[0];
    if (data.csrf) csrf = data.csrf;
    return { status: r.status, data };
  }
  const common = {
    status: "suspected",
    encounter_id: null,
    occurred_on: "2025-01-01",
    due_date: null,
    owner: "Test clinician",
    note: "",
    action_note: "",
    response_note: "",
  };
  try {
    assert.equal((await call("/registry-forms")).status, 401);
    await call("/demo-session", { role: "clinician" });
    const p = (
      await call("/patients", {
        name: "Guided Sample",
        mrn: "SYN-GUIDED-API",
        sex: "Female",
        birth_date: "1940-01-01",
      })
    ).data;
    const path = `/patients/${p.id}/care/guided`;
    const hf = {
      ...common,
      template_key: "problem.hf",
      answers: {
        certainty: "Confirmed",
        phenotype: "HFrEF",
        lvef: 35,
        nyha: "II",
      },
      status: "active",
    };
    const af = {
      ...common,
      template_key: "problem.af",
      answers: {
        certainty: "Suspected",
        rhythm: "Atrial fibrillation",
        pattern: "Paroxysmal",
      },
    };
    assert.equal(
      (
        await call(path, {
          entries: [hf, { ...af, answers: { rhythm: "Not a choice" } }],
        })
      ).status,
      422,
    );
    assert.equal(
      (await call(`/patients/${p.id}/care`)).data.entries.length,
      0,
      "batch rollback / validation",
    );
    const saved = await call(path, { entries: [hf, af] });
    assert.equal(saved.status, 201, JSON.stringify(saved.data));
    assert.equal(saved.data.length, 2);
    assert.equal(saved.data[0].structured.lvef, 35);
    assert.equal(saved.data[0].template_version, "guided.1");
    assert.equal(
      reusableFacts(saved.data, "procedure.noncardiac_surgery").find(
        (f) => f.key === "hf",
      )?.value,
      "Yes",
    );
    assert.equal(
      (
        await call(path, {
          entries: [
            { ...hf, answers: { ...hf.answers, certainty: "Suspected" } },
          ],
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await call(path, {
          entries: [
            {
              ...af,
              answers: { symptoms: ["No symptoms reported", "Breathlessness"] },
            },
          ],
        })
      ).status,
      422,
    );
    const changed = {
      ...af,
      answers: {
        certainty: "Suspected",
        rhythm: "Typical flutter",
        pattern: "Paroxysmal",
      },
      version: 1,
    };
    const update = await call(
      `/care/guided/${saved.data[1].id}`,
      changed,
      "PUT",
    );
    assert.equal(update.status, 200, JSON.stringify(update.data));
    assert.equal(update.data.structured.pattern, undefined);
    assert.equal(update.data.version, 2);
    assert.equal(
      (await call(`/care/guided/${saved.data[1].id}`, changed, "PUT")).status,
      409,
    );
    const hist = (await call(`/care/entries/${saved.data[1].id}/history`)).data;
    assert.equal(hist[1].payload.structured.pattern, "Paroxysmal");
    const held = {
      ...common,
      template_key: "medication.apixaban",
      status: "held",
      answers: { decision_reason: "Renal review" },
    };
    assert.equal((await call(path, { entries: [held] })).status, 422);
    assert.equal(
      (await call(path, { entries: [{ ...held, due_date: "2025-02-01" }] }))
        .status,
      201,
    );
    const pkg = (await call("/registry-forms")).data.find(
      (p: RegistryPackage) => p.key === "HF",
    ) as RegistryPackage;
    const context = "Extra_Admissions JSON array",
      parent = pkg.fields.find(
        (f) => f.context === context && f.sourceKey === "Holter_Done",
      )!,
      child = pkg.fields.find(
        (f) => f.context === context && f.sourceKey === "Holter_Date",
      )!;
    assert.ok(parent && child);
    assert.ok(
      !registryVisible(pkg, {}, context).some((f) => f.key === child.key),
    );
    assert.ok(
      registryVisible(pkg, { [parent.key]: "Yes" }, context).some(
        (f) => f.key === child.key,
      ),
    );
    assert.deepEqual(
      cleanRegistry(
        pkg,
        { [parent.key]: "No", [child.key]: "2025-01-01" },
        context,
      ),
      { [parent.key]: "No" },
    );
    const draft = {
      registry_key: "HF",
      package_version: 1,
      context,
      encounter_id: null,
      answers: { [parent.key]: "Yes", [child.key]: "2025-01-01" },
    };
    const rp = `/patients/${p.id}/registry-forms`;
    const first = await call(rp, draft);
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const second = await call(
      `${rp}/${first.data.id}`,
      {
        ...draft,
        version: 1,
        answers: { ...draft.answers, [parent.key]: "No" },
      },
      "PUT",
    );
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.answers[child.key], undefined);
    assert.equal(
      (await call(`${rp}/${first.data.id}`, { ...draft, version: 1 }, "PUT"))
        .status,
      409,
    );
    const rh = (await call(`${rp}/${first.data.id}/history`)).data;
    assert.equal(rh.length, 2);
    assert.equal(rh[1].payload.answers[child.key], "2025-01-01");
    await assert.rejects(
      db.query(
        "DELETE FROM registry.assessment_revision WHERE assessment_id=$1",
        [first.data.id],
      ),
      /Append-only/,
    );
    await assert.rejects(
      db.query(
        "UPDATE registry.form_package SET checksum='x' WHERE registry_key='HF'",
      ),
      /Append-only/,
    );
    const blocked = pkg.fields.find((f) => f.context === context && f.blocked)!;
    assert.equal(
      (await call(rp, { ...draft, answers: { [blocked.key]: "attempt" } }))
        .status,
      422,
    );
    const other = (
      await call("/patients", {
        name: "Other Sample",
        mrn: "SYN-GUIDED-OTHER",
        sex: "Male",
        birth_date: "1970-01-01",
      })
    ).data;
    assert.equal(
      (
        await call(
          `/patients/${other.id}/registry-forms/${first.data.id}/history`,
        )
      ).status,
      404,
    );
    await call("/demo-session", { role: "reviewer" });
    assert.equal((await call(rp)).status, 200);
    assert.equal((await call(rp, draft)).status, 403);
    assert.equal((await call(path, { entries: [hf] })).status, 403);
    for (const role of ["analyst", "designer"]) {
      await call("/demo-session", { role });
      assert.equal((await call("/registry-forms")).status, 403);
      assert.equal((await call(rp)).status, 403);
    }
  } finally {
    server.close();
    await db.close();
  }
});
