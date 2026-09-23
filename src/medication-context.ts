import type { CareEntry } from "./care-model";
import type { MedicationDefinition } from "./medication-laboratory";

// Navigation hints from documented diagnoses, never treatment recommendations.
export function documentedContexts(
  problems: Pick<CareEntry, "title" | "family">[],
  comorbidities: string[],
): string[] {
  const text = [...problems.map((item) => item.title), ...comorbidities]
    .join(" ")
    .toLowerCase();
  const contexts: string[] = [];
  if (
    /\bhfref\b|heart failure with reduced|reduced ejection fraction/.test(text)
  )
    contexts.push("HFrEF");
  if (
    /\bcad\b|coronary|\bacs\b|\bnstemi\b|\bstemi\b|myocardial infarction/.test(
      text,
    ) ||
    problems.some((item) => item.family === "CAD")
  )
    contexts.push("cad");
  if (/\bckd\b|chronic kidney/.test(text))
    contexts.push("cardiorenal-protection");
  if (/\baf\b|atrial fibrillation/.test(text))
    contexts.push("af-rate-control", "anticoagulation-af");
  if (/hypertension|high blood pressure/.test(text))
    contexts.push("hypertension");
  if (/diabetes/.test(text)) contexts.push("diabetes");
  return [...new Set(contexts)];
}

export function medicationContexts(
  medication: Pick<MedicationDefinition, "groups">,
  patientContexts: string[],
): string[] {
  const groups = new Set(
    (medication.groups ?? []).map((item) => item.group_id),
  );
  return patientContexts.filter((context) => {
    if (context === "HFrEF")
      return groups.has("hf-cardiorenal") || groups.has("loop-diuretics");
    if (context === "cad")
      return [
        "antiplatelet",
        "lipid-lowering",
        "antianginal",
        "evidence-beta-blockers",
      ].some((group) => groups.has(group));
    if (context === "cardiorenal-protection")
      return ["hf-cardiorenal", "sglt2-inhibitors", "nonsteroidal-mras"].some(
        (group) => groups.has(group),
      );
    if (context === "af-rate-control")
      return [
        "evidence-beta-blockers",
        "antiarrhythmic",
        "calcium-channel-blockers",
      ].some((group) => groups.has(group));
    if (context === "anticoagulation-af") return groups.has("anticoagulation");
    if (context === "hypertension") return groups.has("antihypertensive");
    if (context === "diabetes")
      return groups.has("cardiometabolic") || groups.has("sglt2-inhibitors");
    return false;
  });
}

export function reviewedDosePresets(
  medication: Pick<MedicationDefinition, "reviewed_on" | "dose_metadata">,
): { value: number; unit: string; label: string }[] {
  if (!medication.reviewed_on) return [];
  const metadata = medication.dose_metadata;
  if (metadata?.state !== "reviewed" || !Array.isArray(metadata.presets))
    return [];
  return metadata.presets.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const preset = item as Record<string, unknown>;
    return typeof preset.value === "number" &&
      preset.value > 0 &&
      typeof preset.unit === "string" &&
      preset.unit.length > 0
      ? [
          {
            value: preset.value,
            unit: preset.unit,
            label:
              typeof preset.label === "string"
                ? preset.label
                : `${preset.value} ${preset.unit}`,
          },
        ]
      : [];
  });
}
