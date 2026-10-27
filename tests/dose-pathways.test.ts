// 27 Oct 2026 — dose engines inside the pathways: HF medicines (start and titrate), lipids, the DOAC label dose
// in AF-CARE; one source of starting doses for alerts and pathways; missing results asked for; the pre-start
// medicine check shown in the decision before Confirm.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { previewDecision } from "../server/engine/decide.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { finerenoneStart, sglt2Start, spironolactoneStart } from "../shared/start-doses.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

const patient = (conditions: string[], sex: "Male" | "Female" = "Male") =>
  tx((q) => K.createPatient(q, doc, { name: "Dose " + rnd(), mrn: "DP" + rnd() + Date.now(), sex, birthDate: "1958-01-01", conditions }));
const med = (pid: string, code: string, dose: number, freq: string, days = -60, indication = "hf") =>
  tx((q) => K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication, effectiveAt: at(addDays(T, days)), alreadyTaking: true } as any));
const obs = (pid: string, items: any[], day = T) => tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: at(day), items }); await reassess(q, pid, "production"); });
const recs = async (pid: string) => ((await db.query(`SELECT rule_id, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[]).map((r) => ({ ...r, action: typeof r.action === "string" ? JSON.parse(r.action) : r.action }));

test("one source of starting doses: alerts and pathways give the same drug and dose", () => {
  assert.deepEqual([sglt2Start(45), sglt2Start(22), sglt2Start(18)].map((d) => (typeof d === "string" ? "no" : `${d.code} ${d.dose}`)), ["dapagliflozin 10", "empagliflozin 10", "no"]);
  assert.deepEqual([spironolactoneStart(70), spironolactoneStart(47), spironolactoneStart(29)].map((d) => (typeof d === "string" ? "no" : d.dose)), [25, 12.5, "no"]);
  assert.deepEqual([finerenoneStart(70), finerenoneStart(40), finerenoneStart(24)].map((d) => (typeof d === "string" ? "no" : d.dose)), [20, 10, "no"]);
});

test("HFrEF: the HF medicines pathway proposes every safe start and next dose step, books the label checks, and records it", async () => {
  const pid = await patient(["hfref"]);
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(addDays(T, -20)), quality: "formal", lvef: 30, findings: [] }));
  await med(pid, "sacubitril-valsartan", 49, "BID");
  await med(pid, "bisoprolol", 2.5, "OD");
  await obs(pid, [{ code: "potassium", value: 4.4 }, { code: "creatinine", value: 95 }, { code: "sbp", value: 118 }, { code: "hr", value: 72 }]);
  const alerts = (await recs(pid)).filter((r) => r.rule_id.startsWith("hf.foundational") || r.rule_id === "hf.titration");
  assert.ok(alerts.length >= 3, alerts.map((a) => a.title).join(" | "));
  assert.ok(alerts.every((a) => a.action.type === "wizard" && a.action.wizard === "hf-medicines"), "every HF start / titration alert opens the pathway");
  const p = await tx((q) => previewDecision(q, pid, "hf-medicines"));
  assert.equal(p.ready, true);
  const meds = p.plan.filter((x: any) => x.kind === "start" || x.kind === "medication").map((x: any) => x.label.split(" — ")[0]).sort();
  assert.deepEqual(meds, ["Bisoprolol: 2.5 mg → 3.75 mg", "Dapagliflozin 10 mg OD: start", "Sacubitril/valsartan: 49/51 mg → 97/103 mg", "Spironolactone 25 mg OD: start"]);
  const plans = p.plan.filter((x: any) => x.kind === "plan").map((x: any) => `${x.title} ${x.dueDate}`);
  assert.ok(plans.includes(`Potassium and creatinine 1 week after the HF medicine change ${addDays(T, 7)}`), plans.join(" | "));
  assert.ok(plans.includes(`Potassium and creatinine 2 weeks after the HF medicine change ${addDays(T, 14)}`));
  assert.ok(plans.includes(`HF medicines titration visit ${addDays(T, 14)}`));
  // the clinician takes two of the four changes
  await tx((q) => completeWizard(q, doc, pid, "hf-medicines", { answers: { ...p.answers, changes: ["increase-bb", "start-sglt2"] }, evidenceKey: p.evidenceKey }));
  const s = await loadState(db, pid);
  assert.equal(s.meds.find((m) => m.code === "bisoprolol" && m.status === "active")?.doseValue, 3.75);
  assert.equal(s.meds.find((m) => m.code === "dapagliflozin")?.doseValue, 10);
  assert.equal(s.meds.find((m) => m.code === "sacubitril-valsartan")?.doseValue, 49, "not ticked: unchanged");
  assert.ok(!s.meds.some((m) => m.code === "spironolactone"));
});

test("HF medicines: a missing potassium is asked for, never assumed; a high potassium blocks RAAS/MRA with its reason", async () => {
  const pid = await patient(["hfref"]);
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(addDays(T, -20)), quality: "formal", lvef: 30, findings: [] }));
  await med(pid, "bisoprolol", 5, "OD");
  await obs(pid, [{ code: "creatinine", value: 95 }, { code: "sbp", value: 118 }, { code: "hr", value: 70 }]);
  let ctx = (await tx((q) => getWizard(q, pid, "hf-medicines"))).context;
  const raas = ctx.hfMeds!.items.find((i) => i.key === "raas")!;
  assert.equal(raas.state, "needs");
  assert.ok(raas.needs.includes("potassium"));
  await obs(pid, [{ code: "potassium", value: 5.4 }]);
  ctx = (await tx((q) => getWizard(q, pid, "hf-medicines"))).context;
  const after = Object.fromEntries(ctx.hfMeds!.items.map((i) => [i.key, `${i.state}: ${i.why}`]));
  assert.match(after.raas, /^blocked: Not now: K 5\.4 > 5\.0/);
  assert.match(after.mra, /^blocked: Not now: K 5\.4 > 5\.0/);
  assert.match(after.bb, /^increase/);
});

test("lipids: the LDL-C alert opens the lipids pathway; the statin rises to high intensity with the LDL-C recheck booked", async () => {
  const pid = await patient(["cad-ccs"]);
  await med(pid, "atorvastatin", 20, "OD", -120, "cad");
  await obs(pid, [{ code: "ldl-c", value: 2.6 }, { code: "creatinine", value: 80 }]);
  const a = (await recs(pid)).find((r) => r.rule_id === "lipids.ldl-goal")!;
  assert.deepEqual([a.action.type, a.action.wizard, a.action.direction], ["wizard", "lipids", "increase"]);
  const p = await tx((q) => previewDecision(q, pid, "lipids"));
  assert.equal(p.answers.step, "intensify");
  assert.ok(p.plan.some((x: any) => /^Atorvastatin: 20 mg → 40 mg/.test(x.label)));
  assert.ok(p.plan.some((x: any) => x.title === "LDL-C after the lipid-lowering change" && x.dueDate === addDays(T, 42)));
});

test("a pathway start the medicine check stops is a blocker in the decision, before Confirm", async () => {
  const pid = await patient(["cad-ccs", "t2dm"]);
  await med(pid, "clarithromycin", 500, "BID", -1, "infection");
  await obs(pid, [{ code: "potassium", value: 4.3 }, { code: "creatinine", value: 85 }]);
  const p = await tx((q) => previewDecision(q, pid, "acs-discharge", { type: "nstemi", revasc: "complete", lvef: "le40", start: ["mra"], prevent: ["none"], followup: ["none"], review: "none" }));
  assert.equal(p.ready, false);
  assert.ok(p.blockers.some((b: string) => /^Eplerenone: .*Clarithromycin.*record why it is started anyway/.test(b)), p.blockers.join(" | "));
});

test("a pathway start that is waiting for a result asks for it as data needed", async () => {
  const pid = await patient(["cad-ccs"]);
  const p = await tx((q) => previewDecision(q, pid, "acs-discharge", { type: "nstemi", revasc: "complete", lvef: "le40", start: ["mra"], prevent: ["none"], followup: ["none"], review: "none" }));
  assert.deepEqual(p.needData.map((n: any) => n.code).sort(), ["egfr", "potassium"]);
  assert.ok(p.plan.some((x: any) => x.decision && /Record eGFR and potassium before starting eplerenone/.test(x.label)), "shown in the decision, not dropped");
});

test("pathway starts use the medicine's route (a GLP-1 RA is subcutaneous)", async () => {
  const pid = await patient(["t2dm", "cad-ccs"]);
  await obs(pid, [{ code: "hba1c", value: 7.9 }, { code: "creatinine", value: 80 }]);
  const p = await tx((q) => previewDecision(q, pid, "diabetes"));
  assert.ok(p.plan.some((x: any) => x.kind === "start" && /^Semaglutide/.test(x.label)), p.plan.map((x: any) => x.label).join(" | "));
  await tx((q) => completeWizard(q, doc, pid, "diabetes", { answers: p.answers, evidenceKey: p.evidenceKey }));
  const sema = (await loadState(db, pid)).meds.find((m) => m.code === "semaglutide")!;
  assert.equal(sema.route, "SC");
  void nowIso;
});
