// Documentation is output: structured data in, editable narrative out.
import { evidenceKey } from "./evidence.js";
import type { Q } from "../db/db.js";
import { MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog.js";
import { fmtDay, localDay } from "../../shared/clinical.js";
import { ApiError } from "./base.js";
import { loadState } from "./state.js";
import { diagnosisLines, planView } from "./views.js";

export async function draftNote(tx: Q, patientId: string, contextId: string, opts: {preferSaved?: boolean} = {}) {
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
      ? `Admitted ${fmtDay(c.started_at, { year: true })}${c.ended_at ? `, discharged ${fmtDay(c.ended_at, { year: true })}` : ""}${c.location ? ` · ${c.location}` : ""}`
      : `Seen ${fmtDay(c.started_at, { year: true })} · ${c.service ?? "Cardiology"} · ${c.reasons.join(", ")}`,
  );
  const sm = (c.summary ?? {}) as any;
  if(sm.historical) {
    lines[0]=`${title} — ${s.patient.name}, MRN ${s.patient.mrn}`;
    lines.push(`Historical record · ${sm.source ?? "source not recorded"} · dates only`,"Reason: "+c.reasons.join(", "));
    if(sm.narrative) lines.push("Admission history: "+sm.narrative);
    if(sm.events?.length) lines.push("In-hospital events: "+sm.events.join(", "));
    if(sm.dischargeStatus) lines.push("Condition at discharge: "+sm.dischargeStatus);
    if(sm.destination) lines.push("Destination: "+sm.destination);
    if(sm.note) lines.push("Discharge summary:\n"+sm.note);
    if(sm.reportedLabs) lines.push("Labs during admission (reported):\n"+sm.reportedLabs);
    if(sm.reportedMedications) lines.push("Medicines at discharge (historical):\n"+sm.reportedMedications);
    return {title,text:lines.join("\n"),evidenceKey:evidenceKey(s)};
  }
  if (opts.preferSaved && c.status === "closed" && sm.note?.trim())
    return {title, text: sm.note as string, evidenceKey:evidenceKey(s)};
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
  // the same lines as the patient header: IHD with its dated events, devices, risk factors apart (19 Oct audit)
  const dx = diagnosisLines(s);
  lines.push("Diagnoses: " + (dx.diagnoses.join("; ") || "none recorded"));
  if (dx.riskFactors.length) lines.push("Risk factors: " + dx.riskFactors.join(", "));
  if (dx.other.length) lines.push("Other conditions: " + dx.other.join(", "));
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
    return o ? `${MEASURES[code].short} ${formatNumber(o.value_num!, MEASURES[code].decimals)} (${fmtDay(o.effective_at, { year: true })})` : null;
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
    // one line per decision: what, the outcome, the reason; the pathway's questions and answers stay in the
    // journey and its dated items are listed under Plan (19 Oct audit: the Q&A was pasted into summaries)
    const OUTCOME: Record<string, string> = { acted: "done", deferred: "deferred", declined: "not done", dismissed: "not applicable" };
    for (const d of decisions) {
      const notTaken = /Guideline suggestions not taken: (.*)$/.exec(String(d.event_detail ?? ""))?.[1];
      const what = (d.outcome === "acted" ? d.event_title : d.recommendation_title) ?? d.recommendation_title ?? "Clinical decision";
      lines.push(`- ${what}: ${OUTCOME[d.outcome] ?? d.outcome}${d.reason ? ` — ${d.reason}` : ""}${notTaken ? ` (guideline suggestion not chosen: ${notTaken})` : ""}`);
    }
    lines.push("");
  }
  lines.push(
    "Current medications: " +
      (s.meds
        .filter((m) => m.status !== "stopped")
        .map((m) => `${m.name} ${doseLabel(MEDICATION[m.code], m.doseValue)} ${m.frequency ?? ""}${m.route && m.route !== "PO" ? ` ${m.route}` : ""}${m.status === "held" ? " (HELD)" : m.status === "not_taking" ? " (NOT TAKING, patient report)" : ""}`.trim())
        .join("; ") || "none"),
  );
  const plan = planView(s).filter((p) => p.status === "planned");
  if (plan.length) {
    lines.push("");
    lines.push("Plan:");
    for (const p of plan) lines.push(`- ${p.title}${p.dueDate ? ` — ${fmtDay(p.dueDate, { weekday: true, year: true })}` : ""}`);
  }
  return { title, text: lines.join("\n"), evidenceKey: evidenceKey(s) };
}
