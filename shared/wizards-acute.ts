// Acute and safety wizards that apply to every cardiology patient. Content only: the one
// wizard engine renders them and `buildOutcome` applies each chosen option's effects.
// CardioFlow never doses acute drugs (antibiotics, insulin, reversal agents, electrolytes):
// it records the decision, the drug holds and the timed plan; doses follow the local protocol.
//
// Sources (checked 30 Sep 2026):
//  - Shock: SCAI SHOCK stage classification (2022 update, endorsed by ESC ACVC); ESC HF 2021/2026 acute HF.
//  - Sepsis: Surviving Sepsis Campaign 2021 (lactate, cultures before antibiotics, antibiotics within 1 h
//    for possible septic shock, fluids for hypoperfusion with reassessment, norepinephrine first line, MAP 65).
//  - Hyperglycaemic crises: ADA/EASD/JBDS/AACE/DTS consensus 2024 (DKA = diabetes or glucose ≥11.1 mmol/L,
//    β-hydroxybutyrate ≥3.0 mmol/L, pH <7.3 and/or bicarbonate <18; euglycaemic DKA with SGLT2 inhibitors;
//    HHS = glucose ≥33.3 mmol/L, osmolality >300, no significant ketosis or acidosis).
//  - Hypoglycaemia: ADA Standards of Care 2026 (level 1 <3.9, level 2 <3.0 mmol/L, level 3 severe event).
//  - Bleeding on antithrombotics: 2021 EHRA practical guide on NOACs; ESC 2023 ACS (DAPT de-escalation).
//  - INR out of range: EHRA/ACCP VKA management; ESC/EACTS 2025 valvular (mechanical valves).
//  - Digoxin toxicity: ESC HF 2021/2026 (target level 0.5–0.9 ng/mL), toxicity management.
//  - Severe BP: ESC 2024 hypertension (hypertensive emergency = severe BP with acute organ damage).
import type { Option, OutcomeItem, WizardDef } from "./wizards.js";

const RECHECK: Option[] = [
  { value: "0", label: "Same day" },
  { value: "1", label: "Tomorrow" },
  { value: "3", label: "In 3 days" },
  { value: "7", label: "In 1 week" },
];
const REVIEW: Option[] = [
  { value: "none", label: "No extra visit" },
  { value: "phone-3", label: "Phone call · 3 days" },
  { value: "clinic-7", label: "Clinic · 1 week" },
  { value: "clinic-14", label: "Clinic · 2 weeks" },
];
const now = (title: string, completesOn: Record<string, unknown> = { type: "manual" }, category = "follow_up") => ({ plan: [{ category, title, days: 0, completesOn }] });
const EMERGENCY = now("Same-day emergency / hospital assessment", { type: "visit" });

export const ACUTE_WIZARDS: Record<string, WizardDef> = {
  shock: {
    id: "shock", title: "Shock", tone: "red", group: "Acute & safety",
    source: "SCAI SHOCK 2022 · ESC HF acute HF · Surviving Sepsis 2021",
    note: "Treat the cause while supporting perfusion. Doses, pressors and devices follow the ICU/CCU protocol; CardioFlow records the decisions and the plan.",
    facts: ["sbp", "dbp", "hr", "lactate", "spo2", "creatinine"], trend: "sbp",
    recheck: { title: "Lactate and renal function", codes: ["lactate", "creatinine"] },
    steps: [
      {
        id: "type", title: "What kind of shock?",
        questions: [
          {
            id: "type", label: "Most likely type", type: "single", required: true,
            options: [
              { value: "cardiogenic", label: "Cardiogenic (pump failure, ACS, arrhythmia)" },
              { value: "septic", label: "Septic / distributive" },
              { value: "hypovolaemic", label: "Hypovolaemic / bleeding" },
              { value: "obstructive", label: "Obstructive (tamponade, PE, tension)" },
              { value: "mixed", label: "Mixed / unclear" },
            ],
          },
          {
            id: "stage", label: "SCAI stage", type: "single", required: true,
            help: "B: hypotension or tachycardia without hypoperfusion. C: hypoperfusion needing intervention. D: worsening despite it. E: extremis / arrest.",
            options: [
              { value: "B", label: "B · Beginning" }, { value: "C", label: "C · Classic" }, { value: "D", label: "D · Deteriorating" }, { value: "E", label: "E · Extremis" },
            ],
          },
          {
            id: "perfusion", label: "Signs of hypoperfusion", type: "multi",
            options: [
              { value: "cold", label: "Cold, clammy peripheries" }, { value: "mental", label: "Altered mental state" }, { value: "oliguria", label: "Oliguria" },
              { value: "lactate", label: "Raised lactate" }, { value: "congestion", label: "Pulmonary congestion" },
            ],
          },
        ],
      },
      {
        id: "actions", title: "Immediate actions",
        questions: [
          {
            id: "actions", label: "What will you do now?", type: "multi", required: true,
            options: [
              { value: "icu", label: "CCU / ICU bed and senior review", effects: now("CCU / ICU admission and senior review", { type: "visit" }) },
              { value: "hold-hf", label: "Hold beta-blocker, RAAS/ARNI, MRA, SGLT2i and vasodilators", effects: { hold: ["bb", "raas", "mra", "sglt2", "vasodilator", "bp-lowering"] } },
              { value: "echo", label: "Urgent bedside Echo", effects: now("Urgent bedside Echo", { type: "study", kind: "echo" }, "investigation") },
              { value: "ecg-cath", label: "ECG and cath lab if ACS", effects: now("12-lead ECG ± emergency angiography", { type: "study", kind: "ecg" }, "investigation") },
              { value: "cultures", label: "Cultures, lactate and antibiotics (sepsis)", effects: now("Blood cultures, lactate, antibiotics within 1 hour", { type: "manual" }, "monitoring") },
              { value: "pressor", label: "Vasopressor / inotrope per protocol", effects: now("Vasopressor / inotrope started per protocol", { type: "manual" }, "medication") },
              { value: "mcs", label: "Shock team: mechanical support assessment", effects: now("Shock team review: mechanical circulatory support", { type: "manual" }, "referral") },
              { value: "drain", label: "Pericardiocentesis / PE reperfusion", effects: now("Relieve obstruction (pericardiocentesis / PE reperfusion)", { type: "manual" }, "procedure") },
            ],
          },
        ],
      },
      { id: "monitoring", title: "Monitoring & plan", questions: [{ id: "recheck", label: "Repeat lactate and renal function", type: "single", options: RECHECK, required: true }] },
    ],
  },

  sepsis: {
    id: "sepsis", title: "Sepsis in a cardiac patient", tone: "red", group: "Acute & safety",
    source: "Surviving Sepsis Campaign 2021 · ESC endocarditis 2023",
    note: "Hour-1: lactate, cultures before antibiotics, antibiotics, fluids for hypoperfusion. In low EF or congestion give fluid in small boluses and reassess after each. Hold the drugs that harm when septic.",
    facts: ["temp", "hr", "rr", "sbp", "lactate", "wbc", "crp", "creatinine"], trend: "temp",
    recheck: { title: "Lactate, renal function and potassium", codes: ["lactate", "creatinine", "potassium"] },
    steps: [
      {
        id: "screen", title: "Recognise",
        questions: [
          {
            id: "signs", label: "Present now", type: "multi", required: true,
            options: [
              { value: "fever", label: "Fever or hypothermia" }, { value: "tachycardia", label: "Tachycardia" }, { value: "tachypnoea", label: "Tachypnoea / hypoxia" },
              { value: "hypotension", label: "Hypotension" }, { value: "mental", label: "Altered mental state" }, { value: "lactate", label: "Raised lactate" },
            ],
          },
          {
            id: "source", label: "Likely source", type: "single", required: true,
            options: [
              { value: "chest", label: "Chest" }, { value: "urine", label: "Urine" }, { value: "line", label: "Line / device pocket" }, { value: "valve", label: "Valve / endocarditis" },
              { value: "skin", label: "Skin / wound" }, { value: "abdomen", label: "Abdomen" }, { value: "unknown", label: "Unknown" },
            ],
          },
        ],
      },
      {
        id: "bundle", title: "Hour-1 bundle",
        questions: [
          {
            id: "actions", label: "Actions", type: "multi", required: true,
            options: [
              { value: "cultures", label: "Blood cultures before antibiotics", effects: now("Blood cultures (before antibiotics)", { type: "manual" }, "investigation") },
              { value: "lactate", label: "Lactate", effects: now("Lactate", { type: "lab", codes: ["lactate"] }, "monitoring") },
              { value: "antibiotics", label: "Antibiotics within 1 hour (per protocol)", effects: now("Antibiotics within 1 hour (local protocol)", { type: "manual" }, "medication") },
              { value: "fluids", label: "Fluid bolus with reassessment", effects: now("Fluid challenge with reassessment after each bolus", { type: "manual" }, "medication") },
              { value: "hold-sickday", label: "Hold SGLT2i, metformin, RAAS/ARNI, MRA, diuretic", effects: { hold: ["sglt2", "metformin", "raas", "mra", "loop", "thiazide"] } },
              { value: "endocarditis", label: "Endocarditis work-up (3 cultures, Echo)", effects: { plan: [{ category: "investigation", title: "Endocarditis work-up: 3 blood culture sets and Echo (TOE if prosthesis/device)", days: 0, completesOn: { type: "study", kind: "echo" } }] } },
              { value: "escalate", label: "ICU / outreach review", effects: now("ICU / outreach review", { type: "visit" }) },
            ],
          },
        ],
      },
      {
        id: "monitoring", title: "Monitoring & restart",
        questions: [
          { id: "recheck", label: "Repeat lactate, renal function and K", type: "single", options: RECHECK, required: true },
          { id: "review", label: "Review held medicines for restart", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },

  hyperglycaemia: {
    id: "hyperglycaemia", title: "Hyperglycaemia / ketoacidosis", tone: "red", group: "Diabetes",
    source: "ADA/EASD hyperglycaemic crises consensus 2024 · ADA Standards of Care 2026",
    note: "DKA can occur with normal glucose on SGLT2 inhibitors (euglycaemic DKA): check ketones whenever unwell on an SGLT2i. Insulin and fluids follow the DKA/HHS protocol.",
    facts: ["glucose", "ketones", "bicarbonate", "ph", "potassium", "sodium", "hba1c"], trend: "glucose",
    recheck: { title: "Glucose, ketones and electrolytes", codes: ["glucose", "potassium"] },
    steps: [
      {
        id: "classify", title: "What is it?",
        questions: [
          {
            id: "picture", label: "Picture", type: "single", required: true,
            help: "DKA: diabetes (any glucose) + ketones ≥3.0 mmol/L + pH <7.3 or bicarbonate <18. HHS: glucose ≥33.3 mmol/L, osmolality >300, little ketosis.",
            options: [
              { value: "dka", label: "DKA" }, { value: "eudka", label: "Euglycaemic DKA (on SGLT2i)" }, { value: "hhs", label: "HHS" },
              { value: "uncontrolled", label: "Uncontrolled diabetes, no crisis" },
            ],
          },
          {
            id: "drugs", label: "Relevant medicines", type: "multi",
            options: [
              { value: "sglt2", label: "SGLT2 inhibitor", detectTag: ["sglt2"] }, { value: "steroid", label: "Steroids" }, { value: "insulin-missed", label: "Missed insulin" },
              { value: "thiazide", label: "Thiazide", detectTag: ["thiazide"] },
            ],
          },
        ],
      },
      {
        id: "management", title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do?", type: "multi", required: true,
            options: [
              { value: "emergency", label: "Emergency admission for DKA/HHS protocol", effects: EMERGENCY },
              { value: "stop-sglt2", label: "Stop the SGLT2 inhibitor", requires: ["sglt2"], effects: { stop: ["sglt2"] } },
              { value: "diabetes-team", label: "Diabetes team review", effects: { plan: [{ category: "referral", title: "Diabetes / endocrine team review", days: 7, completesOn: { type: "manual" } }] } },
              { value: "sick-day", label: "Sick-day and ketone-testing education", effects: { plan: [{ category: "education", title: "Sick-day rules and ketone testing (SGLT2i, metformin, insulin)", days: 0, completesOn: { type: "manual" } }] } },
              { value: "intensify", label: "Intensify glucose-lowering therapy", effects: { plan: [{ category: "medication", title: "Intensify glucose-lowering therapy (diabetes plan)", days: 14, completesOn: { type: "visit" } }] } },
            ],
          },
        ],
      },
      { id: "monitoring", title: "Monitoring & plan", questions: [{ id: "recheck", label: "Recheck glucose, ketones and electrolytes", type: "single", options: RECHECK, required: true }, { id: "review", label: "Review", type: "single", options: REVIEW, required: true }] },
    ],
  },

  hypoglycaemia: {
    id: "hypoglycaemia", title: "Hypoglycaemia", tone: "orange", group: "Diabetes",
    source: "ADA Standards of Care 2026 (levels 1–3)",
    note: "Treat now per protocol, then find the cause. Sulfonylureas and insulin are the usual culprits, especially with falling eGFR, missed meals or fasting.",
    facts: ["glucose", "egfr", "hba1c", "weight"], trend: "glucose",
    recheck: { title: "Glucose check", codes: ["glucose"] },
    steps: [
      {
        id: "severity", title: "How severe?",
        questions: [
          {
            id: "level", label: "Level", type: "single", required: true,
            options: [
              { value: "1", label: "Level 1 · <3.9 mmol/L" }, { value: "2", label: "Level 2 · <3.0 mmol/L" }, { value: "3", label: "Level 3 · needed help" },
            ],
          },
          {
            id: "causes", label: "Causes", type: "multi",
            options: [
              { value: "su", label: "Sulfonylurea", detectTag: ["sulfonylurea"] }, { value: "insulin", label: "Insulin", detectTag: ["insulin"] },
              { value: "renal", label: "Falling eGFR" }, { value: "meal", label: "Missed meal / fasting" }, { value: "weight", label: "Weight loss" }, { value: "exercise", label: "Unusual exertion" },
            ],
          },
        ],
      },
      {
        id: "management", title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do?", type: "multi", required: true,
            options: [
              { value: "stop-su", label: "Stop the sulfonylurea", requires: ["sulfonylurea"], effects: { stop: ["sulfonylurea"] } },
              { value: "reduce-insulin", label: "Reduce insulin (diabetes plan)", requires: ["insulin"], effects: { plan: [{ category: "medication", title: "Reduce insulin dose (diabetes plan)", days: 0, completesOn: { type: "manual" } }] } },
              { value: "relax-target", label: "Relax the HbA1c target", effects: { plan: [{ category: "other", title: "Individualise (relax) the HbA1c target", days: 0, completesOn: { type: "manual" } }] } },
              { value: "education", label: "Hypoglycaemia education (and Ramadan plan)", effects: { plan: [{ category: "education", title: "Hypoglycaemia recognition and treatment education", days: 0, completesOn: { type: "manual" } }] } },
              { value: "diabetes-team", label: "Diabetes team review", effects: { plan: [{ category: "referral", title: "Diabetes / endocrine team review", days: 14, completesOn: { type: "manual" } }] } },
            ],
          },
        ],
      },
      { id: "monitoring", title: "Monitoring & plan", questions: [{ id: "recheck", label: "Glucose check", type: "single", options: RECHECK, required: true }, { id: "review", label: "Review", type: "single", options: REVIEW, required: true }] },
    ],
  },

  bleeding: {
    id: "bleeding", title: "Bleeding on antithrombotic therapy", tone: "red", group: "Acute & safety",
    source: "EHRA practical guide on NOACs 2021 · ESC DAPT 2017 · ESC ACS 2023 · ESC AF 2024",
    note: "Stop the bleeding and support the circulation; reverse only for life-threatening bleeding. Decide the restart date before discharge: most patients need their antithrombotic back.",
    facts: ["haemoglobin", "platelets", "inr", "creatinine", "sbp", "hr"], trend: "haemoglobin",
    recheck: { title: "Haemoglobin and renal function", codes: ["haemoglobin", "creatinine"] },
    steps: [
      {
        id: "severity", title: "How severe?",
        questions: [
          {
            id: "severity", label: "Severity", type: "single", required: true,
            options: [
              { value: "minor", label: "Minor (nuisance)" }, { value: "moderate", label: "Moderate / clinically relevant" }, { value: "major", label: "Major / severe" }, { value: "life", label: "Life-threatening" },
            ],
          },
          { id: "site", label: "Site", type: "single", options: [{ value: "gi", label: "GI" }, { value: "intracranial", label: "Intracranial" }, { value: "gu", label: "Urinary" }, { value: "access", label: "Access site" }, { value: "nose", label: "Nose / gums" }, { value: "other", label: "Other" }] },
          {
            id: "agents", label: "Antithrombotics", type: "multi",
            options: [
              { value: "aspirin", label: "Aspirin / P2Y12", detectTag: ["antiplatelet"] }, { value: "oac", label: "Anticoagulant", detectTag: ["oac"] },
            ],
          },
        ],
      },
      {
        id: "management", title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do?", type: "multi", required: true,
            options: [
              { value: "emergency", label: "Emergency assessment / admission", effects: EMERGENCY },
              { value: "hold-oac", label: "Hold the anticoagulant", requires: ["oac"], effects: { hold: ["oac"] } },
              { value: "hold-ap", label: "Hold all antiplatelet therapy", requires: ["antiplatelet"], effects: { hold: ["antiplatelet"] } },
              { value: "continue-dapt", label: "Continue DAPT", requires: ["p2y12"] },
              { value: "sapt", label: "Single antiplatelet: keep the P2Y12 inhibitor, hold aspirin", requires: ["p2y12"] },
              { value: "to-clopidogrel", label: "Switch ticagrelor / prasugrel to clopidogrel 75 mg daily", requires: ["p2y12-potent"] },
              { value: "reversal", label: "Reversal agent / PCC (life-threatening only)", effects: now("Specific reversal per protocol (idarucizumab, andexanet or PCC; vitamin K for warfarin)", { type: "manual" }, "medication") },
              { value: "gi", label: "Endoscopy / source control", effects: now("Endoscopy or source control", { type: "manual" }, "procedure") },
              { value: "ppi", label: "Add a PPI", effects: { plan: [{ category: "medication", title: "Start a proton-pump inhibitor", days: 0, completesOn: { type: "manual" } }] } },
              { value: "restart", label: "Set the restart / de-escalation plan", effects: { plan: [{ category: "medication", title: "Decide restart or de-escalation of antithrombotic therapy", days: 7, completesOn: { type: "visit" } }] } },
            ],
          },
        ],
      },
      { id: "monitoring", title: "Monitoring & plan", questions: [{ id: "recheck", label: "Repeat haemoglobin", type: "single", options: RECHECK, required: true }, { id: "review", label: "Review", type: "single", options: REVIEW, required: true }] },
    ],
  },

  "low-potassium": {
    id: "low-potassium", title: "Low potassium / magnesium", tone: "orange", group: "Acute & safety",
    source: "ESC HF 2021/2026 practical guidance · ESC ventricular arrhythmias 2022",
    note: "Low K and Mg raise arrhythmia and digoxin risk. Replace per protocol; the usual long-term fix is an MRA or RAAS inhibitor rather than more supplements.",
    facts: ["potassium", "magnesium", "creatinine", "egfr"], trend: "potassium",
    recheck: { title: "Potassium and magnesium", codes: ["potassium", "magnesium"] },
    steps: [
      {
        id: "context", title: "Context",
        questions: [
          { id: "ecg", label: "ECG / arrhythmia", type: "single", required: true, options: [{ value: "none", label: "No changes" }, { value: "changes", label: "ECG changes / arrhythmia" }, { value: "not-done", label: "Not done" }] },
          {
            id: "causes", label: "Causes", type: "multi",
            options: [
              { value: "loop", label: "Loop diuretic", detectTag: ["loop"] }, { value: "thiazide", label: "Thiazide", detectTag: ["thiazide"] },
              { value: "gi", label: "Vomiting / diarrhoea" }, { value: "intake", label: "Poor intake" }, { value: "insulin", label: "Insulin / beta-agonist" },
            ],
          },
        ],
      },
      {
        id: "management", title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do?", type: "multi", required: true,
            options: [
              { value: "urgent", label: "Urgent IV replacement (ECG changes or severe)", effects: EMERGENCY },
              { value: "oral-k", label: "Oral potassium replacement", effects: { plan: [{ category: "medication", title: "Oral potassium replacement (short course)", days: 0, completesOn: { type: "manual" } }] } },
              { value: "mg", label: "Magnesium replacement", effects: { plan: [{ category: "medication", title: "Magnesium replacement", days: 0, completesOn: { type: "manual" } }] } },
              { value: "mra", label: "Start or increase an MRA", effects: { plan: [{ category: "medication", title: "Start or up-titrate an MRA", days: 0, completesOn: { type: "manual" } }] } },
              { value: "review-diuretic", label: "Review the diuretic dose", requires: ["loop", "thiazide"], effects: { plan: [{ category: "medication", title: "Review diuretic dose", days: 0, completesOn: { type: "manual" } }] } },
            ],
          },
        ],
      },
      { id: "monitoring", title: "Monitoring & plan", questions: [{ id: "recheck", label: "Recheck K and Mg", type: "single", options: RECHECK, required: true }] },
    ],
  },

  hyponatraemia: {
    id: "hyponatraemia", title: "Low sodium", tone: "orange", group: "Acute & safety",
    source: "ESC HF 2021/2026 · ESC/HFA position on hyponatraemia in HF",
    note: "Judge volume first: in congested HF the fix is decongestion and fluid restriction; in the dry patient stop thiazide and reduce diuretic. Correct slowly.",
    facts: ["sodium", "potassium", "creatinine", "weight"], trend: "sodium",
    recheck: { title: "Sodium and renal function", codes: ["sodium", "creatinine"] },
    steps: [
      {
        id: "context", title: "Volume and symptoms",
        questions: [
          { id: "volume", label: "Volume status", type: "single", required: true, options: [{ value: "congested", label: "Congested (hypervolaemic)" }, { value: "euvolaemic", label: "Euvolaemic" }, { value: "dry", label: "Dry (hypovolaemic)" }] },
          { id: "symptoms", label: "Symptoms", type: "single", required: true, options: [{ value: "none", label: "None" }, { value: "mild", label: "Nausea, confusion" }, { value: "severe", label: "Seizure / reduced consciousness" }] },
          { id: "causes", label: "Contributors", type: "multi", options: [{ value: "thiazide", label: "Thiazide", detectTag: ["thiazide"] }, { value: "loop", label: "Loop diuretic", detectTag: ["loop"] }, { value: "ssri", label: "SSRI / other drug" }, { value: "water", label: "High water intake" }] },
        ],
      },
      {
        id: "management", title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do?", type: "multi", required: true,
            options: [
              { value: "emergency", label: "Emergency assessment (severe symptoms)", effects: EMERGENCY },
              { value: "stop-thiazide", label: "Stop the thiazide", requires: ["thiazide"], effects: { stop: ["thiazide"] } },
              { value: "fluid", label: "Fluid restriction advice", effects: { plan: [{ category: "education", title: "Fluid restriction advice", days: 0, completesOn: { type: "manual" } }] } },
              { value: "decongest", label: "Decongest (congested HF)", effects: { plan: [{ category: "medication", title: "Decongestion plan (see congestion pathway)", days: 0, completesOn: { type: "manual" } }] } },
              { value: "review-drug", label: "Review contributing drugs", effects: { plan: [{ category: "medication", title: "Review drugs that lower sodium", days: 0, completesOn: { type: "manual" } }] } },
            ],
          },
        ],
      },
      { id: "monitoring", title: "Monitoring & plan", questions: [{ id: "recheck", label: "Recheck sodium", type: "single", options: RECHECK, required: true }, { id: "review", label: "Review", type: "single", options: REVIEW, required: true }] },
    ],
  },

  inr: {
    id: "inr", title: "INR out of range", tone: "orange", group: "Acute & safety",
    source: "EHRA VKA guidance · ACCP antithrombotic guideline · ESC/EACTS 2025 valvular",
    note: "Look for bleeding first. Common causes: interacting drugs (antibiotics, amiodarone), diet, missed or extra doses, illness. Mechanical valves need a tighter target; never switch them to a DOAC.",
    facts: ["inr", "haemoglobin", "creatinine"], trend: "inr",
    recheck: { title: "INR", codes: ["inr"] },
    steps: [
      {
        id: "context", title: "Context",
        questions: [
          { id: "direction", label: "INR is", type: "single", required: true, options: [{ value: "high", label: "Above target" }, { value: "low", label: "Below target" }] },
          { id: "bleeding", label: "Bleeding", type: "single", required: true, options: [{ value: "none", label: "None" }, { value: "minor", label: "Minor" }, { value: "major", label: "Major" }] },
          { id: "causes", label: "Causes", type: "multi", options: [{ value: "interaction", label: "New interacting drug" }, { value: "diet", label: "Diet change" }, { value: "adherence", label: "Missed / extra doses" }, { value: "illness", label: "Illness / liver" }] },
        ],
      },
      {
        id: "management", title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do?", type: "multi", required: true,
            options: [
              { value: "emergency", label: "Emergency assessment (major bleeding)", effects: EMERGENCY },
              { value: "omit", label: "Omit dose(s) and adjust (anticoagulation clinic)", effects: { plan: [{ category: "medication", title: "Warfarin dose adjustment (anticoagulation clinic)", days: 0, completesOn: { type: "manual" } }] } },
              { value: "vitk", label: "Vitamin K per protocol", effects: { plan: [{ category: "medication", title: "Vitamin K per protocol", days: 0, completesOn: { type: "manual" } }] } },
              { value: "bridge", label: "Bridging (mechanical valve, low INR)", effects: { plan: [{ category: "medication", title: "Consider bridging with heparin (mechanical valve)", days: 0, completesOn: { type: "manual" } }] } },
              { value: "education", label: "Adherence, diet and interaction education", effects: { plan: [{ category: "education", title: "Warfarin education: adherence, diet, interactions", days: 0, completesOn: { type: "manual" } }] } },
            ],
          },
        ],
      },
      { id: "monitoring", title: "Monitoring & plan", questions: [{ id: "recheck", label: "Recheck INR", type: "single", options: RECHECK, required: true }] },
    ],
  },

  digoxin: {
    id: "digoxin", title: "Digoxin toxicity", tone: "red", group: "Rhythm & devices",
    source: "ESC HF 2021/2026 (target level 0.5–0.9 ng/mL) · ESC AF 2024",
    note: "Toxicity can occur at 'normal' levels when K is low or renal function falls. Life-threatening arrhythmia: digoxin-specific antibody per protocol.",
    facts: ["digoxin-level", "potassium", "magnesium", "creatinine", "egfr", "hr"], trend: "digoxin-level",
    recheck: { title: "Digoxin level, K and renal function", codes: ["digoxin-level", "potassium", "creatinine"] },
    steps: [
      {
        id: "features", title: "Features",
        questions: [
          { id: "features", label: "Features", type: "multi", required: true, options: [{ value: "gi", label: "Nausea / vomiting" }, { value: "visual", label: "Visual disturbance" }, { value: "confusion", label: "Confusion" }, { value: "brady", label: "Bradycardia / AV block" }, { value: "arrhythmia", label: "Ventricular arrhythmia" }, { value: "none", label: "None (level only)" }] },
          { id: "causes", label: "Contributors", type: "multi", options: [{ value: "renal", label: "Falling renal function" }, { value: "lowk", label: "Low potassium" }, { value: "amiodarone", label: "Amiodarone / dronedarone / verapamil", detectCode: ["amiodarone", "dronedarone", "verapamil"] }, { value: "age", label: "Age / low weight" }] },
        ],
      },
      {
        id: "management", title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do?", type: "multi", required: true,
            options: [
              { value: "emergency", label: "Emergency assessment (arrhythmia or severe)", effects: EMERGENCY },
              { value: "stop", label: "Stop digoxin", requires: ["digoxin"], effects: { stop: ["digoxin"] } },
              { value: "hold", label: "Hold digoxin and recheck", requires: ["digoxin"], effects: { hold: ["digoxin"] } },
              { value: "antibody", label: "Digoxin-specific antibody per protocol", effects: now("Digoxin-specific antibody fragments per protocol", { type: "manual" }, "medication") },
              { value: "correct-k", label: "Correct potassium and magnesium", effects: { plan: [{ category: "medication", title: "Correct potassium and magnesium", days: 0, completesOn: { type: "manual" } }] } },
            ],
          },
        ],
      },
      { id: "monitoring", title: "Monitoring & plan", questions: [{ id: "recheck", label: "Recheck level, K and renal function", type: "single", options: RECHECK, required: true }] },
    ],
  },

  "severe-hypertension": {
    id: "severe-hypertension", title: "Severe hypertension", tone: "orange", group: "Acute & safety",
    source: "ESC 2024 hypertension guidelines",
    note: "Hypertensive emergency = severe BP with acute organ damage: admit for IV therapy. Without organ damage, lower BP over days with oral therapy; avoid rapid drops.",
    facts: ["sbp", "dbp", "hr", "creatinine", "potassium"], trend: "sbp",
    recheck: { title: "Renal function and potassium", codes: ["creatinine", "potassium"] },
    steps: [
      {
        id: "hmod", title: "Acute organ damage?",
        questions: [
          {
            id: "hmod", label: "Signs of acute organ damage", type: "multi", required: true,
            options: [
              { value: "none", label: "None" }, { value: "chest-pain", label: "Chest pain / ACS" }, { value: "pulmonary-oedema", label: "Acute pulmonary oedema" }, { value: "neuro", label: "Neurological signs / headache with vomiting" },
              { value: "aortic", label: "Suspected aortic dissection" }, { value: "aki", label: "Acute kidney injury" }, { value: "retina", label: "Visual loss / retinopathy" }, { value: "pregnancy", label: "Pregnancy (pre-eclampsia)" },
            ],
          },
          { id: "adherence", label: "Adherence", type: "single", options: [{ value: "good", label: "Taking all medicines" }, { value: "poor", label: "Missed / stopped medicines" }, { value: "unknown", label: "Unknown" }] },
        ],
      },
      {
        id: "management", title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do?", type: "multi", required: true,
            options: [
              { value: "emergency", label: "Hypertensive emergency: admit for IV therapy", effects: EMERGENCY },
              { value: "oral", label: "Adjust oral therapy (no organ damage)", effects: { plan: [{ category: "medication", title: "Adjust oral antihypertensive therapy", days: 0, completesOn: { type: "manual" } }] } },
              { value: "home-bp", label: "Home BP monitoring", effects: { plan: [{ category: "monitoring", title: "Home BP readings for review", days: 7, completesOn: { type: "manual" } }] } },
              { value: "secondary", label: "Screen for secondary causes / adherence", effects: { plan: [{ category: "investigation", title: "Secondary hypertension and adherence screen", days: 14, completesOn: { type: "manual" } }] } },
            ],
          },
        ],
      },
      { id: "monitoring", title: "Monitoring & plan", questions: [{ id: "recheck", label: "Renal function and K", type: "single", options: RECHECK, required: true }, { id: "review", label: "BP review", type: "single", options: REVIEW, required: true }] },
    ],
  },
};

// Bleeding on DAPT (ESC 2017 DAPT focused update, bleeding algorithm; ESC ACS 2023 de-escalation):
// keep the P2Y12 inhibitor and hold aspirin, or switch ticagrelor/prasugrel to clopidogrel 75 mg
// daily (maintenance dose; no loading dose).
ACUTE_WIZARDS.bleeding.outcome = (a, ctx) => {
  const acts = (a.actions as string[]) ?? [];
  if (acts.includes("hold-ap")) return [];
  const out: OutcomeItem[] = [];
  const aspirin = ctx.meds.find((m) => m.code === "aspirin");
  const potent = ctx.meds.find((m) => m.tags.includes("p2y12-potent"));
  if (acts.includes("sapt") && aspirin) out.push({ kind: "medication", medicationId: aspirin.id, event: "hold", doseValue: null, label: "Aspirin: hold (single antiplatelet: P2Y12 inhibitor continues)" });
  if (acts.includes("to-clopidogrel") && potent) {
    out.push({ kind: "medication", medicationId: potent.id, event: "stop", doseValue: null, label: `${potent.name}: stop (switch to clopidogrel)` });
    out.push({ kind: "start", code: "clopidogrel", doseValue: 75, frequency: "OD", indication: "cad", label: "Clopidogrel 75 mg daily: start" });
  }
  return out;
};
