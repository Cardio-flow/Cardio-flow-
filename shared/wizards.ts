// Config-driven complication wizards. One engine renders every wizard; a new
// complication is new content here, not new UI code. `buildOutcome` is shared so
// the preview the clinician confirms is exactly what the server records.
import { MEDICATION, doseLabel } from "./catalog.js";
import { addDays, fmtDay } from "./clinical.js";
import { ACUTE_WIZARDS } from "./wizards-acute.js";
import { DIABETES_WIZARDS } from "./wizards-diabetes.js";
import { GENERAL_WIZARDS } from "./wizards-general.js";
import { INFLAMMATORY_WIZARDS } from "./wizards-inflammatory.js";
import { CORONARY_WIZARDS } from "./wizards-coronary.js";
import { RHYTHM_WIZARDS } from "./wizards-rhythm.js";
import { VALVE_WIZARDS } from "./wizards-valve.js";
import { CMP_WIZARDS } from "./wizards-cmp.js";
import { PH_WIZARDS } from "./wizards-ph.js";
import { suggest } from "./wizard-guidance.js";

// requires: shown only when the patient takes a drug with one of these tags; unless: hidden when they do
export type Effect = {
  // dated plan items (days from today) and medication stop/hold by catalogue tag
  plan?: { category: string; title: string; days: number; completesOn?: Record<string, unknown> }[];
  stop?: string[];
  hold?: string[];
};
export type Option = {
  value: string; label: string; hint?: string; requires?: string[]; unless?: string[];
  // shown only with / hidden with one of these diagnoses (codes or tags), e.g. no DOAC with a mechanical valve
  requiresDx?: string[]; unlessDx?: string[];
  effects?: Effect;
  // prefilled (AUTO) when the patient takes a drug with one of these tags
  detectTag?: string[];
  // prefilled (AUTO) when the patient takes one of these medicines (catalogue codes): narrower than a tag
  detectCode?: string[];
  // prefilled (AUTO) when the record holds one of these diagnosis codes, or the latest lab is above a value
  detectCondition?: string[];
  detectLab?: { code: string; above: number };
};
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
  group?: "Heart failure" | "Rhythm & devices" | "Valve disease" | "Cardiomyopathy" | "Pulmonary hypertension" | "Acute & safety" | "Diabetes" | "Procedures & general medicine" | "Inflammatory & infective heart disease" | "Coronary";
  source?: string;
  // what the "recheck" answer books (default: renal function and potassium)
  recheck?: { title: string; codes: string[] };
  // a completed pathway opens (or reviews) a complication episode, unless this is false
  // (management plans such as diabetes or Ramadan are not complications)
  episode?: boolean;
  // items computed from the answers and the record (e.g. stop dates counted from a PCI)
  outcome?: (answers: Answers, ctx: WizardContext) => OutcomeItem[];
  // closing summary shown before confirming and saved with the decision
  assess?: (answers: Answers, ctx: WizardContext) => Assessment;
  // side-panel facts and trend (codes from the catalogue)
  facts?: string[];
  trend?: string;
};

export type WizardMed = {
  id: string;
  code: string;
  name: string;
  doseValue: number | null;
  doseUnit: string | null;
  frequency: string | null;
  tags: string[];
  startedAt?: string | null;
};
export type WizardContext = {
  today: string;
  meds: WizardMed[];
  facts: { label: string; value: string; date?: string; tone?: string }[];
  detected: Record<string, string[]>; // questionId -> auto-detected option values
  trend?: { code: string; label: string; unit: string; points: { date: string; value: number }[] };
  // who the patient is, for pathways whose summary depends on it (age, known CVD, CV risk factors)
  profile?: { age: number; cvd: boolean; riskFactors: boolean; sex?: "Male" | "Female" };
  // latest value of each measure (and the one before), and diagnosis codes + tags: read by the
  // guideline suggestions (shared/wizard-guidance.ts)
  values?: Record<string, { value: number; at: string; prev: number | null }>;
  dx?: string[];
  // AF: CHA₂DS₂-VA, pattern, latest ECG rhythm/rate and the DOAC label-dose check (rhythm module)
  af?: { score: number; items: string[]; pattern: string | null; ecgRhythm: string | null; ecgRate: number | null; doac: { code: string; dose: number | null; right: number; why: string }[] } | null;
  // valve module: latest NYHA class, listed lesions with severity, latest echo grades, treated positions
  valve?: {
    nyha: string | null; lesions: { code: string; severity: string | null }[]; echo: Record<string, string>; mrType: string | null; treated: string[]; bicuspid: boolean;
    // slice 4: the latest intervention per position, recent PCI/ACS, an anticoagulation indication, the INR target
    interventions?: { position: string; procedure: string; type: string; name: string; day: string }[];
    daptIndication?: string | null; oacIndication?: string | null; inrTarget?: string | null;
    // slice 5: listed prostheses and the findings of the latest echo
    prostheses?: { position: string; type: string }[]; echoFindings?: string[];
  } | null;
  // cardiomyopathy module: latest echo findings, NSVT on the latest ambulatory ECG, FHx answer
  cmp?: { echoFindings: string[]; nsvt: string | null; fhx: string | null; pgene: string | null; genetic?: string | null; cyp2c19?: string | null } | null;
  // pulmonary hypertension (slice 4): the listed group and haemodynamics, the latest PVR and echo probability,
  // the date of a listed pulmonary embolism, the ILD type, antiphospholipid syndrome, current anticoagulants
  ph?: { group: string | null; haemo: string | null; pvr: number | null; echo: string | null; peAt: string | null; ildType: string | null; aps: boolean; anticoagulants: { name: string; doac: boolean }[] } | null;
  // the current cardiac device and its latest check (rhythm module, slice 4)
  device?: { type: string | null; checkAt: string | null; check: Record<string, any> | null } | null;
  // the latest CABG (the after-CABG pathway counts from here)
  cabgAt?: string | null;
  // titles of open (planned) plan items, so a pathway does not plan the same thing twice
  planned?: string[];
  // coronary context: the index event that times antithrombotic therapy and ARC-HBR criteria found
  coronary?: {
    indexAt: string; indexTitle: string; acs: boolean; pciAt: string | null; complexPci: boolean; days: number;
    acsAt?: string | null; // first ACS/MI record of the index ACS (admission date): ACS follow-up counts from here
    hbrMajor: string[]; hbrMinor: string[];
  } | null;
};
// a pathway's closing summary: the patient's risk and the guideline recommendations for the answers given
export type Assessment = { heading: string; rows: { label: string; value: string; tone?: "orange" | "green" }[]; recommendations: string[] };
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
    group: "Heart failure",
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
              { value: "reduce-mra", label: "Reduce MRA dose", requires: ["mra"] },
              { value: "hold-mra", label: "Hold MRA", requires: ["mra"] },
              { value: "reduce-raas", label: "Reduce ACEi/ARB/ARNI dose", requires: ["raas"] },
              { value: "hold-raas", label: "Hold ACEi/ARB/ARNI", requires: ["raas"], hint: "K >6.0 (ESC HF practical guidance)" },
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
    group: "Heart failure",
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
              { value: "reduce-diuretic", label: "Reduce diuretic dose", requires: ["loop"] },
              { value: "increase-diuretic", label: "Increase diuretic dose", requires: ["loop"] },
              { value: "hold-nephrotoxin", label: "Stop nephrotoxin" },
              { value: "reduce-raas", label: "Reduce ACEi/ARB/ARNI dose", requires: ["raas"] },
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
  // ---- ESC HF 2021 practical guidance (retained in 2023/2026; confirm in review) ----
  congestion: {
    group: "Heart failure",
    id: "congestion",
    title: "Congestion / worsening heart failure",
    tone: "orange",
    note: "Keep foundational therapy unless the patient is unstable (hypotension, hypoperfusion, shock). Options are clinician choices; CardioFlow never changes a dose on its own.",
    steps: [
      {
        id: "signs",
        title: "How congested?",
        questions: [
          {
            id: "signs", label: "Signs of congestion", type: "multi", required: true,
            help: "Items marked AUTO come from the record.",
            options: [
              { value: "oedema", label: "Peripheral oedema" }, { value: "jvp", label: "Raised JVP" }, { value: "crackles", label: "Lung crackles" },
              { value: "orthopnoea", label: "Orthopnoea / PND" }, { value: "weight", label: "Weight gain" }, { value: "effusion", label: "Pleural effusion / ascites" },
            ],
          },
          {
            id: "redflags", label: "Any red flag?", type: "multi", required: true,
            help: "Any red flag means same-day hospital assessment.",
            options: [
              { value: "none", label: "None" }, { value: "hypoxia", label: "Resting hypoxia" }, { value: "hypoperfusion", label: "Hypotension / hypoperfusion" },
              { value: "acs", label: "Chest pain / suspected ACS" }, { value: "arrhythmia", label: "Fast or new arrhythmia" }, { value: "k-renal", label: "Severe K or renal derangement" },
            ],
          },
        ],
      },
      {
        id: "precipitants",
        title: "Why now?",
        questions: [
          {
            id: "precipitants", label: "Precipitating factors", type: "multi",
            help: "Treat the cause as well as the fluid.",
            options: [
              { value: "adherence", label: "Missed medication" }, { value: "salt", label: "Salt / fluid excess" }, { value: "infection", label: "Infection" },
              { value: "ischaemia", label: "Ischaemia" }, { value: "af", label: "AF / arrhythmia" }, { value: "htn", label: "Uncontrolled hypertension" },
              { value: "drugs", label: "NSAID, steroid or rate-limiting CCB" }, { value: "renal", label: "Worsening renal function" }, { value: "anaemia", label: "Anaemia / iron deficiency" },
            ],
          },
        ],
      },
      {
        id: "management",
        title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do?", type: "multi", required: true,
            options: [
              { value: "increase-loop", label: "Increase loop diuretic", requires: ["loop"] },
              { value: "start-loop", label: "Start a loop diuretic", unless: ["loop"] },
              { value: "thiazide", label: "Add a thiazide-type diuretic (short course)" },
              { value: "sglt2", label: "Start an SGLT2 inhibitor", unless: ["sglt2"] },
              { value: "admit", label: "Admit for IV diuretics" },
              { value: "precipitant", label: "Treat the precipitant" },
              { value: "self-care", label: "Daily weights, salt and fluid advice" },
            ],
          },
          { id: "loopDose", label: "New loop diuretic dose", type: "dose", medTag: "loop", direction: "any", showIf: { question: "actions", includes: "increase-loop" }, required: true },
        ],
      },
      {
        id: "monitoring",
        title: "Monitoring & plan",
        questions: [
          { id: "recheck", label: "Recheck renal function and potassium", type: "single", options: RECHECK, required: true },
          { id: "review", label: "Clinical review (weight, congestion)", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
  hypotension: {
    group: "Heart failure",
    id: "hypotension",
    title: "Low blood pressure on HF therapy",
    tone: "orange",
    note: "Asymptomatic low blood pressure usually needs no change. For symptoms, remove non-essential BP-lowering drugs first, then reduce the diuretic if not congested, and only then disease-modifying therapy.",
    steps: [
      {
        id: "context",
        title: "Symptoms and volume",
        questions: [
          {
            id: "symptoms", label: "Symptoms", type: "multi", required: true,
            options: [{ value: "none", label: "None (asymptomatic)" }, { value: "dizziness", label: "Dizziness / light-headed" }, { value: "orthostatic", label: "Postural symptoms" }, { value: "syncope", label: "Syncope" }, { value: "fatigue", label: "Fatigue" }],
          },
          {
            id: "volume", label: "Volume status today", type: "single", required: true,
            options: [{ value: "congested", label: "Congested" }, { value: "euvolaemic", label: "Euvolaemic" }, { value: "dry", label: "Dry / volume depleted" }],
          },
        ],
      },
      {
        id: "contributors",
        title: "Contributors",
        questions: [
          {
            id: "contributors", label: "What may be lowering the BP?", type: "multi",
            help: "Items marked AUTO were detected from the record.",
            options: [
              { value: "vasodilator", label: "Nitrate / CCB / other vasodilator" }, { value: "diuretic", label: "Diuretic without congestion" }, { value: "recent-uptitration", label: "Recent dose increase" },
              { value: "illness", label: "Intercurrent illness / poor intake" }, { value: "timing", label: "All drugs taken at the same time" },
            ],
          },
        ],
      },
      {
        id: "management",
        title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do? (in this order)", type: "multi", required: true,
            options: [
              { value: "continue", label: "Asymptomatic: continue therapy and recheck" },
              { value: "stop-vasodilator", label: "1 · Stop non-HF BP-lowering drugs", requires: ["vasodilator", "bp-lowering"], hint: "CCB (non-rate-control), alpha-blockers, centrally acting drugs; not RAAS, hydralazine/ISDN, rate control or angina nitrates" },
              { value: "reduce-loop", label: "2 · Reduce diuretic (not congested)", requires: ["loop"] },
              { value: "stagger", label: "Stagger the timing of doses" },
              { value: "reduce-raas", label: "3 · Reduce ACEi/ARB/ARNI dose", requires: ["raas"] },
              { value: "specialist", label: "Specialist HF review" },
            ],
          },
          { id: "loopDose", label: "New diuretic dose", type: "dose", medTag: "loop", direction: "lower", showIf: { question: "actions", includes: "reduce-loop" }, required: true },
          { id: "raasDose", label: "New ACEi/ARB/ARNI dose", type: "dose", medTag: "raas", direction: "lower", showIf: { question: "actions", includes: "reduce-raas" }, required: true },
        ],
      },
      {
        id: "monitoring",
        title: "Monitoring & plan",
        questions: [
          { id: "recheck", label: "Recheck renal function and potassium", type: "single", options: RECHECK, required: true },
          { id: "review", label: "BP and symptom review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
  bradycardia: {
    group: "Rhythm & devices",
    id: "bradycardia",
    title: "Bradycardia / AV block",
    tone: "orange",
    note: "Exclude heart block on the ECG. Review every rate-slowing drug before blaming the beta-blocker; halve rather than stop it unless severe.",
    steps: [
      {
        id: "context",
        title: "Rhythm and symptoms",
        questions: [
          {
            id: "symptoms", label: "Symptoms", type: "multi", required: true,
            options: [{ value: "none", label: "None" }, { value: "dizziness", label: "Dizziness" }, { value: "syncope", label: "Syncope / presyncope" }, { value: "fatigue", label: "Fatigue / breathlessness" }],
          },
          {
            id: "block", label: "ECG / monitoring shows", type: "single", required: true,
            help: "Prefilled from the latest ECG or Holter when available.",
            options: [
              { value: "sinus-brady", label: "Sinus bradycardia" }, { value: "first-degree", label: "First-degree AV block" }, { value: "mobitz1", label: "Mobitz I" },
              { value: "high-grade", label: "Mobitz II / complete heart block" }, { value: "pauses", label: "Pauses ≥3 s" }, { value: "slow-af", label: "Slow AF" }, { value: "no-ecg", label: "No ECG yet" },
            ],
          },
        ],
      },
      {
        id: "contributors",
        title: "Contributors",
        questions: [
          {
            id: "contributors", label: "Rate-slowing drugs and other causes", type: "multi",
            help: "Items marked AUTO were detected from the record.",
            options: [
              { value: "bb", label: "Beta-blocker" }, { value: "ivabradine", label: "Ivabradine" }, { value: "digoxin", label: "Digoxin" },
              { value: "amiodarone", label: "Amiodarone / dronedarone / sotalol" }, { value: "ccb", label: "Diltiazem / verapamil" }, { value: "hyperkalaemia", label: "Hyperkalaemia" },
              { value: "thyroid", label: "Hypothyroidism" }, { value: "ischaemia", label: "Ischaemia" },
            ],
          },
        ],
      },
      {
        id: "management",
        title: "Management",
        questions: [
          {
            id: "actions", label: "What will you do?", type: "multi", required: true,
            options: [
              { value: "continue", label: "Asymptomatic, no block: continue and monitor" },
              { value: "stop-other", label: "Stop other rate-slowing drugs (ivabradine, digoxin, diltiazem)", requires: ["ivabradine", "digoxin", "ndhp-ccb"] },
              { value: "reduce-bb", label: "Reduce the beta-blocker (halve)", requires: ["bb"] },
              { value: "reduce-bb-other", label: "Reduce the beta-blocker (atenolol, propranolol, labetalol)", requires: ["bb-other"] },
              { value: "ecg", label: "12-lead ECG" },
              { value: "holter", label: "Holter monitor" },
              { value: "pacing", label: "EP / pacing assessment" },
              { value: "urgent", label: "Same-day hospital assessment" },
            ],
          },
          { id: "bbDose", label: "New beta-blocker dose", type: "dose", medTag: "bb", direction: "lower", showIf: { question: "actions", includes: "reduce-bb" }, required: true },
          { id: "bbOtherDose", label: "New beta-blocker dose", type: "dose", medTag: "bb-other", direction: "lower", showIf: { question: "actions", includes: "reduce-bb-other" }, required: true },
        ],
      },
      {
        id: "monitoring",
        title: "Monitoring & plan",
        questions: [{ id: "review", label: "Heart rate and symptom review", type: "single", options: REVIEW, required: true }],
      },
    ],
  },
  ...ACUTE_WIZARDS,
  ...DIABETES_WIZARDS,
  ...GENERAL_WIZARDS,
  ...INFLAMMATORY_WIZARDS,
  ...CORONARY_WIZARDS,
  ...RHYTHM_WIZARDS,
  ...VALVE_WIZARDS,
  ...CMP_WIZARDS,
  ...PH_WIZARDS,
};

// Closing summary for every pathway that has no summary of its own (audit, 6 Oct): what was found, the
// follow-up, and the guideline recommendations that apply to these answers (the same cited suggestions the
// steps show). Saved with the decision, so the Journey reads why the plan was made.
const PLAN_QUESTIONS = new Set(["actions", "recheck", "review", "now", "post", "monitoring", "after", "followup", "reassess"]);
const FLAG_QUESTIONS = new Set(["redflags", "highrisk", "instability", "features", "hmod"]);
function closingSummary(def: WizardDef) {
  return (a: Answers, ctx: WizardContext): Assessment => {
    const rows: Assessment["rows"] = [];
    const recs: string[] = [];
    for (const st of def.steps)
      for (const q of visibleQuestions(st, a)) {
        if (!q.options) continue;
        const allowed = new Set(optionsFor(q, ctx).map((o) => o.value));
        // the cited suggestions the answers follow (the ones not taken are listed separately on Confirm)
        const chosen = (v: string) => (Array.isArray(a[q.id]) ? (a[q.id] as string[]).includes(v) : a[q.id] === v);
        for (const x of suggest(def.id, q.id, a, ctx, allowed)) if (x.value !== "none" && chosen(x.value) && !recs.includes(x.why)) recs.push(x.why);
        if (PLAN_QUESTIONS.has(q.id) || q.type !== "single" && q.type !== "multi") continue;
        const v = a[q.id];
        const vals = Array.isArray(v) ? v : v != null && v !== "" ? [String(v)] : [];
        if (!vals.length) continue;
        const flagged = FLAG_QUESTIONS.has(q.id);
        rows.push({ label: q.label, value: vals.map((x) => q.options!.find((o) => o.value === x)?.label ?? x).join(" · "), tone: flagged ? (vals.some((x) => x !== "none") ? "orange" : "green") : undefined });
      }
    const follow: string[] = [];
    const days = Number(a.recheck);
    if (a.recheck != null && a.recheck !== "" && Number.isFinite(days)) follow.push(`${(def.recheck?.title ?? "Renal function and potassium check")} · ${fmtDay(addDays(ctx.today, days))}`);
    const rq = def.steps.flatMap((st) => st.questions).find((q) => q.id === "review");
    if (a.review && a.review !== "none") follow.push(rq?.options?.find((o) => o.value === a.review)?.label ?? String(a.review));
    if (follow.length) rows.push({ label: "Follow-up", value: follow.join(" · ") });
    return { heading: `${def.title}: summary`, rows, recommendations: recs };
  };
}
for (const w of Object.values(WIZARDS)) w.assess ??= closingSummary(w);

// Which medicines each wizard shows beside the questions.
export const RELEVANT_TAGS: Record<string, string[]> = {
  hyperkalaemia: ["raas", "mra", "potassium-sparing", "loop", "sglt2"],
  "renal-function": ["raas", "mra", "potassium-sparing", "loop", "sglt2"],
  congestion: ["loop", "thiazide", "raas", "mra", "sglt2", "bb"],
  hypotension: ["raas", "bb", "loop", "mra", "sglt2", "vasodilator", "bp-lowering"],
  bradycardia: ["bb", "rate-slowing"],
  diabetes: ["metformin", "sglt2", "glp1", "dpp4", "sulfonylurea", "tzd", "insulin", "mra", "raas"],
  "sick-day": ["sglt2", "metformin", "sulfonylurea", "insulin", "glp1", "raas", "mra", "loop", "thiazide"],
  ramadan: ["metformin", "sglt2", "glp1", "dpp4", "sulfonylurea", "insulin", "loop", "thiazide"],
};

// Options that fit this patient's current medicines.
export function optionsFor(q: Question, ctx: Pick<WizardContext, "meds"> & { dx?: string[] }) {
  const tags = new Set(ctx.meds.flatMap((m) => m.tags));
  const dx = new Set(ctx.dx ?? []);
  return (q.options ?? []).filter((o) =>
    (!o.requires || o.requires.some((t) => tags.has(t))) && (!o.unless || !o.unless.some((t) => tags.has(t))) &&
    (!o.requiresDx || o.requiresDx.some((t) => dx.has(t))) && (!o.unlessDx || !o.unlessDx.some((t) => dx.has(t))));
}

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
  // medicationRef "code:<drug>" links a dated plan item to the current (or newly started) medicine
  | { kind: "plan"; category: string; title: string; dueDate: string; completesOn: Record<string, unknown>; label: string; medicationId?: string | null; medicationRef?: string }
  // a maintenance medicine started by the pathway (catalogue dose; never acute or loading doses)
  | { kind: "start"; code: string; doseValue: number; frequency: string; indication: string; label: string }
  // a diagnosis the pathway confirms (added, or its detail updated, keeping its onset)
  | { kind: "condition"; code: string; attributes: Record<string, unknown>; label: string }
  | { kind: "note"; label: string }
  // why a drug class is not given (recorded once, reused by every rule, as from an alert card)
  | { kind: "barrier"; drugClass: string; category: "contraindication" | "declined"; label: string };

// wizards whose dose questions are handled explicitly above the generic pass
const LEGACY = new Set(["hyperkalaemia", "renal-function", "congestion", "hypotension", "bradycardia"]);

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
    if (actions.includes("reduce-raas") && !actions.includes("hold-raas")) change("raas", "raasDose", "decrease");
    if (actions.includes("hold-raas")) {
      const m = med("raas");
      if (m) out.push({ kind: "medication", medicationId: m.id, event: "hold", doseValue: null, label: `${m.name}: hold` });
    }
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
  const stopTagged = (tags: string[]) => {
    for (const m of ctx.meds.filter((x) => x.tags.some((t) => tags.includes(t))))
      out.push({ kind: "medication", medicationId: m.id, event: "stop", doseValue: null, label: `${m.name}: stop` });
  };
  const plan = (category: string, title: string, days: number, completesOn: Record<string, unknown> = { type: "manual" }) =>
    out.push({ kind: "plan", category, title, dueDate: addDays(today, days), completesOn, label: "" });
  const red = ((answers.redflags as string[] | undefined) ?? []).filter((x) => x !== "none");
  if (wizardId === "congestion") {
    if (red.length || actions.includes("admit")) plan("follow_up", red.length ? "Same-day hospital assessment (red flag)" : "Admission for IV diuretics", 0, { type: "visit" });
    if (actions.includes("increase-loop")) change("loop", "loopDose", "increase");
    if (actions.includes("start-loop")) plan("medication", "Start a loop diuretic (dose by clinician)", 0);
    if (actions.includes("thiazide")) plan("medication", "Short thiazide-type diuretic course (sequential nephron blockade)", 0);
    if (actions.includes("sglt2") && !ctx.meds.some((m) => m.tags.includes("sglt2"))) plan("medication", "Start an SGLT2 inhibitor", 0);
    if (actions.includes("precipitant")) plan("other", "Treat the precipitant: " + (((answers.precipitants as string[]) ?? []).join(", ") || "as documented"), 0);
    if (actions.includes("self-care")) plan("education", "Daily weights, flexible diuretic, salt and fluid advice", 0);
  }
  if (wizardId === "hypotension") {
    // only BP-lowering drugs without HF benefit: never RAAS/ARNI (incl. combination pills), hydralazine/ISDN,
    // rate control (diltiazem, verapamil, beta-blockers) or a nitrate for angina
    if (actions.includes("stop-vasodilator")) {
      const angina = (ctx.dx ?? []).some((d) => d === "cad" || d === "cad-ccs");
      for (const m of ctx.meds.filter((x) => x.tags.some((t) => t === "vasodilator" || t === "bp-lowering") && !x.tags.some((t) => ["raas", "arni", "rate-slowing"].includes(t))
        && !["hydralazine", "isosorbide-dinitrate"].includes(x.code) && !(angina && x.tags.includes("nitrate"))))
        out.push({ kind: "medication", medicationId: m.id, event: "stop", doseValue: null, label: `${m.name}: stop` });
    }
    if (actions.includes("reduce-loop")) change("loop", "loopDose", "decrease");
    if (actions.includes("reduce-raas")) change("raas", "raasDose", "decrease");
    if (actions.includes("stagger")) plan("education", "Stagger dose timing (spread BP-lowering drugs through the day)", 0);
    if (actions.includes("specialist")) plan("referral", "Specialist HF review for low blood pressure", 7, { type: "visit" });
  }
  if (wizardId === "bradycardia") {
    if (actions.includes("stop-other")) stopTagged(["ivabradine", "digoxin", "ndhp-ccb"]);
    if (actions.includes("reduce-bb")) change("bb", "bbDose", "decrease");
    if (actions.includes("reduce-bb-other")) change("bb-other", "bbOtherDose", "decrease");
    if (actions.includes("ecg")) plan("investigation", "12-lead ECG", 0, { type: "study", kind: "ecg" });
    if (actions.includes("holter")) plan("investigation", "Holter monitor", 14, { type: "study", kind: "holter" });
    if (actions.includes("pacing")) plan("referral", "EP / pacing assessment", answers.block === "high-grade" || answers.block === "pauses" ? 0 : 14);
    if (actions.includes("urgent") || answers.block === "high-grade") plan("follow_up", "Same-day hospital assessment", 0, { type: "visit" });
  }
  // generic effects: every chosen option can add plan items and stop/hold medicines by tag
  const def = WIZARDS[wizardId];
  // content wizards: a visible dose question changes the medicine tagged with its medTag
  if (!LEGACY.has(wizardId))
    for (const q of def?.steps.flatMap((st) => visibleQuestions(st, answers)) ?? [])
      if (q.type === "dose" && q.medTag) change(q.medTag, q.id, q.direction === "lower" ? "decrease" : "increase");
  for (const q of def?.steps.flatMap((st) => st.questions) ?? []) {
    if (!q.options || !visibleQuestions({ id: "", title: "", questions: [q] }, answers).length) continue;
    const v = answers[q.id];
    const chosen = Array.isArray(v) ? v : v != null ? [String(v)] : [];
    for (const o of q.options.filter((o) => chosen.includes(o.value) && o.effects)) {
      for (const p of o.effects!.plan ?? []) if (!out.some((x) => x.kind === "plan" && x.title === p.title)) plan(p.category, p.title, p.days, p.completesOn);
      for (const [tags, event] of [[o.effects!.stop, "stop"], [o.effects!.hold, "hold"]] as const)
        for (const m of ctx.meds.filter((m) => tags?.some((t) => m.tags.includes(t))))
          if (!out.some((x) => x.kind === "medication" && x.medicationId === m.id)) out.push({ kind: "medication", medicationId: m.id, event, doseValue: null, label: `${m.name}: ${event}` });
    }
  }
  const recheck = Number(answers.recheck);
  if (Number.isFinite(recheck) && answers.recheck != null) {
    const r = def?.recheck ?? { title: "Renal function and potassium check", codes: ["potassium", "creatinine"] };
    out.push({
      kind: "plan",
      category: "monitoring",
      title: r.title,
      dueDate: addDays(today, recheck),
      completesOn: { type: "lab", codes: r.codes },
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
  // pathways that compute their own items (dates from the index event, linked medicines)
  const extra = WIZARDS[wizardId]?.outcome?.(answers, ctx) ?? [];
  return [...extra.filter((i) => i.kind === "start"), ...out, ...extra.filter((i) => i.kind !== "start")].map((item) =>
    item.kind === "plan" ? { ...item, label: `${item.title} · ${fmtDay(item.dueDate, { weekday: true, year: true })}` } : item,
  );
}
