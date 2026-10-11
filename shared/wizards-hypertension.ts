import type {
  Answers,
  OutcomeItem,
  Question,
  WizardContext,
  WizardDef,
} from "./wizards.js";
import { addCalendarMonths } from "./af.js";
import { officeHigh, severeBp } from "./hypertension.js";
const source =
  "ESC hypertension 2024 (10.1093/eurheartj/ehae178), sections 5–9; ESC CVD/CKD 2026 (10.1093/eurheartj/ehag098), BP recommendations (official slide 24); ESC/EAPCI RDN consensus 2023 (10.1093/eurheartj/ehad054); Endocrine Society PA 2025 (10.1210/clinem/dgaf284); selected current regional device IFU";
const base = {
  group: "Hypertension" as const,
  tone: "blue" as const,
  episode: false,
  source,
  sourceShort: "ESC 2024/2026 · Endocrine Society 2025",
  facts: [
    "sbp",
    "dbp",
    "abpm-24-sbp",
    "abpm-24-dbp",
    "home-sbp",
    "home-dbp",
    "egfr",
    "potassium",
    "uacr",
  ],
  trend: "sbp",
};
const q = (
  id: string,
  label: string,
  options: [string, string][],
  help?: string,
): Question => ({
  id,
  label,
  type: "single",
  required: true,
  help,
  options: options.map(([value, label]) => ({ value, label })),
});
const check = (id: string, label: string, help?: string) =>
  q(
    id,
    label,
    [
      ["yes", "Confirmed"],
      ["no", "No / not yet"],
      ["unknown", "Unknown"],
    ],
    help,
  );
const when: Question = {
  id: "when",
  label: "Assessment / action date",
  type: "date" as const,
  required: true,
};
const plan = (
  category: string,
  title: string,
  dueDate: string,
  completesOn: Record<string, unknown> = { type: "manual" },
): OutcomeItem => ({
  kind: "plan",
  category:
    (
      {
        review: "follow_up",
        study: "investigation",
        lab: "monitoring",
        "follow-up": "follow_up",
      } as Record<string, string>
    )[category] ?? category,
  title,
  dueDate,
  completesOn,
  label: "",
});
const selected = (a: Answers, id: string, value: string) =>
  (a[id] as string[] | undefined)?.includes(value);
const renal = (date: string) =>
  plan("lab", "Hypertension: renal function and electrolytes", date, {
    type: "lab",
    codes: ["creatinine", "potassium", "sodium"],
  });
const study = (title: string, purpose: string, date: string) =>
  plan("study", title, date, {
    type: "study",
    kind: "hypertension_workup",
    purpose,
  });
export function rdnSchedulingMissing(a: Answers, c: WizardContext): string[] {
  const h = c.hypertension;
  const missing = [...(h?.rdnMissing ?? ["Current hypertension assessment"])];
  if (!h?.anatomy?.suitable)
    missing.push(
      "Recorded specialist-approved renal anatomy and device IFU exclusions",
    );
  for (const [id, label] of [
    ["team", "Multidisciplinary approval"],
    ["consent", "Patient preference and shared risk-benefit decision"],
    ["centre", "Experienced medium-to-high-volume centre"],
    ["protocol", "Periprocedural contrast, medicines and device protocol"],
  ])
    if (a[id] !== "yes") missing.push(label);
  if (a.safety !== "stable")
    missing.push("Stable elective setting; pregnancy excluded");
  return missing;
}
export const HYPERTENSION_WIZARDS: Record<string, WizardDef> = {
  "htn-review": {
    ...base,
    id: "htn-review",
    title: "Hypertension: confirm, target and treatment",
    note: "The record supplies dated BP and medicines. Diagnosis and treatment require clinical confirmation. Pregnancy, acute illness and treatment intolerance need an individualized plan.",
    steps: [
      {
        id: "assessment",
        title: "Confirm BP and risk",
        questions: [
          q(
            "safety",
            "Clinical setting",
            [
              ["stable", "Stable adult outpatient"],
              ["urgent", "Acute symptoms / possible organ damage"],
              ["pregnancy", "Pregnant / pregnancy possible"],
            ],
            "Marked BP elevation requires assessment for acute organ damage; the BP number alone does not diagnose an emergency.",
          ),
          q("confirmation", "BP confirmation", [
            [
              "confirmed",
              "Hypertension confirmed with valid out-of-office or repeated standardized office readings",
            ],
            ["repeat", "Confirmation incomplete"],
            ["whitecoat", "White-coat phenotype: assess before escalating"],
            ["masked", "Masked hypertension confirmed"],
          ]),
          q(
            "risk",
            "Cardiovascular risk",
            [
              ["high", "High risk / established CVD, CKD, diabetes or HMOD"],
              ["low", "Low or moderate risk after formal assessment"],
              ["unknown", "Not assessed"],
            ],
            "Use the appropriate SCORE2 / SCORE2-OP / SCORE2-Diabetes assessment (CKD add-on where appropriate); CardioFlow does not infer a numerical risk score.",
          ),
          {
            ...check(
              "lifestyleTrial",
              "Persistent ≥130/80 after 3 months of lifestyle measures",
              "For CKD with eGFR ≥30, ESC CKD 2026 recommends intensification at confirmed ≥130/80; do not impose a further lifestyle delay.",
            ),
            showIf: { question: "risk", includes: "high" },
          },
          q(
            "target",
            "Treatment target",
            [
              ["standard", "120–129 / 70–79 mmHg if tolerated"],
              [
                "individual",
                "Individualized target / as low as reasonably achievable",
              ],
            ],
            "Individualize for age ≥85, substantial frailty, symptomatic orthostasis, limited lifespan, advanced CKD or poor tolerance. Diagnostic thresholds are different from treatment targets.",
          ),
        ].map((question) =>
          question.id === "safety"
            ? question
            : {
                ...question,
                showIf: { question: "safety", includes: "stable" },
              },
        ),
      },
      {
        id: "plan",
        title: "Choose the dated plan",
        questions: [
          {
            id: "actions",
            label: "Actions",
            type: "multi" as const,
            required: true,
            options: [
              { value: "lifestyle", label: "Lifestyle and adherence support" },
              { value: "abpm", label: "ABPM confirmation" },
              { value: "home", label: "Home BP log" },
              {
                value: "baseline",
                label:
                  "Baseline renal / electrolyte / urine and organ-damage assessment",
              },
              {
                value: "medication",
                label: "Initiate / optimize medicines after clinical review",
              },
              {
                value: "secondary",
                label: "Secondary cause / aldosteronism assessment",
              },
              {
                value: "annual",
                label: "Annual urine ACR / renal risk surveillance",
              },
              {
                value: "none",
                label: "Continue agreed treatment; routine follow-up",
              },
            ],
          },
          when,
          {
            id: "reviewDate",
            label: "BP / tolerance follow-up date",
            type: "date" as const,
            required: true,
          },
        ].map((question) => ({
          ...question,
          showIf: { question: "safety", includes: "stable" },
        })),
      },
    ],
    assess(a, c) {
      const h = c.hypertension;
      return {
        heading: "Hypertension management",
        rows: [
          {
            label: "Dated BP phenotype",
            value: h?.phenotype ?? "Confirmation incomplete",
          },
          {
            label: "Target",
            value:
              a.target === "standard"
                ? "120–129 / 70–79 if tolerated"
                : "Individualized by clinician",
          },
        ],
        recommendations:
          a.safety !== "stable"
            ? [
                a.safety === "pregnancy"
                  ? "Use pregnancy-specific specialist care and review fetal-toxic medicines."
                  : "Assess acute organ damage now; use the hypertensive emergency pathway if confirmed.",
              ]
            : [
                "Confirmed hypertension warrants prompt lifestyle and pharmacological management. Prefer a tolerated low-dose combination of RAS blocker, dihydropyridine CCB and/or thiazide-like diuretic; avoid ACEi + ARB.",
                "For elevated BP, high-risk treatment after a 3-month lifestyle trial depends on confirmed ≥130/80. Review orthostasis, renal function, potassium and comorbid indications before changing medicines.",
                ...(c.dx?.includes("ckd")
                  ? [
                      h?.egfr != null && h.egfr >= 30
                        ? "ESC CKD 2026: intensify lifestyle / BP therapy at confirmed ≥130/80; aim for systolic 120–129 if tolerated. Prioritize an appropriate ACEi or ARB and review albuminuria / renal risk."
                        : "ESC CKD 2026: with eGFR <30, agree an individualized BP target with nephrology.",
                    ]
                  : []),
                ...(h?.phenotype === "White-coat phenotype"
                  ? [
                      "Do not infer resistant hypertension or escalate solely from office BP.",
                    ]
                  : []),
                ...(severeBp(h?.office ?? null)
                  ? [
                      "Marked elevation: same-day assessment for acute organ damage.",
                    ]
                  : []),
              ],
      };
    },
    outcome(a, c) {
      if (a.safety !== "stable")
        return [
          plan(
            "review",
            a.safety === "pregnancy"
              ? "Pregnancy hypertension: urgent specialist medication review"
              : "Marked BP / acute symptoms: assess organ damage now",
            c.today,
          ),
        ];
      const d = String(a.when),
        out: OutcomeItem[] = [];
      if (selected(a, "actions", "lifestyle"))
        out.push(
          plan(
            "review",
            "Hypertension: salt, exercise, weight, alcohol and adherence plan",
            d,
          ),
        );
      if (selected(a, "actions", "abpm"))
        out.push(
          plan("study", "Hypertension: ABPM confirmation", d, {
            type: "study",
            kind: "abpm",
          }),
        );
      if (selected(a, "actions", "home"))
        out.push(
          plan("study", "Hypertension: home BP log", d, {
            type: "study",
            kind: "home_bp",
          }),
        );
      if (selected(a, "actions", "baseline"))
        out.push(
          renal(d),
          plan("lab", "Hypertension: urine albumin-to-creatinine ratio", d, {
            type: "lab",
            codes: ["uacr"],
          }),
          plan(
            "review",
            "Hypertension: ECG, orthostatic BP and organ-damage assessment",
            d,
          ),
        );
      if (selected(a, "actions", "medication"))
        out.push(
          plan(
            "review",
            "Hypertension: clinician-led medication initiation / optimization",
            d,
          ),
        );
      if (selected(a, "actions", "secondary"))
        out.push(
          study(
            "Hypertension: secondary cause review",
            "Secondary hypertension review",
            d,
          ),
        );
      if (
        ((a.confirmation === "confirmed" &&
          officeHigh(c.hypertension?.office ?? null)) ||
          (a.confirmation === "masked" &&
            c.hypertension?.office &&
            !officeHigh(c.hypertension.office))) &&
        c.hypertension?.outside?.valid &&
        c.hypertension.outside.high
      )
        out.push({
          kind: "condition",
          code: "htn",
          attributes: {},
          label: "Hypertension confirmed by clinician",
        });
      if (selected(a, "actions", "annual"))
        out.push(
          plan(
            "lab",
            "Hypertension: annual urine ACR",
            addCalendarMonths(c.today, 12),
            { type: "lab", codes: ["uacr"] },
          ),
          ...(c.dx?.some((t) => ["ckd", "dm"].includes(t))
            ? [renal(addCalendarMonths(c.today, 12))]
            : []),
        );
      out.push(
        plan(
          "follow-up",
          "Hypertension: BP, orthostasis and treatment tolerance review",
          String(a.reviewDate),
          { type: "visit" },
        ),
      );
      return out;
    },
  },
  "htn-resistance": {
    ...base,
    id: "htn-resistance",
    title: "Resistant hypertension: verify and optimize",
    tone: "orange",
    note: "Combination tablets count by their component classes. Held / not-taken medicines and inadequate doses do not prove resistance. New BP, medicines or screening results require renewed confirmation.",
    steps: [
      {
        id: "verify",
        title: "Exclude pseudo-resistance",
        questions: [
          q("basis", "Clinical pathway", [
            [
              "resistant",
              "Uncontrolled despite RAS blocker + CCB + appropriate diuretic",
            ],
            [
              "alternative",
              "High CVD risk; fewer drugs because of documented intolerance",
            ],
            ["unconfirmed", "Resistance not confirmed"],
          ]),
          check(
            "technique",
            "Standardized office technique and valid ABPM / HBPM on this regimen",
          ),
          check(
            "adherence",
            "Adherence verified",
            "Medication reconciliation plus a reliable adherence assessment; consider objective testing where available.",
          ),
          check(
            "doses",
            "Maximum or maximally tolerated component doses confirmed",
            "When eGFR <30, adequately titrated loop diuretic is necessary to establish resistance.",
          ),
          check(
            "lifestyle",
            "Lifestyle and BP-raising medicines / substances addressed",
          ),
          {
            ...check(
              "risk",
              "Specialist confirms increased cardiovascular risk",
            ),
            showIf: { question: "basis", includes: "alternative" },
          },
          {
            ...check(
              "intolerance",
              "Multiple medication intolerance / non-adherence barrier documented and reviewed",
            ),
            showIf: { question: "basis", includes: "alternative" },
          },
        ],
      },
      {
        id: "plan",
        title: "Optimize and arrange review",
        questions: [
          q("decision", "Next step", [
            ["optimize", "Optimize regimen / adherence"],
            ["specialist", "Hypertension specialist review"],
            ["continue", "Continue agreed treatment and reassess"],
          ]),
          when,
          {
            id: "reviewDate",
            label: "BP / renal and potassium review date",
            type: "date" as const,
            required: true,
          },
        ],
      },
    ],
    assess(a, c) {
      const h = c.hypertension;
      const eligibleMra =
        h?.egfr != null &&
        h.egfr >= 30 &&
        h.potassium != null &&
        h.potassium <= 4.5;
      return {
        heading: "Resistance assessment",
        rows: [
          { label: "BP phenotype", value: h?.phenotype ?? "Unknown" },
          {
            label: "Core triple regimen",
            value: h?.triple
              ? "Present; dose / adherence confirmation still required"
              : "Incomplete",
          },
          {
            label: "Renal function / potassium",
            value: `eGFR ${h?.egfr ?? "missing"} · K ${h?.potassium ?? "missing"}`,
          },
        ],
        recommendations: [
          "Confirm true resistance before intervention. Refer suspected resistance to a specialist and evaluate secondary causes.",
          eligibleMra
            ? "Low-dose spironolactone can be considered as the next drug after full safety / interaction review; monitor renal function and electrolytes soon after changes."
            : "Spironolactone for resistant hypertension is not suggested without eGFR ≥30 and K ≤4.5; review alternatives with the specialist.",
          "RDN is a conditional BP-lowering option, not first-line therapy. Its clinical criteria, anatomy, centre, patient preference and multidisciplinary decision all need confirmation.",
        ],
      };
    },
    outcome(a) {
      const d = String(a.when);
      return [
        plan(
          "review",
          a.decision === "specialist"
            ? "Resistant hypertension: specialist assessment"
            : "Hypertension: dose, adherence and regimen optimization",
          d,
        ),
        renal(String(a.reviewDate)),
        plan(
          "follow-up",
          "Resistant hypertension: BP and treatment tolerance review",
          String(a.reviewDate),
          { type: "visit" },
        ),
      ];
    },
  },
  "htn-secondary": {
    ...base,
    id: "htn-secondary",
    title: "Secondary hypertension: screening and results",
    note: "Screen according to the patient's clues. The 2025 Endocrine Society conditionally suggests aldosteronism screening in all hypertensive adults. Positive screening requires clinical interpretation; no automatic diagnosis or medicine withdrawal.",
    steps: [
      {
        id: "screen",
        title: "Choose targeted investigations",
        questions: [
          {
            id: "clues",
            label: "Clinical clues",
            type: "multi" as const,
            options: [
              { value: "young", label: "Onset before age 40" },
              { value: "resistant", label: "Apparent resistance" },
              {
                value: "potassium",
                label: "Hypokalaemia / adrenal incidentaloma",
              },
              { value: "renal", label: "Kidney disease / abnormal urine" },
              {
                value: "renovascular",
                label:
                  "Renal bruit, flash pulmonary oedema or abrupt renal decline",
              },
              {
                value: "osa",
                label: "Snoring, apnoeas, obesity or non-dipping",
              },
              {
                value: "adrenergic",
                label: "Episodic headache, sweating and palpitations",
              },
              { value: "cushing", label: "Cushing features" },
              { value: "thyroid", label: "Thyroid features" },
              { value: "calcium", label: "Hypercalcaemia" },
              { value: "coarctation", label: "Arm-leg BP / pulse discrepancy" },
              {
                value: "drugs",
                label: "BP-raising medicines / substances or sudden worsening",
              },
            ],
          },
          q(
            "paAction",
            "Primary aldosteronism screen",
            [
              [
                "screen",
                "Arrange aldosterone, renin / ARR and concurrent potassium",
              ],
              [
                "repeat",
                "Repeat an unreliable / negative high-suspicion screen",
              ],
              [
                "refer",
                "Positive screen: endocrinology / hypertension referral",
              ],
              [
                "reviewed",
                "Interpretable results reviewed; no repeat indicated",
              ],
              ["defer", "Defer after shared decision / resource review"],
            ],
            "Morning seated sample, no sodium restriction before screening. Correct low potassium and interpret drug effects, assay and units. Never stop medicines automatically.",
          ),
          {
            id: "tests",
            label: "Other investigations indicated",
            type: "multi" as const,
            options: [
              {
                value: "renal",
                label:
                  "Creatinine / eGFR, electrolytes, urine ACR / dipstick and renal ultrasound",
              },
              {
                value: "renovascular",
                label: "Renal artery Doppler / CTA / MRA",
              },
              { value: "osa", label: "Sleep study" },
              {
                value: "adrenergic",
                label: "Plasma free or urinary fractionated metanephrines",
              },
              {
                value: "cushing",
                label: "Specialist cortisol / suppression testing",
              },
              { value: "thyroid", label: "TSH" },
              { value: "calcium", label: "Calcium, phosphate and PTH" },
              { value: "coarctation", label: "Echo / aortic imaging" },
              {
                value: "drugs",
                label:
                  "Medicines, supplements, liquorice, stimulants and alcohol review",
              },
            ],
          },
        ],
      },
      {
        id: "review",
        title: "Review results and disposition",
        questions: [
          q("disposition", "Results / referral", [
            ["workup", "Work-up pending; arrange result review"],
            ["cause", "Cause identified; specialist cause-specific care"],
            ["clear", "Completed specialist work-up: no cause identified"],
            ["defer", "Defer with documented clinical decision"],
          ]),
          when,
        ],
      },
    ],
    assess(a, c) {
      const h = c.hypertension;
      return {
        heading: "Secondary hypertension plan",
        rows: [
          {
            label: "Clues from the record",
            value:
              h?.secondaryClues.join(" · ") ||
              "No automatic clue; review symptoms and onset",
          },
          {
            label: "Aldosteronism screen",
            value: h?.pa
              ? `${h.pa.result} · ${h.pa.reliable ? "interpretable" : "needs interference review"}`
              : "Not recorded",
          },
          {
            label: "Specialist conclusion",
            value: h?.secondary?.result ?? "Not recorded",
          },
        ],
        recommendations: [
          "Target other endocrine / renal / sleep / vascular investigations to clinical clues. Normal potassium does not exclude primary aldosteronism.",
          "A positive ARR leads to specialist assessment of repeat or suppression testing and, when indicated, subtype evaluation; it does not automatically authorize adrenal imaging, adrenal vein sampling or surgery.",
          "RDN remains blocked by secondary hypertension or incomplete exclusion.",
        ],
      };
    },
    outcome(a, c) {
      const d = String(a.when),
        out: OutcomeItem[] = [];
      if (["screen", "repeat"].includes(String(a.paAction)))
        out.push(
          study(
            a.paAction === "repeat"
              ? "Repeat aldosterone / renin / ARR with potassium and interference review"
              : "Aldosterone / renin / ARR with concurrent potassium",
            "Primary aldosteronism screen",
            d,
          ),
        );
      if (a.paAction === "refer")
        out.push(
          plan(
            "review",
            "Positive aldosteronism screen: endocrinology / hypertension specialist",
            d,
          ),
        );
      if (selected(a, "tests", "renal"))
        out.push(
          renal(d),
          plan("lab", "Secondary hypertension: urine ACR", d, {
            type: "lab",
            codes: ["uacr"],
          }),
          plan(
            "review",
            "Secondary hypertension: urine dipstick and renal ultrasound",
            d,
          ),
        );
      for (const [id, title] of [
        ["renovascular", "Renal artery Doppler / CTA / MRA"],
        ["osa", "Sleep apnoea assessment / sleep study"],
        ["adrenergic", "Plasma / urinary fractionated metanephrines"],
        ["cushing", "Specialist cortisol / suppression testing"],
        ["calcium", "Calcium, phosphate and PTH assessment"],
        ["coarctation", "Arm-leg BP / pulses and echo / aortic imaging"],
        ["drugs", "BP-raising medicine and substance review"],
      ])
        if (selected(a, "tests", id))
          out.push(plan("review", `Secondary hypertension: ${title}`, d));
      if (selected(a, "tests", "thyroid"))
        out.push(
          plan("lab", "Secondary hypertension: TSH", d, {
            type: "lab",
            codes: ["tsh"],
          }),
        );
      if (a.disposition === "workup")
        out.push(
          study(
            "Secondary hypertension: specialist results review",
            "Secondary hypertension review",
            d,
          ),
        );
      if (a.disposition === "cause")
        out.push(
          plan(
            "review",
            `Secondary hypertension: cause-specific specialist care${c.hypertension?.secondary ? " — see recorded report" : ""}`,
            d,
          ),
        );
      return out.length
        ? out
        : [
            {
              kind: "note",
              label:
                "Screening results / shared decision reviewed; no additional tests selected",
            },
          ];
    },
  },
  "rdn-plan": {
    ...base,
    id: "rdn-plan",
    title: "Renal denervation: eligibility and preparation",
    sourceShort: "ESC 2024 · ESC/EAPCI 2023 · IFU",
    note: "Schedule only after every recorded clinical and anatomical criterion is met. ESC resistant-hypertension recommendation IIb B; high-risk fewer-drug alternative IIb A. Benefit is BP lowering; cardiovascular outcome benefit remains unproven.",
    steps: [
      {
        id: "eligibility",
        title: "Confirm specialist approval",
        questions: [
          q("safety", "Elective RDN setting", [
            ["stable", "Stable adult; pregnancy excluded"],
            ["concern", "Pregnancy / acute illness / safety concern"],
          ]),
          check("team", "Multidisciplinary hypertension / RDN approval"),
          check(
            "consent",
            "Patient preference after shared risk-benefit discussion",
            "Discuss variable BP response, procedural risks, alternatives, ongoing medicines and lack of proven cardiovascular outcome benefit.",
          ),
          check("centre", "Medium-to-high-volume experienced RDN centre"),
          check(
            "protocol",
            "Exact device IFU, contrast / renal, medication and peri-procedure protocol reviewed",
          ),
        ],
      },
      {
        id: "plan",
        title: "Date the agreed next step",
        questions: [
          q("decision", "RDN decision", [
            ["workup", "Complete specialist work-up / imaging"],
            ["schedule", "All criteria met: schedule RDN"],
            ["defer", "Defer RDN; optimize treatment"],
          ]),
          when,
        ],
      },
    ],
    assess(a, c) {
      const missing = rdnSchedulingMissing(a, c);
      return {
        heading: missing.length
          ? "RDN preparation incomplete"
          : "RDN may be considered",
        rows: [
          {
            label: "Eligibility",
            value: missing.length
              ? missing.join(" · ")
              : "All current checks confirmed",
            tone: missing.length ? "orange" : "green",
          },
        ],
        recommendations: [
          "Exclude secondary causes, confirm out-of-office BP and adherence / optimized medicines. RDN is not first-line and is not recommended with eGFR <40 or secondary hypertension.",
          "Device anatomy and contraindications follow the exact current regional IFU. No automatic antithrombotic or antihypertensive changes.",
        ],
      };
    },
    outcome(a, c) {
      if (a.decision === "schedule" && !rdnSchedulingMissing(a, c).length)
        return [
          plan("procedure", "Renal denervation (RDN)", String(a.when), {
            type: "procedure",
            kind: "rdn",
          }),
        ];
      return [
        plan(
          "review",
          a.decision === "defer"
            ? "Hypertension: alternative treatment / deferred RDN review"
            : "RDN: specialist eligibility and preparation review",
          String(a.when),
        ),
        ...(a.decision === "workup" && !c.hypertension?.anatomy?.suitable
          ? [
              study(
                "RDN: renal artery anatomy and device IFU assessment",
                "RDN anatomical assessment",
                String(a.when),
              ),
            ]
          : []),
      ];
    },
  },
  "after-rdn": {
    ...base,
    id: "after-rdn",
    title: "After renal denervation: recovery and BP follow-up",
    note: "Read the actual procedure report. Continue medicines unless the clinician explicitly changes them; BP response may evolve over months. Follow the centre's current device protocol.",
    steps: [
      {
        id: "recovery",
        title: "Recovery review",
        questions: [
          q("safety", "Recovery status", [
            [
              "stable",
              "Stable; no unresolved access, renal or vascular complication",
            ],
            ["urgent", "Complication / urgent concern"],
          ]),
          check(
            "meds",
            "Medication reconciliation and ongoing BP therapy reviewed",
          ),
          check(
            "education",
            "Home BP technique, access care and red flags explained",
          ),
          {
            id: "renalDate",
            label: "Renal function / electrolyte check date",
            type: "date" as const,
            required: true,
          },
          {
            id: "bpDate",
            label: "ABPM / HBPM response assessment date",
            type: "date" as const,
            required: true,
          },
          q("monitor", "BP follow-up method", [
            ["abpm", "ABPM"],
            ["home_bp", "HBPM"],
          ]),
          {
            id: "reviewDate",
            label: "Specialist follow-up date",
            type: "date" as const,
            required: true,
          },
        ],
      },
    ],
    assess(a, c) {
      return {
        heading: "RDN aftercare",
        rows: [
          {
            label: "Actual procedure",
            value: c.hypertension?.actual
              ? `${c.hypertension.actual.result} · ${c.hypertension.actual.at.slice(0, 10)}`
              : "Not recorded",
          },
        ],
        recommendations: [
          "Review renal / access complications, BP trend and orthostasis before reducing medicines. Continue ongoing BP and risk-factor care; further surveillance follows the specialist and device protocol.",
        ],
      };
    },
    outcome(a, c) {
      if (a.safety === "urgent")
        return [
          plan(
            "review",
            "RDN complication: urgent specialist assessment",
            c.today,
          ),
        ];
      return [
        renal(String(a.renalDate)),
        plan(
          "study",
          "RDN: out-of-office BP response assessment",
          String(a.bpDate),
          { type: "study", kind: String(a.monitor) },
        ),
        plan(
          "follow-up",
          "RDN: specialist recovery, BP and treatment review",
          String(a.reviewDate),
          { type: "visit" },
        ),
      ];
    },
  },
};
