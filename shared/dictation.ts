import { ADMISSION_REASONS, SYMPTOMS } from "./encounters.js";

export const VISIT_REASONS = ["Heart failure", "Post-discharge", "Medication titration", "Post-ACS", "Post-PCI", "Valve", "Prosthetic valve problem", "Arrhythmia", "Device", "ICD shock", "Pre-operative assessment", "Chest pain", "Bleeding", "Chest infection", "Myocarditis", "Pericarditis", "Routine cardiology"];
export type DictationSuggestion = { id: string; field: "reason" | "symptom" | "vital"; code: string; value: string; label: string; source: string };

// Conservative entry assistance, not clinical interpretation. Only complete, explicitly labelled
// clauses are eligible. History, negation, medication instructions and ambiguous values remain text.
export function suggestDictation(text: string, mode: "visit" | "admission") {
  const suggestions: DictationSuggestion[] = [];
  const add = (field: DictationSuggestion["field"], code: string, value: string, label: string, source: string) => {
    suggestions.push({ id: `${field}:${code}:${suggestions.length}`, field, code, value, label, source });
  };
  const reasons = mode === "admission" ? ADMISSION_REASONS : VISIT_REASONS;
  const uncertainContext = /\b(yesterday|previous(?:ly)?|last|histor(?:y|ical)|used to|at home|reported|uncertain|maybe|approximately|do not|not sure|denies|denied)\b/i.test(text);
  const clauses = text.split(/[;\n]|\.(?!\d)/).map(x => x.trim()).filter(Boolean);
  for (const source of clauses) {
    const list = source.match(/^(?:reason(?: for (?:visit|admission))?|symptoms?)\s*:\s*(.+)$/i);
    if (list) {
      const symptom = /^symptom/i.test(source);
      const vocabulary = symptom ? SYMPTOMS : reasons;
      for (const term of list[1].split(/,|\s+and\s+/i).map(x => x.trim())) {
        const value = vocabulary.find(x => x.toLowerCase() === term.toLowerCase());
        if (value) add(symptom ? "symptom" : "reason", value, value, `${symptom ? "Symptom" : "Reason"}: ${value}`, source);
      }
      continue;
    }
    if (uncertainContext) continue;
    const bp = source.match(/^(?:today['’]?s?\s+)?(?:blood pressure|bp)\s*:?\s*(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})\s*(?:mmhg|millimetres of mercury)$/i);
    if (bp) {
      add("vital", "sbp", bp[1], `Systolic BP: ${bp[1]} mmHg`, source);
      add("vital", "dbp", bp[2], `Diastolic BP: ${bp[2]} mmHg`, source);
    }
    const hr = source.match(/^(?:today['’]?s?\s+)?(?:heart rate|pulse)\s*:?\s*(\d{2,3})\s*(?:bpm|beats per minute)$/i);
    if (hr) add("vital", "hr", hr[1], `Heart rate: ${hr[1]} bpm`, source);
    const weight = source.match(/^(?:today['’]?s?\s+)?weight\s*:?\s*(\d{1,3}(?:\.\d+)?)\s*(?:kg|kilograms?)$/i);
    if (weight) add("vital", "weight", weight[1], `Weight: ${weight[1]} kg`, source);
  }
  // Contradictory repeated values cannot be chosen accidentally. Leave them in the narrative.
  const conflicting = new Set(suggestions.filter(s => suggestions.some(x => x.field === s.field && x.code === s.code && x.value !== s.value)).map(s => s.code));
  const symptoms = suggestions.filter(s => s.field === "symptom");
  const noSymptomsConflict = symptoms.some(s => s.value === "No symptoms") && symptoms.some(s => s.value !== "No symptoms");
  const seen = new Set<string>();
  return {
    suggestions: suggestions.filter(s => {
      const key = `${s.field}:${s.code}`;
      if (conflicting.has(s.code) || (noSymptomsConflict && s.field === "symptom") || seen.has(key)) return false;
      seen.add(key); return true;
    }),
    warnings: ["Review every word, number, unit and negative statement. Only explicitly labelled English reasons, symptoms and current vitals are suggested. Labs, medicines, dates and plans remain narrative; use their usual forms to record them.", ...(conflicting.size || noSymptomsConflict ? ["Conflicting entries were left in the narrative. Resolve them before entering structured fields."] : [])],
  };
}
