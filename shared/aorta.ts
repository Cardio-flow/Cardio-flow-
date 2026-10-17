import type { StudyField } from "./studies.js";

export type AortaContext = {
  key: string;
  eligible: boolean;
  bicuspid: boolean;
  heritable: boolean;
  familyRecommended: boolean;
  valveAssessment: { at: string; summary: string } | null;
  report: {
    id: string;
    at: string;
    attributes: Record<string, any>;
    summary: string;
    conclusion: string;
  } | null;
  urgent: string[];
  referral: string[];
  missing: string[];
};
export const AORTA_SOURCE = "ESC aorta 2024 · ACC/AHA aorta 2022";
export function aorticTeamClearsTavi(
  p: AortaContext | undefined,
  risk: unknown,
) {
  if (!p?.referral.length) return true;
  if (p.urgent.length || !p.report?.conclusion.trim()) return false;
  const a = p.report.attributes;
  if (
    a.aorticStrategy ===
    "Aortic surgery deferred for prohibitive risk; rationale documented"
  )
    return risk === "ineligible";
  const surgicalSize =
    Math.max(
      a.sinusDiameter ?? 0,
      a.stjDiameter ?? 0,
      a.ascendingDiameter ?? 0,
      a.archDiameter ?? 0,
      a.descendingDiameter ?? 0,
    ) >= 55;
  return (
    !surgicalSize &&
    a.aorticStrategy === "No aortic surgery indication after review"
  );
}
export const AORTA_FIELDS: StudyField[] = [
  {
    key: "purpose",
    label: "Purpose",
    type: "choice",
    required: true,
    options: [
      "Baseline assessment",
      "Surveillance",
      "After aortic repair",
      "Acute assessment",
    ],
  },
  {
    key: "modality",
    label: "Modality",
    type: "choice",
    required: true,
    options: ["TTE", "CT", "CMR", "TOE / TEE"],
  },
  {
    key: "aorticMorphology",
    label: "Aortic valve morphology",
    type: "choice",
    required: true,
    options: ["Tricuspid", "Bicuspid", "Other morphology", "Not assessed"],
  },
  {
    key: "extent",
    label: "Imaging extent",
    type: "choice",
    required: true,
    options: ["Entire thoracic aorta", "Root / ascending only", "Incomplete"],
  },
  ...[
    ["sinusDiameter", "Sinus of Valsalva diameter"],
    ["stjDiameter", "Sinotubular junction diameter"],
    ["ascendingDiameter", "Maximum ascending aorta diameter"],
    ["archDiameter", "Maximum arch diameter"],
    ["descendingDiameter", "Maximum descending thoracic diameter"],
  ].map(([key, label]): StudyField => ({
    key,
    label,
    type: "number",
    unit: "mm",
    min: 1,
    max: 150,
    decimals: 1,
  })),
  {
    key: "aorticPhenotype",
    label: "Aortopathy phenotype",
    type: "choice",
    options: [
      "No dilatation",
      "Root phenotype",
      "Ascending phenotype",
      "Mixed / other",
      "Not assessed",
    ],
  },
  {
    key: "coarctation",
    label: "Coarctation assessment",
    type: "choice",
    options: ["Excluded", "Present", "Not assessed"],
  },
  {
    key: "comparison",
    label: "Prior imaging comparison",
    type: "choice",
    options: [
      "Comparable same-segment measurements reviewed",
      "Not comparable / unavailable",
    ],
  },
  {
    key: "aorticGrowth",
    label: "Confirmed growth from comparable imaging",
    type: "number",
    unit: "mm/year",
    min: 0,
    max: 30,
    decimals: 1,
    when: {
      field: "comparison",
      in: ["Comparable same-segment measurements reviewed"],
    },
  },
  {
    key: "aorticStrategy",
    label: "Documented aortic-team strategy (if reviewed)",
    type: "choice",
    options: [
      "Review incomplete",
      "No aortic surgery indication after review",
      "Aortic surgery indicated / preferred",
      "Aortic surgery deferred for prohibitive risk; rationale documented",
    ],
  },
  {
    key: "interpretation",
    label: "Reported assessment",
    type: "choice",
    required: true,
    options: [
      "No dilatation reported",
      "Thoracic aortic dilatation",
      "Thoracic aortic aneurysm",
      "Chronic dissection / residual aortic disease",
      "Suspected acute aortic syndrome",
      "Indeterminate",
    ],
  },
];
