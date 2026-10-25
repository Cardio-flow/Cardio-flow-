import { WIZARDS, missingRequired, visibleQuestions, type Answers, type WizardContext } from "./wizards.js";
import { ironInputs } from "./wizards-iron.js";
// results a pathway's decision depends on: missing or older than `days` → asked for before the decision
const ironNeeds = (ctx: WizardContext) => {
    const { hb, weight } = ironInputs(ctx);
    return [
      ...(hb == null ? [{ code: "haemoglobin", days: 90, why: "the total iron dose depends on it (SmPC Table 1)" }] : []),
      ...(weight == null ? [{ code: "weight", days: 365, why: "the total iron dose and the per-infusion limit (20 mg/kg) depend on it" }] : []),
    ];
};
// Data freshness (how recent a result must be to stand for "now") is a recording convention, not a treatment
// threshold: 30 days for electrolytes/renal function in an acute pathway, 180 days for the DOAC creatinine (as
// the DOAC label-dose check), 365 days for weight, 90 days for Hb before IV iron and thyroid tests.
const need = (ctx: WizardContext, code: string, days: number, why: string) =>
  ctx.values?.[code] && fresh(ctx, ctx.values[code].at, days) ? [] : [{ code, days, why }];
const NEEDS: Record<string, (ctx: WizardContext, a: Answers) => { code: string; days: number; why: string }[]> = {
  "iv-iron": (ctx, a) => (a.decision === "give" ? ironNeeds(ctx) : []),
  "anaemia-result": (ctx, a) => (Array.isArray(a.actions) && a.actions.includes("iv") ? ironNeeds(ctx) : []),
  "renal-function": (ctx) => need(ctx, "potassium", 30, "decides whether the MRA/RAAS doses can stay"),
  hyperkalaemia: (ctx) => [...need(ctx, "potassium", 30, "the potassium result being treated"), ...need(ctx, "creatinine", 30, "renal function with the potassium")],
  congestion: (ctx) => [
    ...need(ctx, "creatinine", 30, "renal function before changing the diuretic"),
    ...need(ctx, "potassium", 30, "potassium before changing the diuretic"),
    ...need(ctx, "weight", 30, "the weight to judge decongestion"),
  ],
  "af-care": (ctx) => [
    ...need(ctx, "creatinine", 180, "creatinine clearance decides the DOAC dose"),
    ...need(ctx, "weight", 365, "weight decides the DOAC dose (apixaban, edoxaban) and the clearance"),
  ],
  digoxin: (ctx) => [
    ...need(ctx, "potassium", 30, "hypokalaemia increases digoxin toxicity"),
    ...need(ctx, "creatinine", 30, "digoxin is renally cleared"),
  ],
  "low-potassium": (ctx) => need(ctx, "magnesium", 30, "low magnesium must be corrected for potassium to recover"),
  diabetes: (ctx) => [
    ...need(ctx, "hba1c", 180, "glycaemic control decides the next step"),
    ...need(ctx, "creatinine", 365, "eGFR decides metformin and SGLT2 inhibitor use"),
  ],
  "amiodarone-thyroid": (ctx) => [...need(ctx, "tsh", 90, "thyroid status on amiodarone"), ...need(ctx, "ft4", 90, "thyroid status on amiodarone")],
  bleeding: (ctx) => need(ctx, "haemoglobin", 30, "haemoglobin grades the bleed and guides the restart"),
  "peri-af-procedure": (ctx) => [
    ...need(ctx, "creatinine", 180, "creatinine clearance sets the DOAC interruption"),
    ...need(ctx, "weight", 365, "weight for the creatinine clearance"),
  ],
  "pre-procedure": (ctx) => ctx.meds.some((m) => m.tags.includes("oac")) ? [...need(ctx, "creatinine", 180, "creatinine clearance sets the DOAC interruption"), ...need(ctx, "weight", 365, "weight for the creatinine clearance")] : [],
  hyponatraemia: (ctx) => need(ctx, "potassium", 30, "potassium with the sodium (diuretic effect)"),
};
const fresh = (ctx: WizardContext, at: string, days: number) => {
  const age = (Date.parse(ctx.today) - Date.parse(at.slice(0, 10))) / 86400000;
  return Number.isFinite(age) && age >= 0 && age <= days;
};
export function decisionDataNeeded(id: string, ctx: WizardContext, a: Answers) {
  // Missing results must not delay escalation or the act of arranging work-up.
  if(id === "hyperkalaemia" && ((ctx.values?.potassium?.value ?? 0) >= 6.5 || a.ecg === "present" || a.result === "repeat")) return [];
  if(id === "bleeding" && a.severity === "minor") return [];
  if(id === "af-care" && !["apixaban","other-doac"].includes(String(a.oac)) && !ctx.meds.some(m=>m.tags.includes("doac"))) return [];
  if(id === "peri-af-procedure" && a.proc === "ablation") return [];
  if(id === "pre-procedure" && a.conclusion !== "proceed") return [];
  return NEEDS[id]?.(ctx,a) ?? [];
}
export function decisionQuestions(id: string, a: Answers, ctx: WizardContext) {
  const def = WIZARDS[id], extra = new Set(def.needed?.(a,ctx) ?? []);
  const missing = def.steps.flatMap(st => missingRequired(st,a));
  for (const q of def.steps.flatMap(st => visibleQuestions(st,a))) {
    const v = a[q.id];
    if(extra.has(q.id) && (v == null || v === "" || Array.isArray(v) && !v.length) && !missing.some(x=>x.id===q.id)) missing.push(q);
  }
  return missing;
}
