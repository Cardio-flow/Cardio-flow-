import { preStartCheck } from "../server/engine/med-safety.js";
import { MEDICATION } from "../shared/catalog.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import { createApp } from "../server/app.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { reassess } from "../server/engine/engine.js";
import { LAB_RULES } from "../server/engine/lab-rules.js";
import { GUIDELINE_RULES } from "../server/engine/guidelines.js";
import { buildOutcome } from "../shared/wizards.js";
import { prefill } from "../shared/wizard-prefill.js";
import { suggest } from "../shared/wizard-guidance.js";
import { today, nowIso, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
let db: DB,
  server: any,
  base: string,
  cookie: string,
  csrf: string,
  seq = 0;
const actor: Actor = {
  id: "lab@example.test",
  name: "Synthetic lab clinician",
  role: "clinician",
  siteId: SITE_ID,
};
const tx = <T>(fn: (q: any) => Promise<T>) => db.transaction(fn);
const patient = (sex = "Male", conditions: string[] = []) =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: `Synthetic lab ${++seq}`,
      mrn: `LAB-${Date.now()}-${seq}`,
      sex: sex as any,
      birthDate: "1960-01-01",
      synthetic: true,
      conditions,
    }),
  );
const post = async (path: string, body: any) => {
  const r = await fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrf,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  return j;
};
const labs = (id: string, items: K.ObsInput[]) =>
  post(`/patients/${id}/observations`, { effectiveAt: nowIso(), items });
const rule = async (id: string, key: string) => {
  const s = await loadState(db, id),
    r = LAB_RULES.find((r) => r.id === key)!;
  return r.evaluate(s, r.defaultParams);
};
const statin = (id: string) =>
  tx((q) =>
    K.startMedication(q, actor, id, {
      code: "atorvastatin",
      doseValue: 40,
      frequency: "OD",
      route: "PO",
      indication: "cad",
      effectiveAt: new Date(`${addDays(today(), -60)}T08:00:00Z`).toISOString(),
    }),
  );
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const r = await fetch(base + "/demo-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "dr.ahmed@cardioflow.local" }),
  });
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  csrf = (await r.json()).csrf;
});
after(async () => {
  server.close();
  await db.close();
});
test("result write immediately returns actionable lab pathways, with no automatic prescription", async () => {
  const id = await patient();
  await statin(id);
  const r = await labs(id, [
    { code: "vitamin-d", value: 8, unit: "ng/mL" },
    { code: "haemoglobin", value: 100, unit: "g/L" },
    { code: "alt", value: 180, referenceHigh: 40 },
    { code: "ck", value: 2400, referenceHigh: 200 },
  ]);
  for (const wizard of [
    "vitamin-d-result",
    "anaemia-result",
    "liver-result",
    "statin-ck-result",
  ])
    assert.ok(
      r.engine.created.some(
        (c: any) => c.action.type === "wizard" && c.action.wizard === wizard,
      ),
    );
  const s = await loadState(db, id);
  assert.equal(s.resolved("vitamin-d").current!.value_num, 20);
  assert.equal(s.resolved("haemoglobin").current!.value_num, 10);
  assert.equal(s.meds.length, 1);
  assert.equal(s.meds[0].status, "active");
  assert.equal(s.plan.length, 0);
  assert.equal((await rule(id, "lab.statin-ck"))[0].severity, "red");
  const c = (await getWizard(db, id, "statin-ck-result")).context;
  assert.deepEqual(
    suggest(
      "statin-ck-result",
      "actions",
      { symptoms: "no", redflags: ["none"], report: "checked" },
      c,
    ).map((s) => s.value),
    ["stop", "cause", "rechallenge"],
  );
});
test("CK thresholds distinguish symptoms and avoid catalogue ULN assumptions; correction preserves actual limits", async () => {
  const id = await patient();
  await statin(id);
  const r = await labs(id, [{ code: "ck", value: 1000 }]);
  assert.match((await rule(id, "lab.statin-ck"))[0].title, /verify report/);
  let c = (await getWizard(db, id, "statin-ck-result")).context;
  assert.equal(
    suggest("statin-ck-result", "actions", { symptoms: "no" }, c)[0].value,
    "limits",
  );
  await tx((q) =>
    K.correctObservation(q, actor, id, r.ids[0], { referenceHigh: 200 }),
  );
  c = (await getWizard(db, id, "statin-ck-result")).context;
  assert.equal(
    suggest("statin-ck-result", "actions", { symptoms: "no" }, c)[0].value,
    "continue",
  );
  assert.equal(
    suggest("statin-ck-result", "actions", { symptoms: "yes" }, c)[0].value,
    "hold",
  );
  await tx((q) => K.correctObservation(q, actor, id, r.ids[0], { value: 600 }));
  assert.equal(
    (await loadState(db, id)).resolved("ck").current!.reference_high,
    200,
  );
  await tx((q) =>
    K.correctObservation(q, actor, id, r.ids[0], { referenceHigh: 180 }),
  );
  assert.equal(
    (await loadState(db, id)).resolved("ck").current!.value_num,
    600,
  );
  await assert.rejects(
    tx((q) =>
      K.recordObservations(q, actor, id, {
        effectiveAt: nowIso(),
        items: [{ code: "ck", value: 2, referenceHigh: 0 }],
      }),
    ),
    /positive/,
  );
});
test("confirmed statin CK decision creates dated care and stops medicine only at confirmation; matching follow-up is reused", async () => {
  const id = await patient();
  await statin(id);
  await labs(id, [{ code: "ck", value: 2400, referenceHigh: 200 }]);
  const answers = {
    redflags: ["none"],
    symptoms: "yes",
    report: "checked",
    actions: ["stop", "cause", "rechallenge"],
    recheck: "14",
  };
  const title = "Statin CK and renal safety review",
    date = addDays(today(), 10);
  const out = await tx((q) =>
    completeWizard(q, actor, id, "statin-ck-result", {
      answers,
      dueDates: { [title]: date },
    }),
  );
  let s = await loadState(db, id);
  assert.equal(s.meds[0].status, "stopped");
  assert.ok(s.plan.some((p) => p.title === title && p.due_date === date));
  assert.ok(s.meds[0].events.some((e) => e.decision_id === out.decisionId));
  const c = (await getWizard(db, id, "statin-ck-result")).context;
  assert.equal(
    buildOutcome("statin-ck-result", answers, c, { [title]: date }).filter(
      (o) => o.kind === "plan" && o.title === title,
    ).length,
    0,
  );
  await db.query(
    "UPDATE cf.plan_action SET due_date=$2 WHERE patient_id=$1 AND title=$3",
    [id, today(), title],
  );
  await labs(id, [
    { code: "ck", value: 100, referenceHigh: 200 },
    { code: "creatinine", value: 75 },
  ]);
  s = await loadState(db, id);
  assert.equal(s.plan.find((p) => p.title === title)!.status, "completed");
  assert.equal((await rule(id, "lab.statin-ck")).length, 0);
});
test("preliminary results and corrected-away measurements never create treatment pathways", async () => {
  const id = await patient();
  await statin(id);
  await tx((q) =>
    K.recordObservations(q, actor, id, {
      effectiveAt: nowIso(),
      status: "preliminary",
      items: [
        { code: "vitamin-d", value: 10 },
        { code: "haemoglobin", value: 6 },
        { code: "ck", value: 6000, referenceHigh: 200 },
        { code: "alt", value: 500, referenceHigh: 40 },
      ],
    }),
  );
  for (const r of LAB_RULES)
    assert.equal(
      r.evaluate(await loadState(db, id), r.defaultParams).length,
      0,
    );
  const r = await labs(id, [{ code: "haemoglobin", value: 10 }]);
  assert.equal((await rule(id, "lab.anaemia")).length, 1);
  await post(`/patients/${id}/observations/${r.ids[0]}/correct`, {
    enteredInError: true,
  });
  assert.equal((await rule(id, "lab.anaemia")).length, 0);
  const s = await loadState(db, id);
  assert.ok(!s.observations.some((o) => o.id === r.ids[0]));
});
test("anaemia uses sex-specific adult cutoffs and shares the HF iron decision", async () => {
  const female = await patient("Female");
  await labs(female, [{ code: "haemoglobin", value: 12.5 }]);
  assert.equal((await rule(female, "lab.anaemia")).length, 0);
  const id = await patient("Male", ["hfref"]);
  await labs(id, [
    { code: "lvef", value: 20 },
    { code: "haemoglobin", value: 10 },
    { code: "ferritin", value: 50 },
    { code: "tsat", value: 15 },
  ]);
  const s = await loadState(db, id),
    r = GUIDELINE_RULES.find((r) => r.id === "hf.iron-deficiency")!;
  assert.equal(r.evaluate(s, r.defaultParams).length, 0);
  const c = (await getWizard(db, id, "anaemia-result")).context;
  assert.equal(
    suggest(
      "anaemia-result",
      "actions",
      { cause: "iron", scope: "standard", redflags: ["none"] },
      c,
    )[0].value,
    "iv",
  );
  const out = buildOutcome(
    "anaemia-result",
    {
      cause: "iron",
      scope: "standard",
      redflags: ["none"],
      actions: ["oral"],
      recheck: "28",
    },
    c,
  );
  assert.ok(!out.some((o) => o.kind === "start"));
});
test("iron and vitamin D medication suggestions respect treatment phase and require final confirmation", async () => {
  const id = await patient();
  await labs(id, [
    { code: "haemoglobin", value: 10 },
    { code: "ferritin", value: 10 },
    { code: "vitamin-d", value: 15 },
    { code: "calcium", value: 2.3, referenceHigh: 2.6 },
  ]);
  let c = (await getWizard(db, id, "vitamin-d-result")).context;
  const base = {
    scope: "standard",
    redflags: ["none"],
    safety: "safe",
    phase: "maintenance",
  };
  const a = { ...base, actions: ["maintenance"], recheck: "28" };
  const p = prefill("vitamin-d-result", c, base);
  assert.ok((p.answers.actions as string[]).includes("maintenance"));
  assert.ok(!p.answers.redflags || p.answers.redflags === base.redflags);
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "vitamin-d-result", {
        answers: { ...a, phase: "new" },
      }),
    ),
    /completed replacement/,
  );
  await tx((q) =>
    completeWizard(q, actor, id, "vitamin-d-result", { answers: a }),
  );
  assert.ok(
    (await loadState(db, id)).meds.some(
      (m) => m.code === "colecalciferol" && m.doseValue === 800,
    ),
  );
  await tx((q) =>
    completeWizard(q, actor, id, "anaemia-result", {
      answers: {
        scope: "standard",
        redflags: ["none"],
        cause: "iron",
        actions: ["oral", "cause"],
        recheck: "28",
      },
    }),
  );
  assert.ok(
    (await loadState(db, id)).meds.some(
      (m) => m.code === "ferrous-sulfate" && m.doseValue === 200,
    ),
  );
});
test("normal follow-up resolves prior liver recommendation and missing limits cannot change a statin", async () => {
  const id = await patient();
  await statin(id);
  await labs(id, [{ code: "alt", value: 120, referenceHigh: 40 }]);
  let c = (await getWizard(db, id, "liver-result")).context;
  assert.equal(suggest("liver-result", "actions", {}, c)[0].value, "hold");
  await labs(id, [{ code: "alt", value: 80, referenceHigh: 40 }]);
  c = (await getWizard(db, id, "liver-result")).context;
  assert.equal(suggest("liver-result", "actions", {}, c)[0].value, "continue");
  await labs(id, [{ code: "alt", value: 20, referenceHigh: 40 }]);
  assert.equal((await rule(id, "lab.liver-enzymes")).length, 0);
  await labs(id, [{ code: "alt", value: 500 }]);
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "liver-result", {
        answers: {
          redflags: ["none"],
          report: "checked",
          actions: ["hold"],
          recheck: "28",
        },
      }),
    ),
    /actual liver reference/,
  );
});

test("new HF diagnosis reopens anaemia's unified iron decision; statin pre-start checks use verified actual limits", async () => {
  const id = await patient();
  const r = await labs(id, [
    { code: "haemoglobin", value: 10 },
    { code: "ferritin", value: 15 },
    { code: "tsat", value: 15 },
    { code: "lvef", value: 20 },
  ]);
  const rec = r.engine.created.find((r: any) => r.rule_id === "lab.anaemia");
  await post(`/patients/${id}/wizards/anaemia-result/complete`, {
    recommendationId: rec.id,
    answers: {
      scope: "standard",
      redflags: ["none"],
      cause: "unknown",
      actions: ["defer"],
      recheck: "28",
    },
  });
  const hf = await post(`/patients/${id}/conditions`, { codes: ["hfref"] });
  assert.ok(hf.engine.created.some((r: any) => r.rule_id === "lab.anaemia"));
  await labs(id, [{ code: "ck", value: 1000, referenceHigh: 200 }]);
  const s = await loadState(db, id);
  assert.ok(
    preStartCheck(s, "atorvastatin", MEDICATION.atorvastatin).some(
      (h) => h.severity === "red" && /Baseline CK/.test(h.detail),
    ),
  );
});
