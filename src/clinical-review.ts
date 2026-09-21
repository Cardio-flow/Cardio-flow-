import type { Answers } from "./guided";
import type { CareEntry } from "./care-model";
export const rcriSource = "https://pubmed.ncbi.nlm.nih.gov/10477528/";
export const apixabanSource =
  "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=7be1f4c1-bb2f-4ded-ae9a-515d2a22f93e";
export type ReviewResult = {
  title: string;
  reasons: string[];
  points?: number;
  reference?: string;
  factors?: string[];
};
export function ageOn(birth: string, on: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || !/^\d{4}-\d{2}-\d{2}$/.test(on))
    return NaN;
  return (
    Number(on.slice(0, 4)) -
    Number(birth.slice(0, 4)) -
    (on.slice(5) < birth.slice(5) ? 1 : 0)
  );
}
export function creatinineMg(
  value: unknown,
  unit: unknown,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return;
  return unit === "mg/dL"
    ? value
    : unit === "µmol/L"
      ? Math.round((value / 88.4) * 1e10) / 1e10
      : undefined;
}
export function rcriPreview(
  a: Answers,
  birth: string,
  on: string,
): ReviewResult {
  const reasons: string[] = [],
    factors: string[] = [];
  const age = ageOn(birth, on),
    cr = creatinineMg(a.creatinine, a.creatinine_unit);
  if (!Number.isFinite(age) || age < 50)
    reasons.push("Original study population: age 50 or older.");
  if (
    a.urgency !== "Elective" ||
    a.magnitude !== "Major noncardiac surgery" ||
    a.expected_stay !== "At least 2 days"
  )
    reasons.push(
      "This preview is restricted to elective major noncardiac surgery with an expected stay of at least 2 days.",
    );
  for (const [key, label] of [
    ["high_risk", "High-risk surgery"],
    ["ihd", "Ischaemic heart disease history"],
    ["hf", "Heart failure history"],
    ["stroke", "Cerebrovascular disease history"],
    ["insulin", "Preoperative insulin treatment"],
  ]) {
    if (!["Yes", "No"].includes(String(a[key])))
      reasons.push(`Confirm ${label.toLowerCase()}.`);
    if (a[key] === "Yes") factors.push(label);
  }
  const high = [
    "Intraperitoneal",
    "Intrathoracic",
    "Suprainguinal vascular",
  ].includes(String(a.operation));
  if (!a.operation || (a.high_risk === "Yes") !== high)
    reasons.push(
      "Reconcile surgery category with the high-risk surgery criterion.",
    );
  if (
    cr === undefined ||
    cr > 35 ||
    a.lab_current !== "Confirmed for this assessment"
  )
    reasons.push(
      "Confirm the creatinine result, unit and relevance to this assessment.",
    );
  else if (cr > 2) factors.push("Serum creatinine >2.0 mg/dL");
  if (a.inputs_confirmed !== "Confirmed")
    reasons.push("Review all inputs for this procedure.");
  return {
    title: "RCRI · original 1999 criteria",
    reasons,
    ...(!reasons.length ? { points: factors.length, factors } : {}),
  };
}
export const medicationChecks = [
  ["bleeding_check", "Active pathological bleeding / severe apixaban allergy"],
  [
    "valve_check",
    "Prosthetic valve / significant mitral stenosis / triple-positive APS",
  ],
  [
    "interaction_check",
    "P-gp / CYP3A4 interaction or concurrent antithrombotic requiring review",
  ],
  ["renal_check", "AKI, unstable renal function or dialysis"],
  ["liver_check", "Hepatic impairment / coagulopathy"],
  ["pregnancy_check", "Pregnancy / breastfeeding"],
  [
    "procedure_check",
    "Planned surgery / neuraxial procedure or recent interruption",
  ],
] as const;
export function apixabanPreview(
  a: Answers,
  birth: string,
  on: string,
): ReviewResult {
  const reasons: string[] = [],
    factors: string[] = [],
    age = ageOn(birth, on),
    cr = creatinineMg(a.creatinine, a.creatinine_unit);
  if (!Number.isFinite(age) || age < 18)
    reasons.push("Adult reference only; verify birth date.");
  if (a.indication !== "Nonvalvular AF")
    reasons.push(
      "This reference applies only to adult nonvalvular AF, not VTE or other indications.",
    );
  if (
    typeof a.weight !== "number" ||
    !Number.isFinite(a.weight) ||
    a.weight < 1 ||
    a.weight > 400
  )
    reasons.push("Confirm measured body weight in kg.");
  if (
    cr === undefined ||
    cr > 35 ||
    a.lab_current !== "Confirmed for this assessment"
  )
    reasons.push("Confirm creatinine, unit and relevance to this assessment.");
  if (
    typeof a.crcl !== "number" ||
    !Number.isFinite(a.crcl) ||
    a.crcl < 30 ||
    a.crcl > 250
  )
    reasons.push(
      "A clinician-verified creatinine clearance of at least 30 mL/min is required for this limited preview. Other renal contexts need specialist label review.",
    );
  for (const [key, label] of medicationChecks)
    if (a[key] !== "Reviewed — absent / not applicable")
      reasons.push(`Review: ${label}.`);
  if (a.inputs_confirmed !== "Confirmed")
    reasons.push(
      "Confirm patient context and the full prescribing-information review.",
    );
  if (age >= 80) factors.push("Age ≥80 years");
  if (typeof a.weight === "number" && a.weight <= 60)
    factors.push("Weight ≤60 kg");
  if (cr !== undefined && cr >= 1.5)
    factors.push("Serum creatinine ≥1.5 mg/dL");
  return {
    title: "Apixaban · adult NVAF label reference",
    reasons,
    ...(!reasons.length
      ? {
          reference:
            factors.length >= 2
              ? "2.5 mg orally twice daily"
              : "5 mg orally twice daily",
          factors,
        }
      : {}),
  };
}
export type ReusableFact = {
  key: string;
  value: string | number;
  label: string;
  source: CareEntry;
};
export function reusableFacts(
  entries: CareEntry[],
  target: string,
): ReusableFact[] {
  const facts: ReusableFact[] = [];
  const newest = [...entries].sort(
    (a, b) =>
      b.occurred_on.localeCompare(a.occurred_on) ||
      b.updated_at.localeCompare(a.updated_at),
  );
  function push(
    key: string,
    value: string | number,
    label: string,
    e: CareEntry,
  ) {
    if (!facts.some((f) => f.key === key))
      facts.push({ key, value, label, source: e });
  }
  for (const e of newest) {
    const a = e.structured ?? {};
    if (
      e.kind === "problem" &&
      a.certainty === "Confirmed" &&
      target === "procedure.noncardiac_surgery"
    ) {
      const map: Record<string, [string, string]> = {
        "problem.cad": ["ihd", "Ischaemic heart disease history"],
        "problem.acs": ["ihd", "Ischaemic heart disease history"],
        "problem.hf": ["hf", "Heart failure history"],
        "problem.stroke": ["stroke", "Cerebrovascular history"],
      };
      const match = map[e.template_key ?? ""];
      if (match) push(match[0], "Yes", match[1], e);
      if (e.template_key === "problem.diabetes" && a.insulin === "Yes")
        push(
          "insulin",
          "Yes",
          "Insulin documented — confirm current therapy",
          e,
        );
    }
    if (
      e.kind === "investigation" &&
      ["resulted", "reviewed"].includes(e.status) &&
      typeof a.value === "number"
    ) {
      if (
        e.template_key === "investigation.creatinine" &&
        ["procedure.noncardiac_surgery", "medication.apixaban"].includes(target)
      ) {
        push("creatinine", a.value, "Recorded creatinine", e);
        if (typeof a.unit === "string")
          push("creatinine_unit", a.unit, "Recorded creatinine unit", e);
      }
      if (
        e.template_key === "investigation.weight" &&
        target === "medication.apixaban" &&
        a.unit === "kg"
      )
        push("weight", a.value, "Recorded body weight", e);
    }
  }
  return facts;
}
export function documentationAlerts(entries: CareEntry[], today: string) {
  return entries.flatMap((e) => {
    if (
      [
        "resolved",
        "completed",
        "cancelled",
        "reviewed",
        "discontinued",
        "excluded",
      ].includes(e.status)
    )
      return [];
    const alerts: {
      id: string;
      title: string;
      detail: string;
      entry: CareEntry;
    }[] = [];
    const add = (code: string, title: string, detail: string) =>
      alerts.push({ id: `${e.id}:${code}`, title, detail, entry: e });
    if (e.due_date && e.due_date < today)
      add(
        "overdue",
        "Review overdue",
        `${e.title} · due ${e.due_date} · ${e.owner}`,
      );
    if (e.kind === "medication" && e.status === "held")
      add(
        "held",
        "Held medication needs reassessment",
        `${e.title} · ${e.details.reason || "reason missing"}`,
      );
    if (
      e.kind === "complication" &&
      ["managing", "reassessing"].includes(e.status) &&
      (!e.structured?.clinical_response ||
        e.structured.clinical_response === "Not yet assessed")
    )
      add("response", "Complication response not recorded", e.title);
    if (
      e.kind === "complication" &&
      (e.structured?.clinical_response === "Deteriorating" ||
        e.structured?.stability === "Unstable")
    )
      add(
        "deterioration",
        "Deterioration recorded — review required",
        `${e.title} · recorded by ${e.owner}`,
      );
    if (
      e.kind === "complication" &&
      e.template_key === "complication.bleeding" &&
      entries.some(
        (m) =>
          m.kind === "medication" &&
          ["prescribed", "administered"].includes(m.status) &&
          [
            "medication.apixaban",
            "medication.rivaroxaban",
            "medication.dabigatran",
            "medication.edoxaban",
            "medication.warfarin",
            "medication.aspirin",
            "medication.clopidogrel",
            "medication.ticagrelor",
            "medication.prasugrel",
            "medication.enoxaparin",
            "medication.unfractionated_heparin",
          ].includes(m.template_key ?? ""),
      )
    )
      add(
        "antithrombotic",
        "Bleeding and active antithrombotic records",
        "Reconcile the documented medication plan with the treating team; records may not reflect current administration.",
      );
    if (e.kind === "investigation" && e.status === "resulted")
      add("result", "Result awaits clinical review", e.title);
    return alerts;
  });
}
