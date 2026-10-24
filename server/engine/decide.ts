import { decisionBlocker } from "../../shared/decision-validation.js";
import { decisionDataNeeded, decisionQuestions } from "../../shared/decision-requirements.js";
import { validatePregnancy, pregnancyOutcomeBlocker } from "../../shared/wizards-pregnancy.js";
// The pathway as the app's hidden decision engine (14 Oct 2026, Ahmed: "make the pathways the hidden brain …
// collect the data needed for the decision and only give us what is necessary to fill before the decision").
//
// For an alert that opens a pathway, the pathway is run without showing it: every answer the record gives
// (detected) or the guideline gives (suggestions, dose halving) is filled in; what is left are the questions
// only the clinician can answer, and results the decision needs that are missing or out of date. The plan the
// pathway would record — medicine changes with doses, dated infusions, rechecks and reviews — is returned with
// the reasons, so the alert card can show it and record it with one confirmation. Nothing is recorded here.
import { validateMedicationMonitoring } from "../../shared/wizards-medication.js";
import { validatePericardial } from "../../shared/wizards-pericardial.js";
import { validateAorta } from "../../shared/wizards-aorta.js";
import { validateSyncope } from "../../shared/wizards-syncope.js";
import { potassiumFirst } from "../../shared/decision-safety.js";
import { evidenceKey } from "../kernel/evidence.js";
import { IRON_CHECKS, validateIronDates, ironDates } from "../../shared/wizards-iron.js";
import type { Q } from "../db/db.js";
import { WIZARDS, buildOutcome, doseChoices, missingRequired, optionsFor, visibleQuestions, visibleAnswers, type Answers, type WizardContext } from "../../shared/wizards.js";
import { joinFor, prefill } from "../../shared/wizard-prefill.js";
import { suggest } from "../../shared/wizard-guidance.js";
import { isAssumed } from "../../shared/decision-assume.js";
import { MEASURES } from "../../shared/catalog.js";
import { fmtDay } from "../../shared/clinical.js";
import { ironInputs } from "../../shared/wizards-iron.js";
import { getWizard } from "./wizard.js";
import { safetyHits } from "./med-safety.js";
import { loadState } from "../kernel/state.js";
import { RENAL_DEFAULTS } from "./renal-trend.js";
import { doseLabel, MEDICATION } from "../../shared/catalog.js";

// medicines to look at with this decision: the safety table's rows (renal limits, contraindications, interactions)
const MED_REVIEW: Record<string, string[]> = {
  "renal-function": ["metformin-renal", "rosuvastatin-renal", "atenolol-renal", "renal-severe", "renal-contraindicated", "doac-crcl-15", "dronedarone-creatinine", "colchicine-3a4-renal-hepatic"],
  hyperkalaemia: ["mra-k-sparing", "eplerenone-acei-arb", "dual-ras", "arni-acei"],
  bradycardia: ["diltiazem-bradycardia", "duplicate-beta-blocker", "ivabradine-ndhp", "digoxin-amiodarone"],
  "af-care": ["doac-crcl-15", "renal-contraindicated", "dronedarone-permanent-af", "dronedarone-hf", "two-oral-anticoagulants", "doac-inducer", "dabigatran-verapamil", "dronedarone-dabigatran"],
  digoxin: ["digoxin-amiodarone"],
  congestion: ["nsaid-hf", "ndhp-hfref"],
  hypotension: ["pde5-nitrate", "duplicate-beta-blocker"],
  "liver-result": ["alt-limit"],
  "statin-ck-result": ["simvastatin-3a4", "simvastatin-amiodarone"],
  diabetes: ["metformin-renal"],
};
// the medicines each decision acts on, listed as "current treatment"
const CURRENT: Record<string, string[]> = {
  pericarditis:["oac","antiplatelet","nsaid","colchicine","corticosteroid"],
  "aorta-plan":["raas","bb","bp-lowering"],
  syncope:["bb","rate-slowing","digoxin","loop","thiazide","raas","mra","vasodilator","nitrate","bp-lowering"],
  hyperkalaemia: ["raas", "mra", "potassium-sparing", "k-binder"], "renal-function": ["raas", "mra", "loop", "sglt2", "metformin"],
  congestion: ["loop", "thiazide", "mra", "sglt2"], hypotension: ["raas", "bb", "loop", "vasodilator", "bp-lowering", "nitrate"],
  bradycardia: ["bb", "bb-other", "rate-slowing", "digoxin", "ivabradine"], "af-care": ["oac", "bb", "rate-slowing", "digoxin", "antiarrhythmic"],
  digoxin: ["digoxin"], inr: ["vka"], diabetes: ["metformin", "sglt2", "glp1", "dpp4", "sulfonylurea", "insulin"],
  "low-potassium": ["loop", "thiazide", "mra"], hyponatraemia: ["thiazide", "loop"], "iv-iron": ["oral-iron", "iv-iron"],
  "anaemia-result": ["oac", "antiplatelet", "oral-iron"], "amiodarone-thyroid": ["amiodarone"],
  bleeding: ["oac", "antiplatelet", "nsaid"], antithrombotic: ["oac", "antiplatelet", "ppi"], "acs-discharge": ["antiplatelet", "oac", "statin", "bb", "raas"],
  "valve-antithrombotic": ["oac", "antiplatelet"], "peri-af-procedure": ["oac"], "pre-procedure": ["oac", "antiplatelet", "sglt2", "raas", "metformin"],
  "chest-pain-cad": ["antiplatelet", "nitrate", "bb", "statin"], "ccs-test-result": ["antiplatelet", "nitrate", "bb", "statin"],
  "severe-hypertension": ["raas", "ccb", "thiazide", "bb", "bp-lowering"], "htn-review": ["raas", "ccb", "thiazide", "bb", "bp-lowering"],
  hypoglycaemia: ["insulin", "sulfonylurea"], hyperglycaemia: ["insulin", "sglt2", "metformin"],
};

export async function previewDecision(tx: Q, patientId: string, wizardId: string, given: Answers = {}, dueDates: Record<string, string> = {}) {
  const def = WIZARDS[wizardId];
  const { context: ctx } = await getWizard(tx, patientId, wizardId);
  const pre = prefill(wizardId, ctx, given);
  const { answers, suggested } = pre;
  // follow-up: when the guideline gives no timing, a default by urgency (marked "Default", easy to change)
  const defaulted = new Set<string>();
  for (const q of def.steps.flatMap((st) => visibleQuestions(st, answers)))
    if (q.id === "review" && q.type === "single" && answers.review == null) {
      const vals = optionsFor(q, ctx).map((o) => o.value);
      const pref = def.tone === "red" ? ["phone-3", "clinic-7"] : def.tone === "orange" ? ["clinic-14", "clinic-7", "phone-3"] : ["none", "clinic-14"];
      const v = pref.find((x) => vals.includes(x));
      if (v) { answers.review = v; defaulted.add("review"); }
    }
  const all = def.steps.flatMap((st) => visibleQuestions(st, answers));
  // screens, checklists and the follow-up filled with the safe / not-yet default (shared/decision-assume.ts)
  const assumedIds = all.filter((q) => q.required && !Object.hasOwn(given, q.id) && isAssumed(wizardId, q, answers[q.id], ctx) && !suggest(wizardId, q.id, answers, ctx).some((x) => (Array.isArray(answers[q.id]) ? (answers[q.id] as string[]).includes(x.value) : answers[q.id] === x.value))).map((q) => q.id);
  // the reasons behind every filled answer: the record (detected) or the guideline (suggestion)
  const reasons: { question: string; answer: string; why: string; source: "record" | "guideline" | "you" | "default" | "assumed" }[] = [];
  for (const q of all) {
    const v = answers[q.id];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const vals = (Array.isArray(v) ? v : [String(v)]).filter((x) => x !== "none");
    if (!vals.length) continue;
    const opts = q.type === "dose" ? doseChoices(ctx, q).options : optionsFor(q, ctx);
    const label = vals.map((x) => opts.find((o) => o.value === x)?.label ?? x).join(" · ");
    const from = Object.hasOwn(given, q.id) ? "you" : defaulted.has(q.id) || (q.id === "review" && assumedIds.includes(q.id)) ? "default" : assumedIds.includes(q.id) ? "assumed" : ctx.detected[q.id]?.length ? "record" : "guideline";
    const why = from === "default" ? "Default follow-up by urgency, not a guideline timing: change it if needed" : from === "assumed" ? (q.id === "review" ? "Default follow-up by urgency, not a guideline timing: change it if needed" : "Assumed: change it if different") : q.type === "dose" && !suggest(wizardId, q.id, answers, ctx).length
      ? "Halve the dose (ESC HF practical guidance): the largest listed dose at or below half"
      : suggest(wizardId, q.id, answers, ctx).filter((x) => vals.includes(x.value)).map((x) => x.why).join(" · ");
    reasons.push({ question: q.label, answer: label, why, source: from });
  }
  // what only the clinician can answer
  const needed = decisionQuestions(wizardId, answers, ctx).map((q) => ({
    id: q.id, label: q.label, help: q.help ?? null, type: q.type,
    options: q.type === "dose" ? doseChoices(ctx, q).options : optionsFor(q, ctx),
  }));
  const iron = wizardId === "iv-iron" && answers.decision === "give" || wizardId === "anaemia-result" && (answers.actions as string[] | undefined)?.includes("iv");
  const checkId = wizardId === "iv-iron" ? "checks" : "ivChecks";
  if (iron && IRON_CHECKS.some(c => !(answers[checkId] as string[] | undefined)?.includes(c.value)) && !needed.some(q => q.id === checkId)) {
    const q = all.find(q => q.id === checkId)!;
    needed.push({ id:q.id,label:q.label,help:q.help ?? null,type:q.type,options:optionsFor(q,ctx) });
  }
  if(iron) dueDates=ironDates(answers,ctx,dueDates);
  const blockers = [decisionBlocker(wizardId,answers,ctx,dueDates),wizardId === "pregnancy-plan" ? validatePregnancy(visibleAnswers(wizardId,answers),ctx,dueDates) : null, pregnancyOutcomeBlocker(wizardId,buildOutcome(wizardId,answers,ctx,dueDates),ctx,answers), wizardId === "pericarditis" ? validatePericardial(visibleAnswers(wizardId,answers),ctx,dueDates) : null, wizardId === "medication-monitoring" ? validateMedicationMonitoring(answers,ctx) : null, wizardId === "aorta-plan" ? validateAorta(answers,ctx,dueDates) : null, wizardId === "syncope" ? validateSyncope(answers,ctx,dueDates) : null, potassiumFirst(wizardId,ctx), iron ? validateIronDates(answers,ctx,dueDates) : null].filter(Boolean) as string[];
  const questions = all.map(q => ({id:q.id,label:q.label,help:q.help ?? null,type:q.type,exclusive:q.exclusive ?? [],options:q.type === "dose" ? doseChoices(ctx,q).options : optionsFor(q,ctx)}));
  const needData = decisionDataNeeded(wizardId,ctx,answers).map((n) => ({ ...n, label: MEASURES[n.code]?.display ?? n.code, last: ctx.values?.[n.code] ? { value: ctx.values[n.code].value, at: ctx.values[n.code].at } : null }));
  // the plan as it stands (complete once the open questions are answered)
  const plan = (potassiumFirst(wizardId,ctx) ? [] : buildOutcome(wizardId, answers, ctx, dueDates)).map((o) => ({
    kind: o.kind, label: o.kind === "plan" ? `${o.title} · ${fmtDay(o.dueDate, { weekday: true, year: true })}` : o.label,
    ...(o.kind === "plan" ? { title: o.title, dueDate: o.dueDate, category: o.category } : {}),
  }));
  const s = await loadState(tx, patientId);
  const ids = MED_REVIEW[wizardId] ?? [];
  const medReview = [
    ...(CURRENT[wizardId] ? currentLine(ctx, CURRENT[wizardId]) : []),
    ...(ids.length ? [...safetyHits(s, "condition"), ...safetyHits(s, "interaction")].filter(({ row }) => ids.includes(row.id)).map(({ row, hit }) => ({ title: row.title(hit), source: row.source, tone: "warn" as const })) : []),
    ...(wizardId === "renal-function" ? renalKeep(ctx, answers) : []),
    ...(wizardId === "af-care" ? doacLines(ctx) : []),
  ];
  // a pathway that continues into another (e.g. bleeding → antithrombotic plan) is recorded in the pathway,
  // where both parts are confirmed together
  const j = joinFor(wizardId, answers, ctx);
  const joined = j ? { next: j.next, title: WIZARDS[j.next]?.title ?? j.next, why: j.why } : null;
  return {
    joined, today: ctx.today, evidenceKey: evidenceKey(s), questions, blockers,
    wizard: wizardId, title: def.title, note: def.note, source: def.sourceShort ?? def.source ?? null,
    answers, suggested, reasons, needed, needData, plan, medReview, assumed: assumedIds,
    ready: !needed.length && !needData.length && !blockers.length,
  };
}

// renal deterioration: the disease-modifying medicines that stay, and why (so "no change" is a stated decision)
function renalKeep(ctx: WizardContext, a: Answers) {
  const cr = ctx.renal?.current ?? ctx.values?.creatinine?.value ?? null, egfr = ctx.values?.egfr?.value ?? null;
  const acts = (a.actions as string[] | undefined) ?? [];
  const severe = !!ctx.renal?.stop;
  if (potassiumFirst("renal-function",ctx)) return [];
  const out: { title: string; source: string; tone: "keep" }[] = [];
  const line = (m: (typeof ctx.meds)[number]) => `${m.name} ${doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)}`;
  for (const m of ctx.meds.filter((x) => x.status === "active" && x.tags.includes("mra")))
    if (!severe && !acts.includes("reduce-mra") && !acts.includes("hold-mra") && cr != null && cr <= RENAL_DEFAULTS.mra_review_cr_umol && (egfr == null || egfr >= RENAL_DEFAULTS.mra_review_egfr))
      out.push({ title: `${line(m)}: keep — creatinine ${Math.round(cr)} µmol/L ≤${RENAL_DEFAULTS.mra_review_cr_umol}${egfr != null ? ` and eGFR ${Math.round(egfr)} ≥${RENAL_DEFAULTS.mra_review_egfr}` : ""}; recheck potassium with the creatinine`, tone: "keep", source: "ESC HF practical guidance on MRA: halve if creatinine >221 µmol/L or eGFR <30; stop if >310 or eGFR <20" });
  for (const m of ctx.meds.filter((x) => x.status === "active" && x.tags.includes("sglt2")))
    if (!severe) out.push({ title: `${line(m)}: continue if clinically stable; review volume status and acute illness, and apply sick-day guidance when indicated`, tone: "keep", source: "KDIGO 2024 CKD: continue SGLT2 inhibitors as eGFR falls unless not tolerated or kidney replacement starts; ESC HF 2026" });
  for (const m of ctx.meds.filter((x) => x.status === "active" && x.tags.includes("raas")))
    if (!severe && !acts.includes("reduce-raas") && !acts.includes("hold-raas"))
      out.push({ title: `${line(m)}: keep unless the rise exceeds 50% / 266 µmol/L or eGFR <25`, tone: "keep", source: "ESC HF practical guidance on RAAS inhibitors" });
  return out;
}

type Line = { title: string; source: string; tone: "warn" | "keep" | "info" };
function currentLine(ctx: WizardContext, tags: string[]): Line[] {
  const ms = ctx.meds.filter((m) => m.tags.some((t) => tags.includes(t)));
  return [{ title: ms.length ? `Current: ${ms.map((m) => `${m.name} ${doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)}${m.frequency ? ` ${m.frequency}` : ""}${m.status === "held" ? " (held)" : ""}`).join(" · ")}` : "Current: none of the medicines this decision acts on", source: "Medication list", tone: "info" }];
}
// AF: the DOAC label-dose check for each current DOAC (ESC AF 2024 / EHRA)
function doacLines(ctx: WizardContext): Line[] {
  return (ctx.af?.doac ?? []).map((d) => {
    const m = ctx.meds.find((x) => x.code === d.code);
    const name = m?.name ?? d.code;
    return d.dose === d.right
      ? { title: `${name} ${d.dose} mg: label dose for this patient — ${d.why}`, source: "ESC AF 2024 / EHRA DOAC guide; SmPC 4.2", tone: "keep" as const }
      : { title: `${name} ${d.dose ?? "—"} mg: label dose is ${d.right} mg — ${d.why}`, source: "ESC AF 2024 / EHRA DOAC guide; SmPC 4.2", tone: "warn" as const };
  });
}
