// Complication wizards: congestion, low blood pressure, bradycardia / AV block.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { buildOutcome } from "../shared/wizards.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string, time = "09:00") => new Date(`${day}T${time}:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions = ["hfref"]) => tx((q) => K.createPatient(q, doc, { name: "Cx " + rnd(), mrn: "C" + rnd() + Date.now(), sex: "Female", birthDate: "1957-02-01", conditions }));
const active = async (pid: string) =>
  (await db.query(`SELECT id, rule_id, severity, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows.map((r: any) => ({ ...r, action: typeof r.action === "string" ? JSON.parse(r.action) : r.action }));
const start = (pid: string, code: string, dose: number, freq: string, days = -90) =>
  tx((q) => K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication: "hf", effectiveAt: at(addDays(T, days)) }));
const med = async (pid: string, code: string) => (await loadState(db, pid)).meds.find((m) => m.code === code)!;

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("congestion: weight gain opens the wizard; the confirmed plan changes the diuretic and books checks", async () => {
  const pid = await newPatient();
  await start(pid, "furosemide", 40, "OD");
  await tx(async (q) => {
    await K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, -3)), items: [{ code: "weight", value: 80 }, { code: "creatinine", value: 110 }] });
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "weight", value: 82.4 }] });
    await reassess(q, pid, "sandbox");
  });
  const rec = (await active(pid)).find((r) => r.rule_id === "hf.congestion");
  assert.match(rec.title, /Weight up 2\.4 kg in 3 days/);
  assert.equal(rec.action.wizard, "congestion");
  const w = await tx((q) => getWizard(q, pid, "congestion"));
  assert.deepEqual(w.context.detected.signs, ["weight"]);
  const answers = { signs: ["weight", "oedema"], redflags: ["none"], precipitants: ["salt"], actions: ["increase-loop", "self-care", "precipitant"], loopDose: "80", recheck: "7", review: "clinic-7" };
  const preview = buildOutcome("congestion", answers, w.context);
  const r = await tx((q) => completeWizard(q, doc, pid, "congestion", { answers, recommendationId: rec.id }));
  assert.deepEqual(r.outcome.map((o) => o.label), preview.map((o) => o.label), "preview equals what is recorded");
  assert.equal((await med(pid, "furosemide")).doseValue, 80);
  const titles = (await loadState(db, pid)).plan.filter((p) => p.status === "planned").map((p) => p.title);
  for (const t of ["Renal function and potassium check", "Clinic review", "Daily weights, flexible diuretic, salt and fluid advice", "Treat the precipitant: salt"]) assert.ok(titles.includes(t), t);
  await assert.rejects(tx((q) => completeWizard(q, doc, pid, "congestion", { answers: { signs: ["oedema"], actions: ["self-care"], recheck: "7", review: "none" } })), /Any red flag/);
  // a red flag always adds same-day assessment
  const red = buildOutcome("congestion", { ...answers, redflags: ["hypoxia"] }, w.context);
  assert.ok(red.some((o) => o.kind === "plan" && o.title === "Same-day hospital assessment (red flag)"));
});

test("low blood pressure: vasodilator and dry diuretic detected; stepwise changes recorded", async () => {
  const pid = await newPatient(["hfref", "htn"]);
  await start(pid, "sacubitril-valsartan", 49, "BID");
  await start(pid, "amlodipine", 5, "OD");
  await start(pid, "furosemide", 40, "OD");
  await tx(async (q) => {
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "sbp", value: 84 }, { code: "congestion", text: "None" }] });
    await reassess(q, pid, "sandbox");
  });
  const rec = (await active(pid)).find((r) => r.rule_id === "hf.symptomatic-hypotension");
  assert.match(rec.title, /SBP 84 mmHg on 3 BP-lowering drugs/);
  const w = await tx((q) => getWizard(q, pid, "hypotension"));
  assert.deepEqual(w.context.detected.contributors.sort(), ["diuretic", "vasodilator"]);
  await tx((q) => completeWizard(q, doc, pid, "hypotension", {
    answers: { symptoms: ["dizziness"], volume: "euvolaemic", contributors: ["vasodilator", "diuretic"], actions: ["stop-vasodilator", "reduce-loop"], loopDose: "20", recheck: "7", review: "phone-3" },
    recommendationId: rec.id,
  }));
  assert.equal((await med(pid, "amlodipine")).status, "stopped");
  assert.equal((await med(pid, "furosemide")).doseValue, 20);
  assert.equal((await med(pid, "sacubitril-valsartan")).doseValue, 49, "RAAS untouched");
});

test("bradycardia: complete heart block is red, rate-slowing drugs detected, stops and a same-day plan", async () => {
  const pid = await newPatient(["hfref", "af"]);
  await start(pid, "bisoprolol", 10, "OD");
  await start(pid, "digoxin", 0.125, "OD");
  await start(pid, "ivabradine", 5, "BID");
  await tx(async (q) => {
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "hr", value: 44 }] });
    await reassess(q, pid, "sandbox");
  });
  let rec = (await active(pid)).find((r) => r.rule_id === "rhythm.bradycardia");
  assert.equal(rec.severity, "orange");
  assert.match(rec.title, /Heart rate 44 bpm on rate-slowing therapy/);
  await tx(async (q) => {
    const r = await K.recordStudy(q, doc, pid, { kind: "ecg", date: nowIso(), findings: { rhythm: "Sinus rhythm", rate: 38, qrs: 110, qrsMorphology: "Normal", avBlock: "Complete" } });
    await reassess(q, pid, "sandbox", r.changed);
  });
  rec = (await active(pid)).find((r) => r.rule_id === "rhythm.bradycardia");
  assert.equal(rec.severity, "red");
  assert.match(rec.title, /Complete AV block/);
  const w = await tx((q) => getWizard(q, pid, "bradycardia"));
  assert.deepEqual(w.context.detected.block, ["high-grade"]);
  assert.deepEqual(w.context.detected.contributors.sort(), ["bb", "digoxin", "ivabradine"]);
  const r = await tx((q) => completeWizard(q, doc, pid, "bradycardia", {
    answers: { symptoms: ["syncope"], block: "high-grade", contributors: ["bb", "digoxin", "ivabradine"], actions: ["stop-other", "reduce-bb", "pacing"], bbDose: "5", review: "clinic-7" },
    recommendationId: rec.id,
  }));
  assert.equal((await med(pid, "ivabradine")).status, "stopped");
  assert.equal((await med(pid, "digoxin")).status, "stopped");
  assert.equal((await med(pid, "bisoprolol")).doseValue, 5);
  const plans = r.outcome.filter((o) => o.kind === "plan").map((o: any) => [o.title, o.dueDate]);
  assert.deepEqual(plans.find((p) => p[0] === "EP / pacing assessment"), ["EP / pacing assessment", T]);
  assert.ok(plans.some((p) => p[0] === "Same-day hospital assessment" && p[1] === T));
});

test("options follow the patient's medicines: no loop diuretic means 'start', not 'increase'", async () => {
  const pid = await newPatient();
  const w = await tx((q) => getWizard(q, pid, "congestion"));
  const { optionsFor, WIZARDS } = await import("../shared/wizards.js");
  const actions = WIZARDS.congestion.steps.flatMap((s) => s.questions).find((q) => q.id === "actions")!;
  const values = optionsFor(actions, w.context).map((o) => o.value);
  assert.ok(values.includes("start-loop") && !values.includes("increase-loop"));
  await assert.rejects(
    tx((q) => completeWizard(q, doc, pid, "congestion", { answers: { signs: ["oedema"], redflags: ["none"], actions: ["increase-loop"], loopDose: "80", recheck: "7", review: "none" } })),
    /does not apply/,
  );
});
