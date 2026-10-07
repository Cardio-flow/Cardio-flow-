import { MEDICATION } from "../shared/catalog.js";
// Guideline suggestions inside pathways (3 Oct 2026): each question proposes the option(s) the
// guideline recommends for this patient's data and answers, with the reason; the clinician applies
// or ignores them; suggestions not taken are recorded with the decision.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { GUIDANCE, suggest } from "../shared/wizard-guidance.js";
import { WIZARDS, type WizardContext } from "../shared/wizards.js";
import { createLocalDb, type DB } from "../server/db/db.js";
import { boot, SITE_ID } from "../server/boot.js";
import * as K from "../server/kernel/clinical.js";
import { completeWizard } from "../server/engine/wizard.js";
import { nowIso, today, type Actor } from "../server/kernel/base.js";
import { addDays } from "../shared/clinical.js";

// a mid-range catalogue dose (so "reduce" and "increase" both exist), 1 for codes not in the catalogue
const midDose = (code: string) => { const d = MEDICATION[code]?.doses ?? []; return d.length ? d[Math.min(1, d.length - 1)] : 1; };
const med = (code: string, tags: string[]) => ({ id: code, code, name: code, doseValue: midDose(code), doseUnit: "mg", frequency: "OD", tags });
const ctx = (values: Record<string, number | [number, number]>, meds: [string, string[]][] = [], dx: string[] = [], age = 70): WizardContext => ({
  today: "2026-10-03", facts: [], detected: {},
  meds: meds.map(([c, t]) => med(c, t)),
  values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: Array.isArray(v) ? v[0] : v, prev: Array.isArray(v) ? v[1] : null, at: "2026-10-03T08:00:00Z" }])),
  dx, profile: { age, cvd: dx.length > 0, riskFactors: age >= 65 },
});
const vals = (w: string, q: string, a: any, c: WizardContext) => suggest(w, q, a, c).map((s) => s.value);

test("every suggestion names a real question and a real option, with a reason", () => {
  const rich = ctx(
    { potassium: [6.3, 4.5], creatinine: [200, 100], egfr: 18, sodium: 122, magnesium: 0.5, inr: 11, "digoxin-level": 2.4, glucose: 2.8, ketones: 4, ph: 7.1, bicarbonate: 12, hba1c: 9, uacr: 40, sbp: 85, dbp: 55, hr: 45, rr: 32, temp: 39, lactate: 4.5, urea: 9, spo2: 88, tsh: 0.02, crp: 80 },
    [["spironolactone", ["mra"]], ["ramipril", ["raas", "acei"]], ["furosemide", ["loop"]], ["bisoprolol", ["bb"]], ["digoxin", ["digoxin"]], ["amlodipine", ["vasodilator", "bp-lowering"]],
      ["apixaban", ["oac", "doac"]], ["aspirin", ["antiplatelet"]], ["clopidogrel", ["antiplatelet", "p2y12"]], ["warfarin", ["oac", "vka"]], ["metformin", ["metformin"]], ["gliclazide", ["sulfonylurea"]],
      ["insulin-glargine", ["insulin", "insulin-basal"]], ["pioglitazone", ["tzd"]], ["saxagliptin", ["dpp4", "dpp4-hf"]], ["glibenclamide", ["sulfonylurea", "glibenclamide"]], ["dapagliflozin", ["sglt2"]],
      ["atorvastatin", ["statin"]], ["amiodarone", ["qt"]], ["semaglutide", ["glp1"]], ["hydrochlorothiazide", ["thiazide"]], ["ivabradine", ["ivabradine"]], ["ibuprofen", ["nsaid"]]],
    ["hf", "hfref", "cad", "ckd", "dm", "t2dm", "ascvd", "obesity", "smoker", "mechanical-valve", "af"], 72,
  );
  const answerSets: any[] = [{}, { ecg: "present", symptoms: ["syncope"], volume: "congested", block: "high-grade", type: "mixed", stage: "D", picture: "dka", level: "2", severity: "major", site: "gi", direction: "high", bleeding: "minor", features: ["arrhythmia", "prosthetic", "device", "hf", "embolic"], hmod: ["neuro"], illness: ["vomiting"], redflags: ["dehydrated"], category: "high", urgency: "elective", risk: "high", capacity: "poor", active: ["none"], setting: "cap", curb: ["u", "r", "65"], "cap-abx": "coamox-mac", cardiac: ["sickday"], situation: "thyrotox", myocardium: "yes", duke: "definite" }];
  let count = 0;
  for (const [wid, qs] of Object.entries(GUIDANCE)) {
    const w = WIZARDS[wid];
    assert.ok(w, `${wid} is a pathway`);
    for (const qid of Object.keys(qs)) {
      const q = w.steps.flatMap((s) => s.questions).find((x) => x.id === qid);
      assert.ok(q, `${wid}.${qid} is a question`);
      for (const a of answerSets)
        for (const s of suggest(wid, qid, a, rich)) {
          count++;
          assert.ok(q!.options?.some((o) => o.value === s.value), `${wid}.${qid}: "${s.value}" is an option`);
          assert.ok(s.why.length > 5, `${wid}.${qid}.${s.value} has a reason`);
        }
    }
  }
  assert.ok(count > 120, `many suggestions exercised (${count})`);
  // every pathway has suggestions
  for (const id of Object.keys(WIZARDS)) assert.ok(GUIDANCE[id], `${id} has guideline suggestions`);
});

test("hyperkalaemia: K 6.3 on an MRA → stop MRA, repeat today; K 5.7 → halve MRA, recheck in 1–2 weeks", () => {
  const hi = ctx({ potassium: 6.3 }, [["spironolactone", ["mra"]], ["ramipril", ["raas"]]]);
  assert.deepEqual(vals("hyperkalaemia", "actions", {}, hi).slice(0, 1), ["hold-mra"]);
  assert.ok(!vals("hyperkalaemia", "actions", {}, hi).includes("reduce-mra"));
  assert.deepEqual(vals("hyperkalaemia", "recheck", {}, hi), ["0"]);
  assert.ok(vals("hyperkalaemia", "actions", { ecg: "present" }, hi).includes("urgent"));
  const mid = ctx({ potassium: 5.7 }, [["spironolactone", ["mra"]]]);
  assert.ok(vals("hyperkalaemia", "actions", {}, mid).includes("reduce-mra"));
  assert.deepEqual(vals("hyperkalaemia", "result", {}, mid), ["repeat"]);
  assert.deepEqual(vals("hyperkalaemia", "recheck", {}, mid), ["7"]);
});

test("renal function: +20% → continue; +70% on ARNI → halve; congested → decongest", () => {
  const small = ctx({ creatinine: [120, 100], egfr: 55 }, [["sacubitril-valsartan", ["raas"]]]);
  assert.deepEqual(vals("renal-function", "actions", { volume: "euvolaemic" }, small), ["continue"]);
  const big = suggest("renal-function", "actions", { volume: "euvolaemic" }, ctx({ creatinine: [170, 100], egfr: 38 }, [["sacubitril-valsartan", ["raas"]]]));
  assert.equal(big[0].value, "reduce-raas");
  assert.match(big[0].why, /halve/);
  assert.ok(vals("renal-function", "actions", { volume: "congested" }, ctx({ creatinine: [130, 100] }, [["furosemide", ["loop"]]])).includes("increase-diuretic"));
});

test("chest infection: CURB-65 from the record → severity → NICE antibiotic → interaction checks", () => {
  const c = ctx({ urea: 8.2, rr: 24, sbp: 118, dbp: 70 }, [["atorvastatin", ["statin"]], ["apixaban", ["oac", "doac"]]], ["hf"], 71);
  assert.deepEqual(vals("chest-infection", "curb", {}, c), ["u", "65"]);
  assert.deepEqual(vals("chest-infection", "severity", { setting: "cap", curb: ["u", "65"] }, c), ["moderate"]);
  assert.deepEqual(vals("chest-infection", "cap-abx", { severity: "moderate" }, c), ["amox-mac"]);
  const cardiac = vals("chest-infection", "cardiac", { "cap-abx": "amox-mac" }, c);
  assert.ok(cardiac.includes("statin") && cardiac.includes("doac"));
  assert.ok(vals("chest-infection", "tests", { severity: "moderate" }, c).includes("cardiac"), "cardiac patient: ECG and troponin");
});

test("pre-procedure, diabetes and pericarditis follow their guidelines", () => {
  const c = ctx({}, [["bisoprolol", ["bb"]], ["dapagliflozin", ["sglt2"]]], ["hf"], 70);
  assert.deepEqual(vals("pre-procedure", "tests", { risk: "low", urgency: "elective" }, c), ["none"]);
  const t = vals("pre-procedure", "tests", { risk: "high", urgency: "elective", capacity: "poor" }, c);
  assert.ok(t.includes("troponin") && t.includes("echo") && t.includes("ecg"));
  assert.ok(vals("pre-procedure", "meds", { risk: "high" }, c).includes("sglt2"));
  const dm = ctx({ hba1c: 8.4, egfr: 50 }, [["pioglitazone", ["tzd"]]], ["hf", "t2dm", "dm"]);
  assert.ok(vals("diabetes", "protect", {}, dm).includes("sglt2"));
  assert.ok(vals("diabetes", "safety", {}, dm).includes("stop-tzd"));
  assert.ok(vals("diabetes", "lower", {}, dm).includes("metformin"));
  const peri = vals("pericarditis", "first", {}, ctx({}, [["aspirin", ["antiplatelet"]]], ["cad"]));
  assert.deepEqual(peri, ["aspirin", "colchicine", "ppi"]);
});

let db: DB;
before(async () => { db = await createLocalDb(); await boot(db, { seed: true }); });
after(async () => db.close());

test("a guideline suggestion not taken is written into the Journey entry", async () => {
  const doc: Actor = { id: "dr.test@cardioflow.local", name: "Dr Test", role: "clinician", siteId: SITE_ID };
  const pid = await db.transaction((q) => K.createPatient(q, doc, { name: "Gd " + Date.now(), mrn: "G" + Date.now(), sex: "Male", birthDate: "1960-01-01", conditions: ["hfref"] }));
  await db.transaction(async (q) => {
    await K.startMedication(q, doc, pid, { code: "spironolactone", doseValue: 25, frequency: "OD", route: "PO", indication: "hf", effectiveAt: new Date(addDays(today(), -40) + "T09:00:00Z").toISOString() });
    await K.recordObservations(q, doc, pid, { effectiveAt: nowIso(), items: [{ code: "potassium", value: 6.3 }] });
  });
  await db.transaction((q) => completeWizard(q, doc, pid, "hyperkalaemia", { answers: {
    result: "confirmed", symptoms: ["none"], ecg: "none", contributors: ["mra"], haemolysis: "no", actions: ["diet-advice"], recheck: "3", review: "none",
  } }));
  const ev = (await db.query(`SELECT detail FROM cf.clinical_event WHERE patient_id=$1 AND title LIKE 'Hyperkalaemia%'`, [pid])).rows[0] as any;
  assert.match(ev.detail, /Guideline suggestions not taken: .*Hold MRA/);
});
