export type MedicationStatus =
  "ACTIVE" | "TEMPORARILY_HELD" | "STOPPED" | "PLANNED";

export type MedicationEventType =
  | "started"
  | "dose_increased"
  | "dose_decreased"
  | "held"
  | "restarted"
  | "stopped"
  | "planned"
  | "corrected";

export type MedicationDefinition = {
  medication_id: string;
  version: number;
  generic_name: string;
  drug_class: string;
  subclass: string;
  cardiovascular_category: string;
  common_frequencies: string[];
  dose_metadata: Record<string, unknown>;
  renal_metadata: Record<string, unknown>;
  hepatic_metadata: Record<string, unknown>;
  pregnancy_metadata: Record<string, unknown>;
  contraindications: unknown[];
  cautions: unknown[];
  monitoring_metadata: unknown[];
  adverse_effects: unknown[];
  interaction_metadata: unknown[];
  evidence_links: unknown[];
  status: "active" | "inactive";
  reviewed_on: string | null;
  groups?: { group_id: string; name: string }[];
  products?: SiteProduct[];
  current_for_patient?: boolean;
  recently_used?: { last_used: string; use_count: number } | null;
};

export type SiteProduct = {
  id: string;
  site_id: string;
  trade_name: string;
  formulary_status: "available" | "restricted" | "unavailable" | "unknown";
  note: string;
};

export type CurrentTherapy = {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  medication_id: string;
  medication_version: number;
  generic_name: string;
  trade_name: string | null;
  status: MedicationStatus;
  event_type: MedicationEventType;
  dose_value: number | null;
  dose_unit: string | null;
  frequency: string | null;
  route: string | null;
  effective_at: string;
  indications: string[];
  prescribing_clinician: string;
  reason: string;
  target_dose_value: number | null;
  target_dose_unit: string | null;
  planned_next_dose_value: number | null;
  planned_next_dose_unit: string | null;
  planned_titration_date: string | null;
};

export type TherapyEvent = CurrentTherapy & {
  therapy_id: string;
  version: number;
  created_at: string;
};

export type LabDefinition = {
  test_id: string;
  version: number;
  display: string;
  category: string;
  canonical_unit: string;
  accepted_units: string[];
  specimen_options: string[];
};

export type LabResult = {
  id: string;
  logical_id: string;
  version: number;
  patient_id: string;
  test_id: string;
  display: string;
  original_value: number;
  original_unit: string;
  canonical_value: number;
  canonical_unit: string;
  specimen: string | null;
  collected_at: string;
  resulted_at: string;
  source_label: string;
  laboratory_name: string | null;
  reference_low: number | null;
  reference_high: number | null;
  abnormal_flag: string | null;
  verification_status: string;
  calculation_method: string | null;
  calculation_version: string | null;
};

export type LabTrend = {
  test_id: string;
  display: string;
  canonical_unit: string;
  latest: LabResult;
  previous: LabResult | null;
  change: number | null;
  direction: "increasing" | "decreasing" | "unchanged" | "single";
  results: LabResult[];
};

export type TitrationState =
  | "NOT_REQUIRED"
  | "TITRATION_PLANNED"
  | "WAITING_FOR_MONITORING"
  | "READY_FOR_REVIEW"
  | "TITRATION_DEFERRED"
  | "TARGET_ACHIEVED"
  | "MAXIMALLY_TOLERATED"
  | "STOPPED";

export function trendDirection(values: number[]): LabTrend["direction"] {
  if (values.length < 2) return "single";
  const delta = values[0] - values[1];
  if (Math.abs(delta) < Number.EPSILON) return "unchanged";
  return delta > 0 ? "increasing" : "decreasing";
}

export function monitoringState(
  targetDate: string | null,
  taskStatus: string,
  today: string,
) {
  if (["completed", "cancelled", "superseded"].includes(taskStatus))
    return "complete" as const;
  if (!targetDate) return "unscheduled" as const;
  if (targetDate < today) return "overdue" as const;
  if (targetDate === today) return "due_today" as const;
  return "upcoming" as const;
}

export function resolveTitrationState(input: {
  stopped?: boolean;
  targetAchieved?: boolean;
  maximallyTolerated?: boolean;
  limitation?: "absolute" | "dose" | "current" | null;
  planned?: boolean;
  requiredChecksComplete?: boolean;
}) {
  if (input.stopped) return "STOPPED" as const;
  if (input.targetAchieved) return "TARGET_ACHIEVED" as const;
  if (input.maximallyTolerated) return "MAXIMALLY_TOLERATED" as const;
  if (input.limitation) return "TITRATION_DEFERRED" as const;
  if (!input.planned) return "NOT_REQUIRED" as const;
  return input.requiredChecksComplete
    ? ("READY_FOR_REVIEW" as const)
    : ("WAITING_FOR_MONITORING" as const);
}

export function bmi(weightKg: number, heightCm: number) {
  if (!(weightKg > 0) || !(heightCm > 0))
    throw new Error("Positive weight and height are required");
  return weightKg / (heightCm / 100) ** 2;
}

export function mostellerBsa(weightKg: number, heightCm: number) {
  if (!(weightKg > 0) || !(heightCm > 0))
    throw new Error("Positive weight and height are required");
  return Math.sqrt((weightKg * heightCm) / 3600);
}

// NIDDK-published race-free 2021 CKD-EPI creatinine equation for adults.
export function ckdEpi2021Creatinine(
  creatinineMgDl: number,
  ageYears: number,
  sex: "Male" | "Female",
) {
  if (!(creatinineMgDl > 0) || ageYears < 18)
    throw new Error("Adult age and positive serum creatinine are required");
  const female = sex === "Female";
  const kappa = female ? 0.7 : 0.9;
  const alpha = female ? -0.241 : -0.302;
  const ratio = creatinineMgDl / kappa;
  return (
    142 *
    Math.min(ratio, 1) ** alpha *
    Math.max(ratio, 1) ** -1.2 *
    0.9938 ** ageYears *
    (female ? 1.012 : 1)
  );
}

// Cockcroft-Gault estimate. The supplied weight strategy must be explicit.
export function cockcroftGault(
  creatinineMgDl: number,
  ageYears: number,
  weightKg: number,
  sex: "Male" | "Female",
) {
  if (!(creatinineMgDl > 0) || !(weightKg > 0) || ageYears < 18)
    throw new Error(
      "Adult age, positive weight and serum creatinine are required",
    );
  const base = ((140 - ageYears) * weightKg) / (72 * creatinineMgDl);
  return base * (sex === "Female" ? 0.85 : 1);
}
