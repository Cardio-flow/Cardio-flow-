// Cardiomyopathy module, slice 1: diagnoses with genetics, the measurements risk assessment reads,
// the cardiomyopathy panel, and the ESC 2023 work-up rules (CMR, genetic testing, ECG/echo every
// 1–2 years, LVOT gradient in HCM, ICD after cardiac arrest or sustained VT/VF).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { summary } from "../server/kernel/views.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T10:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const byName = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;
const rec = async (pid: string, rule: string) =>
  ((await db.query(`SELECT id, severity, title, action, rule_status FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2 ORDER BY title`, [pid, rule])).rows as any[]);
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

test("Reem (HCM, family SCD, resting LVOT only): CMR, genetic testing and provoked LVOT findings, all published; the panel shows genetics, measurements and studies", async () => {
  const pid = await byName("Reem Al-Otaibi");
  const cmr = (await rec(pid, "cmp.cmr-baseline"))[0];
  assert.equal(cmr.severity, "yellow");
  assert.equal(cmr.title, "Hypertrophic cardiomyopathy: no cardiac MRI on record");
  assert.equal(cmr.rule_status, "PUBLISHED");
  assert.equal(cmr.action.template, "cmr");
  assert.match((await rec(pid, "cmp.genetic-testing"))[0].title, /genetic testing not recorded/);
  assert.equal((await rec(pid, "cmp.hcm-lvot"))[0].title, "HCM: LVOT gradient provoked (Valsalva / standing) not recorded");
  assert.equal((await rec(pid, "cmp.follow-up")).length, 0, "ECG and echo 20 days ago");
  const v = (await tx((q) => summary(q, pid, "sandbox")) as any).cmp;
  assert.equal(v.conditions[0].title, "Hypertrophic cardiomyopathy");
  assert.equal(v.familySCD, "Yes");
  assert.deepEqual(v.values.map((x: any) => x.code), ["lvef", "mwt", "la-diam", "lvot-rest"]);
  assert.equal(v.cmr, null);
});

test("recording a CMR, a genetic result and a provoked gradient clears the work-up; symptomatic with <50 mmHg → exercise echo (I B)", async () => {
  const pid = await byName("Reem Al-Otaibi");
  await tx((q) => K.recordStudy(q, doc, pid, { kind: "cmr", date: at(addDays(T, -1)), findings: { lvef: 70, mwt: 25, lge: "Non-ischaemic pattern", lgePattern: ["Mid-wall"], lgeExtent: 8, impression: "Hypertrophic cardiomyopathy" } }));
  const s0 = await loadState(db, pid);
  const c = s0.conditions.find((x) => x.code === "hcm")!;
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: at(T), answers: [], update: [{ logicalId: c.logical_id, attributes: { form: "Non-obstructive", genetic: "P/LP variant", gene: "MYBPC3" } }] }));
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 68, findings: [], measures: { "lvot-rest": 28, "lvot-provoked": 42 } }));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "cmp.cmr-baseline")).length, 0);
  assert.equal((await rec(pid, "cmp.genetic-testing")).length, 0);
  const ex = await rec(pid, "cmp.hcm-lvot");
  assert.equal(ex.length, 1);
  assert.equal(ex[0].title, "Symptomatic HCM (NYHA II) with LVOT gradient 42 mmHg: exercise echo");
  const s = await loadState(db, pid);
  assert.equal(s.resolved("lge-extent").current!.value_num, 8);
  assert.equal(s.resolved("mwt").current!.value_num, 25, "the CMR wall thickness is the latest");
  const v = (await tx((q) => summary(q, pid, "sandbox")) as any).cmp;
  assert.equal(v.conditions[0].gene, "MYBPC3");
});

test("DCM: no ECG/echo in 2 years → follow-up due (I C); a VT / VF admission without an ICD → ICD for secondary prevention (orange, I B); AL amyloid is not asked for genetic testing", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Dcm " + Date.now(), mrn: "DC" + Date.now(), sex: "Male", birthDate: "1972-01-01", conditions: ["dcm"] }));
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(addDays(T, -800)), quality: "formal", lvef: 32, findings: [] }));
  await tx((q) => reassess(q, pid, "sandbox"));
  assert.equal((await rec(pid, "cmp.follow-up"))[0].title, "Dilated cardiomyopathy: ECG and echo due (every 1–2 years)");
  await tx((q) => K.startAdmission(q, doc, pid, { startedAt: at(T), location: "CCU", reasons: ["VT / VF"], route: "Emergency department", symptoms: ["Syncope / presyncope"] }));
  await tx((q) => reassess(q, pid, "sandbox"));
  const icd = (await rec(pid, "cmp.icd-secondary"))[0];
  assert.equal(icd.severity, "orange");
  assert.equal(icd.title, "Dilated cardiomyopathy with sustained VT / VF: ICD for secondary prevention");
  assert.equal(icd.action.template, "icd-referral");

  const al = await tx((q) => K.createPatient(q, doc, { name: "Al " + Date.now(), mrn: "AL" + Date.now(), sex: "Male", birthDate: "1950-01-01", conditions: ["amyloid"] }));
  const am = (await loadState(db, al)).conditions.find((c) => c.code === "amyloid")!;
  await tx((q) => reassess(q, al, "sandbox"));
  assert.equal((await rec(al, "cmp.genetic-testing")).length, 1, "not yet typed: genetic testing asked");
  await tx((q) => K.recordHistory(q, doc, al, { effectiveAt: at(T), answers: [], update: [{ logicalId: am.logical_id, attributes: { type: "AL" } }] }));
  await tx((q) => reassess(q, al, "sandbox"));
  assert.equal((await rec(al, "cmp.genetic-testing")).length, 0, "AL amyloidosis is not inherited");
});

// ---- slice 2: HCM sudden death risk, LVOT obstruction, AF ----
import { hcmRiskScd } from "../shared/cmp.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { suggest } from "../shared/wizard-guidance.js";
const run = (pid: string, wizard: string, answers: any, recommendationId?: string) =>
  tx((q) => completeWizard(q, doc, pid, wizard, { answers, recommendationId } as any));

test("HCM Risk-SCD: the published equation (worked example), bands, missing inputs, under 16", () => {
  // MWT 24, LA 46, LVOT 30, FHx yes, no NSVT, no syncope, age 34 → PI 3.3025 → 1 − 0.998^e^PI = 5.3%
  const r = hcmRiskScd({ age: 34, mwt: 24, la: 46, lvot: 30, fhx: true, nsvt: false, syncope: false });
  assert.equal(r.risk, 5.3);
  assert.equal(r.band, "intermediate");
  assert.equal(hcmRiskScd({ age: 20, mwt: 30, la: 50, lvot: 80, fhx: true, nsvt: true, syncope: true }).band, "high");
  assert.equal(hcmRiskScd({ age: 60, mwt: 16, la: 38, lvot: 5, fhx: false, nsvt: false, syncope: false }).band, "low");
  assert.deepEqual(hcmRiskScd({ age: 40, mwt: 20, la: null, lvot: 10, fhx: false, nsvt: null, syncope: false }).missing, ["LA diameter", "NSVT on ambulatory ECG"]);
  assert.equal(hcmRiskScd({ age: 14, mwt: 20, la: 40, lvot: 10, fhx: false, nsvt: false, syncope: false }).risk, null);
});

test("HCM SCD pathway on a fresh HCM patient: estimate offered (orange at 4–6%), pathway computes the risk, suggests the ICD options by band and plans the reassessment", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Hcm Scd " + Date.now(), mrn: "HS" + Date.now(), sex: "Female", birthDate: addDays(T, -(34 * 365 + 90)), conditions: ["hcm"] }));
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: at(T), answers: [{ item: "fhx-scd", answer: "yes" }] }));
  await tx((q) => K.recordStudy(q, doc, pid, { kind: "holter", date: at(T), findings: { duration: "48 h", rhythm: "Sinus rhythm", nsvt: "No" } }));
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 66, findings: [], measures: { mwt: 24, "la-diam": 46, "lvot-rest": 30 } }));
  await tx((q) => reassess(q, pid, "sandbox"));
  const f = (await rec(pid, "cmp.hcm-scd-risk"))[0];
  assert.equal(f.severity, "orange");
  assert.equal(f.title, "HCM: estimated 5-year sudden death risk 5.3% (no syncope assumed): confirm and decide on an ICD");
  assert.equal(f.rule_status, "PUBLISHED");
  const w = await tx((q) => getWizard(q, pid, "hcm-scd"));
  assert.deepEqual(w.context.detected.nsvt, ["no"]);
  const a = { fhx: "yes", nsvt: "no", syncope: "no" };
  assert.deepEqual(suggest("hcm-scd", "decision", a, w.context).map((x) => x.value), ["icd", "discuss"]);
  assert.match(suggest("hcm-scd", "decision", a, w.context)[0].why, /IIb B/);
  const done = await run(pid, "hcm-scd", { ...a, decision: "discuss", tests: ["cmr"], review: "none" }, f.id);
  assert.ok(done.assessment!.rows.some((r: any) => r.value === "5.3% (HCM Risk-SCD)"));
  assert.ok(done.assessment!.recommendations.some((x: string) => /4 to <6%: an ICD may be considered \(IIb B\)/.test(x)));
  const s = await loadState(db, pid);
  assert.ok(s.plan.some((p) => p.title === "HCM: ICD discussion (shared decision-making)"));
  assert.equal((await rec(pid, "cmp.hcm-scd-risk")).length, 0);
  // syncope raises it above 6%: the pathway suggests the ICD alone (IIa B)
  assert.deepEqual(suggest("hcm-scd", "decision", { ...a, syncope: "yes" }, w.context).map((x) => x.value), ["icd"]);
});

test("obstructive HCM ≥50 mmHg with NYHA III: offered; beta-blocker at maximum dose → mavacamten and septal reduction suggested; AF with HCM and no anticoagulant → orange", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Hocm " + Date.now(), mrn: "HO" + Date.now(), sex: "Male", birthDate: "1968-01-01", conditions: ["hcm", "af"] }));
  await tx((q) => K.startMedication(q, doc, pid, { code: "bisoprolol", doseValue: 10, frequency: "OD", route: "PO", indication: "hcm", effectiveAt: at(addDays(T, -90)) }));
  await tx((q) => K.recordEcho(q, doc, pid, { date: at(T), quality: "formal", lvef: 70, findings: ["Systolic anterior motion (SAM)"], measures: { mwt: 21, "la-diam": 48, "lvot-rest": 64, "lvot-provoked": 90 } }));
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: at(T), items: [{ code: "nyha", text: "III" }] }));
  await tx((q) => reassess(q, pid, "sandbox"));
  const o = (await rec(pid, "cmp.hcm-lvoto"))[0];
  assert.equal(o.title, "Obstructive HCM: LVOT gradient 90 mmHg with NYHA III");
  assert.equal((await rec(pid, "cmp.hcm-af-oac"))[0].severity, "orange");
  const ctx = (await tx((q) => getWizard(q, pid, "hcm-lvoto"))).context;
  assert.deepEqual(ctx.detected.therapy, ["bb"]);
  assert.deepEqual(suggest("hcm-lvoto", "nyha", {}, ctx).map((x) => x.value), ["III-IV"]);
  assert.deepEqual(suggest("hcm-lvoto", "actions", { nyha: "III-IV", therapy: ["bb", "bb-max"] }, ctx).map((x) => x.value), ["myosin", "srt"]);
  const done = await run(pid, "hcm-lvoto", { nyha: "III-IV", therapy: ["bb", "bb-max"], actions: ["srt"], review: "clinic-28" }, o.id);
  assert.ok(done.assessment!.recommendations.some((x: string) => /septal reduction therapy \(I B\)/.test(x)));
  assert.ok((await loadState(db, pid)).plan.some((p) => /^Septal reduction therapy/.test(p.title)));
  assert.equal((await rec(pid, "cmp.hcm-lvoto")).length, 0);
});
