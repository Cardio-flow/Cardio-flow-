// Read model only. Prescribing and clinical thresholds remain in the existing rules.
export type MedicationCheck = {
  id: string;
  title: string;
  codes?: string[];
  study?: string;
  medicines: string[];
  sources: string[];
};
export type MedicationReviewContext = {
  checks: MedicationCheck[];
};
