// 14 Oct 2026 — the pathway as the decision behind an alert: preview (what the record and the guideline fill
// in, what only the clinician answers, results still needed, the plan), IV iron dosing from the Ferinject
// label table, renal deterioration plans, dose halving, metformin renal limits.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { previewDecision } from "../server/engine/decide.js";
import { completeWizard } from "../server/engine/wizard.js";
import { safetyHits } from "../server/engine/med-safety.js";
import { ferinjectPlan, IRON_CHECKS } from "../shared/wizards-iron.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[], sex: "Male" | "Female" = "Female", birthDate = "1954-01-01") =>
  tx((q) => K.createPatient(q, doc, { name: "Dec " + rnd(), mrn: "D" + rnd() + Date.now(), sex, birthDate, conditions }));
const med = (pid: string, code: string, dose: number, freq: string, indication = "hf") =>
  tx((q) => K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication, effectiveAt: nowIso(), alreadyTaking: true } as any));
const obs = (pid: string, items: any[], when = nowIso()) => tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: when, items }); await reassess(q, pid, "production"); });
const preview = (pid: string, wizard: string, answers = {}) => tx((q) => previewDecision(q, pid, wizard, answers));

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("Ferinject total iron need and infusions follow the SmPC table and per-infusion limit", () => {
  assert.deepEqual(ferinjectPlan(9.5, 60)?.doses, [1000, 500]);
  assert.deepEqual(ferinjectPlan(9.5, 80)?.doses, [1000, 1000]);
  assert.deepEqual(ferinjectPlan(12, 50)?.doses, [1000]);
  assert.deepEqual(ferinjectPlan(12, 40)?.doses, [800, 200], "≤20 mg/kg per infusion");
  assert.equal(ferinjectPlan(14.5, 90)?.total, 500);
  assert.equal(ferinjectPlan(12, 30), null, "below 35 kg the label dose is per kg: not calculated");
  assert.equal(ferinjectPlan(null, 70), null);
});

test("HF iron deficiency: the decision asks only for the weight and the checks, then dates the infusions", async () => {
  const pid = await newPatient(["hfref"], "Male", "1962-01-01");
  await obs(pid, [{ code: "lvef", value: 32 }, { code: "ferritin", value: 60 }, { code: "tsat", value: 15 }, { code: "haemoglobin", value: 13.5 }]);
  const rec = (await db.query(`SELECT id, action FROM cf.recommendation WHERE patient_id=$1 AND rule_id='hf.iron-deficiency' AND status='active'`, [pid])).rows[0] as any;
  assert.equal((typeof rec.action === "string" ? JSON.parse(rec.action) : rec.action).wizard, "iv-iron");
  let p = await preview(pid, "iv-iron");
  assert.equal(p.answers.decision, "give");
  assert.deepEqual(p.needData.map((n: any) => n.code), ["weight"]);
  assert.deepEqual(p.needed.map((n: any) => n.id), ["checks"]);
  assert.equal(p.ready, false);
  await obs(pid, [{ code: "weight", value: 78 }]);
  await assert.rejects(tx((q) => completeWizard(q, doc, pid, "iv-iron", { answers: { decision: "give", start: "0", checks: ["no-reaction"] }, recommendationId: rec.id })), /Confirm before IV iron/);
  p = await preview(pid, "iv-iron", { checks: IRON_CHECKS.map((c) => c.value) });
  assert.equal(p.ready, true);
  const infusions = p.plan.filter((x: any) => x.kind === "plan" && /Ferinject/.test(x.label));
  assert.equal(infusions.length, 2);
  assert.match(infusions[0].label, /1000 mg IV infusion — 1 of 2/);
  assert.equal(infusions[1].dueDate, addDays(T, 7), "second dose ≥7 days later");
  await tx((q) => completeWizard(q, doc, pid, "iv-iron", { answers: p.answers, recommendationId: rec.id }));
  const plan = (await loadState(db, pid)).plan.filter((x) => x.status === "planned").map((x) => x.title);
  assert.ok(plan.some((t) => /Ferinject\) 500 mg IV infusion — 2 of 2/.test(t)));
  assert.ok(plan.some((t) => /Haemoglobin, ferritin, TSAT and phosphate/.test(t)));
});

test("renal deterioration: the plan is ready after the volume status, with the medicines kept stated", async () => {
  const pid = await newPatient(["hfpef", "t2dm", "ckd-1-2"]);
  await med(pid, "spironolactone", 25, "OD");
  await med(pid, "dapagliflozin", 10, "OD");
  await med(pid, "metformin", 500, "BID", "diabetes");
  await med(pid, "furosemide", 40, "BID");
  await obs(pid, [{ code: "creatinine", value: 90 }], at(addDays(T, -60)));
  await obs(pid, [{ code: "creatinine", value: 151 }, { code: "potassium", value: 4.4 }]);
  let p = await preview(pid, "renal-function");
  assert.deepEqual(p.needed.map((n: any) => n.id), ["volume"]);
  p = await preview(pid, "renal-function", { volume: "euvolaemic" });
  assert.equal(p.ready, true);
  assert.ok(p.plan.some((x: any) => /Metformin: hold/.test(x.label)));
  assert.ok(p.plan.some((x: any) => /Renal function and potassium check/.test(x.label)));
  assert.ok(p.medReview.some((m: any) => /Spironolactone 25 mg: keep/.test(m.title)));
  assert.ok(p.medReview.some((m: any) => /Dapagliflozin 10 mg: continue/.test(m.title)));
  p = await preview(pid, "renal-function", { volume: "dry" });
  assert.deepEqual(p.needed.map((n: any) => n.id), ["diureticDose"], "reduce the diuretic: the new dose is the clinician's");
});

test("a >50% rise on an ACE inhibitor: the guideline halves the dose", async () => {
  const pid = await newPatient(["hfref"], "Male", "1960-01-01");
  await obs(pid, [{ code: "lvef", value: 30 }, { code: "creatinine", value: 100 }, { code: "potassium", value: 4.5 }], at(addDays(T, -40)));
  await tx((q) => K.startMedication(q, doc, pid, { code: "ramipril", doseValue: 10, frequency: "OD", route: "PO", indication: "hf", effectiveAt: at(addDays(T, -30)) } as any));
  await obs(pid, [{ code: "creatinine", value: 160 }, { code: "potassium", value: 4.8 }]);
  const p = await preview(pid, "renal-function", { volume: "euvolaemic" });
  assert.ok((p.answers.actions as string[]).includes("reduce-raas"));
  assert.equal(String(p.answers.raasDose), "5");
  assert.ok(p.plan.some((x: any) => /Ramipril: 10 mg → 5 mg/.test(x.label)), JSON.stringify(p.plan));
});

test("metformin at eGFR 30–44 above 1000 mg a day is flagged", async () => {
  const pid = await newPatient(["t2dm"]);
  await med(pid, "metformin", 1000, "BID", "diabetes");
  await obs(pid, [{ code: "creatinine", value: 140 }]);
  const hits = safetyHits(await loadState(db, pid), "condition").filter((h) => h.row.id === "metformin-renal");
  assert.equal(hits.length, 1);
  assert.match(hits[0].row.title(hits[0].hit), /2,?000 mg\/day with eGFR \d+: maximum 1,000 mg\/day/);
});

test("other pathways: results they need, the current treatment, defaults marked as defaults", async () => {
  const pid = await newPatient(["hfref"], "Male", "1958-01-01");
  await med(pid, "furosemide", 40, "OD");
  await obs(pid, [{ code: "lvef", value: 30 }, { code: "creatinine", value: 110 }], at(addDays(T, -90)));
  const p = await preview(pid, "congestion");
  assert.deepEqual(p.needData.map((n: any) => n.code).sort(), ["creatinine", "potassium", "weight"], "results older than 30 days are asked for");
  assert.ok(p.medReview.some((m: any) => m.tone === "info" && /Current: Furosemide 40 mg OD/.test(m.title)));
  const d = await newPatient(["t2dm"]);
  await med(d, "metformin", 500, "BID", "diabetes");
  await obs(d, [{ code: "hba1c", value: 8.4 }, { code: "creatinine", value: 80 }]);
  const pd = await preview(d, "diabetes");
  assert.equal(pd.answers.control, "above", "HbA1c against the individual target");
  const r = pd.reasons.find((x: any) => x.question.startsWith("Glycaemic control"));
  assert.match(r.why, /HbA1c 8.4% above the individual target <7%/);
  const rev = pd.reasons.find((x: any) => x.source === "default");
  if (rev) assert.match(rev.why, /not a guideline timing/);
});
