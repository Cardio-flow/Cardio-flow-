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
  // highest valid value (e.g. a 0–100 score)
  max?: number;
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
  // assay-specific reference (99th percentile): no default range
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
  { code: "lactate", display: "Lactate", short: "Lactate", unit: "mmol/L", category: "Acute", ref: { high: 2 }, decimals: 1 },
  { code: "bicarbonate", display: "Bicarbonate", short: "HCO₃", unit: "mmol/L", category: "Acute", ref: { low: 22, high: 29 }, decimals: 0 },
  { code: "ph", display: "pH (blood gas)", short: "pH", unit: "", category: "Acute", ref: { low: 7.35, high: 7.45 }, decimals: 2 },
  { code: "ketones", display: "Blood ketones (β-hydroxybutyrate)", short: "Ketones", unit: "mmol/L", category: "Metabolic", ref: { high: 0.6 }, decimals: 1 },
  { code: "wbc", display: "White cell count", short: "WBC", unit: "10⁹/L", category: "Haematology", ref: { low: 4, high: 11 }, decimals: 1 },
  { code: "crp", display: "CRP", short: "CRP", unit: "mg/L", category: "Inflammation", ref: { high: 5 }, decimals: 0 },
  { code: "digoxin-level", display: "Digoxin level", short: "Digoxin", unit: "ng/mL", category: "Drug levels", decimals: 1 },
];

export const VITALS: LabDef[] = [
  { code: "sbp", display: "Systolic BP", short: "SBP", unit: "mmHg", category: "Vitals", decimals: 0 },
  { code: "dbp", display: "Diastolic BP", short: "DBP", unit: "mmHg", category: "Vitals", decimals: 0 },
  { code: "hr", display: "Heart rate", short: "HR", unit: "bpm", category: "Vitals", decimals: 0 },
  { code: "weight", display: "Weight", short: "Wt", unit: "kg", category: "Vitals", decimals: 1 },
  { code: "height", display: "Height", short: "Ht", unit: "cm", category: "Vitals", decimals: 0 },
  { code: "spo2", display: "SpO₂", short: "SpO₂", unit: "%", category: "Vitals", decimals: 0 },
  { code: "temp", display: "Temperature", short: "Temp", unit: "°C", category: "Vitals", decimals: 1 },
  { code: "rr", display: "Respiratory rate", short: "RR", unit: "/min", category: "Vitals", decimals: 0 },
  { code: "lvef", display: "LVEF", short: "LVEF", unit: "%", category: "Echo", decimals: 0 },
];

// HF assessment recorded at a visit: patient-reported health status, functional capacity and the
// clinician's dry (target) weight. Shown in the HF panel, not as labs.
export const HF_MEASURES: LabDef[] = [
  { code: "kccq", display: "KCCQ-12 summary score", short: "KCCQ", unit: "/100", category: "HF", decimals: 0, max: 100 },
  { code: "6mwd", display: "6-minute walk distance", short: "6MWD", unit: "m", category: "HF", decimals: 0, max: 1500 },
  { code: "dry-weight", display: "Dry (target) weight", short: "Dry wt", unit: "kg", category: "HF", decimals: 1, max: 400 },
];

// Measurements that come from studies (entered through the study templates, not quick labs).
export const STUDY_MEASURES: LabDef[] = [
  { code: "qrs", display: "QRS duration", short: "QRS", unit: "ms", category: "ECG", decimals: 0 },
  { code: "pr", display: "PR interval", short: "PR", unit: "ms", category: "ECG", decimals: 0 },
  { code: "qtc", display: "QTc", short: "QTc", unit: "ms", category: "ECG", decimals: 0 },
  { code: "ve-burden", display: "Ventricular ectopic burden", short: "VE burden", unit: "%", category: "Holter", decimals: 1 },
  { code: "mets", display: "Exercise capacity", short: "METs", unit: "METs", category: "Stress", decimals: 1 },
  { code: "cac", display: "Coronary calcium score", short: "CAC", unit: "Agatston", category: "CT", decimals: 0 },
  { code: "rvef", display: "RVEF", short: "RVEF", unit: "%", category: "CMR", decimals: 0 },
  // valve module (Echo): measured values the valve rules read
  { code: "av-vmax", display: "Aortic valve peak velocity", short: "AV Vmax", unit: "m/s", category: "Echo", decimals: 1, max: 8 },
  { code: "av-mg", display: "Aortic valve mean gradient", short: "AV MG", unit: "mmHg", category: "Echo", decimals: 0, max: 200 },
  { code: "ava", display: "Aortic valve area", short: "AVA", unit: "cm²", category: "Echo", decimals: 2, max: 6 },
  { code: "mva", display: "Mitral valve area", short: "MVA", unit: "cm²", category: "Echo", decimals: 1, max: 8 },
  { code: "lvesd", display: "LV end-systolic diameter", short: "LVESD", unit: "mm", category: "Echo", decimals: 0, max: 120 },
  { code: "lvedd", display: "LV end-diastolic diameter", short: "LVEDD", unit: "mm", category: "Echo", decimals: 0, max: 130 },
  { code: "spap", display: "Systolic pulmonary artery pressure", short: "SPAP", unit: "mmHg", category: "Echo", decimals: 0, max: 200 },
  // pulmonary hypertension module: right heart catheter measurements (written from the RHC record)
  { code: "mpap", display: "Mean pulmonary artery pressure", short: "mPAP", unit: "mmHg", category: "RHC", decimals: 0, max: 100 },
  { code: "pawp", display: "Pulmonary artery wedge pressure", short: "PAWP", unit: "mmHg", category: "RHC", decimals: 0, max: 50 },
  { code: "pvr", display: "Pulmonary vascular resistance", short: "PVR", unit: "WU", category: "RHC", decimals: 1, max: 40 },
  { code: "rap", display: "Right atrial pressure", short: "RAP", unit: "mmHg", category: "RHC", decimals: 0, max: 40 },
  { code: "svo2", display: "Mixed venous oxygen saturation", short: "SvO₂", unit: "%", category: "RHC", decimals: 0, max: 95 },
  // pulmonary hypertension module: peak tricuspid regurgitation velocity (echo probability of PH)
  { code: "trv", display: "Peak tricuspid regurgitation velocity", short: "TRV", unit: "m/s", category: "Echo", decimals: 1, max: 7 },
  // cardiomyopathy module: the inputs of HCM risk assessment (echo / CMR) and LGE extent (CMR)
  { code: "mwt", display: "Maximal LV wall thickness", short: "MWT", unit: "mm", category: "Echo", decimals: 0, max: 60 },
  { code: "la-diam", display: "Left atrial diameter", short: "LA", unit: "mm", category: "Echo", decimals: 0, max: 90 },
  { code: "lvot-rest", display: "LVOT gradient at rest", short: "LVOT rest", unit: "mmHg", category: "Echo", decimals: 0, max: 250 },
  { code: "lvot-provoked", display: "LVOT gradient, provoked (Valsalva / standing)", short: "LVOT provoked", unit: "mmHg", category: "Echo", decimals: 0, max: 250 },
  { code: "lge-extent", display: "LGE extent (% of LV mass)", short: "LGE %", unit: "%", category: "CMR", decimals: 0, max: 100 },
];

export const MEASURES: Record<string, LabDef> = Object.fromEntries(
  [...LABS, ...VITALS, ...STUDY_MEASURES, ...HF_MEASURES].map((l) => [l.code, l]),
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
  { id: "sepsis", label: "Sepsis / shock", codes: ["lactate", "wbc", "crp", "creatinine", "potassium"] },
  { id: "dka", label: "Glucose crisis", codes: ["glucose", "ketones", "bicarbonate", "ph", "potassium", "sodium"] },
];

// hidden: kept for existing records but no longer offered in the picker (recorded elsewhere)
export type DiagnosisDef = { code: string; display: string; family: string; tags: string[]; hidden?: boolean };

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
  { code: "prosthetic-valve", display: "Prosthetic valve / repair", family: "Valve", tags: ["valve"] },
  // cardiomyopathy module (ESC 2023 cardiomyopathies: phenotype-based diagnosis)
  { code: "hcm", display: "Hypertrophic cardiomyopathy", family: "Cardiomyopathy", tags: ["cmp", "hcm"] },
  { code: "dcm", display: "Dilated cardiomyopathy", family: "Cardiomyopathy", tags: ["cmp", "dcm"] },
  { code: "ndlvc", display: "Non-dilated LV cardiomyopathy", family: "Cardiomyopathy", tags: ["cmp", "ndlvc"] },
  { code: "arvc", display: "Arrhythmogenic RV cardiomyopathy", family: "Cardiomyopathy", tags: ["cmp", "arvc"] },
  { code: "rcm", display: "Restrictive cardiomyopathy", family: "Cardiomyopathy", tags: ["cmp", "rcm"] },
  { code: "amyloid", display: "Cardiac amyloidosis", family: "Cardiomyopathy", tags: ["cmp", "amyloid"] },
  { code: "myocarditis", display: "Myocarditis", family: "Cardiomyopathy", tags: ["myocarditis"] },
  // pulmonary hypertension module (ESC/ERS 2022 clinical classification groups as an attribute)
  { code: "ph", display: "Pulmonary hypertension", family: "Pulmonary hypertension", tags: ["ph"] },
  { code: "af", display: "Atrial fibrillation", family: "Arrhythmia", tags: ["af"] },
  { code: "flutter", display: "Atrial flutter", family: "Arrhythmia", tags: ["af"] },
  { code: "svt", display: "SVT", family: "Arrhythmia", tags: [] },
  { code: "vt", display: "Ventricular tachycardia", family: "Arrhythmia", tags: [] },
  { code: "av-block", display: "AV block", family: "Arrhythmia", tags: [] },
  { code: "cied", display: "Cardiac device", family: "Device", tags: [] },
  { code: "htn", display: "Hypertension", family: "Comorbidity", tags: ["htn"] },
  { code: "t2dm", display: "Type 2 diabetes", family: "Comorbidity", tags: ["dm", "t2dm"] },
  { code: "t1dm", display: "Type 1 diabetes", family: "Comorbidity", tags: ["dm", "t1dm"] },
  { code: "dm-other", display: "Diabetes, other type (LADA, MODY, secondary)", family: "Comorbidity", tags: ["dm"] },
  { code: "prediabetes", display: "Prediabetes", family: "Comorbidity", tags: ["prediabetes"] },
  { code: "fh", display: "Familial hypercholesterolaemia", family: "Comorbidity", tags: ["lipids", "fh"] },
  { code: "statin-intolerance", display: "Statin intolerance", family: "Comorbidity", tags: ["statin-intolerance"] },
  { code: "ckd-1-2", display: "CKD 1–2 (with albuminuria)", family: "Comorbidity", tags: ["ckd"] },
  { code: "ckd-3a", display: "CKD 3a", family: "Comorbidity", tags: ["ckd"] },
  { code: "ckd-3b", display: "CKD 3b", family: "Comorbidity", tags: ["ckd"] },
  { code: "ckd-4", display: "CKD 4", family: "Comorbidity", tags: ["ckd"] },
  { code: "ckd-5", display: "CKD 5", family: "Comorbidity", tags: ["ckd"] },
  { code: "dialysis", display: "On dialysis", family: "Comorbidity", tags: ["ckd", "dialysis"] },
  { code: "dyslipidaemia", display: "Dyslipidaemia", family: "Comorbidity", tags: ["lipids"] },
  { code: "obesity", display: "Obesity", family: "Comorbidity", tags: ["obesity"] },
  { code: "stroke-tia", display: "Stroke / TIA", family: "Comorbidity", tags: ["ascvd", "stroke"] },
  { code: "pad", display: "Peripheral arterial disease", family: "Comorbidity", tags: ["cad", "ascvd", "vascular"] },
  { code: "copd", display: "COPD", family: "Comorbidity", tags: ["lung"] },
  { code: "ild", display: "Interstitial lung disease", family: "Comorbidity", tags: ["lung"] },
  { code: "osa", display: "Obstructive sleep apnoea", family: "Comorbidity", tags: ["lung"] },
  { code: "pe", display: "Pulmonary embolism", family: "Comorbidity", tags: ["vte"] },
  { code: "aps", display: "Antiphospholipid syndrome", family: "Comorbidity", tags: ["aps"] },
  { code: "anaemia", display: "Anaemia", family: "Comorbidity", tags: [] },
  { code: "thyroid", display: "Thyroid disease", family: "Comorbidity", tags: [] },
  { code: "liver-disease", display: "Chronic liver disease", family: "Comorbidity", tags: [] },
  { code: "cancer", display: "Cancer (active or past)", family: "Comorbidity", tags: [] },
  { code: "smoker", display: "Current smoker", family: "Comorbidity", tags: [], hidden: true },
];
export const DIAGNOSIS: Record<string, DiagnosisDef> = Object.fromEntries(DIAGNOSES.map((d) => [d.code, d]));

export type MedicationDef = {
  code: string;
  name: string;
  drugClass: string;
  // clinical purpose used to group the medication list
  purpose: "Heart failure" | "CAD / secondary prevention" | "Angina" | "Lipids" | "Anticoagulation" | "Rhythm" | "Blood pressure" | "Cardiometabolic" | "Diabetes" | "Pulmonary hypertension" | "Cardiomyopathy" | "Infection" | "Anti-inflammatory" | "Supportive" | "General medicine";
  tags: string[]; // raas, acei, arb, arni, mra, sglt2, loop, bb, antiplatelet, statin, oac, potassium-sparing
  indications: string[]; // diagnosis tags this drug is commonly used for
  unit: string;
  doses: number[]; // label strengths — draft, pending review
  doseLabels?: string[];
  frequencies: string[];
  routes: string[];
  monitoring: string[]; // codes to check before start / after changes
  target?: number; // guideline target dose (ESC HF 2026 table) — same unit as doses
  // trade names, searchable at entry. To confirm against the MOH / MKH formulary.
  brands?: string[];
  // drugs not tied to a cardiac diagnosis (antibiotics, steroids…): the indication is picked from this list
  indicationChoices?: string[];
};

// Every frequency the clinician may choose; each drug offers its usual ones first (Ahmed, 2 Oct 2026:
// frequency must be changeable for individual patients).
export const FREQUENCIES = ["OD", "BID", "TID", "QID", "Nightly", "Mornings", "With meals", "Alternate days", "Twice weekly", "Weekly", "Every 2 weeks", "Monthly", "Every 6 months", "Every 4 hours", "Continuous infusion", "Day 0, 3 months, then every 6 months", "Single infusion", "PRN", "Once"];

const m = (
  code: string, name: string, drugClass: string, purpose: MedicationDef["purpose"], tags: string[],
  indications: string[], unit: string, doses: number[], frequencies: string[], monitoring: string[],
  extra: Partial<MedicationDef> = {},
): MedicationDef => ({ code, name, drugClass, purpose, tags, indications, unit, doses, frequencies, routes: ["PO"], monitoring, ...extra });

const RENAL_K = ["potassium", "creatinine", "egfr", "sbp"];

const INFECTION_INDICATIONS = ["Chest infection (community-acquired)", "Chest infection (hospital-acquired)", "Urinary tract infection", "Skin / soft tissue infection", "Infective endocarditis", "Sepsis, source unclear", "Device / line infection", "Prophylaxis", "Other infection"];

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
  m("finerenone", "Finerenone", "Nonsteroidal MRA", "Heart failure", ["mra", "potassium-sparing"], ["ckd", "dm", "hf"], "mg", [10, 20, 40], ["OD"], ["potassium", "egfr"], { target: 40 }),
  m("dapagliflozin", "Dapagliflozin", "SGLT2 inhibitor", "Heart failure", ["sglt2"], ["hf", "ckd", "dm"], "mg", [10], ["OD"], ["egfr"], { target: 10 }),
  m("empagliflozin", "Empagliflozin", "SGLT2 inhibitor", "Heart failure", ["sglt2"], ["hf", "ckd", "dm"], "mg", [10], ["OD"], ["egfr"], { target: 10 }),
  m("furosemide", "Furosemide", "Loop diuretic", "Heart failure", ["loop"], ["hf"], "mg", [20, 40, 80], ["OD", "BID"], ["creatinine", "potassium", "sodium", "weight"], { routes: ["PO", "IV"] }),
  m("bumetanide", "Bumetanide", "Loop diuretic", "Heart failure", ["loop"], ["hf"], "mg", [0.5, 1, 2], ["OD", "BID"], ["creatinine", "potassium", "sodium", "weight"], { routes: ["PO", "IV"] }),
  m("torsemide", "Torsemide", "Loop diuretic", "Heart failure", ["loop"], ["hf"], "mg", [10, 20, 40], ["OD"], ["creatinine", "potassium", "sodium", "weight"]),
  m("ivabradine", "Ivabradine", "If-channel inhibitor", "Heart failure", ["ivabradine", "rate-slowing"], ["hf"], "mg", [2.5, 5, 7.5], ["BID"], ["hr"]),
  m("digoxin", "Digoxin", "Cardiac glycoside", "Rhythm", ["digoxin", "rate-slowing"], ["hf", "af"], "mg", [0.0625, 0.125, 0.25], ["OD"], ["potassium", "creatinine", "hr"]),
  m("hydralazine", "Hydralazine", "Vasodilator", "Heart failure", ["vasodilator"], ["hf", "htn"], "mg", [25, 50, 75], ["TID"], ["sbp"]),
  m("isosorbide-dinitrate", "Isosorbide dinitrate", "Nitrate", "Heart failure", ["vasodilator", "nitrate"], ["hf", "cad"], "mg", [20, 40], ["TID"], ["sbp"]),
  m("alirocumab", "Alirocumab", "PCSK9 antibody", "Lipids", ["pcsk9", "lipid"], ["cad", "lipids"], "mg", [75, 150], ["Every 2 weeks"], ["ldl-c"], { routes: ["SC"] }),
  m("bempedoic-acid", "Bempedoic acid", "ACL inhibitor", "Lipids", ["lipid"], ["cad", "lipids"], "mg", [180], ["OD"], ["ldl-c"]),
  m("icosapent-ethyl", "Icosapent ethyl", "Omega-3 (EPA)", "Lipids", [], ["cad", "lipids"], "g", [2], ["BID"], ["triglycerides"]),
  m("liraglutide", "Liraglutide", "GLP-1 receptor agonist", "Cardiometabolic", ["glp1", "glp1-cv"], ["dm", "cad"], "mg", [0.6, 1.2, 1.8], ["OD"], ["weight", "hba1c"], { routes: ["SC"] }),
  m("dulaglutide", "Dulaglutide", "GLP-1 receptor agonist", "Cardiometabolic", ["glp1", "glp1-cv"], ["dm", "cad"], "mg", [0.75, 1.5, 3, 4.5], ["Weekly"], ["weight", "hba1c"], { routes: ["SC"] }),
  m("enalapril", "Enalapril", "ACE inhibitor", "Heart failure", ["raas", "acei"], ["hf", "htn"], "mg", [2.5, 5, 10, 20], ["BID"], RENAL_K, { target: 20 }),
  m("sotagliflozin", "Sotagliflozin", "SGLT1/2 inhibitor", "Heart failure", ["sglt2"], ["hf", "dm"], "mg", [200, 400], ["OD"], ["egfr"]),
  m("ferric-carboxymaltose", "Ferric carboxymaltose (IV)", "IV iron", "Heart failure", ["iv-iron"], ["hf"], "mg", [500, 750, 1000], ["Single infusion"], ["haemoglobin", "ferritin", "tsat"], { routes: ["IV"] }),
  m("ferric-derisomaltose", "Ferric derisomaltose (IV)", "IV iron", "Heart failure", ["iv-iron"], ["hf"], "mg", [500, 1000, 1500, 2000], ["Single infusion"], ["haemoglobin", "ferritin", "tsat"], { routes: ["IV"] }),
  m("vericiguat", "Vericiguat", "sGC stimulator", "Heart failure", [], ["hf"], "mg", [2.5, 5, 10], ["OD"], ["sbp"], { target: 10 }),
  m("aspirin", "Aspirin", "Antiplatelet", "CAD / secondary prevention", ["antiplatelet"], ["cad"], "mg", [75, 81, 100, 300, 500], ["OD", "TID"], ["haemoglobin"]),
  m("clopidogrel", "Clopidogrel", "P2Y12 inhibitor", "CAD / secondary prevention", ["antiplatelet", "p2y12"], ["cad"], "mg", [75], ["OD"], ["haemoglobin"]),
  m("ticagrelor", "Ticagrelor", "P2Y12 inhibitor", "CAD / secondary prevention", ["antiplatelet", "p2y12", "p2y12-potent"], ["cad"], "mg", [60, 90], ["BID"], ["haemoglobin"]),
  m("prasugrel", "Prasugrel", "P2Y12 inhibitor", "CAD / secondary prevention", ["antiplatelet", "p2y12", "p2y12-potent"], ["cad"], "mg", [5, 10], ["OD"], ["haemoglobin"]),
  m("atorvastatin", "Atorvastatin", "Statin", "Lipids", ["statin", "lipid"], ["cad", "lipids", "dm"], "mg", [10, 20, 40, 80], ["Nightly", "OD"], ["ldl-c", "alt"]),
  m("rosuvastatin", "Rosuvastatin", "Statin", "Lipids", ["statin", "lipid"], ["cad", "lipids", "dm"], "mg", [5, 10, 20, 40], ["OD"], ["ldl-c", "alt"]),
  m("ezetimibe", "Ezetimibe", "Cholesterol absorption inhibitor", "Lipids", ["ezetimibe", "lipid"], ["cad", "lipids"], "mg", [10], ["OD"], ["ldl-c"]),
  m("evolocumab", "Evolocumab", "PCSK9 antibody", "Lipids", ["pcsk9", "lipid"], ["cad", "lipids"], "mg", [140], ["Every 2 weeks"], ["ldl-c"], { routes: ["SC"] }),
  m("inclisiran", "Inclisiran", "PCSK9 siRNA", "Lipids", ["pcsk9", "lipid"], ["cad", "lipids"], "mg", [284], ["Day 0, 3 months, then every 6 months"], ["ldl-c"], { routes: ["SC"] }),
  m("apixaban", "Apixaban", "Factor Xa inhibitor", "Anticoagulation", ["oac", "doac"], ["af"], "mg", [2.5, 5], ["BID"], ["creatinine", "haemoglobin", "weight"]),
  m("rivaroxaban", "Rivaroxaban", "Factor Xa inhibitor", "Anticoagulation", ["oac", "doac"], ["af", "cad", "vascular"], "mg", [2.5, 10, 15, 20], ["OD", "BID"], ["creatinine", "haemoglobin"]),
  m("edoxaban", "Edoxaban", "Factor Xa inhibitor", "Anticoagulation", ["oac", "doac"], ["af"], "mg", [30, 60], ["OD"], ["creatinine", "haemoglobin", "weight"]),
  m("dabigatran", "Dabigatran", "Direct thrombin inhibitor", "Anticoagulation", ["oac", "doac"], ["af"], "mg", [110, 150], ["BID"], ["creatinine", "haemoglobin"]),
  m("warfarin", "Warfarin", "Vitamin K antagonist", "Anticoagulation", ["oac", "vka"], ["af", "valve"], "mg", [1, 2, 3, 5], ["OD"], ["inr", "haemoglobin"]),
  m("amiodarone", "Amiodarone", "Class III antiarrhythmic", "Rhythm", ["qt", "rate-slowing"], ["af"], "mg", [100, 200], ["OD"], ["tsh", "alt", "hr"]),
  m("sotalol", "Sotalol", "Class III antiarrhythmic / beta blocker", "Rhythm", ["qt", "rate-slowing"], ["af"], "mg", [40, 80, 160], ["BID"], ["qtc", "hr", "creatinine"]),
  m("flecainide", "Flecainide", "Class Ic antiarrhythmic", "Rhythm", [], ["af"], "mg", [50, 100], ["BID"], ["hr"]),
  m("diltiazem", "Diltiazem", "Calcium-channel blocker", "Rhythm", ["ndhp-ccb", "rate-slowing", "bp-lowering"], ["af", "htn"], "mg", [60, 120, 180, 240], ["OD", "TID"], ["hr", "sbp"]),
  m("amlodipine", "Amlodipine", "Calcium-channel blocker", "Blood pressure", ["vasodilator", "bp-lowering"], ["htn", "cad"], "mg", [2.5, 5, 10], ["OD"], ["sbp"]),
  m("indapamide", "Indapamide", "Thiazide-like diuretic", "Blood pressure", ["thiazide", "bp-lowering"], ["htn"], "mg", [1.5, 2.5], ["OD"], ["sodium", "potassium"]),
  m("metformin", "Metformin", "Biguanide", "Diabetes", ["metformin"], ["dm"], "mg", [500, 750, 850, 1000], ["OD", "BID", "TID"], ["egfr", "hba1c"]),
  m("semaglutide", "Semaglutide", "GLP-1 receptor agonist", "Cardiometabolic", ["glp1", "glp1-cv"], ["dm", "cad"], "mg", [0.25, 0.5, 1, 1.7, 2, 2.4], ["Weekly"], ["weight", "hba1c"], { routes: ["SC"] }),
  m("tirzepatide", "Tirzepatide", "Dual GIP/GLP-1 agonist", "Cardiometabolic", ["glp1"], ["dm", "obesity"], "mg", [2.5, 5, 7.5, 10, 12.5, 15], ["Weekly"], ["weight", "hba1c"], { routes: ["SC"] }),
  m("sildenafil", "Sildenafil", "PDE-5 inhibitor", "Pulmonary hypertension", ["pde5"], [], "mg", [20], ["TID"], ["sbp"]),
  // ---- Diabetes (ADA Standards of Care 2026 · ESC diabetes & CVD 2023). Label strengths, draft. ----
  m("semaglutide-oral", "Semaglutide (oral)", "GLP-1 receptor agonist", "Cardiometabolic", ["glp1", "glp1-cv"], ["dm", "cad"], "mg", [3, 7, 14], ["OD"], ["weight", "hba1c"]),
  m("canagliflozin", "Canagliflozin", "SGLT2 inhibitor", "Cardiometabolic", ["sglt2"], ["dm", "ckd"], "mg", [100, 300], ["OD"], ["egfr"]),
  m("sitagliptin", "Sitagliptin", "DPP-4 inhibitor", "Diabetes", ["dpp4"], ["dm"], "mg", [25, 50, 100], ["OD"], ["egfr", "hba1c"]),
  m("linagliptin", "Linagliptin", "DPP-4 inhibitor", "Diabetes", ["dpp4"], ["dm"], "mg", [5], ["OD"], ["hba1c"]),
  m("vildagliptin", "Vildagliptin", "DPP-4 inhibitor", "Diabetes", ["dpp4"], ["dm"], "mg", [50], ["OD", "BID"], ["egfr", "alt", "hba1c"]),
  m("saxagliptin", "Saxagliptin", "DPP-4 inhibitor", "Diabetes", ["dpp4", "dpp4-hf"], ["dm"], "mg", [2.5, 5], ["OD"], ["egfr", "hba1c"]),
  m("alogliptin", "Alogliptin", "DPP-4 inhibitor", "Diabetes", ["dpp4", "dpp4-hf"], ["dm"], "mg", [6.25, 12.5, 25], ["OD"], ["egfr", "hba1c"]),
  m("gliclazide", "Gliclazide MR", "Sulfonylurea", "Diabetes", ["sulfonylurea", "hypo-risk"], ["dm"], "mg", [30, 60, 90, 120], ["OD"], ["glucose", "hba1c"]),
  m("glimepiride", "Glimepiride", "Sulfonylurea", "Diabetes", ["sulfonylurea", "hypo-risk"], ["dm"], "mg", [1, 2, 3, 4], ["OD"], ["glucose", "hba1c"]),
  m("glibenclamide", "Glibenclamide (glyburide)", "Sulfonylurea", "Diabetes", ["sulfonylurea", "hypo-risk", "glibenclamide"], ["dm"], "mg", [2.5, 5], ["OD", "BID"], ["glucose", "hba1c"]),
  m("pioglitazone", "Pioglitazone", "Thiazolidinedione", "Diabetes", ["tzd"], ["dm"], "mg", [15, 30, 45], ["OD"], ["weight", "alt", "hba1c"]),
  // insulins: units are individual, entered by the clinician (no dose list)
  m("insulin-glargine", "Insulin glargine U100", "Basal insulin", "Diabetes", ["insulin", "insulin-basal", "hypo-risk"], ["dm"], "units", [], ["OD"], ["glucose", "hba1c"], { routes: ["SC"] }),
  m("insulin-glargine-u300", "Insulin glargine U300", "Basal insulin", "Diabetes", ["insulin", "insulin-basal", "hypo-risk"], ["dm"], "units", [], ["OD"], ["glucose", "hba1c"], { routes: ["SC"] }),
  m("insulin-degludec", "Insulin degludec", "Basal insulin", "Diabetes", ["insulin", "insulin-basal", "hypo-risk"], ["dm"], "units", [], ["OD"], ["glucose", "hba1c"], { routes: ["SC"] }),
  m("insulin-detemir", "Insulin detemir", "Basal insulin", "Diabetes", ["insulin", "insulin-basal", "hypo-risk"], ["dm"], "units", [], ["OD", "BID"], ["glucose", "hba1c"], { routes: ["SC"] }),
  m("insulin-nph", "Isophane (NPH) insulin", "Intermediate-acting insulin", "Diabetes", ["insulin", "insulin-basal", "hypo-risk"], ["dm"], "units", [], ["OD", "BID"], ["glucose", "hba1c"], { routes: ["SC"] }),
  m("insulin-aspart", "Insulin aspart", "Rapid-acting insulin", "Diabetes", ["insulin", "insulin-prandial", "hypo-risk"], ["dm"], "units", [], ["With meals"], ["glucose", "hba1c"], { routes: ["SC"] }),
  m("insulin-lispro", "Insulin lispro", "Rapid-acting insulin", "Diabetes", ["insulin", "insulin-prandial", "hypo-risk"], ["dm"], "units", [], ["With meals"], ["glucose", "hba1c"], { routes: ["SC"] }),
  m("insulin-aspart-30", "Biphasic insulin aspart 30", "Premixed insulin", "Diabetes", ["insulin", "insulin-premix", "hypo-risk"], ["dm"], "units", [], ["BID", "OD"], ["glucose", "hba1c"], { routes: ["SC"] }),
  // ---- Blood pressure (added 2 Oct 2026; label strengths, draft pending pharmacist review) ----
  m("captopril", "Captopril", "ACE inhibitor", "Blood pressure", ["raas", "acei"], ["htn", "hf"], "mg", [6.25, 12.5, 25, 50], ["BID", "TID"], RENAL_K, { target: 50 }),
  m("irbesartan", "Irbesartan", "ARB", "Blood pressure", ["raas", "arb"], ["htn", "ckd"], "mg", [75, 150, 300], ["OD"], RENAL_K),
  m("telmisartan", "Telmisartan", "ARB", "Blood pressure", ["raas", "arb"], ["htn", "cad"], "mg", [20, 40, 80], ["OD"], RENAL_K),
  m("olmesartan", "Olmesartan", "ARB", "Blood pressure", ["raas", "arb"], ["htn"], "mg", [10, 20, 40], ["OD"], RENAL_K),
  m("nifedipine", "Nifedipine (long-acting)", "Calcium-channel blocker", "Blood pressure", ["vasodilator", "bp-lowering"], ["htn", "cad"], "mg", [20, 30, 60], ["OD", "BID"], ["sbp"]),
  m("felodipine", "Felodipine", "Calcium-channel blocker", "Blood pressure", ["vasodilator", "bp-lowering"], ["htn", "cad"], "mg", [2.5, 5, 10], ["OD"], ["sbp"]),
  m("lercanidipine", "Lercanidipine", "Calcium-channel blocker", "Blood pressure", ["vasodilator", "bp-lowering"], ["htn"], "mg", [10, 20], ["OD"], ["sbp"]),
  m("verapamil", "Verapamil", "Calcium-channel blocker", "Rhythm", ["ndhp-ccb", "rate-slowing", "bp-lowering"], ["af", "htn", "cad"], "mg", [40, 80, 120, 240], ["OD", "BID", "TID"], ["hr", "sbp"]),
  m("hydrochlorothiazide", "Hydrochlorothiazide", "Thiazide diuretic", "Blood pressure", ["thiazide", "bp-lowering"], ["htn", "hf"], "mg", [12.5, 25, 50], ["OD"], ["sodium", "potassium", "creatinine"]),
  m("chlorthalidone", "Chlortalidone", "Thiazide-like diuretic", "Blood pressure", ["thiazide", "bp-lowering"], ["htn"], "mg", [12.5, 25, 50], ["OD"], ["sodium", "potassium", "creatinine"]),
  m("metolazone", "Metolazone", "Thiazide-like diuretic", "Heart failure", ["thiazide"], ["hf"], "mg", [2.5, 5], ["OD", "Alternate days", "Twice weekly"], ["sodium", "potassium", "creatinine", "weight"]),
  m("amiloride", "Amiloride", "Potassium-sparing diuretic", "Blood pressure", ["potassium-sparing", "bp-lowering"], ["htn", "hf"], "mg", [5, 10], ["OD"], ["potassium", "creatinine"]),
  m("nebivolol", "Nebivolol", "Beta blocker", "Heart failure", ["bb"], ["hf", "htn"], "mg", [1.25, 2.5, 5, 10], ["OD"], ["hr", "sbp"], { target: 10 }),
  m("atenolol", "Atenolol", "Beta blocker", "Blood pressure", ["bb-other", "rate-slowing", "bp-lowering"], ["htn", "cad", "af"], "mg", [25, 50, 100], ["OD"], ["hr", "sbp"]),
  m("propranolol", "Propranolol", "Beta blocker", "Rhythm", ["bb-other", "rate-slowing", "bp-lowering"], ["af", "htn"], "mg", [10, 40, 80], ["BID", "TID"], ["hr", "sbp"]),
  m("labetalol", "Labetalol", "Alpha/beta blocker", "Blood pressure", ["bb-other", "rate-slowing", "bp-lowering"], ["htn"], "mg", [100, 200, 400], ["BID", "TID"], ["hr", "sbp"], { routes: ["PO", "IV"] }),
  m("doxazosin", "Doxazosin", "Alpha-1 blocker", "Blood pressure", ["bp-lowering"], ["htn"], "mg", [1, 2, 4, 8], ["OD"], ["sbp"]),
  m("methyldopa", "Methyldopa", "Central alpha-2 agonist", "Blood pressure", ["bp-lowering"], ["htn"], "mg", [250, 500], ["BID", "TID"], ["sbp"]),
  m("clonidine", "Clonidine", "Central alpha-2 agonist", "Blood pressure", ["bp-lowering"], ["htn"], "mg", [0.1, 0.2, 0.3], ["BID", "TID"], ["sbp", "hr"]),
  m("moxonidine", "Moxonidine", "Imidazoline-receptor agonist", "Blood pressure", ["bp-lowering"], ["htn"], "mg", [0.2, 0.4], ["OD", "BID"], ["sbp"]),
  m("amlodipine-valsartan", "Amlodipine/valsartan", "CCB + ARB combination", "Blood pressure", ["raas", "arb", "vasodilator", "bp-lowering"], ["htn"], "mg", [5, 10], ["OD"], RENAL_K, { doseLabels: ["5/160 mg", "10/160 mg"] }),
  m("valsartan-hctz", "Valsartan/hydrochlorothiazide", "ARB + thiazide combination", "Blood pressure", ["raas", "arb", "thiazide", "bp-lowering"], ["htn"], "mg", [80, 160], ["OD"], RENAL_K, { doseLabels: ["80/12.5 mg", "160/12.5 mg"] }),
  m("losartan-hctz", "Losartan/hydrochlorothiazide", "ARB + thiazide combination", "Blood pressure", ["raas", "arb", "thiazide", "bp-lowering"], ["htn"], "mg", [50, 100], ["OD"], RENAL_K, { doseLabels: ["50/12.5 mg", "100/25 mg"] }),
  m("telmisartan-amlodipine", "Telmisartan/amlodipine", "ARB + CCB combination", "Blood pressure", ["raas", "arb", "vasodilator", "bp-lowering"], ["htn"], "mg", [40, 80], ["OD"], RENAL_K, { doseLabels: ["40/5 mg", "80/10 mg"] }),
  m("perindopril-indapamide", "Perindopril/indapamide", "ACEi + thiazide-like combination", "Blood pressure", ["raas", "acei", "thiazide", "bp-lowering"], ["htn"], "mg", [5, 10], ["OD"], RENAL_K, { doseLabels: ["5/1.25 mg", "10/2.5 mg"] }),
  m("perindopril-amlodipine", "Perindopril/amlodipine", "ACEi + CCB combination", "Blood pressure", ["raas", "acei", "vasodilator", "bp-lowering"], ["htn", "cad"], "mg", [5, 10], ["OD"], RENAL_K, { doseLabels: ["5/5 mg", "10/10 mg"] }),
  // ---- Angina ----
  m("gtn", "Glyceryl trinitrate (sublingual)", "Short-acting nitrate", "Angina", ["nitrate"], ["cad"], "mg", [0.4, 0.5], ["PRN"], ["sbp"], { routes: ["SL"] }),
  m("isosorbide-mononitrate", "Isosorbide mononitrate", "Long-acting nitrate", "Angina", ["nitrate", "vasodilator"], ["cad"], "mg", [20, 30, 60, 120], ["OD", "BID"], ["sbp"]),
  m("nicorandil", "Nicorandil", "K-ATP channel opener", "Angina", ["vasodilator"], ["cad"], "mg", [10, 20], ["BID"], ["sbp"]),
  m("ranolazine", "Ranolazine", "Late sodium-current inhibitor", "Angina", ["qt"], ["cad"], "mg", [375, 500, 750], ["BID"], ["qtc", "creatinine"]),
  m("trimetazidine", "Trimetazidine MR", "Metabolic agent", "Angina", [], ["cad"], "mg", [35], ["BID"], ["creatinine"]),
  // ---- Lipids ----
  m("atorvastatin-ezetimibe", "Atorvastatin/ezetimibe", "Statin + ezetimibe combination", "Lipids", ["statin", "ezetimibe", "lipid"], ["cad", "lipids", "dm"], "mg", [10, 20, 40, 80], ["OD"], ["ldl-c", "alt"], { doseLabels: ["10/10 mg", "20/10 mg", "40/10 mg", "80/10 mg"] }),
  m("rosuvastatin-ezetimibe", "Rosuvastatin/ezetimibe", "Statin + ezetimibe combination", "Lipids", ["statin", "ezetimibe", "lipid"], ["cad", "lipids", "dm"], "mg", [10, 20, 40], ["OD"], ["ldl-c", "alt"], { doseLabels: ["10/10 mg", "20/10 mg", "40/10 mg"] }),
  m("simvastatin", "Simvastatin", "Statin", "Lipids", ["statin", "lipid"], ["cad", "lipids"], "mg", [10, 20, 40], ["Nightly"], ["ldl-c", "alt"]),
  m("pravastatin", "Pravastatin", "Statin", "Lipids", ["statin", "lipid"], ["cad", "lipids"], "mg", [10, 20, 40], ["Nightly"], ["ldl-c", "alt"]),
  m("fenofibrate", "Fenofibrate", "Fibrate", "Lipids", ["lipid"], ["lipids"], "mg", [145, 160, 200], ["OD"], ["triglycerides", "creatinine", "alt"]),
  m("omega-3-ethyl-esters", "Omega-3-acid ethyl esters", "Omega-3 (EPA + DHA)", "Lipids", [], ["lipids"], "g", [1, 2, 4], ["OD", "BID"], ["triglycerides"]),
  // ---- Anticoagulation (parenteral) ----
  m("enoxaparin", "Enoxaparin", "Low-molecular-weight heparin", "Anticoagulation", ["oac-parenteral"], ["af", "cad", "valve"], "mg", [20, 40, 60, 80, 100], ["OD", "BID"], ["creatinine", "haemoglobin", "platelets"], { routes: ["SC"] }),
  // ---- Anti-inflammatory ----
  m("colchicine", "Colchicine", "Anti-inflammatory", "Anti-inflammatory", [], ["cad"], "mg", [0.5], ["OD", "BID"], ["creatinine"], { indicationChoices: ["Pericarditis", "Coronary disease (anti-inflammatory secondary prevention)", "Post-pericardiotomy syndrome", "Gout", "Other"] }),
  m("ibuprofen", "Ibuprofen", "NSAID", "Anti-inflammatory", ["nsaid"], [], "mg", [200, 400, 600], ["TID", "PRN"], ["creatinine", "sbp"], { indicationChoices: ["Pericarditis", "Pain", "Other"] }),
  m("prednisolone", "Prednisolone", "Corticosteroid", "Anti-inflammatory", ["steroid"], [], "mg", [5, 10, 20, 40], ["OD", "Mornings"], ["glucose", "sbp"], { indicationChoices: ["COPD / asthma exacerbation", "Pericarditis (refractory / recurrent)", "Myocarditis / inflammatory cardiomyopathy", "Sarcoidosis", "Adrenal insufficiency / stress dose", "Rheumatological disease", "Other"] }),
  m("hydrocortisone", "Hydrocortisone", "Corticosteroid", "Anti-inflammatory", ["steroid"], [], "mg", [10, 20, 50, 100], ["OD", "BID", "TID", "QID"], ["glucose", "sodium", "potassium"], { routes: ["PO", "IV"], indicationChoices: ["COPD / asthma exacerbation", "Pericarditis (refractory / recurrent)", "Myocarditis / inflammatory cardiomyopathy", "Sarcoidosis", "Adrenal insufficiency / stress dose", "Rheumatological disease", "Other"] }),
  m("methylprednisolone", "Methylprednisolone", "Corticosteroid", "Anti-inflammatory", ["steroid"], [], "mg", [4, 16, 40, 125, 500, 1000], ["OD", "BID"], ["glucose", "sbp"], { routes: ["PO", "IV"], indicationChoices: ["COPD / asthma exacerbation", "Pericarditis (refractory / recurrent)", "Myocarditis / inflammatory cardiomyopathy", "Sarcoidosis", "Adrenal insufficiency / stress dose", "Rheumatological disease", "Other"] }),
  m("dexamethasone", "Dexamethasone", "Corticosteroid", "Anti-inflammatory", ["steroid"], [], "mg", [2, 4, 6, 8], ["OD", "BID"], ["glucose"], { routes: ["PO", "IV"], indicationChoices: ["COPD / asthma exacerbation", "Pericarditis (refractory / recurrent)", "Myocarditis / inflammatory cardiomyopathy", "Sarcoidosis", "Adrenal insufficiency / stress dose", "Rheumatological disease", "Other"] }),
  // ---- Infection: label strengths only; the dose and duration follow the local antimicrobial policy ----
  m("amoxicillin", "Amoxicillin", "Penicillin", "Infection", ["antibiotic"], [], "mg", [500, 1000], ["TID"], [], { routes: ["PO"], indicationChoices: INFECTION_INDICATIONS }),
  m("amoxicillin-clavulanate", "Amoxicillin/clavulanate", "Penicillin + beta-lactamase inhibitor", "Infection", ["antibiotic"], [], "mg", [625, 1000, 1200], ["BID", "TID"], [], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("flucloxacillin", "Flucloxacillin", "Penicillin", "Infection", ["antibiotic"], [], "mg", [500, 1000, 2000], ["QID"], [], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("piperacillin-tazobactam", "Piperacillin/tazobactam", "Penicillin + beta-lactamase inhibitor", "Infection", ["antibiotic"], [], "g", [4.5], ["TID", "QID"], [], { routes: ["IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("cefuroxime", "Cefuroxime", "Cephalosporin", "Infection", ["antibiotic"], [], "mg", [250, 500, 750, 1500], ["BID", "TID"], [], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("ceftriaxone", "Ceftriaxone", "Cephalosporin", "Infection", ["antibiotic"], [], "g", [1, 2], ["OD", "BID"], [], { routes: ["IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("meropenem", "Meropenem", "Carbapenem", "Infection", ["antibiotic"], [], "g", [0.5, 1, 2], ["TID"], [], { routes: ["IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("azithromycin", "Azithromycin", "Macrolide", "Infection", ["antibiotic", "qt"], [], "mg", [250, 500], ["OD"], ["qtc"], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("clarithromycin", "Clarithromycin", "Macrolide", "Infection", ["antibiotic", "qt", "cyp3a4-inhibitor"], [], "mg", [250, 500], ["BID"], ["qtc"], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("doxycycline", "Doxycycline", "Tetracycline", "Infection", ["antibiotic"], [], "mg", [100], ["OD", "BID"], [], { routes: ["PO"], indicationChoices: INFECTION_INDICATIONS }),
  m("levofloxacin", "Levofloxacin", "Fluoroquinolone", "Infection", ["antibiotic", "qt"], [], "mg", [500, 750], ["OD", "BID"], ["qtc"], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("moxifloxacin", "Moxifloxacin", "Fluoroquinolone", "Infection", ["antibiotic", "qt"], [], "mg", [400], ["OD"], ["qtc"], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("ciprofloxacin", "Ciprofloxacin", "Fluoroquinolone", "Infection", ["antibiotic", "qt"], [], "mg", [250, 500, 750, 400], ["BID", "TID"], ["qtc"], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("vancomycin", "Vancomycin", "Glycopeptide", "Infection", ["antibiotic"], [], "mg", [500, 750, 1000, 1500], ["BID", "OD"], ["creatinine"], { routes: ["IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("linezolid", "Linezolid", "Oxazolidinone", "Infection", ["antibiotic"], [], "mg", [600], ["BID"], [], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("gentamicin", "Gentamicin", "Aminoglycoside", "Infection", ["antibiotic"], [], "mg", [80, 120, 240, 320], ["OD", "TID"], ["creatinine"], { routes: ["IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("metronidazole", "Metronidazole", "Nitroimidazole", "Infection", ["antibiotic"], [], "mg", [400, 500], ["TID"], [], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("clindamycin", "Clindamycin", "Lincosamide", "Infection", ["antibiotic"], [], "mg", [300, 450, 600], ["TID", "QID"], [], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("co-trimoxazole", "Co-trimoxazole", "Sulfonamide combination", "Infection", ["antibiotic"], [], "mg", [480, 960], ["BID"], [], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("nitrofurantoin", "Nitrofurantoin", "Nitrofuran", "Infection", ["antibiotic"], [], "mg", [50, 100], ["BID", "QID"], [], { routes: ["PO"], indicationChoices: INFECTION_INDICATIONS }),
  m("oseltamivir", "Oseltamivir", "Neuraminidase inhibitor (antiviral)", "Infection", ["antibiotic"], [], "mg", [30, 75], ["OD", "BID"], [], { routes: ["PO"], indicationChoices: INFECTION_INDICATIONS }),
  // ---- Supportive ----
  m("pantoprazole", "Pantoprazole", "Proton-pump inhibitor", "Supportive", ["ppi"], [], "mg", [20, 40], ["OD", "BID"], [], { routes: ["PO", "IV"], indicationChoices: ["GI protection on antithrombotic therapy", "Dyspepsia / reflux", "Upper GI bleeding", "Other"] }),
  m("esomeprazole", "Esomeprazole", "Proton-pump inhibitor", "Supportive", ["ppi"], [], "mg", [20, 40], ["OD", "BID"], [], { routes: ["PO", "IV"], indicationChoices: ["GI protection on antithrombotic therapy", "Dyspepsia / reflux", "Upper GI bleeding", "Other"] }),
  m("omeprazole", "Omeprazole", "Proton-pump inhibitor", "Supportive", ["ppi", "cyp2c19-inhibitor"], [], "mg", [20, 40], ["OD", "BID"], [], { indicationChoices: ["GI protection on antithrombotic therapy", "Dyspepsia / reflux", "Other"] }),
  m("sodium-zirconium-cyclosilicate", "Sodium zirconium cyclosilicate", "Potassium binder", "Supportive", ["k-binder"], ["hf", "ckd"], "g", [5, 10], ["OD", "TID", "Alternate days"], ["potassium"]),
  m("patiromer", "Patiromer", "Potassium binder", "Supportive", ["k-binder"], ["hf", "ckd"], "g", [8.4, 16.8, 25.2], ["OD"], ["potassium", "magnesium"]),
  m("potassium-chloride", "Potassium chloride (oral)", "Potassium supplement", "Supportive", [], [], "mmol", [8, 16, 24], ["OD", "BID", "TID"], ["potassium"], { indicationChoices: ["Hypokalaemia", "Diuretic therapy", "Other"] }),
  // ---- Added 2 Oct 2026 (Ahmed: "include what is needed") — strengths are a draft for pharmacist review ----
  m("propafenone", "Propafenone", "Class IC antiarrhythmic", "Rhythm", ["class-ic"], ["af"], "mg", [150, 300], ["BID", "TID"], ["qrs", "hr"]),
  m("dronedarone", "Dronedarone", "Class III antiarrhythmic", "Rhythm", ["qt", "rate-slowing", "dronedarone"], ["af"], "mg", [400], ["BID"], ["creatinine", "alt", "qtc"]),
  m("metoprolol-tartrate", "Metoprolol tartrate", "Beta blocker", "Rhythm", ["bb-other", "rate-slowing"], ["af", "cad", "htn"], "mg", [25, 50, 100], ["BID"], ["hr", "sbp"]),
  m("acetazolamide", "Acetazolamide", "Carbonic anhydrase inhibitor", "Heart failure", ["diuretic-other"], ["hf"], "mg", [250, 500], ["OD", "BID"], ["potassium", "bicarbonate", "creatinine"], { routes: ["PO", "IV"] }),
  m("tadalafil", "Tadalafil", "PDE-5 inhibitor", "Pulmonary hypertension", ["pde5"], [], "mg", [20, 40], ["OD"], ["sbp"]),
  m("bosentan", "Bosentan", "Endothelin receptor antagonist", "Pulmonary hypertension", ["era"], [], "mg", [62.5, 125], ["BID"], ["alt", "haemoglobin"]),
  m("ambrisentan", "Ambrisentan", "Endothelin receptor antagonist", "Pulmonary hypertension", ["era"], [], "mg", [5, 10], ["OD"], ["haemoglobin"]),
  m("macitentan", "Macitentan", "Endothelin receptor antagonist", "Pulmonary hypertension", ["era"], [], "mg", [10], ["OD"], ["alt", "haemoglobin"]),
  m("riociguat", "Riociguat", "sGC stimulator", "Pulmonary hypertension", ["sgc"], [], "mg", [0.5, 1, 1.5, 2, 2.5], ["TID"], ["sbp"]),
  m("selexipag", "Selexipag", "Prostacyclin receptor agonist", "Pulmonary hypertension", ["prostacyclin"], [], "mcg", [200, 400, 600, 800, 1000, 1200, 1400, 1600], ["BID"], ["sbp"]),
  m("tafamidis", "Tafamidis", "Transthyretin stabiliser", "Cardiomyopathy", [], ["hf"], "mg", [61, 80], ["OD"], [], { doseLabels: ["61 mg (free acid)", "80 mg (4 × 20 mg meglumine)"], indicationChoices: ["ATTR cardiomyopathy", "Other"] }),
  m("mavacamten", "Mavacamten", "Cardiac myosin inhibitor", "Cardiomyopathy", ["myosin-inhibitor"], [], "mg", [2.5, 5, 10, 15], ["OD"], ["lvef"], { indicationChoices: ["Obstructive hypertrophic cardiomyopathy", "Other"] }),
  m("cilostazol", "Cilostazol", "PDE-3 inhibitor", "CAD / secondary prevention", ["cilostazol"], ["pad"], "mg", [50, 100], ["BID"], [], { indicationChoices: ["Intermittent claudication (PAD)", "Other"] }),
  m("fondaparinux", "Fondaparinux", "Factor Xa inhibitor (parenteral)", "Anticoagulation", ["oac-parenteral"], ["cad"], "mg", [2.5, 5, 7.5, 10], ["OD"], ["creatinine", "haemoglobin", "platelets"], { routes: ["SC"] }),
  m("benzylpenicillin", "Benzylpenicillin", "Penicillin", "Infection", ["antibiotic"], [], "MU", [1.2, 2.4, 3, 4], ["Every 4 hours", "QID", "Continuous infusion"], [], { routes: ["IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("ampicillin", "Ampicillin", "Penicillin", "Infection", ["antibiotic"], [], "g", [1, 2], ["Every 4 hours", "QID"], [], { routes: ["IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("cefazolin", "Cefazolin", "Cephalosporin", "Infection", ["antibiotic"], [], "g", [1, 2], ["TID", "Once"], [], { routes: ["IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("daptomycin", "Daptomycin", "Lipopeptide", "Infection", ["antibiotic"], [], "mg", [350, 500, 700, 1000], ["OD"], ["creatinine"], { routes: ["IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("rifampicin", "Rifampicin", "Rifamycin", "Infection", ["antibiotic", "strong-inducer"], [], "mg", [300, 450, 600], ["OD", "BID"], ["alt"], { routes: ["PO", "IV"], indicationChoices: INFECTION_INDICATIONS }),
  m("allopurinol", "Allopurinol", "Xanthine oxidase inhibitor", "General medicine", [], [], "mg", [100, 200, 300], ["OD"], ["creatinine"], { indicationChoices: ["Gout", "Other"] }),
  m("febuxostat", "Febuxostat", "Xanthine oxidase inhibitor", "General medicine", [], [], "mg", [40, 80, 120], ["OD"], ["alt"], { indicationChoices: ["Gout", "Other"] }),
  m("levothyroxine", "Levothyroxine", "Thyroid hormone", "General medicine", [], [], "mcg", [25, 50, 75, 100, 125, 150], ["OD"], ["tsh"], { indicationChoices: ["Hypothyroidism", "Amiodarone-induced hypothyroidism", "Other"] }),
  m("carbimazole", "Carbimazole", "Antithyroid", "General medicine", [], [], "mg", [5, 10, 20], ["OD", "BID", "TID"], ["tsh", "wbc", "alt"], { indicationChoices: ["Hyperthyroidism", "Amiodarone-induced thyrotoxicosis (type 1)", "Other"] }),
  m("paracetamol", "Paracetamol", "Analgesic", "General medicine", [], [], "mg", [500, 1000], ["QID", "TID", "PRN"], [], { routes: ["PO", "IV"], indicationChoices: ["Pain", "Fever", "Other"] }),
  m("salbutamol", "Salbutamol inhaler", "Short-acting beta-2 agonist", "General medicine", ["beta2-agonist"], ["copd"], "mcg", [100, 200], ["PRN", "QID"], ["hr", "potassium"], { routes: ["INH"], doseLabels: ["100 mcg (1 puff)", "200 mcg (2 puffs)"], indicationChoices: ["COPD", "Asthma", "Other"] }),
  m("tiotropium", "Tiotropium inhaler", "Long-acting muscarinic antagonist", "General medicine", [], ["copd"], "mcg", [2.5, 5, 18], ["OD"], [], { routes: ["INH"], indicationChoices: ["COPD", "Asthma", "Other"] }),
  m("varenicline", "Varenicline", "Smoking cessation", "General medicine", ["smoking-cessation"], [], "mg", [0.5, 1], ["OD", "BID"], [], { indicationChoices: ["Smoking cessation"] }),
  m("nicotine-patch", "Nicotine patch", "Nicotine replacement", "General medicine", ["smoking-cessation"], [], "mg/24 h", [7, 14, 21], ["OD"], [], { routes: ["Transdermal"], indicationChoices: ["Smoking cessation"] }),

];

// Trade names commonly marketed in Kuwait / the Gulf. Shown and searchable at entry.
// NOT verified against the MOH / MKH formulary: a pharmacist confirms before go-live.
export const BRAND_NOTE = "Trade names to confirm against the MOH / MKH formulary";
const BRANDS: Record<string, string[]> = {
  "sacubitril-valsartan": ["Entresto"], ramipril: ["Tritace"], perindopril: ["Coversyl"], lisinopril: ["Zestril"], enalapril: ["Renitec"],
  candesartan: ["Atacand"], valsartan: ["Diovan"], losartan: ["Cozaar"],
  bisoprolol: ["Concor"], carvedilol: ["Dilatrend"], "metoprolol-succinate": ["Betaloc ZOK"],
  spironolactone: ["Aldactone"], eplerenone: ["Inspra"], finerenone: ["Kerendia"],
  dapagliflozin: ["Forxiga"], empagliflozin: ["Jardiance"], sotagliflozin: ["Inpefa"], canagliflozin: ["Invokana"],
  furosemide: ["Lasix"], bumetanide: ["Burinex"], torsemide: ["Torem"], indapamide: ["Natrilix"],
  ivabradine: ["Procoralan"], digoxin: ["Lanoxin"], hydralazine: ["Apresoline"], "isosorbide-dinitrate": ["Isordil"], vericiguat: ["Verquvo"],
  "ferric-carboxymaltose": ["Ferinject"], "ferric-derisomaltose": ["Monofer"],
  aspirin: ["Aspirin Protect"], clopidogrel: ["Plavix"], ticagrelor: ["Brilinta"], prasugrel: ["Effient"],
  atorvastatin: ["Lipitor"], rosuvastatin: ["Crestor"], ezetimibe: ["Ezetrol"], evolocumab: ["Repatha"], alirocumab: ["Praluent"], inclisiran: ["Leqvio"],
  "bempedoic-acid": ["Nilemdo", "Nexletol"], "icosapent-ethyl": ["Vazkepa", "Vascepa"],
  apixaban: ["Eliquis"], rivaroxaban: ["Xarelto"], edoxaban: ["Lixiana"], dabigatran: ["Pradaxa"], warfarin: ["Marevan", "Coumadin"],
  amiodarone: ["Cordarone"], sotalol: ["Sotalex"], flecainide: ["Tambocor"], diltiazem: ["Cardizem"], amlodipine: ["Norvasc"],
  sildenafil: ["Revatio"],
  captopril: ["Capoten"], irbesartan: ["Aprovel"], telmisartan: ["Micardis"], olmesartan: ["Olmetec"], nifedipine: ["Adalat LA"], felodipine: ["Plendil"],
  lercanidipine: ["Zanidip"], verapamil: ["Isoptin"], hydrochlorothiazide: ["Esidrex"], chlorthalidone: ["Hygroton"], metolazone: ["Zaroxolyn"], amiloride: ["Midamor"],
  nebivolol: ["Nebilet"], atenolol: ["Tenormin"], propranolol: ["Inderal"], labetalol: ["Trandate"], doxazosin: ["Cardura"], methyldopa: ["Aldomet"],
  clonidine: ["Catapres"], moxonidine: ["Physiotens"], "amlodipine-valsartan": ["Exforge"], "valsartan-hctz": ["Co-Diovan"], "losartan-hctz": ["Hyzaar"],
  "telmisartan-amlodipine": ["Twynsta"], "perindopril-indapamide": ["Coversyl Plus", "Bipreterax"], "perindopril-amlodipine": ["Coveram"],
  gtn: ["Nitrolingual", "Glyceryl trinitrate"], "isosorbide-mononitrate": ["Imdur", "Elantan"], nicorandil: ["Ikorel"], ranolazine: ["Ranexa"], trimetazidine: ["Vastarel MR"],
  "atorvastatin-ezetimibe": ["Atozet"], "rosuvastatin-ezetimibe": ["Zympass"], simvastatin: ["Zocor"], pravastatin: ["Pravachol"], fenofibrate: ["Lipanthyl"],
  "omega-3-ethyl-esters": ["Omacor"], enoxaparin: ["Clexane"],
  colchicine: ["Colchicine"], ibuprofen: ["Brufen"], prednisolone: ["Prednisolone"], hydrocortisone: ["Solu-Cortef"], methylprednisolone: ["Solu-Medrol", "Medrol"], dexamethasone: ["Dexamethasone"],
  amoxicillin: ["Amoxil"], "amoxicillin-clavulanate": ["Augmentin"], flucloxacillin: ["Floxapen"], "piperacillin-tazobactam": ["Tazocin"], cefuroxime: ["Zinnat"], ceftriaxone: ["Rocephin"],
  meropenem: ["Meronem"], azithromycin: ["Zithromax"], clarithromycin: ["Klacid"], doxycycline: ["Vibramycin"], levofloxacin: ["Tavanic"], moxifloxacin: ["Avelox"],
  ciprofloxacin: ["Ciprobay"], vancomycin: ["Vancocin"], linezolid: ["Zyvox"], gentamicin: ["Garamycin"], metronidazole: ["Flagyl"], clindamycin: ["Dalacin C"],
  "co-trimoxazole": ["Septrin"], nitrofurantoin: ["Macrobid"], oseltamivir: ["Tamiflu"],
  pantoprazole: ["Controloc"], esomeprazole: ["Nexium"], omeprazole: ["Losec"], "sodium-zirconium-cyclosilicate": ["Lokelma"], patiromer: ["Veltassa"], "potassium-chloride": ["Slow-K"],
  propafenone: ["Rytmonorm"], dronedarone: ["Multaq"], "metoprolol-tartrate": ["Lopressor", "Betaloc"], acetazolamide: ["Diamox"],
  tadalafil: ["Adcirca"], bosentan: ["Tracleer"], ambrisentan: ["Volibris"], macitentan: ["Opsumit"], riociguat: ["Adempas"], selexipag: ["Uptravi"],
  tafamidis: ["Vyndamax", "Vyndaqel"], mavacamten: ["Camzyos"], cilostazol: ["Pletal"], fondaparinux: ["Arixtra"],
  benzylpenicillin: ["Crystapen"], ampicillin: ["Penbritin"], cefazolin: ["Kefzol"], daptomycin: ["Cubicin"], rifampicin: ["Rifadin"],
  allopurinol: ["Zyloric"], febuxostat: ["Adenuric"], levothyroxine: ["Eltroxin", "Euthyrox"], carbimazole: ["Neo-Mercazole"], paracetamol: ["Panadol", "Adol"],
  salbutamol: ["Ventolin"], tiotropium: ["Spiriva"], varenicline: ["Champix"], "nicotine-patch": ["Nicorette", "NiQuitin"],
  metformin: ["Glucophage", "Glucophage XR"], liraglutide: ["Victoza", "Saxenda"], dulaglutide: ["Trulicity"],
  semaglutide: ["Ozempic", "Wegovy"], "semaglutide-oral": ["Rybelsus"], tirzepatide: ["Mounjaro"],
  sitagliptin: ["Januvia"], linagliptin: ["Trajenta"], vildagliptin: ["Galvus"], saxagliptin: ["Onglyza"], alogliptin: ["Vipidia"],
  gliclazide: ["Diamicron MR"], glimepiride: ["Amaryl"], glibenclamide: ["Daonil"], pioglitazone: ["Actos"],
  "insulin-glargine": ["Lantus", "Basaglar"], "insulin-glargine-u300": ["Toujeo"], "insulin-degludec": ["Tresiba"], "insulin-detemir": ["Levemir"],
  "insulin-nph": ["Insulatard", "Humulin N"], "insulin-aspart": ["NovoRapid", "Fiasp"], "insulin-lispro": ["Humalog"], "insulin-aspart-30": ["NovoMix 30"],
};
for (const d of MEDICATIONS) if (BRANDS[d.code]) d.brands = BRANDS[d.code];

// "Empagliflozin (Jardiance)"
export function withBrand(code: string) {
  const d = MEDICATION[code];
  if (!d) return code;
  return d.brands?.length ? `${d.name} (${d.brands[0]})` : d.name;
}
// first trade name, or the generic name when none is listed
export const brandOf = (code: string) => MEDICATION[code]?.brands?.[0] ?? MEDICATION[code]?.name ?? code;
// generic name, class and trade names, lower-cased for search
export const medicationSearchText = (d: MedicationDef) => [d.name, d.drugClass, ...(d.brands ?? [])].join(" ").toLowerCase();
export const MEDICATION: Record<string, MedicationDef> = Object.fromEntries(MEDICATIONS.map((d) => [d.code, d]));

export const PURPOSE_ORDER: MedicationDef["purpose"][] = [
  "Heart failure", "CAD / secondary prevention", "Angina", "Lipids", "Anticoagulation", "Rhythm", "Blood pressure", "Cardiometabolic", "Diabetes", "Pulmonary hypertension",
  "Cardiomyopathy", "Infection", "Anti-inflammatory", "Supportive", "General medicine",
];

// Which medication purposes are relevant to which diagnosis tags
export const PURPOSE_FOR_TAG: Record<string, MedicationDef["purpose"][]> = {
  hf: ["Heart failure"],
  cad: ["CAD / secondary prevention", "Angina", "Lipids"],
  acs: ["CAD / secondary prevention", "Lipids"],
  af: ["Anticoagulation", "Rhythm"],
  htn: ["Blood pressure"],
  dm: ["Cardiometabolic", "Diabetes"],
  ckd: ["Cardiometabolic"],
  lipids: ["CAD / secondary prevention", "Lipids"],
  cmp: ["Cardiomyopathy"],
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
  { id: "ecg", category: "investigation", title: "12-lead ECG", completesOn: { type: "study", kind: "ecg" }, offsets: [0, 7, 28] },
  { id: "holter", category: "investigation", title: "Holter monitor", completesOn: { type: "study", kind: "holter" }, offsets: [14, 28] },
  { id: "stress", category: "investigation", title: "Stress test", completesOn: { type: "study", kind: "stress" }, offsets: [14, 28, 56] },
  { id: "cmr", category: "investigation", title: "Cardiac MRI", completesOn: { type: "study", kind: "cmr" }, offsets: [28, 56] },
  { id: "device", category: "follow_up", title: "ICD/CRT reassessment after repeat Echo", completesOn: { type: "manual" }, offsets: [90, 180] },
  { id: "cmr", category: "investigation", title: "Cardiac MRI with contrast (cardiomyopathy)", completesOn: { type: "study", kind: "cmr" }, offsets: [14, 28, 56] },
  { id: "genetic-test", category: "referral", title: "Genetic counselling and testing (cardiomyopathy)", completesOn: { type: "manual" }, offsets: [14, 28, 56] },
  { id: "hcm-lvot", category: "investigation", title: "Echo: LVOT gradient at rest and provoked (Valsalva, standing)", completesOn: { type: "study", kind: "echo" }, offsets: [0, 14, 28] },
  { id: "exercise-echo", category: "investigation", title: "Exercise echo (LVOT gradient, HCM)", completesOn: { type: "study", kind: "stress" }, offsets: [14, 28, 56] },
  { id: "icd-referral", category: "referral", title: "ICD assessment (secondary prevention)", completesOn: { type: "manual" }, offsets: [0, 7, 14] },
  { id: "amyloid-typing", category: "investigation", title: "Amyloid typing: serum free light chains, serum and urine immunofixation, bone-tracer scintigraphy", completesOn: { type: "manual" }, offsets: [7, 14, 28] },
  { id: "haematology-al", category: "referral", title: "Haematology: monoclonal protein with cardiac amyloidosis (exclude AL)", completesOn: { type: "manual" }, offsets: [0, 3, 7] },
  { id: "tafamidis", category: "referral", title: "Tafamidis for ATTR cardiomyopathy (specialist start)", completesOn: { type: "manual" }, offsets: [14, 28, 56] },
  { id: "arvc-bb", category: "medication", title: "ARVC with ventricular arrhythmia: start a beta-blocker", completesOn: { type: "manual" }, offsets: [0, 7, 14] },
  { id: "myo-cmr", category: "investigation", title: "Cardiac MRI (myocarditis)", completesOn: { type: "study", kind: "cmr" }, offsets: [0, 14, 28] },
  { id: "myo-bb", category: "medication", title: "Myocarditis: beta-blocker for at least 6 months", completesOn: { type: "manual" }, offsets: [0, 7, 14] },
  { id: "pah-risk", category: "follow_up", title: "PAH: risk assessment (functional class, 6-minute walk, NT-proBNP)", completesOn: { type: "visit" }, offsets: [0, 14, 28] },
  // medicine monitoring (shared/drug-monitoring.ts): the check a due finding books
  { id: "mon-lft", category: "monitoring", title: "Liver function check (medicine monitoring)", completesOn: { type: "lab", codes: ["alt"] }, offsets: [0, 7, 14] },
  { id: "mon-tsh", category: "monitoring", title: "TSH check (medicine monitoring)", completesOn: { type: "lab", codes: ["tsh"] }, offsets: [0, 7, 14] },
  { id: "mon-hb", category: "monitoring", title: "Haemoglobin check (medicine monitoring)", completesOn: { type: "lab", codes: ["haemoglobin"] }, offsets: [0, 7, 14] },
  { id: "mon-renal", category: "monitoring", title: "Renal function check (medicine monitoring)", completesOn: { type: "lab", codes: ["creatinine"] }, offsets: [0, 7, 14] },
  { id: "mon-doac", category: "monitoring", title: "Haemoglobin, renal and liver function (anticoagulant follow-up)", completesOn: { type: "lab", codes: ["haemoglobin", "creatinine", "alt"] }, offsets: [0, 7, 14] },
  { id: "cteph-workup", category: "investigation", title: "CTEPH / CTEPD work-up after pulmonary embolism: echo, NT-proBNP and V/Q scan", completesOn: { type: "manual" }, offsets: [7, 14, 28] },
  { id: "cteph-team", category: "referral", title: "CTEPH team review: multimodality management (PEA, BPA, riociguat)", completesOn: { type: "manual" }, offsets: [7, 14, 28] },
  { id: "ph-referral", category: "referral", title: "PH centre referral: right heart catheterisation (pulmonary hypertension work-up)", completesOn: { type: "manual" }, offsets: [7, 14, 28] },
  { id: "cmp-echo", category: "investigation", title: "ECG and echo (cardiomyopathy follow-up)", completesOn: { type: "study", kind: "echo" }, offsets: [0, 14, 28] },
  { id: "valve-echo", category: "investigation", title: "Echo (valve surveillance)", completesOn: { type: "study", kind: "echo" }, offsets: [0, 14, 28] },
  { id: "device-first-check", category: "investigation", title: "First device check after implant (in person)", completesOn: { type: "study", kind: "device_check" }, offsets: [14, 42, 84] },
  { id: "wound-check", category: "follow_up", title: "Clinic wound check (device)", completesOn: { type: "visit" }, offsets: [7, 10] },
  { id: "remote-monitoring", category: "follow_up", title: "Start remote device monitoring", completesOn: { type: "manual" }, offsets: [0, 7, 14] },
  { id: "device-check", category: "investigation", title: "Device check", completesOn: { type: "study", kind: "device_check" }, offsets: [0, 14, 28] },
  { id: "generator-change", category: "referral", title: "Device generator change", completesOn: { type: "manual" }, offsets: [7, 14, 28] },
  { id: "lead-review", category: "referral", title: "Device lead review (EP)", completesOn: { type: "manual" }, offsets: [0, 7, 14] },
  { id: "device-referral", category: "referral", title: "EP referral for ICD/CRT", completesOn: { type: "manual" }, offsets: [14, 28, 56] },
  { id: "heart-team", category: "referral", title: "Heart Team discussion (mitral TEER)", completesOn: { type: "manual" }, offsets: [14, 28] },
  { id: "advanced-hf", category: "referral", title: "Advanced HF centre consultation", completesOn: { type: "manual" }, offsets: [7, 14, 28] },
  { id: "rehab", category: "referral", title: "Cardiac rehabilitation referral", completesOn: { type: "manual" }, offsets: [7, 14] },
  { id: "lipids", category: "monitoring", title: "Lipid profile", completesOn: { type: "lab", codes: ["ldl-c"] }, offsets: [42, 84] },
  { id: "iron", category: "monitoring", title: "Iron studies", completesOn: { type: "lab", codes: ["ferritin", "tsat"] }, offsets: [7, 28] },
  { id: "phone", category: "follow_up", title: "Phone follow-up", completesOn: { type: "manual" }, offsets: [3, 7] },
  { id: "education", category: "education", title: "HF self-care education", completesOn: { type: "manual" }, offsets: [0, 7] },
  { id: "hba1c", category: "monitoring", title: "HbA1c", completesOn: { type: "lab", codes: ["hba1c"] }, offsets: [90, 180] },
  { id: "dm-eyes", category: "referral", title: "Diabetic retinal screening", completesOn: { type: "manual" }, offsets: [28, 90] },
  { id: "dm-feet", category: "monitoring", title: "Diabetic foot examination", completesOn: { type: "manual" }, offsets: [0, 28] },
];

// Drug classes used to merge duplicate suggestions and to record why a class is not given.
export const CLASS_TAGS = ["sglt2", "glp1", "mra", "arni", "raas", "bb", "statin", "ezetimibe", "pcsk9", "p2y12", "oac", "antiplatelet", "iv-iron"];
export const CLASS_LABEL: Record<string, string> = {
  sglt2: "SGLT2 inhibitor", glp1: "GLP-1 receptor agonist", mra: "MRA", arni: "ARNI", raas: "ACE inhibitor / ARB / ARNI", bb: "Beta-blocker",
  statin: "Statin", ezetimibe: "Ezetimibe", pcsk9: "PCSK9 therapy", p2y12: "P2Y12 inhibitor", oac: "Anticoagulant", antiplatelet: "Antiplatelet", "iv-iron": "IV iron",
};
export const drugClassOf = (code: string) => CLASS_TAGS.find((t) => MEDICATION[code]?.tags.includes(t)) ?? code;
// "SGLT2 inhibitor", "Dose increase: Beta-blocker", or the drug name for a class-less drug
export const classLabel = (cls: string) => {
  const up = cls.startsWith("up:");
  const c = up ? cls.slice(3) : cls;
  const name = CLASS_LABEL[c] ?? MEDICATION[c]?.name ?? c;
  return up ? `Dose increase: ${name}` : name;
};

// Why a drug class is not given. Intolerance and contraindication stay until cleared; the others
// come back at the next visit or admission.
export const BARRIER_CATEGORIES = [
  { value: "intolerance", label: "Intolerance / side effect", lasting: true },
  { value: "contraindication", label: "Contraindication", lasting: true },
  { value: "declined", label: "Patient declines", lasting: false },
  { value: "unavailable", label: "Not available", lasting: false },
  { value: "cost", label: "Cost", lasting: false },
  { value: "other", label: "Not now (review next visit)", lasting: false },
] as const;
export const BARRIER_LABEL: Record<string, string> = Object.fromEntries(BARRIER_CATEGORIES.map((c) => [c.value, c.label]));
