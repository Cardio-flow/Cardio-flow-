import { MEASURES } from "./catalog.js";
import type {
  Answers,
  WizardContext,
  WizardDef,
  OutcomeItem,
} from "./wizards.js";
export const MEDICATION_REVIEW_SOURCE =
  "HFA/ESC polypharmacy 2025 · medicine labels · EHRA 2021";
export function validateMedicationMonitoring(a: Answers, c: WizardContext) {
  const checks = c.medicationReview?.checks ?? [];
  if (!checks.length)
    return "No unbooked medication monitoring is due. Review existing appointments and safety findings.";
  if (!Array.isArray(a.medicationChecks) || !a.medicationChecks.length)
    return "Select the checks to arrange";
  if (a.medicationChecks.some((id) => !checks.some((c) => c.id === id)))
    return "The medication checks changed. Reopen the review.";
  return null;
}
export const MEDICATION_WIZARDS: Record<string, WizardDef> = {
  "medication-monitoring": {
    id: "medication-monitoring",
    title: "Medication review: monitoring plan",
    shortTitle: "Plan medication checks",
    group: "Acute & safety",
    tone: "yellow",
    episode: false,
    source:
      "HFA/ESC polypharmacy consensus 2025 (10.1002/ejhf.3642); existing medicine-specific label schedules and EHRA 2021 Table 3.",
    sourceShort: MEDICATION_REVIEW_SOURCE,
    note: "Select the due tests and a date. Safety decisions remain open until addressed; this plan does not change medicines.",
    facts: [],
    steps: [
      {
        id: "checks",
        title: "Due monitoring",
        questions: [
          {
            id: "medicationChecks",
            label: "Checks to arrange",
            type: "multi",
            required: true,
            options: [],
            optionsFrom: "medicationChecks",
          },
          {
            id: "monitorDate",
            label: "Test date",
            type: "date",
            required: true,
          },
        ],
      },
    ],
    outcome(a, c) {
      return (c.medicationReview?.checks ?? [])
        .filter((check) =>
          (a.medicationChecks as string[] | undefined)?.includes(check.id),
        )
        .map(
          (check) =>
            ({
              kind: "plan",
              category: "monitoring",
              title: check.title,
              dueDate: String(a.monitorDate ?? ""),
              completesOn: check.codes
                ? { type: "lab", codes: check.codes }
                : { type: "study", kind: check.study },
              label: "",
            }) satisfies OutcomeItem,
        );
    },
    assess(a, c) {
      return {
        heading: "Medication monitoring",
        tone: "yellow",
        rows: (c.medicationReview?.checks ?? [])
          .filter((check) =>
            (a.medicationChecks as string[] | undefined)?.includes(check.id),
          )
          .map((check) => ({
            label: check.title,
            value: [
              ...(check.codes?.map((code) => MEASURES[code]?.short ?? code) ??
                []),
              check.medicines.join(", "),
            ].join(" · "),
          })),
        recommendations: [
          "Existing safety decisions remain open. No medication change is made by this monitoring plan.",
        ],
      };
    },
  },
};
