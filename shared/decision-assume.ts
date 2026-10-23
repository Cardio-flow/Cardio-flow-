// Assumed answers (23 Oct 2026, Ahmed: "you can just advise to check and put a list for whatever you want as a box
// the physician should look at, just a reminder, but the pathway itself should be kept for the final decision").
//
// Questions that are screens, checklists or bookings — not the input the decision turns on — no longer stop the
// decision. They are filled with the safe or honest default and shown in an "Assumed — change if different" box
// with their choices inline, so the clinician sees each one and changes it with one tap:
//  - red-flag / safety screens → "none" / "stable" (the patient is in front of the clinician; a red flag is
//    one tap and changes the decision at once),
//  - checklists ("reviewed / pending", "yes / no / unknown") → the not-yet state, so the plan lists what is left,
//  - the follow-up visit → by urgency: red pathways an early call or visit, orange a visit in 1–2 weeks, others none.
// Never assumed by design: acute aortic syndrome (aorta), tamponade / instability (pericardial disease) and the
// obstetric/cardiac safety check in pregnancy — these are asked every time.
// The input a decision turns on (symptoms in hypotension, the ECG in bradycardia, bleeding severity, shock type,
// syncope history in HCM…) is never assumed: it stays under "Needed for this decision".
import { WIZARDS, type Question, type WizardContext } from "./wizards.js";

const PENDING = ["pending", "unknown", "needed", "uncertain"];
const A: Record<string, Record<string, string | string[]>> = {
  congestion: { redflags: ["none"] },
  "severe-hypertension": { hmod: ["none"] },
  "sick-day": { redflags: ["none"] },
  "ph-suspected": { warning: ["none"] },
  "pre-procedure": { active: ["none"] },
  inr: { bleeding: "none" },
  "low-potassium": { ecg: "not-done" },
  "icd-shock": { state: "stable" },
  "after-device": { wound: "ok" },
  myocarditis: { pericarditis: "no" },
  "valve-heart-team": { factors: ["none"] },
  "af-ablation-plan": { safety: "stable", thrombus: "unknown" },
  "after-af-ablation": { safety: "stable" },
  "after-laao": { safety: "stable" },
  "tavi-plan": { safety: "stable" },
  "teer-plan": { safety: "stable" },
  "other-structural-plan": { safety: "stable" },
  "after-structural": { safety: "stable" },
  "rdn-plan": { safety: "stable" },
  "after-rdn": { safety: "stable" },
  "htn-review": { safety: "stable" },
  "anaemia-result": { redflags: ["none"], scope: "standard" },
  "liver-result": { redflags: ["none"] },
  "statin-ck-result": { redflags: ["none"] },
  "vitamin-d-result": { redflags: ["none"], scope: "standard" },
  "chest-infection": { setting: "cap" },
  "valve-antithrombotic": { bleeding: "usual" },
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
