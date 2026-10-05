// Pulmonary hypertension pathways (PH module, slice 3). Content only. PAH follow-up by the ESC/ERS 2022
// four-strata model and the 2022 treatment algorithm as reported in guideline summaries (no classes
// shown, none were given there):
//  - first-line, low or intermediate risk without cardiopulmonary comorbidities: initial combination of an
//    ERA and a PDE5i; high risk: ERA + PDE5i with an IV/SC prostacyclin analogue; with cardiopulmonary
//    comorbidities: monotherapy (PDE5i or ERA) with closer follow-up;
//  - follow-up: low risk → continue; intermediate-low → add a prostacyclin-pathway drug (e.g. selexipag)
//    or switch the PDE5i to riociguat; intermediate-high or high → add an IV/SC prostacyclin analogue and/or
//    refer for lung transplant evaluation;
//  - goal: low risk, reassessed every 3–6 months.
// PAH drugs are started and dosed by the PH centre: CardioFlow plans the step, never the dose.
import type { Answers, Assessment, OutcomeItem, WizardContext, WizardDef } from "./wizards.js";
import { STRATA_LABEL, fourStrata } from "./ph.js";
import { addDays } from "./clinical.js";

const manual = { type: "manual" };
export const pahStrata = (ctx: WizardContext) => fourStrata({ fc: ctx.valve?.nyha ?? null, sixmwd: ctx.values?.["6mwd"]?.value ?? null, ntprobnp: ctx.values?.["nt-probnp"]?.value ?? null });

export const PH_WIZARDS: Record<string, WizardDef> = {
  "pah-followup": {
    id: "pah-followup", title: "PAH: risk assessment and treatment goal", tone: "orange", group: "Pulmonary hypertension", episode: false,
    source: "ESC/ERS pulmonary hypertension 2022",
    note: "The four-strata risk (functional class, 6-minute walk, NT-proBNP) guides therapy: the goal is low risk. Reassess every 3–6 months. PAH drugs are started and dosed at the PH centre.",
    facts: ["6mwd", "nt-probnp", "mpap", "pvr", "sbp"],
    steps: [
      {
        id: "now", title: "Where the patient is",
        questions: [
          { id: "stage", label: "Stage", type: "single", required: true, options: [{ value: "new", label: "Newly diagnosed, no PAH therapy yet" }, { value: "follow", label: "On PAH therapy (follow-up)" }] },
          { id: "comorbid", label: "Cardiopulmonary comorbidities", help: "e.g. risk factors for left heart disease or lung disease", type: "single", required: true, options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }] },
          {
            id: "therapy", label: "Current PAH therapy", type: "multi", required: true,
            options: [
              { value: "none", label: "None" },
              { value: "era", label: "Endothelin receptor antagonist", detectTag: ["era"] },
              { value: "pde5", label: "PDE5 inhibitor", detectTag: ["pde5"] },
              { value: "sgc", label: "Riociguat", detectTag: ["sgc"] },
              { value: "selexipag", label: "Selexipag (oral)", detectTag: ["prostacyclin"] },
              { value: "parenteral", label: "IV / SC prostacyclin analogue" },
            ],
          },
        ],
      },
      {
        id: "plan", title: "Plan",
        questions: [
          {
            id: "actions", label: "Plan", type: "multi", required: true,
            options: [
              { value: "continue", label: "Continue current therapy" },
              { value: "combo", label: "Initial combination: ERA + PDE5i", effects: { plan: [{ category: "referral", title: "PAH: initial combination therapy, ERA + PDE5i (PH centre)", days: 7, completesOn: manual }] } },
              { value: "mono", label: "Monotherapy: PDE5i or ERA", effects: { plan: [{ category: "referral", title: "PAH with cardiopulmonary comorbidities: monotherapy, PDE5i or ERA (PH centre)", days: 7, completesOn: manual }] } },
              { value: "selexipag", label: "Add a prostacyclin-pathway drug (selexipag)", effects: { plan: [{ category: "referral", title: "PAH: add a prostacyclin-pathway drug, e.g. selexipag (PH centre)", days: 14, completesOn: manual }] } },
              { value: "riociguat", label: "Switch the PDE5i to riociguat", effects: { plan: [{ category: "referral", title: "PAH: switch the PDE5i to riociguat (PH centre)", days: 14, completesOn: manual }] } },
              { value: "parenteral", label: "Add IV / SC prostacyclin analogue", effects: { plan: [{ category: "referral", title: "PAH: add an IV / SC prostacyclin analogue (PH centre)", days: 3, completesOn: manual }] } },
              { value: "transplant", label: "Lung transplant evaluation", effects: { plan: [{ category: "referral", title: "Lung transplant evaluation (PAH)", days: 14, completesOn: manual }] } },
            ],
          },
          { id: "reassess", label: "Reassess the risk", type: "single", required: true, options: [{ value: "91", label: "In 3 months" }, { value: "182", label: "In 6 months" }] },
        ],
      },
    ],
  },
};

PH_WIZARDS["pah-followup"].outcome = (a: Answers, ctx: WizardContext): OutcomeItem[] =>
  a.reassess ? [{ kind: "plan", category: "follow_up", title: "PAH: risk reassessment (functional class, 6-minute walk, NT-proBNP)", dueDate: addDays(ctx.today, Number(a.reassess)), completesOn: { type: "visit" }, label: "" }] : [];

PH_WIZARDS["pah-followup"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const r = pahStrata(ctx);
  const rows: Assessment["rows"] = r.items.map((i) => ({ label: i.label, value: `${i.value} · ${i.score} point${i.score > 1 ? "s" : ""}` }));
  rows.push({ label: "Four-strata risk", value: r.category ? `${STRATA_LABEL[r.category]} (mean ${r.mean}${r.missing.length ? `; missing ${r.missing.join(", ")}` : ""})` : "Cannot calculate", tone: r.category === "low" ? "green" : "orange" });
  const rec: string[] = [];
  const t = ((a.therapy as string[]) ?? []).filter((x) => x !== "none");
  if (a.stage === "new") {
    if (a.comorbid === "yes") rec.push("Cardiopulmonary comorbidities: start with monotherapy (PDE5i or ERA) and follow closely.");
    else if (r.category === "high") rec.push("High risk at diagnosis: ERA + PDE5i with an IV/SC prostacyclin analogue.");
    else rec.push("Low or intermediate risk without cardiopulmonary comorbidities: initial combination of an ERA and a PDE5i.");
  } else if (r.category) {
    if (r.category === "low") rec.push("Low risk: continue the current therapy.");
    if (r.category === "intermediate-low") rec.push(`Intermediate-low risk: add a prostacyclin-pathway drug (e.g. selexipag)${t.includes("pde5") ? " or switch the PDE5i to riociguat" : ""}.`);
    if (r.category === "intermediate-high" || r.category === "high") rec.push(`${STRATA_LABEL[r.category]} risk: add an IV/SC prostacyclin analogue and/or refer for lung transplant evaluation.`);
  }
  if (r.missing.length) rec.push(`Record ${r.missing.join(", ")} to complete the risk assessment.`);
  rec.push("Goal: low risk. Reassess every 3–6 months.");
  return { heading: "PAH: four-strata risk", rows, recommendations: rec };
};
