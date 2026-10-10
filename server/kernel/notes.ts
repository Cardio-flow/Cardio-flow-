// Documentation is output: structured data in, editable narrative out.
import type { Q } from "../db/db.js";
import { MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog.js";
import { fmtDay, localDay } from "../../shared/clinical.js";
import { ApiError } from "./base.js";
import { loadState } from "./state.js";
import { planView } from "./views.js";

export async function draftNote(tx: Q, patientId: string, contextId: string) {
  const s = await loadState(tx, patientId);
  const c = s.contexts.find((x) => x.id === contextId);
  if (!c) throw new ApiError(404, "Visit or admission not found");
  // values entered earlier on the day the visit or admission started belong to it (vitals taken
  // at triage before the visit was opened); compare local days, not UTC timestamps
  const startDay = localDay(c.started_at);
  const within = (at: string) => localDay(at) >= startDay && (!c.ended_at || at <= c.ended_at || localDay(at) === localDay(c.ended_at));
  const lines: string[] = [];
  const title = c.kind === "admission" ? "Discharge summary" : "Clinic note";
  lines.push(`${title} — ${s.patient.name}, ${s.patient.age} y ${s.patient.sex.toLowerCase()}, MRN ${s.patient.mrn}`);
  lines.push(
    c.kind === "admission"
      ? `Admitted ${fmtDay(c.started_at, { year: true })}${c.ended_at ? `, discharged ${fmtDay(c.ended_at, { year: true })}` : ""} · ${c.location ?? ""}`
      : `Seen ${fmtDay(c.started_at, { year: true })} · ${c.service ?? "Cardiology"} · ${c.reasons.join(", ")}`,
  );
  const sm = (c.summary ?? {}) as any;
  if (c.kind === "admission") {
    const r = sm.readmission;
    const facts = [
      sm.route ? `Route: ${sm.route}` : null,
      sm.hfRelated === true ? "HF-related admission" : null,
      r ? `Readmission ${r.days} days after the previous discharge (${r.band})${r.hfReadmission ? ", HF readmission" : ""}` : null,
      sm.los != null ? `Length of stay ${sm.los} day${sm.los === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    if (facts.length) lines.push(facts.join(" · "));
  }
  if (sm.symptoms?.length) lines.push("Presenting symptoms: " + sm.symptoms.join(", "));
  if (sm.narrative) lines.push("Reviewed narrative: " + sm.narrative);
  if (c.kind === "admission" && sm.events?.length) lines.push("In-hospital events: " + sm.events.join(", "));
  if (c.kind === "admission" && sm.dischargeStatus) lines.push(`At discharge: ${sm.dischargeStatus}${sm.destination ? ` · to ${sm.destination.toLowerCase()}` : ""}`);
  if (c.kind === "admission" && sm.handover) lines.push(`Handover / outstanding issues: ${sm.handover}`);
  lines.push("");
  lines.push("Diagnoses: " + (s.conditions.map((d) => d.display).join(", ") || "none recorded"));
  const ef = s.resolved("lvef").current;
  if (ef) lines.push(`LVEF ${formatNumber(ef.value_num!, 0)}% (${ef.quality} Echo, ${fmtDay(ef.effective_at, { year: true })})`);
  const vitals = ["sbp", "hr", "weight", "dry-weight", "kccq", "6mwd"].map((code) => {
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
  const decisions = (await tx.query(`SELECT d.outcome,d.reason,r.title AS recommendation_title,e.title AS event_title,e.detail AS event_detail
    FROM cf.decision d LEFT JOIN cf.recommendation r ON r.id=d.recommendation_id
    LEFT JOIN cf.clinical_event e ON e.ref_type='decision' AND e.ref_id=d.id
    WHERE d.patient_id=$1 AND d.context_id=$2 ORDER BY d.decided_at,d.id`, [patientId, contextId])).rows;
  if (decisions.length) {
    lines.push("", "Decisions:");
    for (const d of decisions) lines.push(`- ${(d.outcome === "acted" ? d.event_title : d.recommendation_title) ?? d.recommendation_title ?? "Clinical decision"} · ${d.outcome}${d.reason || d.event_detail ? ` — ${d.reason || d.event_detail}` : ""}`);
    lines.push("");
  }
  lines.push(
    "Current medications: " +
      (s.meds
        .filter((m) => m.status !== "stopped")
        .map((m) => `${m.name} ${doseLabel(MEDICATION[m.code], m.doseValue)} ${m.frequency ?? ""}${m.status === "held" ? " (HELD)" : m.status === "not_taking" ? " (NOT TAKING, patient report)" : ""}`.trim())
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
