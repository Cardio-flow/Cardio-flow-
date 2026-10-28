// Four clinical destinations, with existing deep links retained as record views.
export const PATIENT_SECTIONS = [
  ["summary", "Overview", "Overview"],
  ["visits", "Visits & journey", "Visits"],
  ["record", "Clinical record", "Record"],
  ["plan", "Plan & follow-up", "Plan"],
] as const;
export const RECORD_VIEWS = [
  ["history", "History"],
  ["medications", "Medications"],
  ["investigations", "Investigations"],
] as const;
export function patientSection(tab: string): (typeof PATIENT_SECTIONS)[number][0] {
  if (["record", "history", "medications", "investigations", "registries"].includes(tab)) return "record";
  if (["visits", "journey"].includes(tab)) return "visits";
  return tab === "plan" ? "plan" : "summary";
}

// Confirmation is opt-in: opening an admission never asserts that old history
// or medicines have just been checked. Legacy drafts had implicit confirmations.
export function admissionConfirmations(
  conditions: {id: string}[], medicines: {id: string}[], answers: Record<string, string>,
) {
  const allowed = new Set(["unchanged", "changed", "unknown", "not-assessed"]);
  return ([...conditions.map(c=>({kind:"condition" as const,id:c.id})), ...medicines.map(m=>({kind:"medication" as const,id:m.id}))])
    .filter(x=>allowed.has(answers[x.id]))
    .map(x=>({...x,answer:answers[x.id]}));
}
