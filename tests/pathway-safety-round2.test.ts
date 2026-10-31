import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import {
  gdmtPlan,
  lipidStatus,
  GUIDELINE_RULES,
} from "../server/engine/guidelines.js";
import { getWizard, completeWizard } from "../server/engine/wizard.js";
import { previewDecision } from "../server/engine/decide.js";
import { prefill } from "../shared/wizard-prefill.js";
import { today, nowIso, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { pregnancyOutcomeBlocker } from "../shared/wizards-pregnancy.js";

let db: DB,
  seq = 0;
const actor: Actor = {
  id: "pathways@example.test",
  name: "Synthetic audit",
  role: "clinician",
  siteId: SITE_ID,
};
const at = (n: number) => addDays(today(), n) + "T06:00:00Z";
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
const patient = (conditions: string[]) =>
  db.transaction((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic pathway safety",
      mrn: "PWS-" + ++seq,
      sex: "Male",
      birthDate: "1960-01-01",
      synthetic: true,
      conditions,
    }),
  );
const obs = (
  id: string,
  n: number,
  items: K.ObsInput[],
  status: "final" | "preliminary" = "final",
) =>
  db.transaction((q) =>
    K.recordObservations(q, actor, id, { effectiveAt: at(n), items, status }),
  );
const start = (
  id: string,
  code: string,
  doseValue: number,
  frequency: string,
  indication = "hf",
  n = -30,
) =>
  db.transaction((q) =>
    K.startMedication(q, actor, id, {
      code,
      doseValue,
      frequency,
      indication,
      route: "PO",
      effectiveAt: at(n),
    }),
  );
const active = async (id: string, rule: string) =>
  (
    await db.query<any>(
      "SELECT id,title,action FROM cf.recommendation WHERE patient_id=$1 AND rule_id=$2 AND status='active'",
      [id, rule],
    )
  ).rows;
async function hf() {
  const id = await patient(["hfref"]);
  await obs(id, -40, [
    { code: "lvef", value: 30 },
    { code: "creatinine", value: 90 },
    { code: "potassium", value: 4.2 },
    { code: "sbp", value: 120 },
    { code: "hr", value: 70 },
  ]);
  await start(id, "spironolactone", 25, "OD");
  return id;
}
test("HF titration waits for verified post-change potassium and creatinine", async () => {
  const id = await hf();
  await obs(
    id,
    -1,
    [
      { code: "creatinine", value: 92 },
      { code: "potassium", value: 4.3 },
    ],
    "preliminary",
  );
  assert.equal(
    gdmtPlan(await loadState(db, id))!.items.find((i) => i.key === "mra")!
      .change,
    null,
  );
});
test("verified post-change results unlock HF titration", async () => {
  const id = await hf();
  await obs(id, -1, [
    { code: "creatinine", value: 92 },
    { code: "potassium", value: 4.3 },
  ]);
  assert.equal(
    gdmtPlan(await loadState(db, id))!.items.find((i) => i.key === "mra")!
      .change?.kind,
    "increase",
  );
});
test("preliminary-only results cannot authorize an MRA start", async () => {
  const id = await patient(["hfref"]);
  await obs(
    id,
    -1,
    [
      { code: "lvef", value: 30 },
      { code: "creatinine", value: 90 },
      { code: "potassium", value: 4.2 },
      { code: "sbp", value: 120 },
      { code: "hr", value: 70 },
    ],
    "preliminary",
  );
  assert.equal(
    gdmtPlan(await loadState(db, id))!.items.find((i) => i.key === "mra")!
      .change,
    null,
  );
});
test("selecting the pre-change creatinine invalidates an already offered HF increase immediately", async () => {
  const id = await hf();
  await obs(id, -1, [
    { code: "creatinine", value: 92 },
    { code: "potassium", value: 4.3 },
  ]);
  await db.transaction((q) => reassess(q, id, "production"));
  assert.ok(
    (await active(id, "hf.titration")).some((r) =>
      /Spironolactone/.test(r.title),
    ),
  );
  const baseline = (await loadState(db, id))
    .resolved("creatinine")
    .history.at(-1)!;
  await db.transaction(async (q) => {
    const changed = await K.preferValue(
      q,
      actor,
      id,
      "creatinine",
      baseline.id,
      "Synthetic explicit result selection",
    );
    await reassess(q, id, "production", changed);
  });
  assert.ok(
    !(await active(id, "hf.titration")).some((r) =>
      /Spironolactone/.test(r.title),
    ),
  );
});
for (const [code, dose, frequency, rightFrequency] of [
  ["apixaban", 5, "OD", "BID"],
  ["rivaroxaban", 20, "BID", "OD"],
  ["edoxaban", 60, "BID", "OD"],
  ["dabigatran", 150, "OD", "BID"],
] as const) {
  test(`${code}: correct milligrams with wrong frequency requires an AF regimen decision`, async () => {
    const id = await patient(["af"]);
    await obs(id, -1, [
      { code: "creatinine", value: 80 },
      { code: "weight", value: 80 },
    ]);
    await start(id, code, dose, frequency, "af");
    await db.transaction((q) => reassess(q, id, "production"));
    assert.ok((await active(id, "af.doac-dose")).length);
    const { context } = await getWizard(db, id, "af-care");
    const pre = prefill("af-care", context, {});
    assert.equal(pre.answers.oac, "label-dose");
    const view = await previewDecision(db, id, "af-care", {
      ...pre.answers,
      oac: "label-dose",
    });
    assert.ok(
      view.plan.some(
        (p) => p.kind === "medication" && p.label.includes(rightFrequency),
      ),
    );
  });
}
for (const frequency of ["BID", "OD"] as const)
  test(`apixaban ${frequency}: only a mismatched AF schedule is flagged`, async () => {
    const id = await patient(["af"]);
    await obs(id, -1, [
      { code: "creatinine", value: 80 },
      { code: "weight", value: 80 },
    ]);
    await start(id, "apixaban", 5, frequency, "af");
    const rule = GUIDELINE_RULES.find((r) => r.id === "af.doac-dose")!;
    assert.equal(
      rule.evaluate(await loadState(db, id), {}).length > 0,
      frequency !== "BID",
    );
  });
test("a preliminary LDL baseline cannot establish failure of the 50% reduction goal", async () => {
  const id = await patient(["cad-ccs"]);
  await obs(id, -40, [{ code: "ldl-c", value: 2 }], "preliminary");
  await start(id, "atorvastatin", 80, "OD", "cad");
  await obs(id, -1, [{ code: "ldl-c", value: 1.3 }]);
  assert.equal(lipidStatus(await loadState(db, id))!.kind, "ok");
});
test("a preliminary-only LDL requests verification rather than escalating treatment", async () => {
  const id = await patient(["cad-ccs"]);
  await obs(id, -1, [{ code: "ldl-c", value: 4 }], "preliminary");
  assert.equal(lipidStatus(await loadState(db, id))!.kind, "due");
});
test("AF confirmation records the proposed frequency once, resolves its alert, and detects a later recurrence", async () => {
  const id = await patient(["af"]);
  await obs(id, -1, [
    { code: "creatinine", value: 80 },
    { code: "weight", value: 80 },
  ]);
  const { medicationId } = await start(id, "apixaban", 5, "OD", "af");
  await db.transaction((q) => reassess(q, id, "production"));
  const rec = (await active(id, "af.doac-dose"))[0];
  const answers = {
    pattern: "permanent",
    comorb: ["none"],
    oac: "label-dose",
    bleed: ["none"],
    symptoms: "1",
    rate: ["none"],
    rhythm: ["none"],
    tests: ["none"],
    review: "none",
  };
  const preview = await previewDecision(db, id, "af-care", answers);
  assert.equal(
    preview.ready,
    true,
    JSON.stringify({
      needed: preview.needed,
      missing: preview.needData,
      blockers: preview.blockers,
    }),
  );
  const recorded = await db.transaction(async (q) => {
    const r = await completeWizard(q, actor, id, "af-care", {
      answers: preview.answers,
      recommendationId: rec.id,
      evidenceKey: preview.evidenceKey,
    });
    await reassess(q, id, "production", r.changed);
    return r;
  });
  const med = (await loadState(db, id)).meds.find(
    (m) => m.id === medicationId,
  )!;
  assert.equal(med.frequency, "BID");
  assert.equal(med.doseValue, 5);
  assert.equal(med.events.length, 2);
  assert.equal(med.events.at(-1)!.decision_id, recorded.decisionId);
  assert.match(med.events.at(-1)!.reason, /^Frequency changed/);
  assert.equal((await active(id, "af.doac-dose")).length, 0);
  await db.transaction(async (q) => {
    const changed = await K.medicationEvent(q, actor, id, medicationId, {
      kind: "continue",
      frequency: "OD",
      reason: "Synthetic recurrence",
      effectiveAt: nowIso(),
    });
    await reassess(q, id, "production", changed);
  });
  assert.ok((await active(id, "af.doac-dose")).length);
});
for (const baseline of [2, 4])
  test(`a verified LDL baseline ${baseline} retains the existing 50% reduction rule`, async () => {
    const id = await patient(["cad-ccs"]);
    await obs(id, -40, [{ code: "ldl-c", value: baseline }]);
    await start(id, "atorvastatin", 80, "OD", "cad");
    await obs(id, -1, [{ code: "ldl-c", value: 1.3 }]);
    assert.equal(
      lipidStatus(await loadState(db, id))!.kind,
      baseline === 2 ? "above" : "ok",
    );
  });
test("a DOAC frequency correction still requires the pregnancy prescribing pathway", () => {
  const context: any = {
    pregnancy: {
      eligible: true,
      phase: "Pregnant",
      breastfeeding: "No",
      gestationDays: 120,
    },
    meds: [{ id: "doac", code: "apixaban" }],
  };
  assert.match(
    pregnancyOutcomeBlocker(
      "af-care",
      [
        {
          kind: "medication",
          medicationId: "doac",
          event: "continue",
          doseValue: null,
          frequency: "BID",
          label: "Synthetic AF correction",
        },
      ],
      context,
    )!,
    /pregnancy-specific/,
  );
});
for (const frequency of ["Nightly", "Mornings"])
  test(`once-daily edoxaban recorded as ${frequency} is not a false frequency error`, async () => {
    const id = await patient(["af"]);
    await obs(id, -1, [
      { code: "creatinine", value: 80 },
      { code: "weight", value: 80 },
    ]);
    await start(id, "edoxaban", 60, frequency, "af");
    const rule = GUIDELINE_RULES.find((r) => r.id === "af.doac-dose")!;
    assert.equal(rule.evaluate(await loadState(db, id), {}).length, 0);
  });
test("an unquantifiable recorded frequency asks for reconciliation before confirming a DOAC correction", async () => {
  const id = await patient(["af"]);
  await obs(id, -1, [
    { code: "creatinine", value: 80 },
    { code: "weight", value: 80 },
  ]);
  await start(id, "apixaban", 5, "Weekly", "af");
  const view = await previewDecision(db, id, "af-care", {
    pattern: "permanent",
    comorb: ["none"],
    oac: "label-dose",
    bleed: ["none"],
    symptoms: "1",
    rate: ["none"],
    rhythm: ["none"],
    tests: ["none"],
    review: "none",
  });
  assert.equal(view.ready, false);
  assert.ok(view.blockers.some((b) => /frequency.*daily exposure/i.test(b)));
  await assert.rejects(
    db.transaction((q) =>
      completeWizard(q, actor, id, "af-care", {
        answers: view.answers,
        evidenceKey: view.evidenceKey,
      }),
    ),
    /frequency.*daily exposure/i,
  );
  assert.equal((await loadState(db, id)).meds[0].events.length, 1);
});
