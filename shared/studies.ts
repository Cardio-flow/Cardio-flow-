// Investigation templates: one per study kind. Each template is a short list of
// select-first fields. Numeric fields that rules read are also written as dated
// observations (code in `obs`), so the engine and the trends see them like any lab.
// Categories are descriptive (reporting vocabulary), never treatment thresholds.

import { HYPERTENSION_STUDIES } from "./hypertension-studies.js";
import { STRUCTURAL_TARGETS } from "./structural.js";
import { BICUSPID_FIELDS } from "./bicuspid.js";
export type StudyField =
  | { key: string; label: string; type: "choice"; options: string[]; required?: boolean; when?: Cond }
  | { key: string; label: string; type: "multi"; options: string[]; when?: Cond }
  | { key: string; label: string; type: "number"; unit: string; min: number; max: number; decimals?: number; obs?: string; required?: boolean; when?: Cond };
type Cond = { field: string; in?: string[]; notIn?: string[]; and?: Cond };

import { PERICARDIAL_FIELDS, PERICARDIAL_FLUID_FIELDS, validatePericardialReport } from "./pericardial.js";
import { AORTA_FIELDS } from "./aorta.js";
export type StudyDef = { kind: string; label: string; short: string; help: string; fields: StudyField[] };

const AV = ["None", "First-degree", "Mobitz I", "Mobitz II", "Complete"];
// "Patent stent" and "Severe (not quantified)" (20 Oct 2026, real reports that give no percentage):
// a severe lesion reads as obstructive, a patent stent does not
const STENOSIS = ["None", "<50%", "50–69%", "70–99%", "Severe (not quantified)", "Occluded", "Patent stent", "Not assessed"];

export const STUDIES: StudyDef[] = [
  {kind:"pericardial_imaging",label:"Pericardial imaging",short:"Pericardial imaging",help:"Report size, haemodynamics, inflammation and constrictive physiology. Missing findings remain unknown.",fields:PERICARDIAL_FIELDS},
  {kind:"pericardial_fluid",label:"Pericardial fluid results",short:"Pericardial fluid",help:"Link actual drainage and record the laboratory report; pending tests require later results and clinical review.",fields:PERICARDIAL_FLUID_FIELDS},
  {kind:"aortic_imaging",label:"Thoracic aorta imaging",short:"Aortic imaging",help:"Dated dimensions in mm, imaging extent and the reporter’s assessment.",fields:AORTA_FIELDS},
  {kind:"orthostatic_bp",label:"Standing BP (orthostatic)",short:"Standing BP",help:"Supine and standing readings with symptom correlation and clinical interpretation.",fields:[
    {key:"supineSbp",label:"Supine systolic BP",type:"number",unit:"mmHg",required:true,min:40,max:300},
    {key:"supineDbp",label:"Supine diastolic BP",type:"number",unit:"mmHg",required:true,min:20,max:200},
    {key:"supineHr",label:"Supine heart rate",type:"number",unit:"bpm",min:20,max:250},
    {key:"standing1Sbp",label:"Standing systolic BP at 1 minute",type:"number",unit:"mmHg",min:40,max:300},
    {key:"standing1Dbp",label:"Standing diastolic BP at 1 minute",type:"number",unit:"mmHg",min:20,max:200},
    {key:"standing3Sbp",label:"Standing systolic BP at 3 minutes",type:"number",unit:"mmHg",required:true,min:40,max:300},
    {key:"standing3Dbp",label:"Standing diastolic BP at 3 minutes",type:"number",unit:"mmHg",required:true,min:20,max:200},
    {key:"standingHr",label:"Standing heart rate at 3 minutes",type:"number",unit:"bpm",min:20,max:250},
    {key:"symptoms",label:"Symptoms during the assessment",type:"choice",required:true,options:["Usual symptoms reproduced","Other symptoms","No symptoms","Unable to assess"]},
    {key:"interpretation",label:"Clinician interpretation",type:"choice",required:true,options:["Compatible symptomatic orthostatic hypotension","No compatible orthostatic hypotension","Uncertain / incomplete assessment"]},
  ]},
  ...HYPERTENSION_STUDIES,
  {
    kind: "structural_imaging", label: "Structural intervention imaging (CT / 3D TOE)", short: "Structural imaging",
    help: "Record the structural team's report. Bicuspid TAVI needs measured sinus/STJ/ascending aorta, entire thoracic CT/CMR, calcification and aortic strategy. Put any prohibitive-risk rationale in the report conclusion. Device suitability depends on the exact IFU; missing measurements do not imply clearance.",
    fields: [
      {key:"intervention",label:"Planned intervention",type:"choice",options:STRUCTURAL_TARGETS,required:true},
      {key:"modality",label:"Imaging modality",type:"choice",options:["Cardiac CT","3D TOE / TEE","Combined CT and TOE / TEE","Alternative imaging agreed by Heart Team"],required:true},
      {key:"suitability",label:"Reported anatomical suitability",type:"choice",options:["Suitable","Uncertain / incomplete","Unsuitable"],required:true},
      {key:"position",label:"Target valve (replacement / valve-in-valve)",type:"choice",options:["Aortic","Mitral","Tricuspid","Pulmonary"],required:true,when:{field:"intervention",in:["Valve-in-valve / other transcatheter valve"]}},
      {key:"reviewed",label:"Structural team reviewed the complete report",type:"choice",options:["Yes","No / pending"],required:true},
      ...BICUSPID_FIELDS,
      {key:"annulusArea",label:"Annulus area",type:"number",unit:"mm²",min:0,max:2000,decimals:1,when:{field:"intervention",in:["TAVI","Valve-in-valve / other transcatheter valve"]}},
      {key:"annulusPerimeter",label:"Annulus perimeter",type:"number",unit:"mm",min:0,max:300,decimals:1,when:{field:"intervention",in:["TAVI","Valve-in-valve / other transcatheter valve"]}},
      {key:"leftCoronaryHeight",label:"Left coronary height",type:"number",unit:"mm",min:0,max:100,decimals:1,when:{field:"intervention",in:["TAVI","Valve-in-valve / other transcatheter valve"]}},
      {key:"rightCoronaryHeight",label:"Right coronary height",type:"number",unit:"mm",min:0,max:100,decimals:1,when:{field:"intervention",in:["TAVI","Valve-in-valve / other transcatheter valve"]}},
      {key:"aorticRoot",label:"Sinus / STJ / ascending aorta review",type:"choice",options:["Complete","Incomplete","Important adverse anatomy"],when:{field:"intervention",in:["TAVI","Valve-in-valve / other transcatheter valve"]}},
      {key:"calcification",label:"Valve / LVOT calcification review",type:"choice",options:["Complete","Incomplete","Important adverse anatomy"],when:{field:"intervention",in:["TAVI","Valve-in-valve / other transcatheter valve"]}},
      {key:"vtc",label:"Virtual valve-to-coronary distance (if applicable)",type:"number",unit:"mm",min:0,max:100,decimals:1,when:{field:"intervention",in:["Valve-in-valve / other transcatheter valve"]}},
      {key:"neoLvot",label:"Predicted neo-LVOT area (mitral replacement)",type:"number",unit:"mm²",min:0,max:2000,decimals:1,when:{field:"intervention",in:["Valve-in-valve / other transcatheter valve"]}},
      {key:"access",label:"Vascular access assessment",type:"choice",options:["Transfemoral feasible","Alternative access planned","Not suitable","Not assessed"],when:{field:"intervention",in:["TAVI","Valve-in-valve / other transcatheter valve"]}},
      {key:"jetLocation",label:"Regurgitant jet / target segment",type:"choice",options:["Central","Medial","Lateral","Multiple jets","Other","Not assessed"],when:{field:"intervention",in:["Mitral TEER","Tricuspid TEER"]}},
      {key:"coaptationGap",label:"Coaptation gap",type:"number",unit:"mm",min:0,max:100,decimals:1,when:{field:"intervention",in:["Mitral TEER","Tricuspid TEER"]}},
      {key:"leafletLength",label:"Available grasping leaflet length",type:"number",unit:"mm",min:0,max:100,decimals:1,when:{field:"intervention",in:["Mitral TEER","Tricuspid TEER"]}},
      {key:"leafletReview",label:"Leaflet / grasping zone review",type:"choice",options:["Suitable under selected device IFU","Unsuitable","Not assessed"],when:{field:"intervention",in:["Mitral TEER","Tricuspid TEER"]}},
      {key:"flailGap",label:"Flail gap (when present)",type:"number",unit:"mm",min:0,max:100,decimals:1,when:{field:"intervention",in:["Mitral TEER"]}},
      {key:"flailWidth",label:"Flail width (when present)",type:"number",unit:"mm",min:0,max:100,decimals:1,when:{field:"intervention",in:["Mitral TEER"]}},
      {key:"valveArea",label:"Mitral valve area",type:"number",unit:"cm²",min:0,max:20,decimals:2,when:{field:"intervention",in:["Mitral TEER"]}},
      {key:"meanGradient",label:"Baseline mean transmitral gradient",type:"number",unit:"mmHg",min:0,max:100,decimals:1,when:{field:"intervention",in:["Mitral TEER"]}},
      {key:"septum",label:"Transseptal access / LA-LAA thrombus review",type:"choice",options:["Access suitable and no thrombus","Thrombus / access concern","Not assessed"],when:{field:"intervention",in:["Mitral TEER"]}},
      {key:"leadInteraction",label:"CIED lead interaction",type:"choice",options:["No lead","No relevant interference","Interference / lead strategy needed","Not assessed"],when:{field:"intervention",in:["Tricuspid TEER"]}},
      {key:"rvFunction",label:"RV function assessment",type:"choice",options:["No severe dysfunction","Severe dysfunction","Not assessed"],when:{field:"intervention",in:["Tricuspid TEER"]}},
      {key:"pulmonaryVascular",label:"Invasive pulmonary haemodynamic assessment",type:"choice",options:["No pre-capillary PH","Pre-capillary PH / concern","Not assessed"],when:{field:"intervention",in:["Tricuspid TEER"]}},
    ],
  },
  {
    kind: "laa_imaging", label: "LAA / closure-device imaging", short: "LAA imaging",
    help: "TOE/TEE or cardiac CT: explicitly record thrombus, device thrombus and leak. Missing or indeterminate findings never count as clearance.",
    fields: [
      { key: "purpose", label: "Purpose", type: "choice", required: true, options: ["Before closure", "After closure", "Before cardioversion / ablation"] },
      { key: "modality", label: "Modality", type: "choice", required: true, options: ["TOE / TEE", "Cardiac CT"] },
      { key: "laaThrombus", label: "LAA thrombus", type: "choice", required: true, options: ["Absent", "Present", "Indeterminate"] },
      { key: "deviceThrombus", label: "Device-related thrombus", type: "choice", required: true, options: ["Absent", "Present", "Indeterminate"], when: { field: "purpose", in: ["After closure"] } },
      { key: "leak", label: "Peridevice leak / residual flow", type: "choice", required: true, options: ["Absent", "Present", "Indeterminate"], when: { field: "purpose", in: ["After closure"] } },
      { key: "leakMm", label: "Measured leak", type: "number", unit: "mm", min: 0, max: 100, decimals: 1, when: { field: "leak", in: ["Present"] } },
    ],
  },
  {
    kind: "ecg", label: "12-lead ECG", short: "ECG", help: "Rhythm, QRS width and morphology drive the device and rhythm rules.",
    fields: [
      { key: "rhythm", label: "Rhythm", type: "choice", required: true, options: ["Sinus rhythm", "Atrial fibrillation", "Atrial flutter", "Paced", "Junctional", "Other"] },
      { key: "rate", label: "Ventricular rate", type: "number", unit: "bpm", min: 20, max: 250, obs: "hr" },
      { key: "pr", label: "PR", type: "number", unit: "ms", min: 40, max: 600, obs: "pr", when: { field: "rhythm", in: ["Sinus rhythm"] } },
      // optional since 20 Oct 2026: many reports give the morphology (LBBB) without the duration
      { key: "qrs", label: "QRS duration", type: "number", unit: "ms", min: 40, max: 300, obs: "qrs" },
      { key: "qtc", label: "QTc", type: "number", unit: "ms", min: 250, max: 750, obs: "qtc" },
      { key: "qrsMorphology", label: "QRS morphology", type: "choice", required: true, options: ["Normal", "LBBB", "RBBB", "Non-specific IVCD", "Paced", "Not reported"] },
      { key: "avBlock", label: "AV block", type: "choice", options: AV, when: { field: "rhythm", notIn: ["Atrial fibrillation"] } },
      { key: "st", label: "Ischaemic changes", type: "multi", options: ["None", "ST elevation", "ST depression", "T-wave inversion", "Pathological Q waves"] },
      { key: "lvh", label: "LVH voltage", type: "choice", options: ["No", "Yes"] },
    ],
  },
  {
    // 20 Oct 2026 (real cases: negative blood cultures, ESBL E. coli urine): the report as given — no
    // antibiotic is chosen or dosed here
    kind: "culture", label: "Culture (blood, urine, other)", short: "Culture", help: "Specimen, growth and organism as reported, with resistance.",
    fields: [
      { key: "specimen", label: "Specimen", type: "choice", required: true, options: ["Blood cultures", "Urine", "Sputum", "Wound / swab", "Device / line tip", "Pericardial fluid", "Other"] },
      { key: "sets", label: "Blood culture sets", type: "number", unit: "sets", min: 1, max: 6, when: { field: "specimen", in: ["Blood cultures"] } },
      { key: "result", label: "Result", type: "choice", required: true, options: ["No growth", "Growth", "Probable contaminant", "Pending"] },
      { key: "organism", label: "Organism", type: "choice", options: ["Staphylococcus aureus", "Coagulase-negative staphylococcus", "Viridans group streptococci", "Streptococcus gallolyticus", "Other streptococcus", "Enterococcus", "HACEK group", "Escherichia coli", "Klebsiella", "Pseudomonas", "Proteus", "Candida", "Other"], when: { field: "result", in: ["Growth", "Probable contaminant"] } },
      { key: "resistance", label: "Resistance", type: "multi", options: ["MRSA", "ESBL", "Carbapenem-resistant", "VRE", "None reported"], when: { field: "result", in: ["Growth"] } },
    ],
  },
  {
    kind: "holter", label: "Holter / ambulatory ECG", short: "Holter", help: "Duration, AF, pauses, ventricular ectopy and symptom correlation.",
    fields: [
      { key: "duration", label: "Duration", type: "choice", required: true, options: ["24 h", "48 h", "72 h", "7 days", "14 days", "Loop recorder"] },
      { key: "rhythm", label: "Underlying rhythm", type: "choice", required: true, options: ["Sinus rhythm", "AF throughout", "Sinus with paroxysmal AF / flutter", "Other"] },
      { key: "minHr", label: "Minimum HR", type: "number", unit: "bpm", min: 10, max: 200 },
      { key: "maxHr", label: "Maximum HR", type: "number", unit: "bpm", min: 30, max: 300 },
      { key: "longestPause", label: "Longest pause", type: "number", unit: "s", min: 0, max: 60, decimals: 1 },
      { key: "avBlock", label: "AV block", type: "choice", options: AV },
      { key: "veBurden", label: "Ventricular ectopic burden", type: "number", unit: "%", min: 0, max: 80, decimals: 1, obs: "ve-burden" },
      { key: "nsvt", label: "Non-sustained VT", type: "choice", options: ["No", "Yes"] },
      { key: "symptoms", label: "Symptom correlation", type: "choice", options: ["No symptoms reported", "Symptoms without arrhythmia", "Symptoms with arrhythmia"] },
    ],
  },
  {
    kind: "stress", label: "Stress test", short: "Stress", help: "Functional test for ischaemia; the modality decides which fields apply.",
    fields: [
      // SPECT has its own template (Stress MIBI) since 7 Oct 2026; older SPECT records keep their modality
      { key: "modality", label: "Modality", type: "choice", required: true, options: ["Exercise ECG", "Stress echo", "PET", "Stress CMR", "Not stated"] },
      { key: "result", label: "Result", type: "choice", required: true, options: ["Negative", "Positive for ischaemia", "Equivocal", "Non-diagnostic"] },
      { key: "extent", label: "Ischaemia extent", type: "choice", options: ["None", "Small", "Moderate", "Large"], when: { field: "modality", notIn: ["Exercise ECG"] } },
      { key: "territory", label: "Territory", type: "multi", options: ["LAD", "LCx", "RCA"], when: { field: "result", in: ["Positive for ischaemia", "Equivocal"] } },
      { key: "mets", label: "Exercise capacity", type: "number", unit: "METs", min: 1, max: 25, decimals: 1, obs: "mets", when: { field: "modality", in: ["Exercise ECG", "Stress echo"] } },
      // the measures that define high event risk (ESC CCS 2024, Rec. Table 14), as reported
      { key: "duke", label: "Duke treadmill score", type: "number", unit: "", min: -30, max: 20, decimals: 1, when: { field: "modality", in: ["Exercise ECG"] } },
      { key: "segmentsEcho", label: "Segments with stress-induced hypo/akinesia", type: "number", unit: "of 16", min: 0, max: 16, when: { field: "modality", in: ["Stress echo"] } },
      { key: "segmentsCmr", label: "Segments with stress perfusion defects", type: "number", unit: "of 16", min: 0, max: 16, when: { field: "modality", in: ["Stress CMR"] } },
      { key: "ischaemia", label: "Ischaemic myocardium", type: "number", unit: "% LV", min: 0, max: 100, obs: "mpi-ischaemia", when: { field: "modality", in: ["PET"] } },
      { key: "symptoms", label: "Symptoms during test", type: "choice", options: ["None", "Typical angina", "Dyspnoea", "Other"] },
    ],
  },
  {
    kind: "nuclear", label: "Stress MIBI (myocardial perfusion SPECT)", short: "Stress MIBI", help: "Stress and rest perfusion as reported: defect type, extent, territory and gated function.",
    fields: [
      { key: "stressor", label: "Stress", type: "choice", required: true, options: ["Exercise", "Regadenoson", "Adenosine", "Dipyridamole", "Dobutamine"] },
      { key: "result", label: "Perfusion", type: "choice", required: true, options: ["Normal perfusion", "Reversible defect (ischaemia)", "Fixed defect (scar)", "Mixed (ischaemia and scar)", "Equivocal", "Non-diagnostic"] },
      { key: "extent", label: "Ischaemia extent (as reported)", type: "choice", options: ["Small", "Moderate", "Large"], when: { field: "result", in: ["Reversible defect (ischaemia)", "Mixed (ischaemia and scar)"] } },
      { key: "ischaemia", label: "Ischaemic myocardium", type: "number", unit: "% LV", min: 0, max: 100, obs: "mpi-ischaemia", when: { field: "result", in: ["Reversible defect (ischaemia)", "Mixed (ischaemia and scar)", "Equivocal"] } },
      { key: "territory", label: "Territory", type: "multi", options: ["LAD", "LCx", "RCA"], when: { field: "result", notIn: ["Normal perfusion", "Non-diagnostic"] } },
      { key: "sss", label: "Summed stress score (SSS)", type: "number", unit: "", min: 0, max: 80 },
      { key: "sds", label: "Summed difference score (SDS)", type: "number", unit: "", min: 0, max: 80 },
      { key: "tid", label: "Transient ischaemic dilation", type: "choice", options: ["No", "Yes"] },
      { key: "gatedLvef", label: "Gated LVEF (post-stress)", type: "number", unit: "%", min: 5, max: 90 },
      { key: "wall", label: "Wall motion", type: "choice", options: ["Normal", "Regional abnormality", "Global hypokinesia"] },
      { key: "ecg", label: "Stress ECG", type: "choice", options: ["No ischaemic changes", "Ischaemic ST changes", "Non-diagnostic (paced, LBBB, LVH or drug)"] },
      { key: "symptoms", label: "Symptoms during test", type: "choice", options: ["None", "Typical angina", "Dyspnoea", "Other"] },
      { key: "mets", label: "Exercise capacity", type: "number", unit: "METs", min: 1, max: 25, decimals: 1, obs: "mets", when: { field: "stressor", in: ["Exercise"] } },
    ],
  },
  {
    kind: "abpm", label: "Ambulatory BP monitoring (ABPM)", short: "ABPM", help: "Mean pressures as reported for 24 h, day and night; the conclusion is the reporter's.",
    fields: [
      { key: "duration", label: "Duration", type: "choice", required: true, options: ["24 h", "48 h"] },
      { key: "onTreatment", label: "BP-lowering treatment", type: "choice", options: ["Not on treatment", "On treatment"] },
      { key: "sbp24", label: "24-h mean systolic", type: "number", unit: "mmHg", min: 60, max: 260, obs: "abpm-24-sbp", required: true },
      { key: "dbp24", label: "24-h mean diastolic", type: "number", unit: "mmHg", min: 30, max: 160, obs: "abpm-24-dbp", required: true },
      { key: "sbpDay", label: "Daytime mean systolic", type: "number", unit: "mmHg", min: 60, max: 260, obs: "abpm-day-sbp" },
      { key: "dbpDay", label: "Daytime mean diastolic", type: "number", unit: "mmHg", min: 30, max: 160, obs: "abpm-day-dbp" },
      { key: "sbpNight", label: "Night-time mean systolic", type: "number", unit: "mmHg", min: 50, max: 260, obs: "abpm-night-sbp" },
      { key: "dbpNight", label: "Night-time mean diastolic", type: "number", unit: "mmHg", min: 30, max: 160, obs: "abpm-night-dbp" },
      { key: "dipping", label: "Night-time dipping", type: "choice", options: ["Dipper", "Non-dipper", "Reverse dipper", "Extreme dipper", "Not reported"] },
      { key: "valid", label: "Valid readings", type: "number", unit: "%", min: 0, max: 100 },
      { key: "conclusion", label: "Report conclusion", type: "choice", required: true, options: ["Normal ambulatory BP", "Ambulatory hypertension", "White-coat hypertension", "Masked hypertension", "Controlled on treatment", "Uncontrolled on treatment", "Non-diagnostic"] },
    ],
  },
  {
    kind: "ccta", label: "CT coronary angiography / calcium score", short: "CT coronary", help: "Calcium score and CAD-RADS 2.0 category.",
    fields: [
      { key: "cac", label: "Calcium score (Agatston)", type: "number", unit: "", min: 0, max: 10000, obs: "cac" },
      { key: "cadrads", label: "CAD-RADS", type: "choice", options: ["0", "1", "2", "3", "4A", "4B", "5", "N (non-diagnostic)", "Calcium score only"] },
      { key: "vessels", label: "Vessels with ≥50% stenosis", type: "multi", options: ["Left main", "LAD", "LCx", "RCA"], when: { field: "cadrads", in: ["3", "4A", "4B", "5"] } },
      // ESC 2024 CCS Table 14: two-vessel ≥70% disease including the proximal LAD is high event risk
      { key: "twoVesselProxLad", label: "Two-vessel ≥70% including the proximal LAD", type: "choice", options: ["No", "Yes"], when: { field: "cadrads", in: ["4A", "5"] } },
      { key: "highRiskPlaque", label: "High-risk plaque features", type: "choice", options: ["No", "Yes"], when: { field: "cadrads", notIn: ["Calcium score only"] } },
    ],
  },
  {
    kind: "cmr", label: "Cardiac MRI", short: "CMR", help: "Volumes, function and tissue characterisation. The LVEF joins the LVEF history.",
    fields: [
      { key: "lvef", label: "LVEF", type: "number", unit: "%", min: 5, max: 85, obs: "lvef" },
      { key: "rvef", label: "RVEF", type: "number", unit: "%", min: 5, max: 85, obs: "rvef" },
      { key: "mwt", label: "Maximal LV wall thickness", type: "number", unit: "mm", min: 5, max: 60, obs: "mwt" },
      { key: "lge", label: "Late gadolinium enhancement", type: "choice", options: ["None", "Ischaemic pattern", "Non-ischaemic pattern", "Both"] },
      { key: "lgePattern", label: "LGE distribution", type: "multi", options: ["Subendocardial", "Transmural", "Mid-wall", "Epicardial", "Diffuse"], when: { field: "lge", notIn: ["None"] } },
      { key: "lgeExtent", label: "LGE extent (% of LV mass)", type: "number", unit: "%", min: 0, max: 100, obs: "lge-extent", when: { field: "lge", notIn: ["None"] } },
      { key: "oedema", label: "Myocardial oedema", type: "choice", options: ["No", "Yes"] },
      { key: "impression", label: "Impression", type: "choice", options: ["Normal", "Ischaemic cardiomyopathy", "Dilated cardiomyopathy", "Hypertrophic cardiomyopathy", "Amyloidosis", "Arrhythmogenic cardiomyopathy", "Non-dilated LV cardiomyopathy", "Myocarditis", "Other"] },
    ],
  },
  {
    kind: "cath", label: "Coronary angiography", short: "Cath", help: "Vessel by vessel, and what was done.",
    fields: [
      { key: "access", label: "Access", type: "choice", options: ["Radial", "Femoral"] },
      { key: "lm", label: "Left main", type: "choice", required: true, options: STENOSIS },
      { key: "lad", label: "LAD", type: "choice", required: true, options: STENOSIS },
      { key: "lcx", label: "LCx", type: "choice", required: true, options: STENOSIS },
      { key: "rca", label: "RCA", type: "choice", required: true, options: STENOSIS },
      { key: "grafts", label: "Bypass grafts", type: "choice", options: ["No grafts", "All patent", "Diseased", "Occluded"] },
      { key: "outcome", label: "Outcome", type: "choice", required: true, options: ["Medical therapy", "PCI performed", "Referred for CABG", "CABG declined by patient", "Heart team discussion", "Not stated"] },
    ],
  },
  {
    // Rhythm & devices, slice 4: a device interrogation, in clinic or remote. What the device and the
    // clinician report — no lead or pacing thresholds are set here.
    kind: "device_check", label: "Device check (interrogation)", short: "Device check", help: "In clinic or remote: battery, leads, pacing, arrhythmias and therapies delivered.",
    fields: [
      { key: "setting", label: "Check", type: "choice", required: true, options: ["In clinic", "Remote"] },
      { key: "device", label: "Device", type: "choice", required: true, options: ["Pacemaker", "ICD", "CRT-P", "CRT-D", "Loop recorder"] },
      { key: "battery", label: "Battery", type: "choice", required: true, options: ["OK", "Elective replacement (ERI)", "End of service (EOS)"] },
      { key: "longevity", label: "Estimated longevity", type: "number", unit: "years", min: 0, max: 20, decimals: 1, when: { field: "battery", in: ["OK"] } },
      { key: "leads", label: "Lead function", type: "choice", options: ["Normal", "Abnormal"], when: { field: "device", notIn: ["Loop recorder"] } },
      { key: "leadIssue", label: "Lead problem", type: "multi", options: ["Rising threshold", "Poor sensing", "Impedance out of range", "Noise / oversensing", "Dislodgement"], when: { field: "leads", in: ["Abnormal"] } },
      { key: "apace", label: "Atrial pacing", type: "number", unit: "%", min: 0, max: 100, when: { field: "device", notIn: ["Loop recorder"] } },
      { key: "vpace", label: "Ventricular pacing", type: "number", unit: "%", min: 0, max: 100, when: { field: "device", in: ["Pacemaker", "ICD"] } },
      { key: "bivpace", label: "Biventricular pacing", type: "number", unit: "%", min: 0, max: 100, when: { field: "device", in: ["CRT-P", "CRT-D"] } },
      { key: "ahre", label: "Atrial high-rate episodes / AF", type: "choice", options: ["None", "Yes"] },
      { key: "ahreLongest", label: "Longest atrial episode", type: "choice", options: ["<6 min", "6 min–24 h", "≥24 h"], when: { field: "ahre", in: ["Yes"] } },
      { key: "va", label: "Ventricular arrhythmia", type: "choice", options: ["None", "NSVT", "Sustained VT", "VF"] },
      { key: "therapies", label: "Therapies delivered", type: "multi", options: ["None", "ATP", "Shock"], when: { field: "device", in: ["ICD", "CRT-D"] } },
      { key: "shocks", label: "Shocks since the last check", type: "number", unit: "", min: 0, max: 100, when: { field: "device", in: ["ICD", "CRT-D"] } },
      { key: "shockType", label: "Shocks were", type: "choice", options: ["Appropriate (VT/VF)", "Inappropriate", "Both", "Uncertain"], when: { field: "device", in: ["ICD", "CRT-D"] } },
      { key: "storm", label: "≥3 sustained VA within 24 h, each terminated (electrical storm)", type: "choice", options: ["No", "Yes"], when: { field: "device", in: ["ICD", "CRT-D"] } },
      { key: "programming", label: "Programming", type: "choice", options: ["No change", "Reprogrammed"] },
    ],
  },
];
export const STUDY: Record<string, StudyDef> = Object.fromEntries(STUDIES.map((s) => [s.kind, s]));
// a shock recorded on a device check (as a therapy, a count or an electrical storm)
export const checkHasShock = (a: Record<string, any>) => (a.therapies ?? []).includes("Shock") || Number(a.shocks) > 0 || a.storm === "Yes";
export const STUDY_LABEL: Record<string, string> = { echo: "Echo", ...Object.fromEntries(STUDIES.map((s) => [s.kind, s.short])) };

export function fieldActive(f: StudyField, values: Record<string, unknown>) {
  if (!f.when) return true;
  if (f.when.and && !fieldActive({ ...f, when: f.when.and }, values)) return false;
  const v = values[f.when.field];
  if (f.when.in) return typeof v === "string" && f.when.in.includes(v);
  if (f.when.notIn) return !(typeof v === "string" && f.when.notIn.includes(v));
  return true;
}

// Validates and cleans a study's findings against its template.
export function cleanStudy(kind: string, values: Record<string, unknown>) {
  const def = STUDY[kind];
  if (!def) throw new Error("Unknown study type");
  const out: Record<string, unknown> = {};
  for (const [k] of Object.entries(values)) if (!def.fields.some((f) => f.key === k)) throw new Error(`Unknown field "${k}"`);
  for (const f of def.fields) {
    const v = values[f.key];
    const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
    if (!fieldActive(f, values)) continue;
    if (empty) {
      if ((f as any).required) throw new Error(`${f.label} is required`);
      continue;
    }
    if (f.type === "choice") {
      if (!f.options.includes(String(v))) throw new Error(`${f.label}: choose from the list`);
      out[f.key] = String(v);
    } else if (f.type === "multi") {
      if (!Array.isArray(v) || v.some((x) => !f.options.includes(String(x)))) throw new Error(`${f.label}: choose from the list`);
      out[f.key] = [...new Set(v.map(String))];
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < f.min || n > f.max) throw new Error(`${f.label}: ${f.min}–${f.max}${f.unit ? " " + f.unit : ""}`);
      out[f.key] = n;
    }
  }
  if(kind === "pericardial_imaging")validatePericardialReport(out);
  return out;
}

// Anatomy words, not treatment thresholds: ≥50% left main or ≥70% elsewhere at cath,
// ≥50% (CAD-RADS 3 or more) on CT.
export const SIGNIFICANT_STENOSIS = ["70–99%", "Severe (not quantified)", "Occluded"];
const SIG = SIGNIFICANT_STENOSIS;
export function coronaryAnatomyComplete(a: Record<string, any>) {
  return ['lm','lad','lcx','rca'].every(k => STENOSIS.includes(a[k]) && a[k] !== 'Not assessed');
}
export function obstructiveCad(kind: string, a: Record<string, any>): string | null {
  if (kind === "cath") {
    const vessels = [
      a.lm && (SIG.includes(a.lm) || a.lm === "50–69%") ? "LM" : null,
      SIG.includes(a.lad) ? "LAD" : null,
      SIG.includes(a.lcx) ? "LCx" : null,
      SIG.includes(a.rca) ? "RCA" : null,
    ].filter(Boolean);
    if (!vessels.length) return null;
    return `${vessels.includes("LM") ? "Left main" : vessels.length + "-vessel"} disease (${vessels.join(", ")})`;
  }
  if (kind === "ccta" && ["3", "4A", "4B", "5"].includes(a.cadrads)) return `CAD-RADS ${a.cadrads}${a.vessels?.length ? ` (${a.vessels.join(", ")})` : ""}`;
  return null;
}

// The extent of coronary disease at angiography (28 Oct 2026, Ahmed: a cath showing left main + 3-vessel
// disease referred for CABG, which the patient refused, was missing from the overview). Anatomy only:
// left main ≥50%, other vessels ≥70% or occluded, as obstructiveCad.
export function cathExtent(a: Record<string, any>) {
  const lm = !!a.lm && (SIG.includes(a.lm) || a.lm === "50–69%");
  const vessels = (["lad", "lcx", "rca"] as const).filter((k) => SIG.includes(a[k])).map((k) => ({ lad: "LAD", lcx: "LCx", rca: "RCA" })[k]);
  if (!lm && !vessels.length) return null;
  const text = lm ? (vessels.length ? `Left main + ${vessels.length}-vessel disease` : "Left main disease") : `${vessels.length}-vessel disease`;
  return { lm, vessels, text: `${text} (${[lm ? "LM" : null, ...vessels].filter(Boolean).join(", ")})`, short: text, prognostic: lm || vessels.length >= 3 };
}

// One line for lists, the journey and notes.
export function studySummary(kind: string, a: Record<string, any>): string {
  if (kind === "structural_imaging") return [a.intervention,a.modality,a.aorticMorphology,a.aorticMorphology === "Bicuspid" ? `Sinus ${a.sinusDiameter ?? "—"} / STJ ${a.stjDiameter ?? "—"} / ascending ${a.ascendingDiameter ?? "—"} mm` : null,a.suitability,a.reviewed === "Yes" ? "team reviewed" : "review pending"].filter(Boolean).join(" · ");
  const u = (n: unknown, unit: string) => (n == null ? null : `${n}${unit}`);
  switch (kind) {
    case "pericardial_imaging": return [a.modality,a.purpose,a.effusion === "Absent"?"No effusion":a.effusion,a.size!=null?`${a.size} mm`:null,a.haemodynamics,`Inflammation: ${a.inflammation}`,`Constriction: ${a.constriction}`].filter(Boolean).join(" · ");
    case "pericardial_fluid": return [`Culture: ${a.microbiology}`,`Cytology: ${a.cytology}`,a.tb?`TB: ${a.tb}`:null,a.appearance].filter(Boolean).join(" · ");
    case "aortic_imaging": return [a.modality, a.aorticMorphology, a.sinusDiameter != null ? `Sinus ${a.sinusDiameter} mm` : null, a.ascendingDiameter != null ? `Ascending ${a.ascendingDiameter} mm` : null, a.archDiameter != null ? `Arch ${a.archDiameter} mm` : null, a.descendingDiameter != null ? `Descending ${a.descendingDiameter} mm` : null, a.interpretation].filter(Boolean).join(" · ");
    case "laa_imaging": return [a.purpose, a.modality, `LAA thrombus: ${a.laaThrombus}`, a.deviceThrombus ? `Device thrombus: ${a.deviceThrombus}` : null, a.leak ? `Leak: ${a.leak}${a.leakMm != null ? ` (${a.leakMm} mm)` : ""}` : null].filter(Boolean).join(" · ");
    case "culture":
      return [a.specimen + (a.sets != null ? ` (${a.sets} sets)` : ""), a.result === "Growth" || a.result === "Probable contaminant" ? [a.organism, (a.resistance ?? []).filter((x: string) => x !== "None reported").join(", ") || null, a.result === "Probable contaminant" ? "probable contaminant" : null].filter(Boolean).join(" · ") || "growth" : a.result?.toLowerCase()]
        .filter(Boolean).join(": ");
    case "ecg":
      return [a.rhythm, u(a.rate, " bpm"), a.qrs != null ? `QRS ${a.qrs} ms${a.qrsMorphology && !["Normal", "Not reported"].includes(a.qrsMorphology) ? " " + a.qrsMorphology : ""}` : a.qrsMorphology === "Not reported" ? null : a.qrsMorphology, u(a.qtc, " ms QTc"), a.avBlock && a.avBlock !== "None" ? `${a.avBlock} AV block` : null, (a.st ?? []).filter((x: string) => x !== "None").join(", ") || null]
        .filter(Boolean).join(" · ");
    case "holter":
      return [a.duration, a.rhythm, a.longestPause != null ? `longest pause ${a.longestPause} s` : null, a.veBurden != null ? `VE ${a.veBurden}%` : null, a.nsvt === "Yes" ? "NSVT" : null, a.avBlock && a.avBlock !== "None" ? `${a.avBlock} AV block` : null]
        .filter(Boolean).join(" · ");
    case "stress":
      return [a.modality, a.result, a.extent && a.extent !== "None" ? `${a.extent.toLowerCase()} ischaemia` : null, a.territory?.length ? a.territory.join("/") : null, u(a.mets, " METs")].filter(Boolean).join(" · ");
    case "nuclear":
      return [`${a.stressor ?? ""} MIBI`.trim(), a.result, a.extent ? `${a.extent.toLowerCase()} ischaemia` : null, a.ischaemia != null ? `${a.ischaemia}% LV` : null, a.territory?.length ? a.territory.join("/") : null, a.tid === "Yes" ? "TID" : null, u(a.gatedLvef, "% gated LVEF")].filter(Boolean).join(" · ");
    case "orthostatic_bp": return [`Supine ${a.supineSbp}/${a.supineDbp}`,`standing 3 min ${a.standing3Sbp}/${a.standing3Dbp}`,a.symptoms,a.interpretation].filter(Boolean).join(" · ");
    case "home_bp": return [`Home BP ${a.meanSbp}/${a.meanDbp}`,`${a.days} days`,a.protocol,a.onTreatment].filter(Boolean).join(" · ");
    case "hypertension_workup": return [a.purpose,a.screenResult,a.secondaryResult,a.cause,a.anatomy,a.contraindications].filter(Boolean).join(" · ");
    case "abpm":
      return [a.duration ? `${a.duration} ABPM` : "ABPM", a.sbp24 != null && a.dbp24 != null ? `24-h ${a.sbp24}/${a.dbp24}` : null, a.sbpDay != null && a.dbpDay != null ? `day ${a.sbpDay}/${a.dbpDay}` : null, a.sbpNight != null && a.dbpNight != null ? `night ${a.sbpNight}/${a.dbpNight}` : null, a.dipping && a.dipping !== "Not reported" ? a.dipping.toLowerCase() : null, a.conclusion].filter(Boolean).join(" · ");
    case "ccta":
      return [a.cac != null ? `CAC ${a.cac}` : null, a.cadrads && a.cadrads !== "Calcium score only" ? `CAD-RADS ${a.cadrads}` : null, a.vessels?.length ? a.vessels.join(", ") : null, a.highRiskPlaque === "Yes" ? "high-risk plaque" : null].filter(Boolean).join(" · ");
    case "cmr":
      return [a.lvef != null ? `LVEF ${a.lvef}%` : null, a.rvef != null ? `RVEF ${a.rvef}%` : null, a.lge && a.lge !== "None" ? `LGE ${a.lge.toLowerCase()}` : a.lge === "None" ? "no LGE" : null, a.impression].filter(Boolean).join(" · ");
    case "cath": {
      const obs = obstructiveCad("cath", a);
      return [obs ?? (coronaryAnatomyComplete(a) ? "No obstructive coronary disease" : "Coronary anatomy incomplete"), a.outcome].filter(Boolean).join(" · ");
    }
    case "device_check": {
      const shocks = Number(a.shocks) > 0 ? `${a.shocks} shock${Number(a.shocks) === 1 ? "" : "s"}` : (a.therapies ?? []).includes("Shock") ? "shock" : null;
      return [
        `${a.device ?? "Device"} ${a.setting === "Remote" ? "remote check" : "check"}`,
        a.battery === "OK" ? (a.longevity != null ? `battery ${a.longevity} y` : "battery OK") : a.battery,
        a.leads === "Abnormal" ? `lead problem${a.leadIssue?.length ? `: ${a.leadIssue.join(", ").toLowerCase()}` : ""}` : null,
        a.vpace != null ? `V-pacing ${a.vpace}%` : null, a.bivpace != null ? `BiV ${a.bivpace}%` : null,
        a.ahre === "Yes" ? `AHRE${a.ahreLongest ? ` (longest ${a.ahreLongest})` : ""}` : null,
        a.va && a.va !== "None" ? a.va : null,
        a.storm === "Yes" ? "electrical storm" : null,
        shocks ? `${shocks}${a.shockType ? ` · ${String(a.shockType).replace(/ \(.*\)$/, "").toLowerCase()}` : ""}` : (a.therapies ?? []).includes("ATP") ? "ATP" : null,
        a.programming === "Reprogrammed" ? "reprogrammed" : null,
      ].filter(Boolean).join(" · ");
    }
  }
  return "";
}

// Echo valve assessment (valve module, slice 1): a grade per valve and the measured values the
// valve rules read. Grades are the echocardiographer's own; CardioFlow does not grade from numbers.
export const ECHO_VALVES = [
  { key: "as", label: "Aortic stenosis", short: "AS", dx: "as" },
  { key: "ar", label: "Aortic regurgitation", short: "AR", dx: "ar" },
  { key: "mr", label: "Mitral regurgitation", short: "MR", dx: "mr" },
  { key: "ms", label: "Mitral stenosis", short: "MS", dx: "ms" },
  { key: "tr", label: "Tricuspid regurgitation", short: "TR", dx: "tr" },
] as const;
export const VALVE_GRADES = ["None", "Mild", "Moderate", "Severe"] as const;
export const MR_TYPES = ["Primary", "Secondary"] as const;
export const ECHO_NUMBERS = [
  { code: "av-vmax", label: "AV peak velocity", unit: "m/s", min: 0.5, max: 8, step: 0.1 },
  { code: "av-mg", label: "AV mean gradient", unit: "mmHg", min: 0, max: 200, step: 1 },
  { code: "ava", label: "AVA", unit: "cm²", min: 0.1, max: 6, step: 0.01 },
  { code: "mva", label: "MVA", unit: "cm²", min: 0.2, max: 8, step: 0.1 },
  { code: "lvesd", label: "LVESD", unit: "mm", min: 10, max: 120, step: 1 },
  { code: "lvedd", label: "LVEDD", unit: "mm", min: 20, max: 130, step: 1 },
  { code: "spap", label: "SPAP", unit: "mmHg", min: 5, max: 200, step: 1 },
  { code: "trv", label: "Peak TR velocity", unit: "m/s", min: 0.5, max: 7, step: 0.1 },
  { code: "mwt", label: "Max wall thickness", unit: "mm", min: 5, max: 60, step: 1 },
  { code: "la-diam", label: "LA diameter", unit: "mm", min: 15, max: 90, step: 1 },
  { code: "lavi", label: "LA volume index", unit: "mL/m²", min: 5, max: 300, step: 1 },
  { code: "lvot-rest", label: "LVOT gradient, rest", unit: "mmHg", min: 0, max: 250, step: 1 },
  { code: "lvot-provoked", label: "LVOT gradient, provoked", unit: "mmHg", min: 0, max: 250, step: 1 },
] as const;
// "Severe AS", "Moderate secondary MR": the text the echo adds to its findings
export function valveFindings(valves: Record<string, string>, mrType?: string | null) {
  return ECHO_VALVES.filter((v) => valves[v.key] && valves[v.key] !== "None" && valves[v.key] !== "Mild")
    .map((v) => `${valves[v.key]} ${v.key === "mr" && mrType ? `${mrType.toLowerCase()} ` : ""}${v.short}`);
}

// Regional wall motion (7 Oct 2026): wall by wall, as reported. Walls follow the 16/17-segment model
// grouped by wall (AHA 2002 / ASE-EACVI 2015); the motion words are the reporter's.
export const LV_WALLS = [
  { key: "anterior", label: "Anterior", territory: "LAD" },
  { key: "anteroseptal", label: "Anteroseptal", territory: "LAD" },
  { key: "inferoseptal", label: "Inferoseptal", territory: "LAD/RCA" },
  { key: "inferior", label: "Inferior", territory: "RCA" },
  { key: "inferolateral", label: "Inferolateral", territory: "LCx" },
  { key: "anterolateral", label: "Anterolateral", territory: "LCx" },
  { key: "apex", label: "Apex", territory: "LAD" },
] as const;
export const WALL_MOTION = ["Hypokinetic", "Akinetic", "Dyskinetic", "Aneurysmal"] as const;
export const WALL_LEVELS = ["Basal", "Mid", "Apical", "Whole wall"] as const;
export type Rwma = Partial<Record<string, { motion: string; level?: string }>>;
export function rwmaFindings(rwma: Rwma): string[] {
  const by = new Map<string, string[]>();
  for (const w of LV_WALLS) {
    const x = rwma[w.key];
    if (!x || !(WALL_MOTION as readonly string[]).includes(x.motion)) continue;
    const name = (x.level && x.level !== "Whole wall" && w.key !== "apex" ? `${x.level.toLowerCase()} ` : "") + w.label.toLowerCase();
    by.set(x.motion, [...(by.get(x.motion) ?? []), name]);
  }
  return [...by.entries()].map(([m, walls]) => `${m}: ${walls.join(", ")}`);
}

// Atrial size and LV diastolic function as reported (14 Oct 2026, Ahmed). Grades are the reporter's words:
// atrial enlargement normal/mild/moderate/severe (ASE/EACVI 2015 chamber quantification partitions), diastolic
// function grade I–III or indeterminate (ASE/EACVI 2016 algorithm, applied by the echocardiographer).
export const ATRIAL_SIZES = ["Normal", "Mild", "Moderate", "Severe"] as const;
export const DIASTOLIC_GRADES = ["Normal", "Grade I", "Grade II", "Grade III", "Indeterminate"] as const;
export type Chambers = { la?: string; ra?: string; diastolic?: string };
export function chamberFindings(c: Chambers | undefined): string[] {
  if (!c) return [];
  const size = (g: string | undefined, name: string) =>
    !g || !(ATRIAL_SIZES as readonly string[]).includes(g) ? null : g === "Normal" ? `Normal ${name} size` : `${g === "Mild" ? "Mildly" : g === "Moderate" ? "Moderately" : "Severely"} dilated ${name}`;
  const d = c.diastolic && (DIASTOLIC_GRADES as readonly string[]).includes(c.diastolic)
    ? c.diastolic === "Normal" ? "Normal diastolic function" : c.diastolic === "Indeterminate" ? "Indeterminate diastolic function" : `${c.diastolic} diastolic dysfunction`
    : null;
  return [size(c.la, "LA"), size(c.ra, "RA"), d].filter(Boolean) as string[];
}

// LV hypertrophy as reported: grade and pattern. The wall-thickness partition values shown beside a measured
// wall are the ASE/EAE chamber quantification ones (Lang 2006, septal/posterior wall, cm), a hint only.
export const LVH_GRADES = ["Mild", "Moderate", "Severe"] as const;
export const LVH_PATTERNS = ["Concentric", "Asymmetric septal", "Apical", "Concentric remodelling"] as const;
export function wallThicknessHint(mm: number, sex: "Male" | "Female" | undefined): string | null {
  if (!Number.isFinite(mm) || !sex) return null;
  const cm = mm / 10;
  const [n, mild, mod] = sex === "Male" ? [1.0, 1.3, 1.6] : [0.9, 1.2, 1.5];
  const g = cm <= n ? "within reference" : cm <= mild ? "mildly increased" : cm <= mod ? "moderately increased" : "severely increased";
  return `${mm} mm: ${g} for a ${sex === "Male" ? "man" : "woman"} (ASE/EAE partition values)`;
}
export function lvhFinding(lvh: { grade?: string; pattern?: string } | undefined): string | null {
  if (!lvh?.grade && !lvh?.pattern) return null;
  if (lvh.pattern === "Concentric remodelling") return "Concentric remodelling";
  return `${lvh.grade ? `${lvh.grade} ` : ""}LV hypertrophy${lvh.pattern ? ` (${lvh.pattern.toLowerCase()})` : ""}`;
}
