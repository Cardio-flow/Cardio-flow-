import type { Q } from "../db/db.js";
import { MEASURES, formatNumber } from "../../shared/catalog.js";
import { daysBetween } from "../../shared/clinical.js";
import { WIZARDS, buildOutcome, missingRequired, optionsFor, type Answers, type WizardContext } from "../../shared/wizards.js";
import { ApiError, audit, journeyEvent, nowIso, uuid, type Actor } from "../kernel/base.js";
import { addPlanAction, medicationEvent, type Changed } from "../kernel/clinical.js";
import { latestStudy, loadState, series, type PatientState } from "../kernel/state.js";
import { recentRaasStart } from "./rules.js";

export function wizardContext(s: PatientState, wizardId: string): WizardContext {
  const meds = s.meds
    .filter((m) => m.status === "active" || m.status === "held")
    .map((m) => ({ id: m.id, code: m.code, name: m.name, doseValue: m.doseValue, doseUnit: m.doseUnit, frequency: m.frequency, tags: m.tags }));
  const fact = (code: string, tone?: string) => {
    const c = s.resolved(code).current;
    if (!c) return { label: MEASURES[code]?.display ?? code, value: "Not available", tone: "orange" };
    return { label: code === "sbp" ? "Systolic BP" : code === "hr" ? "Heart rate" : MEASURES[code].short === "Cr" ? "Creatinine" : MEASURES[code].short, value: `${formatNumber(c.value_num!, MEASURES[code].decimals)} ${MEASURES[code].unit}`, date: c.effective_at, tone };
  };
  const detected: Record<string, string[]> = { contributors: [] };
  const cr = series(s, "creatinine");
  const wrf = cr.length > 1 && cr[0].value_num! - Math.min(...cr.slice(1).map((o) => o.value_num!)) >= 26.5;
  if (recentRaasStart(s)) detected.contributors.push("raas-start");
  if (s.meds.some((m) => m.status === "active" && m.tags.includes("mra")) && wizardId === "hyperkalaemia") detected.contributors.push("mra");
  if (wrf && wizardId === "hyperkalaemia") detected.contributors.push("wrf");
  if (wizardId === "renal-function") {
    if (s.meds.some((m) => m.tags.includes("sglt2") && m.startedAt && daysBetween(m.startedAt, s.today) <= 30)) detected.contributors.push("sglt2-start");
    const wt = series(s, "weight");
    if (wt.length > 1 && wt[0].value_num! < wt[wt.length - 1].value_num! - 1.5 && s.meds.some((m) => m.status === "active" && m.tags.includes("loop")))
      detected.contributors.push("diuretic");
  }
  const on = (tag: string) => s.meds.some((m) => m.status === "active" && m.tags.includes(tag));
  if (wizardId === "congestion" || wizardId === "hypotension" || wizardId === "bradycardia") return extraContext(s, wizardId, meds, fact, on, detected);
  const def = WIZARDS[wizardId];
  if (def?.facts) {
    // content-driven wizards: facts, trend and AUTO detection all come from the definition
    for (const q of def.steps.flatMap((st) => st.questions))
      for (const o of q.options ?? []) if (o.detectTag?.some((t) => on(t))) (detected[q.id] ??= []).push(o.value);
    const t = def.trend ? series(s, def.trend).slice(0, 5).reverse() : [];
    return {
      today: s.today, meds, detected,
      facts: def.facts.filter((c) => MEASURES[c]).map((c) => fact(c)),
      trend: def.trend && MEASURES[def.trend] ? { code: def.trend, label: MEASURES[def.trend].display, unit: MEASURES[def.trend].unit, points: t.map((o) => ({ date: o.effective_at, value: o.value_num! })) } : undefined,
    };
  }
  const code = wizardId === "hyperkalaemia" ? "potassium" : "creatinine";
  const hist = series(s, code).slice(0, 3).reverse();
  const facts =
    wizardId === "hyperkalaemia"
      ? [fact("creatinine"), fact("egfr"), fact("sbp"), fact("hr")]
      : [fact("potassium"), fact("egfr"), fact("sbp"), fact("weight")];
  return {
    today: s.today,
    meds,
    facts,
    detected,
    trend: { code, label: MEASURES[code].display, unit: MEASURES[code].unit, points: hist.map((o) => ({ date: o.effective_at, value: o.value_num! })) },
  };
}

export async function getWizard(tx: Q, patientId: string, wizardId: string) {
  if (!WIZARDS[wizardId]) throw new ApiError(404, "Unknown wizard");
  const s = await loadState(tx, patientId);
  const draft = (
    await tx.query(`SELECT id,answers,step,recommendation_id FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1`, [patientId, wizardId])
  ).rows[0];
  return { context: wizardContext(s, wizardId), draft: draft ?? null };
}

export async function saveDraft(tx: Q, actor: Actor, patientId: string, wizardId: string, input: { answers: Answers; step: number; recommendationId?: string | null }) {
  const existing = (await tx.query(`SELECT id FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft'`, [patientId, wizardId])).rows[0];
  if (existing)
    await tx.query(`UPDATE cf.wizard_draft SET answers=$2, step=$3, updated_by=$4, updated_at=now() WHERE id=$1`, [existing.id, JSON.stringify(input.answers), input.step, actor.id]);
  else
    await tx.query(`INSERT INTO cf.wizard_draft(id,patient_id,wizard,recommendation_id,answers,step,status,updated_by) VALUES($1,$2,$3,$4,$5,$6,'draft',$7)`, [
      uuid(), patientId, wizardId, input.recommendationId ?? null, JSON.stringify(input.answers), input.step, actor.id,
    ]);
}

export async function completeWizard(
  tx: Q,
  actor: Actor,
  patientId: string,
  wizardId: string,
  input: { answers: Answers; recommendationId?: string | null; contextId?: string | null },
) {
  const def = WIZARDS[wizardId];
  if (!def) throw new ApiError(404, "Unknown wizard");
  for (const step of def.steps) {
    const missing = missingRequired(step, input.answers);
    if (missing.length) throw new ApiError(400, `Answer "${missing[0].label}" before confirming`);
  }
  const s = await loadState(tx, patientId);
  const ctx = wizardContext(s, wizardId);
  // an option that does not fit the patient's medicines cannot be confirmed
  for (const q of def.steps.flatMap((st) => st.questions).filter((q) => q.options)) {
    const allowed = new Set(optionsFor(q, ctx).map((o) => o.value));
    const chosen = input.answers[q.id];
    for (const v of Array.isArray(chosen) ? chosen : chosen != null ? [String(chosen)] : [])
      if (!allowed.has(String(v))) throw new ApiError(400, `"${q.options!.find((o) => o.value === v)?.label ?? v}" does not apply to this patient's medicines`);
  }
  const outcome = buildOutcome(wizardId, input.answers, ctx);
  const decisionId = uuid();
  await tx.query(
    `INSERT INTO cf.decision(id,patient_id,recommendation_id,wizard,outcome,answers,context_id,decided_by) VALUES($1,$2,$3,$4,'acted',$5,$6,$7)`,
    [decisionId, patientId, input.recommendationId ?? null, wizardId, JSON.stringify(input.answers), input.contextId ?? null, actor.id],
  );
  const at = nowIso();
  const changed: Changed = ["plan"];
  for (const item of outcome) {
    if (item.kind === "medication") {
      changed.push(...(await medicationEvent(tx, actor, patientId, item.medicationId, {
        kind: item.event, doseValue: item.doseValue, reason: def.title, effectiveAt: at, contextId: input.contextId, decisionId,
      })));
    } else if (item.kind === "plan") {
      await addPlanAction(tx, actor, patientId, {
        category: item.category, title: item.title, reason: def.title, dueDate: item.dueDate, completesOn: item.completesOn, contextId: input.contextId, decisionId,
      });
    }
  }
  if (input.recommendationId)
    await tx.query(`UPDATE cf.recommendation SET status='decided', closed_at=now() WHERE id=$1 AND patient_id=$2 AND status='active'`, [input.recommendationId, patientId]);
  await tx.query(`UPDATE cf.wizard_draft SET status='completed', updated_at=now() WHERE patient_id=$1 AND wizard=$2 AND status='draft'`, [patientId, wizardId]);
  const actions = (input.answers.actions as string[] | undefined) ?? [];
  await journeyEvent(tx, actor, {
    patientId, occurredAt: at, kind: "complication-review", category: "complication",
    title: def.title,
    detail: outcome.map((o) => o.label).filter(Boolean).join(" · ") || actions.join(", "),
    refType: "decision", refId: decisionId, contextId: input.contextId,
  });
  await audit(tx, actor, "complete-wizard", "decision", decisionId, patientId, { wizard: wizardId });
  return { decisionId, outcome, changed: [...new Set(changed)] };
}

export async function declineRecommendation(tx: Q, actor: Actor, patientId: string, recommendationId: string, input: { outcome: "declined" | "deferred"; reason: string }) {
  const rec = (await tx.query(`SELECT * FROM cf.recommendation WHERE id=$1 AND patient_id=$2 AND status='active'`, [recommendationId, patientId])).rows[0];
  if (!rec) throw new ApiError(404, "This alert is no longer active");
  if (!input.reason.trim()) throw new ApiError(400, "Give a short reason");
  await tx.query(`INSERT INTO cf.decision(id,patient_id,recommendation_id,outcome,reason,decided_by) VALUES($1,$2,$3,$4,$5,$6)`, [
    uuid(), patientId, recommendationId, input.outcome, input.reason, actor.id,
  ]);
  await tx.query(`UPDATE cf.recommendation SET status='decided', closed_at=now() WHERE id=$1`, [recommendationId]);
  await audit(tx, actor, input.outcome, "recommendation", recommendationId, patientId, { reason: input.reason });
}

// Congestion, hypotension and bradycardia: facts, trend and what the record already shows.
function extraContext(
  s: PatientState,
  wizardId: string,
  meds: WizardContext["meds"],
  fact: (code: string, tone?: string) => WizardContext["facts"][number],
  on: (tag: string) => boolean,
  detected: Record<string, string[]>,
): WizardContext {
  const recentDays = (iso: string) => daysBetween(iso, s.today);
  const ecg = latestStudy(s, "ecg", 90);
  const holter = latestStudy(s, "holter", 90);
  const studyFacts = [ecg, holter].filter(Boolean).map((st) => ({ label: st!.kind === "ecg" ? "ECG" : "Holter", value: st!.findings[0] ?? "recorded", date: st!.performed_at }));
  if (wizardId === "congestion") {
    const wt = series(s, "weight").filter((o) => recentDays(o.effective_at) <= 7);
    detected.signs = [];
    if (wt.length > 1 && wt[0].value_num! - Math.min(...wt.slice(1).map((o) => o.value_num!)) >= 2) detected.signs.push("weight");
    const cong = s.resolved("congestion").current;
    if (cong && ["Moderate", "Severe"].includes(cong.value_text ?? "") && recentDays(cong.effective_at) <= 7) detected.signs.push("oedema");
    detected.precipitants = [];
    if (ecg && /fibrillation|flutter/i.test(ecg.attributes.rhythm ?? "") && recentDays(ecg.performed_at) <= 30) detected.precipitants.push("af");
    if (on("ndhp-ccb")) detected.precipitants.push("drugs");
    const cr = series(s, "creatinine");
    if (cr.length > 1 && cr[0].value_num! - Math.min(...cr.slice(1).map((o) => o.value_num!)) >= 26.5) detected.precipitants.push("renal");
    const hist = series(s, "weight").slice(0, 5).reverse();
    return {
      today: s.today, meds, detected,
      facts: [fact("weight"), fact("sbp"), fact("creatinine"), fact("potassium"), fact("nt-probnp"), ...studyFacts.slice(0, 1)],
      trend: { code: "weight", label: "Weight", unit: "kg", points: hist.map((o) => ({ date: o.effective_at, value: o.value_num! })) },
    };
  }
  if (wizardId === "hypotension") {
    detected.contributors = [];
    if (on("vasodilator")) detected.contributors.push("vasodilator");
    const cong = s.resolved("congestion").current;
    if (on("loop") && cong?.value_text === "None") detected.contributors.push("diuretic");
    if (s.meds.some((m) => m.events.some((e) => e.kind === "increase" && recentDays(e.effective_at) <= 14))) detected.contributors.push("recent-uptitration");
    const hist = series(s, "sbp").slice(0, 5).reverse();
    return {
      today: s.today, meds, detected,
      facts: [fact("sbp"), fact("dbp"), fact("hr"), fact("creatinine"), fact("weight")],
      trend: { code: "sbp", label: "Systolic BP", unit: "mmHg", points: hist.map((o) => ({ date: o.effective_at, value: o.value_num! })) },
    };
  }
  // bradycardia
  detected.contributors = [];
  for (const [tag, v] of [["bb", "bb"], ["ivabradine", "ivabradine"], ["digoxin", "digoxin"], ["qt", "amiodarone"], ["ndhp-ccb", "ccb"]] as const) if (on(tag)) detected.contributors.push(v);
  if ((s.resolved("potassium").current?.value_num ?? 0) > 5.5) detected.contributors.push("hyperkalaemia");
  const av = [ecg, holter].map((st) => st?.attributes.avBlock).find(Boolean);
  const block =
    av === "Mobitz II" || av === "Complete" ? "high-grade"
    : holter && Number(holter.attributes.longestPause ?? 0) >= 3 ? "pauses"
    : av === "Mobitz I" ? "mobitz1"
    : av === "First-degree" ? "first-degree"
    : ecg && /fibrillation/i.test(ecg.attributes.rhythm ?? "") ? "slow-af"
    : ecg ? "sinus-brady" : "no-ecg";
  detected.block = [block];
  const hist = series(s, "hr").slice(0, 5).reverse();
  return {
    today: s.today, meds, detected,
    facts: [fact("hr"), fact("sbp"), fact("potassium"), fact("tsh"), ...studyFacts],
    trend: { code: "hr", label: "Heart rate", unit: "bpm", points: hist.map((o) => ({ date: o.effective_at, value: o.value_num! })) },
  };
}
