import type { Express, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB, QueryDB } from "./db.js";
import { audit } from "./db.js";
import { FoundationError, recordClinicalFact } from "./clinical-foundation.js";
import {
  ckdEpi2021Creatinine,
  cockcroftGault,
  trendDirection,
  type LabResult,
} from "../src/medication-laboratory.js";

const SITE = "demo-kuwait";
const IMPLEMENTATION_DATE = "2026-09-22";

type MedicationSeed = {
  id: string;
  name: string;
  drugClass: string;
  category: string;
  groups: string[];
  routes?: string[];
};

const medicationGroups = [
  ["hf-cardiorenal", "Heart Failure / Cardiorenal"],
  ["ace-inhibitors", "ACE inhibitors"],
  ["arbs", "ARBs"],
  ["arnis", "ARNIs"],
  ["evidence-beta-blockers", "Evidence-based beta blockers"],
  ["mras", "Mineralocorticoid receptor antagonists"],
  ["nonsteroidal-mras", "Nonsteroidal MRAs"],
  ["sglt2-inhibitors", "SGLT2 inhibitors"],
  ["loop-diuretics", "Loop diuretics"],
  ["thiazide-diuretics", "Thiazide / thiazide-like diuretics"],
  ["vasodilators", "Vasodilators"],
  ["antiplatelet", "Antiplatelet"],
  ["p2y12-inhibitors", "P2Y12 inhibitors"],
  ["anticoagulation", "Anticoagulation"],
  ["doacs", "Direct oral anticoagulants"],
  ["heparins", "Heparins"],
  ["lipid-lowering", "Lipid-lowering"],
  ["statins", "Statins"],
  ["pcsk9-therapies", "PCSK9 therapies"],
  ["antianginal", "Antianginal"],
  ["calcium-channel-blockers", "Calcium-channel blockers"],
  ["nitrates", "Nitrates"],
  ["antiarrhythmic", "Antiarrhythmic"],
  ["antihypertensive", "Antihypertensive"],
  ["alpha-blockers", "Alpha blockers"],
  ["centrally-acting", "Centrally acting therapies"],
  ["cardiometabolic", "Cardiometabolic"],
  ["glp1-agonists", "GLP-1 receptor agonists"],
  ["dual-gip-glp1", "Dual GIP / GLP-1 therapies"],
  ["pulmonary-hypertension", "Pulmonary hypertension therapies"],
] as const;

const medications: MedicationSeed[] = [
  {
    id: "ramipril",
    name: "Ramipril",
    drugClass: "ACE inhibitor",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "ace-inhibitors", "antihypertensive"],
  },
  {
    id: "perindopril",
    name: "Perindopril",
    drugClass: "ACE inhibitor",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "ace-inhibitors", "antihypertensive"],
  },
  {
    id: "lisinopril",
    name: "Lisinopril",
    drugClass: "ACE inhibitor",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "ace-inhibitors", "antihypertensive"],
  },
  {
    id: "candesartan",
    name: "Candesartan",
    drugClass: "ARB",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "arbs", "antihypertensive"],
  },
  {
    id: "valsartan",
    name: "Valsartan",
    drugClass: "ARB",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "arbs", "antihypertensive"],
  },
  {
    id: "losartan",
    name: "Losartan",
    drugClass: "ARB",
    category: "Antihypertensive",
    groups: ["arbs", "antihypertensive"],
  },
  {
    id: "sacubitril-valsartan",
    name: "Sacubitril / valsartan",
    drugClass: "ARNI",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "arnis"],
  },
  {
    id: "bisoprolol",
    name: "Bisoprolol",
    drugClass: "Beta blocker",
    category: "Heart Failure / Cardiorenal",
    groups: [
      "hf-cardiorenal",
      "evidence-beta-blockers",
      "antianginal",
      "antihypertensive",
    ],
  },
  {
    id: "carvedilol",
    name: "Carvedilol",
    drugClass: "Beta blocker",
    category: "Heart Failure / Cardiorenal",
    groups: [
      "hf-cardiorenal",
      "evidence-beta-blockers",
      "antianginal",
      "antihypertensive",
    ],
  },
  {
    id: "metoprolol-succinate",
    name: "Metoprolol succinate",
    drugClass: "Beta blocker",
    category: "Heart Failure / Cardiorenal",
    groups: [
      "hf-cardiorenal",
      "evidence-beta-blockers",
      "antianginal",
      "antihypertensive",
    ],
  },
  {
    id: "spironolactone",
    name: "Spironolactone",
    drugClass: "Steroidal MRA",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "mras"],
  },
  {
    id: "eplerenone",
    name: "Eplerenone",
    drugClass: "Steroidal MRA",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "mras"],
  },
  {
    id: "finerenone",
    name: "Finerenone",
    drugClass: "Nonsteroidal MRA",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "nonsteroidal-mras"],
  },
  {
    id: "dapagliflozin",
    name: "Dapagliflozin",
    drugClass: "SGLT2 inhibitor",
    category: "Cardiometabolic",
    groups: ["hf-cardiorenal", "sglt2-inhibitors", "cardiometabolic"],
  },
  {
    id: "empagliflozin",
    name: "Empagliflozin",
    drugClass: "SGLT2 inhibitor",
    category: "Cardiometabolic",
    groups: ["hf-cardiorenal", "sglt2-inhibitors", "cardiometabolic"],
  },
  {
    id: "furosemide",
    name: "Furosemide",
    drugClass: "Loop diuretic",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "loop-diuretics", "antihypertensive"],
  },
  {
    id: "bumetanide",
    name: "Bumetanide",
    drugClass: "Loop diuretic",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "loop-diuretics"],
  },
  {
    id: "torsemide",
    name: "Torsemide",
    drugClass: "Loop diuretic",
    category: "Heart Failure / Cardiorenal",
    groups: ["hf-cardiorenal", "loop-diuretics"],
  },
  {
    id: "indapamide",
    name: "Indapamide",
    drugClass: "Thiazide-like diuretic",
    category: "Antihypertensive",
    groups: ["thiazide-diuretics", "antihypertensive"],
  },
  {
    id: "hydrochlorothiazide",
    name: "Hydrochlorothiazide",
    drugClass: "Thiazide diuretic",
    category: "Antihypertensive",
    groups: ["thiazide-diuretics", "antihypertensive"],
  },
  {
    id: "hydralazine",
    name: "Hydralazine",
    drugClass: "Direct vasodilator",
    category: "Vasodilator",
    groups: ["vasodilators", "antihypertensive"],
  },
  {
    id: "ivabradine",
    name: "Ivabradine",
    drugClass: "If-channel inhibitor",
    category: "Heart Failure / Antianginal",
    groups: ["hf-cardiorenal", "antianginal"],
  },
  {
    id: "digoxin",
    name: "Digoxin",
    drugClass: "Cardiac glycoside",
    category: "Heart Failure / Rate control",
    groups: ["hf-cardiorenal", "antiarrhythmic"],
  },
  {
    id: "aspirin",
    name: "Aspirin",
    drugClass: "Antiplatelet",
    category: "Antiplatelet",
    groups: ["antiplatelet"],
  },
  {
    id: "clopidogrel",
    name: "Clopidogrel",
    drugClass: "P2Y12 inhibitor",
    category: "Antiplatelet",
    groups: ["antiplatelet", "p2y12-inhibitors"],
  },
  {
    id: "ticagrelor",
    name: "Ticagrelor",
    drugClass: "P2Y12 inhibitor",
    category: "Antiplatelet",
    groups: ["antiplatelet", "p2y12-inhibitors"],
  },
  {
    id: "prasugrel",
    name: "Prasugrel",
    drugClass: "P2Y12 inhibitor",
    category: "Antiplatelet",
    groups: ["antiplatelet", "p2y12-inhibitors"],
  },
  {
    id: "apixaban",
    name: "Apixaban",
    drugClass: "Factor Xa inhibitor",
    category: "Anticoagulation",
    groups: ["anticoagulation", "doacs"],
  },
  {
    id: "rivaroxaban",
    name: "Rivaroxaban",
    drugClass: "Factor Xa inhibitor",
    category: "Anticoagulation",
    groups: ["anticoagulation", "doacs"],
  },
  {
    id: "edoxaban",
    name: "Edoxaban",
    drugClass: "Factor Xa inhibitor",
    category: "Anticoagulation",
    groups: ["anticoagulation", "doacs"],
  },
  {
    id: "dabigatran",
    name: "Dabigatran",
    drugClass: "Direct thrombin inhibitor",
    category: "Anticoagulation",
    groups: ["anticoagulation", "doacs"],
  },
  {
    id: "warfarin",
    name: "Warfarin",
    drugClass: "Vitamin K antagonist",
    category: "Anticoagulation",
    groups: ["anticoagulation"],
  },
  {
    id: "enoxaparin",
    name: "Enoxaparin",
    drugClass: "LMWH",
    category: "Anticoagulation",
    groups: ["anticoagulation", "heparins"],
    routes: ["Subcutaneous"],
  },
  {
    id: "unfractionated-heparin",
    name: "Unfractionated heparin",
    drugClass: "UFH",
    category: "Anticoagulation",
    groups: ["anticoagulation", "heparins"],
    routes: ["Intravenous", "Subcutaneous"],
  },
  {
    id: "atorvastatin",
    name: "Atorvastatin",
    drugClass: "Statin",
    category: "Lipid-lowering",
    groups: ["lipid-lowering", "statins"],
  },
  {
    id: "rosuvastatin",
    name: "Rosuvastatin",
    drugClass: "Statin",
    category: "Lipid-lowering",
    groups: ["lipid-lowering", "statins"],
  },
  {
    id: "ezetimibe",
    name: "Ezetimibe",
    drugClass: "Cholesterol absorption inhibitor",
    category: "Lipid-lowering",
    groups: ["lipid-lowering"],
  },
  {
    id: "evolocumab",
    name: "Evolocumab",
    drugClass: "PCSK9 monoclonal antibody",
    category: "Lipid-lowering",
    groups: ["lipid-lowering", "pcsk9-therapies"],
    routes: ["Subcutaneous"],
  },
  {
    id: "alirocumab",
    name: "Alirocumab",
    drugClass: "PCSK9 monoclonal antibody",
    category: "Lipid-lowering",
    groups: ["lipid-lowering", "pcsk9-therapies"],
    routes: ["Subcutaneous"],
  },
  {
    id: "inclisiran",
    name: "Inclisiran",
    drugClass: "PCSK9 siRNA",
    category: "Lipid-lowering",
    groups: ["lipid-lowering", "pcsk9-therapies"],
    routes: ["Subcutaneous"],
  },
  {
    id: "bempedoic-acid",
    name: "Bempedoic acid",
    drugClass: "ATP citrate lyase inhibitor",
    category: "Lipid-lowering",
    groups: ["lipid-lowering"],
  },
  {
    id: "amlodipine",
    name: "Amlodipine",
    drugClass: "Dihydropyridine calcium-channel blocker",
    category: "Antihypertensive / Antianginal",
    groups: ["calcium-channel-blockers", "antianginal", "antihypertensive"],
  },
  {
    id: "diltiazem",
    name: "Diltiazem",
    drugClass: "Non-dihydropyridine calcium-channel blocker",
    category: "Antianginal / Rate control",
    groups: [
      "calcium-channel-blockers",
      "antianginal",
      "antiarrhythmic",
      "antihypertensive",
    ],
  },
  {
    id: "verapamil",
    name: "Verapamil",
    drugClass: "Non-dihydropyridine calcium-channel blocker",
    category: "Antianginal / Rate control",
    groups: [
      "calcium-channel-blockers",
      "antianginal",
      "antiarrhythmic",
      "antihypertensive",
    ],
  },
  {
    id: "isosorbide-mononitrate",
    name: "Isosorbide mononitrate",
    drugClass: "Nitrate",
    category: "Antianginal",
    groups: ["nitrates", "antianginal", "vasodilators"],
  },
  {
    id: "nitroglycerin",
    name: "Nitroglycerin",
    drugClass: "Nitrate",
    category: "Antianginal",
    groups: ["nitrates", "antianginal", "vasodilators"],
  },
  {
    id: "ranolazine",
    name: "Ranolazine",
    drugClass: "Late sodium current inhibitor",
    category: "Antianginal",
    groups: ["antianginal"],
  },
  {
    id: "amiodarone",
    name: "Amiodarone",
    drugClass: "Class III antiarrhythmic",
    category: "Antiarrhythmic",
    groups: ["antiarrhythmic"],
  },
  {
    id: "flecainide",
    name: "Flecainide",
    drugClass: "Class Ic antiarrhythmic",
    category: "Antiarrhythmic",
    groups: ["antiarrhythmic"],
  },
  {
    id: "propafenone",
    name: "Propafenone",
    drugClass: "Class Ic antiarrhythmic",
    category: "Antiarrhythmic",
    groups: ["antiarrhythmic"],
  },
  {
    id: "sotalol",
    name: "Sotalol",
    drugClass: "Class III antiarrhythmic / beta blocker",
    category: "Antiarrhythmic",
    groups: ["antiarrhythmic"],
  },
  {
    id: "dronedarone",
    name: "Dronedarone",
    drugClass: "Multichannel antiarrhythmic",
    category: "Antiarrhythmic",
    groups: ["antiarrhythmic"],
  },
  {
    id: "doxazosin",
    name: "Doxazosin",
    drugClass: "Alpha-1 blocker",
    category: "Antihypertensive",
    groups: ["alpha-blockers", "antihypertensive"],
  },
  {
    id: "clonidine",
    name: "Clonidine",
    drugClass: "Central alpha-2 agonist",
    category: "Antihypertensive",
    groups: ["centrally-acting", "antihypertensive"],
  },
  {
    id: "metformin",
    name: "Metformin",
    drugClass: "Biguanide",
    category: "Cardiometabolic",
    groups: ["cardiometabolic"],
  },
  {
    id: "semaglutide",
    name: "Semaglutide",
    drugClass: "GLP-1 receptor agonist",
    category: "Cardiometabolic",
    groups: ["cardiometabolic", "glp1-agonists"],
    routes: ["Subcutaneous", "Oral"],
  },
  {
    id: "liraglutide",
    name: "Liraglutide",
    drugClass: "GLP-1 receptor agonist",
    category: "Cardiometabolic",
    groups: ["cardiometabolic", "glp1-agonists"],
    routes: ["Subcutaneous"],
  },
  {
    id: "dulaglutide",
    name: "Dulaglutide",
    drugClass: "GLP-1 receptor agonist",
    category: "Cardiometabolic",
    groups: ["cardiometabolic", "glp1-agonists"],
    routes: ["Subcutaneous"],
  },
  {
    id: "tirzepatide",
    name: "Tirzepatide",
    drugClass: "Dual GIP / GLP-1 receptor agonist",
    category: "Cardiometabolic",
    groups: ["cardiometabolic", "dual-gip-glp1"],
    routes: ["Subcutaneous"],
  },
  {
    id: "sildenafil",
    name: "Sildenafil",
    drugClass: "PDE-5 inhibitor",
    category: "Pulmonary hypertension",
    groups: ["pulmonary-hypertension", "vasodilators"],
  },
  {
    id: "riociguat",
    name: "Riociguat",
    drugClass: "Soluble guanylate cyclase stimulator",
    category: "Pulmonary hypertension",
    groups: ["pulmonary-hypertension", "vasodilators"],
  },
  {
    id: "bosentan",
    name: "Bosentan",
    drugClass: "Endothelin receptor antagonist",
    category: "Pulmonary hypertension",
    groups: ["pulmonary-hypertension"],
  },
];

const indicationSeeds = [
  ["HFrEF", "HFrEF"],
  ["hypertension", "Hypertension"],
  ["af-rate-control", "AF rate control"],
  ["cad", "CAD"],
  ["post-mi", "Post-MI"],
  ["dyslipidaemia", "Dyslipidaemia"],
  ["anticoagulation-af", "Anticoagulation for AF"],
  ["mechanical-valve", "Mechanical valve"],
  ["vte", "VTE"],
  ["cardiorenal-protection", "CKD / cardiorenal protection"],
  ["diabetes", "Diabetes"],
  ["obesity", "Obesity"],
  ["other", "Other"],
] as const;

const labSeeds = [
  [
    "creatinine",
    "Creatinine",
    "Renal / electrolytes",
    "mg/dL",
    ["mg/dL", "µmol/L"],
  ],
  [
    "egfr-ckd-epi-2021",
    "eGFR (2021 CKD-EPI creatinine)",
    "Renal / electrolytes",
    "mL/min/1.73m2",
    ["mL/min/1.73m2"],
  ],
  [
    "crcl-cockcroft-gault",
    "Creatinine clearance (Cockcroft-Gault)",
    "Renal / electrolytes",
    "mL/min",
    ["mL/min"],
  ],
  ["urea", "Urea", "Renal / electrolytes", "mmol/L", ["mmol/L"]],
  ["bun", "Blood urea nitrogen", "Renal / electrolytes", "mg/dL", ["mg/dL"]],
  ["sodium", "Sodium", "Renal / electrolytes", "mmol/L", ["mmol/L"]],
  ["potassium", "Potassium", "Renal / electrolytes", "mmol/L", ["mmol/L"]],
  ["magnesium", "Magnesium", "Renal / electrolytes", "mmol/L", ["mmol/L"]],
  ["bicarbonate", "Bicarbonate", "Renal / electrolytes", "mmol/L", ["mmol/L"]],
  ["haemoglobin", "Haemoglobin", "Hematology", "g/dL", ["g/dL", "g/L"]],
  ["haematocrit", "Haematocrit", "Hematology", "%", ["%"]],
  ["wbc", "White blood cell count", "Hematology", "10^9/L", ["10^9/L"]],
  ["platelets", "Platelets", "Hematology", "10^9/L", ["10^9/L"]],
  ["glucose", "Glucose", "Metabolic", "mmol/L", ["mmol/L"]],
  ["hba1c", "HbA1c", "Metabolic", "%", ["%"]],
  ["total-cholesterol", "Total cholesterol", "Lipids", "mmol/L", ["mmol/L"]],
  ["ldl-c", "LDL-C", "Lipids", "mmol/L", ["mmol/L"]],
  ["hdl-c", "HDL-C", "Lipids", "mmol/L", ["mmol/L"]],
  ["triglycerides", "Triglycerides", "Lipids", "mmol/L", ["mmol/L"]],
  ["non-hdl-c", "Non-HDL cholesterol", "Lipids", "mmol/L", ["mmol/L"]],
  ["apob", "Apolipoprotein B", "Lipids", "g/L", ["g/L"]],
  ["lpa", "Lipoprotein(a)", "Lipids", "nmol/L", ["nmol/L"]],
  ["alt", "ALT", "Hepatic", "U/L", ["U/L"]],
  ["ast", "AST", "Hepatic", "U/L", ["U/L"]],
  ["alp", "ALP", "Hepatic", "U/L", ["U/L"]],
  ["bilirubin", "Bilirubin", "Hepatic", "µmol/L", ["µmol/L"]],
  ["albumin", "Albumin", "Hepatic", "g/L", ["g/L"]],
  ["tsh", "TSH", "Thyroid", "mIU/L", ["mIU/L"]],
  ["ft4", "Free T4", "Thyroid", "pmol/L", ["pmol/L"]],
  [
    "hs-troponin",
    "High-sensitivity troponin",
    "Cardiac biomarkers",
    "ng/L",
    ["ng/L"],
  ],
  ["bnp", "BNP", "Cardiac biomarkers", "pg/mL", ["pg/mL"]],
  ["nt-probnp", "NT-proBNP", "Cardiac biomarkers", "pg/mL", ["pg/mL"]],
  ["ferritin", "Ferritin", "Iron", "µg/L", ["µg/L"]],
  ["transferrin-saturation", "Transferrin saturation", "Iron", "%", ["%"]],
  ["iron", "Iron", "Iron", "µmol/L", ["µmol/L"]],
  ["uacr", "Urine albumin-creatinine ratio", "Renal risk", "mg/g", ["mg/g"]],
  ["inr", "INR", "Coagulation", "ratio", ["ratio"]],
  ["pt", "Prothrombin time", "Coagulation", "s", ["s"]],
  ["aptt", "aPTT", "Coagulation", "s", ["s"]],
] as const;

const unitSeeds = [...new Set(labSeeds.flatMap((item) => item[4]))].filter(
  (unit) =>
    ![
      "mg/dL",
      "µmol/L",
      "mmol/L",
      "g/dL",
      "g/L",
      "ng/L",
      "%",
      "mL/min",
    ].includes(unit),
);

const monitoringByGroup: Record<string, [string, string][]> = {
  "ace-inhibitors": [
    ["potassium", "Renal and electrolyte surveillance"],
    ["creatinine", "Renal function surveillance"],
    ["vital.bp", "Blood pressure review"],
  ],
  arbs: [
    ["potassium", "Renal and electrolyte surveillance"],
    ["creatinine", "Renal function surveillance"],
    ["vital.bp", "Blood pressure review"],
  ],
  arnis: [
    ["potassium", "Renal and electrolyte surveillance"],
    ["creatinine", "Renal function surveillance"],
    ["vital.bp", "Blood pressure review"],
  ],
  mras: [
    ["potassium", "Potassium surveillance"],
    ["creatinine", "Renal function surveillance"],
    ["vital.bp", "Blood pressure review"],
  ],
  "nonsteroidal-mras": [
    ["potassium", "Potassium surveillance"],
    ["egfr-ckd-epi-2021", "Renal function surveillance"],
  ],
  "sglt2-inhibitors": [
    ["egfr-ckd-epi-2021", "Renal function context"],
    ["clinical.volume-status", "Volume status review"],
    ["clinical.fasting-procedure", "Fasting and procedure context"],
  ],
  "loop-diuretics": [
    ["creatinine", "Renal function surveillance"],
    ["sodium", "Electrolyte surveillance"],
    ["potassium", "Electrolyte surveillance"],
    ["magnesium", "Electrolyte surveillance"],
    ["vital.weight", "Weight review"],
    ["vital.bp", "Blood pressure review"],
  ],
  "evidence-beta-blockers": [
    ["vital.bp", "Blood pressure review"],
    ["vital.hr", "Heart rate review"],
    ["ecg.rhythm", "Rhythm and conduction context"],
  ],
  anticoagulation: [
    ["haemoglobin", "Bleeding surveillance context"],
    ["crcl-cockcroft-gault", "Medication-specific renal dosing estimate"],
    ["vital.weight", "Weight-dependent dosing context"],
    ["clinical.bleeding", "Bleeding review"],
  ],
  statins: [
    ["alt", "Hepatic context"],
    ["clinical.muscle-symptoms", "Symptom-triggered muscle safety review"],
  ],
  antiarrhythmic: [
    ["tsh", "Thyroid monitoring where medication-specific"],
    ["alt", "Hepatic monitoring where medication-specific"],
    ["ecg.qtc", "Rhythm and QT context"],
  ],
};

const json = (value: unknown) => JSON.stringify(value);
const medicationNumbers = [
  "dose_value",
  "target_dose_value",
  "planned_next_dose_value",
] as const;
const parseMedicationRow = (row: any) => {
  const parsed = { ...row };
  for (const key of medicationNumbers)
    parsed[key] =
      row[key] === null || row[key] === undefined ? null : Number(row[key]);
  return parsed;
};
const labNumbers = [
  "original_value",
  "canonical_value",
  "reference_low",
  "reference_high",
] as const;
const parseLabRow = (row: any) => {
  const parsed = { ...row };
  for (const key of labNumbers)
    parsed[key] =
      row[key] === null || row[key] === undefined ? null : Number(row[key]);
  return parsed;
};
const ageAt = (birthDate: string, at: string) => {
  const birth = new Date(`${birthDate}T00:00:00Z`),
    date = new Date(at);
  let age = date.getUTCFullYear() - birth.getUTCFullYear();
  if (
    date.getUTCMonth() < birth.getUTCMonth() ||
    (date.getUTCMonth() === birth.getUTCMonth() &&
      date.getUTCDate() < birth.getUTCDate())
  )
    age--;
  return age;
};

export async function initializeMedicationLaboratory(db: DB) {
  for (const [groupId, name] of medicationGroups)
    await db.query(
      "INSERT INTO medication.clinical_group(group_id,version,name,created_by) VALUES($1,1,$2,'system:stage2') ON CONFLICT DO NOTHING",
      [groupId, name],
    );
  for (const medication of medications) {
    await db.query(
      `INSERT INTO medication.generic_definition
       (medication_id,version,generic_name,drug_class,cardiovascular_category,common_frequencies,
        dose_metadata,renal_metadata,hepatic_metadata,pregnancy_metadata,created_by,reviewed_on)
       VALUES($1,1,$2,$3,$4,$5,$6,$7,$7,$7,'system:stage2',NULL) ON CONFLICT DO NOTHING`,
      [
        medication.id,
        medication.name,
        medication.drugClass,
        medication.category,
        json([
          "Once daily",
          "Twice daily",
          "Three times daily",
          "As required",
          "Other",
        ]),
        json({
          state: "not_clinically_curated",
          note: "Clinical dose content requires governed evidence and independent review.",
        }),
        json({ state: "not_clinically_curated" }),
      ],
    );
    await db.query(
      `INSERT INTO clinical.terminology_concept(system,code,version,display,kind,created_by)
       VALUES('cardioflow',$1,1,$2,'medication_status','system:stage2') ON CONFLICT DO NOTHING`,
      [`medication.${medication.id}.status`, `${medication.name} status`],
    );
    await db.query(
      `INSERT INTO clinical.terminology_concept(system,code,version,display,kind,created_by)
       VALUES('cardioflow',$1,1,$2,'medication_dose','system:stage2') ON CONFLICT DO NOTHING`,
      [`medication.${medication.id}.dose`, `${medication.name} dose`],
    );
    for (const group of medication.groups) {
      await db.query(
        "INSERT INTO medication.group_member(group_id,group_version,medication_id,medication_version,created_by) VALUES($1,1,$2,1,'system:stage2') ON CONFLICT DO NOTHING",
        [group, medication.id],
      );
      for (const [parameter, purpose] of monitoringByGroup[group] ?? [])
        await db.query(
          `INSERT INTO medication.monitoring_relation
           (medication_id,medication_version,parameter_type,parameter_code,purpose,priority,created_by)
           VALUES($1,1,$2,$3,$4,'recommended','system:stage2') ON CONFLICT DO NOTHING`,
          [
            medication.id,
            parameter.includes(".") ? parameter.split(".")[0] : "laboratory",
            parameter,
            purpose,
          ],
        );
    }
    const routes = medication.routes ?? ["Oral"];
    for (const route of routes) {
      const exists = (
        await db.query(
          "SELECT id FROM medication.formulation WHERE medication_id=$1 AND medication_version=1 AND form='Unspecified' AND route=$2",
          [medication.id, route],
        )
      ).rows[0];
      if (!exists)
        await db.query(
          "INSERT INTO medication.formulation(id,medication_id,medication_version,form,route,created_by) VALUES($1,$2,1,'Unspecified',$3,'system:stage2')",
          [randomUUID(), medication.id, route],
        );
    }
  }
  for (const [code, display] of indicationSeeds)
    await db.query(
      "INSERT INTO medication.indication_definition(code,version,display,created_by) VALUES($1,1,$2,'system:stage2') ON CONFLICT DO NOTHING",
      [code, display],
    );
  for (const unit of unitSeeds)
    await db.query(
      `INSERT INTO clinical.unit_definition(code,version,symbol,dimension,canonical_code,factor,conversion_offset,created_by)
       VALUES($1,1,$1,$2,$1,1,0,'system:stage2') ON CONFLICT DO NOTHING`,
      [unit, `laboratory_${unit}`],
    );
  for (const [
    testId,
    display,
    category,
    canonicalUnit,
    acceptedUnits,
  ] of labSeeds) {
    await db.query(
      `INSERT INTO laboratory.test_definition
       (test_id,version,display,category,canonical_unit,accepted_units,specimen_options,reviewed_on,created_by)
       VALUES($1,1,$2,$3,$4,$5,$6,$7,'system:stage2') ON CONFLICT DO NOTHING`,
      [
        testId,
        display,
        category,
        canonicalUnit,
        json(acceptedUnits),
        json(["Serum", "Plasma", "Whole blood", "Urine", "Other"]),
        IMPLEMENTATION_DATE,
      ],
    );
    await db.query(
      `INSERT INTO clinical.terminology_concept(system,code,version,display,kind,created_by)
       VALUES('cardioflow',$1,1,$2,'laboratory','system:stage2') ON CONFLICT DO NOTHING`,
      [`laboratory.${testId}`, display],
    );
  }
  const calculationEvidence = [
    {
      key: "niddk-egfr-equations",
      version: "2021-ckd-epi-web-2026-09-22",
      title: "eGFR Equations for Adults",
      organization:
        "U.S. National Institute of Diabetes and Digestive and Kidney Diseases",
      year: 2021,
      url: "https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations/adults",
      topic: "renal_calculation",
    },
    {
      key: "fda-cockcroft-gault-guidance",
      version: "fda-71114-verified-2026-09-22",
      title:
        "Guidance for Industry: Studies in Support of Special Populations — Geriatrics",
      organization: "U.S. Food and Drug Administration",
      year: 1989,
      url: "https://www.fda.gov/media/71114/download",
      topic: "renal_drug_dosing_calculation",
    },
  ];
  for (const source of calculationEvidence) {
    await db.query(
      `INSERT INTO decision_support.evidence_source
       (key,version,title,organization,publication_year,locator,reviewed_at,status,metadata,created_by,
        topic,source_kind,authoritative_url,last_verified_at,next_review_date,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,'approved',$8,'system:stage2',$9,'official_method',$6,$7,'2027-09-22',$10)
       ON CONFLICT DO NOTHING`,
      [
        source.key,
        source.version,
        source.title,
        source.organization,
        source.year,
        source.url,
        IMPLEMENTATION_DATE,
        json({
          clinicalGuidance: false,
          purpose: "validated_calculation_method",
        }),
        source.topic,
        "Calculation provenance only; medication-specific dose decisions still require a published governed rule.",
      ],
    );
    if (
      !(
        await db.query(
          "SELECT id FROM decision_support.evidence_status_event WHERE evidence_key=$1 AND evidence_version=$2 LIMIT 1",
          [source.key, source.version],
        )
      ).rows[0]
    )
      await db.query(
        "INSERT INTO decision_support.evidence_status_event(id,evidence_key,evidence_version,status,reason,actor) VALUES($1,$2,$3,'current','Verified against official publisher for Stage 2 calculation provenance','system:stage2')",
        [randomUUID(), source.key, source.version],
      );
  }
}

async function ensurePatient(db: QueryDB, id: string) {
  const patient = (
    await db.query<any>(
      "SELECT * FROM core.patient WHERE id=$1 AND site_id=$2",
      [z.string().uuid().parse(id), SITE],
    )
  ).rows[0];
  if (!patient) throw new FoundationError(404, "Patient not found");
  return patient;
}

const therapyEventSchema = z
  .object({
    status: z.enum(["ACTIVE", "TEMPORARILY_HELD", "STOPPED", "PLANNED"]),
    event_type: z.enum([
      "started",
      "dose_increased",
      "dose_decreased",
      "held",
      "restarted",
      "stopped",
      "planned",
      "corrected",
    ]),
    dose_value: z.number().positive().nullable().default(null),
    dose_unit: z.string().trim().min(1).max(40).nullable().default(null),
    frequency: z.string().trim().min(1).max(100).nullable().default(null),
    route: z.string().trim().min(1).max(100).nullable().default(null),
    effective_at: z.string().datetime(),
    indications: z.array(z.string().max(100)).default([]),
    prescribing_clinician: z.string().trim().min(2).max(300),
    reason: z.string().trim().max(1000).default(""),
    discontinuation_date: z.string().date().nullable().default(null),
    adherence: z.string().trim().max(200).nullable().default(null),
    target_dose_value: z.number().positive().nullable().default(null),
    target_dose_unit: z.string().trim().max(40).nullable().default(null),
    planned_next_dose_value: z.number().positive().nullable().default(null),
    planned_next_dose_unit: z.string().trim().max(40).nullable().default(null),
    planned_titration_date: z.string().date().nullable().default(null),
    comments: z.string().trim().max(2000).default(""),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.dose_value === null) !== (value.dose_unit === null))
      ctx.addIssue({
        code: "custom",
        message: "Dose value and unit must be recorded together",
        path: ["dose_value"],
      });
    if (value.status === "STOPPED" && !value.discontinuation_date)
      ctx.addIssue({
        code: "custom",
        message: "Stopped medication requires a discontinuation date",
        path: ["discontinuation_date"],
      });
    if (["held", "stopped"].includes(value.event_type) && !value.reason)
      ctx.addIssue({
        code: "custom",
        message: "A hold or stop requires a reason",
        path: ["reason"],
      });
  });

async function projectTherapyEvent(
  tx: QueryDB,
  therapy: any,
  event: any,
  actor: string,
) {
  const prior = (
    await tx.query<any>(
      `SELECT * FROM clinical.fact WHERE patient_id=$1 AND source_type='medication_therapy'
     AND source_id=$2 AND concept_code=$3 ORDER BY version DESC LIMIT 1`,
      [
        therapy.patient_id,
        therapy.id,
        `medication.${therapy.medication_id}.status`,
      ],
    )
  ).rows[0];
  await recordClinicalFact(
    tx,
    therapy.patient_id,
    {
      logical_id: prior?.logical_id,
      concept_system: "cardioflow",
      concept_code: `medication.${therapy.medication_id}.status`,
      concept_version: 1,
      value: {
        type: "coded",
        code: event.status,
        display: event.status.replaceAll("_", " "),
      },
      observed_at: new Date(event.effective_at).toISOString(),
      encounter_id: therapy.encounter_id,
      source_type: "medication_therapy",
      source_id: therapy.id,
      source_label: therapy.generic_name,
      source_quality: "high",
      verification_status: "verified",
      lifecycle_status: event.status === "STOPPED" ? "resolved" : "active",
      supersedes_fact_id: prior?.id ?? null,
    },
    actor,
  );
  if (event.dose_value !== null && event.dose_unit) {
    const dosePrior = (
      await tx.query<any>(
        `SELECT * FROM clinical.fact WHERE patient_id=$1 AND source_type='medication_therapy'
       AND source_id=$2 AND concept_code=$3 ORDER BY version DESC LIMIT 1`,
        [
          therapy.patient_id,
          therapy.id,
          `medication.${therapy.medication_id}.dose`,
        ],
      )
    ).rows[0];
    const unit = (
      await tx.query(
        "SELECT code FROM clinical.unit_definition WHERE code=$1 AND status='active'",
        [event.dose_unit],
      )
    ).rows[0];
    if (!unit) {
      await tx.query(
        `INSERT INTO clinical.unit_definition(code,version,symbol,dimension,canonical_code,factor,conversion_offset,created_by)
         VALUES($1,1,$1,'medication_dose',$1,1,0,$2) ON CONFLICT DO NOTHING`,
        [event.dose_unit, actor],
      );
    }
    await recordClinicalFact(
      tx,
      therapy.patient_id,
      {
        logical_id: dosePrior?.logical_id,
        concept_system: "cardioflow",
        concept_code: `medication.${therapy.medication_id}.dose`,
        concept_version: 1,
        value: {
          type: "quantity",
          value: Number(event.dose_value),
          unit: event.dose_unit,
        },
        observed_at: new Date(event.effective_at).toISOString(),
        encounter_id: therapy.encounter_id,
        source_type: "medication_therapy",
        source_id: therapy.id,
        source_label: `${therapy.generic_name} dose`,
        source_quality: "high",
        verification_status: "verified",
        lifecycle_status: event.status === "STOPPED" ? "resolved" : "active",
        supersedes_fact_id: dosePrior?.id ?? null,
      },
      actor,
    );
  }
}

const labInputSchema = z
  .object({
    test_id: z.string().min(1).max(120),
    value: z.number().finite(),
    unit: z.string().min(1).max(40),
    specimen: z.string().max(100).nullable().default(null),
    collected_at: z.string().datetime(),
    resulted_at: z.string().datetime(),
    source_type: z.string().min(1).max(100),
    source_id: z.string().min(1).max(300),
    source_label: z.string().min(1).max(300),
    laboratory_name: z.string().max(300).nullable().default(null),
    reference_low: z.number().finite().nullable().default(null),
    reference_high: z.number().finite().nullable().default(null),
    abnormal_flag: z
      .enum([
        "low",
        "high",
        "critical_low",
        "critical_high",
        "normal",
        "unknown",
      ])
      .nullable()
      .default(null),
    verification_status: z.enum([
      "unconfirmed",
      "preliminary",
      "verified",
      "entered_in_error",
    ]),
    provenance: z.record(z.string(), z.json()).default({}),
    encounter_id: z.string().uuid().nullable().default(null),
    supersedes_result_id: z.string().uuid().nullable().default(null),
  })
  .strict();

async function normalizeLab(
  tx: QueryDB,
  test: any,
  value: number,
  unit: string,
) {
  const accepted = test.accepted_units as string[];
  if (!accepted.includes(unit))
    throw new FoundationError(
      422,
      `${unit} is not an accepted unit for ${test.display}`,
    );
  if (unit === test.canonical_unit) return value;
  const rows = (
    await tx.query<any>(
      "SELECT * FROM clinical.unit_definition WHERE code=$1 OR code=$2 ORDER BY version DESC",
      [unit, test.canonical_unit],
    )
  ).rows;
  const from = rows.find((row) => row.code === unit),
    to = rows.find((row) => row.code === test.canonical_unit);
  if (!from || !to || from.dimension !== to.dimension)
    throw new FoundationError(
      422,
      "No validated conversion exists for these units",
    );
  const canonical =
    value * Number(from.factor) + Number(from.conversion_offset);
  return (canonical - Number(to.conversion_offset)) / Number(to.factor);
}

async function appendLabResult(
  tx: QueryDB,
  patient: any,
  input: z.infer<typeof labInputSchema>,
  actor: string,
  calculation?: { method: string; version: string; inputs: unknown[] },
) {
  const test = (
    await tx.query<any>(
      "SELECT * FROM laboratory.test_definition WHERE test_id=$1 AND status='active' ORDER BY version DESC LIMIT 1",
      [input.test_id],
    )
  ).rows[0];
  if (!test)
    throw new FoundationError(422, "Unknown or inactive laboratory test");
  const canonicalValue = await normalizeLab(tx, test, input.value, input.unit);
  let logicalId = randomUUID(),
    version = 1,
    prior: any = null;
  if (input.supersedes_result_id) {
    prior = (
      await tx.query<any>(
        "SELECT * FROM laboratory.result WHERE id=$1 AND patient_id=$2",
        [input.supersedes_result_id, patient.id],
      )
    ).rows[0];
    if (!prior)
      throw new FoundationError(404, "Superseded laboratory result not found");
    if (prior.test_id !== input.test_id)
      throw new FoundationError(
        422,
        "A laboratory correction must retain its test",
      );
    logicalId = prior.logical_id;
    version = Number(prior.version) + 1;
  }
  const id = randomUUID();
  const fact = await recordClinicalFact(
    tx,
    patient.id,
    {
      logical_id: prior ? undefined : logicalId,
      concept_system: "cardioflow",
      concept_code: `laboratory.${input.test_id}`,
      concept_version: 1,
      value: {
        type: "quantity",
        value: canonicalValue,
        unit: test.canonical_unit,
      },
      observed_at: input.collected_at,
      encounter_id: input.encounter_id,
      source_type: "laboratory_result",
      source_id: id,
      source_label: input.source_label,
      source_quality:
        input.verification_status === "verified" ? "high" : "moderate",
      verification_status: input.verification_status,
      lifecycle_status:
        input.verification_status === "entered_in_error"
          ? "retracted"
          : "active",
      supersedes_fact_id: prior?.clinical_fact_id ?? null,
    },
    actor,
  );
  const row = (
    await tx.query<any>(
      `INSERT INTO laboratory.result
     (id,logical_id,version,patient_id,encounter_id,test_id,test_version,original_value,original_unit,
      canonical_value,canonical_unit,specimen,collected_at,resulted_at,source_type,source_id,source_label,
      laboratory_name,reference_low,reference_high,abnormal_flag,verification_status,provenance,
      calculation_method,calculation_version,calculation_inputs,supersedes_result_id,clinical_fact_id,author)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29) RETURNING *`,
      [
        id,
        logicalId,
        version,
        patient.id,
        input.encounter_id,
        test.test_id,
        test.version,
        input.value,
        input.unit,
        canonicalValue,
        test.canonical_unit,
        input.specimen,
        input.collected_at,
        input.resulted_at,
        input.source_type,
        input.source_id,
        input.source_label,
        input.laboratory_name,
        input.reference_low,
        input.reference_high,
        input.abnormal_flag,
        input.verification_status,
        json(input.provenance),
        calculation?.method ?? null,
        calculation?.version ?? null,
        json(calculation?.inputs ?? []),
        input.supersedes_result_id,
        fact.id,
        actor,
      ],
    )
  ).rows[0];
  return parseLabRow({ ...row, display: test.display });
}

async function deriveRenalResults(
  tx: QueryDB,
  patient: any,
  creatinine: any,
  actor: string,
) {
  if (creatinine.verification_status !== "verified") return [];
  const age = ageAt(patient.birth_date, creatinine.collected_at);
  if (age < 18 || !["Male", "Female"].includes(patient.sex)) return [];
  const derived = [];
  const egfr = ckdEpi2021Creatinine(
    Number(creatinine.canonical_value),
    age,
    patient.sex,
  );
  derived.push(
    await appendLabResult(
      tx,
      patient,
      {
        test_id: "egfr-ckd-epi-2021",
        value: Math.round(egfr),
        unit: "mL/min/1.73m2",
        specimen: null,
        collected_at: creatinine.collected_at,
        resulted_at: creatinine.resulted_at,
        source_type: "derived_calculation",
        source_id: creatinine.id,
        source_label: "Derived from verified serum creatinine",
        laboratory_name: creatinine.laboratory_name,
        reference_low: null,
        reference_high: null,
        abnormal_flag: null,
        verification_status: "verified",
        provenance: {
          derivedFrom: creatinine.id,
          equation: "2021 CKD-EPI creatinine",
          normalizedCreatinineMgDl: creatinine.canonical_value,
          evidenceKey: "niddk-egfr-equations",
          evidenceVersion: "2021-ckd-epi-web-2026-09-22",
        },
        encounter_id: creatinine.encounter_id,
        supersedes_result_id: null,
      },
      actor,
      {
        method: "2021 CKD-EPI creatinine",
        version: "NIDDK-2021",
        inputs: [creatinine.id, "core.patient.birth_date", "core.patient.sex"],
      },
    ),
  );
  if (patient.weight_kg) {
    const crcl = cockcroftGault(
      Number(creatinine.canonical_value),
      age,
      Number(patient.weight_kg),
      patient.sex,
    );
    derived.push(
      await appendLabResult(
        tx,
        patient,
        {
          test_id: "crcl-cockcroft-gault",
          value: Number(crcl.toFixed(1)),
          unit: "mL/min",
          specimen: null,
          collected_at: creatinine.collected_at,
          resulted_at: creatinine.resulted_at,
          source_type: "derived_calculation",
          source_id: creatinine.id,
          source_label:
            "Derived from verified serum creatinine and recorded weight",
          laboratory_name: creatinine.laboratory_name,
          reference_low: null,
          reference_high: null,
          abnormal_flag: null,
          verification_status: "verified",
          provenance: {
            derivedFrom: creatinine.id,
            equation: "Cockcroft-Gault",
            weightKg: patient.weight_kg,
            weightStrategy:
              "recorded patient weight; no ideal/adjusted-weight substitution",
            evidenceKey: "fda-cockcroft-gault-guidance",
            evidenceVersion: "fda-71114-verified-2026-09-22",
          },
          encounter_id: creatinine.encounter_id,
          supersedes_result_id: null,
        },
        actor,
        {
          method: "Cockcroft-Gault",
          version: "FDA-CG-1976",
          inputs: [
            creatinine.id,
            "core.patient.birth_date",
            "core.patient.sex",
            "core.patient.weight_kg",
          ],
        },
      ),
    );
  }
  return derived;
}

export function mountMedicationLaboratory(
  app: Express,
  db: DB,
  read: RequestHandler,
  write: RequestHandler,
) {
  app.get("/api/medications/catalog", read, async (req, res) => {
    const query = z
      .string()
      .max(100)
      .parse(req.query.q ?? "")
      .toLowerCase();
    const group = z.string().max(100).optional().parse(req.query.group);
    const patientId = z.string().uuid().optional().parse(req.query.patientId);
    const [definitions, groups, products, recent] = await Promise.all([
      db.query<any>(
        `SELECT * FROM medication.generic_definition WHERE status='active' AND version=(SELECT max(v.version) FROM medication.generic_definition v WHERE v.medication_id=medication.generic_definition.medication_id) ORDER BY generic_name`,
      ),
      db.query<any>(
        `SELECT gm.medication_id,g.group_id,g.name FROM medication.group_member gm JOIN medication.clinical_group g ON g.group_id=gm.group_id AND g.version=gm.group_version WHERE g.status='active'`,
      ),
      db.query<any>(
        `SELECT p.*,e.formulary_status,e.note FROM medication.site_product p LEFT JOIN medication.site_product_event e ON e.product_id=p.id AND e.version=(SELECT max(v.version) FROM medication.site_product_event v WHERE v.product_id=p.id) WHERE p.site_id=$1`,
        [SITE],
      ),
      db.query<any>(
        `SELECT t.medication_id,max(t.created_at) last_used,count(*)::int use_count FROM medication.therapy t JOIN core.patient p ON p.id=t.patient_id WHERE p.site_id=$1 GROUP BY t.medication_id`,
        [SITE],
      ),
    ]);
    const groupByMedication = new Map<string, any[]>(),
      productByMedication = new Map<string, any[]>(),
      recentByMedication = new Map(
        recent.rows.map((row) => [row.medication_id, row]),
      );
    for (const row of groups.rows)
      groupByMedication.set(row.medication_id, [
        ...(groupByMedication.get(row.medication_id) ?? []),
        { group_id: row.group_id, name: row.name },
      ]);
    for (const row of products.rows)
      productByMedication.set(row.medication_id, [
        ...(productByMedication.get(row.medication_id) ?? []),
        row,
      ]);
    let current = new Set<string>();
    if (patientId) {
      await ensurePatient(db, patientId);
      current = new Set(
        (
          await db.query<any>(
            "SELECT medication_id FROM medication.current_therapy WHERE patient_id=$1 AND status IN ('ACTIVE','TEMPORARILY_HELD','PLANNED')",
            [patientId],
          )
        ).rows.map((row) => row.medication_id),
      );
    }
    const items = definitions.rows
      .map((row) => ({
        ...row,
        groups: groupByMedication.get(row.medication_id) ?? [],
        products: productByMedication.get(row.medication_id) ?? [],
        recently_used: recentByMedication.get(row.medication_id) ?? null,
        current_for_patient: current.has(row.medication_id),
      }))
      .filter((item) => {
        if (
          group &&
          !item.groups.some((entry: any) => entry.group_id === group)
        )
          return false;
        if (!query) return true;
        return [
          item.generic_name,
          item.drug_class,
          item.cardiovascular_category,
          ...item.groups.map((entry: any) => entry.name),
          ...item.products.map((entry: any) => entry.trade_name),
        ].some((value) => String(value).toLowerCase().includes(query));
      })
      .sort(
        (a, b) =>
          Number(b.current_for_patient) - Number(a.current_for_patient) ||
          Number(!!b.recently_used) - Number(!!a.recently_used) ||
          a.generic_name.localeCompare(b.generic_name),
      );
    const patientSafety = patientId
      ? {
          currentMedicationIds: [...current],
          adverseReactions: (
            await db.query<any>(
              `SELECT r.*,e.status FROM medication.adverse_reaction r
               JOIN medication.adverse_reaction_event e ON e.reaction_id=r.id
                AND e.version=(SELECT max(v.version) FROM medication.adverse_reaction_event v WHERE v.reaction_id=r.id)
               WHERE r.patient_id=$1 AND e.status='active' ORDER BY r.created_at DESC`,
              [patientId],
            )
          ).rows,
        }
      : null;
    res.json({
      medications: items,
      groups: medicationGroups.map(([group_id, name]) => ({ group_id, name })),
      indications: indicationSeeds.map(([code, display]) => ({
        code,
        display,
      })),
      patientSafety,
    });
  });

  app.get("/api/patients/:id/medications", read, async (req, res) => {
    const patient = await ensurePatient(db, String(req.params.id));
    const [current, history, reactions, monitoring, titration] =
      await Promise.all([
        db.query<any>(
          `SELECT ct.*,d.generic_name,p.trade_name FROM medication.current_therapy ct JOIN medication.generic_definition d ON d.medication_id=ct.medication_id AND d.version=ct.medication_version LEFT JOIN medication.site_product p ON p.id=ct.selected_product_id WHERE ct.patient_id=$1 ORDER BY d.generic_name`,
          [patient.id],
        ),
        db.query<any>(
          `SELECT e.*,t.patient_id,t.medication_id,d.generic_name,p.trade_name FROM medication.therapy_event e JOIN medication.therapy t ON t.id=e.therapy_id JOIN medication.generic_definition d ON d.medication_id=t.medication_id AND d.version=t.medication_version LEFT JOIN medication.site_product p ON p.id=t.selected_product_id WHERE t.patient_id=$1 ORDER BY e.effective_at DESC,e.version DESC`,
          [patient.id],
        ),
        db.query<any>(
          `SELECT r.*,e.status FROM medication.adverse_reaction r JOIN medication.adverse_reaction_event e ON e.reaction_id=r.id AND e.version=(SELECT max(v.version) FROM medication.adverse_reaction_event v WHERE v.reaction_id=r.id) WHERE r.patient_id=$1 ORDER BY r.created_at DESC`,
          [patient.id],
        ),
        db.query<any>(
          `SELECT mr.*,d.generic_name FROM medication.monitoring_relation mr JOIN medication.generic_definition d ON d.medication_id=mr.medication_id AND d.version=mr.medication_version JOIN medication.current_therapy ct ON ct.medication_id=mr.medication_id AND ct.medication_version=mr.medication_version WHERE ct.patient_id=$1 AND ct.status IN ('ACTIVE','TEMPORARILY_HELD') ORDER BY d.generic_name,mr.parameter_code`,
          [patient.id],
        ),
        db.query<any>(
          `SELECT ct.*,t.medication_id,d.generic_name FROM medication.current_titration ct JOIN medication.therapy t ON t.id=ct.therapy_id JOIN medication.generic_definition d ON d.medication_id=t.medication_id AND d.version=t.medication_version WHERE ct.patient_id=$1 ORDER BY ct.created_at DESC`,
          [patient.id],
        ),
      ]);
    res.json({
      current: current.rows.map(parseMedicationRow),
      history: history.rows.map(parseMedicationRow),
      adverseReactions: reactions.rows,
      monitoringRelations: monitoring.rows,
      titrationPlans: titration.rows,
    });
  });

  app.post("/api/medications/formulary-products", write, async (req, res) => {
    const input = z
      .object({
        medication_id: z.string().min(1).max(120),
        trade_name: z.string().trim().min(2).max(200),
        formulation_id: z.string().uuid().nullable().default(null),
        local_code: z.string().trim().max(100).nullable().default(null),
        formulary_status: z.enum([
          "available",
          "restricted",
          "unavailable",
          "unknown",
        ]),
        note: z.string().trim().max(1000).default(""),
      })
      .strict()
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      const definition = (
        await tx.query<any>(
          "SELECT * FROM medication.generic_definition WHERE medication_id=$1 AND status='active' ORDER BY version DESC LIMIT 1",
          [input.medication_id],
        )
      ).rows[0];
      if (!definition)
        throw new FoundationError(
          422,
          "Unknown or inactive generic medication",
        );
      const id = randomUUID();
      const product = (
        await tx.query<any>(
          `INSERT INTO medication.site_product(id,site_id,medication_id,medication_version,trade_name,formulation_id,local_code,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            id,
            SITE,
            definition.medication_id,
            definition.version,
            input.trade_name,
            input.formulation_id,
            input.local_code,
            res.locals.session.actor,
          ],
        )
      ).rows[0];
      const event = (
        await tx.query<any>(
          "INSERT INTO medication.site_product_event(id,product_id,version,formulary_status,note,actor) VALUES($1,$2,1,$3,$4,$5) RETURNING *",
          [
            randomUUID(),
            id,
            input.formulary_status,
            input.note,
            res.locals.session.actor,
          ],
        )
      ).rows[0];
      return { ...product, ...event, id };
    });
    res.status(201).json(result);
  });

  app.post(
    "/api/medications/formulary-products/:id/events",
    write,
    async (req, res) => {
      const input = z
        .object({
          formulary_status: z.enum([
            "available",
            "restricted",
            "unavailable",
            "unknown",
          ]),
          note: z.string().trim().max(1000).default(""),
        })
        .strict()
        .parse(req.body);
      const result = await db.transaction(async (tx) => {
        const product = (
          await tx.query<any>(
            "SELECT * FROM medication.site_product WHERE id=$1 AND site_id=$2",
            [z.string().uuid().parse(req.params.id), SITE],
          )
        ).rows[0];
        if (!product)
          throw new FoundationError(404, "Site formulary product not found");
        const previous = (
          await tx.query<any>(
            "SELECT * FROM medication.site_product_event WHERE product_id=$1 ORDER BY version DESC LIMIT 1",
            [product.id],
          )
        ).rows[0];
        return (
          await tx.query<any>(
            "INSERT INTO medication.site_product_event(id,product_id,version,formulary_status,note,actor) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              randomUUID(),
              product.id,
              Number(previous.version) + 1,
              input.formulary_status,
              input.note,
              res.locals.session.actor,
            ],
          )
        ).rows[0];
      });
      res.status(201).json(result);
    },
  );

  app.post("/api/patients/:id/medications", write, async (req, res) => {
    const input = z
      .object({
        medication_id: z.string().min(1).max(120),
        product_id: z.string().uuid().nullable().default(null),
        encounter_id: z.string().uuid().nullable().default(null),
        source_type: z.string().min(1).max(100).default("clinician"),
        source_id: z.string().max(300).optional(),
        confirm_existing_course: z.boolean().default(false),
        event: therapyEventSchema,
      })
      .strict()
      .parse(req.body);
    const output = await db.transaction(async (tx) => {
      const patient = await ensurePatient(tx, String(req.params.id));
      const definition = (
        await tx.query<any>(
          "SELECT * FROM medication.generic_definition WHERE medication_id=$1 AND status='active' ORDER BY version DESC LIMIT 1",
          [input.medication_id],
        )
      ).rows[0];
      if (!definition)
        throw new FoundationError(422, "Unknown or inactive medication");
      const existing = (
        await tx.query<any>(
          `SELECT id,status FROM medication.current_therapy
         WHERE patient_id=$1 AND medication_id=$2 AND status IN ('ACTIVE','TEMPORARILY_HELD','PLANNED')`,
          [patient.id, definition.medication_id],
        )
      ).rows;
      if (existing.length && !input.confirm_existing_course)
        throw new FoundationError(
          409,
          "This generic medication already has a current course. Update the existing course or explicitly confirm a separate course.",
        );
      if (input.product_id) {
        const product = (
          await tx.query<any>(
            "SELECT * FROM medication.site_product WHERE id=$1 AND site_id=$2 AND medication_id=$3",
            [input.product_id, SITE, definition.medication_id],
          )
        ).rows[0];
        if (!product)
          throw new FoundationError(
            422,
            "Trade product does not match the selected generic medication and site",
          );
      }
      for (const indication of input.event.indications)
        if (
          !(
            await tx.query(
              "SELECT code FROM medication.indication_definition WHERE code=$1 AND status='active'",
              [indication],
            )
          ).rows[0]
        )
          throw new FoundationError(
            422,
            `Unknown medication indication: ${indication}`,
          );
      const therapy = (
        await tx.query<any>(
          `INSERT INTO medication.therapy(id,patient_id,encounter_id,medication_id,medication_version,selected_product_id,source_type,source_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            randomUUID(),
            patient.id,
            input.encounter_id,
            definition.medication_id,
            definition.version,
            input.product_id,
            input.source_type,
            input.source_id ?? randomUUID(),
            res.locals.session.actor,
          ],
        )
      ).rows[0];
      const event = (
        await tx.query<any>(
          `INSERT INTO medication.therapy_event(id,therapy_id,version,status,event_type,dose_value,dose_unit,frequency,route,effective_at,indications,prescribing_clinician,reason,discontinuation_date,adherence,target_dose_value,target_dose_unit,planned_next_dose_value,planned_next_dose_unit,planned_titration_date,comments,actor) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
          [
            randomUUID(),
            therapy.id,
            input.event.status,
            input.event.event_type,
            input.event.dose_value,
            input.event.dose_unit,
            input.event.frequency,
            input.event.route,
            input.event.effective_at,
            json(input.event.indications),
            input.event.prescribing_clinician,
            input.event.reason,
            input.event.discontinuation_date,
            input.event.adherence,
            input.event.target_dose_value,
            input.event.target_dose_unit,
            input.event.planned_next_dose_value,
            input.event.planned_next_dose_unit,
            input.event.planned_titration_date,
            input.event.comments,
            res.locals.session.actor,
          ],
        )
      ).rows[0];
      await projectTherapyEvent(
        tx,
        { ...therapy, generic_name: definition.generic_name },
        event,
        res.locals.session.actor,
      );
      await audit(
        tx,
        res.locals.session.actor,
        "Structured medication course started",
        "medication_therapy",
        therapy.id,
        patient.id,
        {
          medication_id: definition.medication_id,
          status: event.status,
          event_type: event.event_type,
        },
      );
      const reactions = (
        await tx.query<any>(
          `SELECT r.*,e.status FROM medication.adverse_reaction r JOIN medication.adverse_reaction_event e ON e.reaction_id=r.id AND e.version=(SELECT max(v.version) FROM medication.adverse_reaction_event v WHERE v.reaction_id=r.id) WHERE r.patient_id=$1 AND e.status='active' AND (r.medication_id=$2 OR lower(r.substance_text)=lower($3))`,
          [patient.id, definition.medication_id, definition.generic_name],
        )
      ).rows;
      return { therapy, event, adverseReactions: reactions };
    });
    res.status(201).json(output);
  });

  app.post("/api/medication-therapies/:id/events", write, async (req, res) => {
    const input = therapyEventSchema.parse(req.body);
    const output = await db.transaction(async (tx) => {
      const therapy = (
        await tx.query<any>(
          `SELECT t.*,d.generic_name,p.site_id FROM medication.therapy t JOIN core.patient patient ON patient.id=t.patient_id JOIN medication.generic_definition d ON d.medication_id=t.medication_id AND d.version=t.medication_version LEFT JOIN medication.site_product p ON p.id=t.selected_product_id WHERE t.id=$1 AND patient.site_id=$2`,
          [z.string().uuid().parse(req.params.id), SITE],
        )
      ).rows[0];
      if (!therapy)
        throw new FoundationError(404, "Medication course not found");
      const previous = (
        await tx.query<any>(
          "SELECT * FROM medication.therapy_event WHERE therapy_id=$1 ORDER BY version DESC LIMIT 1",
          [therapy.id],
        )
      ).rows[0];
      if (new Date(input.effective_at) < new Date(previous.effective_at))
        throw new FoundationError(
          422,
          "A new medication event cannot precede the latest event; use a correction event with the correct chronology",
        );
      const event = (
        await tx.query<any>(
          `INSERT INTO medication.therapy_event(id,therapy_id,version,status,event_type,dose_value,dose_unit,frequency,route,effective_at,indications,prescribing_clinician,reason,discontinuation_date,adherence,target_dose_value,target_dose_unit,planned_next_dose_value,planned_next_dose_unit,planned_titration_date,comments,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
          [
            randomUUID(),
            therapy.id,
            Number(previous.version) + 1,
            input.status,
            input.event_type,
            input.dose_value,
            input.dose_unit,
            input.frequency,
            input.route,
            input.effective_at,
            json(input.indications),
            input.prescribing_clinician,
            input.reason,
            input.discontinuation_date,
            input.adherence,
            input.target_dose_value,
            input.target_dose_unit,
            input.planned_next_dose_value,
            input.planned_next_dose_unit,
            input.planned_titration_date,
            input.comments,
            res.locals.session.actor,
          ],
        )
      ).rows[0];
      await projectTherapyEvent(tx, therapy, event, res.locals.session.actor);
      await audit(
        tx,
        res.locals.session.actor,
        "Medication course changed",
        "medication_therapy",
        therapy.id,
        therapy.patient_id,
        {
          medication_id: therapy.medication_id,
          version: event.version,
          status: event.status,
          event_type: event.event_type,
        },
      );
      return event;
    });
    res.status(201).json(output);
  });

  app.get("/api/laboratory/catalog", read, async (_req, res) => {
    res.json({
      tests: (
        await db.query(
          "SELECT * FROM laboratory.test_definition WHERE status='active' ORDER BY category,display",
        )
      ).rows,
    });
  });

  app.get("/api/patients/:id/laboratory", read, async (req, res) => {
    const patient = await ensurePatient(db, String(req.params.id));
    const rows = (
      await db.query<any>(
        `SELECT r.*,t.display,t.category FROM laboratory.result r JOIN laboratory.test_definition t ON t.test_id=r.test_id AND t.version=r.test_version WHERE r.patient_id=$1 AND NOT EXISTS(SELECT 1 FROM laboratory.result newer WHERE newer.logical_id=r.logical_id AND newer.version>r.version) AND r.verification_status<>'entered_in_error' ORDER BY r.collected_at DESC,r.recorded_at DESC`,
        [patient.id],
      )
    ).rows.map(parseLabRow) as LabResult[];
    const grouped = new Map<string, LabResult[]>();
    for (const row of rows)
      grouped.set(row.test_id, [...(grouped.get(row.test_id) ?? []), row]);
    const trends = [...grouped.entries()].map(([test_id, results]) => ({
      test_id,
      display: results[0].display,
      canonical_unit: results[0].canonical_unit,
      latest: results[0],
      previous: results[1] ?? null,
      change: results[1]
        ? Number(results[0].canonical_value) -
          Number(results[1].canonical_value)
        : null,
      direction: trendDirection(
        results.map((item) => Number(item.canonical_value)),
      ),
      results,
    }));
    res.json({ results: rows, trends });
  });

  app.post("/api/patients/:id/laboratory", write, async (req, res) => {
    const input = labInputSchema.parse(req.body);
    const output = await db.transaction(async (tx) => {
      const patient = await ensurePatient(tx, String(req.params.id));
      const result = await appendLabResult(
        tx,
        patient,
        input,
        res.locals.session.actor,
      );
      const derived =
        input.test_id === "creatinine"
          ? await deriveRenalResults(
              tx,
              patient,
              result,
              res.locals.session.actor,
            )
          : [];
      await audit(
        tx,
        res.locals.session.actor,
        "Structured laboratory result recorded",
        "laboratory_result",
        result.id,
        patient.id,
        {
          test_id: result.test_id,
          original_value: result.original_value,
          original_unit: result.original_unit,
          canonical_value: result.canonical_value,
          canonical_unit: result.canonical_unit,
          derived: derived.map((item) => item.test_id),
        },
      );
      return { result, derived };
    });
    res.status(201).json(output);
  });

  app.post("/api/patients/:id/adverse-reactions", write, async (req, res) => {
    const input = z
      .object({
        medication_id: z.string().max(120).nullable().default(null),
        substance_text: z.string().trim().min(2).max(300),
        reaction_type: z.enum([
          "ALLERGY",
          "INTOLERANCE",
          "SIDE_EFFECT",
          "UNKNOWN_REACTION",
        ]),
        reaction: z.string().trim().min(2).max(1000),
        severity: z.enum([
          "unknown",
          "mild",
          "moderate",
          "severe",
          "life_threatening",
        ]),
        observed_on: z.string().date().nullable().default(null),
        source_type: z.string().min(1).max(100),
        source_id: z.string().min(1).max(300),
      })
      .strict()
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      const patient = await ensurePatient(tx, String(req.params.id)),
        id = randomUUID();
      const reaction = (
        await tx.query<any>(
          `INSERT INTO medication.adverse_reaction(id,patient_id,medication_id,substance_text,reaction_type,reaction,severity,observed_on,source_type,source_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            id,
            patient.id,
            input.medication_id,
            input.substance_text,
            input.reaction_type,
            input.reaction,
            input.severity,
            input.observed_on,
            input.source_type,
            input.source_id,
            res.locals.session.actor,
          ],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO medication.adverse_reaction_event(id,reaction_id,version,status,actor) VALUES($1,$2,1,'active',$3)",
        [randomUUID(), id, res.locals.session.actor],
      );
      await audit(
        tx,
        res.locals.session.actor,
        "Adverse reaction recorded",
        "adverse_reaction",
        id,
        patient.id,
        {
          reaction_type: input.reaction_type,
          medication_id: input.medication_id,
        },
      );
      return reaction;
    });
    res.status(201).json(row);
  });

  app.post("/api/patients/:id/titration-plans", write, async (req, res) => {
    const input = z
      .object({
        therapy_id: z.string().uuid(),
        state: z.enum([
          "NOT_REQUIRED",
          "TITRATION_PLANNED",
          "WAITING_FOR_MONITORING",
          "READY_FOR_REVIEW",
          "TITRATION_DEFERRED",
          "TARGET_ACHIEVED",
          "MAXIMALLY_TOLERATED",
          "STOPPED",
        ]),
        current_dose: z.record(z.string(), z.json()).default({}),
        planned_dose: z.record(z.string(), z.json()).default({}),
        required_checks: z.array(z.record(z.string(), z.json())).default([]),
        earliest_review_date: z.string().date().nullable().default(null),
        planned_titration_date: z.string().date().nullable().default(null),
        next_laboratory_date: z.string().date().nullable().default(null),
        limitation_type: z
          .enum([
            "ABSOLUTE_CONTRAINDICATION",
            "DOSE_LIMITATION",
            "CURRENT_TITRATION_LIMITATION",
          ])
          .nullable()
          .default(null),
        limitation_reason: z.string().max(1000).default(""),
        clinician_confirmed: z.boolean().default(false),
        note: z.string().max(2000).default(""),
      })
      .strict()
      .parse(req.body);
    const row = await db.transaction(async (tx) => {
      const patient = await ensurePatient(tx, String(req.params.id));
      const therapy = (
        await tx.query<any>(
          "SELECT * FROM medication.therapy WHERE id=$1 AND patient_id=$2",
          [input.therapy_id, patient.id],
        )
      ).rows[0];
      if (!therapy)
        throw new FoundationError(404, "Medication course not found");
      const planId = randomUUID();
      await tx.query(
        "INSERT INTO medication.titration_plan(id,patient_id,therapy_id,created_by) VALUES($1,$2,$3,$4)",
        [planId, patient.id, therapy.id, res.locals.session.actor],
      );
      const event = (
        await tx.query<any>(
          `INSERT INTO medication.titration_event(id,plan_id,version,state,current_dose,planned_dose,required_checks,earliest_review_date,planned_titration_date,next_laboratory_date,limitation_type,limitation_reason,clinician_confirmed,note,actor) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            randomUUID(),
            planId,
            input.state,
            json(input.current_dose),
            json(input.planned_dose),
            json(input.required_checks),
            input.earliest_review_date,
            input.planned_titration_date,
            input.next_laboratory_date,
            input.limitation_type,
            input.limitation_reason,
            input.clinician_confirmed,
            input.note,
            res.locals.session.actor,
          ],
        )
      ).rows[0];
      await audit(
        tx,
        res.locals.session.actor,
        "Medication titration plan created",
        "titration_plan",
        planId,
        patient.id,
        { therapy_id: therapy.id, state: input.state },
      );
      return { plan_id: planId, ...event };
    });
    res.status(201).json(row);
  });
}
