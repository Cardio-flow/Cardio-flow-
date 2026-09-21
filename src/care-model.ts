// Clinician-entered documentation. These states do not encode treatment advice.
export const families = [
  "General",
  "CAD",
  "HF",
  "EP",
  "Structural",
  "Renal",
  "Rehabilitation",
] as const;
export const careKinds = {
  problem: {
    label: "Problem / pathway",
    states: ["suspected", "active", "resolved"],
    fields: { evidence: "Supporting findings / uncertainty" },
  },
  decision: {
    label: "Decision / next action",
    states: ["pending", "in_progress", "deferred", "completed", "cancelled"],
    fields: {
      evidence: "Evidence needed",
      barrier: "Reason for delay / deferral",
    },
  },
  investigation: {
    label: "Investigation",
    states: ["ordered", "collected", "resulted", "reviewed", "cancelled"],
    fields: {
      value: "Result",
      unit: "Unit",
      interpretation: "Clinical interpretation",
    },
  },
  medication: {
    label: "Medication",
    states: ["proposed", "prescribed", "administered", "held", "discontinued"],
    fields: {
      dose: "Documented dose and frequency",
      indication: "Indication",
      reason: "Reason for change / holding",
      monitoring: "Monitoring plan",
    },
  },
  procedure: {
    label: "Procedure",
    states: ["planned", "performed", "reviewed", "cancelled"],
    fields: {
      indication: "Indication",
      technique: "Technique / access",
      findings: "Findings / measurements",
      devices: "Devices / equipment",
      outcome: "Outcome / complications",
    },
  },
  complication: {
    label: "Complication",
    states: [
      "suspected",
      "assessing",
      "managing",
      "reassessing",
      "resolved",
      "excluded",
    ],
    fields: {
      evidence: "Recognition / evidence",
      affected_plans: "Affected treatment decisions",
      recovery: "Recovery / continuing review",
    },
  },
} as const;
export type CareKind = keyof typeof careKinds;
export type CareEntry = {
  id: string;
  patient_id: string;
  encounter_id: string | null;
  kind: CareKind;
  family: (typeof families)[number];
  title: string;
  status: string;
  occurred_on: string;
  owner: string;
  due_date: string | null;
  assessment: string;
  action: string;
  response: string;
  details: Record<string, string>;
  template_key?: string | null;
  template_version?: string | null;
  structured?: import("./guided").Answers;
  version: number;
  updated_at: string;
  updated_by: string;
};
export type CareEncounter = {
  id: string;
  patient_id: string;
  kind: "Admission" | "OPD";
  started_on: string;
  closed_on: string | null;
  reason: string;
  owner: string;
  summary: string;
  linked_encounter_id: string | null;
  state: "open" | "closed";
  version: number;
  name?: string;
  mrn?: string;
};
export const finished = [
  "resolved",
  "completed",
  "cancelled",
  "reviewed",
  "discontinued",
  "excluded",
];
export function needsReview(
  entry: Pick<CareEntry, "kind" | "status" | "due_date">,
) {
  return (
    !finished.includes(entry.status) &&
    ((entry.kind !== "problem" && entry.kind !== "medication") ||
      !!entry.due_date)
  );
}
export const stateLabel = (state: string) => state.replaceAll("_", " ");
