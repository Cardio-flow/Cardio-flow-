import { medicationChecks } from "./clinical-review.js";
import type { CareKind } from "./care-model.js";

export type Answer = string | number | string[];
export type Answers = Record<string, Answer>;
export type Field = {
  key: string;
  label: string;
  type: "choice" | "multi" | "number" | "text";
  options?: string[];
  unit?: string;
  min?: number;
  max?: number;
  when?: { key: string; values: string[] };
  required?: boolean;
};
export type Template = {
  key: string;
  kind: CareKind;
  family: string;
  label: string;
  fields: Field[];
  source?: string;
  sourceLabel?: string;
};
export const unknown = "Unknown / not assessed";
export const yesNo = ["Yes", "No", unknown];
const choice = (
  key: string,
  label: string,
  options: string[],
  when?: Field["when"],
): Field => ({ key, label, type: "choice", options, when });
const multi = (
  key: string,
  label: string,
  options: string[],
  when?: Field["when"],
): Field => ({ key, label, type: "multi", options, when });
const number = (
  key: string,
  label: string,
  unit: string,
  min: number,
  max: number,
  when?: Field["when"],
): Field => ({ key, label, type: "number", unit, min, max, when });
const certainty = () =>
  choice("certainty", "Diagnostic certainty", [
    "Suspected",
    "Confirmed",
    unknown,
  ]);
const symptoms = () =>
  multi("symptoms", "Present symptoms", [
    "Chest discomfort",
    "Breathlessness",
    "Orthopnoea",
    "Oedema",
    "Palpitations",
    "Syncope / presyncope",
    "Fatigue",
    "No symptoms reported",
    "Other",
  ]);
const problem = (
  key: string,
  family: string,
  label: string,
  fields: Field[],
): Template => ({
  key: `problem.${key}`,
  kind: "problem",
  family,
  label,
  fields: [certainty(), ...fields],
});
const response = () =>
  choice("clinical_response", "Recorded response", [
    "Not yet assessed",
    "Improving",
    "Unchanged",
    "Deteriorating",
    "Resolved",
  ]);
const management = (options: string[]) =>
  multi("management", "Selected management / assessment actions", options);
const commonActions = [
  "Clinical reassessment",
  "Senior / specialist review",
  "Review relevant investigations",
  "Review current medication plan",
  "Document monitoring / reassessment",
  "Document escalation / transfer",
];
const complication = (
  key: string,
  family: string,
  label: string,
  fields: Field[],
  actions: string[],
  source?: string,
): Template => ({
  key: `complication.${key}`,
  kind: "complication",
  family,
  label,
  source,
  sourceLabel: source
    ? "Clinical reference — local pathway review required"
    : undefined,
  fields: [
    certainty(),
    ...fields,
    management(actions),
    response(),
    multi("next_steps", "Selected next steps", [
      "Repeat clinical assessment",
      "Review pending results",
      "Review held medication",
      "Arrange follow-up",
      "Handover to named team",
      "Document resolution",
    ]),
  ],
});
export const medicationNames = [
  "Apixaban",
  "Rivaroxaban",
  "Dabigatran",
  "Edoxaban",
  "Warfarin",
  "Aspirin",
  "Clopidogrel",
  "Ticagrelor",
  "Prasugrel",
  "Enoxaparin",
  "Unfractionated heparin",
  "Atorvastatin",
  "Rosuvastatin",
  "Ezetimibe",
  "Sacubitril / valsartan",
  "Ramipril",
  "Perindopril",
  "Valsartan",
  "Candesartan",
  "Bisoprolol",
  "Carvedilol",
  "Metoprolol succinate",
  "Spironolactone",
  "Eplerenone",
  "Dapagliflozin",
  "Empagliflozin",
  "Furosemide",
  "Bumetanide",
  "Torsemide",
  "Amiodarone",
  "Digoxin",
  "Diltiazem",
  "Verapamil",
  "Amlodipine",
  "Isosorbide mononitrate",
  "Nitroglycerin",
  "Ivabradine",
];
const procedure = (
  key: string,
  family: string,
  label: string,
  fields: Field[],
): Template => ({
  key: `procedure.${key}`,
  kind: "procedure",
  family,
  label,
  fields: [
    choice("urgency", "Urgency", ["Elective", "Urgent", "Emergency", unknown]),
    ...fields,
    choice("outcome", "Documented procedural outcome", [
      "Not yet performed",
      "Completed as planned",
      "Partially completed",
      "Unsuccessful",
      "Cancelled",
      unknown,
    ]),
  ],
});
export const templates: Template[] = [
  problem("acs", "CAD", "Acute coronary syndrome", [
    choice("presentation", "Presentation", [
      "STEMI",
      "NSTEMI",
      "Unstable angina",
      "Undifferentiated chest pain",
      unknown,
    ]),
    symptoms(),
    choice("strategy", "Selected strategy", [
      "Undecided",
      "Medical management",
      "Coronary angiography",
      "PCI",
      "CABG assessment",
    ]),
    choice("residual_disease", "Residual coronary disease", yesNo),
  ]),
  problem("cad", "CAD", "Coronary artery disease", [
    choice("phenotype", "Clinical setting", [
      "Chronic coronary syndrome",
      "Prior myocardial infarction",
      "Prior PCI",
      "Prior CABG",
      unknown,
    ]),
    symptoms(),
    choice("angina_class", "Recorded CCS angina class", [
      "I",
      "II",
      "III",
      "IV",
      "No angina",
      unknown,
    ]),
    multi("vessels", "Documented vessels", [
      "LM",
      "LAD",
      "LCx",
      "RCA",
      "Graft",
    ]),
  ]),
  problem("hf", "HF", "Heart failure", [
    choice("phenotype", "Recorded HF phenotype", [
      "HFrEF",
      "HFmrEF",
      "HFpEF",
      "HFimpEF",
      "Unclassified",
    ]),
    number("lvef", "Measured LVEF", "%", 1, 100),
    choice("nyha", "Recorded NYHA class", ["I", "II", "III", "IV", unknown]),
    choice("course", "Course", [
      "New diagnosis",
      "Chronic stable",
      "Acute decompensation",
      unknown,
    ]),
    multi("congestion", "Documented congestion findings", [
      "Peripheral oedema",
      "Pulmonary congestion",
      "Raised JVP",
      "Ascites",
      "None recorded",
    ]),
    choice("device", "Device history", [
      "None",
      "Pacemaker",
      "ICD",
      "CRT-P",
      "CRT-D",
      unknown,
    ]),
  ]),
  problem("af", "EP", "Atrial fibrillation / flutter", [
    choice("rhythm", "Rhythm diagnosis", [
      "Atrial fibrillation",
      "Typical flutter",
      "Atypical flutter",
      unknown,
    ]),
    choice(
      "pattern",
      "AF pattern",
      [
        "First diagnosed",
        "Paroxysmal",
        "Persistent",
        "Long-standing persistent",
        "Permanent",
        unknown,
      ],
      { key: "rhythm", values: ["Atrial fibrillation"] },
    ),
    choice("strategy", "Selected rhythm strategy", [
      "Decision pending",
      "Rate control",
      "Rhythm control",
      "Cardioversion assessment",
      "Ablation assessment",
    ]),
    choice("anticoagulation", "Anticoagulation decision", [
      "Review pending",
      "Prescribed",
      "Deferred",
      "Contraindicated",
      "Patient declined",
      unknown,
    ]),
    choice("valve_context", "Valve context", [
      "No prosthetic valve or significant mitral stenosis",
      "Prosthetic valve",
      "Moderate / severe mitral stenosis",
      unknown,
    ]),
  ]),
  problem("arrhythmia", "EP", "Other arrhythmia", [
    choice("rhythm", "Arrhythmia", [
      "SVT",
      "AVNRT",
      "AVRT",
      "Atrial tachycardia",
      "Ventricular tachycardia",
      "Ventricular fibrillation",
      "Frequent PVCs",
      "Bradycardia",
      "AV block",
      unknown,
    ]),
    choice("stability", "Recorded haemodynamic state", [
      "Stable",
      "Unstable",
      unknown,
    ]),
    symptoms(),
  ]),
  problem("valve", "Structural", "Valvular heart disease", [
    multi("valves", "Affected valves", [
      "Aortic",
      "Mitral",
      "Tricuspid",
      "Pulmonary",
    ]),
    multi("lesions", "Documented lesions", [
      "Stenosis",
      "Regurgitation",
      "Mixed disease",
      "Prosthetic valve dysfunction",
    ]),
    choice("severity", "Recorded severity", [
      "Mild",
      "Moderate",
      "Severe",
      unknown,
    ]),
    symptoms(),
    choice("heart_team", "Heart-team review", [
      "Not requested",
      "Requested",
      "Discussed",
      "Decision documented",
      unknown,
    ]),
  ]),
  problem("device", "EP", "Cardiac implanted device", [
    choice("device", "Device type", [
      "Pacemaker",
      "ICD",
      "CRT-P",
      "CRT-D",
      "Loop recorder",
      "Leadless pacemaker",
      unknown,
    ]),
    choice("review", "Reason for review", [
      "Routine follow-up",
      "Battery status",
      "Lead issue",
      "Arrhythmia episode",
      "Suspected infection",
      "Extraction assessment",
    ]),
  ]),
  problem("ckd", "Renal", "Chronic kidney disease", [
    choice("stage", "Recorded CKD stage", [
      "G1",
      "G2",
      "G3a",
      "G3b",
      "G4",
      "G5",
      unknown,
    ]),
    choice("dialysis", "Dialysis", [
      "No",
      "Haemodialysis",
      "Peritoneal dialysis",
      unknown,
    ]),
    number("creatinine", "Serum creatinine", "", 0.1, 3000),
    choice("creatinine_unit", "Creatinine unit", ["mg/dL", "µmol/L"]),
    number("potassium", "Potassium", "mmol/L", 1, 12),
  ]),
  problem("diabetes", "General", "Diabetes mellitus", [
    choice("type", "Diabetes type", ["Type 1", "Type 2", "Other", unknown]),
    choice("insulin", "Current insulin treatment", yesNo),
    number("hba1c", "HbA1c", "%", 2, 25),
  ]),
  problem("hypertension", "General", "Hypertension", [
    number("sbp", "Systolic blood pressure", "mmHg", 40, 300),
    number("dbp", "Diastolic blood pressure", "mmHg", 20, 200),
    choice("control", "Clinician assessment", [
      "Controlled",
      "Above individualized target",
      "Symptomatic low pressure",
      unknown,
    ]),
  ]),
  problem("stroke", "General", "Stroke / TIA history", [
    choice("event", "Documented event", [
      "Ischaemic stroke",
      "TIA",
      "Haemorrhagic stroke",
      unknown,
    ]),
    choice("deficit", "Residual deficit", yesNo),
  ]),
  problem("aorta", "Structural", "Aortic disease", [
    choice("type", "Aortic condition", [
      "Aneurysm",
      "Dissection",
      "Coarctation",
      "Prior aortic repair",
      unknown,
    ]),
    choice("site", "Location", [
      "Root",
      "Ascending",
      "Arch",
      "Descending",
      "Abdominal",
      unknown,
    ]),
  ]),
  problem("cardiomyopathy", "HF", "Cardiomyopathy", [
    choice("type", "Cardiomyopathy type", [
      "Dilated",
      "Hypertrophic",
      "Arrhythmogenic",
      "Restrictive",
      "Infiltrative",
      "Other",
      unknown,
    ]),
    number("lvef", "Measured LVEF", "%", 1, 100),
    choice("genetics", "Genetic assessment", [
      "Not assessed",
      "Requested",
      "Completed",
      unknown,
    ]),
  ]),
  problem("pericardial", "General", "Pericardial disease", [
    choice("type", "Pericardial condition", [
      "Pericarditis",
      "Pericardial effusion",
      "Constrictive pericarditis",
      "Tamponade assessment",
      unknown,
    ]),
    choice("course", "Course", ["Acute", "Recurrent", "Chronic", unknown]),
  ]),
  problem("congenital", "Structural", "Congenital / shunt disease", [
    choice("type", "Condition", [
      "ASD",
      "PFO",
      "VSD",
      "Other congenital disease",
      unknown,
    ]),
    choice("repair", "Repair status", [
      "Unrepaired",
      "Surgical repair",
      "Device closure",
      unknown,
    ]),
  ]),
  complication(
    "hyperkalemia",
    "Renal",
    "Hyperkalaemia",
    [
      number("potassium", "Recorded potassium", "mmol/L", 1, 12),
      choice("ecg", "ECG assessment", [
        "Not yet assessed",
        "No changes documented",
        "Changes documented",
        unknown,
      ]),
      choice("sample", "Sample validity", [
        "Confirmed",
        "Repeat requested",
        "Haemolysis suspected",
        unknown,
      ]),
    ],
    [
      "Review ECG / rhythm",
      "Confirm potassium result",
      "Review renal function",
      "Review contributing medications",
      "Emergency protocol assessment",
      "Specialist renal review",
      "Document potassium-lowering treatment given",
      "Repeat potassium monitoring",
      "Review post-treatment glucose monitoring",
    ],
    "https://www.ukkidney.org/health-professionals/guidelines/treatment-acute-hyperkalaemia-adults-0",
  ),
  complication(
    "aki",
    "Renal",
    "Acute kidney injury / renal deterioration",
    [
      number("creatinine", "Current creatinine", "", 0.1, 3000),
      choice("creatinine_unit", "Creatinine unit", ["mg/dL", "µmol/L"]),
      choice("volume", "Documented volume assessment", [
        "Not assessed",
        "Hypovolaemic",
        "Euvolaemic",
        "Congested",
        unknown,
      ]),
      choice("urine", "Urine output assessment", [
        "Not measured",
        "Adequate",
        "Reduced",
        "Anuria documented",
        unknown,
      ]),
    ],
    [
      "Reassess haemodynamics / volume",
      "Review medication and exposure history",
      "Repeat renal investigations",
      "Review fluid balance / urine output",
      "Investigate underlying cause",
      "Renal specialist review",
      "Document medication hold or restart decision",
    ],
  ),
  complication(
    "bleeding",
    "General",
    "Bleeding event",
    [
      choice("site", "Bleeding site", [
        "Gastrointestinal",
        "Intracranial",
        "Access site",
        "Retroperitoneal",
        "Genitourinary",
        "Other",
        unknown,
      ]),
      choice("severity", "Clinician-assessed severity", [
        "Not yet assessed",
        "Minor",
        "Major",
        "Life-threatening",
        unknown,
      ]),
      choice("antithrombotics", "Antithrombotic review", [
        "Not yet reviewed",
        "Reviewed",
        unknown,
      ]),
    ],
    [
      "Assess bleeding source and severity",
      "Review haemodynamics and haemoglobin",
      "Review antithrombotic therapy",
      "Document haemostasis / source control",
      "Document reversal decision",
      "Document transfusion decision",
      "Specialist / emergency team review",
      "Plan thrombosis-risk and restart reassessment",
    ],
  ),
  complication(
    "shock",
    "General",
    "Shock / haemodynamic deterioration",
    [
      choice("type", "Working shock phenotype", [
        "Undifferentiated",
        "Cardiogenic",
        "Distributive",
        "Hypovolaemic",
        "Obstructive",
        "Mixed",
      ]),
      number("sbp", "Systolic blood pressure", "mmHg", 20, 300),
    ],
    commonActions,
  ),
  complication(
    "pulmonary_oedema",
    "HF",
    "Pulmonary oedema / worsening congestion",
    [
      choice("respiratory", "Respiratory support documented", [
        "None",
        "Supplemental oxygen",
        "Non-invasive ventilation",
        "Invasive ventilation",
        unknown,
      ]),
    ],
    commonActions,
  ),
  complication(
    "arrhythmia",
    "EP",
    "Periprocedural arrhythmia",
    [
      choice("rhythm", "Rhythm", [
        "AF / flutter",
        "SVT",
        "VT",
        "VF",
        "Bradycardia / AV block",
        unknown,
      ]),
      choice("stability", "Haemodynamic state", [
        "Stable",
        "Unstable",
        unknown,
      ]),
    ],
    commonActions,
  ),
  complication(
    "stroke",
    "General",
    "Suspected stroke / neurological event",
    [
      choice("status", "Neurological assessment", [
        "Pending",
        "Completed",
        unknown,
      ]),
    ],
    [
      "Urgent specialist pathway review",
      "Document symptom-onset information",
      "Review neurological assessment",
      "Review imaging availability",
      "Review antithrombotic plan",
      "Document reassessment / handover",
    ],
  ),
  complication(
    "tamponade",
    "Structural",
    "Pericardial effusion / tamponade concern",
    [
      choice("echo", "Echocardiography status", [
        "Requested",
        "Performed",
        "Reviewed",
        unknown,
      ]),
    ],
    commonActions,
  ),
  complication(
    "access",
    "CAD",
    "Vascular access complication",
    [
      choice("site", "Access site", ["Radial", "Femoral", "Other", unknown]),
      choice("type", "Complication type", [
        "Bleeding",
        "Haematoma",
        "Pseudoaneurysm",
        "Ischaemia",
        "Other",
        unknown,
      ]),
    ],
    commonActions,
  ),
  complication(
    "infection",
    "General",
    "Infection / device infection concern",
    [
      choice("site", "Suspected focus", [
        "Device / pocket",
        "Endocarditis",
        "Respiratory",
        "Urinary",
        "Other",
        unknown,
      ]),
      choice("cultures", "Culture status", [
        "Not obtained",
        "Requested",
        "Collected",
        "Result available",
        unknown,
      ]),
    ],
    commonActions,
  ),
  procedure("pci", "CAD", "Coronary angiography / PCI", [
    choice("procedure", "Procedure", [
      "Diagnostic angiography",
      "PCI",
      "Staged PCI",
    ]),
    choice("access", "Access site", ["Radial", "Femoral", "Other", unknown]),
    multi("vessels", "Treated vessels", ["LM", "LAD", "LCx", "RCA", "Graft"]),
    choice(
      "strategy",
      "Device strategy",
      ["Balloon only", "Drug-coated balloon", "Stent", "Other", unknown],
      { key: "procedure", values: ["PCI", "Staged PCI"] },
    ),
    number("stent_count", "Stents implanted", "", 0, 20, {
      key: "strategy",
      values: ["Stent"],
    }),
    choice("residual_disease", "Residual disease review needed", yesNo),
  ]),
  procedure("ablation", "EP", "EPS / catheter ablation", [
    choice("target", "Arrhythmia target", [
      "AF",
      "Typical flutter",
      "Atypical flutter",
      "AVNRT",
      "AVRT",
      "Atrial tachycardia",
      "VT",
      "PVC",
      "AV node",
      unknown,
    ]),
    choice("energy", "Energy documented", [
      "Radiofrequency",
      "Cryoablation",
      "Pulsed field",
      "Other",
      unknown,
    ]),
    choice("endpoint", "Endpoint assessment", [
      "Pending",
      "Achieved",
      "Partially achieved",
      "Not achieved",
      unknown,
    ]),
  ]),
  procedure("device", "EP", "Device implantation / revision", [
    choice("device", "Device", [
      "Pacemaker",
      "ICD",
      "CRT-P",
      "CRT-D",
      "Leadless pacemaker",
      "Loop recorder",
    ]),
    choice("operation", "Operation", [
      "New implant",
      "Generator change",
      "Lead revision",
      "Upgrade",
      "Extraction",
    ]),
    choice("lead", "Lead configuration", [
      "Single chamber",
      "Dual chamber",
      "Biventricular",
      "Conduction-system pacing",
      "Other",
      unknown,
    ]),
  ]),
  procedure("structural", "Structural", "Structural intervention", [
    choice("procedure", "Intervention", [
      "TAVI",
      "TEER",
      "LAAO",
      "PFO closure",
      "ASD closure",
      "Other",
    ]),
    choice("heart_team", "Heart-team decision", [
      "Pending",
      "Proceed",
      "Defer",
      "Alternative selected",
      unknown,
    ]),
    choice("imaging", "Imaging review", ["Pending", "Completed", unknown]),
  ]),
  procedure("cardiac_surgery", "Structural", "Cardiac surgery assessment", [
    choice("operation", "Planned operation", [
      "CABG",
      "Valve surgery",
      "Combined CABG / valve",
      "Aortic surgery",
      "Other",
    ]),
    choice("heart_team", "Multidisciplinary review", [
      "Pending",
      "Completed",
      unknown,
    ]),
    choice("risk_method", "Risk assessment method", [
      "STS — external assessment",
      "EuroSCORE II — external assessment",
      "Other validated method",
      "Not yet assessed",
    ]),
  ]),
  procedure("noncardiac_surgery", "General", "Noncardiac surgery assessment", [
    choice("magnitude", "Planned procedure scope", [
      "Major noncardiac surgery",
      "Minor / low-complexity procedure",
      unknown,
    ]),
    choice("operation", "Planned surgery category", [
      "Intraperitoneal",
      "Intrathoracic",
      "Suprainguinal vascular",
      "Other",
    ]),
    choice("high_risk", "RCRI high-risk procedure criterion", yesNo),
    choice("ihd", "History of ischaemic heart disease", yesNo),
    choice("hf", "History of heart failure", yesNo),
    choice("stroke", "History of cerebrovascular disease", yesNo),
    choice("insulin", "Preoperative insulin therapy", yesNo),
    number("creatinine", "Preoperative serum creatinine", "", 0.1, 3000),
    choice("creatinine_unit", "Creatinine unit", ["mg/dL", "µmol/L"]),
    choice("functional", "Functional capacity assessment", [
      "Not assessed",
      "DASI recorded separately",
      "Clinician assessment documented",
    ]),
    choice("inputs_confirmed", "Inputs reviewed for this procedure", [
      "Not yet confirmed",
      "Confirmed",
    ]),
  ]),
  ...medicationNames.map((name) => ({
    key: `medication.${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    kind: "medication" as const,
    family: "General",
    label: name,
    fields: [
      choice("indication", "Documented indication", [
        "Nonvalvular AF",
        "VTE treatment",
        "VTE prevention",
        "ACS / PCI",
        "Chronic CAD",
        "HF",
        "Hypertension",
        "Arrhythmia",
        "Other",
        unknown,
      ]),
      choice("route", "Route", ["Oral", "IV", "Subcutaneous", "Other"]),
      { key: "dose", label: "Clinician-selected dose", type: "text" as const },
      choice("frequency", "Frequency", [
        "Once daily",
        "Twice daily",
        "Three times daily",
        "As needed",
        "Continuous infusion",
        "Other",
      ]),
      choice("decision_reason", "Decision reason", [
        "Prescribed as planned",
        "Awaiting investigation",
        "Renal review",
        "Blood pressure review",
        "Bleeding review",
        "Interaction review",
        "Allergy / intolerance",
        "Patient preference",
        "Access / formulary barrier",
        "Other",
      ]),
      multi("monitoring", "Selected monitoring", [
        "Renal function",
        "Potassium",
        "Blood pressure",
        "Heart rate",
        "ECG",
        "Bleeding / haemoglobin",
        "Liver function",
        "INR",
        "Symptoms / adherence",
      ]),
    ],
  })),
  ...[
    ["creatinine", "Renal", "Serum creatinine", "mg/dL|µmol/L", 0.1, 3000],
    ["potassium", "Renal", "Potassium", "mmol/L", 1, 12],
    ["haemoglobin", "General", "Haemoglobin", "g/dL|g/L", 1, 250],
    ["troponin", "CAD", "Troponin", "ng/L|ng/mL", 0, 1000000],
    ["weight", "General", "Body weight", "kg", 1, 400],
    ["lvef", "HF", "LVEF", "%", 1, 100],
  ].map(([key, family, label, units, min, max]) => ({
    key: `investigation.${key}`,
    kind: "investigation" as const,
    family: String(family),
    label: String(label),
    fields: [
      number("value", "Recorded result", "", Number(min), Number(max)),
      choice("unit", "Result unit", String(units).split("|")),
      choice("interpretation", "Clinician interpretation", [
        "Not yet reviewed",
        "Within expected range",
        "Abnormal — action documented",
        "Uncertain — further assessment",
      ]),
      choice("sample_status", "Result context", [
        "Current encounter",
        "Historical result",
        "External report",
        unknown,
      ]),
    ],
  })),
  {
    key: "investigation.ecg",
    kind: "investigation",
    family: "General",
    label: "ECG",
    fields: [
      choice("rhythm", "Recorded rhythm", [
        "Sinus",
        "AF",
        "Flutter",
        "Paced",
        "Other",
        unknown,
      ]),
      multi("findings", "Documented ECG findings", [
        "ST elevation",
        "ST depression",
        "T-wave change",
        "Conduction abnormality",
        "No acute changes documented",
        "Other",
      ]),
      choice("interpretation", "Clinical review", [
        "Not yet reviewed",
        "Reviewed — action documented",
        "Further review requested",
      ]),
    ],
  },
  {
    key: "decision.followup",
    kind: "decision",
    family: "General",
    label: "Follow-up / reassessment",
    fields: [
      multi("targets", "Review topics", [
        "Symptoms",
        "Pending investigations",
        "Medication reconciliation",
        "Complication response",
        "Residual coronary disease",
        "HF optimization",
        "Device review",
        "Valve review",
        "Rehabilitation",
        "Patient preferences",
      ]),
      choice("barrier", "Current barrier", [
        "None recorded",
        "Awaiting investigation",
        "Appointment unavailable",
        "Medication unavailable",
        "Unable to contact",
        "Patient declined",
        "Clinical contraindication",
        "Other",
      ]),
    ],
  },
];
const surgery = templates.find(
  (t) => t.key === "procedure.noncardiac_surgery",
)!;
surgery.fields.push(
  choice("expected_stay", "Expected postoperative stay", [
    "At least 2 days",
    "Less than 2 days",
    unknown,
  ]),
  choice("lab_current", "Creatinine relevance", [
    "Not yet reviewed",
    "Confirmed for this assessment",
  ]),
);
const apixaban = templates.find((t) => t.key === "medication.apixaban")!;
apixaban.source =
  "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=7be1f4c1-bb2f-4ded-ae9a-515d2a22f93e";
apixaban.sourceLabel =
  "Official prescribing information · adult NVAF reference";
apixaban.fields.push(
  number("weight", "Measured body weight", "kg", 1, 400),
  number("creatinine", "Serum creatinine", "", 0.1, 3000),
  choice("creatinine_unit", "Creatinine unit", ["mg/dL", "µmol/L"]),
  choice("lab_current", "Creatinine relevance", [
    "Not yet reviewed",
    "Confirmed for this assessment",
  ]),
  number("crcl", "Clinician-verified creatinine clearance", "mL/min", 0, 250),
  ...medicationChecks.map(([k, label]) =>
    choice(k, label, [
      "Not yet reviewed",
      "Reviewed — absent / not applicable",
      "Present — specialist review",
    ]),
  ),
  choice("inputs_confirmed", "Patient context and full label reviewed", [
    "Not yet confirmed",
    "Confirmed",
  ]),
);
export const templateByKey = new Map(templates.map((t) => [t.key, t]));
export const catalogVersion = "guided.1";
export function visibleFields(template: Template, answers: Answers): Field[] {
  const visible = new Set<string>();
  // Conditions only use earlier fields, so hidden ancestors cannot expose children.
  return template.fields.filter((f) => {
    const yes =
      !f.when ||
      (visible.has(f.when.key) &&
        f.when.values.some((v) =>
          Array.isArray(answers[f.when!.key])
            ? (answers[f.when!.key] as string[]).includes(v)
            : answers[f.when!.key] === v,
        ));
    if (yes) visible.add(f.key);
    return yes;
  });
}
export function cleanAnswers(template: Template, answers: Answers): Answers {
  return Object.fromEntries(
    visibleFields(template, answers)
      .filter(
        (f) =>
          answers[f.key] !== undefined &&
          answers[f.key] !== "" &&
          (!Array.isArray(answers[f.key]) ||
            (answers[f.key] as string[]).length),
      )
      .map((f) => [f.key, answers[f.key]]),
  );
}
export function answerSummary(template: Template, answers: Answers): string {
  return visibleFields(template, answers)
    .filter(
      (f) =>
        answers[f.key] !== undefined &&
        answers[f.key] !== "" &&
        (!Array.isArray(answers[f.key]) || (answers[f.key] as string[]).length),
    )
    .map(
      (f) =>
        `${f.label}: ${Array.isArray(answers[f.key]) ? (answers[f.key] as string[]).join(", ") : answers[f.key]}${f.unit ? ` ${f.unit}` : ""}`,
    )
    .join("\n");
}
