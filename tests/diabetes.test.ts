// Diabetes in cardiac patients: individual target, HF-unsafe agents, metformin and kidney
// function, hypoglycaemia risk, duplicate incretins, annual checks, SGLT2i before procedures,
// and the diabetes / sick-day / Ramadan pathways. Brand names are searchable.
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
import { MEDICATIONS, medicationSearchText, withBrand } from "../shared/catalog.js";
import { WIZARDS, buildOutcome, optionsFor } from "../shared/wizards.js";

let db: DB;
const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
const T = today();
const at = (day: string) => new Date(`${day}T09:00:00+03:00`).toISOString();
const tx = <R>(fn: (q: any) => Promise<R>) => db.transaction(fn);
const rnd = () => Math.random().toString(36).slice(2, 8);
const newPatient = (conditions: string[], birthDate = "1965-01-01") =>
  tx((q) => K.createPatient(q, doc, { name: "Dm " + rnd(), mrn: "D" + rnd() + Date.now(), sex: "Female", birthDate, conditions }));
const diabetes = (pid: string, attributes: Record<string, unknown> = {}, code = "t2dm") =>
  tx(async (q) => { await K.recordHistory(q, doc, pid, { effectiveAt: nowIso(), add: [{ code, attributes }] }); await reassess(q, pid, "sandbox"); });
const start = (pid: string, code: string, dose: number | null, freq: string, indication = "dm") =>
  tx(async (q) => { await K.startMedication(q, doc, pid, { code, doseValue: dose, frequency: freq, route: code.startsWith("insulin") ? "SC" : "PO", indication, effectiveAt: at(addDays(T, -90)) }); await reassess(q, pid, "sandbox"); });
const obs = (pid: string, items: any[], when = nowIso()) => tx(async (q) => { await K.recordObservations(q, doc, pid, { effectiveAt: when, items }); await reassess(q, pid, "sandbox"); });
const rec = async (pid: string, rule: string) =>
  ((await db.query(`SELECT id, severity, title, detail, action, facts FROM cf.recommendation WHERE patient_id=$1 AND status='active' AND rule_id=$2`, [pid, rule])).rows as any[])
    .map((r) => ({ ...r, action: typeof r.action === "string" ? JSON.parse(r.action) : r.action, facts: typeof r.facts === "string" ? JSON.parse(r.facts) : r.facts }));
const one = async (pid: string, rule: string) => (await rec(pid, rule))[0];
const status = async (pid: string, code: string) => (await loadState(db, pid)).meds.find((m) => m.code === code)?.status;

before(async () => {
  db = await createLocalDb();
  await boot(db, { seed: true });
});
after(async () => db.close());

test("brand names: every medicine is searchable by trade name, and labels carry it", () => {
  const find = (q: string) => MEDICATIONS.filter((m) => medicationSearchText(m).includes(q.toLowerCase())).map((m) => m.code);
  assert.deepEqual(find("jardiance"), ["empagliflozin"]);
  assert.deepEqual(find("Forxiga"), ["dapagliflozin"]);
  assert.ok(find("ozempic").includes("semaglutide"));
  assert.deepEqual(find("diamicron"), ["gliclazide"]);
  assert.deepEqual(find("lantus"), ["insulin-glargine"]);
  assert.equal(withBrand("sacubitril-valsartan"), "Sacubitril/valsartan (Entresto)");
  const without = MEDICATIONS.filter((m) => !m.brands?.length).map((m) => m.code);
  assert.deepEqual(without, [], "every catalogue medicine has a trade name");
});

test("individual target: default <7%, less stringent after severe hypoglycaemia, clinician target wins", async () => {
  const a = await newPatient(["hfref"]);
  await diabetes(a);
  await obs(a, [{ code: "hba1c", value: 7.6 }]);
  const r = await one(a, "dm.glycaemic-control");
  assert.equal(r.severity, "yellow");
  assert.equal(r.title, "HbA1c 7.6% above target <7%");
  assert.ok(r.facts.some((f: any) => f.label === "Target" && /default, not yet individualised/.test(f.value)));
  assert.equal(r.action.wizard, "diabetes");

  const b = await newPatient(["cad-ccs"]);
  await diabetes(b, { severeHypo: "Yes" });
  await obs(b, [{ code: "hba1c", value: 7.6 }]);
  assert.equal(await one(b, "dm.glycaemic-control"), undefined, "7.6% meets the less stringent <8% target");

  const c = await newPatient(["cad-ccs"]);
  await diabetes(c, { target: "<6.5%" });
  await obs(c, [{ code: "hba1c", value: 6.8 }]);
  assert.match((await one(c, "dm.glycaemic-control")).title, /above target <6\.5%/);
});

test("heart failure: pioglitazone is red, saxagliptin orange; both stop from the alert", async () => {
  const pid = await newPatient(["hfpef"]);
  await diabetes(pid);
  await start(pid, "pioglitazone", 30, "OD");
  await start(pid, "saxagliptin", 5, "OD");
  const all = await rec(pid, "dm.hf-unsafe-agent");
  const pio = all.find((r) => r.title.startsWith("Pioglitazone"));
  const saxa = all.find((r) => r.title.startsWith("Saxagliptin"));
  assert.equal(pio.severity, "red");
  assert.equal(saxa.severity, "orange");
  assert.equal(pio.action.type, "med-action");
  // no HF: no alert
  const p2 = await newPatient(["cad-ccs"]);
  await diabetes(p2);
  await start(p2, "pioglitazone", 30, "OD");
  assert.deepEqual(await rec(p2, "dm.hf-unsafe-agent"), []);
});

test("metformin: eGFR 38 on 2000 mg/day → reduce; eGFR 24 → stop", async () => {
  const pid = await newPatient(["hfref"]);
  await diabetes(pid);
  await start(pid, "metformin", 1000, "BID");
  await obs(pid, [{ code: "creatinine", value: 140 }]);
  const egfr = (await loadState(db, pid)).resolved("egfr").current!.value_num!;
  assert.ok(egfr >= 30 && egfr < 45, `eGFR ${egfr} in 30–44`);
  const r = await one(pid, "dm.metformin-renal");
  assert.match(r.title, /Metformin 2,000 mg\/day with eGFR \d+: reduce/);
  assert.equal(r.action.action, "decrease");
  await obs(pid, [{ code: "creatinine", value: 200 }]);
  const s = await one(pid, "dm.metformin-renal");
  assert.equal(s.severity, "red");
  assert.equal(s.action.action, "stop");
});

test("hypoglycaemia risk: glibenclamide at 78 is orange; DPP-4 with GLP-1 RA is flagged", async () => {
  const pid = await newPatient(["cad-ccs"], "1948-03-01");
  await diabetes(pid);
  await start(pid, "glibenclamide", 5, "OD");
  const r = await one(pid, "dm.hypo-risk");
  assert.equal(r.severity, "orange");
  assert.match(r.title, /Hypoglycaemia risk on glibenclamide \(glyburide\): long-acting sulfonylurea/);
  await start(pid, "sitagliptin", 100, "OD");
  await start(pid, "semaglutide", 0.5, "Weekly");
  const d = await one(pid, "dm.dpp4-with-glp1");
  assert.match(d.title, /Sitagliptin with semaglutide: stop the DPP-4 inhibitor/);
  // age alone does not alert
  const p2 = await newPatient(["cad-ccs"], "1940-01-01");
  await diabetes(p2);
  await start(p2, "gliclazide", 60, "OD");
  assert.equal(await one(p2, "dm.hypo-risk"), undefined);
});

test("annual checks and SGLT2 inhibitor before a planned procedure", async () => {
  const pid = await newPatient(["cad-ccs"]);
  await diabetes(pid);
  assert.match((await one(pid, "dm.annual-checks")).title, /retinal screening and foot examination/);
  await start(pid, "empagliflozin", 10, "OD");
  await tx(async (q) => {
    await K.addPlanAction(q, doc, pid, { category: "procedure", title: "Coronary angiography", dueDate: addDays(T, 5), completesOn: { type: "manual" } });
    await K.addPlanAction(q, doc, pid, { category: "referral", title: "Diabetic retinal screening", dueDate: addDays(T, 28), completesOn: { type: "manual" } });
    await reassess(q, pid, "sandbox");
  });
  const p = await one(pid, "dm.sglt2-before-procedure");
  assert.match(p.title, /Coronary angiography on .*: hold empagliflozin 3 days before/);
  assert.equal(p.action.action, "hold");
  assert.equal((await one(pid, "dm.annual-checks")).title, "Diabetes annual check due: foot examination");
});

test("diabetes pathway: offers only what fits, records brands, stops unsafe drugs, reduces doses", async () => {
  const pid = await newPatient(["hfref"]);
  await diabetes(pid);
  await start(pid, "sacubitril-valsartan", 49, "BID", "hf");
  await start(pid, "dapagliflozin", 10, "OD", "hf");
  await start(pid, "pioglitazone", 30, "OD");
  await start(pid, "glimepiride", 4, "OD");
  await obs(pid, [{ code: "hba1c", value: 8.2 }]);
  const w = await tx((q) => getWizard(q, pid, "diabetes"));
  const opts = (qid: string) => optionsFor(WIZARDS.diabetes.steps.flatMap((s) => s.questions).find((q) => q.id === qid)!, w.context).map((o) => o.value);
  assert.ok(!opts("protect").includes("sglt2"), "already on an SGLT2 inhibitor");
  assert.ok(opts("protect").includes("finerenone"), "on ARNI without MRA");
  assert.ok(opts("safety").includes("stop-tzd"));
  assert.ok(!opts("safety").includes("stop-metformin"));
  const recId = (await one(pid, "dm.glycaemic-control")).id;
  const out = await tx((q) => completeWizard(q, doc, pid, "diabetes", {
    answers: { control: "above", protect: ["glp1", "finerenone"], lower: ["no-change"], safety: ["stop-tzd", "reduce-su"], suDose: "2", monitoring: ["hba1c", "eyes"], review: "clinic-90" },
    recommendationId: recId,
  }));
  assert.equal(await status(pid, "pioglitazone"), "stopped");
  const st = await loadState(db, pid);
  assert.equal(st.meds.find((m) => m.code === "glimepiride")!.doseValue, 2);
  const titles = out.outcome.filter((o) => o.kind === "plan").map((o: any) => o.title);
  assert.ok(titles.includes("Start a GLP-1 RA with proven benefit: Semaglutide (Ozempic), Dulaglutide (Trulicity) or Liraglutide (Victoza)"), titles.join(" | "));
  assert.ok(titles.includes("Start finerenone (Kerendia); potassium at 4 weeks"));
  assert.ok(titles.includes("HbA1c") && titles.includes("Diabetic retinal screening") && titles.includes("Clinic review"));
  await tx((q) => reassess(q, pid, "sandbox", out.changed));
  assert.equal(await one(pid, "dm.hf-unsafe-agent"), undefined, "pioglitazone alert closes once stopped");
});

test("sick-day rules hold SGLT2i, metformin and sulfonylurea (AUTO), never insulin", async () => {
  const pid = await newPatient(["hfref"]);
  await diabetes(pid);
  await start(pid, "empagliflozin", 10, "OD", "hf");
  await start(pid, "metformin", 500, "BID");
  await start(pid, "gliclazide", 60, "OD");
  await start(pid, "insulin-glargine", 18, "OD");
  await start(pid, "furosemide", 40, "OD", "hf");
  const w = await tx((q) => getWizard(q, pid, "sick-day"));
  assert.deepEqual(w.context.detected.pause.sort(), ["metformin", "sglt2", "sulfonylurea"]);
  assert.deepEqual(w.context.detected.checks, ["basal"]);
  await tx((q) => completeWizard(q, doc, pid, "sick-day", {
    answers: { illness: ["vomiting"], redflags: ["none"], pause: w.context.detected.pause, checks: ["basal", "ketones", "restart"], recheck: "1", review: "phone-1" },
  }));
  for (const c of ["empagliflozin", "metformin", "gliclazide"]) assert.equal(await status(pid, c), "held", c);
  assert.equal(await status(pid, "insulin-glargine"), "active");
  assert.equal(await status(pid, "furosemide"), "active", "diuretic not paused unless chosen");
});

test("Ramadan plan: risk category, timing advice per drug, break-fast rule", async () => {
  const pid = await newPatient(["cad-ccs"]);
  await diabetes(pid);
  await start(pid, "metformin", 1000, "BID");
  await start(pid, "insulin-glargine", 20, "OD");
  const w = await tx((q) => getWizard(q, pid, "ramadan"));
  assert.deepEqual(w.context.detected.meds.sort(), ["basal", "metformin"]);
  assert.deepEqual(w.context.detected.risk, ["insulin"]);
  const preview = buildOutcome("ramadan", { risk: ["insulin", "stable-cvd"], category: "moderate", advice: "fast-plan", meds: ["metformin", "basal"], monitoring: ["break"], review: "clinic-28" }, w.context);
  const titles = preview.filter((o) => o.kind === "plan").map((o: any) => o.title);
  assert.deepEqual(titles, [
    "Ramadan: metformin at iftar (and suhoor)",
    "Ramadan: basal insulin at iftar, dose reduced per diabetes plan",
    "When to break the fast: glucose <3.9 or >16.6 mmol/L, or symptoms",
    "Clinic review",
  ]);
  assert.ok(!preview.some((o) => o.kind === "medication"), "Ramadan plan never changes a dose");
});
