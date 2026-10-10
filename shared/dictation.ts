import { ADMISSION_REASONS, SYMPTOMS } from "./encounters.js";
import { MEDICATION } from "./catalog.js";

export const VISIT_REASONS = ["Heart failure", "Post-discharge", "Medication titration", "Post-ACS", "Post-PCI", "Valve", "Prosthetic valve problem", "Arrhythmia", "Device", "ICD shock", "Pre-operative assessment", "Chest pain", "Bleeding", "Chest infection", "Myocarditis", "Pericarditis", "Routine cardiology"];
export type DictationSuggestion = { id: string; field: "reason" | "symptom" | "vital"; code: string; value: string; label: string; source: string };
export type DictationIssue = { group: string; message: string; source: string };
export type DictationReview = { suggestions: DictationSuggestion[]; warnings: string[]; issues: DictationIssue[]; sections: { title: string; text: string }[] };
const aliases: Record<string, string> = { "breathlessness": "Dyspnoea", "shortness of breath": "Dyspnoea", "dyspnea": "Dyspnoea", "orthopnea": "Orthopnoea / PND", "orthopnoea": "Orthopnoea / PND", "ankle swelling": "Leg swelling", "hf": "Heart failure", "heart failure follow-up": "Heart failure", "heart failure follow up": "Heart failure", "acute decompensated heart failure": "Acute decompensated HF" };

// Conservative entry assistance, not clinical interpretation. Only complete, explicitly labelled
// clauses are eligible. History, negation, medication instructions and ambiguous values remain text.
export function suggestDictation(text: string, mode: "visit" | "admission") {
  const suggestions: DictationSuggestion[] = [];
  const issues: DictationIssue[] = [];
  const buckets = new Map<string, string[]>();
  const add = (field: DictationSuggestion["field"], code: string, value: string, label: string, source: string) => {
    suggestions.push({ id: `${field}:${code}:${suggestions.length}`, field, code, value, label, source });
  };
  const reasons = mode === "admission" ? ADMISSION_REASONS : VISIT_REASONS;
  const uncertainContext = /\b(yesterday|previous(?:ly)?|last|history of|historical|used to|at home|reported|uncertain|maybe|approximately|do not|not sure|denies|denied)\b/i.test(text);
  const clauses = text.split(/[;\n]|\.(?!\d)/).map(x => x.trim()).filter(Boolean);
  for (const source of clauses) {
    const title = /^(?:plan|follow.?up|repeat|review in|refer|start|stop|increase|reduce|hold)\b/i.test(source) ? "Plan" : /^(?:exam(?:ination)?|on examination|chest|lungs|heart sounds)\b/i.test(source) ? "Examination" : /^(?:symptoms?|patient (?:has|reports)|no |denies|dysp|breath|orthop|leg swelling)\b/i.test(source) ? "Symptoms" : /^(?:today['’]?s?\s+)?(?:blood pressure|bp|heart rate|pulse|weight)\b/i.test(source) ? "Vitals" : "History";
    buckets.set(title, [...(buckets.get(title) ?? []), source]);
    if (/\b(?:no|not|denies|denied|without)\b/i.test(source)) issues.push({ group: "Meaning", message: "Check the negative statement against what you said.", source });
    if (/\b(?:maybe|uncertain|approximately|not sure)\b/i.test(source)) issues.push({ group: "Meaning", message: "Uncertain statement; keep it as narrative until clarified.", source });
    if (/\b(?:tomorrow|yesterday|next|last|in \d+ days?)\b/i.test(source)) issues.push({ group: "Dates", message: "Confirm the exact date in the usual form; no date was inferred.", source });
    if (Object.values(MEDICATION).some(m => source.toLowerCase().includes(m.name.toLowerCase())) || /\b(?:start|stop|hold|increase|reduce)\b.*\b(?:mg|mcg|dose)\b/i.test(source)) issues.push({ group: "Medicines", message: "Check medicine, dose, units and instruction. Use the medication form to make changes.", source });
    if (/\b(?:creatinine|potassium|sodium|troponin|hemoglobin|haemoglobin|ldl)\b/i.test(source)) issues.push({ group: "Labs", message: "Confirm the result, unit and collection date in Add labs.", source });
    const list = source.match(/^(?:reason(?: for (?:visit|admission))?|(?:here|admitted) for|symptoms?|patient (?:has|reports))\s*:?\s+(.+)$/i);
    if (list) {
      const symptom = /^(?:symptom|patient)/i.test(source);
      if (symptom && /\b(?:no|not|denies|denied|without|maybe|previously|yesterday)\b/i.test(list[1]) && list[1].trim().toLowerCase() !== "no symptoms") continue;
      const vocabulary = symptom ? SYMPTOMS : reasons;
      for (const term of list[1].split(/,|\s+and\s+/i).map(x => x.trim())) {
        const canonical = aliases[term.toLowerCase()] ?? term;
        const value = vocabulary.find(x => x.toLowerCase() === canonical.toLowerCase());
        if (value) add(symptom ? "symptom" : "reason", value, value, `${symptom ? "Symptom" : "Reason"}: ${value}`, source);
      }
      continue;
    }
    const startCount = suggestions.length;
    if (uncertainContext) {
      if (/\b(?:blood pressure|bp|heart rate|pulse|weight)\b/i.test(source)) issues.push({ group: "Vitals", message: "Historical or uncertain context; enter a confirmed current reading in the assessment form.", source });
      continue;
    }
    const bp = source.match(/^(?:today['’]?s?\s+)?(?:blood pressure|bp)\s*(?:is|of|:)?\s*(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})\s*(?:mmhg|millimetres of mercury)$/i);
    if (bp) {
      add("vital", "sbp", bp[1], `Systolic BP: ${bp[1]} mmHg`, source);
      add("vital", "dbp", bp[2], `Diastolic BP: ${bp[2]} mmHg`, source);
    }
    const hr = source.match(/^(?:today['’]?s?\s+)?(?:heart rate|pulse)\s*(?:is|of|:)?\s*(\d{2,3})\s*(?:bpm|beats per minute)$/i);
    if (hr) add("vital", "hr", hr[1], `Heart rate: ${hr[1]} bpm`, source);
    const weight = source.match(/^(?:today['’]?s?\s+)?weight\s*(?:is|of|:)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:kg|kilograms?)$/i);
    if (weight) add("vital", "weight", weight[1], `Weight: ${weight[1]} kg`, source);
    if (suggestions.length === startCount && /\b(?:blood pressure|bp|heart rate|pulse|weight)\b/i.test(source)) issues.push({ group: "Vitals", message: "Missing/unsupported units or an unclear value. Correct the transcript or enter it in the assessment form.", source });
  }
  // Contradictory repeated values cannot be chosen accidentally. Leave them in the narrative.
  const conflicting = new Set(suggestions.filter(s => suggestions.some(x => x.field === s.field && x.code === s.code && x.value !== s.value)).map(s => s.code));
  const symptoms = suggestions.filter(s => s.field === "symptom");
  const noSymptomsConflict = symptoms.some(s => s.value === "No symptoms") && symptoms.some(s => s.value !== "No symptoms");
  const seen = new Set<string>();
  if (conflicting.size || noSymptomsConflict) issues.push({ group: "Conflict", message: "Conflicting readings or symptom statements were withheld. Resolve them before filling fields.", source: suggestions.filter(s => conflicting.has(s.code) || (noSymptomsConflict && s.field === "symptom")).map(s => s.source).filter((s, i, a) => a.indexOf(s) === i).join("; ") });
  return {
    issues,
    sections: [...buckets.entries()].map(([title, lines]) => ({ title, text: lines.join(". ") })),
    suggestions: suggestions.filter(s => {
      const key = `${s.field}:${s.code}`;
      if (conflicting.has(s.code) || (noSymptomsConflict && s.field === "symptom") || seen.has(key)) return false;
      seen.add(key); return true;
    }),
    warnings: ["Review every word, number, unit and negative statement. Only explicitly labelled English reasons, symptoms and current vitals are suggested. Labs, medicines, dates and plans remain narrative; use their usual forms to record them.", ...(conflicting.size || noSymptomsConflict ? ["Conflicting entries were left in the narrative. Resolve them before entering structured fields."] : [])],
  };
}
