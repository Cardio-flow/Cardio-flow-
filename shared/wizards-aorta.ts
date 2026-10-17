import type {
  Answers,
  OutcomeItem,
  Question,
  WizardContext,
  WizardDef,
} from "./wizards.js";
import { AORTA_SOURCE } from "./aorta.js";
const choose = (
  id: string,
  label: string,
  items: [string, string][],
  multi = false,
): Question => ({
  id,
  label,
  type: multi ? "multi" : "single",
  required: true,
  ...(["risks", "imaging", "family", "bpCare"].includes(id)
    ? { showIf: { question: "safety", includes: "stable" } }
    : {}),
  ...(multi ? { exclusive: ["none"] } : {}),
  options: items.map(([value, label]) => ({ value, label })),
});
export const aortaUrgent = (a: Answers, c: WizardContext) =>
  a.safety === "acute" || !!c.aorta?.urgent.length;
export function validateAorta(
  a: Answers,
  c: WizardContext,
  dates: Record<string, string> = {},
) {
  if ((c.profile?.age ?? 18) < 18)
    return "Use a paediatric aortic service for children";
  if (aortaUrgent(a, c) && a.strategy !== "urgent")
    return "Possible acute aortic syndrome needs the urgent same-day route";
  if (
    a.strategy === "urgent" &&
    (a.reviewDate !== c.today ||
      Object.values(dates).some((d) => d !== c.today))
  )
    return "Urgent aortic assessment must be dated today";
  if (a.strategy === "urgent") return null;
  if (Array.isArray(a.risks) && a.risks.includes("none") && a.risks.length > 1)
    return "Choose no risk modifiers or the specific findings, not both";
  if (
    ["surveillance", "workup"].includes(String(a.strategy)) &&
    c.aorta?.referral.length
  )
    return "Record an aortic-team strategy for the specialist risk findings";
  if (a.strategy === "surveillance" && c.aorta?.missing.length)
    return "Complete the missing aortic imaging assessment before routine surveillance";
  if (a.strategy !== "urgent" && (a.safety == null || a.safety === "uncertain"))
    return "Assess acute symptoms before confirming an outpatient plan";
  if (a.strategy === "surveillance" && a.imaging === "none")
    return "Choose dated aortic surveillance imaging";
  if (
    a.strategy === "workup" &&
    a.imaging === "tte" &&
    c.aorta?.missing.some((m) => m.startsWith("Complete thoracic"))
  )
    return "Arrange CT / CMR for the missing complete thoracic assessment, or choose a specialist strategy";
  if (a.strategy === "workup" && a.imaging === "none")
    return "Choose the imaging needed to complete the work-up";
  if (
    ["surveillance", "workup"].includes(String(a.strategy)) &&
    (a.risks as string[] | undefined)?.some((v) => v !== "none")
  )
    return "Aortic risk modifiers need a specialist strategy before routine surveillance";
  if (a.family === "not-needed" && c.aorta?.familyRecommended)
    return "Bicuspid / heritable aortic disease or thoracic aneurysm/dissection needs family screening review";
  return null;
}
const plan = (
  category: string,
  title: string,
  dueDate: string,
  completesOn: Record<string, unknown> = { type: "manual" },
): OutcomeItem => ({
  kind: "plan",
  category,
  title,
  dueDate,
  completesOn,
  label: "",
});
export const AORTA_WIZARDS: Record<string, WizardDef> = {
  "aorta-plan": {
    id: "aorta-plan",
    title: "Thoracic aorta: assessment and surveillance",
    shortTitle: "Review aorta",
    group: "Aortic disease",
    tone: "orange",
    episode: false,
    source:
      "ESC PAAD 2024 (10.1093/eurheartj/ehae179) · ACC/AHA aortic disease 2022 (10.1161/CIR.0000000000001106)",
    sourceShort: AORTA_SOURCE,
    note: "Use same-segment comparable measurements. Diameter is one part of the decision; heritable disease, growth, family history, body size and planned valve surgery may justify earlier specialist review.",
    facts: ["sbp", "dbp"],
    steps: [
      {
        id: "risk",
        title: "Safety and aortic risk",
        questions: [
          choose("safety", "Current aortic safety assessment", [
            ["stable", "No acute aortic warning features after assessment"],
            [
              "acute",
              "Acute chest/back pain, malperfusion, collapse or suspected acute aortic syndrome",
            ],
            ["uncertain", "Not yet assessed"],
          ]),
          choose(
            "risks",
            "Aortic risk modifiers reviewed",
            [
              ["none", "None identified after review"],
              [
                "family",
                "Family dissection / sudden death or heritable features",
              ],
              ["growth", "Confirmed rapid growth / measurement concern"],
              [
                "size",
                "Body size / indexed dimensions need specialist assessment",
              ],
              ["pregnancy", "Pregnancy planned / current"],
              [
                "valve",
                "Valve surgery planned: review combined aortic strategy",
              ],
              ["other", "Other risk modifier / uncertainty"],
            ],
            true,
          ),
        ],
      },
      {
        id: "plan",
        title: "Imaging and specialist strategy",
        questions: [
          choose("strategy", "Aortic management route", [
            ["urgent", "Urgent same-day aortic assessment"],
            ["workup", "Complete baseline / missing imaging"],
            [
              "specialist",
              "Aortic-team assessment or documented specialist follow-up",
            ],
            ["surveillance", "Routine surveillance after complete assessment"],
          ]),
          choose("imaging", "Aortic imaging to arrange", [
            ["ct", "Thoracic aortic CT"],
            ["cmr", "Thoracic aortic CMR"],
            ["tte", "TTE aortic / valve surveillance"],
            ["none", "No additional scan before specialist assessment"],
          ]),
          choose("family", "Family / genetics plan", [
            ["screen", "Arrange first-degree relative imaging advice"],
            ["genetics", "Genetic / family aortic clinic review"],
            ["ongoing", "Family screening / genetics already arranged"],
            ["not-needed", "Reviewed: no family screening indication"],
          ]),
          choose("bpCare", "Blood pressure and lifestyle review", [
            [
              "reviewed",
              "BP plan, exercise / lifting advice and smoking reviewed",
            ],
            ["needed", "Arrange BP and lifestyle review"],
          ]),
          {
            id: "reviewDate",
            label: "Assessment / imaging date",
            type: "date",
            required: true,
          },
        ],
      },
    ],
    outcome(a, c) {
      const day = String(a.reviewDate ?? c.today);
      if (a.strategy === "urgent")
        return [
          plan(
            "referral",
            "Thoracic aorta: urgent same-day specialist assessment",
            c.today,
          ),
          {
            kind: "note",
            label:
              "Do not delay emergency assessment for outpatient imaging. Acute imaging and anti-impulse treatment follow the emergency aortic-team protocol.",
          },
        ];
      const out: OutcomeItem[] = [];
      if (c.aorta?.missing.includes("Aortic valve function assessment (TTE)"))
        out.push(
          plan(
            "investigation",
            "Thoracic aorta: TTE valve-function assessment",
            day,
            { type: "study", kind: "echo", requiresReview: true },
          ),
        );
      if (a.imaging && a.imaging !== "none")
        out.push(
          plan(
            "investigation",
            `Thoracic aorta: ${a.imaging === "ct" ? "CT" : a.imaging === "cmr" ? "CMR" : "TTE"} ${a.strategy === "surveillance" ? "surveillance" : "assessment"}`,
            day,
            {
              type: "study",
              kind: "aortic_imaging",
              purpose:
                a.strategy === "surveillance"
                  ? "Surveillance"
                  : "Baseline assessment",
              method:
                a.imaging === "ct" ? "CT" : a.imaging === "cmr" ? "CMR" : "TTE",
              requiresReview: true,
            },
          ),
        );
      if (a.strategy === "specialist")
        out.push(
          plan(
            "referral",
            "Thoracic aorta: aortic-team strategy and result review",
            day,
          ),
        );
      else
        out.push(
          plan(
            "follow_up",
            "Thoracic aorta: imaging and surveillance-plan review",
            day,
            { type: "visit", requiresReview: true },
          ),
        );
      if (a.family === "screen" || a.family === "genetics")
        out.push(
          plan(
            "referral",
            a.family === "genetics"
              ? "Thoracic aorta: genetic counselling and family clinic"
              : "Thoracic aorta: first-degree relative imaging / screening advice",
            day,
          ),
        );
      if (a.bpCare === "needed")
        out.push(
          plan(
            "education",
            "Thoracic aorta: BP, smoking and individualized exercise / lifting advice",
            day,
          ),
        );
      out.push({
        kind: "note",
        label:
          "Review actual imaging before closing surveillance. BAV requires lifelong follow-up; heritable disease and repaired / dissected aorta use a specialist schedule. No medicine or surgery is ordered automatically.",
      });
      return out;
    },
    assess: (a, c) => ({
      heading: "Aortic plan",
      rows: [
        { label: "Route", value: String(a.strategy ?? "Not selected") },
        { label: "Imaging", value: String(a.imaging ?? "Not selected") },
      ],
      recommendations: validateAorta(a, c)
        ? [validateAorta(a, c)!]
        : ["Confirm the dated plan and review the actual results."],
    }),
  },
};
