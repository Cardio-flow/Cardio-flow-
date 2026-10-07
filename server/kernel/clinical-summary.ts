// Patient summary (7 Oct 2026, Ahmed: "Make patient summary"): one short, copyable account of the patient —
// who, problems, heart function, key results, investigations, procedures, medicines and what is open.
// Read-only projection of the record; no interpretation beyond what the record says.
import { MEASURES, doseLabel, formatNumber, MEDICATION } from "../../shared/catalog.js";
import { fmtDay, localDay } from "../../shared/clinical.js";
import { STUDY_LABEL, studySummary } from "../../shared/studies.js";
import type { PatientState } from "./state.js";

const KEY_RESULTS = ["creatinine", "egfr", "potassium", "haemoglobin", "nt-probnp", "ldl-c", "hba1c", "sbp", "dbp", "hr"];
const STUDY_ORDER = ["echo", "nuclear", "stress", "ccta", "cath", "cmr", "abpm", "holter", "ecg", "device_check"];

export function clinicalSummary(s: PatientState, header: { diagnoses: { code: string; label: string; family: string }[]; birthDateEstimated?: boolean }, attention: { severity: string; title: string }[]) {
  const sex = s.patient.sex === "Male" ? "man" : "woman";
  const who = `${s.patient.birth_date_estimated ? "About " : ""}${s.patient.age}-year-old ${sex}`;
  const cardiac = header.diagnoses.filter((d) => d.family !== "Comorbidity").map((d) => d.label);
  const comorb = header.diagnoses.filter((d) => d.family === "Comorbidity").map((d) => d.label);
  const ef = s.resolved("lvef").current;
  const lines: { label: string; value: string }[] = [];
  if (cardiac.length) lines.push({ label: "Cardiac", value: cardiac.join(" · ") });
  if (comorb.length) lines.push({ label: "Comorbidities", value: comorb.join(" · ") });
  if (ef?.value_num != null) lines.push({ label: "LV function", value: `LVEF ${formatNumber(ef.value_num, 0)}% (${fmtDay(ef.effective_at, { year: true })}${ef.source ? `, ${ef.source}` : ""})` });
  const res = KEY_RESULTS.map((c) => ({ c, o: s.resolved(c).current })).filter((x) => x.o?.value_num != null)
    .map(({ c, o }) => `${MEASURES[c]?.short ?? c} ${formatNumber(o!.value_num!, MEASURES[c]?.decimals ?? 0)}${MEASURES[c]?.unit ? ` ${MEASURES[c].unit}` : ""} (${fmtDay(o!.effective_at)})`);
  if (res.length) lines.push({ label: "Key results", value: res.join(" · ") });
  // the latest study of each kind, newest first
  const latest = new Map<string, (typeof s.studies)[number]>();
  for (const st of s.studies) latest.set(st.kind, st);
  const studies = [...latest.values()]
    .sort((a, b) => STUDY_ORDER.indexOf(a.kind) - STUDY_ORDER.indexOf(b.kind))
    .map((st) => {
      const text = st.kind === "echo" ? [st.findings.join(", ")].filter(Boolean).join("") : studySummary(st.kind, st.attributes ?? {});
      return `${STUDY_LABEL[st.kind] ?? st.kind} ${fmtDay(st.performed_at, { year: true })}${text ? `: ${text}` : ""}`;
    });
  if (studies.length) lines.push({ label: "Investigations", value: studies.join(" · ") });
  if (s.procedures.length) lines.push({ label: "Procedures", value: [...s.procedures].reverse().slice(0, 4).map((p) => `${p.summary || p.kind} (${fmtDay(p.performed_at, { year: true })})`).join(" · ") });
  const meds = s.meds.filter((m) => m.status === "active" || m.status === "held" || m.status === "not_taking");
  if (meds.length)
    lines.push({
      label: "Medicines",
      value: meds.map((m) => `${m.name}${m.doseValue != null ? ` ${doseLabel(MEDICATION[m.code], m.doseValue)}` : ""}${m.frequency ? ` ${m.frequency}` : ""}${m.status === "held" ? " (held)" : m.status === "not_taking" ? " (not taking)" : ""}`).join(" · "),
    });
  if (s.patient.allergies && s.patient.allergies !== "Not recorded") lines.push({ label: "Allergies", value: s.patient.allergies });
  const red = attention.filter((a) => a.severity === "red").length, orange = attention.filter((a) => a.severity === "orange").length;
  const nextPlan = s.plan.filter((p) => p.status === "planned" && p.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
  const open = [
    red ? `${red} safety alert${red > 1 ? "s" : ""}` : null,
    orange ? `${orange} decision${orange > 1 ? "s" : ""} to review` : null,
    nextPlan ? `next: ${nextPlan.title} (${fmtDay(nextPlan.due_date!)})` : null,
  ].filter(Boolean);
  if (open.length) lines.push({ label: "Open", value: open.join(" · ") });
  const opening = `${who}${cardiac.length ? ` with ${cardiac.slice(0, 3).join(", ").replace(/ · EF \d+%/g, "")}` : ""}.`;
  const text = [opening, ...lines.map((l) => `${l.label}: ${l.value}.`)].join("\n");
  return { opening, lines, text, asOf: localDay(new Date().toISOString()) };
}
