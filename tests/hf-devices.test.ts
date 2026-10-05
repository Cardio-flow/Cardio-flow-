// HF module slice 3: ICD/CRT decision after ≥3 months of optimal foundational therapy (ESC HF 2026
// Rec. Tables 6–7; ESC pacing 2021 upgrade), severe secondary MR → heart team / TEER (Rec. Table
// 17, I B), and keeping foundational therapy when LVEF improves (Rec. Table 5, I C).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { reassess } from "../server/engine/engine.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const run = (pid: string) => tx((q) => reassess(q, pid, "production"));
const rec = async (pid: string, rule: string) =>
  ((await db.query(`SELECT severity, title, detail, facts, missing, action FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[])[0];

// HFrEF patient on all four pillars started `daysAgo`, safe labs and vitals
async function hfrefOnFmt(daysAgo: number, opts: { lvef?: number; lvefDaysAgo?: number; aetiology?: string[]; extra?: string[] } = {}) {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Dev " + rnd(), mrn: "D" + rnd() + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: ["hfref", ...(opts.extra ?? [])] }));
  await tx(async (q) => {
    if (opts.aetiology) {
      const c = (await q.query(`SELECT logical_id FROM cf.condition WHERE patient_id=$1 AND code='hfref'`, [pid])).rows[0];
      await K.updateCondition(q, doc, pid, c.logical_id, { attributes: { aetiology: opts.aetiology } });
    }
    for (const [code, dose, freq] of [["sacubitril-valsartan", 49, "BID"], ["bisoprolol", 5, "OD"], ["spironolactone", 25, "OD"], ["dapagliflozin", 10, "OD"]] as const)
      await K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication: "hf", effectiveAt: at(addDays(T, -daysAgo)) });
    await K.recordEcho(q, doc, pid, { date: at(addDays(T, -(opts.lvefDaysAgo ?? 2))), quality: "formal", lvef: opts.lvef ?? 30, findings: [] });
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "potassium", value: 4.4 }, { code: "creatinine", value: 90 }, { code: "sbp", value: 112 }, { code: "hr", value: 66 }, { code: "nyha", text: "II" }] });
    await K.recordStudy(q, doc, pid, { kind: "ecg", date: at(addDays(T, -2)), findings: { rhythm: "Sinus rhythm", qrs: 156, qrsMorphology: "LBBB" } });
    await reassess(q, pid, "production");
  });
  return pid;
}

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("ICD/CRT: <3 months of optimal therapy → reassess date; LVEF before the 3 months → repeat Echo; after → CRT-D candidate", async () => {
  const early = await hfrefOnFmt(30);
  let r = await rec(early, "hf.device-assessment");
  assert.equal(r.severity, "blue");
  assert.match(r.title, /^LVEF 30%: ICD\/CRT decision after ≥3 months of optimal therapy · repeat Echo from /);
  assert.equal(r.action.template, "echo");

  const stale = await hfrefOnFmt(120, { lvefDaysAgo: 100 });
  r = await rec(stale, "hf.device-assessment");
  assert.match(r.title, /^≥3 months of optimal therapy since .*: repeat Echo to decide on ICD\/CRT$/);

  const ready = await hfrefOnFmt(120, { aetiology: ["Ischaemic"] });
  r = await rec(ready, "hf.device-assessment");
  assert.equal(r.severity, "orange");
  assert.equal(r.title, "LVEF 30% despite ≥3 months of all four pillars (some below target), NYHA II: CRT-D candidate");
  assert.match(r.detail, /ischaemic aetiology \(ESC 2021: I A\)/);
  assert.match(r.detail, /LBBB, QRS ≥150 ms: CRT class I/);
  assert.ok(r.facts.some((f: any) => f.label === "Below target dose" && /Bisoprolol 50%/.test(f.value)));
  assert.equal(r.action.template, "device-referral");
  assert.deepEqual(r.missing, []);
});

test("ICD/CRT: non-ischaemic and unknown aetiology, NYHA IV, ICD in place, pacemaker upgrade", async () => {
  const dcm = await hfrefOnFmt(120, { aetiology: ["Dilated (non-ischaemic)"] });
  assert.match((await rec(dcm, "hf.device-assessment")).detail, /non-ischaemic aetiology \(ESC 2021: IIa A\)/);

  const unk = await hfrefOnFmt(120);
  const u = await rec(unk, "hf.device-assessment");
  assert.ok(u.missing.includes("HF aetiology"));

  await tx(async (q) => { await K.recordObservations(q, doc, unk, { effectiveAt: nowIso(), items: [{ code: "nyha", text: "IV" }] }); await reassess(q, unk, "production"); });
  const iv = await rec(unk, "hf.device-assessment");
  assert.equal(iv.severity, "blue");
  assert.match(iv.title, /NYHA IV: ICD alone is not indicated/);
  assert.equal(iv.action.template, "advanced-hf");

  // ICD already in place: only CRT remains (LBBB 156 ms) → upgrade to CRT-D
  const icd = await hfrefOnFmt(120, { aetiology: ["Ischaemic"] });
  await tx(async (q) => { await K.recordHistory(q, doc, icd, { effectiveAt: nowIso(), add: [{ code: "cied", onsetYear: 2022, attributes: { type: "ICD" } }] }); await reassess(q, icd, "production"); });
  assert.match((await rec(icd, "hf.device-assessment")).title, /upgrade to CRT-D candidate$/);

  // conventional pacemaker with LVEF ≤35%
  const ppm = await hfrefOnFmt(30);
  await tx(async (q) => { await K.recordHistory(q, doc, ppm, { effectiveAt: nowIso(), add: [{ code: "cied", onsetYear: 2020, attributes: { type: "Pacemaker" } }] }); await reassess(q, ppm, "production"); });
  const up = await rec(ppm, "hf.device-assessment");
  assert.match(up.title, /^Pacemaker with LVEF 30%: consider upgrade to CRT$/);
  assert.match(up.missing[0], /RV pacing %/);
});

test("missing pillar: optimise therapy first; the gap is named", async () => {
  const pid = await tx((q) => K.createPatient(q, doc, { name: "Gap " + rnd(), mrn: "G" + rnd() + Date.now(), sex: "Female", birthDate: "1965-01-01", conditions: ["hfref"] }));
  await tx(async (q) => {
    await K.startMedication(q, doc, pid, { code: "bisoprolol", doseValue: 5, frequency: "OD", route: "PO", indication: "hf", effectiveAt: at(addDays(T, -200)) });
    await K.recordEcho(q, doc, pid, { date: at(addDays(T, -2)), quality: "formal", lvef: 25, findings: [] });
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "potassium", value: 4.4 }, { code: "creatinine", value: 90 }, { code: "sbp", value: 112 }, { code: "hr", value: 66 }] });
    await reassess(q, pid, "production");
  });
  const r = await rec(pid, "hf.device-assessment");
  assert.match(r.title, /optimise foundational therapy first \(ARNI \/ ACE inhibitor \/ ARB, MRA, SGLT2 inhibitor\)/);
});

test("severe secondary MR: wait for optimal therapy and CRT, then heart-team review for TEER", async () => {
  const pid = await hfrefOnFmt(30, { extra: ["mr-secondary"] });
  await tx(async (q) => {
    const c = (await q.query(`SELECT logical_id FROM cf.condition WHERE patient_id=$1 AND code='mr-secondary'`, [pid])).rows[0];
    await K.updateCondition(q, doc, pid, c.logical_id, { attributes: { severity: "Severe" } });
    await reassess(q, pid, "production");
  });
  // LBBB 156 ms: CRT indicated and not implanted → optimise first
  let r = await rec(pid, "hf.secondary-mr");
  assert.equal(r.severity, "blue");
  assert.match(r.title, /Severe secondary MR: QRS meets CRT criteria — decide on CRT first, then re-grade on Echo/);
  await tx(async (q) => { await K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code: "cied", onsetYear: 2026, attributes: { type: "CRT-D" } }] }); await reassess(q, pid, "production"); });
  r = await rec(pid, "hf.secondary-mr");
  assert.equal(r.severity, "orange");
  assert.equal(r.title, "Severe secondary MR despite optimised therapy: heart-team review for mitral TEER");
  assert.equal(r.action.template, "heart-team");
  await tx(async (q) => { await K.addPlanAction(q, doc, pid, { category: "referral", title: "Heart Team discussion (mitral TEER)", dueDate: addDays(T, 14), completesOn: { type: "manual" } }); await reassess(q, pid, "production"); });
  assert.equal(await rec(pid, "hf.secondary-mr"), undefined);
});

test("improved LVEF: stopping a foundational drug raises 'keep therapy' with a restart; a recorded intolerance silences it", async () => {
  const pid = await hfrefOnFmt(300, { lvef: 30, lvefDaysAgo: 250 });
  await tx(async (q) => {
    await K.recordEcho(q, doc, pid, { date: at(addDays(T, -20)), quality: "formal", lvef: 55, findings: [] });
    const bb = (await q.query(`SELECT id FROM cf.medication WHERE patient_id=$1 AND drug='bisoprolol'`, [pid])).rows[0];
    await K.medicationEvent(q, doc, pid, bb.id, { kind: "stop", reason: "LVEF recovered", effectiveAt: at(addDays(T, -5)) });
    await reassess(q, pid, "production");
  });
  const r = await rec(pid, "hf.improved-ef-continue");
  assert.equal(r.severity, "orange");
  assert.match(r.title, /^LVEF improved: Bisoprolol stopped .* — continuing foundational therapy is recommended$/);
  assert.equal(r.action.type, "start-med");
  assert.equal(r.action.code, "bisoprolol");
  assert.equal(r.action.dose, 5);
  assert.equal(await rec(pid, "hf.device-assessment"), undefined, "no device prompt with LVEF 55%");
  assert.equal(await rec(pid, "hf.advanced-hf"), undefined, "a withdrawal after recovery is not an advanced-HF marker");
  await tx(async (q) => { await K.recordBarrier(q, doc, pid, { drugClass: "bb", category: "intolerance", detail: "Bradycardia" }); await reassess(q, pid, "production"); });
  assert.equal(await rec(pid, "hf.improved-ef-continue"), undefined);
});
