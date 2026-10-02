// Acute and safety pathways: shock, sepsis, glucose crises, bleeding, electrolytes, INR, digoxin, severe BP.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { loadState } from "../server/kernel/state.js";
import { reassess } from "../server/engine/engine.js";
import { completeWizard, getWizard } from "../server/engine/wizard.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";
import { WIZARDS, buildOutcome } from "../shared/wizards.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[]) => tx((q) => K.createPatient(q, doc, { name: "Ac " + rnd(), mrn: "A" + rnd() + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions }));
const start = (pid: string, code: string, dose: number, freq: string, indication = "hf") =>
  tx((q) => K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: "PO", indication, effectiveAt: at(addDays(T, -60)) }));
const obs = (pid: string, items: any[], when = nowIso()) => tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: when, items }); await reassess(q, pid, "sandbox"); });
const rec = async (pid: string, rule: string) =>
  ((await db.query(`SELECT id, severity, title, detail, action, missing FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[]).map((r) => ({ ...r, action: typeof r.action === "string" ? JSON.parse(r.action) : r.action }))[0];
const status = async (pid: string, code: string) => (await loadState(db, pid)).meds.find((m) => m.code === code)?.status;

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("every pathway is well formed: plan categories, required questions, recheck labs exist", async () => {
  const cats = ["medication", "investigation", "monitoring", "follow_up", "referral", "procedure", "education", "other"];
  const { MEASURES } = await import("../shared/catalog.js");
  assert.ok(Object.keys(WIZARDS).length >= 15);
  for (const w of Object.values(WIZARDS)) {
    for (const q of w.steps.flatMap((s) => s.questions)) {
      if (q.type !== "dose") assert.ok(q.options?.length, `${w.id}.${q.id} has options`);
      for (const o of q.options ?? []) for (const p of o.effects?.plan ?? []) assert.ok(cats.includes(p.category), `${w.id}.${o.value} category ${p.category}`);
    }
    for (const c of [...(w.recheck?.codes ?? []), ...(w.facts ?? []), ...(w.trend ? [w.trend] : [])]) assert.ok(MEASURES[c], `${w.id}: ${c} is in the catalogue`);
  }
});

test("shock: SBP <90 with lactate ≥2 is red; the pathway holds HF drugs and books the shock plan", async () => {
  const pid = await newPatient(["hfref"]);
  await start(pid, "bisoprolol", 5, "OD");
  await start(pid, "sacubitril-valsartan", 49, "BID");
  await start(pid, "dapagliflozin", 10, "OD");
  await obs(pid, [{ code: "sbp", value: 82 }, { code: "lactate", value: 3.4 }, { code: "hr", value: 118 }]);
  const r = await rec(pid, "acute.shock");
  assert.equal(r.severity, "red");
  assert.match(r.title, /Possible shock: SBP 82 mmHg, lactate 3\.4/);
  assert.equal(await rec(pid, "hf.symptomatic-hypotension"), undefined, "no duplicate low-BP alert");
  const out = await tx((q) => completeWizard(q, doc, pid, "shock", { answers: { type: "cardiogenic", stage: "C", perfusion: ["cold", "lactate"], actions: ["icu", "hold-hf", "echo", "mcs"], recheck: "0" }, recommendationId: r.id }));
  for (const c of ["bisoprolol", "sacubitril-valsartan", "dapagliflozin"]) assert.equal(await status(pid, c), "held", c);
  const titles = out.outcome.filter((o) => o.kind === "plan").map((o: any) => o.title);
  for (const t of ["CCU / ICU admission and senior review", "Urgent bedside Echo", "Shock team review: mechanical circulatory support", "Lactate and renal function"]) assert.ok(titles.includes(t), t);
});

test("sepsis with a prosthetic valve mentions endocarditis; sick-day holds apply", async () => {
  const pid = await newPatient(["hfref", "t2dm"]);
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code: "prosthetic-valve", attributes: { position: "Aortic", type: "Bioprosthetic (surgical)" } }] }));
  await start(pid, "empagliflozin", 10, "OD");
  await start(pid, "metformin", 1000, "BID", "dm");
  await start(pid, "furosemide", 40, "OD");
  await obs(pid, [{ code: "temp", value: 38.9 }, { code: "hr", value: 112 }, { code: "rr", value: 24 }]);
  const r = await rec(pid, "acute.sepsis-screen");
  assert.match(r.title, /temperature 38\.9 °C with 2 other signs/);
  assert.match(r.detail, /endocarditis/);
  assert.ok(r.missing.includes("Lactate"));
  await tx((q) => completeWizard(q, doc, pid, "sepsis", { answers: { signs: ["fever", "tachycardia"], source: "valve", actions: ["cultures", "antibiotics", "hold-sickday", "endocarditis"], recheck: "1", review: "clinic-7" }, recommendationId: r.id }));
  for (const c of ["empagliflozin", "metformin", "furosemide"]) assert.equal(await status(pid, c), "held", c);
});

test("euglycaemic DKA on an SGLT2 inhibitor; the SGLT2i can be stopped from the pathway", async () => {
  const pid = await newPatient(["hfref", "t2dm"]);
  await start(pid, "dapagliflozin", 10, "OD");
  await obs(pid, [{ code: "glucose", value: 9.2 }, { code: "ketones", value: 4.1 }, { code: "bicarbonate", value: 14 }]);
  const r = await rec(pid, "dm.hyperglycaemic-crisis");
  assert.equal(r.title, "Euglycaemic DKA on an SGLT2 inhibitor");
  const w = await tx((q) => getWizard(q, pid, "hyperglycaemia"));
  assert.deepEqual(w.context.detected.drugs, ["sglt2"]);
  await tx((q) => completeWizard(q, doc, pid, "hyperglycaemia", { answers: { picture: "eudka", drugs: ["sglt2"], actions: ["emergency", "stop-sglt2", "sick-day"], recheck: "0", review: "clinic-14" }, recommendationId: r.id }));
  assert.equal(await status(pid, "dapagliflozin"), "stopped");
  // uncontrolled diabetes without a crisis
  const p2 = await newPatient(["t2dm"]);
  await obs(p2, [{ code: "hba1c", value: 10.4 }]);
  assert.equal(await rec(p2, "dm.hyperglycaemic-crisis"), undefined, "a high HbA1c is not a crisis");
  assert.match((await rec(p2, "dm.glycaemic-control")).title, /Uncontrolled diabetes: HbA1c 10\.4% \(target <7%\)/);
});

test("hypoglycaemia levels, bleeding on apixaban, low K/Mg, low sodium", async () => {
  const pid = await newPatient(["af", "htn"]);
  await obs(pid, [{ code: "glucose", value: 2.8 }]);
  const h = await rec(pid, "dm.hypoglycaemia");
  assert.equal(h.severity, "red");
  assert.match(h.title, /level 2/);

  await start(pid, "apixaban", 5, "BID", "af");
  await obs(pid, [{ code: "haemoglobin", value: 13.4 }], at(addDays(T, -10)));
  await obs(pid, [{ code: "haemoglobin", value: 10.9 }]);
  const b = await rec(pid, "safety.bleeding");
  assert.match(b.title, /Haemoglobin down 2\.5 g\/dL on apixaban/);
  const out = await tx((q) => completeWizard(q, doc, pid, "bleeding", { answers: { severity: "moderate", site: "gi", agents: ["oac"], actions: ["hold-oac", "ppi", "restart", "gi"], recheck: "1", review: "clinic-7" }, recommendationId: b.id }));
  assert.equal(await status(pid, "apixaban"), "held");
  assert.ok(out.outcome.some((o: any) => o.title === "Decide restart or de-escalation of antithrombotic therapy"));

  await obs(pid, [{ code: "potassium", value: 2.9 }, { code: "magnesium", value: 0.6 }, { code: "sodium", value: 124 }]);
  assert.equal((await rec(pid, "safety.low-potassium")).severity, "red");
  assert.equal((await rec(pid, "safety.hyponatraemia")).severity, "red");
});

test("INR below a mechanical-valve target is red; digoxin risk; severe BP", async () => {
  const pid = await newPatient(["af", "hfref"]);
  await tx((q) => K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code: "prosthetic-valve", attributes: { position: "Mitral", type: "Mechanical" } }] }));
  await start(pid, "warfarin", 5, "OD", "valve");
  await start(pid, "digoxin", 0.125, "OD", "af");
  await start(pid, "amiodarone", 200, "OD", "af");
  await obs(pid, [{ code: "inr", value: 1.8 }, { code: "potassium", value: 3.3 }, { code: "sbp", value: 186 }, { code: "dbp", value: 104 }]);
  const inr = await rec(pid, "safety.inr");
  assert.equal(inr.severity, "red");
  // mitral position (higher thrombogenicity) + AF → suggested 3.5 (3.0–4.0), ESC/EACTS 2025
  assert.match(inr.title, /INR 1\.8 below target 3\.0–4\.0 \(mechanical valve, suggested target\)/);
  const dig = await rec(pid, "safety.digoxin");
  assert.match(dig.title, /Digoxin with 2 toxicity risk factors/);
  assert.ok(dig.missing.includes("Digoxin level"));
  assert.match((await rec(pid, "htn.severe")).title, /BP 186\/104 mmHg/);
  // options follow the medicines: stopping digoxin is offered, stopping an SGLT2i is not
  const w = await tx((q) => getWizard(q, pid, "hyperglycaemia"));
  const preview = buildOutcome("digoxin", { features: ["gi"], actions: ["hold", "correct-k"], recheck: "1" }, (await tx((q) => getWizard(q, pid, "digoxin"))).context);
  assert.ok(preview.some((o) => o.kind === "medication" && o.label === "Digoxin: hold"));
  await assert.rejects(tx((q) => completeWizard(q, doc, pid, "hyperglycaemia", { answers: { picture: "uncontrolled", actions: ["stop-sglt2"], recheck: "7", review: "none" } })), /does not apply/);
  assert.ok(w.context.facts.length > 0);
});

test("pre-procedure and chest-infection pathways write the dated plan and holds the clinician chose", async () => {
  const pid = await newPatient(["hfref", "af", "htn"]);
  await start(pid, "apixaban", 5, "BID", "af");
  await start(pid, "dapagliflozin", 10, "OD");
  await start(pid, "clopidogrel", 75, "OD", "cad");
  const w = await tx((q) => getWizard(q, pid, "pre-procedure"));
  const medOpts = WIZARDS["pre-procedure"].steps.find((s) => s.id === "meds")!.questions[0].options!.map((o) => o.value);
  assert.ok(medOpts.includes("doac") && medOpts.includes("sglt2"));
  await tx((q) => completeWizard(q, doc, pid, "pre-procedure", { answers: {
    urgency: "elective", risk: "high", bleeding: "high", active: ["none"], capacity: "poor", pci: "none",
    tests: ["troponin", "bnp", "echo"], meds: ["doac", "sglt2", "p2y12"], conclusion: "after-tests", review: "none",
  } }));
  const titles = ((await db.query(`SELECT title FROM cf.plan_action WHERE patient_id=$1`, [pid])).rows as any[]).map((r) => r.title);
  assert.ok(titles.some((t) => /hs-troponin before surgery/.test(t)));
  assert.ok(titles.some((t) => /Interrupt DOAC/.test(t)));
  assert.ok(titles.some((t) => /Stop SGLT2 inhibitor at least 3 days/.test(t)));
  assert.ok(titles.some((t) => /Interrupt P2Y12 inhibitor/.test(t)));
  assert.ok(w);

  const p2 = await newPatient(["hfref", "af"]);
  await start(p2, "amiodarone", 200, "OD", "af");
  await start(p2, "dapagliflozin", 10, "OD");
  await tx((q) => completeWizard(q, doc, p2, "chest-infection", { answers: {
    setting: "cap", curb: ["u", "65"], severity: "moderate", tests: ["cxr", "cultures", "cardiac"], "cap-abx": "amox-mac",
    cardiac: ["qt", "sickday"], recheck: "2", after: ["review", "vaccines"], review: "clinic-7",
  } }));
  const t2 = ((await db.query(`SELECT title FROM cf.plan_action WHERE patient_id=$1`, [p2])).rows as any[]).map((r) => r.title);
  assert.ok(t2.some((t) => /CAP \(moderate\): amoxicillin \+ macrolide/.test(t)));
  assert.ok(t2.some((t) => /QTc on ECG/.test(t)));
  assert.equal(await status(p2, "dapagliflozin"), "held");
});
