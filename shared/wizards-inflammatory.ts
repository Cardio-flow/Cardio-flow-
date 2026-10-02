// Inflammatory and infective heart disease, and amiodarone thyroid dysfunction (Ahmed, 2 Oct 2026:
// "include what is needed"). Content only: the one wizard engine renders them; each chosen option
// writes dated plan items. No doses: CardioFlow names the guideline choice; the prescriber, the
// Endocarditis Team / microbiology and endocrinology set doses and durations.
//
// Sources:
//  - Pericarditis: 2025 ESC Guidelines for the management of myocarditis and pericarditis
//    (Eur Heart J 2025;46:3952). Diagnosis = typical chest pain + ≥1 of rub, ECG changes, raised CRP,
//    pericardial effusion, CMR pericardial oedema/LGE; high-risk patients admitted, low-risk managed
//    as outpatients; aspirin or NSAID + colchicine (I A) for at least 3–6 months, colchicine the last
//    drug stopped after sustained remission; low-to-moderate dose corticosteroids only when first-line
//    therapy fails (IIa C); IL-1 inhibitors for refractory recurrences (IIa C; I A with raised CRP);
//    exercise restriction for 1 month initially, then individualised; myocardial involvement =
//    inflammatory myopericardial syndrome. High-risk features as listed in the ESC pericardial
//    guidance (fever >38 °C, subacute course, large effusion / tamponade, no response to aspirin/NSAID
//    after 1 week, myocardial involvement, immunosuppression, trauma, oral anticoagulation).
//  - Endocarditis: 2023 ESC Guidelines for the management of endocarditis and the 2023 Duke-ISCVID
//    criteria. TTE first line; TOE when TTE is negative and suspicion remains, with a prosthetic
//    valve, and before IV → oral switch; repeat TTE/TOE within 5–7 days if suspicion stays high;
//    cardiac CTA for possible native/prosthetic valve IE; [18F]FDG-PET/CT for possible prosthetic
//    valve IE (may be considered for CIED IE); Endocarditis Team; emergency surgery within 24 h,
//    urgent within 3–5 days; vegetation ≥10 mm after ≥1 embolic episode or with another indication;
//    antibiotic prophylaxis for high-risk patients before oral-dental procedures.
//  - Amiodarone: 2018 European Thyroid Association guidelines for amiodarone-associated thyroid
//    dysfunction (baseline thyroid tests, TSH every 6 months on treatment; hypothyroidism: continue
//    amiodarone and add levothyroxine; thyrotoxicosis type 1 → thionamides, type 2 → oral
//    glucocorticoids, mixed/unclear → both; whether to continue amiodarone is decided with the
//    cardiologist; total thyroidectomy when refractory or cardiac function deteriorates).
import type { Option, WizardDef } from "./wizards.js";

const now = (title: string, completesOn: Record<string, unknown> = { type: "manual" }, category = "follow_up", days = 0) => ({ plan: [{ category, title, days, completesOn }] });
const REVIEW: Option[] = [
  { value: "none", label: "No extra visit" },
  { value: "phone-3", label: "Phone call · 3 days" },
  { value: "clinic-7", label: "Clinic · 1 week" },
  { value: "clinic-14", label: "Clinic · 2 weeks" },
];

export const INFLAMMATORY_WIZARDS: Record<string, WizardDef> = {
  pericarditis: {
    id: "pericarditis", title: "Acute or recurrent pericarditis", tone: "orange", group: "Inflammatory & infective heart disease",
    source: "ESC 2025 myocarditis and pericarditis",
    note: "Diagnosis needs typical chest pain plus at least one of: rub, ECG changes, raised CRP, pericardial effusion or CMR pericardial oedema/LGE. A raised troponin means myocardial involvement (myopericarditis). Doses are set by the prescriber; CardioFlow records the plan.",
    facts: ["crp", "hs-troponin", "wbc", "temp", "hr", "sbp", "creatinine"], trend: "crp",
    recheck: { title: "CRP", codes: ["crp"] },
    steps: [
      {
        id: "diagnosis", title: "Diagnosis",
        questions: [
          {
            id: "criteria", label: "Findings besides typical chest pain", type: "multi", required: true,
            options: [
              { value: "rub", label: "Pericardial rub" },
              { value: "ecg", label: "ECG: widespread ST elevation / PR depression" },
              { value: "crp", label: "Raised CRP" },
              { value: "effusion", label: "New or worsening pericardial effusion" },
              { value: "cmr", label: "CMR pericardial oedema / LGE" },
              { value: "none", label: "None of these (pericarditis not confirmed: consider other causes)" },
            ],
          },
          {
            id: "episode", label: "Episode", type: "single", required: true,
            options: [
              { value: "first", label: "First episode" },
              { value: "recurrent", label: "Recurrence after a symptom-free interval" },
              { value: "incessant", label: "Incessant (symptoms persist >4–6 weeks)" },
            ],
          },
          {
            id: "myocardium", label: "Myocardial involvement", type: "single", required: true,
            options: [
              { value: "no", label: "No: troponin normal, LV function normal" },
              { value: "yes", label: "Yes: raised troponin or new LV dysfunction (myopericarditis)", effects: { plan: [
                { category: "investigation", title: "Cardiac MRI (myocardial involvement)", days: 7, completesOn: { type: "study", kind: "cmr" } },
                { category: "follow_up", title: "Admit / monitor: myopericarditis (ECG monitoring for arrhythmia)", days: 0, completesOn: { type: "manual" } },
              ] } },
            ],
          },
        ],
      },
      {
        id: "risk", title: "Risk and setting",
        questions: [
          {
            id: "highrisk", label: "High-risk features", type: "multi", required: true,
            help: "Any high-risk feature → admit and look for a specific cause. None → treat as an outpatient and review in about a week.",
            options: [
              { value: "none", label: "None (low risk: outpatient)" },
              { value: "fever", label: "Fever >38 °C", effects: now("Admit: high-risk pericarditis; screen for a specific cause", { type: "manual" }) },
              { value: "subacute", label: "Subacute onset over days–weeks", effects: now("Admit: high-risk pericarditis; screen for a specific cause", { type: "manual" }) },
              { value: "large", label: "Large effusion (>20 mm) or tamponade", effects: now("Urgent Echo-guided assessment for pericardiocentesis (tamponade / large effusion)", { type: "manual" }, "referral") },
              { value: "noresponse", label: "No response to aspirin/NSAID after 1 week", effects: now("Admit: no response to first-line therapy; look for a specific cause", { type: "manual" }) },
              { value: "immuno", label: "Immunosuppressed", effects: now("Admit: high-risk pericarditis (immunosuppression)", { type: "manual" }) },
              { value: "trauma", label: "After trauma", effects: now("Admit: post-traumatic pericarditis", { type: "manual" }) },
              { value: "oac", label: "On oral anticoagulation", requires: ["oac"], effects: now("Admit / observe: pericarditis on anticoagulation (haemopericardium risk); review anticoagulant", { type: "manual" }) },
            ],
          },
        ],
      },
      {
        id: "tests", title: "Tests",
        questions: [
          {
            id: "tests", label: "Tests", type: "multi", required: true,
            options: [
              { value: "ecg", label: "12-lead ECG", effects: now("12-lead ECG", { type: "study", kind: "ecg" }, "investigation") },
              { value: "bloods", label: "CRP, troponin, FBC, renal function", effects: now("CRP, troponin, FBC and renal function", { type: "lab", codes: ["crp", "hs-troponin", "wbc", "creatinine"] }, "monitoring") },
              { value: "echo", label: "Echo (effusion, LV function)", effects: now("Echo: pericardial effusion and LV function", { type: "study", kind: "echo" }, "investigation") },
              { value: "cxr", label: "Chest X-ray", effects: now("Chest X-ray", { type: "manual" }, "investigation") },
              { value: "cause", label: "Targeted tests for a specific cause (TB, autoimmune, renal, cancer, post-cardiac injury)", effects: now("Targeted tests for a specific cause of pericarditis", { type: "manual" }, "investigation") },
            ],
          },
        ],
      },
      {
        id: "treatment", title: "Treatment",
        questions: [
          {
            id: "first", label: "First-line therapy (I A)", type: "multi", required: true,
            help: "Aspirin or an NSAID plus colchicine, for at least 3–6 months; taper by symptoms and CRP; colchicine is the last drug stopped. After MI, or on anticoagulation, aspirin is usually preferred to other NSAIDs.",
            options: [
              { value: "aspirin", label: "Aspirin (anti-inflammatory dose, tapered)", effects: now("Pericarditis: aspirin at anti-inflammatory dose, taper by symptoms and CRP", { type: "manual" }, "medication") },
              { value: "nsaid", label: "NSAID (e.g. ibuprofen), tapered", unless: ["oac"], effects: now("Pericarditis: NSAID at anti-inflammatory dose, taper by symptoms and CRP", { type: "manual" }, "medication") },
              { value: "colchicine", label: "Colchicine, at least 3–6 months, stopped last", effects: now("Colchicine for pericarditis: continue at least 3–6 months; stop last, after sustained remission", { type: "manual" }, "medication") },
              { value: "ppi", label: "Gastroprotection (PPI) while on aspirin / NSAID", effects: now("PPI while on high-dose aspirin / NSAID", { type: "manual" }, "medication") },
            ],
          },
          {
            id: "second", label: "If first-line therapy fails or is contraindicated", type: "multi",
            options: [
              { value: "steroid", label: "Low-to-moderate dose corticosteroid, slow taper (IIa C)", effects: now("Corticosteroid for pericarditis (low-to-moderate dose, slow taper); infection (incl. TB) excluded", { type: "manual" }, "medication") },
              { value: "il1", label: "Refractory recurrences: IL-1 inhibitor (I A with raised CRP; IIa C otherwise)", effects: now("Refer for IL-1 inhibitor (anakinra / rilonacept) for refractory recurrent pericarditis", { type: "manual" }, "referral") },
              { value: "pericardiectomy", label: "Constriction or refractory to medical therapy: pericardial centre / surgery", effects: now("Pericardial centre / surgical review (constriction or refractory pericarditis)", { type: "manual" }, "referral") },
            ],
          },
        ],
      },
      {
        id: "follow", title: "Activity and follow-up",
        questions: [
          {
            id: "activity", label: "Activity", type: "single", required: true,
            options: [
              { value: "1m", label: "No competitive or strenuous exercise for 1 month, then individualise", effects: now("Exercise restriction: 1 month, then reassess (symptoms, CRP, ECG, arrhythmia)", { type: "manual" }, "education", 30) },
              { value: "myo", label: "Myocardial involvement: restriction until CMR, ECG and Holter allow return", effects: now("Exercise restriction until recovery is confirmed (CMR, ECG, Holter)", { type: "manual" }, "education", 30) },
            ],
          },
          {
            id: "crp", label: "Repeat CRP", type: "single", required: true,
            options: [
              { value: "7", label: "In 1 week", effects: now("Repeat CRP to guide tapering", { type: "lab", codes: ["crp"] }, "monitoring", 7) },
              { value: "14", label: "In 2 weeks", effects: now("Repeat CRP to guide tapering", { type: "lab", codes: ["crp"] }, "monitoring", 14) },
            ],
          },
          { id: "review", label: "Cardiology review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },

  endocarditis: {
    id: "endocarditis", title: "Suspected infective endocarditis", tone: "red", group: "Inflammatory & infective heart disease",
    source: "ESC 2023 endocarditis · Duke-ISCVID 2023",
    note: "Take three sets of blood cultures before any antibiotic. TTE first, then TOE if suspicion remains or there is a prosthetic valve. Complicated endocarditis is managed with the Endocarditis Team; antibiotic choice, dose and duration follow microbiology and the ESC regimens.",
    facts: ["temp", "hr", "sbp", "crp", "wbc", "haemoglobin", "creatinine", "hs-troponin"], trend: "crp",
    recheck: { title: "CRP and renal function", codes: ["crp", "creatinine"] },
    steps: [
      {
        id: "suspicion", title: "Why endocarditis?",
        questions: [
          {
            id: "features", label: "Features", type: "multi", required: true,
            options: [
              { value: "fever-murmur", label: "Fever with a new or changed murmur" },
              { value: "bacteraemia", label: "Bacteraemia with a typical organism (S. aureus, streptococci, enterococci)" },
              { value: "prosthetic", label: "Prosthetic valve, repair or TAVI" },
              { value: "device", label: "Pacemaker / ICD (CIED)" },
              { value: "embolic", label: "Embolic event (stroke, limb, spleen, kidney)" },
              { value: "prior", label: "Previous endocarditis, congenital heart disease, IV drug use" },
              { value: "hf", label: "New heart failure or new conduction block" },
            ],
          },
        ],
      },
      {
        id: "tests", title: "Investigations",
        questions: [
          {
            id: "tests", label: "Tests", type: "multi", required: true,
            options: [
              { value: "cultures", label: "Three sets of blood cultures before antibiotics", effects: now("Three sets of blood cultures before antibiotics", { type: "manual" }, "investigation") },
              { value: "tte", label: "TTE (first line)", effects: now("TTE for suspected endocarditis", { type: "study", kind: "echo" }, "investigation") },
              { value: "toe", label: "TOE (TTE negative with suspicion, prosthetic valve, CIED, before oral switch)", effects: now("TOE for suspected endocarditis", { type: "manual" }, "investigation", 1) },
              { value: "repeat", label: "Repeat TTE/TOE in 5–7 days if suspicion stays high", effects: now("Repeat TTE/TOE (suspicion remains high)", { type: "manual" }, "investigation", 6) },
              { value: "ct", label: "Cardiac CT angiography (possible native or prosthetic valve IE)", effects: now("Cardiac CT angiography for possible endocarditis", { type: "manual" }, "investigation", 2) },
              { value: "pet", label: "[18F]FDG-PET/CT (possible prosthetic valve or device IE)", effects: now("FDG-PET/CT for possible prosthetic valve / device endocarditis", { type: "manual" }, "investigation", 3) },
              { value: "brain", label: "Brain imaging (neurological symptoms)", effects: now("Brain imaging (neurological symptoms)", { type: "manual" }, "investigation") },
              { value: "ecg", label: "ECG (PR prolongation / AV block suggests abscess)", effects: now("12-lead ECG: look for new AV block", { type: "study", kind: "ecg" }, "investigation") },
              { value: "bloods", label: "CRP, FBC, renal function", effects: now("CRP, FBC and renal function", { type: "lab", codes: ["crp", "wbc", "haemoglobin", "creatinine"] }, "monitoring") },
            ],
          },
          {
            id: "duke", label: "Duke-ISCVID classification (after the work-up)", type: "single", required: true,
            options: [
              { value: "definite", label: "Definite IE" },
              { value: "possible", label: "Possible IE" },
              { value: "rejected", label: "Rejected / pending" },
            ],
          },
        ],
      },
      {
        id: "team", title: "Endocarditis Team and surgery",
        questions: [
          {
            id: "team", label: "Endocarditis Team", type: "single", required: true,
            options: [
              { value: "refer", label: "Discuss with the Endocarditis Team (complicated IE, prosthetic valve, device, surgery question)", effects: now("Endocarditis Team discussion (cardiology, cardiac surgery, infectious diseases / microbiology, imaging)", { type: "manual" }, "referral") },
              { value: "local", label: "Uncomplicated: manage locally with infectious diseases / microbiology", effects: now("Infectious diseases / microbiology review", { type: "manual" }, "referral") },
            ],
          },
          {
            id: "surgery", label: "Surgical indications present", type: "multi", required: true,
            options: [
              { value: "none", label: "None now" },
              { value: "shock", label: "Severe regurgitation/obstruction/fistula with refractory pulmonary oedema or shock", effects: now("Emergency cardiac surgery (within 24 h): HF with refractory pulmonary oedema / shock", { type: "manual" }, "referral") },
              { value: "hf", label: "Heart failure from valve dysfunction without shock", effects: now("Urgent cardiac surgery (within 3–5 days): heart failure", { type: "manual" }, "referral") },
              { value: "uncontrolled", label: "Uncontrolled infection (abscess, false aneurysm, fistula, enlarging vegetation, fungal/multiresistant, persistent positive cultures)", effects: now("Urgent cardiac surgery (within 3–5 days): uncontrolled infection", { type: "manual" }, "referral") },
              { value: "embolism", label: "Vegetation ≥10 mm after ≥1 embolic episode, or ≥10 mm with another indication", effects: now("Urgent cardiac surgery (within 3–5 days): prevention of embolism", { type: "manual" }, "referral") },
              { value: "device", label: "Device (CIED) infection", effects: now("Complete device and lead extraction: device / EP team", { type: "manual" }, "referral") },
            ],
          },
        ],
      },
      {
        id: "treatment", title: "Treatment and monitoring",
        questions: [
          {
            id: "abx", label: "Antibiotics", type: "single", required: true,
            options: [
              { value: "empirical", label: "Empirical IV regimen after cultures, per microbiology and ESC tables", effects: now("Empirical IV antibiotics after blood cultures: regimen per microbiology / ESC 2023 tables", { type: "manual" }, "medication") },
              { value: "targeted", label: "Organism known: targeted regimen and duration per microbiology", effects: now("Targeted IV antibiotics per organism (microbiology / ESC 2023 tables)", { type: "manual" }, "medication") },
            ],
          },
          {
            id: "monitoring", label: "Monitoring and later steps", type: "multi", required: true,
            options: [
              { value: "clearance", label: "Repeat blood cultures to document clearance", effects: now("Repeat blood cultures: document clearance", { type: "manual" }, "investigation", 2) },
              { value: "drug-levels", label: "Vancomycin / gentamicin: levels and renal function", effects: now("Antibiotic levels and renal function (vancomycin / gentamicin)", { type: "lab", codes: ["creatinine"] }, "monitoring", 2) },
              { value: "ecg", label: "Serial ECGs (new AV block)", effects: now("Serial ECG: AV block", { type: "study", kind: "ecg" }, "investigation", 3) },
              { value: "oral", label: "Stable left-sided IE: consider partial oral therapy with the team (TOE before switching)", effects: now("Consider IV → oral switch with the Endocarditis Team; TOE before switching", { type: "manual" }, "medication", 10) },
              { value: "antithrombotic", label: "Review anticoagulant / antiplatelet with the team (bleeding, stroke)", requires: ["oac", "antiplatelet"], effects: now("Review antithrombotic therapy with the Endocarditis Team", { type: "manual" }, "medication") },
              { value: "dental", label: "Dental assessment; prophylaxis education for future dental procedures", effects: now("Dental assessment; antibiotic prophylaxis before future dental procedures (high-risk patient)", { type: "manual" }, "education", 14) },
              { value: "end-echo", label: "Echo at the end of treatment", effects: now("Echo at the end of antibiotic treatment", { type: "study", kind: "echo" }, "investigation", 42) },
            ],
          },
          { id: "review", label: "Cardiology review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },

  "amiodarone-thyroid": {
    id: "amiodarone-thyroid", title: "Thyroid on amiodarone", tone: "yellow", group: "Rhythm & devices",
    source: "ETA 2018 amiodarone-associated thyroid dysfunction",
    note: "Check thyroid function before amiodarone and every 6 months on it. Thyrotoxicosis can bring back arrhythmia or worsen heart failure. Endocrinology types the thyrotoxicosis and sets the doses; whether amiodarone continues is decided with cardiology.",
    facts: ["tsh", "hr", "weight", "inr", "glucose"], trend: "tsh",
    recheck: { title: "Thyroid function (TSH)", codes: ["tsh"] },
    steps: [
      {
        id: "situation", title: "Situation and plan",
        questions: [
          {
            id: "situation", label: "Why now?", type: "single", required: true,
            options: [
              { value: "baseline", label: "Starting amiodarone: baseline tests", effects: now("Baseline thyroid function (TSH, FT4, FT3) and thyroid antibodies before amiodarone", { type: "lab", codes: ["tsh"] }, "monitoring") },
              { value: "routine", label: "On amiodarone: routine 6-monthly check", effects: now("Thyroid function (TSH) every 6 months on amiodarone", { type: "lab", codes: ["tsh"] }, "monitoring", 182) },
              { value: "hypo", label: "High TSH: hypothyroidism" },
              { value: "thyrotox", label: "Low TSH with high FT4: thyrotoxicosis" },
            ],
          },
          {
            id: "hypo", label: "Hypothyroidism plan", type: "multi", showIf: { question: "situation", includes: "hypo" },
            options: [
              { value: "continue", label: "Amiodarone can be continued" },
              { value: "lt4", label: "Start levothyroxine (dose by the treating physician)", effects: now("Start levothyroxine for amiodarone-induced hypothyroidism", { type: "manual" }, "medication") },
              { value: "tsh", label: "TSH in 6–8 weeks", effects: now("TSH after starting levothyroxine", { type: "lab", codes: ["tsh"] }, "monitoring", 49) },
            ],
          },
          {
            id: "type", label: "Type (by endocrinology: Doppler, uptake, antibodies)", type: "single", showIf: { question: "situation", includes: "thyrotox" },
            options: [
              { value: "pending", label: "Not typed yet", effects: now("Endocrinology: type the thyrotoxicosis (colour-flow Doppler, uptake, TRAb)", { type: "manual" }, "referral") },
              { value: "type1", label: "Type 1 (underlying thyroid disease): thionamide ± perchlorate", effects: now("Type 1 amiodarone thyrotoxicosis: thionamide (± perchlorate) per endocrinology", { type: "manual" }, "medication") },
              { value: "type2", label: "Type 2 (destructive thyroiditis): oral glucocorticoid", effects: now("Type 2 amiodarone thyrotoxicosis: oral glucocorticoid per endocrinology", { type: "manual" }, "medication") },
              { value: "mixed", label: "Mixed / unclear: thionamide + glucocorticoid", effects: now("Mixed amiodarone thyrotoxicosis: thionamide + glucocorticoid per endocrinology", { type: "manual" }, "medication") },
            ],
          },
          {
            id: "cardiac", label: "Cardiac actions", type: "multi", showIf: { question: "situation", includes: "thyrotox" },
            options: [
              { value: "amio", label: "Decide with endocrinology whether amiodarone continues", effects: now("Decide amiodarone continuation with endocrinology (rhythm need vs thyroid type)", { type: "manual" }) },
              { value: "rate", label: "Rate control with a beta-blocker", effects: now("Beta-blocker for rate control in thyrotoxicosis", { type: "manual" }, "medication") },
              { value: "inr", label: "On warfarin: INR more often (thyrotoxicosis raises sensitivity)", requires: ["vka"], effects: now("INR check: thyrotoxicosis increases warfarin effect", { type: "lab", codes: ["inr"] }, "monitoring", 3) },
              { value: "glucose", label: "On glucocorticoid with diabetes: glucose monitoring", effects: now("Glucose monitoring on glucocorticoid", { type: "lab", codes: ["glucose"] }, "monitoring", 3) },
              { value: "surgery", label: "Refractory, or cardiac function worsening: urgent thyroidectomy discussion", effects: now("Urgent endocrine surgery discussion: total thyroidectomy", { type: "manual" }, "referral") },
            ],
          },
        ],
      },
      {
        id: "follow", title: "Follow-up",
        questions: [
          {
            id: "endo", label: "Endocrinology", type: "single", required: true,
            options: [
              { value: "refer", label: "Refer to endocrinology", effects: now("Endocrinology referral: thyroid dysfunction on amiodarone", { type: "manual" }, "referral", 7) },
              { value: "no", label: "Not needed now" },
            ],
          },
          { id: "review", label: "Cardiology review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
};
