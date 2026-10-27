// Lipids: LDL-C above goal — the next lipid-lowering step (27 Oct 2026, dose engines in the pathways). The goal,
// the reduction from baseline and the next step on the ESC/EAS ladder come from the same function as the
// lipids.ldl-goal alert (server guidelines.ts lipidStatus); the statin dose follows statinUp (high intensity,
// rosuvastatin renal limits from the label); the other doses are the label doses. LDL-C is rechecked 4–6 weeks
// after the change (ESC/EAS; shared/drug-monitoring.ts).
import { addDays } from "./clinical.js";
import { MEDICATION } from "./catalog.js";
import { bookingsAtStart } from "./drug-monitoring.js";
import { statinUp } from "./start-doses.js";
import type { OutcomeItem, WizardContext, WizardDef } from "./wizards.js";

export type LipidContext = {
  category: string; why: string; goal: number; reductionGoal: number | null;
  ldl: number | null; ldlAt: string | null; reduction: number | null; baseline: number | null;
  step: string | null; stepLabel: string | null; recheck: boolean; intolerant: boolean;
};

// label starting doses for the non-statin steps
const ADD: Record<string, { code: string; dose: number; frequency: string; why: string }> = {
  ezetimibe: { code: "ezetimibe", dose: 10, frequency: "OD", why: "10 mg once daily (Ezetrol SmPC)" },
  bempedoic: { code: "bempedoic-acid", dose: 180, frequency: "OD", why: "180 mg once daily (Nilemdo SmPC); statin intolerance" },
  pcsk9: { code: "evolocumab", dose: 140, frequency: "Every 2 weeks", why: "140 mg subcutaneously every 2 weeks (Repatha SmPC)" },
};

export const LIPID_WIZARDS: Record<string, WizardDef> = {
  lipids: {
    group: "Coronary",
    id: "lipids",
    title: "LDL-C above goal: next lipid-lowering step",
    shortTitle: "Lipids",
    tone: "blue",
    episode: false,
    note: "The goal and the next step on the ESC/EAS ladder are read from the record (risk category, LDL-C, reduction from baseline, current therapy). The dose is the label's; LDL-C is rechecked 4–6 weeks after the change.",
    source: "ESC/EAS dyslipidaemia 2019 · 2025 focused update · product labels (SmPC)",
    sourceShort: "ESC/EAS 2019/2025 · SmPC",
    facts: ["ldl-c", "egfr", "alt"],
    steps: [
      {
        id: "step",
        title: "Next step",
        questions: [
          {
            id: "step", label: "Lipid-lowering step", type: "single", required: true,
            options: [
              { value: "start-statin", label: "Start a high-intensity statin (atorvastatin 40 mg)", unless: ["statin"] },
              { value: "intensify", label: "Increase the statin to high intensity", requires: ["statin"] },
              { value: "switch", label: "Change to a high-intensity statin", requires: ["statin"] },
              { value: "ezetimibe", label: "Add ezetimibe 10 mg", unless: ["ezetimibe"] },
              { value: "bempedoic", label: "Add bempedoic acid 180 mg (statin intolerance)" },
              { value: "pcsk9", label: "Add a PCSK9 inhibitor (evolocumab 140 mg every 2 weeks)", unless: ["pcsk9"] },
              { value: "adherence", label: "Review adherence and recheck before changing" },
              { value: "none", label: "No change now" },
            ],
          },
        ],
      },
    ],
    checks: (_a, ctx) => [
      ...(ctx.lipids?.recheck ? ["LDL-C predates the last lipid-lowering change: a new result should decide the next step"] : []),
      ...(ctx.lipids?.ldl == null ? ["No LDL-C in the last 12 months: record a lipid profile first"] : []),
    ],
    outcome: (a, ctx) => lipidOutcome(a, ctx),
  },
};

export function lipidOutcome(a: Record<string, unknown>, ctx: WizardContext): OutcomeItem[] {
  const step = String(a.step ?? "");
  const out: OutcomeItem[] = [];
  if (step === "start-statin") out.push({ kind: "start", code: "atorvastatin", doseValue: 40, frequency: "OD", indication: "lipids", label: "Atorvastatin 40 mg once daily: start — high intensity (ESC/EAS: atorvastatin 40–80 mg, rosuvastatin 20–40 mg)" });
  if (step === "intensify" || step === "switch") out.push(...statinUp(ctx));
  const add = ADD[step];
  if (add) out.push({ kind: "start", code: add.code, doseValue: add.dose, frequency: add.frequency, indication: "lipids", label: `${MEDICATION[add.code]?.name ?? add.code} ${add.dose} mg ${add.frequency === "OD" ? "once daily" : add.frequency.toLowerCase()}: start — ${add.why}` });
  const changed = out.some((o) => o.kind === "start" || (o.kind === "medication" && o.event === "increase"));
  // the LDL-C recheck interval of the lipid-lowering monitoring schedule (ESC/EAS: 4–6 weeks after a change)
  const b = bookingsAtStart("atorvastatin", ["statin", "lipid"], { age: 0, crcl: null, egfr: null, lvef: null, hf: false, acs: false, daysOnDrug: 0, daysSinceChange: 0 })[0];
  if (b && (changed || step === "adherence"))
    out.push({ kind: "plan", category: "monitoring", title: changed ? "LDL-C after the lipid-lowering change" : "LDL-C after the adherence review", dueDate: addDays(ctx.today, b.days), completesOn: { type: "lab", codes: ["ldl-c"] }, label: `${b.check.schedule} (${b.check.source})` });
  if (step === "none") out.push({ kind: "note", label: "No lipid-lowering change now", decision: true });
  return out;
}
