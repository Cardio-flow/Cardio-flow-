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

// the pathway that usually follows, offered on the confirm step
export const NEXT: Record<string, string> = {
  "acs-discharge": "antithrombotic",
  "chest-pain-cad": "antithrombotic",
  bleeding: "antithrombotic",
  "post-pe": "ph-suspected",
  "hcm-scd": "hcm-lvoto",
  "hcm-lvoto": "cmp-family",
};
