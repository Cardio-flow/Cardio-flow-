// Pathways redesign (slice 6): a pathway opens with everything already filled in — what the record shows
// (detected) and, for every question still open, what the guideline suggests for this patient — so the
// clinician reviews and changes rather than builds. Suggestions depend on earlier answers, so the steps
// are walked in order. Nothing here decides: the plan is recorded only when the clinician confirms it.
import { WIZARDS, optionsFor, visibleQuestions, type Answers, type WizardContext } from "./wizards.js";
import { suggest } from "./wizard-guidance.js";

export function prefill(wizardId: string, ctx: WizardContext, base: Answers = {}) {
  const def = WIZARDS[wizardId];
  const answers: Answers = { ...base };
  const suggested = new Set<string>();
  for (const q of def.steps.flatMap((st) => st.questions)) {
    const d = ctx.detected[q.id];
    if (answers[q.id] == null && d?.length) answers[q.id] = q.type === "single" ? d[0] : d;
  }
  for (const st of def.steps) {
    for (const q of visibleQuestions(st, answers)) {
      if (!q.options || answers[q.id] != null) continue;
      const ok = new Set(optionsFor(q, ctx).map((o) => o.value));
      const vals = suggest(wizardId, q.id, answers, ctx, ok).map((x) => x.value);
      if (!vals.length) continue;
      answers[q.id] = q.type === "multi" ? (vals.includes("none") ? ["none"] : vals) : vals[0];
      suggested.add(q.id);
    }
  }
  return { answers, suggested: [...suggested] };
}

// Joined pathways: when the answers call for it, the pathway carries straight on into the one that follows,
// as one flow with one Confirm (both recorded together). The condition reads the answers given, so the
// second part appears only when it applies to this patient.
// carry: answers the next part takes from this one (e.g. a new ACS: count the antithrombotic plan from today)
export type Join = { next: string; when: (a: Answers, ctx: WizardContext) => boolean; why: string; carry?: (a: Answers) => Answers };
const has = (a: Answers, id: string, v: string) => (Array.isArray(a[id]) ? (a[id] as string[]).includes(v) : a[id] === v);
export const JOIN: Record<string, Join> = {
  "after-structural": { next: "valve-antithrombotic", when: (a, ctx) => a.safety === "stable" && ctx.structural?.actual?.target === "TAVI", why: "Review and confirm the actual TAVI antithrombotic prescriptions and dated transitions" },
  "acs-discharge": { next: "antithrombotic", when: () => true, why: "Durations and stop dates of the antithrombotic therapy after this ACS" },
  "chest-pain-cad": {
    next: "antithrombotic",
    when: (a) => ["ste", "dynamic"].includes(String(a.ecg)) || a.troponin === "rising" || ["stopped", "missed", "none"].includes(String(a.adherence)),
    why: "A new ACS or interrupted antiplatelet therapy: set the antithrombotic plan again",
    carry: (a) => (["ste", "dynamic"].includes(String(a.ecg)) || a.troponin === "rising" ? { from: "today", setting: "acs" } : {}),
  },
  bleeding: {
    next: "antithrombotic",
    when: (_a, ctx) => !!ctx.coronary && ctx.meds.some((m) => m.tags.includes("antiplatelet")),
    why: "Bleeding on antiplatelet therapy after ACS / PCI: revise the antithrombotic plan",
  },
  "af-care": { next: "peri-af-procedure", when: (a) => has(a, "rhythm", "cardioversion") || has(a, "rhythm", "ablation"), why: "Cardioversion or ablation planned: date the anticoagulation around it" },
  pericarditis: { next: "myocarditis", when: (a) => a.myocardium === "yes", why: "Myocardial involvement (myopericarditis): myocarditis work-up" },
  "post-pe": { next: "ph-suspected", when: (a) => a.symptoms === "yes" && a.time === "3m", why: "Breathless after ≥3 months of anticoagulation: work up pulmonary hypertension" },
  "hcm-scd": { next: "hcm-lvoto", when: () => true, why: "Symptoms and LVOT obstruction" },
  "hcm-lvoto": { next: "cmp-family", when: () => true, why: "Family screening" },
};
export const joinFor = (wizardId: string, a: Answers, ctx: WizardContext | null) => {
  const j = JOIN[wizardId];
  return j && ctx && WIZARDS[j.next] && j.when(a, ctx) ? j : null;
};
