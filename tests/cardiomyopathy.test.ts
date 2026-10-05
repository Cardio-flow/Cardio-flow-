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
