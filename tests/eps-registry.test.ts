// Rhythm & devices, slice 5: the EP Registry projection (MKH EPS Registry; read-only, the
// registry's own variable names, wording and SPSS codes).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { epsRegistryCohort, epsRegistryProjection, spssCode } from "../server/engine/eps-registry.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T10:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());
const stateOf = async (name: string) => loadState(db, ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id);
const fields = (p: any) => Object.fromEntries(p.sections.flatMap((s: any) => s.fields).map((f: any) => [f.key, f]));

test("SPSS codes: categories from the registry's code table, Yes/No as 1/0, numbers and dates unchanged", () => {
  assert.equal(spssCode("Reason_EPlab", "CIED Extraction"), "5");
  assert.equal(spssCode("Proc_EPS_Reason", "Atypical atrial flutter"), "6");
  assert.equal(spssCode("Hx_AFib", "Yes"), "1");
  assert.equal(spssCode("Hx_AFib", "No"), "0");
  assert.equal(spssCode("Exam_SysBPmmHg", "128"), "128");
  assert.equal(spssCode("Gender", "Unknown"), "", "a value outside the table is left blank, never guessed");
});

test("Bader (CRT-D implant): CRT/AICD block, device type, new leads, HF history, with SPSS codes", async () => {
  const p = epsRegistryProjection(await stateOf("Bader Al-Mutairi"))!;
  assert.equal(p.registry, "EP Registry");
  assert.match(p.index, /^Device .* · CRT-D · CRT for heart failure · Biventricular$/);
  const f = fields(p);
  assert.equal(f.Reason_EPlab.value, "CRT/AICD");
  assert.equal(f.Reason_EPlab.code, "1");
  assert.equal(f.Proc_CRT_DevImplant_Type.value, "CRT-D");
  assert.equal(f.Proc_CRT_LeadAssess_New.value, "Yes");
  assert.equal(f.Proc_CRT_LeadAssess_Existing.value, "No");
  assert.equal(f.Hx_HF.value, "Yes");
  assert.equal(f.Hx_HFtype.value, "HFrEF");
  assert.equal(f.Hx_MI.value, "Yes");
  assert.equal(f.Outcom_ConductSystemPacing.value, "No");
  assert.equal(f.Proc_PPM_DevImpl_Type, undefined, "the pacemaker block does not apply");
  assert.equal(f.CRF_No.mapped, false, "asked in the registry");
  assert.ok(p.csvCoded.split("\n")[0] === p.csv.split("\n")[0], "same columns in both CSVs");
});

test("Fatma (CTI ablation): EPS/Ablation reason and result; Mariam (conduction system pacing): type left for the registry, not guessed", async () => {
  const f = fields(epsRegistryProjection(await stateOf("Fatma Al-Ajmi"))!);
  assert.equal(f.Reason_EPlab.value, "EPS/Ablation");
  assert.equal(f.Proc_EPS_Reason.value, "Atrial flutter");
  assert.equal(f.Proc_EPS_Reason.code, "2");
  assert.equal(f.Proc_EPS_PersisArrythmiaInd.value, "No");
  assert.equal(f.Outcom_ImmProcedSuccess.value, "Yes");
  assert.equal(f.Hx_AFib.value, "Yes");
  assert.equal(f.Hx_AFibClass.value, "Paroxysmal (terminating spontaneously within 7 days)");
  const m = fields(epsRegistryProjection(await stateOf("Mariam Hussain"))!);
  assert.equal(m.Reason_EPlab.value, "Pacemaker");
  assert.equal(m.PacemakerType.value, "Permanent pacemaker");
  assert.equal(m.Proc_PPM_DevImpl_Type.value, null);
  assert.match(m.Proc_PPM_DevImpl_Type.note, /His-bundle PPM or LBBB PPM/);
  assert.equal(m.Outcom_ConductSystemPacing.value, "Yes");
});

test("an ablation inside an admission: origin, labs over the stay, home and discharge medicines, discharge", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Eps Test " + Date.now(), mrn: "E" + Date.now(), sex: "Female", birthDate: "1968-04-02", conditions: ["af", "htn"] }));
  await tx((q) => K.startMedication(q, doc, pid, { code: "apixaban", doseValue: 5, frequency: "BID", route: "PO", indication: "af", effectiveAt: at(addDays(T, -200)) }));
  const a = await tx((q) => K.startAdmission(q, doc, pid, { startedAt: at(addDays(T, -6)), location: "CCU", reasons: ["AF / flutter"], route: "Transfer from another hospital", symptoms: ["Palpitations"] }));
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, -6)), items: [{ code: "creatinine", value: 80 }, { code: "magnesium", value: 0.8 }, { code: "sbp", value: 128 }] }));
  await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, -4)), items: [{ code: "creatinine", value: 96 }] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "ablation", date: at(addDays(T, -5)), details: { targets: ["AF (pulmonary vein isolation)"], energy: "Pulsed field", result: "Acute success" } }));
  await tx((q) => K.startMedication(q, doc, pid, { code: "flecainide", doseValue: 100, frequency: "BID", route: "PO", indication: "af", effectiveAt: at(addDays(T, -4)) }));
  await tx((q) => K.discharge(q, doc, pid, a.id, { endedAt: at(addDays(T, -3)), status: "Rate controlled", destination: "Home", events: ["None"], plan: [] }));
  const f = fields(epsRegistryProjection(await loadState(db, pid))!);
  assert.equal(f.PatientOrigin.value, "Transferred from another hospital");
  assert.equal(f.Proc_EPS_Reason.value, "Atrial fibrillation");
  assert.equal(f.Proc_EPS_Anticoag_Uninterrupt.value, "Yes");
  assert.equal(f.Lab_CreatininInitial.value, "80");
  assert.equal(f.Lab_CreatininPeak.value, "96");
  assert.equal(f.Lab_Magnesium_Initial.value, "1.6", "mmol/L × 2 = mEq/L");
  assert.equal(f.HomMed_Apixaban.value, "Yes");
  assert.equal(f.HomMed_Flecainide.value, "No");
  assert.equal(f.DiscMed_Flecainide.value, "Yes");
  assert.equal(f.Discharge_Status.value, "Alive");
  assert.equal(f.Discharge_Type.value, "Home");
  assert.equal(f.Discharge_Type.code, "1");
  assert.equal(f.Compli_AnyBleeding.value, "No");
});

test("cohort: device and ablation patients, one row each; a loop recorder alone or no rhythm procedure is not in it", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Ilr Only " + Date.now(), mrn: "L" + Date.now(), sex: "Male", birthDate: "1970-01-01", conditions: [] }));
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "device", date: at(addDays(T, -10)), details: { type: "Implantable loop recorder", action: "New implant", indication: "Syncope / arrhythmia monitoring" } }));
  assert.equal(epsRegistryProjection(await loadState(db, pid)), null);
  const ids = ((await db.query(`SELECT id FROM cf.patient`)).rows as any[]);
  const states = [];
  for (const r of ids) states.push(await loadState(db, r.id));
  const c = epsRegistryCohort(states);
  const names = c.patients.map((p: any) => p.name);
  for (const n of ["Bader Al-Mutairi", "Fatma Al-Ajmi", "Mariam Hussain", "Abdullah Al-Enezi"]) assert.ok(names.includes(n), n);
  assert.ok(!names.includes("Noura Al-Kandari"));
  assert.ok(!names.some((n: string) => n.startsWith("Ilr Only")));
  assert.equal(c.csv.split("\n").length, c.patients.length + 1);
  assert.equal(c.csvCoded.split("\n")[0], c.csv.split("\n")[0]);
  assert.ok(c.counts.byType["CRT/AICD"] >= 1 && c.counts.byType.Pacemaker >= 2);
});

test("fields that do not apply are hidden, not reported missing: no AF → no AF sub-questions; a new implant → no existing-lead status", async () => {
  const f = fields(epsRegistryProjection(await stateOf("Bader Al-Mutairi"))!);
  assert.equal(f.Hx_AFibClass, undefined);
  assert.equal(f.Proc_CRT_Lead_ExistingStatus, undefined);
  assert.equal(f.Proc_CRTIndi_ICM.value, null, "no LVEF around the implant: unknown, not No");
  assert.equal(f.Hx_AFib.value, "No");
});
