// Investigation templates: one per study kind. Each template is a short list of
// select-first fields. Numeric fields that rules read are also written as dated
// observations (code in `obs`), so the engine and the trends see them like any lab.
// Categories are descriptive (reporting vocabulary), never treatment thresholds.

export type StudyField =
  | { key: string; label: string; type: "choice"; options: string[]; required?: boolean; when?: Cond }
  | { key: string; label: string; type: "multi"; options: string[]; when?: Cond }
  | { key: string; label: string; type: "number"; unit: string; min: number; max: number; decimals?: number; obs?: string; required?: boolean; when?: Cond };
type Cond = { field: string; in?: string[]; notIn?: string[] };

export type StudyDef = { kind: string; label: string; short: string; help: string; fields: StudyField[] };

const AV = ["None", "First-degree", "Mobitz I", "Mobitz II", "Complete"];
const STENOSIS = ["None", "<50%", "50–69%", "70–99%", "Occluded", "Not assessed"];

export const STUDIES: StudyDef[] = [
  {
    kind: "ecg", label: "12-lead ECG", short: "ECG", help: "Rhythm, QRS width and morphology drive the device and rhythm rules.",
    fields: [
      { key: "rhythm", label: "Rhythm", type: "choice", required: true, options: ["Sinus rhythm", "Atrial fibrillation", "Atrial flutter", "Paced", "Junctional", "Other"] },
      { key: "rate", label: "Ventricular rate", type: "number", unit: "bpm", min: 20, max: 250, obs: "hr" },
      { key: "pr", label: "PR", type: "number", unit: "ms", min: 40, max: 600, obs: "pr", when: { field: "rhythm", in: ["Sinus rhythm"] } },
      { key: "qrs", label: "QRS duration", type: "number", unit: "ms", min: 40, max: 300, obs: "qrs", required: true },
      { key: "qtc", label: "QTc", type: "number", unit: "ms", min: 250, max: 750, obs: "qtc" },
      { key: "qrsMorphology", label: "QRS morphology", type: "choice", required: true, options: ["Normal", "LBBB", "RBBB", "Non-specific IVCD", "Paced"] },
      { key: "avBlock", label: "AV block", type: "choice", options: AV, when: { field: "rhythm", notIn: ["Atrial fibrillation"] } },
      { key: "st", label: "Ischaemic changes", type: "multi", options: ["None", "ST elevation", "ST depression", "T-wave inversion", "Pathological Q waves"] },
      { key: "lvh", label: "LVH voltage", type: "choice", options: ["No", "Yes"] },
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
      { key: "modality", label: "Modality", type: "choice", required: true, options: ["Exercise ECG", "Stress echo", "SPECT", "PET", "Stress CMR"] },
      { key: "result", label: "Result", type: "choice", required: true, options: ["Negative", "Positive for ischaemia", "Equivocal", "Non-diagnostic"] },
      { key: "extent", label: "Ischaemia extent", type: "choice", options: ["None", "Small", "Moderate", "Large"], when: { field: "modality", notIn: ["Exercise ECG"] } },
      { key: "territory", label: "Territory", type: "multi", options: ["LAD", "LCx", "RCA"], when: { field: "result", in: ["Positive for ischaemia", "Equivocal"] } },
      { key: "mets", label: "Exercise capacity", type: "number", unit: "METs", min: 1, max: 25, decimals: 1, obs: "mets", when: { field: "modality", in: ["Exercise ECG", "Stress echo"] } },
      { key: "symptoms", label: "Symptoms during test", type: "choice", options: ["None", "Typical angina", "Dyspnoea", "Other"] },
    ],
  },
  {
    kind: "ccta", label: "CT coronary angiography / calcium score", short: "CT coronary", help: "Calcium score and CAD-RADS 2.0 category.",
    fields: [
      { key: "cac", label: "Calcium score (Agatston)", type: "number", unit: "", min: 0, max: 10000, obs: "cac" },
      { key: "cadrads", label: "CAD-RADS", type: "choice", options: ["0", "1", "2", "3", "4A", "4B", "5", "N (non-diagnostic)", "Calcium score only"] },
      { key: "vessels", label: "Vessels with ≥50% stenosis", type: "multi", options: ["Left main", "LAD", "LCx", "RCA"], when: { field: "cadrads", in: ["3", "4A", "4B", "5"] } },
      { key: "highRiskPlaque", label: "High-risk plaque features", type: "choice", options: ["No", "Yes"], when: { field: "cadrads", notIn: ["Calcium score only"] } },
    ],
  },
  {
    kind: "cmr", label: "Cardiac MRI", short: "CMR", help: "Volumes, function and tissue characterisation. The LVEF joins the LVEF history.",
    fields: [
      { key: "lvef", label: "LVEF", type: "number", unit: "%", min: 5, max: 85, obs: "lvef" },
      { key: "rvef", label: "RVEF", type: "number", unit: "%", min: 5, max: 85, obs: "rvef" },
      { key: "lge", label: "Late gadolinium enhancement", type: "choice", options: ["None", "Ischaemic pattern", "Non-ischaemic pattern", "Both"] },
      { key: "lgePattern", label: "LGE distribution", type: "multi", options: ["Subendocardial", "Transmural", "Mid-wall", "Epicardial", "Diffuse"], when: { field: "lge", notIn: ["None"] } },
      { key: "oedema", label: "Myocardial oedema", type: "choice", options: ["No", "Yes"] },
      { key: "impression", label: "Impression", type: "choice", options: ["Normal", "Ischaemic cardiomyopathy", "Dilated cardiomyopathy", "Hypertrophic cardiomyopathy", "Amyloidosis", "Myocarditis", "Other"] },
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
      { key: "outcome", label: "Outcome", type: "choice", required: true, options: ["Medical therapy", "PCI performed", "Referred for CABG", "Heart team discussion"] },
    ],
  },
];
export const STUDY: Record<string, StudyDef> = Object.fromEntries(STUDIES.map((s) => [s.kind, s]));
export const STUDY_LABEL: Record<string, string> = { echo: "Echo", ...Object.fromEntries(STUDIES.map((s) => [s.kind, s.short])) };

export function fieldActive(f: StudyField, values: Record<string, unknown>) {
  if (!f.when) return true;
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
  return out;
}

// Anatomy words, not treatment thresholds: ≥50% left main or ≥70% elsewhere at cath,
// ≥50% (CAD-RADS 3 or more) on CT.
const SIG = ["70–99%", "Occluded"];
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

// One line for lists, the journey and notes.
export function studySummary(kind: string, a: Record<string, any>): string {
  const u = (n: unknown, unit: string) => (n == null ? null : `${n}${unit}`);
  switch (kind) {
    case "ecg":
      return [a.rhythm, u(a.rate, " bpm"), a.qrs != null ? `QRS ${a.qrs} ms${a.qrsMorphology && a.qrsMorphology !== "Normal" ? " " + a.qrsMorphology : ""}` : a.qrsMorphology, u(a.qtc, " ms QTc"), a.avBlock && a.avBlock !== "None" ? `${a.avBlock} AV block` : null, (a.st ?? []).filter((x: string) => x !== "None").join(", ") || null]
        .filter(Boolean).join(" · ");
    case "holter":
      return [a.duration, a.rhythm, a.longestPause != null ? `longest pause ${a.longestPause} s` : null, a.veBurden != null ? `VE ${a.veBurden}%` : null, a.nsvt === "Yes" ? "NSVT" : null, a.avBlock && a.avBlock !== "None" ? `${a.avBlock} AV block` : null]
        .filter(Boolean).join(" · ");
    case "stress":
      return [a.modality, a.result, a.extent && a.extent !== "None" ? `${a.extent.toLowerCase()} ischaemia` : null, a.territory?.length ? a.territory.join("/") : null, u(a.mets, " METs")].filter(Boolean).join(" · ");
    case "ccta":
      return [a.cac != null ? `CAC ${a.cac}` : null, a.cadrads && a.cadrads !== "Calcium score only" ? `CAD-RADS ${a.cadrads}` : null, a.vessels?.length ? a.vessels.join(", ") : null, a.highRiskPlaque === "Yes" ? "high-risk plaque" : null].filter(Boolean).join(" · ");
    case "cmr":
      return [a.lvef != null ? `LVEF ${a.lvef}%` : null, a.rvef != null ? `RVEF ${a.rvef}%` : null, a.lge && a.lge !== "None" ? `LGE ${a.lge.toLowerCase()}` : a.lge === "None" ? "no LGE" : null, a.impression].filter(Boolean).join(" · ");
    case "cath": {
      const obs = obstructiveCad("cath", a);
      return [obs ?? "No obstructive coronary disease", a.outcome].filter(Boolean).join(" · ");
    }
  }
  return "";
}
