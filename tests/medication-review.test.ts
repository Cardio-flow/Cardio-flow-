import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { correctMedicationEntry } from "../server/kernel/corrections.js";
import { loadState } from "../server/kernel/state.js";
import { summary, recommendations } from "../server/kernel/views.js";
import {
  medicationReview,
  medicationReviewContext,
} from "../server/engine/medication-review.js";
import { reassess } from "../server/engine/engine.js";
import { previewDecision } from "../server/engine/decide.js";
import { completeWizard } from "../server/engine/wizard.js";
import { facts } from "../server/engine/med-safety.js";
import { MED_RULES } from "../server/engine/med-rules.js";
import { addDays } from "../shared/clinical.js";
import { today, type Actor } from "../server/kernel/base.js";
let db: DB,
  n = 0;
const actor: Actor = {
  id: "med-review@test.local",
  name: "Synthetic review",
  role: "clinician",
  siteId: SITE_ID,
};
const T = today(),
  at = (days = 0) =>
    new Date(`${addDays(T, days)}T00:01:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());
const patient = (conditions: string[] = []) =>
  tx((q) =>
    K.createPatient(q, actor, {
      name: "Synthetic medicine review",
      mrn: "MR-" + ++n,
      sex: "Female",
      birthDate: "1955-01-01",
      conditions,
    }),
  );
const med = (id: string, code: string, extra: Record<string, any> = {}) =>
  tx((q) =>
    K.startMedication(q, actor, id, {
      code,
      doseValue: code === "apixaban" ? 5 : code === "ibuprofen" ? 400 : 25,
      frequency:
        code === "apixaban" ? "BID" : code === "ibuprofen" ? "TID" : "OD",
      route: "PO",
      indication: code === "apixaban" ? "af" : "other",
      alreadyTaking: true,
      effectiveAt: at(),
      ...extra,
    }),
  );
const labs = (
  id: string,
  items: any[],
  days = 0,
  status: "final" | "preliminary" = "final",
) =>
  tx((q) =>
    K.recordObservations(q, actor, id, {
      items,
      effectiveAt: days === 0 ? new Date().toISOString() : at(days),
      status,
    }),
  );
const run = (id: string) => tx((q) => reassess(q, id, "production"));
const review = async (id: string) =>
  medicationReview(await loadState(db, id), await recommendations(db, id));
test("empty patient: no review burden, invented safety clearance or monitoring", async () => {
  const id = await patient();
  await run(id);
  const r = await review(id);
  assert.equal(r.issues.length, 0);
  assert.equal(r.checks.length, 0);
  assert.equal(r.renal, null);
  const p = await tx((q) => previewDecision(q, id, "medication-monitoring"));
  assert.equal(p.ready, false);
  assert.match(p.blockers.join(), /No unbooked/);
});
test("already-taking apixaban and amiodarone: union due bloods once without inventing start dates", async () => {
  const id = await patient(["af"]);
  await med(id, "apixaban");
  await med(id, "amiodarone", { doseValue: 200 });
  const s = await loadState(db, id),
    r = medicationReviewContext(s);
  assert(s.meds.every((m) => m.startedAt === null));
  assert.equal(s.plan.length, 0);
  assert.equal(r.checks.length, 1);
  assert.equal(r.checks[0].id, "bloods");
  assert.deepEqual([...r.checks[0].codes!].sort(), [
    "alt",
    "creatinine",
    "haemoglobin",
    "tsh",
  ]);
  const p = await tx((q) => previewDecision(q, id, "medication-monitoring"));
  assert.equal(p.ready, true);
  assert.deepEqual(p.answers.medicationChecks, ["bloods"]);
  assert.equal(p.plan.length, 1);
  assert(p.questions[0].options.length === 1);
});
test("manual date: one combined check completes on actual required results, awaiting review", async () => {
  const id = await patient(["af"]);
  await med(id, "apixaban");
  await med(id, "amiodarone", { doseValue: 200 });
  const p = await tx((q) => previewDecision(q, id, "medication-monitoring"));
  await tx((q) =>
    completeWizard(q, actor, id, "medication-monitoring", {
      answers: { ...p.answers, monitorDate: T },
      evidenceKey: p.evidenceKey,
    }),
  );
  let s = await loadState(db, id);
  assert.equal(s.plan.length, 1);
  assert.equal(s.plan[0].due_date, T);
  assert.equal(medicationReviewContext(s).checks.length, 0);
  const partial = await labs(id, [
    { code: "haemoglobin", value: 12 },
    { code: "creatinine", value: 100 },
    { code: "alt", value: 20 },
  ]);
  s = await loadState(db, id);
  assert.equal(s.plan[0].status, "planned", "TSH is required too");
  await labs(id, [{ code: "tsh", value: 2 }]);
  assert.equal(
    (await loadState(db, id)).plan[0].status,
    "planned",
    "a separate draw does not complete the original panel",
  );
  await tx((q) =>
    K.recordObservations(q, actor, id, {
      effectiveAt: new Date().toISOString(),
      collectionRef: partial.ids[0],
      items: [{ code: "tsh", value: 2 }],
    }),
  );
  s = await loadState(db, id);
  assert.equal(s.plan[0].status, "completed");
  const v = await summary(db, id, "production");
  assert(v.plan.some((p) => p.awaitingReview));
  assert(s.meds.every((m) => m.startedAt === null));
});
test("existing future panel is reused, while missing tests remain explicit", async () => {
  const id = await patient(["af"]);
  await med(id, "apixaban");
  await med(id, "amiodarone", { doseValue: 200 });
  await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "monitoring",
      title: "Existing anticoagulant bloods",
      dueDate: addDays(T, 4),
      completesOn: { type: "lab", codes: ["haemoglobin", "creatinine", "alt"] },
    }),
  );
  const r = medicationReviewContext(await loadState(db, id));
  assert.equal(r.checks.length, 1);
  assert.deepEqual(r.checks[0].codes, ["tsh"]);
});
test("overdue existing monitoring stays an actionable appointment, without a duplicate panel", async () => {
  const id = await patient();
  await med(id, "metformin", { doseValue: 500, frequency: "BID" });
  await tx((q) =>
    K.addPlanAction(q, actor, id, {
      category: "monitoring",
      title: "Renal check",
      dueDate: addDays(T, -2),
      completesOn: { type: "lab", codes: ["creatinine"] },
    }),
  );
  const r = await review(id);
  assert.equal(r.checks.length, 0);
  assert.equal(r.appointments.length, 1);
  assert.equal(r.appointments[0].dueDate, addDays(T, -2));
});
test("fresh verified bloods keep ordinary monitoring quiet", async () => {
  const id = await patient(["af"]);
  await med(id, "apixaban");
  await labs(id, [
    { code: "creatinine", value: 85 },
    { code: "weight", value: 70 },
    { code: "haemoglobin", value: 12.5 },
    { code: "alt", value: 20 },
  ]);
  await run(id);
  const r = await review(id);
  assert.equal(r.checks.length, 0);
  assert(r.renal);
  assert(!r.issues.some((x) => x.rule_id === "af.doac-dose"));
});
test("held, stopped and not-taking medicines do not generate active interaction or monitoring checks", async () => {
  for (const kind of ["hold", "stop", "not_taking"] as const) {
    const id = await patient();
    const m = await med(id, "apixaban");
    await med(id, "ibuprofen");
    await tx((q) =>
      K.medicationEvent(q, actor, id, m.medicationId, {
        kind,
        reason: "Synthetic clinical reason",
        effectiveAt: new Date().toISOString(),
      }),
    );
    await run(id);
    const r = await review(id);
    assert(!r.issues.some((x) => /increased bleeding risk/.test(x.title)));
    assert(!r.checks.some((x) => x.medicines.includes("Apixaban")));
  }
});
test("apixaban plus ibuprofen: a label-based caution, no automatic stop or dose reduction", async () => {
  const id = await patient(["af"]);
  await med(id, "apixaban");
  await med(id, "ibuprofen");
  await run(id);
  const r = await review(id),
    hit = r.issues.find((x) => /increased bleeding risk/.test(x.title));
  assert(hit);
  assert.equal(hit.severity, "yellow");
  assert.equal(hit.action.type, "med-action");
  assert.match(hit.detail, /Do not stop anticoagulation/);
  assert.equal(
    (await loadState(db, id)).meds.filter((m) => m.status === "active").length,
    2,
  );
});
test("missing dose, frequency and route open one correction and preserve reconciliation history", async () => {
  const id = await patient();
  const m = await med(id, "bisoprolol", {
    doseValue: null,
    frequency: "",
    route: "",
  });
  await run(id);
  let r = await review(id);
  const hit = r.issues.find((x) => x.rule_id === "med.regimen");
  assert(hit);
  assert.deepEqual(hit.missing, ["Dose", "Frequency", "Route"]);
  assert.equal(hit.action.type, "med-correct");
  await tx((q) =>
    correctMedicationEntry(q, actor, id, m.medicationId, {
      doseValue: 5,
      frequency: "OD",
      route: "PO",
    }),
  );
  await run(id);
  const s = await loadState(db, id);
  assert.equal(s.meds[0].doseValue, 5);
  assert.equal(s.meds[0].frequency, "OD");
  assert.equal(s.meds[0].route, "PO");
  assert.equal(s.meds[0].startedAt, null);
  assert.equal(s.plan.length, 0);
  r = await review(id);
  assert(!r.issues.some((x) => x.rule_id === "med.regimen"));
});
test("invalid correction routes/frequencies are rejected, with no partial write", async () => {
  const id = await patient();
  const m = await med(id, "bisoprolol", { doseValue: 5 });
  await assert.rejects(
    tx((q) =>
      correctMedicationEntry(q, actor, id, m.medicationId, { route: "IV" }),
    ),
    /listed medication route/,
  );
  await assert.rejects(
    tx((q) =>
      correctMedicationEntry(q, actor, id, m.medicationId, {
        frequency: "hourly",
      }),
    ),
    /listed medication frequency/,
  );
  assert.equal((await loadState(db, id)).meds[0].events.length, 1);
});
test("fixed-dose combination overlap is actionable, and inactive replacement does not alert", async () => {
  const id = await patient();
  const a = await med(id, "amlodipine-valsartan", { doseValue: 5 });
  await med(id, "valsartan", { doseValue: 80 });
  await run(id);
  let r = await review(id);
  assert(
    r.issues.some(
      (x) => /review overlap/.test(x.title) && /valsartan/.test(x.detail),
    ),
  );
  await tx((q) =>
    K.medicationEvent(q, actor, id, a.medicationId, {
      kind: "stop",
      reason: "Intentional replacement",
      effectiveAt: new Date().toISOString(),
    }),
  );
  await run(id);
  r = await review(id);
  assert(!r.issues.some((x) => /review overlap/.test(x.title)));
});
test("renal label checks request verified missing inputs, then resolve", async () => {
  const id = await patient();
  await med(id, "atenolol", { doseValue: 50 });
  await run(id);
  let r = await review(id);
  assert.deepEqual(
    r.issues.find((x) => x.rule_id === "med.renal-data").action.codes,
    ["creatinine", "weight"],
  );
  await labs(id, [
    { code: "creatinine", value: 85 },
    { code: "weight", value: 70 },
  ]);
  await run(id);
  r = await review(id);
  assert(!r.issues.some((x) => x.rule_id === "med.renal-data"));
  assert(r.renal);
});
test("AF DOAC missing inputs have one owner; VTE is not assigned the AF dose", async () => {
  const af = await patient(["af"]);
  await med(af, "apixaban");
  await run(af);
  const r = await review(af);
  assert.equal(r.issues.filter((x) => x.rule_id === "af.doac-dose").length, 1);
  assert(!r.issues.some((x) => x.rule_id === "med.renal-data"));
  const vte = await patient();
  await med(vte, "apixaban", { doseValue: 2.5, indication: "VTE prevention" });
  await run(vte);
  const v = await review(vte);
  assert(!v.issues.some((x) => x.rule_id === "af.doac-dose"));
  assert(v.issues.some((x) => x.rule_id === "med.renal-data"));
});
test("preliminary or old creatinine/weight cannot establish a renal dose check", async () => {
  for (const [days, status] of [
    [0, "preliminary"],
    [-400, "final"],
  ] as const) {
    const id = await patient();
    await med(id, "atenolol", { doseValue: 50 });
    await labs(
      id,
      [
        { code: "creatinine", value: 85 },
        { code: "weight", value: 70 },
      ],
      days,
      status,
    );
    await run(id);
    assert.equal(facts(await loadState(db, id)).crcl, null);
    assert(
      (await review(id)).issues.some((x) => x.rule_id === "med.renal-data"),
    );
  }
});
test("stale preview cannot book checks after a medicine change", async () => {
  const id = await patient();
  const m = await med(id, "amiodarone", { doseValue: 200 });
  const p = await tx((q) => previewDecision(q, id, "medication-monitoring"));
  await tx((q) =>
    K.medicationEvent(q, actor, id, m.medicationId, {
      kind: "hold",
      reason: "Safety review",
      effectiveAt: new Date().toISOString(),
    }),
  );
  await assert.rejects(
    tx((q) =>
      completeWizard(q, actor, id, "medication-monitoring", {
        answers: p.answers,
        evidenceKey: p.evidenceKey,
      }),
    ),
    /record changed/,
  );
  assert.equal((await loadState(db, id)).plan.length, 0);
});
test("empty, unknown and past-date monitoring requests cannot be confirmed", async () => {
  const id = await patient();
  await med(id, "amiodarone", { doseValue: 200 });
  for (const a of [
    { medicationChecks: [], monitorDate: T },
    { medicationChecks: ["wrong"], monitorDate: T },
    { medicationChecks: ["bloods"], monitorDate: addDays(T, -1) },
  ]) {
    await assert.rejects(
      tx((q) =>
        completeWizard(q, actor, id, "medication-monitoring", { answers: a }),
      ),
    );
  }
  assert.equal((await loadState(db, id)).plan.length, 0);
});
test("monitoring confirmation does not resolve an unsafe medicine interaction", async () => {
  const id = await patient();
  await med(id, "apixaban");
  await med(id, "ibuprofen");
  await run(id);
  const p = await tx((q) => previewDecision(q, id, "medication-monitoring"));
  await tx((q) =>
    completeWizard(q, actor, id, "medication-monitoring", {
      answers: p.answers,
      evidenceKey: p.evidenceKey,
    }),
  );
  await run(id);
  assert(
    (await review(id)).issues.some((x) =>
      /increased bleeding risk/.test(x.title),
    ),
  );
});
test("same safety finding changes its signature when dose or frequency changes", async () => {
  const id = await patient();
  const m = await med(id, "apixaban");
  await med(id, "ibuprofen");
  const rule = MED_RULES.find((r) => r.id === "med.interaction")!;
  const first = rule
    .evaluate(await loadState(db, id), {})
    .find((x) => x.key.startsWith("nsaid-antithrombotic"))!;
  await tx((q) =>
    K.medicationEvent(q, actor, id, m.medicationId, {
      kind: "decrease",
      doseValue: 2.5,
      reason: "Documented specialist decision",
      effectiveAt: new Date().toISOString(),
    }),
  );
  const next = rule
    .evaluate(await loadState(db, id), {})
    .find((x) => x.key.startsWith("nsaid-antithrombotic"))!;
  assert.notEqual(first.signature, next.signature);
});

test("ibuprofen with anticoagulant plus antiplatelet produces one combined bleeding-interaction finding", async () => {
  const id = await patient();
  await med(id, "warfarin", { doseValue: 5 });
  await med(id, "clopidogrel", { doseValue: 75 });
  await med(id, "ibuprofen");
  await run(id);
  const r = await review(id),
    hits = r.issues.filter((x) => /increased bleeding risk/.test(x.title));
  assert.equal(hits.length, 1);
  assert.match(hits[0].title, /Warfarin/);
  assert.match(hits[0].title, /Clopidogrel/);
});
test("manual future date is preserved and does not complete from earlier results", async () => {
  const id = await patient();
  await med(id, "amiodarone", { doseValue: 200 });
  const p = await tx((q) => previewDecision(q, id, "medication-monitoring"));
  await tx((q) =>
    completeWizard(q, actor, id, "medication-monitoring", {
      answers: { ...p.answers, monitorDate: addDays(T, 20) },
      evidenceKey: p.evidenceKey,
    }),
  );
  await labs(id, [
    { code: "alt", value: 20 },
    { code: "tsh", value: 2 },
  ]);
  const s = await loadState(db, id);
  assert.equal(s.plan[0].due_date, addDays(T, 20));
  assert.equal(s.plan[0].status, "planned");
});


test("missing TSH joins due monitoring; booked TSH is quiet, but an abnormal actual result opens thyroid care",async()=>{
  const id=await patient();await med(id,"amiodarone",{doseValue:200});await run(id);
  let r=await review(id);assert.equal(r.issues.filter(x=>x.action?.wizard==="medication-monitoring").length,1);assert(!r.issues.some(x=>x.action?.wizard==="amiodarone-thyroid"));
  const p=await tx(q=>previewDecision(q,id,"medication-monitoring"));
  await tx(q=>completeWizard(q,actor,id,"medication-monitoring",{answers:p.answers,evidenceKey:p.evidenceKey}));await run(id);
  assert(!(await recommendations(db,id)).some(x=>x.rule_id==="event.amiodarone-thyroid"));
  await labs(id,[{code:"alt",value:20},{code:"tsh",value:0.01}]);await run(id);
  r=await review(id);assert(r.issues.some(x=>x.action?.wizard==="amiodarone-thyroid" && x.severity==="orange"));
});
