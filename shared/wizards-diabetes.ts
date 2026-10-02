// Diabetes pathways for cardiac patients: stepwise management, sick-day rules and Ramadan.
// Content only: the one wizard engine renders them and `buildOutcome` applies each chosen
// option's effects. Trade names come from the catalogue (to confirm against the MOH / MKH
// formulary). CardioFlow never doses insulin: it records the decision and the dated plan.
//
// Sources (checked 1 Oct 2026; confirm wording during clinical review):
//  - ADA Standards of Care in Diabetes 2026: §6 individual HbA1c goals; §9 choose agents by
//    cardiorenal risk first (SGLT2i, GLP-1 RA, finerenone), then glucose lowering (metformin,
//    tirzepatide, DPP-4i, basal insulin, sulfonylurea); no DPP-4i with a GLP-1 RA; §10 heart
//    failure (avoid thiazolidinediones and saxagliptin); §12 yearly eye and foot checks;
//    §16 SGLT2i held 3 days before surgery.
//  - 2023 ESC diabetes & CVD; 2026 ESC/ERA CVD and CKD (finerenone, GLP-1 RA in CKD).
//  - Sick-day guidance (ADA 2026 §16; UK "sick day rules"): pause SGLT2i, metformin,
//    sulfonylurea and, when dehydrated, RAAS blockers, MRA and diuretics; never stop basal insulin;
//    restart 24–48 h after eating and drinking normally.
//  - IDF-DAR Diabetes and Ramadan Practical Guidelines 2021: risk score (low 0–3, moderate 3.5–6,
//    high >6, fasting probably unsafe); end the fast if glucose <3.9 or >16.6 mmol/L.
import { brandOf, withBrand } from "./catalog.js";
import type { Effect, Option, WizardDef } from "./wizards.js";

const REVIEW: Option[] = [
  { value: "none", label: "No extra visit" },
  { value: "phone-7", label: "Phone call · 1 week" },
  { value: "clinic-28", label: "Clinic · 4 weeks" },
  { value: "clinic-90", label: "Clinic · 3 months" },
];
const RECHECK: Option[] = [
  { value: "0", label: "Same day" },
  { value: "1", label: "Tomorrow" },
  { value: "3", label: "In 3 days" },
];
const todo = (category: string, title: string, days = 0, completesOn: Record<string, unknown> = { type: "manual" }): Effect => ({ plan: [{ category, title, days, completesOn }] });
const b = withBrand;
const brand = brandOf;

export const DIABETES_WIZARDS: Record<string, WizardDef> = {
  diabetes: {
    id: "diabetes", title: "Diabetes management", tone: "yellow", group: "Diabetes", episode: false,
    source: "ADA Standards of Care 2026 · ESC diabetes & CVD 2023 · ESC/ERA CVD–CKD 2026",
    note: "Heart and kidney protection comes first and does not depend on HbA1c. Then lower glucose without hypoglycaemia. Pioglitazone is not offered: it is contraindicated in heart failure. Trade names to confirm against the MOH / MKH formulary.",
    facts: ["hba1c", "glucose", "egfr", "uacr", "potassium", "weight"], trend: "hba1c",
    steps: [
      {
        id: "status", title: "Where are we?",
        questions: [
          {
            id: "control", label: "Glycaemic control against the individual target", type: "single", required: true,
            options: [
              { value: "at-target", label: "At or below target" },
              { value: "above", label: "Above target" },
              { value: "symptomatic", label: "Very high, with symptoms or weight loss", hint: "Insulin may be needed; exclude a crisis" },
              { value: "hypos", label: "Hypoglycaemia is the problem" },
            ],
          },
          {
            id: "barriers", label: "Barriers", type: "multi",
            options: [
              { value: "adherence", label: "Missed doses" }, { value: "cost", label: "Cost / supply" }, { value: "diet", label: "Diet / weight" },
              { value: "injections", label: "Reluctant to inject" }, { value: "hypo-fear", label: "Fear of hypoglycaemia" },
            ],
          },
        ],
      },
      {
        id: "protect", title: "Heart & kidney protection",
        questions: [
          {
            id: "protect", label: "Agents with proven cardiorenal benefit (independent of HbA1c)", type: "multi", required: true,
            help: "Only agents the patient is not already taking are shown.",
            options: [
              { value: "covered", label: "Already on every indicated agent / none indicated" },
              { value: "sglt2", label: `SGLT2 inhibitor: ${b("empagliflozin")} or ${b("dapagliflozin")}`, hint: "HF, CKD (eGFR ≥20) or ASCVD · not in type 1 diabetes", unless: ["sglt2"],
                effects: todo("medication", `Start an SGLT2 inhibitor: ${b("empagliflozin")} or ${b("dapagliflozin")}`) },
              { value: "glp1", label: `GLP-1 RA with proven benefit: ${b("semaglutide")}, ${b("dulaglutide")} or ${b("liraglutide")}`, hint: "ASCVD, CKD, or obesity with HFpEF", unless: ["glp1"],
                effects: todo("medication", `Start a GLP-1 RA with proven benefit: ${b("semaglutide")}, ${b("dulaglutide")} or ${b("liraglutide")}`) },
              { value: "finerenone", label: `Finerenone: ${b("finerenone")}`, hint: "T2DM with albuminuria on ACEi/ARB, eGFR ≥25, K ≤5.0", requires: ["raas"], unless: ["mra"],
                effects: todo("medication", `Start finerenone (${brand("finerenone")}); potassium at 4 weeks`) },
            ],
          },
        ],
      },
      {
        id: "lower", title: "Glucose lowering",
        questions: [
          {
            id: "lower", label: "If above target, add or intensify", type: "multi", required: true,
            options: [
              { value: "no-change", label: "No change needed" },
              { value: "metformin", label: `Metformin: ${b("metformin")}`, hint: "eGFR ≥30 · maximum 1000 mg/day with eGFR 30–44", unless: ["metformin"],
                effects: todo("medication", `Start metformin (${brand("metformin")}) if eGFR ≥30`) },
              { value: "tirzepatide", label: `Tirzepatide: ${b("tirzepatide")}`, hint: "Largest HbA1c and weight reduction; HFpEF with obesity", unless: ["glp1"],
                effects: todo("medication", `Start tirzepatide (${brand("tirzepatide")})`) },
              { value: "switch-tirzepatide", label: `Switch the GLP-1 RA to tirzepatide (${brand("tirzepatide")})`, hint: "If more HbA1c or weight lowering is needed", requires: ["glp1"],
                effects: todo("medication", "Switch GLP-1 RA to tirzepatide") },
              { value: "dpp4", label: `DPP-4 inhibitor: ${b("sitagliptin")} or ${b("linagliptin")}`, hint: "Neutral in HF · not saxagliptin or alogliptin · not with a GLP-1 RA", unless: ["dpp4", "glp1"],
                effects: todo("medication", `Start a DPP-4 inhibitor: ${b("sitagliptin")} or ${b("linagliptin")}`) },
              { value: "basal", label: `Basal insulin: ${b("insulin-glargine")} or ${b("insulin-degludec")}`, hint: "Start low and titrate to fasting glucose (diabetes plan)", unless: ["insulin-basal"],
                effects: todo("medication", `Start basal insulin: ${b("insulin-glargine")} or ${b("insulin-degludec")} (dose by diabetes plan)`) },
              { value: "intensify-insulin", label: "Intensify insulin (diabetes team)", requires: ["insulin"], effects: todo("referral", "Diabetes team: intensify insulin", 14) },
              { value: "gliclazide", label: `Gliclazide MR: ${b("gliclazide")}`, hint: "Low cost; hypoglycaemia risk · avoid after severe hypoglycaemia", unless: ["sulfonylurea"],
                effects: todo("medication", `Start gliclazide MR (${brand("gliclazide")})`) },
            ],
          },
        ],
      },
      {
        id: "safety", title: "Safety",
        questions: [
          {
            id: "safety", label: "Remove or reduce", type: "multi", required: true,
            help: "Only drugs the patient takes are shown.",
            options: [
              { value: "none", label: "Nothing to change" },
              { value: "stop-tzd", label: "Stop pioglitazone (heart failure)", requires: ["tzd"], effects: { stop: ["tzd"] } },
              { value: "stop-dpp4-hf", label: "Stop saxagliptin / alogliptin (HF risk)", requires: ["dpp4-hf"], effects: { stop: ["dpp4-hf"] } },
              { value: "stop-dpp4", label: "Stop the DPP-4 inhibitor (on or starting a GLP-1 RA)", requires: ["dpp4"], effects: { stop: ["dpp4"] } },
              { value: "switch-glib", label: `Switch glibenclamide to gliclazide MR (${brand("gliclazide")})`, requires: ["glibenclamide"],
                effects: { stop: ["glibenclamide"], plan: [{ category: "medication", title: "Start gliclazide MR in place of glibenclamide", days: 0, completesOn: { type: "manual" } }] } },
              { value: "reduce-su", label: "Reduce the sulfonylurea", requires: ["sulfonylurea"] },
              { value: "stop-su", label: "Stop the sulfonylurea", requires: ["sulfonylurea"], effects: { stop: ["sulfonylurea"] } },
              { value: "reduce-insulin", label: "Reduce insulin (diabetes plan)", requires: ["insulin"], effects: todo("medication", "Reduce insulin dose (diabetes plan)") },
              { value: "reduce-metformin", label: "Reduce metformin (kidney function)", requires: ["metformin"] },
              { value: "stop-metformin", label: "Stop metformin (eGFR <30)", requires: ["metformin"], effects: { stop: ["metformin"] } },
            ],
          },
          { id: "suDose", label: "New sulfonylurea dose", type: "dose", medTag: "sulfonylurea", direction: "lower", showIf: { question: "safety", includes: "reduce-su" }, required: true },
          { id: "metforminDose", label: "New metformin dose", type: "dose", medTag: "metformin", direction: "lower", showIf: { question: "safety", includes: "reduce-metformin" }, required: true },
        ],
      },
      {
        id: "monitoring", title: "Monitoring & education",
        questions: [
          {
            id: "monitoring", label: "Book and teach", type: "multi", required: true,
            options: [
              { value: "hba1c", label: "HbA1c in 3 months", effects: todo("monitoring", "HbA1c", 90, { type: "lab", codes: ["hba1c"] }) },
              { value: "renal", label: "eGFR and UACR", effects: todo("monitoring", "Renal function and UACR", 90, { type: "lab", codes: ["creatinine", "uacr"] }) },
              { value: "eyes", label: "Retinal screening (yearly)", effects: todo("referral", "Diabetic retinal screening", 28) },
              { value: "feet", label: "Foot examination (yearly)", effects: todo("monitoring", "Diabetic foot examination", 0) },
              { value: "glucose", label: "Glucose self-monitoring / CGM", effects: todo("education", "Glucose self-monitoring or CGM education") },
              { value: "hypo", label: "Hypoglycaemia recognition and treatment", effects: todo("education", "Hypoglycaemia recognition and treatment education") },
              { value: "sick-day", label: "Sick-day rules", effects: todo("education", "Sick-day rules: which medicines to pause when unwell") },
              { value: "dietitian", label: "Dietitian / diabetes educator", effects: todo("referral", "Dietitian / diabetes educator", 28) },
              { value: "endo", label: "Endocrinology referral", effects: todo("referral", "Endocrinology referral", 28) },
            ],
          },
          { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },

  "sick-day": {
    id: "sick-day", title: "Sick-day rules", tone: "orange", group: "Diabetes",
    source: "ADA Standards of Care 2026 §16 · sick-day guidance",
    note: "While the patient cannot eat and drink normally, pause the drugs that cause ketoacidosis, lactic acidosis, hypoglycaemia or kidney injury. Never stop basal insulin. In heart failure, pause diuretics, RAAS blockers and MRA only if dehydrated, not congested.",
    facts: ["glucose", "ketones", "creatinine", "potassium", "sbp"], trend: "creatinine",
    recheck: { title: "Renal function, potassium and glucose", codes: ["creatinine", "potassium", "glucose"] },
    steps: [
      {
        id: "illness", title: "Illness",
        questions: [
          {
            id: "illness", label: "What is happening?", type: "multi", required: true,
            options: [
              { value: "vomiting", label: "Vomiting" }, { value: "diarrhoea", label: "Diarrhoea" }, { value: "fever", label: "Fever / infection" },
              { value: "intake", label: "Not eating or drinking" }, { value: "procedure", label: "Fasting for a procedure / surgery", hint: "Hold SGLT2 inhibitors 3 days before" },
            ],
          },
          {
            id: "redflags", label: "Any red flag?", type: "multi", required: true, help: "Any red flag means same-day hospital assessment.",
            options: [
              { value: "none", label: "None" },
              ...[["fluids", "Cannot keep fluids down"], ["ketones", "Raised ketones or persistently high glucose"], ["drowsy", "Drowsy or confused"], ["dehydrated", "Low BP / dehydrated"]].map(([value, label]) => ({
                value, label, effects: todo("follow_up", "Same-day hospital assessment (sick-day red flag)", 0, { type: "visit" }),
              })),
            ],
          },
        ],
      },
      {
        id: "pause", title: "Medicines to pause",
        questions: [
          {
            id: "pause", label: "Pause until eating and drinking normally", type: "multi", required: true,
            help: "AUTO = taken by the patient. Diuretics, RAAS blockers and MRA are not preselected: in heart failure pause them only if dehydrated.",
            options: [
              { value: "nothing", label: "Nothing to pause" },
              { value: "sglt2", label: "SGLT2 inhibitor (ketoacidosis)", requires: ["sglt2"], detectTag: ["sglt2"], effects: { hold: ["sglt2"] } },
              { value: "metformin", label: "Metformin (lactic acidosis)", requires: ["metformin"], detectTag: ["metformin"], effects: { hold: ["metformin"] } },
              { value: "sulfonylurea", label: "Sulfonylurea (hypoglycaemia)", requires: ["sulfonylurea"], detectTag: ["sulfonylurea"], effects: { hold: ["sulfonylurea"] } },
              { value: "glp1", label: "GLP-1 RA (if vomiting)", requires: ["glp1"], effects: { hold: ["glp1"] } },
              { value: "raas", label: "ACEi / ARB / ARNI (kidney injury)", requires: ["raas"], effects: { hold: ["raas"] } },
              { value: "mra", label: "MRA (high potassium)", requires: ["mra"], effects: { hold: ["mra"] } },
              { value: "diuretic", label: "Diuretic (dehydrated, not congested)", requires: ["loop", "thiazide"], effects: { hold: ["loop", "thiazide"] } },
            ],
          },
        ],
      },
      {
        id: "checks", title: "Insulin, checks and restart",
        questions: [
          {
            id: "checks", label: "Plan", type: "multi", required: true,
            options: [
              { value: "basal", label: "Keep basal insulin; glucose every 4 h (dose per diabetes plan)", requires: ["insulin"], detectTag: ["insulin"],
                effects: todo("education", "Insulin sick-day plan: keep basal insulin, glucose every 4 hours") },
              { value: "ketones", label: "Check blood ketones (SGLT2 inhibitor or type 1)", effects: todo("monitoring", "Blood ketones", 0, { type: "lab", codes: ["ketones"] }) },
              { value: "fluids", label: "Fluids: small frequent sips; sugary drinks if not eating", effects: todo("education", "Sick-day fluids and carbohydrate advice") },
              { value: "no-nsaid", label: "Avoid NSAIDs", effects: todo("education", "Avoid NSAIDs while unwell") },
              { value: "restart", label: "Restart paused medicines 24–48 h after eating and drinking normally", effects: todo("medication", "Restart paused medicines once eating and drinking normally", 2) },
              { value: "when-help", label: "When to seek help", effects: todo("education", "When to seek help: vomiting, raised ketones, drowsiness") },
            ],
          },
          { id: "recheck", label: "Renal function, potassium and glucose", type: "single", options: RECHECK, required: true },
          { id: "review", label: "Review", type: "single", options: [{ value: "none", label: "No extra visit" }, { value: "phone-1", label: "Phone call · tomorrow" }, { value: "phone-3", label: "Phone call · 3 days" }], required: true },
        ],
      },
    ],
  },

  ramadan: {
    id: "ramadan", title: "Ramadan fasting plan", tone: "blue", group: "Diabetes", episode: false,
    source: "IDF-DAR Diabetes and Ramadan Practical Guidelines 2021",
    note: "Best done 6–8 weeks before Ramadan. Score the risk with the IDF-DAR 2021 tool; CardioFlow records the category and the plan. Timing changes only: doses are decided by the clinician, nothing changes automatically.",
    facts: ["hba1c", "glucose", "egfr", "sbp", "weight"], trend: "hba1c",
    steps: [
      {
        id: "risk", title: "Risk",
        questions: [
          {
            id: "risk", label: "Risk elements (IDF-DAR 2021)", type: "multi", help: "Items marked AUTO come from the record.",
            options: [
              { value: "t1dm", label: "Type 1 diabetes" }, { value: "insulin", label: "On insulin", detectTag: ["insulin"] }, { value: "su", label: "On a sulfonylurea", detectTag: ["sulfonylurea"] },
              { value: "hypo", label: "Hypoglycaemia: recent, recurrent or unaware" }, { value: "dka", label: "DKA / HHS in the past year" }, { value: "a1c", label: "HbA1c above target" },
              { value: "unstable-cvd", label: "Unstable heart disease (recent ACS, decompensated HF, arrhythmia)" }, { value: "stable-cvd", label: "Stable macrovascular disease" },
              { value: "ckd", label: "Reduced eGFR" }, { value: "frail", label: "Older, frail or cognitive impairment" }, { value: "pregnancy", label: "Pregnancy" }, { value: "labour", label: "Physically demanding work" },
            ],
          },
          {
            id: "category", label: "IDF-DAR risk category", type: "single", required: true,
            options: [
              { value: "low", label: "Low (score 0–3): fasting probably safe" },
              { value: "moderate", label: "Moderate (3.5–6): fasting probably safe" },
              { value: "high", label: "High (>6): fasting probably unsafe" },
            ],
          },
        ],
      },
      {
        id: "advice", title: "Advice",
        questions: [
          {
            id: "advice", label: "Advice given", type: "single", required: true,
            options: [
              { value: "fast-plan", label: "May fast with this plan" },
              { value: "not-fast", label: "Advised not to fast", effects: todo("education", "Advised not to fast this Ramadan (IDF-DAR)") },
              { value: "fast-against", label: "Will fast against advice: close monitoring", effects: todo("education", "Fasting against advice: close glucose monitoring and early contact") },
            ],
          },
        ],
      },
      {
        id: "meds", title: "Medicine timing",
        questions: [
          {
            id: "meds", label: "Changes for the fasting month", type: "multi", required: true,
            help: "AUTO = taken by the patient. Each choice is written into the patient's plan.",
            options: [
              { value: "none", label: "No glucose-lowering or cardiac changes" },
              { value: "metformin", label: "Metformin at iftar (and suhoor if twice daily)", requires: ["metformin"], detectTag: ["metformin"], effects: todo("education", "Ramadan: metformin at iftar (and suhoor)") },
              { value: "sglt2", label: "SGLT2 inhibitor at iftar; enough fluid between iftar and suhoor; do not start during Ramadan", requires: ["sglt2"], detectTag: ["sglt2"],
                effects: todo("education", "Ramadan: SGLT2 inhibitor at iftar, fluids between iftar and suhoor") },
              { value: "su", label: "Sulfonylurea at iftar; consider a lower dose; avoid glibenclamide", requires: ["sulfonylurea"], detectTag: ["sulfonylurea"],
                effects: todo("medication", "Ramadan: sulfonylurea at iftar, dose reviewed") },
              { value: "basal", label: "Basal insulin at iftar; dose reduced per diabetes plan", requires: ["insulin-basal"], detectTag: ["insulin-basal"],
                effects: todo("medication", "Ramadan: basal insulin at iftar, dose reduced per diabetes plan") },
              { value: "prandial", label: "Premixed / prandial insulin: reorganise around iftar and suhoor", requires: ["insulin-premix", "insulin-prandial"], detectTag: ["insulin-premix", "insulin-prandial"],
                effects: todo("referral", "Diabetes team: Ramadan insulin regimen", 7) },
              { value: "glp1", label: "GLP-1 RA: continue; finish dose titration before Ramadan", requires: ["glp1"], detectTag: ["glp1"], effects: todo("education", "Ramadan: GLP-1 RA unchanged, titration finished beforehand") },
              { value: "dpp4", label: "DPP-4 inhibitor: no change, at iftar", requires: ["dpp4"], detectTag: ["dpp4"], effects: todo("education", "Ramadan: DPP-4 inhibitor at iftar") },
              { value: "diuretic", label: "Diuretic after iftar; watch for dehydration", requires: ["loop", "thiazide"], detectTag: ["loop", "thiazide"], effects: todo("education", "Ramadan: diuretic after iftar, watch for dehydration") },
              { value: "cardiac", label: "Other cardiac medicines: once daily at iftar, twice daily at iftar and suhoor", effects: todo("education", "Ramadan: cardiac medicines at iftar and suhoor") },
            ],
          },
        ],
      },
      {
        id: "monitoring", title: "Monitoring & education",
        questions: [
          {
            id: "monitoring", label: "Teach", type: "multi", required: true,
            options: [
              { value: "smbg", label: "Glucose checks during the fast (suhoor, midday, before iftar, if unwell)", effects: todo("education", "Ramadan glucose monitoring schedule") },
              { value: "break", label: "End the fast if glucose <3.9 or >16.6 mmol/L, or if unwell", effects: todo("education", "When to break the fast: glucose <3.9 or >16.6 mmol/L, or symptoms") },
              { value: "education", label: "Structured Ramadan education (meals, hydration, activity)", effects: todo("education", "Structured Ramadan education") },
            ],
          },
          { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
};
