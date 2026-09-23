// Documentation is output: structured data in, editable narrative out.
import type { Q } from "../db/db.js";
import { MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog.js";
import { fmtDay } from "../../shared/clinical.js";
import { ApiError } from "./base.js";
import { loadState } from "./state.js";
import { planView } from "./views.js";

export async function draftNote(tx: Q, patientId: string, contextId: string) {
  const s = await loadState(tx, patientId);
  const c = s.contexts.find((x) => x.id === contextId);
  if (!c) throw new ApiError(404, "Visit or admission not found");
  const within = (at: string) => at >= c.started_at && (!c.ended_at || at <= c.ended_at);
  const lines: string[] = [];
  const title = c.kind === "admission" ? "Discharge summary" : "Clinic note";
  lines.push(`${title} — ${s.patient.name}, ${s.patient.age} y ${s.patient.sex.toLowerCase()}, MRN ${s.patient.mrn}`);
  lines.push(
    c.kind === "admission"
      ? `Admitted ${fmtDay(c.started_at, { year: true })}${c.ended_at ? `, discharged ${fmtDay(c.ended_at, { year: true })}` : ""} · ${c.location ?? ""}`
      : `Seen ${fmtDay(c.started_at, { year: true })} · ${c.service ?? "Cardiology"} · ${c.reasons.join(", ")}`,
  );
  lines.push("");
  lines.push("Diagnoses: " + (s.conditions.map((d) => d.display).join(", ") || "none recorded"));
  const ef = s.resolved("lvef").current;
  if (ef) lines.push(`LVEF ${formatNumber(ef.value_num!, 0)}% (${ef.quality} Echo, ${fmtDay(ef.effective_at, { year: true })})`);
  const vitals = ["sbp", "hr", "weight"].map((code) => {
    const o = s.observations.filter((x) => x.code === code && within(x.effective_at)).sort((a, b) => (a.effective_at < b.effective_at ? 1 : -1))[0];
    return o ? `${MEASURES[code].short} ${formatNumber(o.value_num!, MEASURES[code].decimals)} ${MEASURES[code].unit}` : null;
  }).filter(Boolean);
  const nyha = s.observations.filter((o) => o.code === "nyha" && within(o.effective_at)).pop();
  const cong = s.observations.filter((o) => o.code === "congestion" && within(o.effective_at)).pop();
  if (vitals.length || nyha || cong)
    lines.push("Assessment: " + [...vitals, nyha ? `NYHA ${nyha.value_text}` : null, cong ? `congestion ${cong.value_text!.toLowerCase()}` : null].filter(Boolean).join(" · "));
  const labs = ["potassium", "creatinine", "egfr", "sodium", "nt-probnp", "haemoglobin"].map((code) => {
    const o = s.resolved(code).current;
    return o ? `${MEASURES[code].short} ${formatNumber(o.value_num!, MEASURES[code].decimals)} (${fmtDay(o.effective_at)})` : null;
  }).filter(Boolean);
  if (labs.length) lines.push("Latest results: " + labs.join(", "));
  lines.push("");
  const changes = s.meds.flatMap((m) =>
    m.events.filter((e) => within(e.effective_at) && e.kind !== "continue").map((e) => `${m.name}: ${e.kind}${e.dose_value != null ? " " + doseLabel(MEDICATION[m.code], e.dose_value) : ""}${e.reason ? ` (${e.reason})` : ""}`),
  );
  if (changes.length) lines.push("Medication changes: " + changes.join("; "));
  lines.push(
    "Current medications: " +
      (s.meds
        .filter((m) => m.status !== "stopped")
        .map((m) => `${m.name} ${doseLabel(MEDICATION[m.code], m.doseValue)} ${m.frequency ?? ""}${m.status === "held" ? " (HELD)" : ""}`.trim())
        .join("; ") || "none"),
  );
  const plan = planView(s).filter((p) => p.status === "planned");
  if (plan.length) {
    lines.push("");
    lines.push("Plan:");
    for (const p of plan) lines.push(`- ${p.title}${p.dueDate ? ` — ${fmtDay(p.dueDate, { weekday: true, year: true })}` : ""}`);
  }
  return { title, text: lines.join("\n") };
}
