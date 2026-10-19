import type { StudyField } from "./studies.js";
export const PERICARDIAL_SOURCE = "ESC pericardial 2025";
export const PERICARDIAL_DOI = "10.1093/eurheartj/ehaf192";
export const PERICARDIAL_PURPOSES = [
  "Initial assessment",
  "Surveillance",
  "After drainage",
  "Constriction assessment",
];
export const PERICARDIAL_FIELDS: StudyField[] = [
  {
    key: "purpose",
    label: "Purpose",
    type: "choice",
    required: true,
    options: PERICARDIAL_PURPOSES,
  },
  {
    key: "modality",
    label: "Modality",
    type: "choice",
    required: true,
    options: ["TTE", "TOE / TEE", "CT", "CMR"],
  },
  {
    key: "effusion",
    label: "Effusion",
    type: "choice",
    required: true,
    options: ["Absent", "Circumferential", "Loculated", "Not assessed"],
  },
  {
    key: "size",
    label: "Maximum end-diastolic echo-free space",
    type: "number",
    unit: "mm",
    min: 0,
    max: 150,
    decimals: 1,
    when: {
      field: "effusion",
      in: ["Circumferential", "Loculated"],
      and: { field: "modality", in: ["TTE", "TOE / TEE"] },
    },
  },
  {
    key: "haemodynamics",
    label: "Haemodynamic assessment",
    type: "choice",
    required: true,
    options: [
      "No tamponade features after assessment",
      "Echo signs concerning for tamponade",
      "Clinical tamponade",
      "Not assessed",
    ],
  },
  {
    key: "signs",
    label: "Reported findings",
    type: "multi",
    options: [
      "Right atrial collapse",
      "Right ventricular diastolic collapse",
      "Marked respiratory inflow variation",
      "Plethoric IVC",
      "Septal bounce / ventricular interdependence",
      "Pericardial thickening / calcification",
    ],
  },
  {
    key: "inflammation",
    label: "Pericardial inflammation on imaging",
    type: "choice",
    required: true,
    options: ["Present", "Absent", "Not assessed"],
  },
  {
    key: "constriction",
    label: "Constrictive physiology",
    type: "choice",
    required: true,
    options: ["Absent", "Suspected", "Confirmed", "Not assessed"],
  },
];
export const PERICARDIAL_FLUID_FIELDS: StudyField[] = [
  {
    key: "microbiology",
    label: "Bacterial culture",
    type: "choice",
    required: true,
    options: ["Pending", "No growth", "Organism identified", "Not sent"],
  },
  {
    key: "cytology",
    label: "Cytology",
    type: "choice",
    required: true,
    options: [
      "Pending",
      "Negative for malignancy",
      "Malignant cells identified",
      "Indeterminate",
      "Not sent",
    ],
  },
  {
    key: "tb",
    label: "TB testing (when indicated)",
    type: "choice",
    options: ["Pending", "Positive", "Negative", "Not indicated", "Not sent"],
  },
  {
    key: "appearance",
    label: "Fluid appearance",
    type: "choice",
    options: [
      "Serous",
      "Serosanguineous",
      "Haemorrhagic",
      "Purulent",
      "Chylous",
      "Other",
    ],
  },
];
export const DRAIN_METHODS = [
  "Image-guided pericardiocentesis",
  "Surgical drainage / window",
] as const;
export const DRAIN_RESULTS = [
  "Drainage performed",
  "Attempted / no drainage",
] as const;
export const DRAIN_INDICATIONS = [
  "Tamponade",
  "Suspected bacterial / malignant disease",
  "Symptomatic effusion despite treatment",
  "Other specialist indication",
] as const;
export const DRAIN_COMPLICATIONS = [
  "None identified",
  "Bleeding / cardiac injury",
  "Arrhythmia",
  "Pneumothorax",
  "Pericardial decompression syndrome",
  "Other",
  "Not assessed",
] as const;
export type PericardialContext = {
  key: string;
  eligible: boolean;
  label: string;
  suggestedType: string | null;
  report: {
    id: string;
    at: string;
    summary: string;
    attributes: Record<string, any>;
  } | null;
  drainage: {
    id: string;
    at: string;
    summary: string;
    attributes: Record<string, any>;
  } | null;
  fluid: {
    id: string;
    at: string;
    summary: string;
    attributes: Record<string, any>;
  } | null;
  urgent: string[];
  missing: string[];
  risks: string[];
};
export function pericardialSize(mm: number | null | undefined) {
  return mm == null ? null : mm > 20 ? "Large" : mm >= 10 ? "Moderate" : "Mild";
}
export function validatePericardialReport(a: Record<string, any>) {
  if (
    a.effusion === "Absent" &&
    ["Clinical tamponade", "Echo signs concerning for tamponade"].includes(
      a.haemodynamics,
    )
  )
    throw Error(
      "Tamponade concern with no effusion: reconcile the report before saving",
    );
}
