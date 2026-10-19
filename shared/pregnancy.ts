import { daysBetween, localDay } from "./clinical.js";

export const PREGNANCY_SOURCE = "ESC pregnancy 2025 · correction 2026";
export const PREGNANCY_PHASES = [
  "Planning pregnancy",
  "Pregnant",
  "Postpartum",
  "Follow-up complete",
];
export const MWHO = ["I", "II", "II–III", "III", "IV", "Not assessed"];
export const PREGNANCY_SYMPTOMS = [
  "None reported",
  "Chest pain",
  "Breathlessness at rest / orthopnoea",
  "Syncope",
  "Persistent headache / visual symptoms",
  "Epigastric / right upper quadrant pain",
  "Seizure / neurological deficit",
  "Bleeding",
];
export const PREGNANCY_HIGH_RISKS = [
  "Previous hypertensive pregnancy",
  "Autoimmune disease (SLE / APS)",
  "Assisted reproduction this pregnancy",
];
export const PREGNANCY_MODERATE_RISKS = [
  "First pregnancy",
  "Pregnancy interval over 10 years",
  "Family history of pre-eclampsia",
  "Multiple pregnancy",
];
export type PregnancyField = {
  key: string;
  label: string;
  type: "choice" | "multi" | "date" | "number";
  options?: string[];
  phases?: string[];
  min?: number;
  max?: number;
};
export const PREGNANCY_FIELDS: PregnancyField[] = [
  {
    key: "phase",
    label: "Pregnancy stage",
    type: "choice",
    options: PREGNANCY_PHASES,
  },
  {
    key: "edd",
    label: "Estimated due date (confirmed obstetric dating)",
    type: "date",
    phases: ["Pregnant"],
  },
  {
    key: "deliveredOn",
    label: "Delivery / pregnancy end date",
    type: "date",
    phases: ["Postpartum"],
  },
  {
    key: "breastfeeding",
    label: "Breastfeeding",
    type: "choice",
    options: ["Yes", "No", "Not recorded"],
    phases: ["Postpartum"],
  },
  {
    key: "mwho",
    label: "Clinician-assigned mWHO 2.0",
    type: "choice",
    options: MWHO,
  },
  { key: "assessedOn", label: "Symptoms assessed on", type: "date" },
  {
    key: "symptoms",
    label: "Symptoms at that assessment",
    type: "multi",
    options: PREGNANCY_SYMPTOMS,
  },
  {
    key: "highRisks",
    label: "Additional high-risk factors for pre-eclampsia",
    type: "multi",
    options: PREGNANCY_HIGH_RISKS,
    phases: ["Pregnant", "Planning pregnancy"],
  },
  {
    key: "moderateRisks",
    label: "Additional moderate-risk factors",
    type: "multi",
    options: PREGNANCY_MODERATE_RISKS,
    phases: ["Pregnant", "Planning pregnancy"],
  },
  {
    key: "bookingBmi",
    label: "BMI at first pregnancy visit (kg/m²)",
    type: "number",
    min: 10,
    max: 100,
    phases: ["Pregnant", "Planning pregnancy"],
  },
];
export const pregnancyFieldShown = (
  f: PregnancyField,
  a: Record<string, any>,
) => !f.phases || f.phases.includes(a.phase);
export const calendarDay = (s: unknown): s is string =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s + "T00:00:00Z")) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
export function cleanPregnancy(
  a: Record<string, unknown>,
  today = localDay(new Date().toISOString()),
) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(a)) {
    if (k === "onsetYear") continue;
    const f = PREGNANCY_FIELDS.find((f) => f.key === k);
    if (!f) throw Error(`Unknown pregnancy detail "${k}"`);
    if (v == null || v === "" || !pregnancyFieldShown(f, a)) continue;
    if (f.type === "date") {
      if (!calendarDay(v))
        throw Error(`${f.label}: enter a real calendar date`);
      out[k] = v;
    } else if (f.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < f.min! || n > f.max!)
        throw Error(`${f.label}: ${f.min}–${f.max}`);
      out[k] = n;
    } else if (f.type === "multi") {
      if (!Array.isArray(v) || v.some((x) => !f.options!.includes(String(x))))
        throw Error(`${f.label}: choose from the list`);
      if (v.length) out[k] = [...new Set(v.map(String))];
    } else {
      if (!f.options!.includes(String(v)))
        throw Error(`${f.label}: choose from the list`);
      out[k] = String(v);
    }
  }
  if (Object.keys(out).length && !out.phase)
    throw Error("Choose the pregnancy stage");
  if (out.deliveredOn && out.deliveredOn > today)
    throw Error("Delivery date cannot be in the future");
  if (out.assessedOn && out.assessedOn > today)
    throw Error("Symptoms assessment cannot be in the future");
  if (out.symptoms?.length && !out.assessedOn)
    throw Error("Record the symptoms assessment date");
  if (out.symptoms?.includes("None reported") && out.symptoms.length > 1)
    throw Error("Choose no symptoms or the specific symptoms");
  if (out.edd && daysBetween(today, out.edd) > 280)
    throw Error("Check obstetric dating: due date is more than 40 weeks away");
  return out;
}
export type PregnancyContext = {
  eligible: boolean;
  key: string;
  conditionId: string | null;
  phase: string | null;
  at: string | null;
  edd: string | null;
  gestationDays: number | null;
  deliveredOn: string | null;
  postpartumDays: number | null;
  breastfeeding: string | null;
  mwho: string | null;
  needsHeartTeam: boolean;
  urgent: string[];
  risks: string[];
  missing: string[];
  medicationFlags: {
    id: string;
    code: string;
    name: string;
    reason: string;
    avoid: boolean;
  }[];
  highRisks: string[];
  moderateRisks: string[];
  aspirinCandidate: boolean;
  hypertensive: boolean;
  severeBp: boolean;
  possiblePreeclampsia: boolean;
  hasHeartFailure: boolean;
  mechanical: boolean;
  congenital: boolean;
  genetic: boolean;
  aortic: boolean;
};

// Review-level guidance, not a pregnancy dose calculator. Anticoagulants are never withdrawn here.
export function pregnancyDrugIssue(
  phase: string | null,
  breastfeeding: string | null,
  code: string,
  tags: string[],
  gestationDays: number | null = null,
  doseValue: number | null = null,
) {
  const pregnant = phase === "Pregnant",
    planning = phase === "Planning pregnancy";
  const lactation = phase === "Postpartum" && breastfeeding !== "No";
  if (!pregnant && !planning && !lactation) return null;
  const issue = (reason: string, avoid = true) => ({ reason, avoid });
  if (pregnant || planning) {
    if (
      pregnant &&
      tags.includes("nsaid") &&
      (gestationDays == null || gestationDays >= 140)
    )
      return issue(
        "NSAID review: limit use at 20–30 weeks and avoid from 30 weeks; a specialist gestation-specific plan is required",
      );
    if (pregnant && code === "aspirin" && doseValue != null && doseValue > 150)
      return issue(
        "High-dose aspirin needs pregnancy-specific specialist review; low-dose obstetric prophylaxis is a separate indication",
      );
    if (tags.includes("glp1"))
      return issue(
        code === "semaglutide"
          ? "Review replacement before conception; semaglutide label specifies a two-month washout for planned pregnancy"
          : "Not recommended in pregnancy; review the product-specific pre-conception plan",
      );
    if (
      tags.some((t) => ["acei", "arb", "arni", "mra", "sglt2"].includes(t)) ||
      ["ivabradine", "aliskiren", "mavacamten"].includes(code)
    )
      return issue(
        pregnant
          ? "Not recommended in pregnancy; arrange a pregnancy-compatible treatment plan"
          : "Review and replace before conception where indicated",
      );
    if (tags.includes("doac"))
      return issue(
        "Pregnancy Heart Team / haematology anticoagulation plan; avoid DOACs in pregnancy",
      );
    if (code === "warfarin")
      return issue(
        "Individualized trimester and delivery anticoagulation plan; never interrupt a mechanical-valve regimen without therapeutic cover",
        false,
      );
    if (tags.includes("statin"))
      return issue(
        "Usually pause in pregnancy; continuation may be considered for established ASCVD after specialist shared decision",
        false,
      );
    if (tags.some((t) => ["ezetimibe", "pcsk9"].includes(t)))
      return issue(
        "Review lipid therapy with the Pregnancy Heart Team; pregnancy safety data are insufficient",
      );
    if (
      [
        "atenolol",
        "ticagrelor",
        "bosentan",
        "ambrisentan",
        "macitentan",
        "riociguat",
      ].includes(code)
    )
      return issue(
        "Pregnancy-specific specialist replacement / safety review required",
      );
    if (code === "amiodarone")
      return issue(
        "Routine use is unsuitable in pregnancy; emergency exceptions require specialist care",
      );
  }
  if (lactation) {
    if (tags.includes("glp1"))
      return issue(
        "Agent / formulation-specific lactation review; do not assume class-wide safety or prohibition",
        false,
      );
    if (code === "candesartan")
      return issue(
        "Limited lactation data: individualized maternal / infant review",
        false,
      );
    if (
      tags.some((t) => ["sglt2", "arni", "statin"].includes(t)) ||
      ["ivabradine", "mavacamten"].includes(code)
    )
      return issue(
        "Breastfeeding medication review: avoid / use an alternative; confirm infant and maternal plan",
      );
    if (tags.includes("arb") && code !== "candesartan")
      return issue("Prefer a better-established lactation alternative");
    if (tags.includes("doac"))
      return issue(
        code === "apixaban"
          ? "Higher milk exposure: prefer an alternative anticoagulant"
          : "Prefer an established alternative; agent-specific specialist review before lactation use",
        false,
      );
    if (
      tags.includes("acei") &&
      !["captopril", "enalapril", "benazepril"].includes(code)
    )
      return issue(
        "Confirm a lactation-compatible ACE inhibitor and infant monitoring",
        false,
      );
    if (tags.includes("mra") && code !== "spironolactone")
      return issue(
        "Agent-specific lactation review; spironolactone has established compatibility",
        false,
      );
  }
  return null;
}

// WHO 2024 Table 2; ACOG trimester boundaries. Interpret at collection time,
// using confirmed obstetric dating, never today's trimester for an old result.
export function pregnancyHaemoglobinCutoff(
  edd: string | undefined,
  resultDay: string,
) {
  if (!edd || !calendarDay(edd)) return null;
  const gestation = 280 - daysBetween(resultDay, edd);
  if (gestation < 0 || gestation > 294) return null;
  return gestation >= 98 && gestation < 196 ? 10.5 : 11;
}
