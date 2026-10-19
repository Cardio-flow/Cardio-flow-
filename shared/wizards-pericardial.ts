import { localDay } from "./clinical.js";
import type {
  Answers,
  OutcomeItem,
  Question,
  WizardContext,
  WizardDef,
} from "./wizards.js";
import { PERICARDIAL_DOI, PERICARDIAL_SOURCE } from "./pericardial.js";
const currentFever = (c: WizardContext) =>
  !!c.values?.temp &&
  localDay(c.values.temp.at) === c.today &&
  c.values.temp.value > 38;
const stable = { question: "safety", includes: "stable" };
const forType = (value: string) => ({
  ...stable,
  and: { question: "type", includes: value },
});
const forEscalation = (value: string) => ({
  ...stable,
  and: {
    question: "type",
    includes: "pericarditis",
    and: { question: "second", includes: value },
  },
});
const q = (
  id: string,
  label: string,
  items: [string, string][],
  multi = false,
  showIf: Question["showIf"] | null = stable,
): Question => ({
  id,
  label,
  type: multi ? "multi" : "single",
  required: true,
  ...(showIf ? { showIf } : {}),
  ...(multi ? { exclusive: ["none"] } : {}),
  options: items.map(([value, label]) => ({ value, label })),
});
export const pericardialUrgent = (a: Answers, c: WizardContext) =>
  a.safety === "urgent" || !!c.pericardial?.urgent.length;
export function validatePericardial(
  a: Answers,
  c: WizardContext,
  dates: Record<string, string> = {},
) {
  if ((c.profile?.age ?? 18) < 18)
    return "Use a paediatric pericardial service for children";
  if (pericardialUrgent(a, c) && a.route !== "urgent")
    return "Possible tamponade / infection needs urgent same-day assessment";
  if (a.route === "urgent")
    return a.actionDate !== c.today ||
      Object.values(dates).some((d) => d !== c.today)
      ? "Urgent pericardial assessment must be dated today"
      : null;
  if (a.safety !== "stable")
    return "Assess current haemodynamic safety before an outpatient plan";
  for (const k of ["criteria", "highrisk", "tests", "first"]) {
    const v = a[k];
    if (Array.isArray(v) && v.includes("none") && v.length > 1)
      return `Choose none or the specific ${k} findings, not both`;
  }
  if (!a.actionDate || !a.followDate)
    return "Choose exact action and follow-up dates";
  if (String(a.followDate) < String(a.actionDate))
    return "Clinical review cannot precede the planned assessment";
  if (
    (a.tests as string[] | undefined)?.includes("fluid") &&
    !c.pericardial?.drainage
  )
    return "Record actual drainage before requesting linked fluid results";
  if (a.type === "aftercare" && !c.pericardial?.drainage)
    return "Record actual drainage before post-drainage care";
  const first = (a.first as string[] | undefined) ?? [];
  const treating = first.some((v) => v !== "none");
  if (
    treating &&
    (a.type !== "pericarditis" ||
      a.presentation !== "compatible" ||
      ((a.criteria as string[] | undefined) ?? []).filter((v) => v !== "none")
        .length < 2)
  )
    return "Definite clinical pericarditis needs a compatible presentation and at least two supporting findings; otherwise complete specialist assessment";
  if (first.includes("aspirin") && first.includes("nsaid"))
    return "Choose aspirin or an NSAID, not both";
  if (treating && a.drugSafety !== "reviewed")
    return "Confirm renal, hepatic, bleeding, pregnancy and interaction review before treatment suggestions";
  if (first.includes("nsaid") && c.meds.some((m) => m.tags.includes("oac")))
    return "Anticoagulation: obtain an individualized specialist anti-inflammatory strategy";
  if (a.type === "pericarditis" && a.route === "observe")
    return "Pericarditis requires a treatment or specialist assessment strategy";
  const large = (c.pericardial?.report?.attributes.size ?? 0) > 20;
  const high =
    a.type === "pericarditis" &&
    (large ||
      currentFever(c) ||
      a.myocardium === "yes" ||
      (a.highrisk as string[] | undefined)?.some((v) => v !== "none") ||
      c.meds.some((m) => m.tags.includes("oac")));
  if (high && a.route !== "hospital")
    return "High-risk pericarditis requires hospital assessment and a cause search";
  if (
    a.route === "hospital" &&
    (a.actionDate !== c.today ||
      Object.entries(dates).some(
        ([title, d]) =>
          d !== c.today && /hospital|admit|monitored assessment/i.test(title),
      ))
  )
    return "Hospital assessment must be dated today";
  if (a.type === "effusion" && treating)
    return "Effusion alone does not establish inflammatory pericarditis";
  if (
    a.type === "effusion" &&
    a.route === "observe" &&
    (a.symptoms !== "none" ||
      a.inflammation !== "absent" ||
      c.pericardial?.missing.length ||
      c.pericardial?.report?.attributes.inflammation !== "Absent" ||
      a.cause !== "reviewed")
  )
    return "Routine effusion surveillance needs complete haemodynamic / cause assessment and no current symptoms or inflammation";
  if (
    a.route === "drain" &&
    !["symptomatic", "diagnostic", "surgical"].includes(String(a.drainReason))
  )
    return "Record the drainage indication; size alone does not mandate drainage";
  if (
    a.route === "drain" &&
    a.drainReason === "symptomatic" &&
    !["Moderate", "Large"].includes(
      String(
        c.pericardial?.report?.attributes.size != null
          ? c.pericardial.report.attributes.size > 20
            ? "Large"
            : c.pericardial.report.attributes.size >= 10
              ? "Moderate"
              : "Mild"
          : "",
      ),
    )
  )
    return "Symptomatic drainage route needs a reported moderate / large effusion despite medical therapy or a separate diagnostic / surgical indication";
  if (
    ["Suspected", "Confirmed"].includes(
      c.pericardial?.report?.attributes.constriction,
    ) &&
    a.type !== "constriction"
  )
    return "Review the reported constrictive physiology in the constriction route";
  if (
    a.type === "constriction" &&
    !["specialist", "hospital"].includes(String(a.route))
  )
    return "Constrictive physiology requires a pericardial-team strategy";
  if (
    a.type === "constriction" &&
    a.constrictionPlan === "inflammatory" &&
    a.inflammation !== "confirmed"
  )
    return "Anti-inflammatory treatment for constriction needs confirmed inflammation";
  if (
    a.type === "constriction" &&
    a.constrictionPlan === "inflammatory" &&
    a.persistence === "persistent"
  )
    return "Persistent constriction despite medical therapy needs prompt surgical assessment";
  if (
    a.type === "aftercare" &&
    !["specialist", "hospital"].includes(String(a.route))
  )
    return "Post-drainage care requires documented team review";
  if (
    a.type === "pericarditis" &&
    a.route === "medical" &&
    (!first.some((v) => ["aspirin", "nsaid", "colchicine"].includes(v)) ||
      a.presentation !== "compatible")
  )
    return "Confirm a supported treatment plan or select specialist assessment";
  if (a.second === "steroid" && a.infection !== "excluded")
    return "Exclude bacterial / TB infection before a corticosteroid suggestion";
  if (
    a.second === "il1" &&
    (a.episode === "first" ||
      a.refractory !== "yes" ||
      a.inflammation !== "confirmed")
  )
    return "IL-1 escalation needs specialist review of refractory recurrent disease and confirmed inflammation";
  if (a.myocardium === "unknown" && a.route === "medical")
    return "Assess myocardial involvement before routine outpatient treatment";
  return null;
}
const plan = (
  title: string,
  date: string,
  category = "follow_up",
  completesOn: Record<string, unknown> = { type: "manual" },
): OutcomeItem => ({
  kind: "plan",
  title,
  dueDate: date,
  category,
  completesOn,
  label: "",
});
export const PERICARDIAL_WIZARD: WizardDef = {
  id: "pericarditis",
  title: "Pericardial disease: assessment and care",
  shortTitle: "Pericardial plan",
  tone: "orange",
  group: "Inflammatory & infective heart disease",
  episode: false,
  source: `ESC 2025 myocarditis and pericarditis (${PERICARDIAL_DOI}), Tables 4, 10, 16; Figure 16; effusion, tamponade and constriction sections`,
  sourceShort: PERICARDIAL_SOURCE,
  note: "Assess haemodynamics first. Use the reported cause, inflammation and clinical course; confirm treatment and exact dates.",
  facts: [
    "crp",
    "hs-troponin",
    "haemoglobin",
    "wbc",
    "creatinine",
    "egfr",
    "temp",
    "hr",
    "sbp",
  ],
  trend: "crp",
  steps: [
    {
      id: "safety",
      title: "Safety and presentation",
      questions: [
        q(
          "safety",
          "Current haemodynamic safety",
          [
            ["stable", "Stable after assessment"],
            ["urgent", "Suspected tamponade, instability or serious infection"],
            ["unknown", "Not yet assessed"],
          ],
          false,
          null,
        ),
        q("type", "Assessment focus", [
          ["pericarditis", "Acute / recurrent pericarditis"],
          ["effusion", "Effusion without confirmed pericarditis"],
          ["constriction", "Constrictive / effusive-constrictive disease"],
          ["aftercare", "After pericardial drainage"],
        ]),
        q("symptoms", "Current symptoms", [
          ["none", "No current symptoms"],
          ["present", "Persistent / worsening symptoms"],
          ["unknown", "Not yet assessed"],
        ]),
        q(
          "presentation",
          "Compatible pericarditis presentation",
          [
            ["compatible", "Compatible clinical presentation after assessment"],
            ["uncertain", "Uncertain / alternative diagnosis possible"],
          ],
          false,
          forType("pericarditis"),
        ),
        q(
          "criteria",
          "Supporting findings",
          [
            ["rub", "Pericardial rub"],
            ["ecg", "Widespread ST elevation / PR depression"],
            ["crp", "Raised CRP using the laboratory reference"],
            ["effusion", "New / worsening effusion"],
            ["cmr", "CMR pericardial inflammation"],
            ["none", "None confirmed"],
          ],
          true,
          forType("pericarditis"),
        ),
        q(
          "episode",
          "Course",
          [
            ["first", "First episode"],
            ["recurrent", "Recurrence after remission"],
            ["incessant", "Incessant / persistent symptoms"],
          ],
          false,
          forType("pericarditis"),
        ),
        q(
          "myocardium",
          "Myocardial involvement",
          [
            ["no", "Excluded after troponin / LV assessment"],
            ["yes", "Suspected / confirmed myocardial involvement"],
            ["unknown", "Not yet assessed"],
          ],
          false,
          forType("pericarditis"),
        ),
        q(
          "highrisk",
          "Other high-risk features",
          [
            ["none", "None identified after review"],
            ["fever", "Fever >38 °C"],
            ["subacute", "Subacute onset"],
            ["large", "Large effusion (>20 mm), without tamponade"],
            [
              "noresponse",
              "No response after at least 1 week of aspirin / NSAID",
            ],
            ["immuno", "Immunosuppression"],
            ["trauma", "Trauma"],
            ["oac", "Oral anticoagulation"],
          ],
          true,
          forType("pericarditis"),
        ),
      ],
    },
    {
      id: "strategy",
      title: "Management strategy",
      questions: [
        q(
          "route",
          "Management route",
          [
            ["urgent", "Urgent same-day assessment / drainage team"],
            ["hospital", "Same-day hospital assessment"],
            ["medical", "Outpatient pericarditis treatment"],
            ["observe", "Assessed effusion: conservative surveillance"],
            ["drain", "Specialist drainage assessment"],
            ["specialist", "Pericardial team / surgical strategy"],
          ],
          false,
          null,
        ),
        q("cause", "Cause assessment", [
          ["reviewed", "Reviewed / cause-specific care documented"],
          ["needed", "Targeted cause work-up needed"],
        ]),
        q("inflammation", "Inflammation status", [
          ["confirmed", "Confirmed by CRP / imaging in context"],
          ["absent", "No evidence after assessment"],
          ["unknown", "Not yet established"],
        ]),
        q(
          "drainReason",
          "Drainage indication",
          [
            [
              "symptomatic",
              "Symptomatic moderate / large effusion despite medical therapy",
            ],
            ["diagnostic", "Suspected bacterial / malignant disease"],
            [
              "surgical",
              "Purulent effusion / percutaneous drainage not feasible",
            ],
          ],
          false,
          { ...stable, and: { question: "route", includes: "drain" } },
        ),
        q(
          "constrictionPlan",
          "Constrictive disease strategy",
          [
            [
              "diagnostic",
              "Confirm physiology with specialist multimodality assessment",
            ],
            [
              "inflammatory",
              "Inflammatory / potentially transient: supervised medical treatment and reassessment",
            ],
            [
              "surgical",
              "Chronic / persistent: prompt pericardiectomy assessment",
            ],
          ],
          false,
          forType("constriction"),
        ),
        q(
          "persistence",
          "Response to prior constriction treatment",
          [
            ["new", "New / not yet treated"],
            ["responding", "Improving under specialist care"],
            ["persistent", "Persistent despite medical therapy"],
          ],
          false,
          forType("constriction"),
        ),
        {
          id: "actionDate",
          label: "Assessment / action date",
          type: "date",
          required: true,
        },
      ],
    },
    {
      id: "treatment",
      title: "Treatment and tests",
      questions: [
        q(
          "drugSafety",
          "Prescriber safety review",
          [
            [
              "reviewed",
              "Renal, hepatic, bleeding, pregnancy and interactions reviewed",
            ],
            ["needed", "Review needed / contraindication or uncertainty"],
          ],
          false,
          forType("pericarditis"),
        ),
        q(
          "first",
          "First-line suggestions to confirm",
          [
            [
              "aspirin",
              "Aspirin at an anti-inflammatory dose; prescriber sets taper",
            ],
            ["nsaid", "NSAID; prescriber sets dose / taper"],
            [
              "colchicine",
              "Colchicine for 3–6 months or longer; individualized course",
            ],
            ["ppi", "Gastroprotection while using aspirin / NSAID"],
            ["none", "Specialist strategy before drug selection"],
          ],
          true,
          forType("pericarditis"),
        ),
        q(
          "refractory",
          "Colchicine resistance / steroid dependence",
          [
            ["no", "No / not established"],
            ["yes", "Confirmed after adequate therapy and adherence review"],
          ],
          false,
          forEscalation("il1"),
        ),
        q(
          "infection",
          "Bacterial / TB infection",
          [
            ["excluded", "Excluded after appropriate assessment"],
            ["possible", "Possible / not yet excluded"],
          ],
          false,
          forEscalation("steroid"),
        ),
        q(
          "second",
          "Escalation",
          [
            ["none", "No escalation"],
            [
              "steroid",
              "Specialist corticosteroid strategy after first-line failure / contraindication",
            ],
            [
              "il1",
              "Specialist IL-1 inhibitor assessment for refractory recurrence",
            ],
          ],
          false,
          forType("pericarditis"),
        ),
        q(
          "tests",
          "Investigations to arrange",
          [
            ["echo", "Pericardial imaging assessment"],
            ["ecg", "12-lead ECG"],
            ["bloods", "CRP, troponin, FBC, renal function and K"],
            [
              "cmr",
              "CMR: inflammation / myocardial involvement / constriction",
            ],
            ["ct", "CT: anatomy, calcification / targeted cause search"],
            ["fluid", "Fluid results after recorded drainage"],
            ["none", "No additional tests before team review"],
          ],
          true,
        ),
      ],
    },
    {
      id: "follow",
      title: "Dated follow-up",
      questions: [
        {
          id: "followDate",
          label: "Clinical / results review date",
          type: "date",
          required: true,
          showIf: stable,
        },
        q("activity", "Activity and safety advice", [
          ["reviewed", "Activity restriction and return precautions reviewed"],
          ["needed", "Include advice and activity review"],
        ]),
      ],
    },
  ],
  outcome(a, c) {
    const day = String(a.actionDate ?? c.today),
      follow = String(a.followDate ?? day);
    if (a.route === "urgent")
      return [
        plan(
          "Pericardial disease: urgent same-day assessment; tamponade / infection route",
          c.today,
          "referral",
        ),
        {
          kind: "note",
          label:
            "Do not wait for outpatient tests. Unstable tamponade requires immediate drainage by the emergency team; surgical drainage may be needed for purulent effusion or when percutaneous drainage is unsuitable.",
        },
      ];
    const out: OutcomeItem[] = [];
    if (
      c.pericardial?.fluid?.attributes.cytology === "Malignant cells identified"
    )
      out.push(
        plan(
          "Malignant pericardial fluid: cardiology / oncology cause-specific care and recurrence strategy",
          day,
          "referral",
        ),
      );
    if (c.pericardial?.fluid?.attributes.tb === "Positive")
      out.push(
        plan(
          "Positive pericardial TB testing: infectious diseases / pericardial-team treatment review",
          day,
          "referral",
        ),
      );
    if (a.route === "hospital")
      out.push(
        plan(
          "Admit / assess today: high-risk pericardial disease; targeted cause search",
          c.today,
          "referral",
        ),
      );
    if (
      a.route === "specialist" ||
      (a.type === "constriction" && a.route === "hospital")
    )
      out.push(
        plan(
          a.type === "constriction" &&
            (a.constrictionPlan === "surgical" ||
              a.persistence === "persistent")
            ? "Pericardial constriction: prompt pericardiectomy assessment"
            : "Pericardial team: confirm cause-specific strategy",
          day,
          "referral",
        ),
      );
    if (a.route === "drain")
      out.push(
        plan(
          a.drainReason === "surgical"
            ? "Surgical pericardial drainage / window assessment"
            : "Image-guided pericardiocentesis: specialist assessment and drainage",
          day,
          "procedure",
          {
            type: "procedure",
            kind: "pericardiocentesis",
            ...(a.drainReason === "surgical"
              ? { method: "Surgical drainage / window" }
              : {}),
          },
        ),
      );
    if (a.cause === "needed")
      out.push(
        plan(
          "Pericardial disease: targeted cause assessment (infection / TB, renal, thyroid, autoimmune, cancer or cardiac injury as indicated)",
          day,
          "investigation",
        ),
      );
    if (a.type === "pericarditis") {
      const f = (a.first as string[] | undefined) ?? [];
      if (f.includes("aspirin"))
        out.push(
          plan(
            "Pericarditis: prescriber-confirmed anti-inflammatory aspirin and remission-guided taper",
            day,
            "medication",
          ),
        );
      if (f.includes("nsaid"))
        out.push(
          plan(
            "Pericarditis: prescriber-confirmed NSAID and remission-guided taper",
            day,
            "medication",
          ),
        );
      if (f.includes("colchicine"))
        out.push(
          plan(
            "Pericarditis: colchicine course (3–6 months or longer), individualized for episode / renal function; stop last after sustained remission",
            day,
            "medication",
          ),
        );
      if (f.includes("ppi"))
        out.push(
          plan(
            "Gastroprotection with anti-inflammatory aspirin / NSAID",
            day,
            "medication",
          ),
        );
      if (a.second === "steroid")
        out.push(
          plan(
            "Specialist corticosteroid plan: infection excluded; slow remission-guided taper",
            day,
            "referral",
          ),
        );
      if (a.second === "il1")
        out.push(
          plan(
            "Refractory recurrent pericarditis: specialist IL-1 inhibitor assessment",
            day,
            "referral",
          ),
        );
      if (a.myocardium === "yes")
        out.push(
          plan(
            "Myocardial involvement: monitored assessment and myocarditis pathway",
            c.today,
            "referral",
          ),
        );
      out.push(
        plan(
          "Pericarditis: CRP and clinical remission review before taper / return to exercise",
          follow,
          "monitoring",
          { type: "lab", codes: ["crp"], requiresReview: true },
        ),
      );
    }
    const tests = (a.tests as string[] | undefined) ?? [];
    if (tests.includes("echo"))
      out.push(
        plan(
          "Pericardial imaging: size, haemodynamics and physiology",
          day,
          "investigation",
          {
            type: "study",
            kind: "pericardial_imaging",
            method: "TTE",
            purpose:
              a.type === "aftercare"
                ? "After drainage"
                : a.type === "constriction"
                  ? "Constriction assessment"
                  : a.route === "observe"
                    ? "Surveillance"
                    : "Initial assessment",
            requiresReview: true,
            ...(a.type === "aftercare" && c.pericardial?.drainage
              ? { after: c.pericardial.drainage.at.slice(0, 10) }
              : {}),
          },
        ),
      );
    if (tests.includes("ecg"))
      out.push(
        plan("12-lead ECG", day, "investigation", {
          type: "study",
          kind: "ecg",
          requiresReview: true,
        }),
      );
    if (tests.includes("bloods"))
      out.push(
        plan(
          "Pericardial disease: CRP, troponin, FBC, renal function and potassium",
          day,
          "monitoring",
          {
            type: "lab",
            codes: [
              "crp",
              "hs-troponin",
              "haemoglobin",
              "wbc",
              "platelets",
              "creatinine",
              "potassium",
            ],
            requiresReview: true,
          },
        ),
      );
    if (tests.includes("cmr"))
      out.push(
        plan(
          "Pericardial disease: CMR specialist assessment",
          day,
          "investigation",
          {
            type: "study",
            kind: "pericardial_imaging",
            method: "CMR",
            requiresReview: true,
          },
        ),
      );
    if (tests.includes("ct"))
      out.push(
        plan(
          "Pericardial disease: CT specialist assessment",
          day,
          "investigation",
          {
            type: "study",
            kind: "pericardial_imaging",
            method: "CT",
            requiresReview: true,
          },
        ),
      );
    if (tests.includes("fluid") && c.pericardial?.drainage)
      out.push(
        plan(
          "Pericardial fluid: microbiology / cytology and indicated TB results",
          day,
          "investigation",
          {
            type: "study",
            kind: "pericardial_fluid",
            procedureId: c.pericardial.drainage.id,
            requiresReview: true,
          },
        ),
      );
    if (a.type === "aftercare")
      out.push(
        plan(
          "Post-drainage team review: residual / recurrent effusion, drain output and removal, fluid results and cause-directed care",
          follow,
          "follow_up",
          { type: "manual", purpose: "pericardial-review" },
        ),
      );
    if (a.type === "constriction")
      out.push(
        plan(
          a.constrictionPlan === "inflammatory"
            ? "Inflammatory constriction: supervised medical therapy and response / surgical reassessment"
            : "Constrictive physiology: specialist multimodality and surgical strategy review",
          follow,
          "follow_up",
          { type: "manual", purpose: "pericardial-review" },
        ),
      );
    if (!["aftercare", "constriction"].includes(String(a.type)))
      out.push(
        plan(
          "Pericardial disease: clinical and results review",
          follow,
          "follow_up",
          { type: "manual", purpose: "pericardial-review" },
        ),
      );
    if (a.activity === "needed")
      out.push(
        plan(
          "Pericardial disease: activity / return precautions and symptom review",
          day,
          "education",
        ),
      );
    if (a.activity === "reviewed")
      out.push({
        kind: "note",
        label: "Activity restriction and urgent return advice reviewed",
      });
    return out;
  },
};

// Suggestions are reviewable; current safety and diagnostic findings are never assumed from absence.
const S = (value: string, why: string) => ({ value, why });
export const pericardialSuggestions = {
  route: (a: Answers, c: WizardContext) => [
    pericardialUrgent(a, c)
      ? S(
          "urgent",
          "Possible tamponade / serious infection: urgent assessment (ESC 2025)",
        )
      : a.safety !== "stable"
        ? null
        : a.type === "pericarditis" &&
            (a.myocardium === "yes" ||
              (c.pericardial?.report?.attributes.size ?? 0) > 20 ||
              (a.highrisk as string[] | undefined)?.some((v) => v !== "none") ||
              c.meds.some((m) => m.tags.includes("oac")))
          ? S(
              "hospital",
              "High-risk pericarditis: hospital assessment and cause search (ESC 2025)",
            )
          : a.type === "constriction" || a.type === "aftercare"
            ? S("specialist", "Specialist strategy and dated clinical review")
            : null,
  ],
  highrisk: (_a: Answers, c: WizardContext) => [
    currentFever(c) ? S("fever", "Recorded temperature >38 °C") : null,
    c.meds.some((m) => m.tags.includes("oac"))
      ? S("oac", "Current oral anticoagulation")
      : null,
    (c.pericardial?.report?.attributes.size ?? 0) > 20
      ? S("large", "Reported effusion >20 mm")
      : null,
  ],
  first: (a: Answers, c: WizardContext) => {
    if (
      a.presentation !== "compatible" ||
      ((a.criteria as string[] | undefined) ?? []).filter((v) => v !== "none")
        .length < 2 ||
      a.drugSafety !== "reviewed" ||
      c.pericardial?.risks.length
    )
      return [];
    return [
      c.meds.some((m) => m.code === "aspirin")
        ? S(
            "aspirin",
            "Already on aspirin: review anti-inflammatory regimen (ESC 2025)",
          )
        : S(
            "nsaid",
            "Aspirin or NSAID after prescriber safety review (ESC 2025)",
          ),
      S(
        "colchicine",
        "Adjunct colchicine with individualized course and interaction review (ESC 2025)",
      ),
      S("ppi", "Gastroprotection with aspirin / NSAID"),
    ];
  },
  tests: (a: Answers, c: WizardContext) =>
    a.safety !== "stable"
      ? []
      : [
          !c.pericardial?.report ||
          c.pericardial.missing.includes(
            "Post-drainage echo and clinical assessment",
          )
            ? S("echo", "Complete size, haemodynamic and physiology assessment")
            : null,
          a.type === "pericarditis"
            ? S("bloods", "Inflammatory, myocardial, FBC and renal assessment")
            : null,
          a.type === "constriction"
            ? S(
                "cmr",
                "Specialist multimodality assessment of inflammation and physiology",
              )
            : null,
          a.type === "aftercare" &&
          c.pericardial?.missing.includes(
            "Pericardial fluid results and clinical review",
          )
            ? S(
                "fluid",
                "Track the actual drainage sample and review its results",
              )
            : null,
        ],
  actionDate: (a: Answers, c: WizardContext) =>
    a.route === "urgent" || a.route === "hospital"
      ? [
          S(
            c.today,
            "Same-day assessment; urgent care must not wait for outpatient testing",
          ),
        ]
      : [],
};
