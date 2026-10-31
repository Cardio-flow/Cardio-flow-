import { addDays } from "./clinical.js";
import { MEDICATION } from "./catalog.js";
import { PREGNANCY_SOURCE, pregnancyDrugIssue } from "./pregnancy.js";
import type {
  Answers,
  OutcomeItem,
  WizardContext,
  WizardDef,
} from "./wizards.js";

const list = (a: Answers, k: string) =>
  Array.isArray(a[k]) ? (a[k] as string[]) : [];
export const pregnancyUrgent = (a: Answers, c: WizardContext) =>
  a.safety === "urgent" || !!c.pregnancy?.urgent.length;
export function pregnancyOutcomeBlocker(
  wizard: string,
  items: OutcomeItem[],
  c: WizardContext,
  a: Answers = {},
) {
  const p = c.pregnancy;
  if (!p?.eligible) return null;
  if (
    !p.phase &&
    items.some((item) => {
      const code =
        item.kind === "start"
          ? item.code
          : item.kind === "medication" &&
              ["increase", "decrease", "continue"].includes(item.event)
            ? c.meds.find((m) => m.id === item.medicationId)?.code
            : null;
      return (
        code &&
        pregnancyDrugIssue("Pregnant", null, code, MEDICATION[code]?.tags ?? [])
      );
    })
  )
    return "Confirm pregnancy stage before selecting pregnancy-sensitive medication";

  if (
    p.phase === "Pregnant" &&
    [
      "htn-review",
      "htn-resistance",
      "htn-secondary",
      "rdn-plan",
      "after-rdn",
      "severe-hypertension",
    ].includes(wizard)
  )
    return "Use Pregnancy & heart disease for pregnancy-specific BP assessment; elective RDN is not appropriate during pregnancy";
  if (!["Pregnant", "Postpartum"].includes(p.phase ?? "")) return null;
  if (
    p.phase === "Pregnant" &&
    ["diabetes", "diabetes-care", "ramadan"].includes(wizard)
  )
    return "Agree pregnancy-specific glucose targets and medication with the obstetric / diabetes team";
  if (
    [
      "vitamin-d-result",
      "anaemia-result",
      "liver-result",
      "statin-ck-result",
    ].includes(wizard) &&
    (p.phase === "Pregnant" || p.breastfeeding !== "No") &&
    a.scope === "standard"
  )
    return "Recorded pregnancy / breastfeeding requires the specialist treatment scope";
  const ivIron =
    (wizard === "iv-iron" && a.decision === "give") ||
    (wizard === "anaemia-result" &&
      Array.isArray(a.actions) &&
      a.actions.includes("iv"));
  if (
    p.phase === "Pregnant" &&
    ivIron &&
    (p.gestationDays == null || p.gestationDays < 98)
  )
    return "Confirm pregnancy dating: IV iron is not offered during the first trimester; later use needs obstetric agreement";

  for (const item of items) {
    const code =
      item.kind === "start"
        ? item.code
        : item.kind === "medication" &&
            ["increase", "decrease", "continue"].includes(item.event)
          ? c.meds.find((m) => m.id === item.medicationId)?.code
          : null;
    if (!code) continue;
    const d = MEDICATION[code],
      issue = pregnancyDrugIssue(
        p.phase,
        p.breastfeeding,
        code,
        d?.tags ?? [],
        p.gestationDays,
        item.kind === "start"
          ? item.doseValue
          : item.kind === "medication"
            ? item.doseValue
            : null,
      );
    if (issue)
      return `${d?.name ?? code}: ${issue.reason}. Use a documented pregnancy-specific prescribing plan.`;
  }
  return null;
}
export function validatePregnancy(
  a: Answers,
  c: WizardContext,
  dates: Record<string, string> = {},
) {
  const p = c.pregnancy;
  if (!p?.eligible || !p.phase)
    return "Record the pregnancy stage in History → Pregnancy context first";
  const urgent = pregnancyUrgent(a, c);
  if (p.urgent.length && a.safety !== "urgent")
    return "Recorded urgent findings require the urgent pregnancy assessment route";
  if (urgent) {
    if (
      dates[
        "Pregnancy / postpartum: urgent obstetric and cardiac assessment"
      ] &&
      dates[
        "Pregnancy / postpartum: urgent obstetric and cardiac assessment"
      ] !== c.today
    )
      return "Urgent pregnancy assessment must remain today";
    return null;
  }
  const expected =
    p.phase === "Planning pregnancy"
      ? "planning"
      : p.phase === "Pregnant"
        ? "antenatal"
        : "postpartum";
  if (a.focus !== expected)
    return "The care stage changed; update pregnancy context and reopen the plan";
  if (p.needsHeartTeam && !["team", "established"].includes(String(a.care)))
    return "Unknown / elevated mWHO risk or recorded cardiac disease needs Pregnancy Heart Team assessment";
  if (a.care === "established" && (!p.mwho || p.mwho === "Not assessed"))
    return "Record the Heart Team mWHO risk assessment before continuing an established plan";
  if (p.medicationFlags.length && a.medicines === "none")
    return "Review the flagged medicines or arrange specialist changes";
  if (
    (p.mechanical || c.meds.some((m) => m.tags.includes("oac"))) &&
    a.anticoag === "none"
  )
    return "Record a Pregnancy Heart Team anticoagulation strategy; do not interrupt therapeutic cover";
  for (const k of ["tests", "counselling"])
    if (list(a, k).includes("none") && list(a, k).length > 1)
      return `Choose no ${k} or the selected items`;
  if (!a.actionDate || !a.followDate)
    return "Choose exact assessment and follow-up dates";
  if (String(a.followDate) < String(a.actionDate))
    return "Follow-up cannot precede the planned assessment";
  if (a.focus === "antenatal" && a.delivery === "documented" && !a.deliveryMode)
    return "Record the agreed delivery approach";
  if (a.aspirin === "start") {
    if (a.focus !== "antenatal" || !p.aspirinCandidate)
      return "Confirm obstetric dating and pre-eclampsia risk; routine prophylaxis starts from week 12, before week 36";
    if (a.aspirinSafety !== "reviewed")
      return "Confirm obstetric bleeding, allergy and antithrombotic review before aspirin";
    if (c.meds.some((m) => m.tags.includes("oac") || m.tags.includes("p2y12")))
      return "Concurrent anticoagulant / P2Y12 therapy needs an individualized specialist antithrombotic plan";
    if (c.meds.some((m) => m.code === "aspirin"))
      return "Aspirin is already recorded; review its current indication and dose instead of adding another regimen";
    if (![75, 81, 100, 150].includes(Number(a.aspirinDose)))
      return "Choose a guideline-range low aspirin dose";
    if (!a.aspirinDate)
      return "Choose the aspirin indication / stop review date";
  }
  return null;
}
export const PREGNANCY_WIZARDS: Record<string, WizardDef> = {
  "pregnancy-plan": {
    id: "pregnancy-plan",
    title: "Pregnancy & heart disease: care plan",
    shortTitle: "Pregnancy care",
    group: "Pregnancy & heart disease",
    tone: "orange",
    episode: false,
    source:
      "ESC pregnancy 2025 (10.1093/eurheartj/ehaf193), Tables 6, 14–15; sections 4–5, 12.3 and 12.6; correction 2026 (10.1093/eurheartj/ehaf1011).",
    sourceShort: PREGNANCY_SOURCE,
    note: "Review recorded risk and medicines, then confirm one dated maternal / fetal care plan.",
    facts: [
      "sbp",
      "dbp",
      "lvef",
      "creatinine",
      "potassium",
      "platelets",
      "alt",
      "uacr",
    ],
    steps: [
      {
        id: "assessment",
        title: "Safety & care team",
        questions: [
          {
            id: "safety",
            label: "Current safety assessment",
            type: "single",
            required: true,
            options: [
              { value: "stable", label: "Stable after clinical assessment" },
              {
                value: "urgent",
                label: "Urgent obstetric / cardiac assessment",
              },
            ],
          },
          {
            id: "focus",
            label: "Care stage",
            type: "single",
            required: true,
            showIf: { question: "safety", includes: "stable" },
            options: [
              { value: "planning", label: "Pre-pregnancy" },
              { value: "antenatal", label: "During pregnancy" },
              { value: "postpartum", label: "Postpartum" },
            ],
          },
          {
            id: "care",
            label: "Care team",
            type: "single",
            required: true,
            showIf: { question: "safety", includes: "stable" },
            options: [
              { value: "team", label: "Arrange Pregnancy Heart Team review" },
              {
                value: "established",
                label: "Existing Heart Team plan confirmed",
              },
              {
                value: "routine",
                label: "Routine obstetric / cardiology care after risk review",
              },
            ],
          },
          {
            id: "medicines",
            label: "Medication safety",
            type: "single",
            required: true,
            showIf: { question: "safety", includes: "stable" },
            options: [
              { value: "review", label: "Arrange specialist changes / review" },
              {
                value: "documented",
                label: "Specialist medication plan documented",
              },
              { value: "none", label: "No flagged medicines after review" },
            ],
          },
          {
            id: "anticoag",
            label: "Anticoagulation strategy",
            type: "single",
            required: true,
            showIf: { question: "safety", includes: "stable" },
            options: [
              {
                value: "team",
                label: "Pregnancy Heart Team / haematology plan needed",
              },
              {
                value: "documented",
                label: "Trimester, monitoring and delivery plan documented",
              },
              {
                value: "none",
                label: "No anticoagulant indication after assessment",
              },
            ],
          },
        ],
      },
      {
        id: "workup",
        title: "Investigations & birth planning",
        questions: [
          {
            id: "tests",
            label: "Assessment to arrange",
            type: "multi",
            required: true,
            showIf: { question: "safety", includes: "stable" },
            options: [
              { value: "echo", label: "Maternal echo" },
              { value: "ecg", label: "ECG" },
              {
                value: "bloods",
                label: "Pregnancy BP / medication bloods and urine protein",
              },
              { value: "bnp", label: "NT-proBNP (suspected HF)" },
              { value: "fetal", label: "Fetal cardiology / echo referral" },
              { value: "aorta", label: "Complete aortic imaging strategy" },
              { value: "none", label: "No additional tests after review" },
            ],
          },
          {
            id: "delivery",
            label: "Delivery plan",
            type: "single",
            required: true,
            showIf: {
              question: "focus",
              includes: "antenatal",
              and: { question: "safety", includes: "stable" },
            },
            options: [
              {
                value: "needed",
                label: "Agree a multidisciplinary birth plan",
              },
              {
                value: "documented",
                label: "Birth plan documented with obstetrics / anaesthesia",
              },
              {
                value: "early",
                label: "Early pregnancy; review at next appointment",
              },
            ],
          },
          {
            id: "deliveryMode",
            label: "Agreed delivery approach",
            type: "single",
            required: true,
            showIf: {
              question: "delivery",
              includes: "documented",
              and: { question: "safety", includes: "stable" },
            },
            options: [
              {
                value: "vaginal",
                label: "Planned vaginal birth where appropriate",
              },
              {
                value: "caesarean",
                label:
                  "Caesarean for documented obstetric / cardiac indication",
              },
              {
                value: "individual",
                label: "Individualized specialist approach",
              },
            ],
          },
          {
            id: "aspirin",
            label: "Pre-eclampsia prevention",
            type: "single",
            required: true,
            showIf: {
              question: "focus",
              includes: "antenatal",
              and: { question: "safety", includes: "stable" },
            },
            options: [
              { value: "review", label: "Obstetric prophylaxis review" },
              {
                value: "start",
                label: "Prescribe low-dose aspirin after safety checks",
              },
              {
                value: "none",
                label: "No new aspirin; current indication reviewed",
              },
            ],
          },
          {
            id: "aspirinSafety",
            label: "Aspirin safety checks",
            type: "single",
            required: true,
            showIf: {
              question: "aspirin",
              includes: "start",
              and: { question: "safety", includes: "stable" },
            },
            options: [
              {
                value: "reviewed",
                label:
                  "Obstetric bleeding, allergy and antithrombotic review complete",
              },
              { value: "pending", label: "Specialist safety review needed" },
            ],
          },
          {
            id: "aspirinDose",
            label: "Aspirin dose (mg daily at bedtime)",
            type: "single",
            required: true,
            showIf: {
              question: "aspirin",
              includes: "start",
              and: { question: "safety", includes: "stable" },
            },
            options: [75, 81, 100, 150].map((n) => ({
              value: String(n),
              label: `${n} mg`,
            })),
          },
          {
            id: "aspirinDate",
            label: "Aspirin indication / stop review",
            type: "date",
            required: true,
            showIf: {
              question: "aspirin",
              includes: "start",
              and: { question: "safety", includes: "stable" },
            },
          },
          {
            id: "actionDate",
            label: "Assessment / action date",
            type: "date",
            required: true,
            showIf: { question: "safety", includes: "stable" },
          },
        ],
      },
      {
        id: "followup",
        title: "Follow-up & counselling",
        questions: [
          {
            id: "counselling",
            label: "Counselling included in review",
            type: "multi",
            required: true,
            showIf: { question: "safety", includes: "stable" },
            options: [
              {
                value: "choices",
                label: "Shared reproductive choices / contraception",
              },
              { value: "safety", label: "Activity and symptom safety advice" },
              { value: "genetics", label: "Genetic counselling" },
              {
                value: "prevention",
                label: "Long-term cardiovascular prevention",
              },
              {
                value: "none",
                label: "Already covered; no additional counselling",
              },
            ],
          },
          {
            id: "followDate",
            label: "Next clinical review",
            type: "date",
            required: true,
            showIf: { question: "safety", includes: "stable" },
          },
        ],
      },
    ],
    outcome(a, c) {
      const p = c.pregnancy;
      if (!p?.eligible) return [];
      const plan = (
        title: string,
        day: string,
        category: string,
        completesOn: Record<string, unknown>,
      ): OutcomeItem => ({
        kind: "plan",
        title,
        dueDate: day,
        category,
        completesOn,
        label: "",
      });
      if (pregnancyUrgent(a, c))
        return [
          plan(
            "Pregnancy / postpartum: urgent obstetric and cardiac assessment",
            c.today,
            "referral",
            { type: "manual", purpose: "pregnancy-urgent" },
          ),
          {
            kind: "note",
            label:
              "Urgent assessment first. Consider pre-eclampsia, PE, ACS, aortic disease and HF as appropriate; no automatic diagnosis or anticoagulant withdrawal.",
          },
        ];
      const out: OutcomeItem[] = [],
        date = String(a.actionDate ?? ""),
        follow = String(a.followDate ?? "");
      if (a.care === "team")
        out.push(
          plan(
            "Pregnancy Heart Team: integrated assessment and care plan",
            date,
            "referral",
            { type: "manual", purpose: "pregnancy-heart-team" },
          ),
        );
      if (a.medicines === "review" && p.medicationFlags.length)
        out.push(
          plan(
            "Pregnancy: specialist medication safety review",
            date,
            "follow_up",
            { type: "manual", purpose: "pregnancy-medication" },
          ),
        );
      if (p.phase === "Pregnant" && p.hypertensive && !p.severeBp)
        out.push(
          plan(
            "Pregnancy: BP and antihypertensive treatment review",
            date,
            "follow_up",
            { type: "manual", purpose: "pregnancy-bp-review" },
          ),
        );
      if (a.anticoag === "team")
        out.push(
          plan(
            "Pregnancy: trimester, monitoring and delivery anticoagulation plan",
            date,
            "follow_up",
            { type: "manual", purpose: "pregnancy-anticoagulation" },
          ),
        );
      for (const test of list(a, "tests")) {
        if (test === "echo" || test === "ecg")
          out.push(
            plan(
              test === "echo"
                ? "Pregnancy: maternal echocardiogram"
                : "Pregnancy: ECG",
              date,
              "investigation",
              { type: "study", kind: test },
            ),
          );
        if (test === "bloods")
          out.push(
            plan(
              "Pregnancy: BP / medication bloods and urine protein",
              date,
              "monitoring",
              {
                type: "lab",
                codes: [
                  "haemoglobin",
                  "platelets",
                  "creatinine",
                  "potassium",
                  "alt",
                  "ast",
                  "uacr",
                  "urate",
                ],
              },
            ),
          );
        if (test === "bnp")
          out.push(
            plan("Pregnancy: NT-proBNP for HF assessment", date, "monitoring", {
              type: "lab",
              codes: ["nt-probnp"],
            }),
          );
        if (test === "fetal")
          out.push(
            plan(
              "Fetal cardiology: assess / arrange fetal echo",
              date,
              "referral",
              { type: "manual", purpose: "pregnancy-fetal" },
            ),
          );
        if (test === "aorta")
          out.push(
            plan(
              "Pregnancy / aortic team: complete aorta imaging strategy",
              date,
              "referral",
              { type: "manual", purpose: "pregnancy-aorta" },
            ),
          );
      }
      if (
        a.focus === "antenatal" &&
        a.delivery === "needed" &&
        a.care === "routine"
      )
        out.push(
          plan(
            "Pregnancy: multidisciplinary delivery and anaesthesia plan",
            date,
            "follow_up",
            { type: "manual", purpose: "pregnancy-delivery" },
          ),
        );
      if (a.aspirin === "start" && a.focus === "antenatal") {
        out.push({
          kind: "start",
          code: "aspirin",
          doseValue: Number(a.aspirinDose),
          frequency: "OD",
          indication: "Pre-eclampsia prophylaxis",
          label: `Aspirin ${a.aspirinDose} mg nightly: pre-eclampsia prophylaxis`,
        });
        out.push(
          plan(
            "Pregnancy: aspirin indication / stop review (36–37 weeks)",
            String(a.aspirinDate ?? ""),
            "follow_up",
            { type: "manual", purpose: "pregnancy-aspirin" },
          ),
        );
      }
      out.push(
        plan(
          a.focus === "postpartum"
            ? "Postpartum: cardiac recovery, BP and long-term prevention review"
            : a.delivery === "needed"
              ? "Pregnancy: cardiac, results and delivery-plan review"
              : "Pregnancy: maternal cardiac and results review",
          follow,
          "follow_up",
          { type: "manual", purpose: "pregnancy-review" },
        ),
      );
      if (p.phase === "Postpartum")
        out.push({
          kind: "note",
          label: `Postpartum medicines: review lactation (${p.breastfeeding ?? "not recorded"}), maternal recovery and infant monitoring; do not discontinue HF therapy solely because EF recovered.`,
        });
      if (p.phase === "Pregnant" && p.hypertensive && !p.severeBp)
        out.push({
          kind: "note",
          label: "BP above pregnancy target <140/90: confirm paired readings and review pregnancy-compatible antihypertensive treatment with obstetrics. Severe BP ≥160 systolic or ≥110 diastolic requires urgent assessment.",
        });
      if (p.hasHeartFailure)
        out.push({
          kind: "note",
          label:
            "HF / PPCM: specialist assessment of cause, ventricular recovery and pregnancy-compatible therapy. Bromocriptine, anticoagulation and advanced support require an individualized specialist plan.",
        });
      if (list(a, "counselling").includes("genetics"))
        out.push({
          kind: "note",
          label:
            "Genetic and recurrence counselling included; arrange specialist family / fetal assessment where indicated.",
        });
      if (p.congenital && a.focus === "antenatal")
        out.push({
          kind: "note",
          label:
            "Offer fetal echo at 18–22 weeks for parental congenital heart disease; coordinate the actual appointment with obstetrics.",
        });
      if (a.delivery === "documented")
        out.push({
          kind: "note",
          label: `Delivery plan recorded: ${a.deliveryMode}. Confirm site, anaesthesia, haemodynamics and antithrombotic timing with the team.`,
        });
      return out;
    },
    assess(a, c) {
      const p = c.pregnancy;
      return {
        heading: pregnancyUrgent(a, c)
          ? "Urgent pregnancy assessment"
          : "Integrated pregnancy care",
        rows: [
          { label: "Stage", value: p?.phase ?? "Not recorded" },
          { label: "mWHO 2.0", value: p?.mwho ?? "Needs assessment" },
          {
            label: "Care",
            value: pregnancyUrgent(a, c)
              ? "Urgent obstetric / cardiac assessment"
              : a.care === "team"
                ? "Pregnancy Heart Team"
                : "Routine care after risk review",
          },
        ],
        recommendations:
          p?.medicationFlags.map((m) => `${m.name}: ${m.reason}`) ?? [],
      };
    },
  },
};
const S = (value: string, why: string) => ({ value, why });
export const pregnancySuggestions = {
  safety: (_a: Answers, c: WizardContext) =>
    c.pregnancy?.urgent.length
      ? [
          S(
            "urgent",
            "Current recorded red flags need urgent obstetric / cardiac assessment",
          ),
        ]
      : [],
  focus: (_a: Answers, c: WizardContext) =>
    c.pregnancy?.phase
      ? [
          S(
            c.pregnancy.phase === "Planning pregnancy"
              ? "planning"
              : c.pregnancy.phase === "Pregnant"
                ? "antenatal"
                : "postpartum",
            "Recorded pregnancy stage",
          ),
        ]
      : [],
  care: (_a: Answers, c: WizardContext) =>
    c.pregnancy?.needsHeartTeam
      ? [
          S(
            "team",
            "Unknown / elevated mWHO 2.0 risk or recorded cardiac disease: Pregnancy Heart Team",
          ),
        ]
      : [],
  medicines: (_a: Answers, c: WizardContext) =>
    c.pregnancy?.medicationFlags.length
      ? [
          S(
            "review",
            "The current medicine list has pregnancy / lactation review flags",
          ),
        ]
      : [],
  anticoag: (_a: Answers, c: WizardContext) =>
    c.pregnancy?.mechanical ||
    c.dx?.some((d) => ["af", "flutter", "pe"].includes(d)) ||
    c.meds.some((m) => m.tags.includes("oac"))
      ? [
          S(
            "team",
            "An anticoagulant / mechanical valve requires a specific monitored plan; no automatic interruption",
          ),
        ]
      : [],
  tests: (_a: Answers, c: WizardContext) => [
    ...(c.pregnancy?.hypertensive ||
    c.pregnancy?.highRisks.includes("Chronic hypertension")
      ? [
          S(
            "bloods",
            "Pregnancy hypertension: renal, hepatic, blood count and proteinuria assessment",
          ),
        ]
      : []),
    ...(c.pregnancy?.missing.some((m) => m.includes("ventricular"))
      ? [S("echo", "Measured ventricular function is missing")]
      : []),
    ...(c.pregnancy?.aortic
      ? [
          S(
            "aorta",
            "Existing aortic disease needs pregnancy-specific complete-aorta review",
          ),
        ]
      : []),
    ...(c.pregnancy?.congenital
      ? [
          S(
            "fetal",
            "Parental congenital disease: fetal cardiology and echo at 18–22 weeks",
          ),
        ]
      : []),
  ],
  aspirin: (_a: Answers, c: WizardContext) =>
    c.pregnancy?.aspirinCandidate
      ? [
          S(
            "review",
            "One high-risk or two moderate-risk factors: review low-dose aspirin prophylaxis from week 12",
          ),
        ]
      : [],
  aspirinDate: (_a: Answers, c: WizardContext) =>
    c.pregnancy?.edd
      ? [
          S(
            addDays(c.pregnancy.edd, -28),
            "36-week indication / stop review; other aspirin indications require separate assessment",
          ),
        ]
      : [],
  counselling: (_a: Answers, c: WizardContext) => [
    S("choices", "Shared reproductive choices, including contraception"),
    ...(c.pregnancy?.genetic
      ? [S("genetics", "Recorded heritable / congenital disease")]
      : []),
    ...(c.pregnancy?.phase === "Postpartum"
      ? [
          S(
            "prevention",
            "Postpartum cardiovascular prevention and risk-factor review",
          ),
        ]
      : []),
  ],
};
