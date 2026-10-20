import { fmtDay } from "../../shared/clinical.js";
import { pregnancyProfile } from "./pregnancy-profile.js";
import type { Finding, RuleDef } from "./rules.js";
import { pregnancyDrugIssue } from "../../shared/pregnancy.js";
import { MEDICATION } from "../../shared/catalog.js";
import type { PatientState } from "../kernel/state.js";

export const PREGNANCY_RULES: RuleDef[] = [
  {
    id: "pregnancy.care",
    kind: "clinical",
    title: "Pregnancy and heart disease: stage-specific care",
    inputs: [
      "conditions",
      "history",
      "contexts",
      "meds",
      "studies",
      "pathways",
      "observations",
      "plan",
    ],
    defaultParams: {},
    evidence:
      "ESC pregnancy 2025 (10.1093/eurheartj/ehaf193; correction 10.1093/eurheartj/ehaf1011): mWHO 2.0 / Heart Team (Table 6), medication review (section 5), hypertension / pre-eclampsia (Tables 14–15, section 12.3), delivery and postpartum planning. Pregnancy BP ≥160 systolic or ≥110 diastolic needs urgent assessment. Aspirin prophylaxis eligibility: one high-risk or two moderate-risk factors, weeks 12–36/37. FDA NSAID pregnancy communication (20/30 weeks); EMA Wegovy 4.6 (pre-conception washout and lactation). No automatic diagnosis or medicine change.",
    evaluate(s) {
      const p = pregnancyProfile(s);
      if (!p.eligible) return [];
      const last = s.procedureReviews?.["pregnancy-plan"];
      const unsafe =
        p.medicationFlags.some((m) => m.avoid) &&
        p.phase !== "Planning pregnancy";
      if (last?.answers._pregnancyKey === p.key && !unsafe) return [];
      return [
        {
          key: "pregnancy",
          signature:
            p.key +
            (unsafe && last?.answers._pregnancyKey === p.key
              ? `:${last.id ?? last.at}`
              : ""),
          severity: p.urgent.length ? "red" : "orange",
          title: p.urgent.length
            ? "Pregnancy / postpartum: urgent assessment needed"
            : unsafe && last?.answers._pregnancyKey === p.key
              ? "Pregnancy medication safety: treatment changes remain outstanding"
              : `${p.phase ?? "Pregnancy context"}: review cardiac care`,
          detail: p.urgent.length
            ? "Immediate obstetric / cardiac assessment; do not delay for routine pathway questions."
            : "One plan for pregnancy risk, medicines, maternal / fetal review, delivery and follow-up.",
          facts: [
            ...(p.phase
              ? [{ label: "Stage", value: p.phase, date: p.at ?? undefined }]
              : []),
            ...(p.mwho ? [{ label: "Recorded mWHO 2.0", value: p.mwho }] : []),
            ...(p.edd
              ? [
                  {
                    label: "Obstetric due date",
                    value: fmtDay(p.edd, { year: true }),
                  },
                ]
              : []),
            ...(p.gestationDays != null && p.gestationDays >= 0
              ? [
                  {
                    label: "Gestation from confirmed dating",
                    value: `${Math.floor(p.gestationDays / 7)} weeks + ${p.gestationDays % 7} days`,
                  },
                ]
              : []),
            ...(p.postpartumDays != null
              ? [
                  {
                    label: "Postpartum",
                    value: `${p.postpartumDays} days after recorded delivery / pregnancy end`,
                  },
                ]
              : []),
            ...p.urgent.map((value) => ({
              label: "Urgent concern",
              value,
              tone: "red" as const,
            })),
            ...(p.phase === "Pregnant" && p.hypertensive && !p.severeBp
              ? [{ label: "BP review", value: "Above pregnancy target <140/90: confirm measurement and arrange dated treatment review" }]
              : []),
            ...p.risks.map((value) => ({ label: "Risk review", value })),
            ...p.medicationFlags.map((m) => ({
              label: m.name,
              value: m.reason,
            })),
          ],
          missing: p.missing,
          action: p.phase
            ? { type: "wizard", wizard: "pregnancy-plan" }
            : { type: "pregnancy-context", label: "Record pregnancy context" },
        },
      ];
    },
  },
];

// Keep acute safety findings. Routine adult prescribing and RDN routes give way to pregnancy-specific care.
export function pregnancyFindingAllowed(
  s: PatientState,
  ruleId: string,
  f: Finding,
) {
  const c = s.conditions.find((c) => c.code === "pregnancy-care"),
    a = c?.attributes;
  if (!c || a?.phase === "Follow-up complete") return true;
  if (
    a?.phase === "Pregnant" &&
    (ruleId.startsWith("htn.") || ruleId.startsWith("rdn."))
  )
    return false;
  if (
    a?.phase === "Pregnant" &&
    ["cardiorenal.ckd-stage", "cardiorenal.stage-review", "dm.glycaemic-control"].includes(ruleId)
  )
    return false;
  if (
    !a?.phase &&
    (f.action.type === "start-med" || f.action.type === "titrate")
  ) {
    const code =
      f.action.type === "start-med"
        ? f.action.code
        : s.meds.find(
            (m) => m.id === (f.action as { medicationId: string }).medicationId,
          )?.code;
    if (
      code &&
      pregnancyDrugIssue("Pregnant", null, code, MEDICATION[code]?.tags ?? [])
    )
      return false;
  }
  if (!["Pregnant", "Postpartum"].includes(a?.phase)) return true;
  const code =
    f.action.type === "start-med"
      ? f.action.code
      : f.action.type === "titrate"
        ? s.meds.find(
            (m) => m.id === (f.action as { medicationId: string }).medicationId,
          )?.code
        : null;
  if (!code) return true;
  const med = MEDICATION[code];
  const issue = pregnancyDrugIssue(
    a?.phase,
    a?.breastfeeding ?? null,
    code,
    med?.tags ?? [],
  );
  return !issue;
}
