// The pathway as the app's hidden decision engine (14 Oct 2026, Ahmed: "make the pathways the hidden brain …
// collect the data needed for the decision and only give us what is necessary to fill before the decision").
//
// For an alert that opens a pathway, the pathway is run without showing it: every answer the record gives
// (detected) or the guideline gives (suggestions, dose halving) is filled in; what is left are the questions
// only the clinician can answer, and results the decision needs that are missing or out of date. The plan the
// pathway would record — medicine changes with doses, dated infusions, rechecks and reviews — is returned with
// the reasons, so the alert card can show it and record it with one confirmation. Nothing is recorded here.
import type { Q } from "../db/db.js";
import { WIZARDS, buildOutcome, doseChoices, missingRequired, optionsFor, visibleQuestions, type Answers, type WizardContext } from "../../shared/wizards.js";
import { prefill } from "../../shared/wizard-prefill.js";
import { suggest } from "../../shared/wizard-guidance.js";
import { MEASURES } from "../../shared/catalog.js";
import { fmtDay } from "../../shared/clinical.js";
import { ironInputs } from "../../shared/wizards-iron.js";
import { getWizard } from "./wizard.js";
import { safetyHits } from "./med-safety.js";
import { loadState } from "../kernel/state.js";
import { RENAL_DEFAULTS } from "./renal-trend.js";
import { doseLabel, MEDICATION } from "../../shared/catalog.js";

// results a pathway's decision depends on: missing or older than `days` → asked for before the decision
const ironNeeds = (ctx: WizardContext) => {
    const { hb, weight } = ironInputs(ctx);
    return [
      ...(hb == null ? [{ code: "haemoglobin", days: 90, why: "the total iron dose depends on it (SmPC Table 1)" }] : []),
      ...(weight == null ? [{ code: "weight", days: 365, why: "the total iron dose and the per-infusion limit (20 mg/kg) depend on it" }] : []),
    ];
};
const NEEDS: Record<string, (ctx: WizardContext, a: Answers) => { code: string; days: number; why: string }[]> = {
  "iv-iron": (ctx, a) => (a.decision === "give" ? ironNeeds(ctx) : []),
  "anaemia-result": (ctx, a) => (Array.isArray(a.actions) && a.actions.includes("iv") ? ironNeeds(ctx) : []),
  "renal-function": (ctx) => [
    ...(ctx.values?.potassium && fresh(ctx, ctx.values.potassium.at, 30) ? [] : [{ code: "potassium", days: 30, why: "decides whether the MRA/RAAS doses can stay" }]),
  ],
  hyperkalaemia: (ctx) => [...(ctx.values?.creatinine && fresh(ctx, ctx.values.creatinine.at, 30) ? [] : [{ code: "creatinine", days: 30, why: "renal function with the potassium" }])],
};
const fresh = (ctx: WizardContext, at: string, days: number) => (Date.parse(ctx.today) - Date.parse(at.slice(0, 10))) / 86400000 <= days;

// medicines to look at with this decision (the safety table's condition rows: renal limits, contraindications)
const MED_REVIEW: Record<string, string[]> = {
  "renal-function": ["metformin-renal", "rosuvastatin-renal", "atenolol-renal", "renal-severe", "renal-contraindicated", "doac-crcl-15", "dronedarone-creatinine"],
};

export async function previewDecision(tx: Q, patientId: string, wizardId: string, given: Answers = {}) {
  const def = WIZARDS[wizardId];
  const { context: ctx } = await getWizard(tx, patientId, wizardId);
  const { answers, suggested } = prefill(wizardId, ctx, given);
  const all = def.steps.flatMap((st) => visibleQuestions(st, answers));
  // the reasons behind every filled answer: the record (detected) or the guideline (suggestion)
  const reasons: { question: string; answer: string; why: string; source: "record" | "guideline" | "you" }[] = [];
  for (const q of all) {
    const v = answers[q.id];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const vals = (Array.isArray(v) ? v : [String(v)]).filter((x) => x !== "none");
    if (!vals.length) continue;
    const opts = q.type === "dose" ? doseChoices(ctx, q).options : optionsFor(q, ctx);
    const label = vals.map((x) => opts.find((o) => o.value === x)?.label ?? x).join(" · ");
    const from = Object.hasOwn(given, q.id) ? "you" : ctx.detected[q.id]?.length ? "record" : "guideline";
    const why = q.type === "dose"
      ? "Halve the dose (ESC HF practical guidance): the largest listed dose at or below half"
      : suggest(wizardId, q.id, answers, ctx).filter((x) => vals.includes(x.value)).map((x) => x.why).join(" · ");
    reasons.push({ question: q.label, answer: label, why, source: from });
  }
  // what only the clinician can answer
  const needed = def.steps.flatMap((st) => missingRequired(st, answers)).map((q) => ({
    id: q.id, label: q.label, help: q.help ?? null, type: q.type,
    options: q.type === "dose" ? doseChoices(ctx, q).options : optionsFor(q, ctx),
  }));
  const needData = (NEEDS[wizardId]?.(ctx, answers) ?? []).map((n) => ({ ...n, label: MEASURES[n.code]?.display ?? n.code, last: ctx.values?.[n.code] ? { value: ctx.values[n.code].value, at: ctx.values[n.code].at } : null }));
  const plan = needed.length ? [] : buildOutcome(wizardId, answers, ctx).map((o) => ({
    kind: o.kind, label: o.kind === "plan" ? `${o.title} · ${fmtDay(o.dueDate, { weekday: true, year: true })}` : o.label,
    ...(o.kind === "plan" ? { dueDate: o.dueDate, category: o.category } : {}),
  }));
  const s = await loadState(tx, patientId);
  const ids = MED_REVIEW[wizardId] ?? [];
  const medReview = [
    ...(ids.length ? safetyHits(s, "condition").filter(({ row }) => ids.includes(row.id)).map(({ row, hit }) => ({ title: row.title(hit), source: row.source, tone: "warn" as const })) : []),
    ...(wizardId === "renal-function" ? renalKeep(ctx, answers) : []),
  ];
  return {
    wizard: wizardId, title: def.title, note: def.note, source: def.sourceShort ?? def.source ?? null,
    answers, suggested, reasons, needed, needData, plan, medReview,
    ready: !needed.length && !needData.length,
  };
}

// renal deterioration: the disease-modifying medicines that stay, and why (so "no change" is a stated decision)
function renalKeep(ctx: WizardContext, a: Answers) {
  const cr = ctx.renal?.current ?? ctx.values?.creatinine?.value ?? null, egfr = ctx.values?.egfr?.value ?? null;
  const acts = (a.actions as string[] | undefined) ?? [];
  const severe = !!ctx.renal?.stop;
  const out: { title: string; source: string; tone: "keep" }[] = [];
  const line = (m: (typeof ctx.meds)[number]) => `${m.name} ${doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)}`;
  for (const m of ctx.meds.filter((x) => x.tags.includes("mra")))
    if (!severe && !acts.includes("reduce-mra") && !acts.includes("hold-mra") && cr != null && cr <= RENAL_DEFAULTS.mra_review_cr_umol && (egfr == null || egfr >= RENAL_DEFAULTS.mra_review_egfr))
      out.push({ title: `${line(m)}: keep — creatinine ${Math.round(cr)} µmol/L ≤${RENAL_DEFAULTS.mra_review_cr_umol}${egfr != null ? ` and eGFR ${Math.round(egfr)} ≥${RENAL_DEFAULTS.mra_review_egfr}` : ""}; recheck potassium with the creatinine`, tone: "keep", source: "ESC HF practical guidance on MRA: halve if creatinine >221 µmol/L or eGFR <30; stop if >310 or eGFR <20" });
  for (const m of ctx.meds.filter((x) => x.tags.includes("sglt2")))
    if (!severe) out.push({ title: `${line(m)}: continue — an initial eGFR dip is expected and is not a reason to stop`, tone: "keep", source: "KDIGO 2024 CKD: continue SGLT2 inhibitors as eGFR falls unless not tolerated or kidney replacement starts; ESC HF 2026" });
  for (const m of ctx.meds.filter((x) => x.tags.includes("raas")))
    if (!severe && !acts.includes("reduce-raas") && !acts.includes("hold-raas"))
      out.push({ title: `${line(m)}: keep unless the rise exceeds 50% / 266 µmol/L or eGFR <25`, tone: "keep", source: "ESC HF practical guidance on RAAS inhibitors" });
  return out;
}
