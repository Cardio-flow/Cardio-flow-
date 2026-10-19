import { createHash } from "node:crypto";
import { daysBetween, localDay } from "../../shared/clinical.js";
import { isMechanicalValve } from "../../shared/history.js";
import {
  pregnancyDrugIssue,
  type PregnancyContext,
} from "../../shared/pregnancy.js";
import { latestStudy, type PatientState } from "../kernel/state.js";

export function pregnancyProfile(s: PatientState): PregnancyContext {
  const condition = s.conditions.find((c) => c.code === "pregnancy-care");
  const a = condition?.attributes ?? {};
  // Other pathways can explicitly flag a possible/planned pregnancy. Request
  // actual stage/dating; a flag never becomes a pregnancy diagnosis by inference.
  const hint = [
    s.procedureReviews?.["htn-review"],
    s.procedureReviews?.["aorta-plan"],
  ].find(
    (r) =>
      r &&
      (!condition || r.at > condition.recorded_at) &&
      (r.answers.safety === "pregnancy" ||
        (r.answers.risks as string[] | undefined)?.includes("pregnancy")),
  );
  const phase =
    a.phase === "Follow-up complete" && hint ? null : (a.phase ?? null);
  const eligible = (!!condition && a.phase !== "Follow-up complete") || !!hint;
  const pregnant = eligible && phase === "Pregnant",
    postpartum = eligible && phase === "Postpartum";
  const gestationDays =
    pregnant && a.edd ? 280 - daysBetween(s.today, a.edd) : null;
  const postpartumDays =
    postpartum && a.deliveredOn ? daysBetween(a.deliveredOn, s.today) : null;
  const urgent: string[] = [],
    risks: string[] = [],
    missing: string[] = [];
  const val = (code: string) => {
    const o = s.resolved(code).current;
    return o && localDay(o.effective_at) === s.today ? o : null;
  };
  const sbp = val("sbp"),
    dbp = val("dbp"),
    spo2 = val("spo2");
  const currentSymptoms =
    a.assessedOn === s.today
      ? ((a.symptoms as string[]) ?? []).filter((x) => x !== "None reported")
      : [];
  const preliminaryBp = s.observations.filter(
    (o) =>
      ["sbp", "dbp"].includes(o.code) &&
      o.status === "preliminary" &&
      localDay(o.effective_at) === s.today &&
      o.value_num != null &&
      o.effective_at >= (s.resolved(o.code).current?.effective_at ?? "") &&
      o.value_num >= (o.code === "sbp" ? 160 : 110),
  );
  const severeBp = !!(
    (sbp?.value_num ?? 0) >= 160 || (dbp?.value_num ?? 0) >= 110
  );
  const hypertensive = !!(
    (sbp?.value_num ?? 0) >= 140 || (dbp?.value_num ?? 0) >= 90
  );
  if (eligible && (pregnant || postpartum)) {
    if (preliminaryBp.length)
      urgent.push(
        "New preliminary severe BP: urgent verification and obstetric assessment",
      );
    if (severeBp)
      urgent.push(
        "Severe pregnancy / postpartum BP (≥160 systolic or ≥110 diastolic): immediate obstetric assessment and prompt repeat measurement",
      );
    for (const symptom of currentSymptoms)
      urgent.push(`Current symptom: ${symptom}`);
    if (spo2?.value_num != null && spo2.value_num < 90)
      urgent.push("Current hypoxaemia: urgent assessment");
  }
  const preeclampsiaWindow =
    (pregnant && (gestationDays == null || gestationDays >= 140)) ||
    (postpartum && (postpartumDays == null || postpartumDays <= 42));
  const organ = !!(
    (val("platelets")?.value_num ?? 999) < 150 ||
    (val("alt")?.value_num ?? 0) > 40 ||
    (val("ast")?.value_num ?? 0) > 40 ||
    (val("creatinine")?.value_num ?? 0) >= 90 ||
    (val("uacr")?.value_num ?? 0) > 30
  );
  const possiblePreeclampsia =
    eligible &&
    preeclampsiaWindow &&
    hypertensive &&
    (organ ||
      currentSymptoms.some((x) =>
        /headache|visual|Epigastric|Seizure|Breathlessness/.test(x),
      ));
  if (possiblePreeclampsia)
    urgent.push(
      "Assess for pre-eclampsia / organ dysfunction; establish new-onset changes and alternatives, including pre-existing CKD",
    );
  const ef = s.resolved("lvef").current;
  const mechanical = s.conditions.some(isMechanicalValve);
  const pah = s.conditions.some(
    (c) => c.code === "ph" && c.attributes.group === "Group 1 · PAH",
  );
  const aortic =
    s.conditions.some((c) =>
      [
        "bav",
        "thoracic-aortic-aneurysm",
        "thoracic-aortic-dilatation",
        "heritable-aortopathy",
        "chronic-aortic-dissection",
      ].includes(c.code),
    ) || s.studies.some((st) => st.kind === "aortic_imaging");
  const congenital = s.conditions.some((c) =>
    ["asd", "vsd", "pda", "coarctation", "congenital-heart-disease"].includes(
      c.code,
    ),
  );
  const genetic =
    congenital ||
    aortic ||
    s.conditions.some((c) =>
      ["hcm", "dcm", "ndlvc", "arvc", "lqts", "cpvt"].includes(c.code),
    );
  const hasHeartFailure =
    s.tags.has("hf") ||
    s.conditions.some((c) => c.code === "ppcm") ||
    (ef?.value_num != null && ef.value_num < 45);
  if (ef?.value_num != null && ef.value_num < 30)
    risks.push("Recorded LVEF <30%: very high-risk ventricular dysfunction");
  if (ef?.value_num != null && ef.value_num >= 30 && ef.value_num <= 45)
    risks.push(
      "Recorded LVEF 30–45%: moderate ventricular impairment needs Pregnancy Heart Team care",
    );
  if (["III", "IV"].includes(s.resolved("nyha").current?.value_text ?? ""))
    risks.push(
      "Recorded NYHA III/IV: high-risk functional limitation; reassess current status",
    );
  if (s.conditions.some((c) => c.code === "ph") && !pah)
    risks.push(
      "Pulmonary hypertension: confirm the group and pregnancy-specific risk",
    );
  if (s.conditions.some((c) => ["af", "flutter"].includes(c.code)))
    risks.push(
      "Atrial arrhythmia: pregnancy-specific rhythm and stroke-prevention review",
    );
  if (pah)
    risks.push("Pulmonary arterial hypertension: very high-risk pregnancy");
  if (mechanical)
    risks.push(
      "Mechanical valve: Pregnancy Heart Team anticoagulation and delivery plan",
    );
  if (aortic)
    risks.push(
      "Aortopathy / bicuspid valve: review the complete aorta and pregnancy-specific strategy",
    );
  if (
    s.conditions.some(
      (c) =>
        c.code === "ppcm" ||
        (c.attributes.aetiology as string[] | undefined)?.includes(
          "Peripartum",
        ),
    )
  )
    risks.push(
      "Previous peripartum cardiomyopathy: counsel about recurrence and residual function",
    );
  if (congenital)
    risks.push(
      "Congenital disease: lesion-specific and fetal cardiology review",
    );
  if (
    s.conditions.some((c) =>
      [
        "as",
        "ms",
        "mr-primary",
        "mr-secondary",
        "tr",
        "hcm",
        "dcm",
        "arvc",
        "vt",
        "cad-ccs",
        "prior-mi",
      ].includes(c.code),
    )
  )
    risks.push("Known cardiac disease: confirm lesion-specific pregnancy risk");
  if (a.mwho === "IV")
    risks.push(
      "mWHO IV: very high-risk counselling with the woman's choices central",
    );
  if (!phase) missing.push("Pregnancy stage");
  if (pregnant && !a.edd) missing.push("Confirmed obstetric due date");
  if (pregnant && gestationDays != null && gestationDays > 294)
    missing.push("Due date has passed: update pregnancy / delivery status");
  if (postpartum && !a.deliveredOn)
    missing.push("Actual delivery / pregnancy end date");
  if (postpartum && (!a.breastfeeding || a.breastfeeding === "Not recorded"))
    missing.push("Breastfeeding status");
  if (!a.mwho || a.mwho === "Not assessed")
    missing.push("Clinician-assigned mWHO 2.0 risk assessment");
  if (!ef && (hasHeartFailure || risks.length))
    missing.push("Measured ventricular function / dated echo review");
  const medicationFlags = eligible
    ? s.meds
        .filter((m) => m.status === "active")
        .flatMap((m) => {
          const issue = pregnancyDrugIssue(
            phase,
            a.breastfeeding ?? null,
            m.code,
            m.tags,
            gestationDays,
            m.doseValue,
          );
          return issue
            ? [{ id: m.id, code: m.code, name: m.name, ...issue }]
            : [];
        })
    : [];
  const highRisks = [
    ...(a.highRisks ?? []),
    ...(s.tags.has("htn") ? ["Chronic hypertension"] : []),
    ...(s.tags.has("ckd") ? ["CKD"] : []),
    ...(s.conditions.some((c) => ["t1dm", "t2dm"].includes(c.code))
      ? ["Pre-existing diabetes"]
      : []),
    ...(s.conditions.some((c) => c.code === "aps")
      ? ["Antiphospholipid syndrome"]
      : []),
  ];
  const moderateRisks = [
    ...(a.moderateRisks ?? []),
    ...(s.patient.age >= 40 ? ["Age ≥40"] : []),
    ...(Number(a.bookingBmi) >= 35 ? ["Booking BMI ≥35"] : []),
  ];
  const aspirinCandidate =
    pregnant &&
    gestationDays != null &&
    gestationDays >= 84 &&
    gestationDays < 252 &&
    (highRisks.length > 0 || moderateRisks.length >= 2);
  const needsHeartTeam =
    missing.some(
      (m) =>
        m === "Clinician-assigned mWHO 2.0 risk assessment" ||
        m.includes("ventricular function"),
    ) ||
    ["II–III", "III", "IV"].includes(a.mwho) ||
    risks.length > 0 ||
    mechanical;
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        condition: condition?.id,
        hint: hint?.id ?? hint?.at,
        attributes: a,
        ef: ef?.id,
        meds: s.meds
          .filter((m) => m.status === "active")
          .map((m) => [m.code, m.doseValue, m.frequency])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        preliminaryBp: preliminaryBp.map((o) => o.id),
        values: [
          "sbp",
          "dbp",
          "spo2",
          "creatinine",
          "platelets",
          "alt",
          "ast",
          "uacr",
          "haemoglobin",
          "potassium",
          "nyha",
        ].map((c) => s.resolved(c).current?.id),
        echo: latestStudy(s, "echo")?.id,
        dx: s.conditions
          .filter((c) => c.code !== "pregnancy-care")
          .map((c) => c.id),
        urgent,
        aspirinCandidate,
        missing,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return {
    eligible,
    key,
    conditionId: condition?.logical_id ?? null,
    phase,
    at: condition?.recorded_at ?? null,
    edd: a.edd ?? null,
    gestationDays,
    deliveredOn: a.deliveredOn ?? null,
    postpartumDays,
    breastfeeding: a.breastfeeding ?? null,
    mwho: a.mwho ?? null,
    needsHeartTeam,
    urgent,
    risks,
    missing,
    medicationFlags,
    highRisks: [...new Set(highRisks)],
    moderateRisks: [...new Set(moderateRisks)],
    aspirinCandidate,
    hypertensive,
    severeBp,
    possiblePreeclampsia,
    hasHeartFailure,
    mechanical,
    congenital,
    genetic,
    aortic,
  };
}
