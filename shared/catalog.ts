// CardioFlow catalogue: diagnoses, labs, vitals, medications.
// Dose options are label strengths, marked "draft" until pharmacist/clinical review.
// Reference intervals are site-configurable defaults, not treatment thresholds.

export type LabDef = {
  code: string;
  display: string;
  short: string;
  unit: string;
  category: string;
  // conversions from other units into `unit`
  convert?: Record<string, number>;
  ref?: { low?: number; high?: number };
  decimals: number;
  derived?: boolean;
};

export const LABS: LabDef[] = [
  { code: "creatinine", display: "Creatinine", short: "Cr", unit: "µmol/L", category: "Renal", convert: { "mg/dL": 88.42 }, ref: { low: 62, high: 106 }, decimals: 0 },
  { code: "egfr", display: "eGFR (CKD-EPI 2021)", short: "eGFR", unit: "mL/min/1.73m²", category: "Renal", decimals: 0, derived: true, ref: { low: 60 } },
  { code: "urea", display: "Urea", short: "Urea", unit: "mmol/L", category: "Renal", ref: { low: 2.5, high: 7.8 }, decimals: 1 },
  { code: "sodium", display: "Sodium", short: "Na", unit: "mmol/L", category: "Renal", ref: { low: 135, high: 145 }, decimals: 0 },
  { code: "potassium", display: "Potassium", short: "K", unit: "mmol/L", category: "Renal", ref: { low: 3.5, high: 5.1 }, decimals: 1 },
  { code: "magnesium", display: "Magnesium", short: "Mg", unit: "mmol/L", category: "Renal", ref: { low: 0.7, high: 1.0 }, decimals: 2 },
  { code: "haemoglobin", display: "Haemoglobin", short: "Hb", unit: "g/dL", category: "Haematology", convert: { "g/L": 0.1 }, ref: { low: 13, high: 17 }, decimals: 1 },
  { code: "platelets", display: "Platelets", short: "Plt", unit: "10⁹/L", category: "Haematology", ref: { low: 150, high: 400 }, decimals: 0 },
  { code: "ferritin", display: "Ferritin", short: "Ferritin", unit: "µg/L", category: "Iron", decimals: 0 },
  { code: "tsat", display: "Transferrin saturation", short: "TSAT", unit: "%", category: "Iron", decimals: 0 },
  { code: "nt-probnp", display: "NT-proBNP", short: "NT-proBNP", unit: "pg/mL", category: "Cardiac", decimals: 0 },
  { code: "hs-troponin", display: "hs-Troponin", short: "hsTn", unit: "ng/L", category: "Cardiac", decimals: 0 },
  { code: "total-cholesterol", display: "Total cholesterol", short: "TC", unit: "mmol/L", category: "Lipids", decimals: 1 },
  { code: "ldl-c", display: "LDL-C", short: "LDL", unit: "mmol/L", category: "Lipids", decimals: 2 },
  { code: "hdl-c", display: "HDL-C", short: "HDL", unit: "mmol/L", category: "Lipids", decimals: 2 },
  { code: "triglycerides", display: "Triglycerides", short: "TG", unit: "mmol/L", category: "Lipids", decimals: 1 },
  { code: "uacr", display: "Urine albumin:creatinine ratio", short: "UACR", unit: "mg/mmol", category: "Renal", convert: { "mg/g": 0.113 }, ref: { high: 3 }, decimals: 1 },
  { code: "lpa", display: "Lipoprotein(a)", short: "Lp(a)", unit: "nmol/L", category: "Lipids", ref: { high: 105 }, decimals: 0 },
  { code: "hs-crp", display: "hs-CRP", short: "hsCRP", unit: "mg/L", category: "Inflammation", ref: { high: 2 }, decimals: 1 },
  { code: "hba1c", display: "HbA1c", short: "HbA1c", unit: "%", category: "Metabolic", decimals: 1 },
  { code: "glucose", display: "Glucose", short: "Glu", unit: "mmol/L", category: "Metabolic", decimals: 1 },
  { code: "alt", display: "ALT", short: "ALT", unit: "U/L", category: "Liver", ref: { high: 45 }, decimals: 0 },
  { code: "inr", display: "INR", short: "INR", unit: "ratio", category: "Coagulation", decimals: 1 },
  { code: "tsh", display: "TSH", short: "TSH", unit: "mIU/L", category: "Thyroid", ref: { low: 0.4, high: 4.0 }, decimals: 2 },
];

export const VITALS: LabDef[] = [
  { code: "sbp", display: "Systolic BP", short: "SBP", unit: "mmHg", category: "Vitals", decimals: 0 },
  { code: "dbp", display: "Diastolic BP", short: "DBP", unit: "mmHg", category: "Vitals", decimals: 0 },
  { code: "hr", display: "Heart rate", short: "HR", unit: "bpm", category: "Vitals", decimals: 0 },
  { code: "weight", display: "Weight", short: "Wt", unit: "kg", category: "Vitals", decimals: 1 },
  { code: "height", display: "Height", short: "Ht", unit: "cm", category: "Vitals", decimals: 0 },
  { code: "spo2", display: "SpO₂", short: "SpO₂", unit: "%", category: "Vitals", decimals: 0 },
  { code: "lvef", display: "LVEF", short: "LVEF", unit: "%", category: "Echo", decimals: 0 },
];

export const MEASURES: Record<string, LabDef> = Object.fromEntries(
  [...LABS, ...VITALS].map((l) => [l.code, l]),
);

// Status-type findings recorded as text observations
export const FINDINGS = {
  nyha: { display: "NYHA class", options: ["I", "II", "III", "IV"] },
  congestion: { display: "Congestion", options: ["None", "Mild", "Moderate", "Severe"] },
} as const;

export const LAB_PRESETS: { id: string; label: string; codes: string[] }[] = [
  { id: "renal", label: "Renal profile", codes: ["creatinine", "urea", "sodium", "potassium"] },
  { id: "hf", label: "HF monitoring", codes: ["creatinine", "potassium", "sodium", "nt-probnp"] },
  { id: "lipids", label: "Lipids", codes: ["total-cholesterol", "ldl-c", "hdl-c", "triglycerides"] },
  { id: "metabolic", label: "Diabetes & kidney", codes: ["hba1c", "creatinine", "uacr"] },
  { id: "iron", label: "Iron / anaemia", codes: ["haemoglobin", "ferritin", "tsat"] },
  { id: "anticoag", label: "Anticoagulation", codes: ["inr", "haemoglobin", "creatinine"] },
];

export type DiagnosisDef = { code: string; display: string; family: string; tags: string[] };

export const DIAGNOSES: DiagnosisDef[] = [
  { code: "hfref", display: "HFrEF", family: "Heart failure", tags: ["hf"] },
  { code: "hfmref", display: "HFrEF (LVEF 41–49%)", family: "Heart failure", tags: ["hf"] },
  { code: "hfpef", display: "HFpEF", family: "Heart failure", tags: ["hf"] },
  { code: "hfimpef", display: "HF with improved EF", family: "Heart failure", tags: ["hf"] },
  { code: "cad-ccs", display: "Chronic coronary syndrome", family: "Coronary", tags: ["cad", "ascvd"] },
  { code: "prior-mi", display: "Previous MI", family: "Coronary", tags: ["cad", "ascvd"] },
  { code: "prior-pci", display: "Previous PCI", family: "Coronary", tags: ["cad", "ascvd"] },
  { code: "prior-cabg", display: "Previous CABG", family: "Coronary", tags: ["cad", "ascvd"] },
  { code: "acs-stemi", display: "STEMI", family: "Coronary", tags: ["cad", "acs", "ascvd"] },
  { code: "acs-nstemi", display: "NSTEMI", family: "Coronary", tags: ["cad", "acs", "ascvd"] },
  { code: "as", display: "Aortic stenosis", family: "Valve", tags: ["valve"] },
  { code: "ar", display: "Aortic regurgitation", family: "Valve", tags: ["valve"] },
  { code: "mr-primary", display: "Primary MR", family: "Valve", tags: ["valve"] },
  { code: "mr-secondary", display: "Secondary MR", family: "Valve", tags: ["valve"] },
  { code: "ms", display: "Mitral stenosis", family: "Valve", tags: ["valve"] },
  { code: "tr", display: "Tricuspid regurgitation", family: "Valve", tags: ["valve"] },
  { code: "af", display: "Atrial fibrillation", family: "Arrhythmia", tags: ["af"] },
  { code: "flutter", display: "Atrial flutter", family: "Arrhythmia", tags: ["af"] },
  { code: "vt", display: "Ventricular tachycardia", family: "Arrhythmia", tags: [] },
  { code: "htn", display: "Hypertension", family: "Comorbidity", tags: ["htn"] },
  { code: "t2dm", display: "Type 2 diabetes", family: "Comorbidity", tags: ["dm", "t2dm"] },
  { code: "t1dm", display: "Type 1 diabetes", family: "Comorbidity", tags: ["dm"] },
  { code: "fh", display: "Familial hypercholesterolaemia", family: "Comorbidity", tags: ["lipids", "fh"] },
  { code: "statin-intolerance", display: "Statin intolerance", family: "Comorbidity", tags: ["statin-intolerance"] },
  { code: "ckd-3a", display: "CKD 3a", family: "Comorbidity", tags: ["ckd"] },
  { code: "ckd-3b", display: "CKD 3b", family: "Comorbidity", tags: ["ckd"] },
  { code: "ckd-4", display: "CKD 4", family: "Comorbidity", tags: ["ckd"] },
  { code: "dyslipidaemia", display: "Dyslipidaemia", family: "Comorbidity", tags: ["lipids"] },
  { code: "obesity", display: "Obesity", family: "Comorbidity", tags: ["obesity"] },
  { code: "stroke-tia", display: "Stroke / TIA", family: "Comorbidity", tags: ["ascvd", "stroke"] },
  { code: "pad", display: "Peripheral arterial disease", family: "Comorbidity", tags: ["cad", "ascvd", "vascular"] },
  { code: "copd", display: "COPD", family: "Comorbidity", tags: [] },
  { code: "osa", display: "Obstructive sleep apnoea", family: "Comorbidity", tags: [] },
  { code: "anaemia", display: "Anaemia", family: "Comorbidity", tags: [] },
  { code: "thyroid", display: "Thyroid disease", family: "Comorbidity", tags: [] },
  { code: "smoker", display: "Current smoker", family: "Comorbidity", tags: [] },
];
export const DIAGNOSIS: Record<string, DiagnosisDef> = Object.fromEntries(DIAGNOSES.map((d) => [d.code, d]));

export type MedicationDef = {
  code: string;
  name: string;
  drugClass: string;
  // clinical purpose used to group the medication list
  purpose: "Heart failure" | "CAD / secondary prevention" | "Anticoagulation" | "Rhythm" | "Blood pressure" | "Cardiometabolic" | "Pulmonary hypertension";
  tags: string[]; // raas, acei, arb, arni, mra, sglt2, loop, bb, antiplatelet, statin, oac, potassium-sparing
  indications: string[]; // diagnosis tags this drug is commonly used for
  unit: string;
  doses: number[]; // label strengths — draft, pending review
  doseLabels?: string[];
  frequencies: string[];
  routes: string[];
  monitoring: string[]; // codes to check before start / after changes
  target?: number; // guideline target dose (ESC HF 2026 table) — same unit as doses
};

const m = (
  code: string, name: string, drugClass: string, purpose: MedicationDef["purpose"], tags: string[],
  indications: string[], unit: string, doses: number[], frequencies: string[], monitoring: string[],
  extra: Partial<MedicationDef> = {},
): MedicationDef => ({ code, name, drugClass, purpose, tags, indications, unit, doses, frequencies, routes: ["PO"], monitoring, ...extra });

const RENAL_K = ["potassium", "creatinine", "egfr", "sbp"];

export const MEDICATIONS: MedicationDef[] = [
  m("sacubitril-valsartan", "Sacubitril/valsartan", "ARNI", "Heart failure", ["raas", "arni"], ["hf"], "mg", [24, 49, 97], ["BID"], RENAL_K, { doseLabels: ["24/26 mg", "49/51 mg", "97/103 mg"] , target: 97 }),
  m("ramipril", "Ramipril", "ACE inhibitor", "Heart failure", ["raas", "acei"], ["hf", "htn", "cad"], "mg", [1.25, 2.5, 5, 10], ["OD", "BID"], RENAL_K, { target: 10 }),
  m("perindopril", "Perindopril", "ACE inhibitor", "Blood pressure", ["raas", "acei"], ["htn", "cad"], "mg", [2, 4, 8], ["OD"], RENAL_K, { target: 8 }),
  m("lisinopril", "Lisinopril", "ACE inhibitor", "Blood pressure", ["raas", "acei"], ["htn", "hf"], "mg", [2.5, 5, 10, 20], ["OD"], RENAL_K, { target: 20 }),
  m("candesartan", "Candesartan", "ARB", "Heart failure", ["raas", "arb"], ["hf", "htn"], "mg", [4, 8, 16, 32], ["OD"], RENAL_K, { target: 32 }),
  m("valsartan", "Valsartan", "ARB", "Heart failure", ["raas", "arb"], ["hf", "htn"], "mg", [40, 80, 160], ["BID", "OD"], RENAL_K, { target: 160 }),
  m("losartan", "Losartan", "ARB", "Blood pressure", ["raas", "arb"], ["htn"], "mg", [25, 50, 100, 150], ["OD"], RENAL_K, { target: 150 }),
  m("bisoprolol", "Bisoprolol", "Beta blocker", "Heart failure", ["bb"], ["hf", "cad", "af", "htn"], "mg", [1.25, 2.5, 3.75, 5, 7.5, 10], ["OD"], ["hr", "sbp"], { target: 10 }),
  m("carvedilol", "Carvedilol", "Beta blocker", "Heart failure", ["bb"], ["hf", "cad"], "mg", [3.125, 6.25, 12.5, 25], ["BID"], ["hr", "sbp"], { target: 25 }),
  m("metoprolol-succinate", "Metoprolol succinate", "Beta blocker", "Heart failure", ["bb"], ["hf", "cad", "af"], "mg", [12.5, 25, 50, 100, 200], ["OD"], ["hr", "sbp"], { target: 200 }),
  m("spironolactone", "Spironolactone", "Steroidal MRA", "Heart failure", ["mra", "potassium-sparing"], ["hf", "htn"], "mg", [12.5, 25, 50], ["OD"], ["potassium", "creatinine", "egfr"], { target: 50 }),
  m("eplerenone", "Eplerenone", "Steroidal MRA", "Heart failure", ["mra", "potassium-sparing"], ["hf", "cad"], "mg", [25, 50], ["OD"], ["potassium", "creatinine", "egfr"], { target: 50 }),
  m("finerenone", "Finerenone", "Nonsteroidal MRA", "Heart failure", ["mra", "potassium-sparing"], ["ckd", "dm", "hf"], "mg", [10, 20], ["OD"], ["potassium", "egfr"], { target: 40 }),
  m("dapagliflozin", "Dapagliflozin", "SGLT2 inhibitor", "Heart failure", ["sglt2"], ["hf", "ckd", "dm"], "mg", [10], ["OD"], ["egfr"], { target: 10 }),
  m("empagliflozin", "Empagliflozin", "SGLT2 inhibitor", "Heart failure", ["sglt2"], ["hf", "ckd", "dm"], "mg", [10], ["OD"], ["egfr"], { target: 10 }),
  m("furosemide", "Furosemide", "Loop diuretic", "Heart failure", ["loop"], ["hf"], "mg", [20, 40, 80], ["OD", "BID"], ["creatinine", "potassium", "sodium", "weight"], { routes: ["PO", "IV"] }),
  m("bumetanide", "Bumetanide", "Loop diuretic", "Heart failure", ["loop"], ["hf"], "mg", [0.5, 1, 2], ["OD", "BID"], ["creatinine", "potassium", "sodium", "weight"], { routes: ["PO", "IV"] }),
  m("torsemide", "Torsemide", "Loop diuretic", "Heart failure", ["loop"], ["hf"], "mg", [10, 20, 40], ["OD"], ["creatinine", "potassium", "sodium", "weight"]),
  m("ivabradine", "Ivabradine", "If-channel inhibitor", "Heart failure", [], ["hf"], "mg", [2.5, 5, 7.5], ["BID"], ["hr"]),
  m("digoxin", "Digoxin", "Cardiac glycoside", "Rhythm", [], ["hf", "af"], "mg", [0.0625, 0.125, 0.25], ["OD"], ["potassium", "creatinine", "hr"]),
  m("hydralazine", "Hydralazine", "Vasodilator", "Heart failure", [], ["hf", "htn"], "mg", [25, 50, 75], ["TID"], ["sbp"]),
  m("isosorbide-dinitrate", "Isosorbide dinitrate", "Nitrate", "Heart failure", [], ["hf", "cad"], "mg", [20, 40], ["TID"], ["sbp"]),
  m("alirocumab", "Alirocumab", "PCSK9 antibody", "CAD / secondary prevention", ["pcsk9", "lipid"], ["cad", "lipids"], "mg", [75, 150], ["Every 2 weeks"], ["ldl-c"], { routes: ["SC"] }),
  m("bempedoic-acid", "Bempedoic acid", "ACL inhibitor", "CAD / secondary prevention", ["lipid"], ["cad", "lipids"], "mg", [180], ["OD"], ["ldl-c"]),
  m("icosapent-ethyl", "Icosapent ethyl", "Omega-3 (EPA)", "CAD / secondary prevention", [], ["cad", "lipids"], "g", [2], ["BID"], ["triglycerides"]),
  m("liraglutide", "Liraglutide", "GLP-1 receptor agonist", "Cardiometabolic", ["glp1", "glp1-cv"], ["dm", "cad"], "mg", [0.6, 1.2, 1.8], ["OD"], ["weight", "hba1c"], { routes: ["SC"] }),
  m("dulaglutide", "Dulaglutide", "GLP-1 receptor agonist", "Cardiometabolic", ["glp1", "glp1-cv"], ["dm", "cad"], "mg", [0.75, 1.5, 3, 4.5], ["Weekly"], ["weight", "hba1c"], { routes: ["SC"] }),
  m("enalapril", "Enalapril", "ACE inhibitor", "Heart failure", ["raas", "acei"], ["hf", "htn"], "mg", [2.5, 5, 10, 20], ["BID"], RENAL_K, { target: 20 }),
  m("sotagliflozin", "Sotagliflozin", "SGLT1/2 inhibitor", "Heart failure", ["sglt2"], ["hf", "dm"], "mg", [200, 400], ["OD"], ["egfr"]),
  m("ferric-carboxymaltose", "Ferric carboxymaltose (IV)", "IV iron", "Heart failure", ["iv-iron"], ["hf"], "mg", [500, 750, 1000], ["Single infusion"], ["haemoglobin", "ferritin", "tsat"], { routes: ["IV"] }),
  m("ferric-derisomaltose", "Ferric derisomaltose (IV)", "IV iron", "Heart failure", ["iv-iron"], ["hf"], "mg", [500, 1000, 1500, 2000], ["Single infusion"], ["haemoglobin", "ferritin", "tsat"], { routes: ["IV"] }),
  m("vericiguat", "Vericiguat", "sGC stimulator", "Heart failure", [], ["hf"], "mg", [2.5, 5, 10], ["OD"], ["sbp"], { target: 10 }),
  m("aspirin", "Aspirin", "Antiplatelet", "CAD / secondary prevention", ["antiplatelet"], ["cad"], "mg", [75, 81, 100], ["OD"], ["haemoglobin"]),
  m("clopidogrel", "Clopidogrel", "P2Y12 inhibitor", "CAD / secondary prevention", ["antiplatelet", "p2y12"], ["cad"], "mg", [75], ["OD"], ["haemoglobin"]),
  m("ticagrelor", "Ticagrelor", "P2Y12 inhibitor", "CAD / secondary prevention", ["antiplatelet", "p2y12"], ["cad"], "mg", [60, 90], ["BID"], ["haemoglobin"]),
  m("prasugrel", "Prasugrel", "P2Y12 inhibitor", "CAD / secondary prevention", ["antiplatelet", "p2y12"], ["cad"], "mg", [5, 10], ["OD"], ["haemoglobin"]),
  m("atorvastatin", "Atorvastatin", "Statin", "CAD / secondary prevention", ["statin", "lipid"], ["cad", "lipids", "dm"], "mg", [10, 20, 40, 80], ["Nightly", "OD"], ["ldl-c", "alt"]),
  m("rosuvastatin", "Rosuvastatin", "Statin", "CAD / secondary prevention", ["statin", "lipid"], ["cad", "lipids", "dm"], "mg", [5, 10, 20, 40], ["OD"], ["ldl-c", "alt"]),
  m("ezetimibe", "Ezetimibe", "Cholesterol absorption inhibitor", "CAD / secondary prevention", ["ezetimibe", "lipid"], ["cad", "lipids"], "mg", [10], ["OD"], ["ldl-c"]),
  m("evolocumab", "Evolocumab", "PCSK9 antibody", "CAD / secondary prevention", ["pcsk9", "lipid"], ["cad", "lipids"], "mg", [140], ["Every 2 weeks"], ["ldl-c"], { routes: ["SC"] }),
  m("inclisiran", "Inclisiran", "PCSK9 siRNA", "CAD / secondary prevention", ["pcsk9", "lipid"], ["cad", "lipids"], "mg", [284], ["Day 0, 3 months, then every 6 months"], ["ldl-c"], { routes: ["SC"] }),
  m("apixaban", "Apixaban", "Factor Xa inhibitor", "Anticoagulation", ["oac"], ["af"], "mg", [2.5, 5], ["BID"], ["creatinine", "haemoglobin", "weight"]),
  m("rivaroxaban", "Rivaroxaban", "Factor Xa inhibitor", "Anticoagulation", ["oac"], ["af"], "mg", [15, 20], ["OD"], ["creatinine", "haemoglobin"]),
  m("edoxaban", "Edoxaban", "Factor Xa inhibitor", "Anticoagulation", ["oac"], ["af"], "mg", [30, 60], ["OD"], ["creatinine", "haemoglobin", "weight"]),
  m("dabigatran", "Dabigatran", "Direct thrombin inhibitor", "Anticoagulation", ["oac"], ["af"], "mg", [110, 150], ["BID"], ["creatinine", "haemoglobin"]),
  m("warfarin", "Warfarin", "Vitamin K antagonist", "Anticoagulation", ["oac"], ["af", "valve"], "mg", [1, 2, 3, 5], ["OD"], ["inr", "haemoglobin"]),
  m("amiodarone", "Amiodarone", "Class III antiarrhythmic", "Rhythm", [], ["af"], "mg", [100, 200], ["OD"], ["tsh", "alt", "hr"]),
  m("flecainide", "Flecainide", "Class Ic antiarrhythmic", "Rhythm", [], ["af"], "mg", [50, 100], ["BID"], ["hr"]),
  m("diltiazem", "Diltiazem", "Calcium-channel blocker", "Rhythm", [], ["af", "htn"], "mg", [60, 120, 180, 240], ["OD", "TID"], ["hr", "sbp"]),
  m("amlodipine", "Amlodipine", "Calcium-channel blocker", "Blood pressure", [], ["htn", "cad"], "mg", [2.5, 5, 10], ["OD"], ["sbp"]),
  m("indapamide", "Indapamide", "Thiazide-like diuretic", "Blood pressure", [], ["htn"], "mg", [1.5, 2.5], ["OD"], ["sodium", "potassium"]),
  m("metformin", "Metformin", "Biguanide", "Cardiometabolic", [], ["dm"], "mg", [500, 850, 1000], ["OD", "BID"], ["egfr"]),
  m("semaglutide", "Semaglutide", "GLP-1 receptor agonist", "Cardiometabolic", ["glp1", "glp1-cv"], ["dm", "cad"], "mg", [0.25, 0.5, 1, 1.7, 2, 2.4], ["Weekly"], ["weight", "hba1c"], { routes: ["SC"] }),
  m("tirzepatide", "Tirzepatide", "Dual GIP/GLP-1 agonist", "Cardiometabolic", ["glp1"], ["dm", "obesity"], "mg", [2.5, 5, 7.5, 10, 12.5, 15], ["Weekly"], ["weight", "hba1c"], { routes: ["SC"] }),
  m("sildenafil", "Sildenafil", "PDE-5 inhibitor", "Pulmonary hypertension", [], [], "mg", [20], ["TID"], ["sbp"]),
];
export const MEDICATION: Record<string, MedicationDef> = Object.fromEntries(MEDICATIONS.map((d) => [d.code, d]));

export const PURPOSE_ORDER: MedicationDef["purpose"][] = [
  "Heart failure", "CAD / secondary prevention", "Anticoagulation", "Rhythm", "Blood pressure", "Cardiometabolic", "Pulmonary hypertension",
];

// Which medication purposes are relevant to which diagnosis tags
export const PURPOSE_FOR_TAG: Record<string, MedicationDef["purpose"][]> = {
  hf: ["Heart failure"],
  cad: ["CAD / secondary prevention"],
  acs: ["CAD / secondary prevention"],
  af: ["Anticoagulation", "Rhythm"],
  htn: ["Blood pressure"],
  dm: ["Cardiometabolic"],
  ckd: ["Cardiometabolic"],
  lipids: ["CAD / secondary prevention"],
};

export function doseLabel(def: MedicationDef | undefined, value: number | null | undefined, unit?: string | null) {
  if (value == null) return "Dose not recorded";
  if (def?.doseLabels) {
    const i = def.doses.indexOf(value);
    if (i >= 0) return def.doseLabels[i];
  }
  return `${formatNumber(value)} ${unit ?? def?.unit ?? ""}`.trim();
}

export function formatNumber(value: number, decimals?: number) {
  if (decimals != null) return value.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return value.toLocaleString("en-GB", { maximumFractionDigits: 4 });
}

export const PLAN_TEMPLATES: { id: string; category: string; title: string; completesOn: Record<string, unknown>; offsets: number[] }[] = [
  { id: "renal-k", category: "monitoring", title: "Renal function and potassium check", completesOn: { type: "lab", codes: ["potassium", "creatinine"] }, offsets: [3, 7, 14] },
  { id: "hf-clinic", category: "follow_up", title: "HF clinic review", completesOn: { type: "visit" }, offsets: [7, 14, 28] },
  { id: "titration", category: "medication", title: "HF medication titration review", completesOn: { type: "visit" }, offsets: [14, 28] },
  { id: "echo", category: "investigation", title: "Repeat Echo", completesOn: { type: "study", kind: "echo" }, offsets: [90, 180] },
  { id: "device", category: "follow_up", title: "ICD/CRT reassessment after repeat Echo", completesOn: { type: "manual" }, offsets: [90, 180] },
  { id: "rehab", category: "referral", title: "Cardiac rehabilitation referral", completesOn: { type: "manual" }, offsets: [7, 14] },
  { id: "lipids", category: "monitoring", title: "Lipid profile", completesOn: { type: "lab", codes: ["ldl-c"] }, offsets: [42, 84] },
  { id: "iron", category: "monitoring", title: "Iron studies", completesOn: { type: "lab", codes: ["ferritin", "tsat"] }, offsets: [7, 28] },
  { id: "phone", category: "follow_up", title: "Phone follow-up", completesOn: { type: "manual" }, offsets: [3, 7] },
  { id: "education", category: "education", title: "HF self-care education", completesOn: { type: "manual" }, offsets: [0, 7] },
];
