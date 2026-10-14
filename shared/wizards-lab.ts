import type {
  Answers,
  WizardContext,
  WizardDef,
  Question,
  OutcomeItem,
} from "./wizards.js";
import { LAB_LIMITS as L, LAB_SOURCES, ratio } from "./lab-review.js";
import { addDays } from "./clinical.js";
import { IRON_CHECKS, ironOutcome } from "./wizards-iron.js";
const includes = (a: Answers, k: string, v: string) =>
  Array.isArray(a[k]) ? (a[k] as string[]).includes(v) : a[k] === v;
const red = (a: Answers) =>
  ((a.redflags as string[]) ?? []).some((v) => v !== "none");
const base = {
  group: "Procedures & general medicine" as const,
  tone: "yellow" as const,
  episode: false,
};
const flags = (options: { value: string; label: string }[]): Question => ({
  id: "redflags",
  label: "Urgent symptoms now",
  type: "multi",
  required: true,
  options: [{ value: "none", label: "None" }, ...options],
});
const scope: Question = {
  id: "scope",
  label: "Adult treatment scope",
  type: "single",
  required: true,
  options: [
    { value: "standard", label: "Adult, not pregnant / breastfeeding" },
    {
      value: "specialist",
      label: "Pregnancy, breastfeeding or specialist dosing required",
    },
  ],
};
const follow = (title: string): Question => ({
  id: "recheck",
  label: title,
  type: "single",
  required: true,
  options: [
    { value: "0", label: "Today" },
    { value: "7", label: "1 week" },
    { value: "14", label: "2 weeks" },
    { value: "28", label: "4 weeks" },
    { value: "42", label: "6 weeks" },
  ],
});
const plan = (
  c: WizardContext,
  title: string,
  category = "monitoring",
  codes?: string[],
  days = 0,
): Extract<OutcomeItem, { kind: "plan" }> => ({
  kind: "plan",
  title,
  category,
  dueDate: addDays(c.today, days),
  completesOn: codes ? { type: "lab", codes } : { type: "manual" },
  label: "",
});
const activeStatins = (c: WizardContext) =>
  c.meds.filter((m) => m.tags.includes("statin") && m.status !== "held");
const canTreat = (a: Answers) => a.scope === "standard" && !red(a);
export function hfIronReview(c: WizardContext) {
  const l = c.lab ?? {},
    f = l.ferritin,
    t = l.tsat;
  return (
    (c.dx ?? []).includes("hf") &&
    l.lvef?.value < 50 &&
    !!f &&
    !!t &&
    (f.value < 100 || (f.value < 300 && t.value < 20))
  );
}
export const LAB_WIZARDS: Record<string, WizardDef> = {
  "vitamin-d-result": {
    ...base,
    id: "vitamin-d-result",
    title: "Vitamin D: replacement & monitoring",
    source: LAB_SOURCES.vitamin,
    sourceShort: "NICE · Endocrine Society 2024 · NHS",
    note: "Treat an existing low result. Routine screening in healthy adults and a universal prevention target are not recommended. Loading doses use a time-limited, checked prescription.",
    facts: ["vitamin-d", "calcium", "egfr"],
    trend: "vitamin-d",
    recheck: {
      title: "Vitamin D treatment: calcium and prescription review",
      codes: ["calcium"],
    },
    steps: [
      {
        id: "assessment",
        title: "Safety & treatment phase",
        questions: [
          scope,
          flags([
            {
              value: "calcium",
              label: "Hypercalcaemia symptoms / toxicity concern",
            },
          ]),
          {
            id: "safety",
            label: "Calcium, kidneys and supplements checked",
            type: "single",
            required: true,
            options: [
              {
                value: "safe",
                label:
                  "Calcium normal; no renal / stone / granulomatous concerns; supplements reconciled",
              },
              {
                value: "uncertain",
                label:
                  "Missing results or a contraindication / specialist concern",
              },
            ],
          },
          {
            id: "phase",
            label: "Replacement phase",
            type: "single",
            required: true,
            options: [
              {
                value: "new",
                label: "New deficiency / replacement not completed",
              },
              {
                value: "maintenance",
                label:
                  "Loading / replacement completed; maintenance prescription appropriate",
              },
            ],
          },
        ],
      },
      {
        id: "plan",
        title: "Suggested treatment & follow-up",
        questions: [
          {
            id: "actions",
            label: "Actions",
            type: "multi",
            required: true,
            options: [
              {
                value: "protocol",
                label: "Plan checked, time-limited replacement prescription",
              },
              {
                value: "maintenance",
                label: "Colecalciferol 800 IU daily maintenance",
                hint: "Only after replacement is complete and safety is confirmed",
              },
              {
                value: "tests",
                label: "Check adjusted calcium and renal function",
              },
              {
                value: "specialist",
                label: "Specialist vitamin D / mineral-bone review",
              },
              {
                value: "defer",
                label: "Document clinical review without medicine change",
              },
            ],
          },
          {
            id: "replacementEnd",
            label: "Replacement end / maintenance review date",
            type: "date",
            required: true,
            showIf: { question: "actions", includes: "protocol" },
          },
          follow("Calcium / prescription review"),
        ],
      },
    ],
    outcome(a, c) {
      const out: OutcomeItem[] = [];
      if (red(a))
        return [
          plan(
            c,
            "Same-day assessment: vitamin D / calcium safety",
            "follow_up",
          ),
        ];
      if (includes(a, "actions", "tests"))
        out.push(
          plan(c, "Check adjusted calcium and renal function", "monitoring", [
            "calcium",
            "creatinine",
          ]),
        );
      if (includes(a, "actions", "protocol")) {
        out.push(
          plan(
            c,
            "Vitamin D replacement prescription: verify regimen, total loading dose ≤300,000 IU and stop date",
            "medication",
          ),
        );
        out.push({
          ...plan(
            c,
            "End vitamin D replacement course / confirm maintenance",
            "medication",
          ),
          dueDate: String(a.replacementEnd ?? ""),
        });
      }
      if (
        includes(a, "actions", "maintenance") &&
        canTreat(a) &&
        a.safety === "safe" &&
        a.phase === "maintenance" &&
        !c.meds.some((m) => m.tags.includes("vitamin-d"))
      )
        out.push({
          kind: "start",
          code: "colecalciferol",
          doseValue: 800,
          frequency: "OD",
          indication: "Vitamin D deficiency maintenance",
          label: "Colecalciferol 800 IU daily maintenance",
        });
      if (
        includes(a, "actions", "specialist") ||
        a.safety !== "safe" ||
        a.scope !== "standard"
      )
        out.push(
          plan(c, "Specialist vitamin D / mineral-bone review", "referral"),
        );
      return out;
    },
  },
  "anaemia-result": {
    ...base,
    id: "anaemia-result",
    title: "Anaemia: cause & treatment",
    source: LAB_SOURCES.anaemia,
    sourceShort: "WHO 2024 · BSG 2021/2026 · ESC HF 2023",
    note: "Low haemoglobin needs cause assessment. Iron is for confirmed iron deficiency; HF iron treatment follows the ESC pathway. Transfusion depends on symptoms and clinical context. Review oral iron response within 4 weeks; usually continue for about 3 months after Hb normalizes.",
    facts: ["haemoglobin", "mcv", "ferritin", "tsat", "b12", "folate", "egfr"],
    trend: "haemoglobin",
    recheck: {
      title: "Anaemia: haemoglobin and treatment response review",
      codes: ["haemoglobin"],
    },
    steps: [
      {
        id: "assessment",
        title: "Bleeding & cause",
        questions: [
          scope,
          flags([
            { value: "bleeding", label: "Active significant bleeding" },
            {
              value: "unstable",
              label:
                "Syncope, chest pain, breathlessness at rest or haemodynamic instability",
            },
          ]),
          {
            id: "cause",
            label: "Cause assessment",
            type: "single",
            required: true,
            options: [
              {
                value: "iron",
                label:
                  "Iron deficiency confirmed; cause / blood loss being investigated",
              },
              {
                value: "hf-iron",
                label: "HF with iron deficiency: assess IV iron",
              },
              {
                value: "other",
                label: "B12 / folate / renal / inflammatory or other cause",
              },
              { value: "unknown", label: "Cause not yet established" },
            ],
          },
        ],
      },
      {
        id: "plan",
        title: "Suggested treatment & follow-up",
        questions: [
          {
            id: "actions",
            label: "Actions",
            type: "multi",
            required: true,
            options: [
              {
                value: "workup",
                label: "CBC indices, iron studies and renal function",
              },
              { value: "vitamins", label: "B12 and folate (when indicated)" },
              {
                value: "oral",
                label: "Ferrous sulfate 200 mg daily (≈65 mg elemental iron)",
              },
              {
                value: "iv",
                label:
                  "HF IV iron prescription review (product / weight / Hb dosing)",
              },
              {
                value: "cause",
                label:
                  "Investigate blood loss / malabsorption; GI assessment when indicated",
              },
              {
                value: "specialist",
                label: "Urgent or specialist anaemia assessment",
              },
              {
                value: "defer",
                label: "Continue existing cause-specific care",
              },
            ],
          },
          {
            id: "ivChecks", label: "Before the first IV iron infusion", help: "Confirm each point (Ferinject SmPC 4.3/4.4)", type: "multi", required: true,
            showIf: { question: "actions", includes: "iv" }, options: IRON_CHECKS.map((x) => ({ ...x })),
          },
          follow("Haemoglobin response review"),
        ],
      },
    ],
    outcome(a, c) {
      const out: OutcomeItem[] = [];
      if (red(a) || (c.lab?.haemoglobin?.value ?? Infinity) < L.severeHb)
        return [
          plan(
            c,
            "Urgent assessment: bleeding / severe or symptomatic anaemia",
            "follow_up",
          ),
        ];
      if (includes(a, "actions", "workup"))
        out.push(
          plan(
            c,
            "Anaemia cause: CBC indices, ferritin, TSAT and renal function",
            "monitoring",
            ["haemoglobin", "mcv", "ferritin", "tsat", "creatinine"],
          ),
        );
      if (includes(a, "actions", "vitamins"))
        out.push(
          plan(c, "Anaemia: B12 and folate", "monitoring", ["b12", "folate"]),
        );
      if (
        includes(a, "actions", "oral") &&
        canTreat(a) &&
        a.cause === "iron" &&
        !hfIronReview(c) &&
        !c.meds.some(
          (m) => m.tags.includes("oral-iron") || m.tags.includes("iv-iron"),
        )
      )
        out.push({
          kind: "start",
          code: "ferrous-sulfate",
          doseValue: 200,
          frequency: "OD",
          indication: "Confirmed iron deficiency anaemia",
          label: "Ferrous sulfate 200 mg daily (≈65 mg elemental iron)",
        });
      // HF IV iron: the label dose (Hb and weight), dated infusions and the recheck (shared with the IV iron pathway)
      if (includes(a, "actions", "iv")) out.push(...ironOutcome({ decision: "give", start: "0" }, c));
      if (includes(a, "actions", "cause"))
        out.push(
          plan(
            c,
            "Anaemia: investigate blood loss / malabsorption and GI referral when indicated",
            "referral",
          ),
        );
      if (includes(a, "actions", "specialist") || a.scope !== "standard")
        out.push(plan(c, "Specialist anaemia assessment", "referral"));
      return out;
    },
  },
  "liver-result": {
    ...base,
    id: "liver-result",
    title: "Liver enzymes: cause & medication review",
    source: LAB_SOURCES.liver,
    sourceShort: "ESC/EAS 2019 + 2025 · NHS SPS",
    note: "Use the report's ULN. An elevation does not establish drug-induced injury. Jaundice, impaired synthetic function or systemic illness needs urgent assessment.",
    facts: ["alt", "ast", "alp", "bilirubin", "inr"],
    trend: "alt",
    recheck: {
      title: "Liver enzyme and medication review",
      codes: ["alt", "ast"],
    },
    steps: [
      {
        id: "assessment",
        title: "Symptoms & report",
        questions: [
          flags([
            {
              value: "jaundice",
              label:
                "Jaundice / dark urine, confusion, bleeding or systemic illness",
            },
          ]),
          {
            id: "report",
            label: "Reference limits and liver pattern",
            type: "single",
            required: true,
            options: [
              {
                value: "checked",
                label: "Actual ALT / AST limits and full report checked",
              },
              {
                value: "missing",
                label: "Reference limit / full report missing",
              },
            ],
          },
        ],
      },
      {
        id: "plan",
        title: "Suggested action & follow-up",
        questions: [
          {
            id: "actions",
            label: "Actions",
            exclusive: ["continue", "hold", "stop"],
            type: "multi",
            required: true,
            options: [
              {
                value: "continue",
                label: "Continue statin; monitor and investigate",
                requires: ["statin"],
              },
              {
                value: "hold",
                label: "Pause active statin pending clinical review",
                requires: ["statin"],
              },
              {
                value: "amiodarone",
                label: "Amiodarone: reduce the dose or stop (prescriber decision)",
                requires: ["amiodarone"],
              },
              {
                value: "limits",
                label: "Obtain report ULN / correct reference limits",
              },
              {
                value: "cause",
                label:
                  "Review alcohol, congestion, drug interactions and other liver causes",
              },
              {
                value: "tests",
                label: "Full liver panel / synthetic function assessment",
              },
              {
                value: "specialist",
                label: "Urgent / specialist liver assessment",
              },
            ],
          },
          follow("Liver results review"),
        ],
      },
    ],
    outcome(a, c) {
      const out: OutcomeItem[] = [];
      if (red(a))
        out.push(
          plan(
            c,
            "Same-day assessment: liver red flags / synthetic dysfunction",
            "follow_up",
          ),
        );
      const known =
        [c.lab?.alt, c.lab?.ast].filter(Boolean).length > 0 &&
        [c.lab?.alt, c.lab?.ast].filter(Boolean).every((r) => ratio(r) != null);
      if (includes(a, "actions", "hold") && a.report === "checked" && known)
        for (const m of activeStatins(c))
          out.push({
            kind: "medication",
            medicationId: m.id,
            event: "hold",
            doseValue: null,
            label: `${m.name}: pause pending liver review`,
          });
      if (includes(a, "actions", "amiodarone"))
        out.push(plan(c, "Amiodarone and raised transaminases: reduce the dose or stop (SmPC 4.4)", "medication"));
      if (includes(a, "actions", "limits") || !known)
        out.push(
          plan(
            c,
            "Verify actual ALT / AST reference limits from lab report",
            "other",
          ),
        );
      if (includes(a, "actions", "cause"))
        out.push(
          plan(
            c,
            "Assess liver cause: alcohol, congestion, medicines, viral / metabolic causes",
            "other",
          ),
        );
      if (includes(a, "actions", "tests"))
        out.push(
          plan(
            c,
            "Full liver panel / synthetic function assessment",
            "monitoring",
            ["alt", "ast", "alp", "bilirubin", "inr"],
          ),
        );
      if (includes(a, "actions", "specialist"))
        out.push(plan(c, "Specialist liver assessment", "referral"));
      return out;
    },
  },
  "statin-ck-result": {
    ...base,
    id: "statin-ck-result",
    title: "CK on statin: symptoms & safety",
    source: LAB_SOURCES.ck,
    sourceShort: "ESC/EAS 2019 + focused update 2025",
    note: "Routine CK testing without symptoms is not recommended. Consider exertion, interacting drugs and thyroid disease. A high CK does not alone establish rhabdomyolysis.",
    facts: ["ck", "creatinine", "egfr", "tsh"],
    trend: "ck",
    recheck: {
      title: "Statin CK and renal safety review",
      codes: ["ck", "creatinine"],
    },
    steps: [
      {
        id: "assessment",
        title: "Muscle symptoms & renal safety",
        questions: [
          flags([
            {
              value: "urgent",
              label: "Severe muscle pain / weakness, dark urine or oliguria",
            },
          ]),
          {
            id: "symptoms",
            label: "Muscle symptoms",
            type: "single",
            required: true,
            options: [
              { value: "no", label: "No muscle symptoms" },
              { value: "yes", label: "Muscle symptoms present" },
              {
                value: "persistent",
                label: "Symptoms persist despite monitoring",
              },
            ],
          },
          {
            id: "report",
            label: "CK reference limit",
            type: "single",
            required: true,
            options: [
              { value: "checked", label: "Actual report upper limit checked" },
              { value: "missing", label: "Upper limit missing" },
            ],
          },
        ],
      },
      {
        id: "plan",
        title: "Suggested statin action & follow-up",
        questions: [
          {
            id: "actions",
            label: "Actions",
            exclusive: ["continue", "hold", "stop"],
            type: "multi",
            required: true,
            options: [
              {
                value: "continue",
                label: "Continue statin with symptom / CK review",
              },
              {
                value: "hold",
                label: "Pause statin until symptoms / CK resolve",
              },
              {
                value: "stop",
                label: "Stop statin; assess renal function and rhabdomyolysis",
              },
              { value: "limits", label: "Obtain CK report upper limit" },
              {
                value: "cause",
                label:
                  "Review exercise, thyroid function and drug interactions",
              },
              {
                value: "rechallenge",
                label:
                  "Plan lower-dose / alternative statin or non-statin lipid treatment after recovery",
              },
            ],
          },
          follow("CK / renal review"),
        ],
      },
    ],
    outcome(a, c) {
      const out: OutcomeItem[] = [];
      const x = ratio(c.lab?.ck);
      if (red(a) || (x != null && x > L.ckStop))
        out.push(
          plan(
            c,
            "Urgent renal / muscle assessment: evaluate rhabdomyolysis",
            "follow_up",
          ),
        );
      if (a.report === "checked" && x != null) {
        const event = includes(a, "actions", "stop")
          ? "stop"
          : includes(a, "actions", "hold")
            ? "hold"
            : null;
        if (event)
          // a held statin can still be stopped for good (CK pathway)
          for (const m of event === "stop" ? c.meds.filter((x) => x.tags.includes("statin")) : activeStatins(c))
            out.push({
              kind: "medication",
              medicationId: m.id,
              event,
              doseValue: null,
              label: `${m.name}: ${event}`,
            });
      }
      if (includes(a, "actions", "limits") || x == null)
        out.push(
          plan(
            c,
            "Verify actual CK upper reference limit from lab report",
            "other",
          ),
        );
      if (includes(a, "actions", "cause"))
        out.push(
          plan(
            c,
            "Statin muscle review: exertion, thyroid and interacting drugs",
            "other",
          ),
        );
      if (includes(a, "actions", "rechallenge"))
        out.push(
          plan(
            c,
            "After CK / symptom recovery: lower-dose or alternative statin / non-statin lipid plan",
            "medication",
            undefined,
            14,
          ),
        );
      return out;
    },
  },
};

// Guidelines suggest actions after the clinician answers safety questions. Unknowns stay unknown.
export function labSuggestions(
  id: string,
  q: string,
  a: Answers,
  c: WizardContext,
): { value: string; why: string }[] | null {
  if (!LAB_WIZARDS[id]) return null;
  const rec = (v: string, why: string) => ({ value: v, why });
  if (q === "report")
    return [
      rec(
        id === "statin-ck-result"
          ? ratio(c.lab?.ck) == null
            ? "missing"
            : "checked"
          : [c.lab?.alt, c.lab?.ast].filter(Boolean).length > 0 &&
              [c.lab?.alt, c.lab?.ast]
                .filter(Boolean)
                .every((r) => ratio(r) != null)
            ? "checked"
            : "missing",
        "Reference limits from the recorded lab report",
      ),
    ];
  if (q === "actions") {
    if (id === "vitamin-d-result")
      return [
        rec(
          a.scope === "standard" && a.safety === "safe"
            ? a.phase === "maintenance"
              ? "maintenance"
              : "protocol"
            : "specialist",
          "NHS: checked replacement then maintenance; calcium and contraindications first",
        ),
        ...(a.safety !== "safe"
          ? [rec("tests", "Check calcium and renal function before treatment")]
          : []),
      ];
    if (id === "anaemia-result") {
      if (red(a) || (c.lab?.haemoglobin?.value ?? Infinity) < L.severeHb)
        return [
          rec(
            "specialist",
            "Urgent assessment for bleeding, instability or severe anaemia",
          ),
        ];
      const iron = a.cause === "iron",
        hf = hfIronReview(c);
      return [
        rec(
          iron && !hf && canTreat(a)
            ? "oral"
            : a.cause === "hf-iron" || hf
              ? "iv"
              : "workup",
          "BSG: cause-directed iron; ESC HF: IV iron assessment in eligible HF",
        ),
        ...(iron || hf
          ? [
              rec(
                "cause",
                "Investigate the cause of iron deficiency, including blood loss",
              ),
            ]
          : []),
      ];
    }
    if (id === "liver-result") {
      const rs = [c.lab?.alt, c.lab?.ast].filter(Boolean),
        known = rs.length > 0 && rs.every((r) => ratio(r) != null),
        high = rs.some((r) => (ratio(r) ?? 0) >= L.liverStop);
      return [
        rec(
          known
            ? activeStatins(c).length
              ? high
                ? "hold"
                : "continue"
              : "tests"
            : "limits",
          "ESC/EAS: ≥3× ULN stop or reduce; below 3× continue with repeat testing",
        ),
        ...(known && high && c.meds.some((m) => m.tags.includes("amiodarone") && m.status !== "held")
          ? [rec("amiodarone", "Amiodarone SmPC 4.4: transaminases >3× ULN — reduce the dose or withdraw amiodarone")]
          : []),
        rec(
          red(a) ? "specialist" : "cause",
          "Assess symptoms and alternative causes; red flags need same-day review",
        ),
      ];
    }
    if (id === "statin-ck-result") {
      const x = ratio(c.lab?.ck);
      return [
        rec(
          x == null
            ? "limits"
            : red(a) || x > L.ckStop
              ? "stop"
              : (x >= L.ckReview && a.symptoms !== "no") ||
                  a.symptoms === "persistent"
                ? "hold"
                : "continue",
          "ESC/EAS: CK >10× ULN stop; ≥4× with symptoms pause; <4× monitor symptoms, pause if persistent; asymptomatic <10× monitor",
        ),
        rec(
          "cause",
          "Consider exertion, interacting medicines and thyroid disease",
        ),
        ...(x != null &&
        (x > L.ckStop ||
          (x >= L.ckReview && a.symptoms !== "no") ||
          a.symptoms === "persistent")
          ? [
              rec(
                "rechallenge",
                "Reassess lipid therapy after symptoms / CK recover",
              ),
            ]
          : []),
      ];
    }
  }
  if (q === "recheck")
    return [
      rec(
        red(a)
          ? "0"
          : id === "statin-ck-result"
            ? (ratio(c.lab?.ck) ?? 0) > L.ckStop
              ? "14"
              : "28"
            : id === "anaemia-result"
              ? (c.lab?.haemoglobin?.value ?? Infinity) < L.severeHb
                ? "0"
                : "28"
              : "28",
        "Guideline follow-up; use the manual date field to change timing",
      ),
    ];
  return [];
}

export function validateLabAnswers(
  id: string,
  a: Answers,
  c: WizardContext,
): string | null {
  if (!LAB_WIZARDS[id]) return null;
  const code =
    id === "vitamin-d-result"
      ? "vitamin-d"
      : id === "anaemia-result"
        ? "haemoglobin"
        : id === "statin-ck-result"
          ? "ck"
          : "alt";
  if (!c.lab?.[code] && !(id === "liver-result" && c.lab?.ast))
    return "Record a verified result before completing this pathway";
  if (c.profile?.age != null && c.profile.age < 18)
    return "This result pathway is for adults; arrange age-specific care";
  if (id === "vitamin-d-result" && includes(a, "actions", "maintenance")) {
    if (!canTreat(a) || a.phase !== "maintenance" || a.safety !== "safe")
      return "Confirm completed replacement and vitamin D safety before maintenance prescribing";
    if ((ratio(c.lab?.calcium) ?? 0) > 1)
      return "Recorded calcium is above the report limit: specialist review before vitamin D";
  }
  if (
    id === "anaemia-result" &&
    includes(a, "actions", "oral") &&
    (!canTreat(a) || a.cause !== "iron" || hfIronReview(c))
  )
    return "Confirm adult iron deficiency and assess the HF IV iron indication before choosing oral iron";
  if (
    id === "liver-result" &&
    includes(a, "actions", "hold") &&
    (a.report !== "checked" ||
      [c.lab?.alt, c.lab?.ast].filter(Boolean).some((r) => ratio(r) == null))
  )
    return "Record the actual liver reference limits before applying statin medication actions";
  if (
    id === "statin-ck-result" &&
    (includes(a, "actions", "hold") || includes(a, "actions", "stop")) &&
    (a.report !== "checked" || ratio(c.lab?.ck) == null)
  )
    return "Record the actual CK upper limit before applying a CK-based medication change; urgent clinical assessment remains available";
  return null;
}
