// Admission, discharge, clinic-visit and patient-status vocabulary. Descriptive lists only.

export const ADMISSION_REASONS = [
  "Acute decompensated HF", "STEMI", "NSTE-ACS", "Chest pain (ACS to exclude)", "AF / flutter", "VT / VF", "Bradycardia / AV block",
  "Syncope", "Valve disease", "Endocarditis", "Pericarditis / effusion", "Pulmonary embolism", "Hypertensive emergency", "Elective procedure", "Other",
];
// reasons that make an admission HF-related unless the clinician says otherwise
export const HF_REASONS = ["Acute decompensated HF"];
export const ADMISSION_ROUTES = ["Emergency department", "Clinic", "Transfer from another hospital", "Elective"];
export const SYMPTOMS = ["Dyspnoea", "Orthopnoea / PND", "Leg swelling", "Chest pain", "Palpitations", "Syncope / presyncope", "Fatigue", "Reduced exercise tolerance", "No symptoms"];

export const IN_HOSPITAL_EVENTS = [
  "None", "Cardiac arrest", "Cardiogenic shock", "Inotropes / vasopressors", "Mechanical ventilation", "IV diuretics", "New AF", "VT / VF",
  "Acute kidney injury", "Hyperkalaemia", "Major bleeding", "Stroke / TIA", "Infection", "Coronary angiography", "PCI", "CABG", "Device implanted",
];
export const DISCHARGE_CONDITION = ["Euvolaemic", "Still congested", "Stable, pain-free", "Rate controlled", "Improved", "Other"];
export const DISCHARGE_DESTINATION = ["Home", "Home with support", "Rehabilitation / nursing facility", "Transfer to another hospital", "Left against medical advice"];

// Vital status is separate from follow-up status.
export const CAUSE_GROUPS: { value: string; label: string }[] = [
  { value: "hf", label: "Heart failure" },
  { value: "sudden_cardiac", label: "Sudden cardiac death" },
  { value: "other_cv", label: "Other cardiovascular" },
  { value: "non_cv", label: "Non-cardiovascular" },
  { value: "unknown", label: "Unknown" },
];
export const FOLLOW_UP_STATUS: { value: string; label: string }[] = [
  { value: "active", label: "Active follow-up" },
  { value: "lost", label: "Lost to follow-up" },
  { value: "transferred", label: "Transferred care" },
  { value: "discharged_from_clinic", label: "Discharged from clinic" },
];

// Readmission interval bands used by the HF analytics.
export function readmissionBand(days: number) {
  return days <= 30 ? "≤30 days" : days <= 90 ? "31–90 days" : days <= 180 ? "91–180 days" : ">180 days";
}

// An admission is HF-related when the clinician said so; older records fall back to the reasons.
export const isHfAdmission = (c: { reasons: string[]; summary?: any }) =>
  typeof c.summary?.hfRelated === "boolean" ? c.summary.hfRelated : c.reasons.some((r) => HF_REASONS.includes(r) || /\bHF\b|heart failure/i.test(r));
