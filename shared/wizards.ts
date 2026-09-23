// Config-driven complication wizards. One engine renders every wizard; a new
// complication is new content here, not new UI code. `buildOutcome` is shared so
// the preview the clinician confirms is exactly what the server records.
import { MEDICATION, doseLabel } from "./catalog.js";
import { addDays, fmtDay } from "./clinical.js";

export type Option = { value: string; label: string; hint?: string };
export type Question = {
  id: string;
  label: string;
  help?: string;
  type: "multi" | "single" | "dose" | "date";
  options?: Option[];
  // dose questions pick a new dose for the medication tagged with `medTag`
  medTag?: string;
  direction?: "lower" | "any";
  showIf?: { question: string; includes: string };
  required?: boolean;
};
export type Step = { id: string; title: string; questions: Question[] };
export type WizardDef = {
  id: string;
  title: string;
  tone: "red" | "orange" | "yellow" | "blue";
  steps: Step[];
  note: string;
};

export type WizardMed = {
  id: string;
  code: string;
  name: string;
  doseValue: number | null;
  doseUnit: string | null;
  frequency: string | null;
  tags: string[];
};
export type WizardContext = {
  today: string;
  meds: WizardMed[];
  facts: { label: string; value: string; date?: string; tone?: string }[];
  detected: Record<string, string[]>; // questionId -> auto-detected option values
  trend?: { code: string; label: string; unit: string; points: { date: string; value: number }[] };
};
export type Answers = Record<string, string[] | string | number | undefined>;

const RECHECK: Option[] = [
  { value: "0", label: "Same day" },
  { value: "3", label: "In 3 days" },
  { value: "7", label: "In 1 week" },
  { value: "14", label: "In 2 weeks" },
];
const REVIEW: Option[] = [
  { value: "none", label: "No extra visit" },
  { value: "phone-3", label: "Phone call · 3 days" },
  { value: "clinic-7", label: "Clinic · 1 week" },
  { value: "clinic-14", label: "Clinic · 2 weeks" },
];

export const WIZARDS: Record<string, WizardDef> = {
  hyperkalaemia: {
    id: "hyperkalaemia",
    title: "Hyperkalaemia review",
    tone: "red",
    note: "Options are choices for the clinician. CardioFlow does not pick one, and never changes a dose on its own.",
    steps: [
      {
        id: "data",
        title: "Current data",
        questions: [
          {
            id: "result",
            label: "Is this result reliable?",
            type: "single",
            required: true,
            options: [
              { value: "confirmed", label: "Yes, act on it" },
              { value: "repeat", label: "Possibly spurious, repeat sample" },
            ],
          },
        ],
      },
      {
        id: "context",
        title: "Clinical context",
        questions: [
          {
            id: "symptoms",
            label: "Symptoms",
            type: "multi",
            options: [
              { value: "none", label: "None" },
              { value: "weakness", label: "Muscle weakness" },
              { value: "palpitations", label: "Palpitations" },
              { value: "syncope", label: "Syncope / presyncope" },
            ],
          },
          {
            id: "ecg",
            label: "ECG changes of hyperkalaemia?",
            type: "single",
            required: true,
            options: [
              { value: "none", label: "None" },
              { value: "present", label: "Present" },
              { value: "not-done", label: "ECG not done yet" },
            ],
          },
        ],
      },
      {
        id: "contributors",
        title: "Contributors",
        questions: [
          {
            id: "contributors",
            label: "What may be contributing?",
            help: "Items marked AUTO were detected from the record. Confirm or change them.",
            type: "multi",
            options: [
              { value: "raas-start", label: "Recent RAAS/ARNI start or increase" },
              { value: "mra", label: "MRA therapy" },
              { value: "wrf", label: "Worsening renal function" },
              { value: "nsaid", label: "NSAID use" },
              { value: "k-supplement", label: "Potassium supplements" },
              { value: "diet", label: "High-potassium diet or salt substitute" },
              { value: "volume", label: "Volume depletion" },
            ],
          },
          {
            id: "haemolysis",
            label: "Was the sample haemolysed?",
            type: "single",
            options: [
              { value: "no", label: "No" },
              { value: "yes", label: "Yes" },
              { value: "unknown", label: "Unknown" },
            ],
          },
        ],
      },
      {
        id: "management",
        title: "Management",
        questions: [
          {
            id: "actions",
            label: "What will you do?",
            type: "multi",
            required: true,
            options: [
              { value: "continue", label: "Continue current therapy and recheck" },
              { value: "reduce-mra", label: "Reduce MRA dose" },
              { value: "hold-mra", label: "Hold MRA" },
              { value: "reduce-raas", label: "Reduce ACEi/ARB/ARNI dose" },
              { value: "stop-supplement", label: "Stop potassium supplements" },
              { value: "diet-advice", label: "Dietary potassium advice" },
              { value: "binder", label: "Consider potassium binder" },
              { value: "urgent", label: "Same-day urgent assessment" },
            ],
          },
          { id: "mraDose", label: "New MRA dose", type: "dose", medTag: "mra", direction: "lower", showIf: { question: "actions", includes: "reduce-mra" }, required: true },
          { id: "raasDose", label: "New ACEi/ARB/ARNI dose", type: "dose", medTag: "raas", direction: "lower", showIf: { question: "actions", includes: "reduce-raas" }, required: true },
        ],
      },
      {
        id: "monitoring",
        title: "Monitoring & plan",
        questions: [
          { id: "recheck", label: "Recheck potassium and creatinine", type: "single", options: RECHECK, required: true },
          { id: "review", label: "Clinical review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
  "renal-function": {
    id: "renal-function",
    title: "Worsening renal function review",
    tone: "orange",
    note: "A creatinine rise is not by itself a reason to stop disease-modifying therapy. Options are clinician choices.",
    steps: [
      {
        id: "context",
        title: "Clinical context",
        questions: [
          {
            id: "volume",
            label: "Volume status today",
            type: "single",
            required: true,
            options: [
              { value: "congested", label: "Congested" },
              { value: "euvolaemic", label: "Euvolaemic" },
              { value: "dry", label: "Volume depleted" },
              { value: "unknown", label: "Not assessed" },
            ],
          },
          {
            id: "bp",
            label: "Blood pressure",
            type: "single",
            options: [
              { value: "ok", label: "Acceptable" },
              { value: "low-asymptomatic", label: "Low, asymptomatic" },
              { value: "low-symptomatic", label: "Low, symptomatic" },
            ],
          },
        ],
      },
      {
        id: "contributors",
        title: "Contributors",
        questions: [
          {
            id: "contributors",
            label: "What may be contributing?",
            help: "Items marked AUTO were detected from the record.",
            type: "multi",
            options: [
              { value: "raas-start", label: "Recent RAAS/ARNI start or increase" },
              { value: "sglt2-start", label: "Recent SGLT2 inhibitor start (expected initial dip)" },
              { value: "diuretic", label: "Diuretic effect / over-diuresis" },
              { value: "illness", label: "Intercurrent illness" },
              { value: "nsaid", label: "NSAID or other nephrotoxin" },
              { value: "contrast", label: "Recent contrast" },
              { value: "obstruction", label: "Possible obstruction" },
            ],
          },
        ],
      },
      {
        id: "management",
        title: "Management",
        questions: [
          {
            id: "actions",
            label: "What will you do?",
            type: "multi",
            required: true,
            options: [
              { value: "continue", label: "Continue therapy and recheck" },
              { value: "reduce-diuretic", label: "Reduce diuretic dose" },
              { value: "increase-diuretic", label: "Increase diuretic dose" },
              { value: "hold-nephrotoxin", label: "Stop nephrotoxin" },
              { value: "reduce-raas", label: "Reduce ACEi/ARB/ARNI dose" },
              { value: "nephrology", label: "Nephrology referral" },
            ],
          },
          { id: "diureticDose", label: "New diuretic dose", type: "dose", medTag: "loop", direction: "any", showIf: { question: "actions", includes: "reduce-diuretic" }, required: true },
          { id: "diureticUp", label: "New diuretic dose", type: "dose", medTag: "loop", direction: "any", showIf: { question: "actions", includes: "increase-diuretic" }, required: true },
          { id: "raasDose", label: "New ACEi/ARB/ARNI dose", type: "dose", medTag: "raas", direction: "lower", showIf: { question: "actions", includes: "reduce-raas" }, required: true },
        ],
      },
      {
        id: "monitoring",
        title: "Monitoring & plan",
        questions: [
          { id: "recheck", label: "Recheck renal function and potassium", type: "single", options: RECHECK, required: true },
          { id: "review", label: "Clinical review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
};

export function visibleQuestions(step: Step, answers: Answers) {
  return step.questions.filter((q) => {
    if (!q.showIf) return true;
    const v = answers[q.showIf.question];
    return Array.isArray(v) ? v.includes(q.showIf.includes) : v === q.showIf.includes;
  });
}

export function missingRequired(step: Step, answers: Answers) {
  return visibleQuestions(step, answers).filter((q) => {
    if (!q.required) return false;
    const v = answers[q.id];
    return v == null || v === "" || (Array.isArray(v) && v.length === 0);
  });
}

export function medForTag(ctx: WizardContext, tag: string) {
  return ctx.meds.find((m) => m.tags.includes(tag)) ?? null;
}

export function doseChoices(ctx: WizardContext, q: Question) {
  const med = q.medTag ? medForTag(ctx, q.medTag) : null;
  if (!med) return { med: null, options: [] as Option[] };
  const def = MEDICATION[med.code];
  const doses = (def?.doses ?? []).filter((d) => q.direction !== "lower" || med.doseValue == null || d < med.doseValue);
  return {
    med,
    options: doses.filter((d) => d !== med.doseValue).map((d) => ({ value: String(d), label: doseLabel(def, d, med.doseUnit) })),
  };
}

export type OutcomeItem =
  | { kind: "medication"; medicationId: string; event: "increase" | "decrease" | "hold" | "stop"; doseValue: number | null; label: string }
  | { kind: "plan"; category: string; title: string; dueDate: string; completesOn: Record<string, unknown>; label: string }
  | { kind: "note"; label: string };

export function buildOutcome(wizardId: string, answers: Answers, ctx: WizardContext): OutcomeItem[] {
  const out: OutcomeItem[] = [];
  const actions = (answers.actions as string[] | undefined) ?? [];
  const today = ctx.today;
  const med = (tag: string) => medForTag(ctx, tag);
  const change = (tag: string, answerId: string, fallbackKind: "decrease" | "increase") => {
    const m = med(tag);
    const v = Number(answers[answerId]);
    if (!m || !Number.isFinite(v)) return;
    const def = MEDICATION[m.code];
    const kind = m.doseValue != null && v > m.doseValue ? "increase" : m.doseValue != null && v < m.doseValue ? "decrease" : fallbackKind;
    out.push({
      kind: "medication",
      medicationId: m.id,
      event: kind,
      doseValue: v,
      label: `${m.name}: ${doseLabel(def, m.doseValue, m.doseUnit)} → ${doseLabel(def, v, m.doseUnit)}`,
    });
  };
  if (wizardId === "hyperkalaemia") {
    if (answers.result === "repeat") {
      out.push({ kind: "plan", category: "monitoring", title: "Repeat potassium (possible spurious result)", dueDate: today, completesOn: { type: "lab", codes: ["potassium"] }, label: "" });
    }
    if (actions.includes("reduce-mra")) change("mra", "mraDose", "decrease");
    if (actions.includes("hold-mra")) {
      const m = med("mra");
      if (m) out.push({ kind: "medication", medicationId: m.id, event: "hold", doseValue: null, label: `${m.name}: hold` });
    }
    if (actions.includes("reduce-raas")) change("raas", "raasDose", "decrease");
    if (actions.includes("diet-advice")) out.push({ kind: "plan", category: "education", title: "Dietary potassium advice", dueDate: today, completesOn: { type: "manual" }, label: "" });
    if (actions.includes("binder")) out.push({ kind: "plan", category: "medication", title: "Potassium binder decision", dueDate: today, completesOn: { type: "manual" }, label: "" });
    if (actions.includes("urgent")) out.push({ kind: "plan", category: "follow_up", title: "Same-day urgent assessment", dueDate: today, completesOn: { type: "visit" }, label: "" });
  }
  if (wizardId === "renal-function") {
    if (actions.includes("reduce-diuretic")) change("loop", "diureticDose", "decrease");
    if (actions.includes("increase-diuretic")) change("loop", "diureticUp", "increase");
    if (actions.includes("reduce-raas")) change("raas", "raasDose", "decrease");
    if (actions.includes("hold-nephrotoxin")) out.push({ kind: "plan", category: "medication", title: "Stop nephrotoxic medication and document", dueDate: today, completesOn: { type: "manual" }, label: "" });
    if (actions.includes("nephrology")) out.push({ kind: "plan", category: "referral", title: "Nephrology referral", dueDate: addDays(today, 7), completesOn: { type: "manual" }, label: "" });
  }
  const recheck = Number(answers.recheck);
  if (Number.isFinite(recheck) && answers.recheck != null) {
    out.push({
      kind: "plan",
      category: "monitoring",
      title: "Renal function and potassium check",
      dueDate: addDays(today, recheck),
      completesOn: { type: "lab", codes: ["potassium", "creatinine"] },
      label: "",
    });
  }
  const review = String(answers.review ?? "none");
  if (review !== "none") {
    const [kind, days] = review.split("-");
    out.push({
      kind: "plan",
      category: "follow_up",
      title: kind === "phone" ? "Phone follow-up" : "Clinic review",
      dueDate: addDays(today, Number(days)),
      completesOn: kind === "phone" ? { type: "manual" } : { type: "visit" },
      label: "",
    });
  }
  return out.map((item) =>
    item.kind === "plan" ? { ...item, label: `${item.title} · ${fmtDay(item.dueDate, { weekday: true })}` } : item,
  );
}
