import type { Q } from "../db/db.js";
import { MEASURES, formatNumber } from "../../shared/catalog.js";
import { daysBetween } from "../../shared/clinical.js";
import { WIZARDS, buildOutcome, missingRequired, type Answers, type WizardContext } from "../../shared/wizards.js";
import { ApiError, audit, journeyEvent, nowIso, uuid, type Actor } from "../kernel/base.js";
import { addPlanAction, medicationEvent, type Changed } from "../kernel/clinical.js";
import { loadState, series, type PatientState } from "../kernel/state.js";
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
