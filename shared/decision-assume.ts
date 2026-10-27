// Defaults are limited to pending work and scheduling. A missing safety screen is
// never recorded as normal: decision-changing findings remain a short inline check.
import { WIZARDS, type Question, type WizardContext } from "./wizards.js";

// Reassess these current clinical findings when resuming a historical decision.
export const CURRENT_SCREENS: Record<string,string[]> = {
  congestion:["redflags"], "severe-hypertension":["hmod"], "sick-day":["redflags"],
  "ph-suspected":["warning"], "pre-procedure":["active"], inr:["bleeding"],
  "icd-shock":["state"], "after-device":["wound"], "af-ablation-plan":["safety"],
  "after-af-ablation":["safety"], "after-laao":["safety"], "tavi-plan":["safety"],
  "teer-plan":["safety"], "other-structural-plan":["safety"], "after-structural":["safety"],
  "rdn-plan":["safety"], "after-rdn":["safety"], "htn-review":["safety"],
  "anaemia-result":["redflags"], "liver-result":["redflags"], "statin-ck-result":["redflags"],
  "vitamin-d-result":["redflags"], hyperkalaemia:["symptoms","ecg"],
};

// Carry-forward (25 Oct 2026, Ahmed agreed): a safety screen is never assumed, but one the clinician already
// answered is not asked blind again. Today's answer in this same pathway is filled
// with its source and time and stays changeable; an older answer of this pathway is only
// offered ("Same as 10 Oct: Stable"), never filled, because "today" findings must be confirmed today.
export type ScreenDecision = { wizard: string | null; answers: Record<string, unknown>; at: string; day: string };
export type CarriedScreen = { value: string | string[]; at: string; wizard: string; today: boolean };
// decisions newest first; only "acted" decisions belong here (a declined alert answered nothing)
export function carriedScreens(wizardId: string, decisions: ScreenDecision[], today: string): Record<string, CarriedScreen> {
  const out: Record<string, CarriedScreen> = {};
  for (const id of CURRENT_SCREENS[wizardId] ?? []) {
    const ok = new Set((WIZARDS[wizardId]?.steps.flatMap((st) => st.questions).find((q) => q.id === id)?.options ?? []).map((o) => o.value));
    const fits = (v: unknown): v is string | string[] => Array.isArray(v) ? v.length > 0 && v.every((x) => ok.has(String(x))) : typeof v === "string" && ok.has(v);
    for (const d of decisions) {
      if (!d.wizard) continue;
      const same = d.wizard === wizardId;
      // Shared option strings are not equivalent assessments: outpatient stability
      // does not establish pregnancy exclusion or uncomplicated procedure recovery.
      // A newer concern also invalidates older reassurance, even when its option
      // is not part of this pathway's vocabulary.
      if (!same && id === "safety" && CURRENT_SCREENS[d.wizard]?.includes("safety") && d.answers.safety != null && d.answers.safety !== "stable") break;
      if (!same) continue;
      const v = d.answers[id];
      if (v == null) continue;
      if (!fits(v)) break;
      out[id] = { value: v, at: d.at, wizard: d.wizard, today: d.day === today };
      break;
    }
  }
  return out;
}

const PENDING = ["pending", "unknown", "needed", "uncertain"];
const A: Record<string, Record<string, string | string[]>> = {
  "low-potassium": { ecg: "not-done" },
  "af-ablation-plan": { thrombus: "unknown" },
};
// checklist questions: the not-yet state (the plan then lists them as tasks)
const CHECKLIST: Record<string, string[]> = {
  "tavi-plan": ["benefit", "team", "bavTeam", "bavAorta", "confirmation", "exercise", "coronary", "labs", "infection"],
  "teer-plan": ["benefit", "team", "optimized", "exclusions", "rhc", "coronary", "labs", "infection"],
  "other-structural-plan": ["benefit", "team", "failure", "device", "coronary", "labs", "infection"],
  "after-structural": ["result", "conduction", "education"],
  "rdn-plan": ["team", "consent", "centre", "protocol"],
  "after-rdn": ["meds", "education"],
  "htn-resistance": ["technique", "adherence", "doses", "lifestyle", "risk", "intolerance"],
  "laao-selection": ["shortTherapy", "imaging"],
  pericarditis: ["cause", "drugSafety", "activity"],
  "pregnancy-plan": ["aspirinSafety"],
  "aorta-plan": ["bpCare"],
  "vitamin-d-result": ["safety"],
};

export function assumed(wizardId: string, q: Question, ctx?: WizardContext): string | string[] | undefined {
  const values = (q.options ?? []).map((o) => o.value);
  // adult scope: specialist when the record shows a pregnancy
  if (q.id === "scope" && values.includes("specialist") && (ctx?.dx ?? []).some((d) => d === "pregnancy-care" || d === "pregnancy")) return "specialist";
  const direct = A[wizardId]?.[q.id];
  if (direct !== undefined) return direct;
  if (CHECKLIST[wizardId]?.includes(q.id)) return values.find((v) => PENDING.includes(v));
  // the follow-up visit when the guideline gives no timing: a default by urgency (as the card engine since 14 Oct)
  if (q.id === "review" && q.type === "single") {
    const tone = WIZARDS[wizardId]?.tone;
    const pref = tone === "red" ? ["phone-3", "clinic-7"] : tone === "orange" ? ["clinic-14", "clinic-7", "phone-3"] : ["none", "clinic-14"];
    return pref.find((x) => values.includes(x));
  }
  return undefined;
}

export const isAssumed = (wizardId: string, q: Question, v: unknown, ctx?: WizardContext) => {
  const a = assumed(wizardId, q, ctx);
  if (a === undefined || v == null) return false;
  return Array.isArray(a) ? Array.isArray(v) && v.length === a.length && a.every((x) => v.includes(x)) : v === a;
};
