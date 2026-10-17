import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { previewDecision } from "../server/engine/decide.js";
import { completeWizard } from "../server/engine/wizard.js";
import { IRON_CHECKS } from "../shared/wizards-iron.js";
import { addDays } from "../shared/clinical.js";
import { today, nowIso, type Actor } from "../server/kernel/base.js";
let db: DB,
  n = 0;
const actor: Actor = {
  id: "audit@cardioflow.local",
  name: "Synthetic Audit",
  siteId: SITE_ID,
  role: "clinician",
};
const tx = <T>(f: (q: any) => Promise<T>) => db.transaction(f),
  T = today();
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
const patient = () =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic Oct17",
      mrn: "AUD17-" + ++n,
      sex: "Male",
      birthDate: "1960-01-01",
      conditions: ["hfref"],
    }),
  );
const obs = (id: string, items: any[], effectiveAt = nowIso()) =>
  tx((q) => K.recordObservations(q, actor, id, { effectiveAt, items }));
async function iron() {
  const id = await patient();
  await obs(id, [
    { code: "lvef", value: 32 },
    { code: "haemoglobin", value: 13.5 },
    { code: "ferritin", value: 60 },
    { code: "tsat", value: 15 },
    { code: "weight", value: 60 },
  ]);
  return id;
}
const checks = IRON_CHECKS.map((c) => c.value);
test("incomplete IV iron checks remain needed until every safety confirmation is present", async () => {
  const id = await iron();
  for (let i = 0; i < checks.length; i++) {
    const p = await tx((q) =>
      previewDecision(q, id, "iv-iron", { checks: checks.slice(0, i) }),
    );
    assert.equal(p.ready, false);
    assert(p.needed.some((q) => q.id === "checks"));
  }
  assert.equal(
    (await tx((q) => previewDecision(q, id, "iv-iron", { checks }))).ready,
    true,
  );
});
test("changed weight invalidates the confirmed IV iron preview before any new plan is recorded", async () => {
  const id = await iron(),
    p = await tx((q) => previewDecision(q, id, "iv-iron", { checks }));
  await obs(id, [{ code: "weight", value: 80 }]);
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "iv-iron", {
        answers: p.answers,
        evidenceKey: p.evidenceKey,
      }),
    ),
    /patient record changed/,
  );
  assert.equal((await loadState(db, id)).plan.length, 0);
});
test("renal plan cannot contradict an actionable potassium result", async () => {
  const id = await patient();
  await tx((q) =>
    K.startMedication(q, actor, id, {
      code: "spironolactone",
      doseValue: 25,
      frequency: "OD",
      route: "PO",
      indication: "hf",
      effectiveAt: nowIso(),
      alreadyTaking: true,
    }),
  );
  await obs(
    id,
    [
      { code: "creatinine", value: 90 },
      { code: "potassium", value: 4.3 },
    ],
    new Date(`${addDays(T, -60)}T09:00:00Z`).toISOString(),
  );
  await obs(id, [
    { code: "creatinine", value: 151 },
    { code: "potassium", value: 6.2 },
  ]);
  const p = await tx((q) =>
    previewDecision(q, id, "renal-function", { volume: "euvolaemic" }),
  );
  assert.equal(p.ready, false);
  assert(p.blockers.some((s) => s.includes("Potassium 6.2")));
  assert.equal(p.plan.length, 0);
  assert(!p.medReview.some((m) => m.tone === "keep"));
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "renal-function", {
        answers: { ...p.answers, actions: ["continue"] },
      }),
    ),
    /review hyperkalaemia/,
  );
});
test("changing the first infusion date shifts the dependent schedule; unsafe intervals are rejected", async () => {
  const id = await iron();
  await obs(id, [{ code: "weight", value: 80 }]);
  const initial = await tx((q) =>
    previewDecision(q, id, "iv-iron", { checks }),
  );
  const plans = initial.plan.filter((x) => x.kind === "plan");
  const dates = { [plans[0].title!]: addDays(T, 10) };
  const p = await tx((q) =>
    previewDecision(q, id, "iv-iron", { checks }, dates),
  );
  assert.equal(p.ready, true);
  assert.equal(p.plan[0].dueDate, addDays(T, 10));
  assert.equal(p.plan[1].dueDate, addDays(T, 17));
  const bad = { ...dates, [plans[1].title!]: addDays(T, 11) };
  assert.equal(
    (await tx((q) => previewDecision(q, id, "iv-iron", { checks }, bad))).ready,
    false,
  );
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "iv-iron", {
        answers: p.answers,
        dueDates: bad,
      }),
    ),
    /at least 7 days/,
  );
  await tx((q) =>
    completeWizard(q, actor, id, "iv-iron", {
      answers: p.answers,
      dueDates: dates,
      evidenceKey: p.evidenceKey,
    }),
  );
  const saved = (await loadState(db, id)).plan;
  assert(saved.some((p) => String(p.due_date).slice(0, 10) === addDays(T, 17)));
  assert(
    saved
      .find((p) => /phosphate after/.test(p.title))
      ?.completes_on.codes?.includes("phosphate"),
  );
});
