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
      { key: "outcome", label: "Outcome", type: "choice", required: true, options: ["Medical therapy", "PCI performed", "Referred for CABG", "Heart team discussion"] },
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
  { code: "lvot-rest", label: "LVOT gradient, rest", unit: "mmHg", min: 0, max: 250, step: 1 },
  { code: "lvot-provoked", label: "LVOT gradient, provoked", unit: "mmHg", min: 0, max: 250, step: 1 },
] as const;
// "Severe AS", "Moderate secondary MR": the text the echo adds to its findings
export function valveFindings(valves: Record<string, string>, mrType?: string | null) {
  return ECHO_VALVES.filter((v) => valves[v.key] && valves[v.key] !== "None" && valves[v.key] !== "Mild")
    .map((v) => `${valves[v.key]} ${v.key === "mr" && mrType ? `${mrType.toLowerCase()} ` : ""}${v.short}`);
}
