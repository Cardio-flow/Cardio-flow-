import { diagnosisConflicts } from "../../shared/diagnosis-identity.js";
import { DIAGNOSIS } from "../../shared/catalog.js";
import type { RuleDef } from "./rules.js";
export const DIAGNOSIS_RULES: RuleDef[] = [
  {
    id: "record.diagnosis-conflict",
    kind: "operational",
    title: "Conflicting active diagnoses",
    inputs: ["conditions"],
    defaultParams: {},
    evidence:
      "Record integrity: one active HF phenotype, diabetes type and CKD stage. A clinician explicitly changes or corrects the diagnosis; the earlier versions remain in history.",
    evaluate(s) {
      return diagnosisConflicts(s.conditions).map((group) => ({
        key: group
          .map((c) => c.code)
          .sort()
          .join(":"),
        signature: group
          .map((c) => `${c.logical_id}:${c.code}`)
          .sort()
          .join(":"),
        severity: "orange" as const,
        title: "Reconcile conflicting diagnoses",
        detail:
          group
            .map((c) => DIAGNOSIS[c.code]?.display ?? c.display)
            .join(" / ") +
          " — confirm the current diagnosis and resolve or correct the others.",
        facts: group.map((c) => ({
          label: "Active diagnosis",
          value: c.display,
        })),
        missing: ["Confirmed current diagnosis"],
        action: {
          type: "edit-dx" as const,
          code: group[0].code,
          label: "Review diagnoses",
        },
      }));
    },
  },
];
