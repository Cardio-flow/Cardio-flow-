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
