export const hfStatuses = [
  ["AT_RISK", "At risk / predisposition"],
  ["PRE_HF", "Pre-HF / objective abnormality without clinical HF"],
  ["CURRENT_SYMPTOMATIC", "Current symptomatic HF"],
  ["PREVIOUS_STABLE", "Previous HF — currently clinically stable"],
  ["DECOMPENSATED", "Decompensated HF"],
  ["ADVANCED", "Advanced HF"],
] as const;

export const hfPresentations = [
  ["NEWLY_DIAGNOSED", "Newly diagnosed"],
  ["CHRONIC_STABLE", "Chronic stable"],
  ["ACUTE_DECOMPENSATION", "Acute decompensation"],
  ["POST_DISCHARGE", "Post-discharge review"],
  ["WORSENING_OUTPATIENT", "Worsening outpatient HF"],
  ["RECURRENT_ADMISSION", "Recurrent HF admission"],
  ["ADVANCED_ASSESSMENT", "Advanced HF assessment"],
] as const;

export const hfSymptoms = [
  "Dyspnoea",
  "Exertional dyspnoea",
  "Orthopnoea",
  "PND",
  "Fatigue",
  "Reduced exercise capacity",
  "Peripheral oedema",
  "Abdominal distension",
  "Early satiety",
  "Weight gain",
  "Weight loss / cachexia",
  "Dizziness",
  "Syncope",
  "Chest pain",
  "Palpitations",
] as const;

export const hfEtiologies = [
  "Ischaemic",
  "Hypertensive",
  "Valvular",
  "Dilated cardiomyopathy",
  "Genetic cardiomyopathy",
  "Myocarditis-related",
  "Tachycardia-mediated",
  "Toxin-related",
  "Alcohol-related",
  "Chemotherapy-related",
  "Infiltrative",
  "Amyloid",
  "Hypertrophic cardiomyopathy",
  "Peripartum",
  "Congenital",
  "High-output",
  "Mixed",
  "Unknown / under investigation",
] as const;

export const hfPathways = [
  ["DIAGNOSTIC", "HF diagnostic assessment"],
  ["CONGESTION", "Congestion assessment"],
  ["DECOMPENSATED_HF", "Decompensated HF assessment"],
  ["WORSENING_RENAL_FUNCTION", "Worsening renal function"],
  ["HYPERKALAEMIA", "Hyperkalaemia review"],
  ["HYPOTENSION", "Hypotension review"],
  ["BRADYCARDIA", "Bradycardia review"],
  ["HYPONATRAEMIA", "Hyponatraemia review"],
  ["IRON_OR_ANAEMIA", "Iron deficiency / anaemia review"],
  ["DIURETIC_RESPONSE", "Diuretic response review"],
  ["ADVANCED_HF", "Advanced HF recognition"],
] as const;

export type HfReview = {
  id: string;
  profile_id: string;
  version: number;
  encounter_id: string | null;
  status: (typeof hfStatuses)[number][0];
  presentation: (typeof hfPresentations)[number][0];
  symptoms: { symptom: string; severity: string; change: string }[];
  symptoms_reviewed_unchanged: boolean;
  nyha_class: "I" | "II" | "III" | "IV" | "NOT_ASSESSED" | null;
  etiologies: string[];
  physical_findings: Record<string, string>;
  clinician_congestion: string | null;
  clinician_phenotype: "HFrEF" | "HFpEF" | "UNCLASSIFIED" | null;
  phenotype_source_echo_id: string | null;
  therapy_decisions: {
    group: string;
    status: "ACTIVE" | "NOT_PRESCRIBED" | "LIMITED" | "DECLINED";
    reason: string;
  }[];
  narrative: string;
  observed_at: string;
  author: string;
};

export type HfEcho = {
  id: string;
  study_type: string;
  study_quality: string;
  observed_at: string;
  lvef: number | null;
  lvef_fact_id: string | null;
  rv_function: string | null;
  valve_summary: string[];
  pulmonary_pressure_context: string;
  diastolic_context: string;
  pericardial_context: string;
  structural_context: string;
  source_label: string;
  verification_status: string;
  author: string;
};

export type HfPhenotypeState = {
  value: "HFrEF" | "HFpEF" | "UNCLASSIFIED" | null;
  status: "CONFIRMED" | "REASSESSMENT_REQUIRED" | "NOT_ASSESSED";
  reason: string;
  sourceEchoId: string | null;
};

export function resolveHfPhenotypeState(
  review: HfReview | null,
  preferredEcho: HfEcho | null,
): HfPhenotypeState {
  if (!review?.clinician_phenotype)
    return {
      value: null,
      status: "NOT_ASSESSED",
      reason: preferredEcho
        ? "A preferred LVEF is available but the phenotype has not been clinically confirmed."
        : "No clinically confirmed phenotype or preferred LVEF is available.",
      sourceEchoId: preferredEcho?.id ?? null,
    };
  if (
    preferredEcho &&
    (review.phenotype_source_echo_id !== preferredEcho.id ||
      new Date(preferredEcho.observed_at).getTime() >
        new Date(review.observed_at).getTime())
  )
    return {
      value: review.clinician_phenotype,
      status: "REASSESSMENT_REQUIRED",
      reason:
        "A newer or newly preferred cardiac imaging result is available. The previous phenotype remains historical until clinician reassessment.",
      sourceEchoId: preferredEcho.id,
    };
  return {
    value: review.clinician_phenotype,
    status: "CONFIRMED",
    reason: "Clinician-confirmed phenotype using the selected imaging source.",
    sourceEchoId: review.phenotype_source_echo_id,
  };
}

export function hfDocumentationGaps(input: {
  review: HfReview | null;
  preferredEcho: HfEcho | null;
  labIds: Set<string>;
  rehabilitationStatus: string | null;
}) {
  const gaps: { key: string; label: string; kind: "missing" | "review" }[] = [];
  if (!input.review)
    gaps.push({
      key: "review",
      label: "HF review not recorded",
      kind: "missing",
    });
  if (!input.preferredEcho)
    gaps.push({
      key: "echo",
      label: "No preferred cardiac imaging source",
      kind: "missing",
    });
  if (!input.review?.nyha_class || input.review.nyha_class === "NOT_ASSESSED")
    gaps.push({
      key: "nyha",
      label: "Functional class not assessed",
      kind: "missing",
    });
  if (!input.labIds.has("creatinine") && !input.labIds.has("egfr-ckd-epi-2021"))
    gaps.push({
      key: "renal",
      label: "No structured current renal result",
      kind: "missing",
    });
  if (!input.labIds.has("potassium"))
    gaps.push({
      key: "potassium",
      label: "No structured current potassium result",
      kind: "missing",
    });
  if (!input.labIds.has("uacr"))
    gaps.push({
      key: "uacr",
      label: "UACR assessment not recorded",
      kind: "review",
    });
  if (
    !input.labIds.has("ferritin") ||
    !input.labIds.has("transferrin-saturation")
  )
    gaps.push({
      key: "iron",
      label: "Complete iron-status review not recorded",
      kind: "review",
    });
  if (
    !input.rehabilitationStatus ||
    input.rehabilitationStatus === "NOT_ASSESSED"
  )
    gaps.push({
      key: "rehabilitation",
      label: "Rehabilitation eligibility not reviewed",
      kind: "review",
    });
  return gaps;
}

export function displayHfCode(value: string | null | undefined) {
  if (!value) return "Not recorded";
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}
