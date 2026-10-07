// The four rules rebuilt on guideline values (1 Oct 2026): ESC HF creatinine limits, ESC/EACTS
// 2025 mechanical-valve INR targets, ESC HF digoxin target. (Post-discharge window: encounters.test.)
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
const newPatient = (conditions: string[]) => tx((q) => K.createPatient(q, doc, { name: "Gl " + rnd(), mrn: "G" + rnd() + Date.now(), sex: "Male", birthDate: "1958-01-01", conditions }));
const start = (pid: string, code: string, dose: number, freq: string, day: string, indication = "hf") =>
  tx((q) => K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication, effectiveAt: at(day) }));
const obs = (pid: string, items: any[], when = nowIso()) => tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: when, items }); await reassess(q, pid, "production"); });
const valve = (pid: string, attributes: Record<string, unknown>) =>
  tx(async (q) => { await K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code: "prosthetic-valve", attributes }] }); await reassess(q, pid, "production"); });
const rec = async (pid: string, rule: string) =>
  ((await db.query(`SELECT severity, title, detail, facts, rule_status FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[])[0];

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("creatinine: ≤50% rise acceptable, >50% review, >100% stop (ESC HF); baseline is before the RAAS start", async () => {
  const pid = await newPatient(["hfref"]);
  await obs(pid, [{ code: "creatinine", value: 90 }], at(addDays(T, -40)));
  await start(pid, "sacubitril-valsartan", 49, "BID", addDays(T, -30));
  await obs(pid, [{ code: "creatinine", value: 125 }], at(addDays(T, -20)));
  assert.equal(await rec(pid, "hf.worsening-renal-function"), undefined, "90 → 125 (+39%) is acceptable");
  await obs(pid, [{ code: "creatinine", value: 140 }], at(addDays(T, -10)));
  const r = await rec(pid, "hf.worsening-renal-function");
  assert.equal(r.severity, "orange");
  assert.match(r.title, /Creatinine up 56%: beyond the acceptable rise/);
  assert.equal(r.rule_status, "PUBLISHED", "runs on production sites");
  await obs(pid, [{ code: "creatinine", value: 190 }]);
  const s = await rec(pid, "hf.worsening-renal-function");
  assert.equal(s.severity, "red");
  assert.match(s.title, /stop RAAS\/MRA/);
  // the absolute limit: 266 µmol/L is reached before +50% when the baseline is high
  const p2 = await newPatient(["hfref"]);
  await start(p2, "spironolactone", 25, "OD", addDays(T, -60));
  await obs(p2, [{ code: "creatinine", value: 200 }], at(addDays(T, -20)));
  await obs(p2, [{ code: "creatinine", value: 270 }]);
  assert.equal((await rec(p2, "hf.worsening-renal-function")).severity, "orange", "270 > 266 although only +35%");
  // the rule is about RAAS/MRA: no finding without one; a baseline already above 266 needs a real (+50%) rise
  const p3 = await newPatient(["hfref"]);
  await obs(p3, [{ code: "creatinine", value: 200 }], at(addDays(T, -20)));
  await obs(p3, [{ code: "creatinine", value: 270 }]);
  assert.equal(await rec(p3, "hf.worsening-renal-function"), undefined, "no RAAS/MRA");
  const p4 = await newPatient(["hfref"]);
  await start(p4, "spironolactone", 25, "OD", addDays(T, -60));
  await obs(p4, [{ code: "creatinine", value: 320 }], at(addDays(T, -20)));
  await obs(p4, [{ code: "creatinine", value: 340 }]);
  assert.equal(await rec(p4, "hf.worsening-renal-function"), undefined, "320 → 340 (+6%) from a baseline already above the limits");
});

test("mechanical valve INR: recorded target wins, suggestion from design/position/risk, unset target asks for it", async () => {
  // aortic bileaflet, no risk factor → suggested 2.5 (2.0–3.0)
  const a = await newPatient(["htn"]);
  await valve(a, { position: "Aortic", type: "Mechanical", design: "Bileaflet / current tilting-disc" });
  await start(a, "warfarin", 5, "OD", addDays(T, -60), "valve");
  await obs(a, [{ code: "inr", value: 2.3 }]);
  assert.equal(await rec(a, "safety.inr"), undefined, "2.3 is inside 2.0–3.0");
  await obs(a, [{ code: "inr", value: 1.8 }]);
  assert.match((await rec(a, "safety.inr")).title, /below target 2\.0–3\.0 \(mechanical valve, suggested target\)/);
  // the same patient with AF → 3.0 (2.5–3.5)
  await tx(async (q) => { await K.recordHistory(q, doc, a, { effectiveAt: nowIso(), add: [{ code: "af" }] }); });
  await obs(a, [{ code: "inr", value: 2.3 }]);
  const r = await rec(a, "safety.inr");
  assert.match(r.title, /INR 2\.3 below target 2\.5–3\.5/);
  assert.ok(r.facts.some((f: any) => f.label === "Valve risk" && f.value === "AF"));

  // recorded target wins over the suggestion
  const b = await newPatient(["htn"]);
  await valve(b, { position: "Mitral", type: "Mechanical", inrTarget: "2.5 (2.0–3.0)" });
  await start(b, "warfarin", 5, "OD", addDays(T, -60), "valve");
  await obs(b, [{ code: "inr", value: 2.2 }]);
  assert.equal(await rec(b, "safety.inr"), undefined, "clinician target 2.0–3.0 respected");

  // design unknown in aortic position: no guess; only the outer limits of every range
  const c = await newPatient(["htn"]);
  await valve(c, { position: "Aortic", type: "Mechanical" });
  await start(c, "warfarin", 5, "OD", addDays(T, -60), "valve");
  await obs(c, [{ code: "inr", value: 2.6 }]);
  const u = await rec(c, "safety.inr");
  assert.equal(u.severity, "yellow");
  assert.match(u.title, /mechanical-valve INR target not recorded/);
  await obs(c, [{ code: "inr", value: 1.7 }]);
  assert.equal((await rec(c, "safety.inr")).severity, "red");

  // AF without a valve keeps 2.0–3.0
  const d = await newPatient(["af"]);
  await start(d, "warfarin", 5, "OD", addDays(T, -60), "af");
  await obs(d, [{ code: "inr", value: 3.4 }]);
  assert.match((await rec(d, "safety.inr")).title, /INR 3\.4 above target 2\.0–3\.0$/);
});

test("digoxin: level above 0.9 ng/mL is flagged; red when a toxicity risk factor is present", async () => {
  const pid = await newPatient(["af", "hfref"]);
  await start(pid, "digoxin", 0.125, "OD", addDays(T, -60), "af");
  await obs(pid, [{ code: "digoxin-level", value: 0.8 }, { code: "potassium", value: 4.3 }]);
  assert.equal(await rec(pid, "safety.digoxin"), undefined, "0.8 is inside 0.5–0.9 and no risk factor");
  await obs(pid, [{ code: "digoxin-level", value: 1.3 }]);
  const r = await rec(pid, "safety.digoxin");
  assert.equal(r.severity, "orange");
  assert.equal(r.title, "Digoxin level 1.3 ng/mL above target 0.5–0.9");
  await obs(pid, [{ code: "potassium", value: 3.2 }]);
  assert.equal((await rec(pid, "safety.digoxin")).severity, "red");
  // CKD (eGFR <60) counts as a risk factor even without a level
  const p2 = await newPatient(["af", "ckd-3a"]);
  await start(p2, "digoxin", 0.125, "OD", addDays(T, -60), "af");
  await obs(p2, [{ code: "potassium", value: 4.4 }]);
  assert.match((await rec(p2, "safety.digoxin")).title, /Digoxin with 1 toxicity risk factor/);
});
