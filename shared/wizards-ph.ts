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

// ---------- PH slice 4: CTEPH after pulmonary embolism; PH with left heart or lung disease ----------
// ESC/ERS 2022 recommendation tables 3, 22, 23 and 24 (texts checked against the full guideline; levels shown
// only where a source states them — Rev Esp Cardiol 2023 comments: CTEPH work-up after PE and referral I C,
// riociguat and BPA I B):
//  - persistent or new-onset dyspnoea or exercise limitation after PE → evaluation for CTEPH/CTEPD (I C);
//    symptomatic mismatched perfusion defects beyond 3 months of anticoagulation → PH/CTEPH centre (I C);
//  - CTEPH: lifelong therapeutic anticoagulation (I); antiphospholipid syndrome testing (I), VKA with APS (I);
//    CTEPH team review for multimodality management (I); PEA for surgically accessible obstructions (I);
//    BPA when inoperable or residual PH (I B); riociguat for symptomatic inoperable or persistent/recurrent PH
//    after PEA (I B); long-term follow-up (I). CTEPD without PH: long-term anticoagulation on an individual
//    basis (IIa); PEA or BPA in selected symptomatic patients (IIa);
//  - left heart disease: RHC if it aids management decisions (I); severe pre-capillary component and/or RV
//    dysfunction → PH centre (I); CpcPH with a severe pre-capillary component (e.g. PVR >5 WU) → individualised
//    treatment (I). Drugs approved for PAH are not recommended in PH-LHD (Rev Esp Cardiol comments; class to
//    confirm);
//  - lung disease: optimise the lung disease and, where indicated, hypoxaemia, sleep-disordered breathing and
//    alveolar hypoventilation (I); suspected severe PH (PVR >5 WU) or uncertainty → PH centre (I); severe PH →
//    individualised treatment (I); eligible patients → lung transplant evaluation (I); RHC if it aids decisions
//    (I); inhaled treprostinil may be considered in PH-ILD (IIb); ambrisentan not in PH-IPF (III); riociguat
//    not in PH with an idiopathic interstitial pneumonia (III).
export const PVR_SEVERE = 5; // WU, ESC/ERS 2022 (severe pre-capillary component in LHD; severe PH in lung disease)
const IIP = ["IPF", "Other idiopathic interstitial pneumonia"];

PH_WIZARDS["post-pe"] = {
  id: "post-pe", title: "After pulmonary embolism: CTEPH / CTEPD", tone: "orange", group: "Pulmonary hypertension", episode: false,
  source: "ESC/ERS pulmonary hypertension 2022",
  note: "Breathlessness or exercise limitation after a pulmonary embolism needs evaluation for chronic thromboembolic disease. CTEPH is managed with a CTEPH team; CardioFlow plans the steps, never the anticoagulant dose.",
  facts: ["nt-probnp", "trv", "spap", "mpap", "pvr"],
  steps: [
    {
      id: "status", title: "After the embolism",
      questions: [
        { id: "time", label: "Anticoagulation since the embolism", type: "single", required: true, options: [{ value: "lt3", label: "Less than 3 months" }, { value: "3m", label: "3 months or more" }] },
        { id: "symptoms", label: "Persistent or new-onset breathlessness or exercise limitation", type: "single", required: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
        { id: "vq", label: "Ventilation/perfusion (V/Q) scan", type: "single", required: true, options: [{ value: "none", label: "Not done" }, { value: "matched", label: "No mismatched perfusion defects" }, { value: "mismatch", label: "Mismatched perfusion defects" }] },
        {
          id: "dx", label: "Conclusion so far", type: "single", required: true,
          options: [
            { value: "pending", label: "Work-up not complete" },
            { value: "none", label: "No chronic thromboembolic disease" },
            { value: "ctepd", label: "CTEPD without pulmonary hypertension" },
            { value: "cteph", label: "CTEPH (confirmed at a PH / CTEPH centre)" },
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
            { value: "none", label: "Nothing further now" },
            { value: "workup", label: "CTEPH / CTEPD work-up: echo, NT-proBNP and V/Q scan", effects: { plan: [{ category: "investigation", title: "CTEPH / CTEPD work-up after pulmonary embolism: echo, NT-proBNP and V/Q scan", days: 14, completesOn: manual }] } },
            { value: "refer", label: "PH / CTEPH centre referral", effects: { plan: [{ category: "referral", title: "PH / CTEPH centre referral: suspected chronic thromboembolic disease after pulmonary embolism", days: 14, completesOn: manual }] } },
            { value: "team", label: "CTEPH team review (PEA, BPA, riociguat)", effects: { plan: [{ category: "referral", title: "CTEPH team review: multimodality management (PEA, BPA, riociguat)", days: 14, completesOn: manual }] } },
            { value: "aps", label: "Antiphospholipid syndrome testing", effects: { plan: [{ category: "investigation", title: "Antiphospholipid syndrome testing (CTEPH)", days: 14, completesOn: manual }] } },
            { value: "anticoag", label: "Lifelong anticoagulation: plan with the CTEPH team", effects: { plan: [{ category: "medication", title: "CTEPH: lifelong therapeutic anticoagulation (VKA with antiphospholipid syndrome)", days: 7, completesOn: manual }] } },
            { value: "follow", label: "Long-term follow-up at the CTEPH centre", effects: { plan: [{ category: "follow_up", title: "CTEPH: long-term follow-up at the CTEPH centre", days: 182, completesOn: { type: "visit" } }] } },
          ],
        },
      ],
    },
  ],
};

PH_WIZARDS["post-pe"].outcome = (a: Answers): OutcomeItem[] =>
  a.dx === "cteph" ? [{ kind: "condition", code: "ph", attributes: { group: "Group 4 · CTEPH / PA obstruction" }, label: "Pulmonary hypertension: group 4 (CTEPH)" }] : [];

PH_WIZARDS["post-pe"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const p = ctx.ph;
  const rows: Assessment["rows"] = [
    { label: "Pulmonary embolism", value: p?.peAt ? `${p.peAt}${a.time === "3m" ? " · 3 months or more ago" : ""}` : "Date not recorded" },
    { label: "Echo probability of PH", value: p?.echo ? `${p.echo[0].toUpperCase()}${p.echo.slice(1)}` : "No echo with TR velocity or PH signs", tone: p?.echo === "high" || p?.echo === "intermediate" ? "orange" : undefined },
    { label: "Anticoagulation", value: p?.anticoagulants.length ? p.anticoagulants.map((x) => x.name).join(", ") : "None recorded", tone: a.dx === "cteph" && !p?.anticoagulants.length ? "orange" : undefined },
  ];
  const rec: string[] = [];
  if (a.symptoms === "yes" && a.dx !== "cteph") rec.push("Persistent or new-onset breathlessness or exercise limitation after PE: evaluate for CTEPH / CTEPD — echo, NT-proBNP and a V/Q scan (I C).");
  if (a.symptoms === "yes" && a.vq === "mismatch" && a.time === "3m" && a.dx !== "cteph") rec.push("Mismatched perfusion defects beyond 3 months of anticoagulation: refer to a PH / CTEPH centre (I C).");
  if (a.vq === "mismatch" && a.time === "lt3") rec.push("Less than 3 months of anticoagulation: residual defects are judged after 3 months.");
  if (a.dx === "cteph") {
    rec.push("Lifelong therapeutic anticoagulation in all patients with CTEPH (I).");
    rec.push(p?.aps && p.anticoagulants.some((x) => x.doac) ? "Antiphospholipid syndrome with a DOAC: anticoagulation with a VKA is recommended in CTEPH with APS (I)." : "Test for antiphospholipid syndrome (I); with APS, anticoagulate with a VKA (I).");
    rec.push("CTEPH team review for multimodality management (I): PEA for surgically accessible obstructions (I); BPA when inoperable or with residual PH after PEA (I B); riociguat for symptomatic inoperable CTEPH or persistent/recurrent PH after PEA (I B).");
    rec.push("Long-term follow-up after PEA or BPA and on medical therapy (I).");
  }
  if (a.dx === "ctepd") rec.push("CTEPD without PH: long-term anticoagulation on an individual basis (IIa); PEA or BPA in selected symptomatic patients (IIa).");
  if (!rec.length) rec.push("No sign of chronic thromboembolic disease from the answers: re-evaluate if breathlessness persists or appears.");
  return { heading: "After pulmonary embolism", rows, recommendations: rec };
};

PH_WIZARDS["ph-lhd-lung"] = {
  id: "ph-lhd-lung", title: "PH with left heart or lung disease", tone: "orange", group: "Pulmonary hypertension", episode: false,
  source: "ESC/ERS pulmonary hypertension 2022",
  note: "Treat the underlying heart or lung disease first. A severe pre-capillary component (PVR >5 WU) or RV dysfunction goes to a PH centre. PAH drugs are not for PH from left heart disease.",
  facts: ["pvr", "mpap", "pawp", "trv", "nt-probnp", "spo2"],
  steps: [
    {
      id: "cause", title: "Cause and severity",
      questions: [
        { id: "cause", label: "Underlying disease", type: "multi", required: true, options: [{ value: "lhd", label: "Left heart disease (HF, valve disease)" }, { value: "lung", label: "Lung disease or hypoxia" }] },
        { id: "optimised", label: "Treatment of the underlying disease", type: "single", required: true, options: [{ value: "yes", label: "Optimised" }, { value: "no", label: "Not yet optimised" }] },
        { id: "rv", label: "RV dysfunction (echo)", type: "single", required: true, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unknown", label: "Not assessed" }] },
        {
          id: "lungfx", label: "Lung disease: what needs treating", type: "multi", showIf: { question: "cause", includes: "lung" },
          options: [{ value: "hypox", label: "Hypoxaemia" }, { value: "sdb", label: "Sleep-disordered breathing" }, { value: "hypovent", label: "Alveolar hypoventilation" }, { value: "none", label: "None of these" }],
        },
      ],
    },
    {
      id: "plan", title: "Plan",
      questions: [
        {
          id: "actions", label: "Plan", type: "multi", required: true,
          options: [
            { value: "lhd", label: "Optimise treatment of the left heart disease", effects: { plan: [{ category: "follow_up", title: "PH with left heart disease: optimise treatment of the left heart disease, then reassess", days: 91, completesOn: { type: "visit" } }] } },
            { value: "lung", label: "Optimise the lung disease (respiratory team, pulmonary rehabilitation)", effects: { plan: [{ category: "referral", title: "PH with lung disease: optimise the lung disease, hypoxaemia and sleep-disordered breathing (respiratory team, pulmonary rehabilitation)", days: 28, completesOn: manual }] } },
            { value: "rhc", label: "Right heart catheterisation (if it will change management)", effects: { plan: [{ category: "investigation", title: "Right heart catheterisation (PH with left heart or lung disease)", days: 28, completesOn: { type: "manual" } }] } },
            { value: "refer", label: "PH centre referral", effects: { plan: [{ category: "referral", title: "PH centre referral: severe pre-capillary component or RV dysfunction (PH with left heart or lung disease)", days: 14, completesOn: manual }] } },
            { value: "ltx", label: "Lung transplant evaluation", effects: { plan: [{ category: "referral", title: "Lung transplant evaluation (PH with lung disease)", days: 28, completesOn: manual }] } },
          ],
        },
      ],
    },
  ],
};

PH_WIZARDS["ph-lhd-lung"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const p = ctx.ph;
  const cause = (a.cause as string[] | undefined) ?? [];
  const severe = p?.pvr != null && p.pvr > PVR_SEVERE;
  const rows: Assessment["rows"] = [
    { label: "Clinical group", value: p?.group ?? "Not recorded" },
    { label: "Haemodynamics", value: p?.haemo ?? "Not catheterised" },
    { label: "PVR", value: p?.pvr != null ? `${p.pvr} WU${severe ? " — severe pre-capillary component" : ""}` : "Not measured", tone: severe ? "orange" : undefined },
  ];
  if (cause.includes("lung") && p?.ildType) rows.push({ label: "Interstitial lung disease", value: p.ildType });
  const rec: string[] = [];
  if (a.optimised === "no") rec.push("Optimise the treatment of the underlying disease first, then reassess the pulmonary hypertension.");
  if (cause.includes("lhd")) {
    rec.push("Right heart catheterisation if it will aid management decisions (I).");
    if (severe || a.rv === "yes") rec.push(`${severe ? `PVR ${p!.pvr} WU (>5)` : "RV dysfunction"}: refer to a PH centre for a complete work-up (I); combined post- and pre-capillary PH with a severe pre-capillary component needs an individualised approach (I).`);
    rec.push("Drugs approved for PAH are not recommended in PH from left heart disease (class to confirm).");
  }
  if (cause.includes("lung")) {
    const fx = ((a.lungfx as string[] | undefined) ?? []).filter((x) => x !== "none").map((x) => ({ hypox: "hypoxaemia", sdb: "sleep-disordered breathing", hypovent: "alveolar hypoventilation" }[x]));
    rec.push(`Optimise the lung disease${fx.length ? ` and treat ${fx.join(", ")}` : ""} (I); pulmonary rehabilitation.`);
    if (severe) rec.push(`Severe PH with lung disease (PVR ${p!.pvr} WU, >5): PH centre (I), individualised treatment (I); eligible patients → lung transplant evaluation (I).`);
    else rec.push("Suspected severe PH or uncertainty about treatment: refer to a PH centre (I). PH drugs are not used in non-severe PH with lung disease.");
    if (p?.ildType) {
      rec.push("PH with ILD: inhaled treprostinil may be considered (IIb) — PH centre decision.");
      if (p.ildType === "IPF") rec.push("IPF: ambrisentan is not recommended (III).");
      if (IIP.includes(p.ildType)) rec.push("Idiopathic interstitial pneumonia: riociguat is not recommended (III).");
    }
  }
  return { heading: "PH with left heart or lung disease", rows, recommendations: rec };
};
