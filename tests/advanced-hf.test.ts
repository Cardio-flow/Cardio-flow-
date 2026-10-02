// Advanced HF markers (I-NEED-HELP) → advanced HF centre consultation, under Needs attention.
// ESC HF 2026 Rec. Table 11 (I, A); HFA-ESC 2018 position statement; HELP-HF registry.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { reassess } from "../server/engine/engine.js";
import { summary } from "../server/kernel/views.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[]) => tx((q) => K.createPatient(q, doc, { name: "Adv " + rnd(), mrn: "A" + rnd() + Date.now(), sex: "Male", birthDate: "1962-01-01", conditions }));
const run = (pid: string) => tx((q) => reassess(q, pid, "production"));
const obs = (pid: string, items: any[], when = nowIso()) => tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: when, items }); await reassess(q, pid, "production"); });
const rec = async (pid: string) =>
  ((await db.query(`SELECT severity, title, facts, rule_status FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='hf.advanced-hf'`, [pid])).rows as any[])[0];
const admission = async (pid: string, from: number, to: number, events: string[]) => {
  const a = await tx((q) => K.startAdmission(q, doc, pid, { startedAt: at(addDays(T, from)), location: "Ward 3A", reasons: ["Acute decompensated HF"] }));
  await tx((q) => K.discharge(q, doc, pid, a.id, { endedAt: at(addDays(T, to)), status: "Euvolaemic", destination: "Home", events, plan: [] }));
  await run(pid);
};

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("no marker → nothing; NYHA III is a marker and shows under Needs attention (orange, published)", async () => {
  const pid = await newPatient(["hfref"]);
  await obs(pid, [{ code: "nyha", text: "II" }, { code: "sbp", value: 112 }]);
  assert.equal(await rec(pid), undefined);
  await obs(pid, [{ code: "nyha", text: "III" }]);
  const r = await rec(pid);
  assert.equal(r.severity, "orange");
  assert.equal(r.rule_status, "PUBLISHED");
  assert.match(r.title, /^Advanced HF marker: NYHA III · consider advanced HF centre consultation$/);
  const s = await tx((q) => summary(q, pid, "production"));
  assert.ok(s.attention.some((a: any) => a.rule_id === "hf.advanced-hf" && a.action?.template === "advanced-hf"));
});

test("inotropes, two HF admissions and low SBP add markers and re-raise the card", async () => {
  const pid = await newPatient(["hfref"]);
  await admission(pid, -200, -190, ["IV diuretics"]);
  assert.equal(await rec(pid), undefined, "one HF admission is not a marker");
  await admission(pid, -40, -30, ["Inotropes / vasopressors", "Acute kidney injury"]);
  let r = await rec(pid);
  assert.match(r.title, /markers: inotropes, acute kidney injury, 2 HF admissions in 12 months ·/);
  assert.ok(r.facts.some((f: any) => f.label === "H · HF hospitalisations" && f.value === "2 in the last 12 months"));
  await obs(pid, [{ code: "sbp", value: 86 }]);
  r = await rec(pid);
  assert.match(r.title, /markers: inotropes, acute kidney injury, 2 HF admissions in 12 months, SBP 86 ·/);
  // 90 mmHg is not below 90
  const p2 = await newPatient(["hfref"]);
  await obs(p2, [{ code: "sbp", value: 90 }]);
  assert.equal(await rec(p2), undefined);
});

test("a clinician's dose reduction of a prognostic drug counts; a patient-reported dose does not", async () => {
  const pid = await newPatient(["hfref"]);
  const med = await tx((q) => K.startMedication(q, doc, pid, { code: "bisoprolol", doseValue: 5, frequency: "OD", route: "PO", indication: "hf", effectiveAt: at(addDays(T, -100)) }));
  const id = med.medicationId;
  await tx((q) => K.medicationEvent(q, doc, pid, id, { kind: "decrease", doseValue: 2.5, reason: "Patient reports taking this dose", effectiveAt: at(addDays(T, -20)) }));
  await run(pid);
  assert.equal(await rec(pid), undefined);
  await tx((q) => K.medicationEvent(q, doc, pid, id, { kind: "decrease", doseValue: 1.25, reason: "Symptomatic hypotension", effectiveAt: at(addDays(T, -5)) }));
  await run(pid);
  const r = await rec(pid);
  assert.match(r.title, /marker: bisoprolol reduced ·/);
  assert.ok(r.facts.some((f: any) => /Bisoprolol reduced: Symptomatic hypotension/.test(f.value)));
});

test("LVEF ≤25% is a marker only with HF; a planned consultation closes the card", async () => {
  const noHf = await newPatient(["htn"]);
  await obs(noHf, [{ code: "lvef", value: 20 }]);
  assert.equal(await rec(noHf), undefined, "rule applies to HF patients");
  const pid = await newPatient(["hfref"]);
  await obs(pid, [{ code: "lvef", value: 25 }]);
  assert.match((await rec(pid)).title, /marker: LVEF 25% ·/);
  await tx(async (q) => {
    await K.addPlanAction(q, doc, pid, { category: "referral", title: "Advanced HF centre consultation", dueDate: addDays(T, 14), completesOn: { type: "manual" } });
    await reassess(q, pid, "production");
  });
  assert.equal(await rec(pid), undefined);
});

test("synthetic Faisal (two HF admissions, NYHA IV) shows the card", async () => {
  const pid = ((await db.query(`SELECT id FROM cf.patient WHERE name='Faisal Al-Mutairi'`)).rows[0] as any).id;
  const r = await rec(pid);
  assert.ok(r, "Faisal has advanced HF markers");
  assert.match(r.title, /HF admissions in 12 months/);
});
