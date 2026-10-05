// Medicine coverage, slice 3: specialist-drug safety — mavacamten starting dose from the CYP2C19 result
// (Ahmed, 5 Oct 19:56), its interactions by phenotype and the LVEF limits; label limits on transaminases;
// "do not initiate" values in the pre-start check; finerenone target by eGFR.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { preStartCheck } from "../server/engine/med-safety.js";
import { targetDose } from "../server/engine/guidelines.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { MEDICATION } from "../shared/catalog.js";
import { mavacamtenStart } from "../shared/mavacamten.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string, time = "10:00") => new Date(`${day}T${time}:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const byName = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;
const recs = async (pid: string) =>
  ((await db.query(`SELECT rule_id, severity, title, detail FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id IN ('med.interaction','med.contraindication') ORDER BY title`, [pid])).rows as any[]);
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

let n = 0;
async function patient(o: { conditions?: string[]; hcm?: string; meds?: [string, number?, string?][]; labs?: [string, number][]; lvef?: number; hr?: number }) {
  const pid = await tx((q) => K.createPatient(q, doc, { name: `Spec ${++n} ${Date.now()}`, mrn: `SP${n}${Date.now()}`, sex: "Male", birthDate: "1965-01-01", conditions: o.conditions ?? [] }));
  if (o.hcm !== undefined) await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: at(addDays(T, -100)), add: [{ code: "hcm", attributes: { form: "Obstructive", ...(o.hcm ? { cyp2c19: o.hcm } : {}) } }] }));
  if (o.lvef != null) await tx((q) => K.recordEcho(q, doc, pid, { date: at(addDays(T, -60)), quality: "formal", lvef: o.lvef!, findings: [] }));
  for (const [code, dose, freq] of o.meds ?? []) {
    const def = MEDICATION[code];
    await tx((q) => K.startMedication(q, doc, pid, { code, doseValue: dose ?? def.doses[0], frequency: freq ?? def.frequencies[0], route: def.routes[0], indication: def.indicationChoices?.[0] ?? def.indications[0] ?? "other", effectiveAt: at(addDays(T, -30)) } as any));
  }
  if (o.labs?.length) await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, -1)), items: o.labs!.map(([code, value]) => ({ code, value })) } as any));
  if (o.hr != null) await tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, -1)), items: [{ code: "hr", value: o.hr }] } as any));
  await tx((q) => reassess(q, pid, "sandbox"));
  return pid;
}

test("mavacamten starting dose from CYP2C19 (SmPC 4.2): not tested or poor → 2.5 mg (max 5); other phenotypes → 5 mg (max 15)", () => {
  assert.deepEqual([mavacamtenStart(null).dose, mavacamtenStart(null).max, mavacamtenStart(null).known], [2.5, 5, false]);
  assert.deepEqual([mavacamtenStart("Poor metaboliser").dose, mavacamtenStart("Poor metaboliser").max], [2.5, 5]);
  for (const p of ["Intermediate metaboliser", "Normal metaboliser", "Rapid metaboliser", "Ultrarapid metaboliser"]) assert.deepEqual([mavacamtenStart(p).dose, mavacamtenStart(p).max], [5, 15]);
});

test("Sara (seed; poor metaboliser on 2.5 mg with verapamil, LVEF 47% today): red interrupt only; the verapamil dose reduction is moot while interrupted", async () => {
  const f = await recs(await byName("Sara Al-Kandari"));
  assert.deepEqual(f.map((x) => [x.severity, x.title]), [
    ["red", "Mavacamten with LVEF 47%: interrupt treatment"],
  ]);
  assert.match(f[0].detail, /\(on 2\.5 mg\)/);
});

test("obstructive HCM pathway: Reem (normal metaboliser, LVEF 68%) → mavacamten 5 mg started with echo at 4 and 8 weeks; no CYP2C19 result → 2.5 mg and genotyping; LVEF 52% → not started", async () => {
  const reem = await byName("Reem Al-Otaibi");
  const w = await tx((q) => getWizard(q, reem, "hcm-lvoto"));
  assert.equal(w.context.cmp!.cyp2c19, "Normal metaboliser");
  const done = await tx((q) => completeWizard(q, doc, reem, "hcm-lvoto", { answers: { nyha: "II", therapy: ["bb"], actions: ["myosin"], review: "clinic-90" } } as any));
  assert.ok(done.assessment!.recommendations.some((x: string) => /CYP2C19 normal metaboliser: start 5 mg once daily, maximum 15 mg/.test(x)));
  let s = await loadState(db, reem);
  const m = s.meds.find((x) => x.code === "mavacamten" && x.status === "active")!;
  assert.equal(m.doseValue, 5);
  const echoes = s.plan.filter((p) => p.status === "planned" && /after starting mavacamten/.test(p.title)).map((p) => p.due_date).sort();
  assert.deepEqual(echoes, [addDays(T, 28), addDays(T, 56)]);
  assert.ok(s.plan.filter((p) => /after starting mavacamten/.test(p.title)).every((p) => p.medication_id === m.id));

  const unk = await patient({ hcm: "", lvef: 65 });
  await tx((q) => completeWizard(q, doc, unk, "hcm-lvoto", { answers: { nyha: "II", therapy: ["bb"], actions: ["myosin"], review: "clinic-90" } } as any));
  s = await loadState(db, unk);
  assert.equal(s.meds.find((x) => x.code === "mavacamten")!.doseValue, 2.5);
  assert.ok(s.plan.some((p) => p.title === "CYP2C19 genotyping (mavacamten dose)"));

  const low = await patient({ hcm: "Normal metaboliser", lvef: 52 });
  const r = await tx((q) => completeWizard(q, doc, low, "hcm-lvoto", { answers: { nyha: "II", therapy: ["bb"], actions: ["myosin"], review: "clinic-90" } } as any));
  s = await loadState(db, low);
  assert.equal(s.meds.some((x) => x.code === "mavacamten"), false);
  assert.ok(r.assessment!.recommendations.some((x: string) => /not initiated with LVEF <55%/.test(x)));
});

test("mavacamten interactions by phenotype: clarithromycin red when undetermined, yellow for a normal metaboliser; omeprazole 40 mg orange, 20 mg yellow; none in a poor metaboliser", async () => {
  const a = await patient({ hcm: "", lvef: 65, meds: [["mavacamten", 2.5], ["clarithromycin", 500]] });
  assert.ok((await recs(a)).some((x) => x.severity === "red" && x.title === "Mavacamten with Clarithromycin (strong CYP3A4 inhibitor, CYP2C19 poor or undetermined): contraindicated"));
  const b = await patient({ hcm: "Normal metaboliser", lvef: 65, meds: [["mavacamten", 5], ["clarithromycin", 500]] });
  assert.ok((await recs(b)).some((x) => x.severity === "yellow" && x.title === "Mavacamten with Clarithromycin (strong CYP3A4 inhibitor): monitor LVEF"));
  const c = await patient({ hcm: "Normal metaboliser", lvef: 65, meds: [["mavacamten", 5], ["omeprazole", 40, "OD"]] });
  assert.equal((await recs(c)).find((x) => /CYP2C19 inhibitor/.test(x.title)).severity, "orange");
  const d = await patient({ hcm: "Normal metaboliser", lvef: 65, meds: [["mavacamten", 5], ["omeprazole", 20, "OD"]] });
  assert.equal((await recs(d)).find((x) => /CYP2C19 inhibitor/.test(x.title)).severity, "yellow");
  const e = await patient({ hcm: "Poor metaboliser", lvef: 65, meds: [["mavacamten", 2.5], ["omeprazole", 40, "OD"]] });
  assert.equal((await recs(e)).filter((x) => /CYP2C19 inhibitor/.test(x.title)).length, 0);
});

test("transaminase limits on treatment (ULN 45): amiodarone >3 × orange; dronedarone confirmed on two results red; bosentan >8 × red", async () => {
  const a = await patient({ meds: [["amiodarone", 200]], labs: [["alt", 150]] });
  assert.equal((await recs(a))[0].severity, "orange");
  assert.match((await recs(a))[0].detail, /Reduce the amiodarone dose or discontinue/);
  const d = await patient({ meds: [["dronedarone", 400]], labs: [["alt", 140]] });
  assert.equal((await recs(d)).find((x) => /ALT/.test(x.title)).severity, "orange");
  await tx((q) => K.recordObservations(q, doc, d, { effectiveAt: new Date().toISOString(), items: [{ code: "alt", value: 150 }] } as any));
  await tx((q) => reassess(q, d, "sandbox"));
  const fd = (await recs(d)).find((x) => /ALT/.test(x.title));
  assert.equal(fd.severity, "red");
  assert.match(fd.detail, /withdraw dronedarone/);
  const b = await patient({ meds: [["bosentan", 125]], labs: [["alt", 400]] });
  assert.match((await recs(b))[0].detail, /do not reintroduce/);
});

test("pre-start limits: mavacamten LVEF <55%, ivabradine HR <70, eplerenone K >5.0 (red), sacubitril/valsartan K >5.4 (orange), ambrisentan ALT >3 × ULN (red)", async () => {
  const pid = await patient({ hcm: "Normal metaboliser", lvef: 52, labs: [["potassium", 5.5], ["alt", 150]], hr: 64 });
  const s = await loadState(db, pid);
  const sev = (code: string) => preStartCheck(s, code, MEDICATION[code]).map((h) => `${h.severity} ${h.title}`);
  assert.ok(sev("mavacamten").includes("red Mavacamten: do not initiate with LVEF below 55%"));
  assert.ok(sev("ivabradine").includes("red Ivabradine: do not initiate with resting heart rate below 70/min"));
  assert.ok(sev("eplerenone").includes("red Eplerenone: potassium too high to start"));
  assert.ok(sev("sacubitril-valsartan").includes("orange Sacubitril/valsartan: potassium too high to start"));
  assert.ok(sev("ambrisentan").includes("red Ambrisentan: do not initiate with ALT above 3 × ULN"));
});

test("finerenone target (SmPC 4.2): 40 mg in heart failure with eGFR ≥60, 20 mg with eGFR <60 or without heart failure", async () => {
  const hf = await patient({ conditions: ["hfpef"], labs: [["creatinine", 70]] });
  const ckd = await patient({ conditions: ["ckd-3a"], labs: [["creatinine", 70]] });
  const low = await patient({ conditions: ["hfpef"], labs: [["creatinine", 160]] });
  assert.equal(targetDose(await loadState(db, hf), "finerenone", 40), 40);
  assert.equal(targetDose(await loadState(db, ckd), "finerenone", 40), 20);
  assert.equal(targetDose(await loadState(db, low), "finerenone", 40), 20);
});
