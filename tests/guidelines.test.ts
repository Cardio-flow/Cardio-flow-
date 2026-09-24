import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { cha2ds2va, lipidRisk, targets } from "../server/engine/guidelines.js";
import { today, type Actor } from "../server/kernel/base.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const at = () => new Date().toISOString();
const active = async (pid: string) =>
  (await db.query(`SELECT rule_id, severity, title, action FROM cf.recommendation WHERE patient_id=$1 AND status='active'`, [pid])).rows as any[];
const byName = async (name: string) => (await db.query(`SELECT id FROM cf.patient WHERE name=$1`, [name])).rows[0].id as string;
const act = (r: any) => (typeof r.action === "string" ? JSON.parse(r.action) : r.action);

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("cardiometabolic patient: LDL escalation, SGLT2i, GLP-1 RA, finerenone and BP are all suggested", async () => {
  const id = await byName("Salem Al-Rashidi");
  const recs = await active(id);
  const ids = recs.map((r) => r.rule_id);
  for (const r of ["lipids.ldl-goal", "metabolic.diabetes-cv-protection", "cardiorenal.finerenone", "htn.bp-target", "lipids.lpa-once"]) assert.ok(ids.includes(r), r);
  const ldl = recs.find((r) => r.rule_id === "lipids.ldl-goal");
  assert.match(ldl.title, /above goal <1\.4/);
  assert.equal(act(ldl).type, "titrate"); // moderate-intensity statin → high intensity first
  const glp1 = recs.find((r) => /GLP-1/.test(r.title));
  assert.equal(act(glp1).code, "semaglutide");
});

test("LDL ladder moves to the next step when therapy changes, and LDL at goal clears it", async () => {
  const id = await byName("Noura Al-Kandari");
  let ldl = (await active(id)).find((r) => r.rule_id === "lipids.ldl-goal");
  assert.equal(act(ldl).code, "ezetimibe");
  await db.transaction(async (tx) => {
    await K.startMedication(tx, doc, id, { code: "ezetimibe", doseValue: 10, frequency: "OD", route: "PO", indication: "cad", effectiveAt: at() });
    await reassess(tx, id, "sandbox", ["meds"]);
  });
  ldl = (await active(id)).find((r) => r.rule_id === "lipids.ldl-goal");
  assert.equal(act(ldl).code, "evolocumab");
  await db.transaction(async (tx) => {
    await K.recordObservations(tx, doc, id, { effectiveAt: at(), items: [{ code: "ldl-c", value: 1.2 }] });
    await reassess(tx, id, "sandbox", ["ldl-c"]);
  });
  assert.equal((await active(id)).find((r) => r.rule_id === "lipids.ldl-goal"), undefined);
});

test("HF titration is suggested only when safe: potassium above 5.0 blocks MRA/ARNI uptitration", async () => {
  const id = await byName("Hamad Al-Shammari");
  const before = (await active(id)).filter((r) => r.rule_id === "hf.titration").map((r) => r.title);
  assert.ok(before.some((t) => /Eplerenone/.test(t)) && before.some((t) => /Sacubitril/.test(t)) && before.some((t) => /Bisoprolol/.test(t)));
  await db.transaction(async (tx) => {
    await K.recordObservations(tx, doc, id, { effectiveAt: at(), items: [{ code: "potassium", value: 5.3 }] });
    await reassess(tx, id, "sandbox", ["potassium"]);
  });
  const after = (await active(id)).filter((r) => r.rule_id === "hf.titration").map((r) => r.title);
  assert.ok(!after.some((t) => /Eplerenone|Sacubitril/.test(t)), "RAAS/MRA blocked");
  assert.ok(after.some((t) => /Bisoprolol/.test(t)), "beta-blocker unaffected");
});

test("missing HF pillars are suggested with a starting dose; SGLT2i is not duplicated for diabetes", async () => {
  const id = await byName("Abdullah Al-Enezi");
  const titles = (await active(id)).filter((r) => r.rule_id === "hf.foundational-therapy").map((r) => r.title);
  assert.ok(titles.some((t) => /ARNI/.test(t)));
  assert.ok(titles.some((t) => /SGLT2/.test(t)));
  assert.ok(!titles.some((t) => /Beta-blocker|MRA/.test(t)), "already on bisoprolol and spironolactone");
  const k = await byName("Khaled Al-Mansour");
  assert.ok(!(await active(k)).some((r) => /SGLT2 inhibitor not prescribed/.test(r.title)));
});

test("CHA2DS2-VA, DOAC preference and apixaban dose criteria", async () => {
  const fatma = await (async (n: string) => { const pid = await byName(n); return db.transaction((tx) => loadState(tx, pid)); })("Fatma Al-Ajmi");
  const c = cha2ds2va(fatma);
  assert.equal(c.score, 3); // age 65–74, hypertension, vascular disease
  assert.ok(!(await active(fatma.patient.id)).some((r) => r.rule_id === "af.doac-dose"), "5 mg correct with one criterion");
  const ae = await byName("Abdullah Al-Enezi");
  assert.ok((await active(ae)).some((r) => /DOAC is preferred/.test(r.title)));
  // weight ≤60 and creatinine ≥133 → 2.5 mg
  await db.transaction(async (tx) => {
    await K.recordObservations(tx, doc, fatma.patient.id, { effectiveAt: at(), items: [{ code: "creatinine", value: 140 }] });
    await reassess(tx, fatma.patient.id, "sandbox", ["creatinine"]);
  });
  const dose = (await active(fatma.patient.id)).find((r) => r.rule_id === "af.doac-dose");
  assert.ok(dose);
  assert.equal(act(dose).dose, 2.5);
});

test("targets panel reports % of HF target dose and the LDL goal by risk", async () => {
  const s = await (async (n: string) => { const pid = await byName(n); return db.transaction((tx) => loadState(tx, pid)); })("Hamad Al-Shammari");
  const t = targets(s);
  assert.equal(t.hf!.phenotype, "HFrEF");
  assert.equal(t.hf!.pillars.find((p) => p.key === "sglt2")!.percentOfTarget, 100);
  assert.equal(t.hf!.pillars.find((p) => p.key === "bb")!.percentOfTarget, 25);
  const salem = await (async (n: string) => { const pid = await byName(n); return db.transaction((tx) => loadState(tx, pid)); })("Salem Al-Rashidi");
  assert.equal(lipidRisk(salem)!.goal, 1.4);
  assert.equal(today().length, 10);
});
