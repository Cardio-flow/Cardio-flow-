// 14 Oct 2026 — gaps found by reviewing real cases (synthetic re-creations here): medicines the patient was
// already taking, case import, DOAC dose needing weight, CKD stage vs sustained eGFR, renal limits of
// rosuvastatin/atenolol, two beta-blockers, dialysis exclusions, iron deficiency without anaemia, and high
// bleeding risk after PCI.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { markPreexisting, correctMedicationEntry } from "../server/kernel/corrections.js";
import { importCase, caseSchema } from "../server/kernel/case-import.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { safetyHits } from "../server/engine/med-safety.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string, h = "09") => new Date(`${day}T${h}:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[], sex: "Male" | "Female" = "Female", birthDate = "1952-01-01") =>
  tx((q) => K.createPatient(q, doc, { name: "Case " + rnd(), mrn: "C" + rnd() + Date.now(), sex, birthDate, conditions }));
const start = (pid: string, code: string, dose: number, freq: string, day: string | null, indication = "hf") =>
  tx(async (q) => {
    const r = await K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication, effectiveAt: day ? at(day) : nowIso(), preexisting: day == null } as any);
    await reassess(q, pid, "production");
    return r as any;
  });
const obs = (pid: string, items: any[], when = nowIso()) => tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: when, items }); await reassess(q, pid, "production"); });
const recs = async (pid: string) => (await db.query(`SELECT rule_id, severity, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[];
const rec = async (pid: string, rule: string) => (await recs(pid)).find((r) => r.rule_id === rule);
const ids = async (pid: string) => (await db.query(`SELECT id, drug FROM cf.medication WHERE patient_id=$1`, [pid])).rows as any[];
const hitIds = async (pid: string, kind: "condition" | "interaction") => safetyHits(await loadState(db, pid), kind).map((h) => h.row.id);

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("a medicine recorded as already taking has no start date, no post-start checks and no titration wait", async () => {
  const pid = await newPatient(["hfref"]);
  await start(pid, "spironolactone", 25, "OD", null);
  const s = await loadState(db, pid);
  const m = s.meds.find((x) => x.code === "spironolactone")!;
  assert.equal(m.startedAt, null, "start date not recorded");
  assert.equal((m as any).preexisting, true);
  assert.equal(await rec(pid, "ops.monitoring"), undefined, "no post-start potassium/creatinine card");
});

test("medicines entered as started today can be corrected to already taking", async () => {
  const pid = await newPatient(["hfref"]);
  await start(pid, "bisoprolol", 5, "OD", T);
  const [m] = await ids(pid);
  assert.ok((await loadState(db, pid)).meds[0].startedAt, "a start before correction");
  await tx((q) => markPreexisting(q, doc, pid, m.id));
  assert.equal((await loadState(db, pid)).meds[0].startedAt, null);
  await assert.rejects(tx((q) => markPreexisting(q, doc, pid, "00000000-0000-0000-0000-000000000000")));
});

test("a case file imports the whole record in one step and rejects unknown codes before writing", async () => {
  const c = caseSchema.parse({
    format: "cardioflow-case/1", sample: true,
    patient: { name: "Import Test", mrn: "IMP" + rnd(), sex: "Female", age: 70 },
    conditions: [{ code: "af" }, { code: "htn" }],
    results: [{ date: addDays(T, -10), items: [{ code: "creatinine", value: 90 }, { code: "haemoglobin", value: 11.2 }] }],
    medications: [{ code: "apixaban", doseValue: 5, frequency: "BID", indication: "af", since: null }],
    note: "Referral letter summary",
  });
  const id = await tx(async (q) => { const id = await importCase(q, doc, c); await reassess(q, id, "production"); return id; });
  const s = await loadState(db, id);
  assert.equal(s.patient.birth_date?.slice(5, 10) ?? "07-01", "07-01", "age gives an estimated birth date");
  assert.ok(s.tags.has("af"));
  assert.equal(s.resolved("creatinine").current?.value_num, 90);
  assert.equal(s.meds[0].startedAt, null, "since: null → already taking");
  const bad = caseSchema.parse({ ...c, patient: { ...c.patient, mrn: "IMP" + rnd() }, medications: [{ code: "no-such-drug", doseValue: 1, frequency: "OD" }] });
  await assert.rejects(tx((q) => importCase(q, doc, bad)), /Unknown medicine: no-such-drug/);
});

test("AF on a DOAC without a weight asks for it to check the dose", async () => {
  const pid = await newPatient(["af"]);
  await obs(pid, [{ code: "creatinine", value: 95 }]);
  await start(pid, "apixaban", 5, "BID", null, "af");
  const r = await rec(pid, "af.doac-dose");
  assert.ok(r && /Apixaban: dose check incomplete — Weight needed/.test(r.title), r?.title);
  await obs(pid, [{ code: "weight", value: 72 }]);
  assert.ok(!(await rec(pid, "af.doac-dose")) || !/needed to check/.test((await rec(pid, "af.doac-dose")).title));
});

test("CKD stage: a recent fall asks to review chronicity; a category sustained over 3 months asks to change or add the stage", async () => {
  const pid = await newPatient(["hfpef", "ckd-1-2"]);
  await obs(pid, [{ code: "creatinine", value: 75 }], at(addDays(T, -200)));
  await obs(pid, [{ code: "creatinine", value: 150 }]);
  assert.match((await rec(pid, "cardiorenal.stage-review")).title, /review chronicity/);
  const p2 = await newPatient(["hfpef", "ckd-1-2"]);
  await obs(p2, [{ code: "creatinine", value: 130 }], at(addDays(T, -120)));
  await obs(p2, [{ code: "creatinine", value: 132 }]);
  assert.match((await rec(p2, "cardiorenal.stage-review")).title, /for over 3 months: CKD stage is CKD 3b/);
  const p3 = await newPatient(["hfpef"]);
  await obs(p3, [{ code: "creatinine", value: 130 }], at(addDays(T, -120)));
  await obs(p3, [{ code: "creatinine", value: 132 }]);
  assert.match((await rec(p3, "cardiorenal.ckd-stage")).title, /add CKD 3b to the problem list/);
});

test("rosuvastatin and atenolol renal limits; two beta-blockers together", async () => {
  const pid = await newPatient(["htn", "dialysis", "ckd-5"]);
  await start(pid, "atenolol", 50, "OD", null, "hypertension");
  await start(pid, "bisoprolol", 2.5, "OD", null, "hypertension");
  await start(pid, "rosuvastatin", 10, "OD", null, "lipids");
  const cond = await hitIds(pid, "condition"), inter = await hitIds(pid, "interaction");
  assert.ok(cond.includes("atenolol-renal"), "atenolol on dialysis");
  assert.ok(cond.includes("rosuvastatin-renal"), "rosuvastatin with severe renal impairment");
  assert.ok(inter.includes("duplicate-beta-blocker"), "two beta-blockers");
});

test("dialysis: no statin start without ASCVD, and no UACR screening", async () => {
  const pid = await newPatient(["dialysis", "ckd-5", "t2dm"]);
  await obs(pid, [{ code: "ldl-c", value: 3.4 }, { code: "creatinine", value: 700 }]);
  assert.equal(await rec(pid, "lipids.ldl-goal"), undefined);
  assert.equal(await rec(pid, "cardiorenal.screening"), undefined);
});

test("iron deficiency without anaemia (ferritin <15, normal Hb, no HF) asks for a cause and replacement", async () => {
  const pid = await newPatient(["cad-ccs"]);
  await obs(pid, [{ code: "ferritin", value: 9.4 }, { code: "haemoglobin", value: 12.8 }]);
  const r = await rec(pid, "lab.iron-deficiency");
  assert.ok(r && /Iron deficiency: ferritin 9.4/.test(r.title), r?.title);
  const anaemic = await newPatient(["cad-ccs"]);
  await obs(anaemic, [{ code: "ferritin", value: 9.4 }, { code: "haemoglobin", value: 9.8 }]);
  assert.equal(await rec(anaemic, "lab.iron-deficiency"), undefined, "with anaemia the anaemia review covers it");
  await start(pid, "haem-iron", 18, "OD", null, "Confirmed iron deficiency");
  assert.match((await rec(pid, "lab.iron-deficiency")).title, /on haem \+ non-haem iron: .*check the cause and the response/);
});

test("after PCI with previous major bleeding: the plan states high bleeding risk and the PPI card is orange", async () => {
  const pid = await newPatient(["cad-ccs", "prior-bleeding"]);
  await tx((q) => K.recordProcedure(q, doc, pid, { kind: "pci", date: at(addDays(T, -30)), details: { setting: "elective", vessels: ["RCA"], devices: ["Drug-eluting stent"], stents: 2, access: "Radial" } }));
  await start(pid, "aspirin", 100, "OD", addDays(T, -30), "cad");
  await start(pid, "clopidogrel", 75, "OD", addDays(T, -30), "cad");
  const plan = await rec(pid, "cad.antithrombotic-plan");
  assert.ok(plan && /high bleeding risk/.test(plan.title), plan?.title);
  const ppi = await rec(pid, "cad.ppi-combined-antithrombotic");
  assert.ok(ppi && ppi.severity === "orange", JSON.stringify(ppi));
});

test("echo records LA/RA size, diastolic function grade and wall motion as reported", async () => {
  const pid = await newPatient(["hfpef"]);
  const r = await tx((q) => K.recordEcho(q, doc, pid, {
    date: nowIso(), quality: "formal", lvef: 55, findings: [],
    chambers: { la: "Moderate", ra: "Mild", diastolic: "Grade II" },
    rwma: { inferior: { motion: "Hypokinetic", level: "Basal" } },
  }));
  const row = (await db.query(`SELECT findings, attributes FROM cf.study WHERE id=$1`, [r.id])).rows[0] as any;
  const attrs = typeof row.attributes === "string" ? JSON.parse(row.attributes) : row.attributes;
  for (const f of ["Moderately dilated LA", "Mildly dilated RA", "Grade II diastolic dysfunction", "Regional wall motion abnormality", "Hypokinetic: basal inferior"]) assert.ok(row.findings.includes(f), f);
  assert.deepEqual(attrs.chambers, { la: "Moderate", ra: "Mild", diastolic: "Grade II" });
});

test("a medicine recorded without a dose can have its dose added", async () => {
  const pid = await newPatient(["cad-ccs"]);
  const { medicationId } = await start(pid, "aspirin", null as any, "OD", null, "cad");
  assert.equal((await loadState(db, pid)).meds[0].doseValue, null);
  await tx((q) => correctMedicationEntry(q, doc, pid, medicationId, { doseValue: 100, reason: "Dose added" }));
  const m = (await loadState(db, pid)).meds[0];
  assert.equal(m.doseValue, 100);
  assert.equal(m.status, "active");
  assert.equal(m.startedAt, null, "still already taking");
  await assert.rejects(tx((q) => correctMedicationEntry(q, doc, pid, medicationId, { doseValue: 7 })), /choose a listed dose/);
});
