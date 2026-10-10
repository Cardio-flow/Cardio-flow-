import {
  structuralEvidenceKey,
  STRUCTURAL_INPUTS,
} from "./structural-evidence.js";
import type { RuleDef, Finding } from "./rules.js";
import { structuralTarget } from "../../shared/structural.js";
const evidence =
  "ESC/EACTS VHD 2025 (10.1093/eurheartj/ehaf194), sections 4.5, 8.2.3, 9.1–9.2, 11.2–11.4, 14.3; current regional device IFU. Heart Team assessment, procedure-specific imaging and follow-up; no automatic drug transition.";
const finding = (
  key: string,
  signature: string,
  title: string,
  detail: string,
  wizard: string,
): Finding => ({
  key,
  signature,
  severity: "blue",
  title,
  detail,
  facts: [{ label: "Reference", value: "ESC/EACTS 2025" }],
  missing: [],
  action: { type: "wizard", wizard },
});
export const STRUCTURAL_RULES: RuleDef[] = [
  {
    id: "structural.preparation",
    kind: "clinical",
    title: "Structural intervention preparation",
    inputs: [
      "plan",
      "studies",
      "procedures",
      "conditions",
      "contexts",
      "pathways",
      "meds",
      ...STRUCTURAL_INPUTS,
    ],
    defaultParams: {},
    evidence,
    evaluate(s) {
      const plan = s.plan.find(
        (p) =>
          p.status === "planned" &&
          p.category === "procedure" &&
          /TAVI|TEER|valve-in-valve|transcatheter valve replacement/i.test(
            p.title,
          ),
      );
      if (!plan) return [];
      if (
        s.procedures.some(
          (p) =>
            p.kind === "valve" &&
            p.attributes.result !== "Aborted / no implant" &&
            new Date(p.performed_at) >= new Date(plan.created_at) &&
            (/TAVI/i.test(plan.title)
              ? p.attributes.procedure === "TAVI"
              : /TEER/i.test(plan.title)
                ? p.attributes.procedure ===
                    "Transcatheter edge-to-edge repair (TEER)" &&
                  (!/Mitral|Tricuspid/i.test(plan.title) ||
                    plan.title.includes(p.attributes.position))
                : [
                    "Valve-in-valve",
                    "Transcatheter valve replacement",
                  ].includes(p.attributes.procedure)),
        )
      )
        return [];
      const wizard = /TAVI/i.test(plan.title)
        ? "tavi-plan"
        : /TEER/i.test(plan.title)
          ? "teer-plan"
          : "other-structural-plan";
      const decision = s.pathwaysDone[wizard];
      const target =
        wizard === "tavi-plan"
          ? "TAVI"
          : wizard === "teer-plan"
            ? (/Tricuspid/i.test(plan.title) && !/Mitral/i.test(plan.title)) ||
              ((!/Mitral|Tricuspid/i.test(plan.title) ||
                /Mitral.*tricuspid/i.test(plan.title)) &&
                s.procedureReviews?.[wizard]?.answers.target === "tricuspid")
              ? "Tricuspid TEER"
              : "Mitral TEER"
            : "Valve-in-valve / other transcatheter valve";
      const report = [...s.studies]
        .reverse()
        .find(
          (st) =>
            st.kind === "structural_imaging" &&
            st.attributes.intervention === target,
        );
      if (
        decision &&
        (wizard !== "teer-plan" ||
          s.procedureReviews?.[wizard]?.answers.target ===
            (target === "Tricuspid TEER" ? "tricuspid" : "mitral")) &&
        (decision >= plan.created_at ||
          plan.decision_id === s.procedureReviews?.[wizard]?.id) &&
        s.procedureReviews?.[wizard]?.answers._planningId ===
          (report?.id ?? null) &&
        s.procedureReviews?.[wizard]?.answers._preparationKey ===
          structuralEvidenceKey(s)
      )
        return [];
      return [
        finding(
          "structural-prep",
          `${plan.id}:${structuralEvidenceKey(s)}:${decision ?? ""}`,
          "Complete TAVI / TEER preparation",
          `${plan.title}: confirm indication, Heart Team agreement and procedure-specific imaging, coronary, renal, bleeding and infection review.`,
          wizard,
        ),
      ];
    },
  },
  {
    id: "structural.aftercare",
    kind: "clinical",
    title: "Structural intervention aftercare",
    inputs: ["procedures", "studies", "pathways", "meds", "plan"],
    defaultParams: {},
    evidence,
    evaluate(s) {
      const actual = [...s.procedures]
        .reverse()
        .find(
          (p) =>
            p.kind === "valve" &&
            p.attributes.result !== "Aborted / no implant" &&
            structuralTarget(p.attributes),
        );
      if (!actual) return [];
      const review = s.procedureReviews?.["after-structural"];
      const echo = [...s.studies].reverse().find((st) => st.kind === "echo");
      const a = review?.answers;
      if (
        a?.safety === "stable" &&
        a._procedureId === actual.id &&
        a._echoId === (echo?.id ?? null) &&
        ["result", "conduction", "protocol", "education"].every(
          (k) => a[k] === "reviewed",
        )
      )
        return [];
      return [
        finding(
          "structural-care",
          `${actual.id}:${echo?.id ?? ""}:${review?.at ?? ""}`,
          `${structuralTarget(actual.attributes)}: review recovery and follow-up`,
          "Review the actual procedural result, residual valve disease, complications, antithrombotic indications, device instructions and dated surveillance. New imaging needs a renewed clinical review.",
          "after-structural",
        ),
      ];
    },
  },
];
