// Regression tests for the 7 Oct 2026 defect review: corrections that undo their side effects, no duplicate
// plan items or diagnoses, CCS test grading, PAD antiplatelet, INR range for a mechanical valve.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import * as C from "../server/kernel/corrections.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { ccsTestRisk, ruleOutCapable } from "../shared/ccs-tests.js";
import { GUIDANCE } from "../shared/wizard-guidance.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[] = []) =>
  tx((q) => K.createPatient(q, doc, { name: "Dx " + rnd(), mrn: "D" + rnd() + Date.now(), sex: "Male", birthDate: "1958-03-02", conditions }));
const activeCodes = async (pid: string) => (await loadState(db, pid)).conditions.filter((c) => c.status === "active").map((c) => c.code);
const plan = async (pid: string) => (await db.query(`SELECT id, title, status, due_date FROM cf.plan_action WHERE patient_id=$1`, [pid])).rows as any[];

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("a PCI entered in error also takes 'prior PCI' off the problem list", async () => {
  const pid = await newPatient(["cad-ccs"]);
  const r: any = await tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, -3)), details: { setting: "elective", vessels: ["LAD"], devices: ["Drug-eluting stent"], stents: 1, access: "Radial" } }));
  assert.ok((await activeCodes(pid)).includes("prior-pci"));
  const procId = r?.id ?? ((await db.query(`SELECT id FROM cf.procedure WHERE patient_id=$1`, [pid])).rows[0] as any).id;
  await tx((q) => C.voidProcedure(q, doc, pid, procId, "wrong patient"));
  assert.ok(!(await activeCodes(pid)).includes("prior-pci"), "prior-pci removed with the procedure");
  assert.ok((await activeCodes(pid)).includes("cad-ccs"), "the diagnosis entered by the clinician stays");
});

test("a study entered in error reopens the plan item it had completed", async () => {
  const pid = await newPatient(["cad-ccs"]);
  await tx((q) => K.addPlanAction(q, doc, pid, { category: "investigation", title: "12-lead ECG", dueDate: addDays(T, 2), completesOn: { type: "study", kind: "ecg" } }));
  await tx((q) => K.recordStudy(q, doc, pid, { kind: "ecg", date: new Date().toISOString(), findings: { rhythm: "Sinus rhythm", qrs: 90, qrsMorphology: "Normal" } }));
  assert.equal((await plan(pid)).find((p) => p.title === "12-lead ECG").status, "completed");
  const sid = ((await db.query(`SELECT id FROM cf.study WHERE patient_id=$1 AND kind='ecg'`, [pid])).rows[0] as any).id;
  await tx((q) => C.voidStudy(q, doc, pid, sid, "wrong patient"));
  assert.equal((await plan(pid)).find((p) => p.title === "12-lead ECG").status, "planned");
});

test("the same plan item on the same day is not created twice", async () => {
  const pid = await newPatient();
  const item = { category: "monitoring", title: "Renal function and potassium check", dueDate: addDays(T, 7), completesOn: { type: "lab", codes: ["potassium"] } };
  await tx((q) => K.addPlanAction(q, doc, pid, item));
  await tx((q) => K.addPlanAction(q, doc, pid, item));
  assert.equal((await plan(pid)).filter((p) => p.title === item.title && p.status === "planned").length, 1);
});

test("changing a diagnosis to one already on the list is refused (no duplicate CKD stage)", async () => {
  const pid = await newPatient(["ckd-3a", "htn"]);
  const s = await loadState(db, pid);
  const htn = s.conditions.find((c) => c.code === "htn")!;
  await assert.rejects(tx((q) => K.changeCondition(q, doc, pid, htn.logical_id, { code: "ckd-3a", mode: "changed" })), /already on the list/);
  const ckd = s.conditions.find((c) => c.code === "ckd-3a")!;
  await tx((q) => K.changeCondition(q, doc, pid, ckd.logical_id, { code: "ckd-3b", mode: "changed" }));
  const codes = await activeCodes(pid);
  assert.ok(codes.includes("ckd-3b") && !codes.includes("ckd-3a"));
});

test("CCS test grading: scar is positive, two-vessel disease with proximal LAD is high risk, exercise ECG cannot rule out", () => {
  assert.equal(ccsTestRisk("nuclear", { result: "Fixed defect (scar)" })?.risk, "positive");
  assert.equal(ccsTestRisk("nuclear", { result: "Reversible defect (ischaemia)", ischaemia: 12 })?.risk, "high");
  assert.equal(ccsTestRisk("ccta", { cadrads: "4A", vessels: ["LAD", "LCx"], twoVesselProxLad: "Yes" })?.risk, "high");
  assert.equal(ccsTestRisk("ccta", { cadrads: "4A", vessels: ["RCA"], twoVesselProxLad: "No" })?.risk, "positive");
  assert.equal(ruleOutCapable("stress", { modality: "Exercise ECG" }), false);
  assert.equal(ruleOutCapable("ccta", {}), true);
});

test("PAD without an antiplatelet is flagged; aspirin clears it", async () => {
  const pid = await newPatient(["pad"]);
  await tx((q) => reassess(q, pid, "sandbox"));
  const r = (await db.query(`SELECT rule_id, title FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[];
  assert.ok(r.some((x) => /Peripheral arterial disease without antiplatelet/.test(x.title)), "PAD antiplatelet prompt");
  await tx(async (q) => {
    await K.startMedication(q, doc, pid, { code: "aspirin", doseValue: 100, frequency: "OD", route: "PO", indication: "pad", effectiveAt: at(T) });
    await reassess(q, pid, "sandbox");
  });
  const r2 = (await db.query(`SELECT title FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[];
  assert.ok(!r2.some((x) => /Peripheral arterial disease without antiplatelet/.test(x.title)));
});

test("INR pathway: a mechanical valve's own range decides low/high (2.4 is low for a 2.5–3.5 range, in range otherwise)", () => {
  const dir = (inr: number, inrTarget: string | null) =>
    GUIDANCE.inr.direction({}, { values: { inr: { value: inr } }, valve: { inrTarget }, meds: [], dx: [] } as any).filter(Boolean).map((x: any) => x.value);
  assert.deepEqual(dir(2.4, "3.0 (2.5–3.5)"), ["low"]);
  assert.deepEqual(dir(2.4, null), []);
  assert.deepEqual(dir(3.3, "3.0 (2.5–3.5)"), []);
  assert.deepEqual(dir(3.3, null), ["high"]);
});

test("taking back a stop brings back the medicine's titration review; a result entered in error reopens its check", async () => {
  const pid = await newPatient(["hfref"]);
  const r: any = await tx((q) => K.startMedication(q, doc, pid, { code: "bisoprolol", doseValue: 1.25, frequency: "OD", route: "PO", indication: "hfref", effectiveAt: new Date(Date.now() - 60_000).toISOString() }));
  const medId = r?.medicationId ?? ((await db.query(`SELECT id FROM cf.medication WHERE patient_id=$1`, [pid])).rows[0] as any).id;
  await tx((q) => K.addPlanAction(q, doc, pid, { category: "medication", title: "Bisoprolol titration review", dueDate: addDays(T, 14), medicationId: medId } as any));
  await tx((q) => K.medicationEvent(q, doc, pid, medId, { kind: "stop", reason: "test", effectiveAt: new Date().toISOString() }));
  assert.equal((await plan(pid)).find((p) => p.title === "Bisoprolol titration review").status, "cancelled");
  await tx((q) => C.undoLastMedicationChange(q, doc, pid, medId, "wrong patient"));
  assert.equal((await plan(pid)).find((p) => p.title === "Bisoprolol titration review").status, "planned");

  await tx((q) => K.addPlanAction(q, doc, pid, { category: "monitoring", title: "Potassium check", dueDate: T, completesOn: { type: "lab", codes: ["potassium"] } }));
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: new Date().toISOString(), items: [{ code: "potassium", value: 4.6 } as any] }));
  assert.equal((await plan(pid)).find((p) => p.title === "Potassium check").status, "completed");
  const k = ((await db.query(`SELECT id FROM cf.observation WHERE patient_id=$1 AND code='potassium'`, [pid])).rows[0] as any).id;
  await tx((q) => K.correctObservation(q, doc, pid, k, { enteredInError: true }));
  assert.equal((await plan(pid)).find((p) => p.title === "Potassium check").status, "planned");
});
