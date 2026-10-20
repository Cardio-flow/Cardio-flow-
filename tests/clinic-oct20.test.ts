// 20 Oct 2026 — gaps found by entering a real clinic list (synthetic data here): value ranges keep both
// numbers with the lower one deciding, free-text other medicines, month-only report dates, cultures,
// symptomatic hypotension holding HF starts, reports without percentages at cath, PDE-5 for ED.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { diagnosisLines } from "../server/kernel/views.js";
import { nowIso, type Actor } from "../server/kernel/base.js";
import { formatRange } from "../shared/catalog.js";
import { cleanStudy, obstructiveCad, studySummary } from "../shared/studies.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const patient = (conditions: string[], sex: "Male" | "Female" = "Female") => tx((q) => K.createPatient(q, doc, { name: "Oct20 " + Math.random().toString(36).slice(2, 7), mrn: "O" + Date.now() + Math.random().toString(36).slice(2, 5), sex, birthDate: "1955-01-01", conditions }));
const active = async (pid: string) => ((await db.query(`SELECT rule_id, title FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[]);

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: false });
});
after(async () => db.close());

test("an LVEF range keeps both numbers; the lower one is the value the rules use", async () => {
  assert.equal(formatRange(35, 40, 0), "35–40");
  assert.equal(formatRange(35, null, 0), "35");
  const pid = await patient(["hfref"]);
  await tx((q) => K.recordEcho(q, doc, pid, { date: nowIso(), quality: "formal", lvef: 35, lvefHigh: 40, findings: [] }));
  const s = await loadState(db, pid);
  const ef = s.resolved("lvef").current!;
  assert.equal(ef.value_num, 35);
  assert.equal(ef.value_high, 40);
  assert.deepEqual(diagnosisLines(s).diagnoses, ["HFrEF (LVEF 35–40%)"]);
  await assert.rejects(tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "lvef", value: 40, valueHigh: 35 }] })), /upper number of a range/);
});

test("other medicines are free text, listed, stoppable, and refused when the catalogue has the medicine", async () => {
  const pid = await patient(["htn"]);
  await tx((q) => K.recordOtherMedicine(q, doc, pid, { name: "Lactulose", dose: "15 mL", frequency: "once daily" }));
  let s = await loadState(db, pid);
  assert.deepEqual(s.otherMeds.map((o) => [o.name, o.dose, o.frequency]), [["Lactulose", "15 mL", "once daily"]]);
  await assert.rejects(tx((q) => K.recordOtherMedicine(q, doc, pid, { name: "Lasix" })), /in the CardioFlow list/);
  await tx((q) => K.stopOtherMedicine(q, doc, pid, s.otherMeds[0].logical_id));
  s = await loadState(db, pid);
  assert.equal(s.otherMeds.length, 0);
});

test("symptomatic hypotension or midodrine holds HF therapy starts", async () => {
  const pid = await patient(["hfref", "hypotension"]);
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid, { date: nowIso(), quality: "formal", lvef: 30, findings: [] });
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "potassium", value: 4.2 }, { code: "creatinine", value: 90 }, { code: "sbp", value: 112 }, { code: "hr", value: 72 }] });
    await reassess(q, pid, "production");
  });
  assert.ok(!(await active(pid)).some((r) => r.rule_id === "hf.foundational-therapy"), "no start offered with symptomatic hypotension");
  const pid2 = await patient(["hfref"]);
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid2, { date: nowIso(), quality: "formal", lvef: 30, findings: [] });
    await K.recordObservations(q, doc, pid2, { effectiveAt: nowIso(), items: [{ code: "potassium", value: 4.2 }, { code: "creatinine", value: 90 }, { code: "sbp", value: 112 }, { code: "hr", value: 72 }] });
    await reassess(q, pid2, "production");
  });
  assert.ok((await active(pid2)).some((r) => r.rule_id === "hf.foundational-therapy"), "without it, starts are offered");
  await tx(async (q) => {
    await K.startMedication(q, doc, pid2, { code: "midodrine", doseValue: 5, frequency: "TID", route: "PO", indication: "Symptomatic hypotension", effectiveAt: nowIso(), alreadyTaking: true });
    await reassess(q, pid2, "production");
  });
  assert.ok(!(await active(pid2)).some((r) => r.rule_id === "hf.foundational-therapy"), "midodrine holds starts too");
});

test("tadalafil for erectile dysfunction is checked against nitrates", async () => {
  const pid = await patient(["htn"], "Male");
  await tx(async (q) => {
    await K.startMedication(q, doc, pid, { code: "tadalafil-ed", doseValue: 5, frequency: "OD", route: "PO", indication: "Erectile dysfunction", effectiveAt: nowIso(), alreadyTaking: true });
    await K.startMedication(q, doc, pid, { code: "isosorbide-mononitrate", doseValue: 30, frequency: "OD", route: "PO", indication: "angina", effectiveAt: nowIso(), alreadyTaking: true });
    await reassess(q, pid, "production");
  });
  const r = await active(pid);
  assert.ok(r.some((x) => /tadalafil/i.test(x.title) && /nitr|glyceryl|isosorbide/i.test(x.title)), JSON.stringify(r));
});

test("reports without percentages, cultures and month-only dates", async () => {
  const cath = cleanStudy("cath", { lm: "Patent stent", lad: "Patent stent", lcx: "Patent stent", rca: "Severe (not quantified)", grafts: "All patent", outcome: "Not stated" });
  assert.equal(obstructiveCad("cath", cath), "1-vessel disease (RCA)");
  const stress = cleanStudy("stress", { modality: "Not stated", result: "Positive for ischaemia", extent: "Small" });
  assert.equal(stress.modality, "Not stated");
  const c = cleanStudy("culture", { specimen: "Urine", result: "Growth", organism: "Escherichia coli", resistance: ["ESBL"] });
  assert.equal(studySummary("culture", c), "Urine: Escherichia coli · ESBL");
  assert.equal(studySummary("culture", cleanStudy("culture", { specimen: "Blood cultures", sets: 3, result: "No growth" })), "Blood cultures (3 sets): no growth");

  const { importCase, caseSchema, checkCase } = await import("../server/kernel/case-import.js");
  const file = caseSchema.parse({
    format: "cardioflow-case/1", sample: true,
    patient: { name: "Month " + Date.now(), mrn: "M" + Date.now(), sex: "Male", age: 66 },
    conditions: [{ code: "hfimpef", attributes: { aetiology: ["Ischaemic"] } }, { code: "coronary-ectasia", attributes: { vessels: ["LAD", "LCx"] } }],
    results: [{ date: "2026-03", items: [{ code: "iron", value: 50, unit: "µg/dL" }, { code: "psa", value: 3.99 }] }],
    echoes: [{ date: "2026-05", lvef: 45, lvefHigh: 50 }],
    studies: [{ kind: "culture", date: "2026-07-29", findings: { specimen: "Urine", result: "Growth", organism: "Escherichia coli", resistance: ["ESBL"] } }],
    otherMedications: [{ name: "Cetirizine", dose: "10 mg", frequency: "OD" }],
    admissions: [{ startedOn: "2026-07-20", endedOn: "2026-07-28", reasons: ["Acute kidney injury", "Hypotension / shock", "Sepsis / urinary infection"] }],
  });
  assert.deepEqual(checkCase(file), []);
  const pid = await tx((q) => importCase(q, doc, file));
  const s = await loadState(db, pid);
  const echo = s.studies.find((x) => x.kind === "echo")!;
  assert.equal(echo.attributes.datePrecision, "month");
  assert.equal(echo.performed_at.slice(0, 7), "2026-05");
  assert.equal(s.resolved("lvef").current?.value_high, 50);
  assert.equal(s.resolved("iron").current?.value_num, 8.95);
  assert.equal(s.resolved("psa").current?.source, "case import · month only");
  assert.deepEqual(s.otherMeds.map((o) => o.name), ["Cetirizine"]);
  assert.ok(s.studies.some((x) => x.kind === "culture"));
});

test("the endocarditis prompt names blood cultures already reported; a suspected-IHD import counts last year's test", async () => {
  const pid = await patient(["hfref", "cied"]);
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid, { date: nowIso(), quality: "formal", lvef: 35, findings: ["Mass on device lead"] });
    await K.recordStudy(q, doc, pid, { kind: "culture", date: nowIso(), findings: { specimen: "Blood cultures", sets: 3, result: "No growth" } });
    await reassess(q, pid, "production");
  });
  const ie = ((await db.query(`SELECT detail FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='event.endocarditis'`, [pid])).rows as any[])[0];
  assert.match(ie?.detail ?? "", /Recorded: blood cultures .* no growth/);

  const pid2 = await patient(["cad-suspected"], "Male");
  await tx(async (q) => {
    await K.recordStudy(q, doc, pid2, { kind: "stress", date: new Date(Date.now() - 200 * 864e5).toISOString(), findings: { modality: "Not stated", result: "Positive for ischaemia", extent: "Small" } });
    await reassess(q, pid2, "production");
  });
  const r = await active(pid2);
  assert.ok(!r.some((x) => x.rule_id === "cad.suspected-workup"), JSON.stringify(r));
  assert.ok(r.some((x) => x.rule_id === "cad.test-result"));
});

test("overview story: turning point, since discharge, where things stand, timeline, abnormal once; SGLT2i held for urosepsis with what lets it back", async () => {
  const { importCase, caseSchema } = await import("../server/kernel/case-import.js");
  const { summary } = await import("../server/kernel/views.js");
  const c = caseSchema.parse({
    format: "cardioflow-case/1", sample: true,
    patient: { name: "Story " + Date.now(), mrn: "ST" + Date.now(), sex: "Female", age: 67 },
    conditions: [{ code: "hfimpef", attributes: { aetiology: ["Ischaemic"] } }, { code: "recurrent-uti" }],
    echoes: [{ date: "2025-12", lvef: 30, lvefHigh: 35 }, { date: "2026-08-20", lvef: 55 }],
    results: [
      { date: "2026-06-01", items: [{ code: "creatinine", value: 95 }, { code: "potassium", value: 4.4 }, { code: "haemoglobin", value: 11.2 }] },
      { date: "2026-09-02", items: [{ code: "creatinine", value: 118 }, { code: "potassium", value: 5.3 }, { code: "haemoglobin", value: 10.1 }, { code: "magnesium", value: 0.62 }, { code: "sbp", value: 112 }, { code: "hr", value: 58 }] }],
    medications: [{ code: "bisoprolol", doseValue: 1.25, frequency: "OD", indication: "hf" }, { code: "aspirin", doseValue: 100, frequency: "OD", indication: "cad" }, { code: "clopidogrel", doseValue: 75, frequency: "OD", indication: "cad" }],
    admissions: [{ startedOn: "2026-07-20", endedOn: "2026-07-28", reasons: ["Acute kidney injury", "Sepsis / urinary infection"] }],
  });
  const pid = await tx(async (q) => { const id = await importCase(q, doc, c); await reassess(q, id, "production"); return id; });
  const s = (await db.transaction((q) => summary(q, pid))) as any;
  const line = (k: string) => s.story.find((l: any) => l.key === k)?.text ?? "";
  assert.equal(line("heart"), "30–35% (Dec 2025) → 55% (Aug 2026)");
  assert.match(line("admission"), /20 Jul–28 Jul 2026 \(8 days\): Acute kidney injury, Sepsis \/ urinary infection/);
  assert.equal(line("since"), "creatinine and potassium rose; Hb fell");
  assert.ok(!s.story.some((l: any) => ["background", "now"].includes(l.key)), "no diagnosis or medicine list in the story");
  assert.deepEqual(s.standing.find((x: any) => x.key === "heart"), { key: "heart", label: "Heart function", value: "Improved", tone: "good" });
  assert.equal(s.standing.find((x: any) => x.key === "bleeding")?.value, "2 antithrombotics with falling Hb");
  assert.deepEqual(s.timeline.lanes.map((l: any) => l.code), ["lvef", "creatinine", "potassium", "haemoglobin"]);
  assert.equal(s.timeline.admissions.length, 1);
  assert.deepEqual(s.abnormal.items.map((x: any) => x.code).sort(), ["creatinine", "haemoglobin", "magnesium", "potassium"]);
  const sglt2 = s.targets.hf.pillars.find((p: any) => p.key === "sglt2");
  assert.match(sglt2.block, /recurrent UTI, urosepsis Jul 2026/);
  assert.match(sglt2.unlock, /urinary infections are controlled/);
  assert.equal(s.targets.hf.pillars.find((p: any) => p.key === "bb").increaseBlock, "HR 58 bpm");
  assert.ok(!s.attention.some((a: any) => a.rule_id === "hf.foundational-therapy" && /SGLT2/.test(a.title)));
});

test("a mitral clip or a ring is a valve repair, never a prosthetic valve; residual MR after a clip does not open the prosthesis pathway", async () => {
  const { conditionLabel } = await import("../server/kernel/views.js");
  assert.equal(conditionLabel({ code: "prosthetic-valve", display: "Prosthetic valve / repair", attributes: { position: "Mitral", type: "Edge-to-edge repair (clip)" } }), "Mitral TEER (clip)");
  assert.equal(conditionLabel({ code: "prosthetic-valve", display: "Prosthetic valve / repair", attributes: { position: "Tricuspid", type: "Repair / ring" } }), "Tricuspid valve repair (ring)");
  const pid = await patient(["hfref"]);
  await tx(async (q) => {
    await K.recordProcedure(q, doc, pid, { kind: "valve", date: new Date("2021-07-01T09:00:00+03:00").toISOString(), details: { position: "Mitral", procedure: "Transcatheter edge-to-edge repair (TEER)", deviceModel: "MitraClip", historical: "year" } } as any);
    await K.recordEcho(q, doc, pid, { date: nowIso(), quality: "formal", lvef: 35, findings: [], valves: { mr: "Moderate" } });
    await reassess(q, pid, "production");
  });
  assert.ok(!(await active(pid)).some((r) => r.rule_id === "event.prosthetic-valve"));
});
