// Structured history: risk factors and past cardiac history.
//
// Every question separates Yes / No / Unknown / Not assessed (/ Not applicable), so a
// blank is never read as "no". Two kinds of item:
//   - diagnosis-backed (diabetes, coronary history…): "Yes" IS the active diagnosis on
//     the problem list (one truth, which the rules already read); a "No / Unknown /
//     Not assessed" statement is a dated observation `hx.<key>`.
//   - status items (smoking, alcohol, family history): the answer itself is a dated
//     observation `hx.<key>`, so the status has a history (e.g. current → ex-smoker).
// No thresholds live here. Option lists are descriptive categories only.

export type Answer = "no" | "unknown" | "not-assessed" | "na";
export const ANSWER_LABEL: Record<string, string> = { yes: "Yes", no: "No", unknown: "Unknown", "not-assessed": "Not assessed", na: "Not applicable" };

export type HistoryOption = { value: string; label: string; present?: boolean };
export type HistoryItem = {
  key: string;
  section: "risk" | "cardiac";
  label: string;
  // shown in the risk-factor row when present
  short: string;
  // major cardiovascular risk factor: emphasised (never red: red is for safety alerts)
  major?: boolean;
  // diagnosis-backed: any of these active diagnoses means "present"
  conditions?: string[];
  // status items: the answer options (plus unknown / not assessed)
  options?: HistoryOption[];
  // extra numeric detail for a status answer
  details?: { key: string; label: string; unit?: string; min: number; max: number; when: string[] }[];
};

const STATUS_TAIL: HistoryOption[] = [
  { value: "unknown", label: "Unknown" },
  { value: "not-assessed", label: "Not assessed" },
];

export const HISTORY_ITEMS: HistoryItem[] = [
  {
    key: "smoking", section: "risk", label: "Smoking", short: "Smoker", major: true,
    options: [
      { value: "current", label: "Current smoker", present: true },
      { value: "ex", label: "Ex-smoker", present: true },
      { value: "never", label: "Never smoked" },
      ...STATUS_TAIL,
    ],
    details: [
      { key: "packYears", label: "Pack-years", min: 0, max: 200, when: ["current", "ex"] },
      { key: "quitYear", label: "Year stopped", min: 1940, max: 2100, when: ["ex"] },
    ],
  },
  { key: "diabetes", section: "risk", label: "Diabetes", short: "Diabetes", major: true, conditions: ["t2dm", "t1dm"] },
  { key: "hypertension", section: "risk", label: "Hypertension", short: "Hypertension", major: true, conditions: ["htn"] },
  { key: "dyslipidaemia", section: "risk", label: "Dyslipidaemia", short: "Dyslipidaemia", major: true, conditions: ["dyslipidaemia", "fh"] },
  { key: "obesity", section: "risk", label: "Obesity", short: "Obesity", conditions: ["obesity"] },
  { key: "ckd", section: "risk", label: "Chronic kidney disease", short: "CKD", major: true, conditions: ["ckd-1-2", "ckd-3a", "ckd-3b", "ckd-4", "ckd-5", "dialysis"] },
  {
    key: "fhx-cad", section: "risk", label: "Family history of premature coronary disease", short: "FHx premature CAD",
    options: [{ value: "yes", label: "Yes", present: true }, { value: "no", label: "No" }, ...STATUS_TAIL],
  },
  {
    key: "fhx-scd", section: "risk", label: "Family history of sudden cardiac death or cardiomyopathy", short: "FHx SCD / cardiomyopathy",
    options: [{ value: "yes", label: "Yes", present: true }, { value: "no", label: "No" }, ...STATUS_TAIL],
  },
  {
    key: "alcohol", section: "risk", label: "Alcohol", short: "Alcohol",
    options: [
      { value: "never", label: "Never" },
      { value: "former", label: "Former" },
      { value: "current", label: "Current", present: true },
      ...STATUS_TAIL,
    ],
  },
  { key: "coronary", section: "cardiac", label: "Coronary disease", short: "Coronary disease", conditions: ["cad-ccs", "prior-mi", "prior-pci", "prior-cabg", "acs-stemi", "acs-nstemi"] },
  { key: "heart-failure", section: "cardiac", label: "Heart failure / cardiomyopathy", short: "Heart failure", conditions: ["hfref", "hfmref", "hfpef", "hfimpef"] },
  { key: "valve", section: "cardiac", label: "Valve disease or prosthesis", short: "Valve disease", conditions: ["as", "ar", "mr-primary", "mr-secondary", "ms", "tr", "prosthetic-valve"] },
  { key: "rhythm", section: "cardiac", label: "Arrhythmia or conduction disease", short: "Arrhythmia", conditions: ["af", "flutter", "svt", "vt", "av-block"] },
  { key: "device", section: "cardiac", label: "Cardiac device", short: "Device", conditions: ["cied"] },
  { key: "vascular", section: "cardiac", label: "Stroke / TIA or peripheral arterial disease", short: "Vascular disease", conditions: ["stroke-tia", "pad"] },
];
export const HISTORY_ITEM: Record<string, HistoryItem> = Object.fromEntries(HISTORY_ITEMS.map((i) => [i.key, i]));
export const historyCode = (key: string) => `hx.${key}`;
export const isHistoryCode = (code: string) => code.startsWith("hx.");

// Structured detail per diagnosis (stored in condition.attributes). Descriptive only.
export type AttrField = { key: string; label: string; options: string[]; multi?: boolean };
export const DIAGNOSIS_ATTRIBUTES: Record<string, AttrField[]> = {
  "prior-mi": [{ key: "type", label: "Type", options: ["STEMI", "NSTEMI", "Type 2 MI", "Unknown"] }],
  "acs-stemi": [{ key: "territory", label: "Territory", options: ["Anterior", "Inferior", "Lateral", "Posterior", "Unknown"] }],
  "prior-pci": [{ key: "vessels", label: "Vessels treated", options: ["Left main", "LAD", "LCx", "RCA", "Graft", "Unknown"], multi: true }],
  "prior-cabg": [{ key: "grafts", label: "Grafts", options: ["LIMA", "Other arterial", "Vein grafts", "Unknown"], multi: true }],
  as: [{ key: "severity", label: "Severity", options: ["Mild", "Moderate", "Severe", "Unknown"] }],
  ar: [{ key: "severity", label: "Severity", options: ["Mild", "Moderate", "Severe", "Unknown"] }],
  "mr-primary": [{ key: "severity", label: "Severity", options: ["Mild", "Moderate", "Severe", "Unknown"] }],
  "mr-secondary": [{ key: "severity", label: "Severity", options: ["Mild", "Moderate", "Severe", "Unknown"] }],
  ms: [
    { key: "severity", label: "Severity", options: ["Mild", "Moderate", "Severe", "Unknown"] },
    { key: "aetiology", label: "Aetiology", options: ["Rheumatic", "Degenerative (calcific)", "Unknown"] },
  ],
  tr: [{ key: "severity", label: "Severity", options: ["Mild", "Moderate", "Severe", "Unknown"] }],
  "prosthetic-valve": [
    { key: "position", label: "Position", options: ["Aortic", "Mitral", "Tricuspid", "Pulmonary"] },
    { key: "type", label: "Type", options: ["Mechanical", "Bioprosthetic (surgical)", "TAVI", "Repair / ring"] },
  ],
  cied: [{ key: "type", label: "Device", options: ["Pacemaker", "ICD", "CRT-P", "CRT-D", "Loop recorder"] }],
  af: [{ key: "pattern", label: "Pattern", options: ["First diagnosed", "Paroxysmal", "Persistent", "Permanent", "Unknown"] }],
  "av-block": [{ key: "degree", label: "Degree", options: ["First-degree", "Mobitz I", "Mobitz II", "Complete"] }],
  "stroke-tia": [{ key: "type", label: "Type", options: ["Ischaemic stroke", "Haemorrhagic stroke", "TIA", "Unknown"] }],
};
// Diagnoses that can be recorded more than once (e.g. aortic and mitral prostheses, repeat PCI).
export const MULTIPLE_ALLOWED = new Set(["prosthetic-valve", "prior-pci", "prior-mi"]);

// "Aortic · Mechanical", "LAD, RCA", "STEMI"
export function attributesText(code: string, attributes: Record<string, unknown> | null | undefined) {
  const fields = DIAGNOSIS_ATTRIBUTES[code] ?? [];
  return fields
    .map((f) => {
      const v = attributes?.[f.key];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
      return Array.isArray(v) ? v.join(", ") : String(v);
    })
    .filter(Boolean)
    .join(" · ");
}

// Validates attributes against the catalogue (unknown keys and values are rejected).
export function cleanAttributes(code: string, attributes: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fields = DIAGNOSIS_ATTRIBUTES[code] ?? [];
  for (const [k, v] of Object.entries(attributes ?? {})) {
    if (k === "onsetYear") {
      const y = Number(v);
      if (!Number.isInteger(y) || y < 1900 || y > 2100) throw new Error("Year must be a 4-digit year");
      out.onsetYear = y;
      continue;
    }
    const f = fields.find((x) => x.key === k);
    if (!f) throw new Error(`Unknown detail "${k}"`);
    if (v == null || v === "") continue;
    if (f.multi) {
      if (!Array.isArray(v) || v.some((x) => !f.options.includes(String(x)))) throw new Error(`${f.label}: choose from the list`);
      if (v.length) out[k] = [...new Set(v.map(String))];
    } else {
      if (!f.options.includes(String(v))) throw new Error(`${f.label}: choose from the list`);
      out[k] = String(v);
    }
  }
  return out;
}

// Safety-relevant facts derived from structured detail (read by rules).
export const isMechanicalValve = (c: { code: string; attributes?: Record<string, unknown> | null; detail?: string }) =>
  (c.code === "prosthetic-valve" && c.attributes?.type === "Mechanical") || /mechanical/i.test(c.detail ?? "");
export const isModerateSevereMS = (c: { code: string; attributes?: Record<string, unknown> | null }) =>
  c.code === "ms" && (c.attributes?.severity === "Moderate" || c.attributes?.severity === "Severe");
