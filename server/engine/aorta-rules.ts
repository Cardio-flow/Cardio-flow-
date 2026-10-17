import type { RuleDef } from "./rules.js";
import { aortaProfile } from "./aorta-profile.js";
import { ageOn } from "../../shared/clinical.js";

export const AORTA_RULES: RuleDef[] = [
  {
    id: "aorta.assessment",
    kind: "clinical",
    title: "Thoracic aorta: assessment and surveillance",
    inputs: [
      "studies",
      "conditions",
      "contexts",
      "pathways",
      "meds",
      "sbp",
      "dbp",
    ],
    defaultParams: {},
    evidence:
      "ESC PAAD 2024 (10.1093/eurheartj/ehae179), thoracic aortic disease and BAV Table 68; ACC/AHA aortic disease 2022 (10.1161/CIR.0000000000001106), BAV/family screening and surveillance. Root/ascending ≥55 mm, BAV root phenotype ≥50 mm; arch/descending ≥55 mm prompts specialist assessment. Individualized heritable thresholds; no automatic surgery or prescription.",
    evaluate(s) {
      const p = aortaProfile(s);
      if (
        !p.eligible ||
        ageOn(s.patient.birth_date, s.today) < 18 ||
        s.procedureReviews?.["aorta-plan"]?.answers._aortaKey === p.key
      )
        return [];
      return [
        {
          key: "aorta",
          signature: p.key,
          severity: p.urgent.length ? "red" : "orange",
          title: p.urgent.length
            ? "Aortic report: urgent assessment needed"
            : p.referral.length
              ? "Thoracic aorta: specialist strategy needed"
              : "Thoracic aorta: complete assessment and surveillance",
          detail:
            "Review measured anatomy, risk modifiers, family screening and the dated imaging plan.",
          facts: [
            ...(p.report
              ? [
                  {
                    label: "Aortic report",
                    value: p.report.summary,
                    date: p.report.at,
                  },
                ]
              : []),
            ...p.urgent.map((value) => ({ label: "Reported concern", value })),
            ...p.referral.map((value) => ({
              label: "Specialist review",
              value,
            })),
          ],
          missing: p.missing,
          action: { type: "wizard", wizard: "aorta-plan" },
        },
      ];
    },
  },
];
