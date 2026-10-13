import type { PatientState } from "../kernel/state.js";
import { daysBetween } from "../../shared/clinical.js";
import { MEDICATION } from "../../shared/catalog.js";
import {
  HTN_MEASURES,
  officeHigh,
  type BpPair,
  type HypertensionContext,
} from "../../shared/hypertension.js";
export const HTN_INPUTS = [
  "patient",
  "conditions",
  "meds",
  "studies",
  "procedures",
  "contexts",
  "pathways",
  ...HTN_MEASURES,
];
const recent = (s: PatientState, at: string) =>
  daysBetween(at, s.today) >= 0 && daysBetween(at, s.today) <= 90;
// 90 days is a visible workflow freshness limit, not a guideline eligibility threshold.
export function hypertensionProfile(s: PatientState): HypertensionContext {
  const current = (code: string) => s.resolved(code).current;
  const num = (code: string) => {
    const o = current(code);
    return o?.status === "final" && recent(s, o.effective_at)
      ? o.value_num
      : null;
  };
  const pair = (sbp: string, dbp: string): BpPair | null => {
    const x = current(sbp),
      y = current(dbp);
    return x?.status === "final" &&
      y?.status === "final" &&
      x.value_num != null &&
      y.value_num != null &&
      x.effective_at === y.effective_at &&
      recent(s, x.effective_at)
      ? {
          sbp: x.value_num,
          dbp: y.value_num,
          at: x.effective_at,
          id: `${x.id}:${y.id}`,
        }
      : null;
  };
  const office = pair("sbp", "dbp");
  const active = s.meds.filter((m) => m.status === "active");
  const isBpMed = (m: PatientState["meds"][number]) =>
    MEDICATION[m.code]?.indications.includes("htn") ||
    m.tags.includes("loop") ||
    m.tags.includes("mra");
  const bpMeds = active.filter(isBpMed);
  const componentCount = new Set(
    bpMeds.flatMap((m) =>
      m.code.includes("-") && m.drugClass.includes("combination")
        ? [
            m.tags.includes("acei") || m.tags.includes("arb") ? "RAS" : "",
            m.tags.includes("thiazide") ? "Diuretic" : "CCB",
          ].filter(Boolean)
        : [
            m.tags.includes("acei") || m.tags.includes("arb")
              ? "RAS"
              : m.tags.includes("thiazide") || m.tags.includes("loop")
                ? "Diuretic"
                : /Calcium-channel/.test(m.drugClass)
                  ? "CCB"
                  : m.drugClass,
          ],
    ),
  ).size;
  const triple =
    active.some((m) => m.tags.some((t) => ["acei", "arb"].includes(t))) &&
    active.some((m) =>
      [
        "amlodipine",
        "nifedipine",
        "felodipine",
        "lercanidipine",
        "amlodipine-valsartan",
        "telmisartan-amlodipine",
        "perindopril-amlodipine",
      ].includes(m.code),
    ) &&
    active.some(
      (m) =>
        m.tags.includes("thiazide") ||
        (num("egfr") != null && num("egfr")! < 30 && m.tags.includes("loop")),
    );
  const studies = s.studies.filter((st) =>
    ["abpm", "home_bp", "hypertension_workup"].includes(st.kind),
  );
  const key = JSON.stringify({
    obs: HTN_MEASURES.map((code) => [
      code,
      current(code)?.id ?? null,
      current(code) ? recent(s, current(code)!.effective_at) : false,
    ]),
    meds: s.meds
      .filter(
        (m) =>
          MEDICATION[m.code]?.indications.includes("htn") ||
          m.tags.includes("loop") ||
          m.tags.includes("mra") ||
          m.tags.includes("nsaid"),
      )
      .map((m) => [m.id, m.status, m.doseValue, m.frequency, m.lastChange?.id]),
    studies: studies.map((st) => [st.id, recent(s, st.performed_at)]),
    conditions: s.conditions.map((c) => c.id),
    age: s.patient.age,
  });
  // A confirmed hypertension diagnosis is an output of the initial review.
  // It must not invalidate that review while its BP, treatment and risk facts stay unchanged.
  const managementKey = JSON.stringify({
    ...JSON.parse(key),
    conditions: s.conditions.filter((c) => c.code !== "htn").map((c) => c.id),
  });
  const outsideStudy = [...studies]
    .reverse()
    .find((st) => ["abpm", "home_bp"].includes(st.kind));
  let outside: HypertensionContext["outside"] = null;
  if (outsideStudy && recent(s, outsideStudy.performed_at)) {
    const a = outsideStudy.attributes;
    const home = outsideStudy.kind === "home_bp";
    const x = home ? a.meanSbp : a.sbp24,
      y = home ? a.meanDbp : a.dbp24;
    // An old test on a different regimen never proves resistance on today's regimen.
    const sameTreatment =
      bpMeds.every(
        (m) =>
          !m.lastChange ||
          m.lastChange.effective_at <= outsideStudy.performed_at,
      ) &&
      !s.meds.some(
        (m) =>
          isBpMed(m) &&
          m.lastChange &&
          m.lastChange.effective_at > outsideStudy.performed_at,
      );
    if (x != null && y != null)
      outside = {
        sbp: x,
        dbp: y,
        at: outsideStudy.performed_at,
        id: outsideStudy.id,
        method: home ? "HBPM" : "24-h ABPM",
        high: home
          ? x >= 135 || y >= 85
          : x >= 130 ||
            y >= 80 ||
            (a.sbpDay ?? 0) >= 135 ||
            (a.dbpDay ?? 0) >= 85 ||
            (a.sbpNight ?? 0) >= 120 ||
            (a.dbpNight ?? 0) >= 70,
        valid:
          sameTreatment &&
          (!bpMeds.length || a.onTreatment === "On treatment") &&
          (home
            ? a.validated === "Yes" &&
              a.protocol === "Twice daily, two readings each time" &&
              a.days >= 3
            : a.valid >= 70 && a.conclusion !== "Non-diagnostic"),
      };
  }
  const result = (purpose: string) =>
    [...studies]
      .reverse()
      .find(
        (st) =>
          st.kind === "hypertension_workup" &&
          st.attributes.purpose === purpose &&
          recent(s, st.performed_at),
      );
  const secondaryStudy = result("Secondary hypertension review");
  const paStudy = result("Primary aldosteronism screen");
  const anatomyStudy = result("RDN anatomical assessment");
  // Technique/adherence/dose review belongs to the BP regimen, not to every later screening report.
  const resistanceKey = JSON.stringify({
    office: [office?.id ?? null, office ? recent(s, office.at) : false],
    outside: [outsideStudy?.id ?? null, outside?.valid ?? false],
    meds: s.meds
      .filter(isBpMed)
      .map((m) => [m.id, m.status, m.doseValue, m.frequency, m.lastChange?.id]),
    loopRequired: num("egfr") == null ? "unknown" : num("egfr")! < 30,
    adult: s.patient.age >= 18,
  });
  const review = s.procedureReviews?.["htn-resistance"]?.answers;
  let legacyMatches = false;
  if (review?._hypertensionKey && !review._resistanceKey) {
    try {
      const prior = JSON.parse(review._hypertensionKey),
        current = JSON.parse(key);
      const bpInputs = new Set([
        "sbp",
        "dbp",
        "egfr",
        ...HTN_MEASURES.filter(
          (code) => code.startsWith("abpm-") || code.startsWith("home-"),
        ),
      ]);
      legacyMatches =
        JSON.stringify(
          prior.obs.filter((row: any[]) => bpInputs.has(row[0])),
        ) ===
          JSON.stringify(
            current.obs.filter((row: any[]) => bpInputs.has(row[0])),
          ) &&
        JSON.stringify(prior.meds) === JSON.stringify(current.meds) &&
        prior.age === current.age &&
        (!outsideStudy ||
          prior.studies.some(
            (row: any[]) =>
              row[0] === outsideStudy.id &&
              row[1] === recent(s, outsideStudy.performed_at),
          ));
    } catch {
      /* Unrecognized historical evidence requires a fresh review. */
    }
  }
  const resistance =
    review &&
    (review._resistanceKey === resistanceKey ||
      (!review._resistanceKey && legacyMatches))
      ? review
      : null;
  const secondaryClues: string[] = [];
  const htn = s.conditions.find((c) => c.code === "htn");
  const newlyDiagnosed = htn?.attributes.diagnosisStatus === "Newly diagnosed";
  if (
    htn &&
    (s.patient.age < 40 ||
      (htn.onset &&
        (new Date(htn.onset).getTime() -
          new Date(s.patient.birth_date).getTime()) /
          31557600000 <
          40) ||
      (htn.attributes.onsetYear &&
        htn.attributes.onsetYear -
          Number(String(s.patient.birth_date).slice(0, 4)) <
          40))
  )
    secondaryClues.push("Hypertension before age 40");
  if (officeHigh(office) && triple)
    secondaryClues.push("Apparent resistant hypertension");
  if (num("potassium") != null && num("potassium")! < 3.5)
    secondaryClues.push("Hypokalaemia");
  if (s.tags.has("ckd")) secondaryClues.push("Kidney disease");
  if (
    s.conditions.some((c) => c.code === "osa") ||
    /Non-dipp|Reverse/i.test(outsideStudy?.attributes.dipping ?? "")
  )
    secondaryClues.push("Sleep apnoea / non-dipping");
  const pa = paStudy
    ? {
        id: paStudy.id,
        result: paStudy.attributes.screenResult ?? "Indeterminate",
        reliable:
          paStudy.attributes.interpretation ===
            "Interpretable after assay, potassium and medication review" &&
          ["Immunoassay", "LC-MS/MS"].includes(paStudy.attributes.assay) &&
          ["PRA ng/mL/h", "DRC mU/L"].includes(paStudy.attributes.reninUnit) &&
          paStudy.attributes.samplePotassium >= 3.5,
      }
    : null;
  const secondary = secondaryStudy
    ? {
        id: secondaryStudy.id,
        result:
          secondaryStudy.attributes.secondaryResult ?? "Work-up incomplete",
      }
    : null;
  const anatomy = anatomyStudy
    ? {
        id: anatomyStudy.id,
        suitable:
          anatomyStudy.attributes.anatomy ===
            "Suitable under the selected device IFU" &&
          anatomyStudy.attributes.contraindications ===
            "Excluded by specialist" &&
          anatomyStudy.attributes.reviewed === "Yes",
      }
    : null;
  const highRisk = [
    "ascvd",
    "cad",
    "hf",
    "stroke",
    "vascular",
    "ckd",
    "dm",
  ].some((t) => s.tags.has(t));
  const rdnMissing: string[] = [];
  if (s.contexts.some((c) => c.kind === "admission" && c.status === "open"))
    rdnMissing.push("Stable outpatient reassessment after admission");
  if (s.patient.age < 18) rdnMissing.push("Adult patient");
  if (!officeHigh(office))
    rdnMissing.push("Current office BP ≥140 systolic or ≥90 diastolic");
  if (
    office &&
    bpMeds.some((m) => m.lastChange && m.lastChange.effective_at > office.at)
  )
    rdnMissing.push("Office BP measured on the current regimen");
  if (!outside?.valid || !outside.high)
    rdnMissing.push("Valid uncontrolled ABPM / HBPM on the current regimen");
  if (
    !resistance ||
    ["technique", "adherence", "doses", "lifestyle"].some(
      (k) => resistance[k] !== "yes",
    )
  )
    rdnMissing.push(
      "Current technique, adherence, maximally tolerated doses and lifestyle review",
    );
  const resistant = triple && resistance?.basis === "resistant";
  const alternative =
    componentCount > 0 &&
    componentCount < 3 &&
    highRisk &&
    resistance?.basis === "alternative" &&
    resistance?.risk === "yes" &&
    resistance?.intolerance === "yes";
  if (!resistant && !alternative)
    rdnMissing.push(
      "Confirmed resistance, or reviewed high-risk medication-intolerance alternative",
    );
  if (num("egfr") == null || num("egfr")! < 40)
    rdnMissing.push("Current eGFR ≥40 mL/min/1.73 m²");
  if (
    secondary?.result !== "No secondary cause identified" ||
    ![
      "Primary aldosteronism",
      "Renal parenchymal disease",
      "Renovascular disease / FMD",
      "Obstructive sleep apnoea",
      "Drugs / substances",
    ].every((cause) => secondaryStudy?.attributes.tests?.includes(cause)) ||
    !pa?.reliable ||
    pa.result !== "Negative"
  )
    rdnMissing.push(
      "Completed secondary work-up including interpretable aldosteronism screen",
    );
  const actual = [...s.procedures].reverse().find((p) => p.kind === "rdn");
  const phenotype =
    office && outside?.valid
      ? officeHigh(office)
        ? outside.high
          ? "Sustained hypertension"
          : "White-coat phenotype"
        : outside.high
          ? "Masked hypertension"
          : "Below diagnostic thresholds"
      : "Confirmation incomplete";
  const apparentResistance =
    officeHigh(office) && triple && phenotype !== "White-coat phenotype";
  return {
    key,
    managementKey,
    newlyDiagnosed,
    apparentResistance,
    screeningIndicated: newlyDiagnosed || apparentResistance,
    resistanceKey,
    office,
    outside,
    phenotype,
    egfr: num("egfr"),
    potassium: num("potassium"),
    triple,
    treated: bpMeds.length > 0,
    highRisk,
    secondaryClues,
    secondary,
    pa,
    anatomy,
    resistance,
    rdnMissing,
    rdnEligible: rdnMissing.length === 0,
    actual: actual
      ? {
          id: actual.id,
          at: actual.performed_at,
          result: actual.attributes.result,
        }
      : null,
  };
}
