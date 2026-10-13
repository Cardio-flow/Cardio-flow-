// 13 Oct 2026 review: lab- and trend-driven medicine engine, safety blocks and flow defects found by
// simulated cases (DOAC on a mechanical valve, gradual creatinine rise, titration before post-change labs,
// DOAC dose for non-AF indications, potassium boundary, implausible units, duplicate results, re-alert loops,
// rechallenge after a hold, LDL-C reduction, monitoring that outlives a removed visit).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { preStartCheck } from "../server/engine/med-safety.js";
import { doacDoseCheck } from "../server/engine/guidelines.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { MEDICATION } from "../shared/catalog.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string, h = "09") => new Date(`${day}T${h}:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[], sex: "Male" | "Female" = "Male", birthDate = "1958-01-01") =>
  tx((q) => K.createPatient(q, doc, { name: "En " + rnd(), mrn: "E" + rnd() + Date.now(), sex, birthDate, conditions }));
const start = (pid: string, code: string, dose: number, freq: string, day: string, indication = "hf") =>
  tx(async (q) => { const r = await K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication, effectiveAt: at(day) }); await reassess(q, pid, "production"); return r; });
const obs = (pid: string, items: any[], when = nowIso()) => tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: when, items }); await reassess(q, pid, "production"); });
const recs = async (pid: string) => (await db.query(`SELECT rule_id, severity, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[];
const rec = async (pid: string, rule: string) => (await recs(pid)).find((r) => r.rule_id === rule);
const act = (r: any) => (typeof r.action === "string" ? JSON.parse(r.action) : r.action);

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("a DOAC cannot be started on a mechanical valve, nor a second oral anticoagulant, without a recorded reason", async () => {
  const pid = await newPatient(["af"]);
  await tx(async (q) => { await K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code: "prosthetic-valve", attributes: { position: "Mitral", type: "Mechanical" } }] }); });
  await start(pid, "warfarin", 5, "OD", addDays(T, -30), "valve");
  const hits = preStartCheck(await loadState(db, pid), "apixaban", MEDICATION.apixaban);
  assert.ok(hits.some((h) => h.severity === "red" && /mechanical heart valve/.test(h.title)), "valve contraindication");
  assert.ok(hits.some((h) => h.severity === "red" && /two oral anticoagulants/.test(h.title)), "dual anticoagulation");
});

test("creatinine: a gradual rise is measured from the baseline, and no up-titration is offered meanwhile", async () => {
  const pid = await newPatient(["hfref"]);
  await obs(pid, [{ code: "lvef", value: 30 }], at(addDays(T, -100)));
  await start(pid, "ramipril", 2.5, "BID", addDays(T, -90));
  await obs(pid, [{ code: "creatinine", value: 110 }, { code: "potassium", value: 4.5 }, { code: "sbp", value: 125 }], at(addDays(T, -60)));
  await obs(pid, [{ code: "creatinine", value: 150 }, { code: "potassium", value: 4.6 }], at(addDays(T, -30)));
  await obs(pid, [{ code: "creatinine", value: 200 }, { code: "potassium", value: 4.7 }, { code: "sbp", value: 120 }, { code: "hr", value: 70 }]);
  const r = await rec(pid, "hf.worsening-renal-function");
  assert.ok(r, "110 → 150 → 200 (+82% from baseline) is caught");
  assert.match(r.title, /82% from baseline/);
  assert.ok(!(await recs(pid)).some((x) => x.rule_id === "hf.titration" && /Ramipril/i.test(x.title)), "no ramipril uptitration during the renal alert");
});

test("an eGFR already below the limit is not a new crossing", async () => {
  const pid = await newPatient(["hfref"], "Female", "1946-01-01");
  await start(pid, "ramipril", 2.5, "BID", addDays(T, -90));
  await obs(pid, [{ code: "creatinine", value: 160 }], at(addDays(T, -30)));
  await obs(pid, [{ code: "creatinine", value: 165 }]);
  assert.equal(await rec(pid, "hf.worsening-renal-function"), undefined, "+3% at eGFR ~25 → 24 is not an alert");
});

test("up-titration waits for potassium and creatinine after the last RAAS/MRA change", async () => {
  const pid = await newPatient(["hfref"]);
  await obs(pid, [{ code: "lvef", value: 30 }, { code: "creatinine", value: 100 }, { code: "potassium", value: 4.4 }, { code: "sbp", value: 125 }, { code: "hr", value: 72 }, { code: "congestion", text: "None" }], at(addDays(T, -50)));
  await start(pid, "spironolactone", 12.5, "OD", addDays(T, -20));
  await obs(pid, [{ code: "sbp", value: 124 }, { code: "hr", value: 70 }]);
  assert.ok(!(await recs(pid)).some((x) => x.rule_id === "hf.titration" && /Spironolactone/i.test(x.title)), "no labs since the start: no uptitration");
  await obs(pid, [{ code: "creatinine", value: 104 }, { code: "potassium", value: 4.6 }]);
  assert.ok((await recs(pid)).some((x) => x.rule_id === "hf.titration" && /Spironolactone/i.test(x.title)), "after the check: uptitration offered");
});

test("potassium: 5.5 is not 'above 5.5'; 5.6 is", async () => {
  const pid = await newPatient(["hfref"]);
  await start(pid, "spironolactone", 25, "OD", addDays(T, -20));
  await obs(pid, [{ code: "potassium", value: 5.5 }, { code: "creatinine", value: 100 }], at(T, "08"));
  assert.equal(await rec(pid, "hf.hyperkalaemia-review"), undefined);
  await obs(pid, [{ code: "potassium", value: 5.6 }, { code: "creatinine", value: 100 }]);
  assert.ok(await rec(pid, "hf.hyperkalaemia-review"));
});

test("DOAC label-dose check: AF only (rivaroxaban 2.5 mg twice daily in CAD is not an AF under-dose)", async () => {
  const pid = await newPatient(["cad-ccs", "af"]);
  await obs(pid, [{ code: "creatinine", value: 90 }, { code: "weight", value: 80 }]);
  await start(pid, "rivaroxaban", 2.5, "BID", addDays(T, -5), "cad");
  assert.equal(doacDoseCheck(await loadState(db, pid)).length, 0);
});

test("results: impossible values are refused with the unit hint; an identical double submit is refused", async () => {
  const pid = await newPatient(["htn"]);
  await assert.rejects(obs(pid, [{ code: "creatinine", value: 1.2 }]), /mg\/dL/);
  await obs(pid, [{ code: "creatinine", value: 1.2, unit: "mg/dL" }]);
  await assert.rejects(obs(pid, [{ code: "haemoglobin", value: 130 }]), /g\/L/);
  const when = nowIso();
  await obs(pid, [{ code: "potassium", value: 4.2 }], when);
  await assert.rejects(obs(pid, [{ code: "potassium", value: 4.2 }], when), /already recorded/);
});

test("a held RAAS/MRA is offered back once potassium settles", async () => {
  const pid = await newPatient(["hfref"]);
  const r: any = await start(pid, "spironolactone", 25, "OD", addDays(T, -30));
  await obs(pid, [{ code: "potassium", value: 6.1 }, { code: "creatinine", value: 100 }], at(addDays(T, -10)));
  await tx(async (q) => { await K.medicationEvent(q, doc, pid, r.medicationId, { kind: "hold", reason: "Hyperkalaemia", effectiveAt: at(addDays(T, -10), "10") }); await reassess(q, pid, "production"); });
  assert.equal(await rec(pid, "hf.rechallenge-after-hold"), undefined, "no potassium since the hold");
  await obs(pid, [{ code: "potassium", value: 4.8 }, { code: "creatinine", value: 102 }]);
  const x = await rec(pid, "hf.rechallenge-after-hold");
  assert.ok(x, "K 4.8 after the hold: consider restarting");
  assert.equal(act(x).type, "med-action");
});

test("CK on a statin: holding it in answer to the alert does not bring the same alert back", async () => {
  const pid = await newPatient(["cad-ccs"]);
  const r: any = await start(pid, "atorvastatin", 40, "OD", addDays(T, -60), "cad");
  await obs(pid, [{ code: "ck", value: 2400, referenceHigh: 200 }, { code: "creatinine", value: 90 }]);
  const before = await db.query(`SELECT id FROM cf.recommendation WHERE patient_id=$1 AND rule_id='lab.statin-ck' AND status='active'`, [pid]);
  assert.equal(before.rows.length, 1);
  const sig1 = ((await db.query(`SELECT fingerprint AS signature FROM cf.recommendation WHERE patient_id=$1 AND rule_id='lab.statin-ck' AND status='active'`, [pid])).rows[0] as any)?.signature;
  await tx(async (q) => { await K.medicationEvent(q, doc, pid, r.medicationId, { kind: "hold", reason: "CK", effectiveAt: nowIso() }); await reassess(q, pid, "production"); });
  const sig2 = ((await db.query(`SELECT fingerprint AS signature FROM cf.recommendation WHERE patient_id=$1 AND rule_id='lab.statin-ck' AND status='active'`, [pid])).rows[0] as any)?.signature;
  assert.equal(sig2, sig1, "same alert, not a new one");
});

test("LDL-C at goal but less than 50% below the pre-treatment baseline is flagged", async () => {
  const pid = await newPatient(["cad-ccs"]);
  await obs(pid, [{ code: "ldl-c", value: 2.4 }], at(addDays(T, -120)));
  await start(pid, "atorvastatin", 40, "OD", addDays(T, -100), "cad");
  await obs(pid, [{ code: "ldl-c", value: 1.35 }]);
  const r = await rec(pid, "lipids.ldl-goal");
  assert.ok(r, "1.35 is under 1.4 but only 44% below 2.4");
  assert.match(r.title, /44% below baseline/);
});

test("an alert dismissed as not needed is listed and can be shown again", async () => {
  const { declineRecommendation, restoreRecommendation } = await import("../server/engine/wizard.js");
  const { dismissed } = await import("../server/kernel/views.js");
  const pid = await newPatient(["hfref"]);
  await start(pid, "spironolactone", 25, "OD", addDays(T, -20));
  await obs(pid, [{ code: "potassium", value: 5.8 }, { code: "creatinine", value: 100 }]);
  const r = await rec(pid, "hf.hyperkalaemia-review");
  const id = ((await db.query(`SELECT id FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='hf.hyperkalaemia-review'`, [pid])).rows[0] as any).id;
  assert.ok(r);
  await tx((q) => declineRecommendation(q, doc, pid, id, { outcome: "declined", reason: "Not relevant for this patient" }));
  await tx((q) => reassess(q, pid, "production"));
  assert.equal(await rec(pid, "hf.hyperkalaemia-review"), undefined, "stays closed while the data are unchanged");
  assert.equal((await dismissed(db, pid))[0].id, id);
  await tx((q) => restoreRecommendation(q, doc, pid, id));
  await tx((q) => reassess(q, pid, "production"));
  assert.ok(await rec(pid, "hf.hyperkalaemia-review"), "shown again");
  assert.equal((await dismissed(db, pid)).length, 0);
});
