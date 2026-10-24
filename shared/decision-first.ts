import { decisionQuestions } from "./decision-requirements.js";
// Decision first (23 Oct 2026, Ahmed: "the pathways give just steps which a cardiologist already knows … at the
// end it gives options to choose, not a solid recommendation with the doses adjusted to the patient. Checks can
// be a reminder box the physician looks at, but the pathway itself is for the final decision").
//
// A pathway opens on the decision for this patient: the answers are filled from the record and from the
// guideline suggestions (prefill), and this module reads them back as
//  - why: each guideline suggestion that was taken, with its reason and source,
//  - needed: the few answers the record cannot give and the decision depends on (asked inline, one tap),
//  - instead: options the guideline also allows (alternatives, and suggestions not taken), one tap to use,
//  - check: points to look at before confirming, as a reminder box (nothing to answer).
// The full step-by-step questions stay one tap away ("Change details").
import { suggest } from "./wizard-guidance.js";
import { isAssumed } from "./decision-assume.js";
import { WIZARDS, missingRequired, optionsFor, visibleQuestions, type Answers, type Question, type WizardContext } from "./wizards.js";

export type DecisionView = {
  why: { question: string; label: string; why: string }[];
  needed: Question[];
  // screens, checklists and bookings filled with the safe / not-yet default: shown with their choices inline
  assumed: Question[];
  instead: { question: string; value: string; label: string; why: string; replaces: string[] }[];
  check: string[];
};

const chosen = (a: Answers, id: string, v: string) => (Array.isArray(a[id]) ? (a[id] as string[]).includes(v) : a[id] === v);

export function decisionView(wizardId: string, answers: Answers, ctx: WizardContext): DecisionView {
  const def = WIZARDS[wizardId];
  const visible = def.steps.flatMap((st) => visibleQuestions(st, answers));
  const why: DecisionView["why"] = [];
  const instead: DecisionView["instead"] = [];
  // a computed dose (e.g. double the loop diuretic) is a reason like any other
  for (const q of visible.filter((q) => q.type === "dose")) {
    const x = suggest(wizardId, q.id, answers, ctx)[0];
    if (x && answers[q.id] === x.value && !x.silent) why.push({ question: q.id, label: q.label, why: x.why });
  }
  for (const q of visible.filter((q) => q.options)) {
    const ok = new Set(optionsFor(q, ctx).map((o) => o.value));
    const label = (v: string) => q.options!.find((o) => o.value === v)?.label ?? v;
    for (const x of suggest(wizardId, q.id, answers, ctx, ok)) {
      if (x.value === "none") continue;
      if (chosen(answers, q.id, x.value)) { if (!x.silent) why.push({ question: q.id, label: label(x.value), why: x.why }); }
      else if (!x.silent) instead.push({ question: q.id, value: x.value, label: label(x.value), why: x.why, replaces: x.replaces ?? [] });
    }
  }
  const extra = new Set(def.needed?.(answers, ctx) ?? []);
  const open = (q: Question) => { const v = answers[q.id]; return v == null || v === "" || (Array.isArray(v) && !v.length); };
  const needed = decisionQuestions(wizardId, answers, ctx);
  // optional questions left open are worth a look, not an answer (a pathway with its own checks lists them itself)
  const check = def.checks ? def.checks(answers, ctx) : [
    ...visible.filter((q) => !q.required && !extra.has(q.id) && open(q) && q.type !== "dose" && q.type !== "date").map((q) => q.label.replace(/\?$/, "")),
  ];
  const assumed = visible.filter((q) => !q.required ? false : isAssumed(wizardId, q, answers[q.id], ctx) && !suggest(wizardId, q.id, answers, ctx).some((x) => chosen(answers, q.id, x.value)));
  return { why, needed, assumed, instead, check: [...new Set(check)] };
}

// take an alternative: add its value (single: replace) and drop what it takes the place of
export function applyInstead(answers: Answers, wizardId: string, question: string, value: string, replaces: string[]): Answers {
  const q = WIZARDS[wizardId].steps.flatMap((st) => st.questions).find((x) => x.id === question);
  if (!q) return answers;
  if (q.type !== "multi") return { ...answers, [question]: value };
  const cur = ((answers[question] as string[] | undefined) ?? []).filter((v) => v !== "none" && !replaces.includes(v));
  return { ...answers, [question]: [...new Set([...cur, value])] };
}
