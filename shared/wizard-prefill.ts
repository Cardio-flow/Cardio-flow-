// Pathways redesign (slice 6): a pathway opens with everything already filled in — what the record shows
// (detected) and, for every question still open, what the guideline suggests for this patient — so the
// clinician reviews and changes rather than builds. Suggestions depend on earlier answers, so the steps
// are walked in order. Nothing here decides: the plan is recorded only when the clinician confirms it.
import { WIZARDS, doseChoices, optionsFor, visibleQuestions, type Answers, type WizardContext } from "./wizards.js";
import { assumed } from "./decision-assume.js";
import { suggest } from "./wizard-guidance.js";

// questions whose answer comes only from the record (diagnoses, results, medicines), never from symptoms or
// examination: when the record shows nothing, "none" is the answer
const RECORD_LISTS: Record<string, string[]> = { "af-care": ["comorb"] };

export function prefill(wizardId: string, ctx: WizardContext, base: Answers = {}) {
  const def = WIZARDS[wizardId];
  const answers: Answers = { ...base };
  const suggested = new Set<string>();
  for (const q of def.steps.flatMap((st) => st.questions)) {
    const d = ctx.detected[q.id];
    if (answers[q.id] == null && d?.length) answers[q.id] = q.type === "single" ? d[0] : d;
  }
  for (const st of def.steps) {
    // a suggestion can reveal a conditional question in the same step (e.g. "hypothyroidism" shows its own
    // plan): walk the step again until nothing new is filled
    for (let pass = 0; pass < 5; pass++) {
      let filled = false;
      for (const q of visibleQuestions(st, answers)) {
        if (answers[q.id] != null) continue;
        // a "reduce" dose: the guideline step is to halve it — the largest listed dose at or below half
        // the current one, else the next lower dose (ESC HF practical guidance)
        // a dose the guideline computes for this patient (e.g. double the loop diuretic, HFA 2019)
        if (q.type === "dose") {
          const v = suggest(wizardId, q.id, answers, ctx).filter((x) => !x.alt)[0]?.value;
          if (v && doseChoices(ctx, q).options.some((o) => o.value === v)) { answers[q.id] = v; suggested.add(q.id); filled = true; continue; }
        }
        if (q.type === "dose" && q.direction === "lower") {
          const { med, options } = doseChoices(ctx, q);
          const cur = med?.doseValue;
          if (!cur || !options.length) continue;
          const vals = options.map((o) => Number(o.value)).sort((x, y) => x - y);
          answers[q.id] = String([...vals].reverse().find((d) => d <= cur / 2) ?? vals[vals.length - 1]);
          suggested.add(q.id);
          filled = true;
          continue;
        }
        if (q.type === "date") {
          const proposed=suggest(wizardId,q.id,answers,ctx).filter((x)=>!x.alt)[0]?.value;
          if(proposed) {answers[q.id]=proposed;suggested.add(q.id);filled=true;}
          continue;
        }
        if (!q.options) continue;
        const ok = new Set(optionsFor(q, ctx).map((o) => o.value));
        // an alternative is offered beside the decision, never taken by default
        const vals = suggest(wizardId, q.id, answers, ctx, ok).filter((x) => !x.alt).map((x) => x.value);
        // a list read entirely from the record (not a symptom or clinical sign) with nothing found: "none"
        if (!vals.length && RECORD_LISTS[wizardId]?.includes(q.id) && ok.has("none")) vals.push("none");
        // only "none" can be chosen (e.g. nothing to stop among the medicines taken): nothing to ask
        if (!vals.length && q.type === "multi" && ok.size === 1 && ok.has("none")) vals.push("none");
        if (!vals.length) {
          // a screen, checklist or booking: the safe / not-yet default, shown as assumed (shared/decision-assume.ts)
          const def = q.required ? assumed(wizardId, q, ctx) : undefined;
          if (def === undefined || (Array.isArray(def) ? !def.every((v) => ok.has(v)) : !ok.has(def))) continue;
          answers[q.id] = def;
          filled = true;
          continue;
        }
        answers[q.id] = q.type === "multi" ? (vals.includes("none") ? ["none"] : vals) : vals[0];
        suggested.add(q.id);
        filled = true;
      }
      if (!filled) break;
    }
  }
  return { answers, suggested: [...suggested] };
}

// Recompute generated downstream answers when a clinical input changes. Keep
// clinician overrides; clear invisible old branches and recompute doses/dates.
export function updateDecisionAnswers(id: string, ctx: WizardContext, before: Answers, patch: Answers) {
  const previousAuto = prefill(id,ctx).answers;
  const base: Answers = {};
  for(const [key,value] of Object.entries(before)) {
    if(JSON.stringify(value) !== JSON.stringify(previousAuto[key])) base[key]=value;
  }
  const qs = WIZARDS[id].steps.flatMap(st=>st.questions);
  if(Object.hasOwn(patch,"actions") || Object.keys(patch).some(k=>!["recheck","review"].includes(k))) {
    for(const q of qs) if(q.type === "dose" || ["recheck","review"].includes(q.id)) delete base[q.id];
  }
  Object.assign(base,patch);
  const result = prefill(id,ctx,base).answers;
  const visible = new Set(WIZARDS[id].steps.flatMap(st=>visibleQuestions(st,result)).map(q=>q.id));
  for(const q of qs) if(!visible.has(q.id)) delete result[q.id];
  return result;
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
  pericarditis: { next: "myocarditis", when: (a) => a.myocardium === "yes" && a.route !== "urgent", why: "Myocardial involvement (myopericarditis): myocarditis work-up" },
  "post-pe": { next: "ph-suspected", when: (a) => a.symptoms === "yes" && a.time === "3m", why: "Breathless after ≥3 months of anticoagulation: work up pulmonary hypertension" },
  "hcm-scd": { next: "hcm-lvoto", when: () => true, why: "Symptoms and LVOT obstruction" },
  "hcm-lvoto": { next: "cmp-family", when: () => true, why: "Family screening" },
};
export const joinFor = (wizardId: string, a: Answers, ctx: WizardContext | null) => {
  const j = JOIN[wizardId];
  return j && ctx && WIZARDS[j.next] && j.when(a, ctx) ? j : null;
};
