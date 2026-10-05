// Medicine coverage, slice 2: monitoring schedules (shared/drug-monitoring.ts) — the due rule med.monitoring
// and the booking when a medicine is started from the drawer.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { bookMonitoringAtStart } from "../server/engine/med-rules.js";
import { today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { MEDICATION } from "../shared/catalog.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string, time = "10:00") => new Date(`${day}T${time}:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const byName = async (name: string) => ((await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0] as any).id as string;
const mon = async (pid: string) =>
  ((await db.query(`SELECT severity, title, detail, action, rule_status FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id='med.monitoring' ORDER BY title`, [pid])).rows as any[]);
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

let n = 0;
const newPatient = (birthDate = "1960-01-01", conditions: string[] = []) => tx((q) => K.createPatient(q, doc, { name: `Mon ${++n} ${Date.now()}`, mrn: `MN${n}${Date.now()}`, sex: "Male", birthDate, conditions }));
const start = (pid: string, code: string, daysAgo: number, dose?: number) => {
  const def = MEDICATION[code];
  return tx((q) => K.startMedication(q, doc, pid, { code, doseValue: dose ?? def.doses[0], frequency: def.frequencies[0], route: def.routes[0], indication: def.indications[0] ?? "other", effectiveAt: at(addDays(T, -daysAgo)) } as any));
};
const lab = (pid: string, daysAgo: number, items: [string, number][]) =>
  tx((q) => K.recordObservations(q, doc, pid, { effectiveAt: at(addDays(T, -daysAgo), "11:00"), items: items.map(([code, value]) => ({ code, value })) } as any));
const run = (pid: string) => tx((q) => reassess(q, pid, "sandbox"));

test("seed: Bader on amiodarone with no ALT and Nadia on macitentan with no ALT → yellow, published, 'Book check' (liver template)", async () => {
  const b = (await mon(await byName("Bader Al-Mutairi")))[0];
  assert.equal(b.title, "Liver function (transaminases) due on Amiodarone");
  assert.equal(b.severity, "yellow");
  assert.equal(b.rule_status, "PUBLISHED");
  assert.equal(b.action.template, "mon-lft");
  assert.match(b.detail, /Schedule: before treatment and every 6 months \(SmPC amiodarone 4\.4\)/);
  assert.equal((await mon(await byName("Nadia Al-Ali")))[0].title, "ALT and AST due on Macitentan");
});

test("dronedarone (label): liver tests and creatinine at day 7; an ALT clears the 1-week point; creatinine stays due until recorded", async () => {
  const pid = await newPatient();
  await start(pid, "dronedarone", 10);
  await run(pid);
  assert.deepEqual((await mon(pid)).map((x) => x.title), ["Creatinine due on Dronedarone", "Liver function tests due on Dronedarone"]);
  await lab(pid, 1, [["alt", 30]]);
  await run(pid);
  assert.deepEqual((await mon(pid)).map((x) => x.title), ["Creatinine due on Dronedarone"]);
});

test("eplerenone (label): the first check is left to the RAAS/MRA rule; potassium at 1 month needs a result after week 1", async () => {
  const pid = await newPatient();
  await start(pid, "eplerenone", 10);
  await run(pid);
  assert.equal((await mon(pid)).length, 0, "first 30 days without potassium: ops.monitoring-after-change");
  const p2 = await newPatient();
  await start(p2, "eplerenone", 35);
  await lab(p2, 32, [["potassium", 4.6], ["creatinine", 90]]);
  await run(p2);
  const f = await mon(p2);
  assert.equal(f[0].title, "Potassium due on Eplerenone");
  assert.equal(f[0].action.template, "renal-k");
  await lab(p2, 0, [["potassium", 4.8]]);
  await run(p2);
  assert.equal((await mon(p2)).length, 0);
});

test("DOAC (EHRA 2021): every 4 months at age ≥75, yearly otherwise; a booked check quiets it", async () => {
  const old = await newPatient(addDays(T, -(80 * 365)));
  await start(old, "apixaban", 300, 2.5);
  await lab(old, 150, [["haemoglobin", 13], ["creatinine", 90], ["alt", 20], ["weight", 70]]);
  await run(old);
  const f = (await mon(old))[0];
  assert.equal(f.title, "Haemoglobin, renal and liver function due on Apixaban");
  assert.equal(f.action.template, "mon-doac");
  const young = await newPatient("1970-01-01");
  await start(young, "apixaban", 300, 5);
  await lab(young, 150, [["haemoglobin", 14], ["creatinine", 80], ["alt", 22], ["weight", 80]]);
  await run(young);
  assert.equal((await mon(young)).length, 0, "within a year");
  await tx((q) => K.addPlanAction(q, doc, old, { category: "monitoring", title: "Bloods", dueDate: addDays(T, 7), completesOn: { type: "lab", codes: ["haemoglobin", "creatinine", "alt"] } } as any));
  await run(old);
  assert.equal((await mon(old)).length, 0);
});

test("spironolactone schedule only in heart failure; LDL-C after a statin increase only when an LDL-C exists from the last year", async () => {
  const htn = await newPatient("1960-01-01", ["htn"]);
  await start(htn, "spironolactone", 200);
  await run(htn);
  assert.equal((await mon(htn)).length, 0);
  const lip = await newPatient("1960-01-01", ["dyslipidaemia"]);
  const r = await start(lip, "atorvastatin", 400, 20);
  await lab(lip, 100, [["ldl-c", 3.1]]);
  await tx((q) => K.medicationEvent(q, doc, lip, (r as any).medicationId, { kind: "increase", doseValue: 40, reason: "LDL above goal", effectiveAt: at(addDays(T, -50)) } as any));
  await run(lip);
  assert.equal((await mon(lip))[0].title, "LDL-C due on Atorvastatin");
  const none = await newPatient("1960-01-01", ["dyslipidaemia"]);
  await start(none, "atorvastatin", 400, 20);
  await run(none);
  assert.equal((await mon(none)).length, 0, "no LDL-C in a year: the lipid rule asks for a profile");
});

test("booking at start: dronedarone books the label points in the first 3 months; amiodarone books ALT and TSH at 6 months", async () => {
  const pid = await newPatient();
  const d = await start(pid, "dronedarone", 0);
  assert.equal(await tx((q) => bookMonitoringAtStart(q, doc, pid, (d as any).medicationId, null)), 5);
  const a = await start(pid, "amiodarone", 0);
  assert.equal(await tx((q) => bookMonitoringAtStart(q, doc, pid, (a as any).medicationId, null)), 2);
  const s = await loadState(db, pid);
  const titles = s.plan.filter((p) => p.status === "planned").map((p) => `${p.title} · ${p.due_date}`).sort();
  assert.ok(titles.includes(`Liver function tests (Dronedarone monitoring) · ${addDays(T, 7)}`));
  assert.ok(titles.includes(`Creatinine (Dronedarone monitoring) · ${addDays(T, 7)}`));
  assert.ok(titles.includes(`TSH (Amiodarone monitoring) · ${addDays(T, 182)}`));
  await run(pid);
  assert.equal((await mon(pid)).length, 0);
});
