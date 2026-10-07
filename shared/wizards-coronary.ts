// Coronary pathways (coronary module, 4 Oct 2026). Content only; the one wizard engine renders them.
//
// Antithrombotic plan after ACS / PCI — dates are counted from the PCI (or the ACS when there was
// no PCI) and each stop is a dated plan item linked to the medicine, so the Coronary panel shows it.
// Sources:
//  - 2023 ESC ACS: aspirin + P2Y12 inhibitor for 12 months by default (I A); in event-free patients
//    single antiplatelet (preferably a P2Y12 inhibitor) after 3–6 months (IIa A); in high bleeding risk, single antiplatelet after
//    1 month of DAPT (IIb A); de-escalation not in the first 30 days. With an oral anticoagulant:
//    triple therapy up to 1 week (I A), up to 1 month if high ischaemic risk; then anticoagulant +
//    one antiplatelet (clopidogrel) to 12 months (I A), then anticoagulant alone; ticagrelor or
//    prasugrel not recommended as part of triple therapy; PPI with combined antithrombotic therapy
//    at increased GI-bleeding risk (I A).
//  - 2024 ESC CCS: after PCI, 6 months of aspirin + clopidogrel; 1–3 months if high bleeding risk
//    and not high ischaemic risk (I A); then clopidogrel or aspirin monotherapy (I A); with an
//    anticoagulant, triple therapy up to 1 week, then anticoagulant + clopidogrel to 6 months.
//  - 2023 ESC ACS: parenteral anticoagulation for all patients at the time of diagnosis (I A) — agent
//    and dose per local protocol (recurrent chest pain pathway).
//  - ARC-HBR (Urban 2019): high bleeding risk = ≥1 major or ≥2 minor criteria.
// CardioFlow never gives loading doses; clopidogrel 75 mg daily is the maintenance dose.
import { addDays, fmtDay, localDay } from "./clinical.js";
import type { Answers, Assessment, OutcomeItem, WizardContext, WizardDef } from "./wizards.js";

const REVIEW = [
  { value: "none", label: "No extra visit" },
  { value: "clinic-14", label: "Clinic · 2 weeks" },
  { value: "clinic-28", label: "Clinic · 4 weeks" },
];

export const HBR_MAJOR = ["oac-long", "egfr30", "hb11", "plt100", "liver", "cancer", "ich", "bleed", "surgery"];
export const HBR_MINOR = ["age75", "egfr59", "hb-minor", "nsaid", "stroke"];
export const isHbr = (a: Answers) => {
  const l = ((a.hbr as string[]) ?? []);
  return l.some((v) => HBR_MAJOR.includes(v)) || l.filter((v) => HBR_MINOR.includes(v)).length >= 2;
};
export const highIschaemic = (a: Answers) => ((a.ischaemic as string[]) ?? []).filter((v) => v !== "none").length > 0;

// ACS discharge bundle (coronary module, slice 3) — secondary prevention before discharge or at the
// first visit after an ACS. Sources:
//  - 2023 ESC ACS, long-term management: comprehensive cardiac rehabilitation for all ACS patients
//    (I A); stop smoking; high-intensity statin as early as possible, LDL-C <1.4 mmol/L and ≥50%
//    reduction (I A); lipids re-evaluated 4–6 weeks after ACS, ezetimibe if not at goal (I B);
//    statin + ezetimibe during the index admission may be considered (IIb B); beta-blocker if LVEF
//    ≤40% (I A); ACE inhibitor with HF symptoms, LVEF ≤40%, diabetes, hypertension or CKD (I A); MRA
//    with LVEF ≤40% and HF or diabetes (I A); low-dose colchicine may be considered (IIb A); influenza
//    vaccination; echocardiography during the admission to assess LV function; glycaemic status
//    assessed in every ACS patient; complete revascularisation in STEMI during the index PCI or within
//    45 days (I A).
//  - 2022 ESC ventricular arrhythmias: LVEF ≤40% before discharge → re-evaluate LVEF 6–12 weeks after
//    MI for a primary-prevention ICD decision (I C).
// Starting doses are the guideline/trial starting doses already used elsewhere in CardioFlow
// (bisoprolol 1.25 mg, ramipril 2.5 mg twice daily, eplerenone 25 mg, atorvastatin 80 mg high
// intensity, ezetimibe 10 mg, colchicine 0.5 mg). Antithrombotic durations are the separate
// "Antithrombotic plan" pathway.
export const ACS_MEDS: Record<string, { code: string; dose: number; frequency: string; label: string }> = {
  statin: { code: "atorvastatin", dose: 80, frequency: "OD", label: "Atorvastatin 80 mg daily" },
  ezetimibe: { code: "ezetimibe", dose: 10, frequency: "OD", label: "Ezetimibe 10 mg daily" },
  bb: { code: "bisoprolol", dose: 1.25, frequency: "OD", label: "Bisoprolol 1.25 mg daily" },
  acei: { code: "ramipril", dose: 2.5, frequency: "BID", label: "Ramipril 2.5 mg twice daily" },
  mra: { code: "eplerenone", dose: 25, frequency: "OD", label: "Eplerenone 25 mg daily" },
  colchicine: { code: "colchicine", dose: 0.5, frequency: "OD", label: "Colchicine 0.5 mg daily" },
};

// Recurrent chest pain after ACS / PCI (coronary module, slice 4) — a complication episode.
// Sources: 2023 ESC ACS — ECG within 10 minutes (I B); hs-troponin 0 h/1 h or 0 h/2 h algorithm
// (I B); ST elevation with ongoing ischaemia: STEMI pathway, primary PCI (I A); very high-risk
// NSTE-ACS (haemodynamic instability or cardiogenic shock, recurrent or refractory pain, life-
// threatening arrhythmia or cardiac arrest, mechanical complication, acute HF, recurrent dynamic
// ST changes) → immediate invasive strategy <2 h (I C); high-risk NSTE-ACS (confirmed NSTEMI,
// dynamic ST/T changes) → early invasive strategy within 24 h should be considered (IIa A).
// 2024 ESC CCS — short-acting nitrates for immediate relief of angina (I B); beta-blocker and/or
// calcium-channel blocker first line for symptom control (I B); functional or anatomical testing.
// ARC-2 stent thrombosis timing: acute ≤24 h, subacute >24 h–30 days, late 31 days–1 year, very
// late >1 year after the PCI. No troponin cut-offs here: the 99th centile is assay-specific.
const ST_TIMING = (days: number) => (days <= 1 ? "acute (≤24 h)" : days <= 30 ? "subacute (≤30 days)" : days <= 365 ? "late (31 days–1 year)" : "very late (>1 year)");
const CP_UNSTABLE = ["shock", "arrhythmia", "ahf", "mechanical", "refractory"];

export const CORONARY_WIZARDS: Record<string, WizardDef> = {
  "chest-pain-cad": {
    id: "chest-pain-cad", title: "Recurrent chest pain after ACS / PCI", tone: "orange", group: "Coronary",
    source: "ESC ACS 2023 · ESC CCS 2024 · ARC-2",
    note: "Is this a new ACS (and, after a stent, stent thrombosis), or stable angina? The ECG, troponin and instability decide the speed of the invasive strategy. Premature interruption of antiplatelet therapy is the strongest trigger of stent thrombosis.",
    facts: ["hs-troponin", "haemoglobin", "sbp", "hr", "egfr"], trend: "hs-troponin",
    steps: [
      {
        id: "presentation", title: "Presentation",
        questions: [
          {
            id: "pattern", label: "Pain pattern", type: "single", required: true,
            options: [
              { value: "ongoing", label: "Ongoing pain now", hint: "At rest, not settling" },
              { value: "rest", label: "Rest pain, now settled" },
              { value: "exertional", label: "Exertional, stable pattern", hint: "Angina returning after the PCI" },
              { value: "atypical", label: "Atypical / possibly non-cardiac" },
            ],
          },
          {
            id: "ecg", label: "ECG", type: "single", required: true,
            options: [
              { value: "ste", label: "ST elevation / new LBBB" }, { value: "dynamic", label: "Dynamic ST depression / T-wave changes" },
              { value: "normal", label: "No ischaemic change" }, { value: "not-done", label: "Not done yet", hint: "ECG within 10 minutes (I B)" },
            ],
          },
          {
            id: "troponin", label: "hs-troponin", type: "single", required: true,
            options: [
              { value: "rising", label: "Rise and/or fall above the 99th centile" }, { value: "normal", label: "Normal / not changing" },
              { value: "pending", label: "Pending / not done", hint: "0 h/1 h or 0 h/2 h algorithm (I B)" },
            ],
          },
          {
            id: "instability", label: "Very high-risk features", type: "multi", required: true,
            options: [
              { value: "none", label: "None" },
              { value: "shock", label: "Haemodynamic instability / cardiogenic shock" },
              { value: "arrhythmia", label: "Life-threatening arrhythmia / cardiac arrest" },
              { value: "ahf", label: "Acute heart failure" },
              { value: "mechanical", label: "Mechanical complication" },
              { value: "refractory", label: "Recurrent or refractory pain despite treatment" },
            ],
          },
        ],
      },
      {
        id: "stent", title: "Antiplatelet therapy",
        questions: [
          {
            id: "adherence", label: "Antiplatelet therapy since the PCI / ACS", type: "single", required: true,
            options: [
              { value: "taking", label: "Taken as prescribed" },
              { value: "missed", label: "Missed doses" },
              { value: "stopped", label: "Stopped or interrupted", hint: "Bleeding, surgery, cost, misunderstanding" },
              { value: "none", label: "None prescribed" },
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
              { value: "cath-now", label: "Immediate coronary angiography (STEMI pathway / very high risk)", effects: { plan: [{ category: "procedure", title: "Immediate coronary angiography (primary PCI pathway)", days: 0, completesOn: { type: "manual" } }] } },
              { value: "invasive-24", label: "Invasive angiography within 24 h", effects: { plan: [{ category: "procedure", title: "Invasive coronary angiography within 24 h", days: 0, completesOn: { type: "manual" } }] } },
              { value: "admit", label: "Admit with ECG monitoring", hint: "Possible or confirmed ACS", effects: { plan: [{ category: "follow_up", title: "Admission with ECG monitoring (possible ACS)", days: 0, completesOn: { type: "visit" } }] } },
              { value: "anticoag", label: "Parenteral anticoagulation (agent and dose per local protocol)", hint: "At the diagnosis of ACS (ESC ACS 2023, I A)", effects: { plan: [{ category: "medication", title: "Parenteral anticoagulation at ACS diagnosis (agent and dose per local protocol)", days: 0, completesOn: { type: "manual" } }] } },
              { value: "serial-trop", label: "Serial hs-troponin (0 h/1 h or 0 h/2 h)", effects: { plan: [{ category: "monitoring", title: "Serial hs-troponin", days: 0, completesOn: { type: "lab", codes: ["hs-troponin"] } }] } },
              { value: "ecg", label: "12-lead ECG (repeat)", effects: { plan: [{ category: "investigation", title: "12-lead ECG", days: 0, completesOn: { type: "study", kind: "ecg" } }] } },
              { value: "restart-ap", label: "Restart / continue antiplatelet therapy", effects: { plan: [{ category: "medication", title: "Restart antiplatelet therapy (interrupted after PCI / ACS)", days: 0, completesOn: { type: "manual" } }] } },
              { value: "sl-nitrate", label: "Sublingual nitrate for relief", unless: ["nitrate"], effects: { plan: [{ category: "medication", title: "Prescribe sublingual GTN for angina relief", days: 0, completesOn: { type: "manual" } }] } },
              { value: "antianginal", label: "Optimise anti-anginal therapy", effects: { plan: [{ category: "medication", title: "Optimise anti-anginal therapy (beta-blocker / calcium-channel blocker, then long-acting nitrate)", days: 0, completesOn: { type: "manual" } }] } },
              { value: "functional", label: "Ischaemia testing / imaging", effects: { plan: [{ category: "investigation", title: "Ischaemia testing or coronary imaging (recurrent angina after PCI)", days: 14, completesOn: { type: "manual" } }] } },
              { value: "non-cardiac", label: "Look for a non-cardiac cause", effects: { plan: [{ category: "follow_up", title: "Assess non-cardiac causes of chest pain", days: 0, completesOn: { type: "manual" } }] } },
            ],
          },
          { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
  "acs-discharge": {
    id: "acs-discharge", title: "ACS discharge bundle", tone: "blue", group: "Coronary", episode: false,
    source: "ESC ACS 2023 · ESC VA 2022",
    note: "Secondary prevention after an acute coronary syndrome, before discharge or at the first visit. Follow-up dates count from the ACS. Antithrombotic durations are set in the Antithrombotic plan pathway.",
    facts: ["lvef", "ldl-c", "hba1c", "egfr", "potassium", "sbp", "hr"],
    steps: [
      {
        id: "event", title: "The event",
        questions: [
          {
            id: "type", label: "Type of ACS", type: "single", required: true,
            options: [{ value: "stemi", label: "STEMI" }, { value: "nstemi", label: "NSTEMI" }, { value: "ua", label: "Unstable angina" }],
          },
          {
            id: "revasc", label: "Revascularisation", type: "single", required: true,
            options: [
              { value: "complete", label: "Complete", hint: "All significant lesions treated" },
              { value: "staged", label: "Staged PCI still to do", hint: "STEMI: complete within 45 days (ESC ACS 2023, I A)" },
              { value: "cabg", label: "CABG planned" },
              { value: "medical", label: "Medical therapy only" },
            ],
          },
          {
            id: "lvef", label: "LVEF on this admission", type: "single", required: true,
            options: [
              { value: "le40", label: "≤40%" }, { value: "41-49", label: "41–49%" }, { value: "ge50", label: "≥50%" },
              { value: "not-measured", label: "Not measured yet", hint: "Echo during the admission is recommended" },
            ],
          },
        ],
      },
      {
        id: "meds", title: "Secondary-prevention medicines",
        questions: [
          {
            id: "start", label: "Start now", type: "multi", required: true,
            options: [
              { value: "none", label: "Nothing to start" },
              { value: "statin", label: "High-intensity statin: atorvastatin 80 mg", unless: ["statin"] },
              { value: "intensify", label: "Increase the statin to high intensity", requires: ["statin"] },
              { value: "ezetimibe", label: "Ezetimibe 10 mg", unless: ["ezetimibe"] },
              { value: "bb", label: "Beta-blocker: bisoprolol 1.25 mg", unless: ["bb"] },
              { value: "acei", label: "ACE inhibitor: ramipril 2.5 mg twice daily", unless: ["raas"] },
              { value: "mra", label: "MRA: eplerenone 25 mg", unless: ["mra"] },
              { value: "colchicine", label: "Colchicine 0.5 mg daily", unless: ["colchicine"] },
            ],
          },
        ],
      },
      {
        id: "prevention", title: "Rehabilitation and prevention",
        questions: [
          {
            id: "prevent", label: "Arrange", type: "multi", required: true,
            options: [
              { value: "none", label: "Nothing more" },
              { value: "rehab", label: "Cardiac rehabilitation referral", hint: "Not added again if a referral is already planned" },
              { value: "smoking", label: "Smoking cessation support" },
              { value: "flu", label: "Influenza vaccination" },
              { value: "hba1c", label: "HbA1c (glycaemic status)" },
            ],
          },
        ],
      },
      {
        id: "follow", title: "Follow-up",
        questions: [
          {
            id: "followup", label: "Dated follow-up", type: "multi", required: true,
            options: [
              { value: "none", label: "None" },
              { value: "lipids", label: "Lipid profile 4–6 weeks after the ACS", hint: "Not added again if one is already planned" },
              { value: "echo", label: "Repeat echo 6–12 weeks after the MI", hint: "LVEF ≤40%: primary-prevention ICD decision (ESC VA 2022, I C)" },
              { value: "staged", label: "Staged PCI within 45 days" },
            ],
          },
          { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
  antithrombotic: {
    id: "antithrombotic", title: "Antithrombotic plan after ACS / PCI", tone: "blue", group: "Coronary", episode: false,
    source: "ESC ACS 2023 · ESC CCS 2024 · ARC-HBR",
    note: "Durations count from the PCI (or the ACS when there was no PCI). Each stop becomes a dated plan item linked to the medicine and shows on the Coronary panel. Loading doses are never given here.",
    facts: ["haemoglobin", "platelets", "egfr", "creatinine"],
    steps: [
      {
        id: "index", title: "Index event",
        questions: [
          {
            id: "setting", label: "Clinical setting", type: "single", required: true,
            options: [
              { value: "acs", label: "Acute coronary syndrome", hint: "DAPT clock: 12 months by default" },
              { value: "ccs", label: "Chronic coronary syndrome / elective PCI", hint: "DAPT clock: 6 months by default" },
            ],
          },
          {
            id: "from", label: "Count the durations from", type: "single", required: true,
            options: [
              { value: "recorded", label: "The recorded PCI / ACS", hint: "Date from the record" },
              { value: "today", label: "Today: a new ACS or PCI not yet recorded" },
            ],
          },
          {
            id: "oac", label: "Does the patient also need an oral anticoagulant?", type: "single", required: true,
            help: "AF, venous thromboembolism, mechanical valve, LV thrombus.",
            options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes" }],
          },
        ],
      },
      {
        id: "risk", title: "Bleeding and ischaemic risk",
        questions: [
          {
            id: "hbr", label: "ARC-HBR criteria (high bleeding risk = 1 major or 2 minor)", type: "multi", required: true,
            options: [
              { value: "none", label: "None" },
              { value: "oac-long", label: "Major · long-term oral anticoagulation" },
              { value: "egfr30", label: "Major · eGFR <30" },
              { value: "hb11", label: "Major · haemoglobin <11 g/dL" },
              { value: "plt100", label: "Major · platelets <100" },
              { value: "liver", label: "Major · cirrhosis with portal hypertension" },
              { value: "cancer", label: "Major · active cancer (past 12 months)" },
              { value: "ich", label: "Major · previous intracranial haemorrhage" },
              { value: "bleed", label: "Major · bleeding needing admission or transfusion in 6 months" },
              { value: "surgery", label: "Major · non-deferrable major surgery on DAPT" },
              { value: "age75", label: "Minor · age ≥75" },
              { value: "egfr59", label: "Minor · eGFR 30–59" },
              { value: "hb-minor", label: "Minor · haemoglobin 11–12.9 (men) / 11–11.9 (women)" },
              { value: "nsaid", label: "Minor · long-term NSAID or steroid" },
              { value: "stroke", label: "Minor · previous ischaemic stroke" },
            ],
          },
          {
            id: "ischaemic", label: "High ischaemic risk features", type: "multi", required: true,
            options: [
              { value: "none", label: "None" },
              { value: "complex", label: "Complex PCI" },
              { value: "dm", label: "Diabetes on treatment" },
              { value: "recurrent", label: "Recurrent MI" },
              { value: "multivessel", label: "Multivessel disease" },
              { value: "ckd", label: "CKD (eGFR 15–59)" },
              { value: "st", label: "Previous stent thrombosis on antiplatelet therapy" },
              { value: "pad", label: "Peripheral arterial disease" },
            ],
          },
        ],
      },
      {
        id: "strategy", title: "Strategy",
        questions: [
          {
            id: "dapt", label: "DAPT duration", type: "single", showIf: { question: "oac", includes: "no" },
            options: [
              { value: "12m", label: "12 months (ACS default)", hint: "ESC ACS 2023, I A" },
              { value: "3-6m", label: "3–6 months, then single antiplatelet (ACS, event-free)", hint: "ESC ACS 2023, IIa A" },
              { value: "1m-acs", label: "1 month, then single antiplatelet (ACS, high bleeding risk)", hint: "ESC ACS 2023, IIb A" },
              { value: "6m", label: "6 months (elective PCI default)", hint: "ESC CCS 2024" },
              { value: "1-3m", label: "1–3 months (elective PCI, high bleeding risk)", hint: "ESC CCS 2024, I A" },
            ],
          },
          {
            id: "sapt", label: "Single antiplatelet afterwards", type: "single", showIf: { question: "oac", includes: "no" },
            options: [
              { value: "aspirin", label: "Aspirin", hint: "Continue aspirin; stop the P2Y12 inhibitor" },
              { value: "clopidogrel", label: "Clopidogrel", hint: "Continue / switch to clopidogrel; stop aspirin (ESC CCS 2024, I A)" },
              { value: "p2y12", label: "P2Y12 inhibitor monotherapy", requires: ["p2y12"], hint: "Continue the current P2Y12 inhibitor; stop aspirin (ESC ACS 2023: preferably a P2Y12 inhibitor, IIa A)" },
            ],
          },
          {
            id: "tat", label: "Triple therapy (anticoagulant + aspirin + clopidogrel)", type: "single", showIf: { question: "oac", includes: "yes" },
            options: [
              { value: "1w", label: "Up to 1 week, then stop aspirin", hint: "ESC ACS 2023 / CCS 2024, I A" },
              { value: "1m", label: "Up to 1 month (high ischaemic risk)", hint: "ESC ACS 2023" },
            ],
          },
          {
            id: "dual", label: "Anticoagulant + clopidogrel, then anticoagulant alone", type: "single", showIf: { question: "oac", includes: "yes" },
            options: [
              { value: "12m", label: "To 12 months (ACS)", hint: "ESC ACS 2023, I A" },
              { value: "6m", label: "To 6 months (elective PCI, or high bleeding risk)", hint: "ESC CCS 2024 / ACS 2023" },
            ],
          },
        ],
      },
      {
        id: "meds", title: "Medicines now",
        questions: [
          {
            id: "now", label: "Changes now", type: "multi", required: true,
            options: [
              { value: "none", label: "No change now" },
              { value: "to-clopidogrel", label: "Switch ticagrelor / prasugrel to clopidogrel 75 mg daily", requires: ["p2y12-potent"] },
              { value: "ppi", label: "Start pantoprazole 40 mg daily (gastroprotection)", unless: ["ppi"] },
            ],
          },
          { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
        ],
      },
    ],
  },
};

// Dated stops, linked to the medicine they stop.
CORONARY_WIZARDS.antithrombotic.outcome = (a: Answers, ctx: WizardContext): OutcomeItem[] => {
  const out: OutcomeItem[] = [];
  const i0 = a.from === "today" ? ctx.today : localDay(ctx.coronary?.pciAt ?? ctx.coronary?.indexAt ?? ctx.today);
  // a stop date already passed (event entered late) is planned for today
  const due = (days: number) => { const d = addDays(i0, days); return d < ctx.today ? ctx.today : d; };
  const aspirin = ctx.meds.find((m) => m.code === "aspirin");
  const p2y12 = ctx.meds.find((m) => m.tags.includes("p2y12"));
  const switching = ((a.now as string[]) ?? []).includes("to-clopidogrel") && p2y12?.tags.includes("p2y12-potent");
  const plan = (title: string, dueDate: string, link: { id?: string | null; ref?: string }): OutcomeItem =>
    ({ kind: "plan", category: "medication", title, dueDate, completesOn: { type: "manual" }, label: "", medicationId: link.id ?? null, medicationRef: link.ref });
  if (switching && p2y12) {
    out.push({ kind: "medication", medicationId: p2y12.id, event: "stop", doseValue: null, label: `${p2y12.name}: stop (switch to clopidogrel)` });
    out.push({ kind: "start", code: "clopidogrel", doseValue: 75, frequency: "OD", indication: "cad", label: "Clopidogrel 75 mg daily: start" });
  }
  const p2 = switching ? { ref: "code:clopidogrel" } : p2y12 ? { id: p2y12.id } : aspirin ? { id: aspirin.id } : {};
  const p2name = switching ? "clopidogrel" : p2y12?.name.toLowerCase() ?? "the P2Y12 inhibitor";
  if (a.oac === "yes") {
    if (aspirin && a.tat) out.push(plan(`End of triple therapy: stop aspirin (${a.tat === "1w" ? "up to 1 week" : "up to 1 month, high ischaemic risk"})`, due(a.tat === "1w" ? 7 : 30), { id: aspirin.id }));
    if (a.dual) out.push(plan(`Stop ${p2name}: anticoagulant alone after ${a.dual === "12m" ? "12" : "6"} months`, due(a.dual === "12m" ? 365 : 182), p2));
  } else if (a.dapt) {
    const days = { "12m": 365, "3-6m": 90, "1m-acs": 30, "6m": 182, "1-3m": 30 }[String(a.dapt)] ?? 365;
    const what = { "12m": "End of 12-month DAPT", "3-6m": "DAPT 3–6 months: if event-free", "1m-acs": "High bleeding risk: after 1 month of DAPT", "6m": "End of 6-month DAPT", "1-3m": "High bleeding risk: DAPT 1–3 months" }[String(a.dapt)];
    if (a.sapt === "p2y12" && aspirin) out.push(plan(`${what}: stop aspirin, continue ${p2name} alone`, due(days), { id: aspirin.id }));
    else if (a.sapt === "clopidogrel" && aspirin) out.push(plan(`${what}: stop aspirin, continue clopidogrel${p2y12 && !p2y12.code.includes("clopidogrel") && !switching ? " (switch from " + p2y12.name.toLowerCase() + ")" : ""}`, due(days), { id: aspirin.id }));
    else out.push(plan(`${what}: stop ${p2name}, continue aspirin`, due(days), p2));
  }
  if (((a.now as string[]) ?? []).includes("ppi") && !ctx.meds.some((m) => m.tags.includes("ppi")))
    out.push({ kind: "start", code: "pantoprazole", doseValue: 40, frequency: "OD", indication: "GI protection on antithrombotic therapy", label: "Pantoprazole 40 mg daily: start" });
  return out;
};

// ACS discharge bundle: medicines started at their starting dose, dated follow-up from the ACS.
CORONARY_WIZARDS["acs-discharge"].outcome = (a: Answers, ctx: WizardContext): OutcomeItem[] => {
  const out: OutcomeItem[] = [];
  const i0 = localDay(ctx.coronary?.acsAt ?? ctx.today);
  const due = (days: number) => { const d = addDays(i0, days); return d < ctx.today ? ctx.today : d; };
  const pick = (id: string) => ((a[id] as string[]) ?? []).filter((v) => v !== "none");
  const plan = (category: string, title: string, dueDate: string, completesOn: Record<string, unknown> = { type: "manual" }, medicationId: string | null = null): OutcomeItem =>
    ({ kind: "plan", category, title, dueDate, completesOn, label: "", medicationId });
  for (const v of pick("start")) {
    const m = ACS_MEDS[v];
    if (m && !ctx.meds.some((x) => x.code === m.code)) out.push({ kind: "start", code: m.code, doseValue: m.dose, frequency: m.frequency, indication: "cad", label: `${m.label}: start` });
    if (v === "intensify") {
      const st = ctx.meds.find((x) => x.tags.includes("statin"));
      if (st) out.push(plan("medication", `Increase ${st.name.toLowerCase()} to high intensity (atorvastatin 40–80 mg / rosuvastatin 20–40 mg)`, ctx.today, { type: "manual" }, st.id));
    }
  }
  const prevent = pick("prevent");
  const has = (re: RegExp) => (ctx.planned ?? []).some((t) => re.test(t));
  if (a.lvef === "not-measured" && !has(/echo/i)) out.push(plan("investigation", "Echo: LV function after ACS", ctx.today, { type: "study", kind: "echo" }));
  if (prevent.includes("rehab") && !has(/rehabilitation/i)) out.push(plan("referral", "Cardiac rehabilitation referral", addDays(ctx.today, 7)));
  if (prevent.includes("smoking")) out.push(plan("education", "Smoking cessation support", ctx.today));
  if (prevent.includes("flu")) out.push(plan("medication", "Influenza vaccination", ctx.today));
  if (prevent.includes("hba1c")) out.push(plan("monitoring", "HbA1c (glycaemic status after ACS)", ctx.today, { type: "lab", codes: ["hba1c"] }));
  const follow = pick("followup");
  if (follow.includes("lipids") && !has(/lipid/i)) out.push(plan("monitoring", "Lipid profile 4–6 weeks after ACS", due(42), { type: "lab", codes: ["ldl-c"] }));
  if (follow.includes("echo") && !has(/echo/i)) out.push(plan("investigation", "Repeat echo 6–12 weeks after MI (LVEF for ICD decision)", due(84), { type: "study", kind: "echo" }));
  if (follow.includes("staged")) out.push(plan("follow_up", "Staged PCI (complete revascularisation within 45 days)", due(45)));
  return out;
};

// Closing summary: what is in place and what the guideline still asks for.
CORONARY_WIZARDS["acs-discharge"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const on = (...tags: string[]) => ctx.meds.some((m) => m.tags.some((t) => tags.includes(t)));
  const start = ((a.start as string[]) ?? []);
  const prevent = ((a.prevent as string[]) ?? []);
  const follow = ((a.followup as string[]) ?? []);
  const dx = (...d: string[]) => (ctx.dx ?? []).some((x) => d.includes(x));
  const ldl = ctx.values?.["ldl-c"]?.value ?? null;
  const lowEf = a.lvef === "le40";
  const statin = on("statin") || start.includes("statin");
  const rehab = prevent.includes("rehab") || (ctx.planned ?? []).some((t) => /rehabilitation/i.test(t));
  const rows: Assessment["rows"] = [
    { label: "Event", value: `${{ stemi: "STEMI", nstemi: "NSTEMI", ua: "Unstable angina" }[String(a.type)] ?? "ACS"}${ctx.coronary?.acsAt ? ` · ${ctx.coronary.acsAt}` : ""}` },
    { label: "Revascularisation", value: { complete: "Complete", staged: "Staged PCI to do", cabg: "CABG planned", medical: "Medical therapy" }[String(a.revasc)] ?? "Not given", tone: a.revasc === "staged" && !follow.includes("staged") ? "orange" : undefined },
    { label: "LVEF", value: { le40: "≤40%", "41-49": "41–49%", ge50: "≥50%", "not-measured": "Not measured" }[String(a.lvef)] ?? "Not given", tone: lowEf || a.lvef === "not-measured" ? "orange" : "green" },
    { label: "LDL-C", value: ldl != null ? `${ldl} mmol/L · goal <1.4` : "Not measured", tone: ldl == null || ldl >= 1.4 ? "orange" : "green" },
  ];
  const rec: string[] = [];
  const gap = (cond: boolean, text: string) => { if (cond) rec.push(text); };
  gap(!statin, "High-intensity statin as early as possible (I A).");
  gap(!rehab, "Cardiac rehabilitation for every ACS patient (I A).");
  gap(lowEf && !on("bb") && !start.includes("bb"), "LVEF ≤40%: beta-blocker (I A).");
  gap((lowEf || dx("hf", "dm", "htn", "ckd")) && !on("raas") && !start.includes("acei"), "ACE inhibitor: HF symptoms, LVEF ≤40%, diabetes, hypertension or CKD (I A).");
  gap(lowEf && dx("hf", "dm") && !on("mra") && !start.includes("mra"), "LVEF ≤40% with HF or diabetes: MRA (I A).");
  gap(a.lvef === "not-measured", "LVEF not measured since the ACS: echo to assess LV function (planned today).");
  gap(lowEf && !follow.includes("echo"), "LVEF ≤40%: re-evaluate LVEF 6–12 weeks after the MI for the ICD decision (ESC VA 2022, I C).");
  gap(!follow.includes("lipids") && !(ctx.planned ?? []).some((t) => /lipid/i.test(t)), "Lipid profile 4–6 weeks after the ACS; add ezetimibe if LDL-C is not at goal (I B).");
  gap(a.revasc === "staged" && a.type === "stemi" && !follow.includes("staged"), "STEMI with multivessel disease: complete revascularisation within 45 days (I A).");
  gap(dx("smoker") && !prevent.includes("smoking"), "Current smoker: smoking cessation support.");
  gap(!prevent.includes("flu"), "Influenza vaccination.");
  if (!ctx.meds.some((m) => m.tags.includes("p2y12")) && !on("oac")) rec.push("No P2Y12 inhibitor recorded: DAPT for 12 months by default after ACS (I A).");
  rec.push("Antithrombotic durations and stop dates: Antithrombotic plan pathway.");
  if (rec.length === 1) rec.unshift("All guideline bundle items are in place.");
  return { heading: "Secondary prevention after ACS", rows, recommendations: rec };
};

// Recurrent chest pain: risk group, stent-thrombosis timing, and what the guideline says to do.
export function chestPainRisk(a: Answers): "stemi" | "very-high" | "high" | "possible" | "stable" | "atypical" {
  const unstable = ((a.instability as string[]) ?? []).some((v) => CP_UNSTABLE.includes(v));
  if (a.ecg === "ste") return "stemi";
  if (unstable) return "very-high";
  if (a.troponin === "rising" || a.ecg === "dynamic") return "high";
  if (a.pattern === "ongoing" || a.pattern === "rest" || a.troponin === "pending" || a.ecg === "not-done") return "possible";
  return a.pattern === "atypical" ? "atypical" : "stable";
}
CORONARY_WIZARDS["chest-pain-cad"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const risk = chestPainRisk(a);
  const pciDays = ctx.coronary?.pciAt ? Math.max(0, Math.round((Date.parse(ctx.today) - Date.parse(localDay(ctx.coronary.pciAt))) / 86400000)) : null;
  const label = { stemi: "STEMI", "very-high": "Very high-risk NSTE-ACS", high: "High-risk NSTE-ACS", possible: "Possible ACS: not yet ruled out", stable: "Stable angina pattern", atypical: "Atypical: ACS not suggested" }[risk];
  const rows: Assessment["rows"] = [
    { label: "Risk group", value: label, tone: risk === "stable" || risk === "atypical" ? "green" : "orange" },
  ];
  if (pciDays != null) rows.push({ label: "Since the last PCI", value: `${pciDays} day${pciDays === 1 ? "" : "s"} · stent thrombosis would be ${ST_TIMING(pciDays)}` });
  rows.push({ label: "Antiplatelet therapy", value: { taking: "Taken as prescribed", missed: "Missed doses", stopped: "Stopped or interrupted", none: "None prescribed" }[String(a.adherence)] ?? "Not given", tone: a.adherence === "taking" ? "green" : "orange" });
  const rec: string[] = [];
  if (risk === "stemi") rec.push("ST elevation with ongoing ischaemia: STEMI pathway, immediate primary PCI (I A)." + (pciDays != null ? " Stent thrombosis is likely in a recently stented territory." : ""));
  if (risk === "very-high") rec.push("Very high-risk features: immediate invasive strategy (<2 h) (I C).");
  if (risk === "high") rec.push("Troponin rise/fall or dynamic ST/T changes: NSTE-ACS; early invasive strategy within 24 h should be considered (IIa A)." + (pciDays != null && pciDays <= 365 ? " Consider stent thrombosis or early restenosis of the treated vessel." : ""));
  const acts = ((a.actions as string[]) ?? []);
  if ((risk === "stemi" || risk === "very-high" || risk === "high") && !acts.includes("anticoag") && !ctx.meds.some((m) => m.tags.includes("oac")))
    rec.push("Parenteral anticoagulation for all patients at the diagnosis of ACS (I A); agent and dose per local protocol.");
  if ((risk === "high" || risk === "possible") && !acts.includes("admit") && !acts.includes("cath-now")) rec.push("ACS not yet excluded: admission with ECG rhythm monitoring.");
  if (a.ecg === "not-done") rec.push("12-lead ECG within 10 minutes of first contact (I B).");
  if (a.troponin === "pending") rec.push("hs-troponin with the 0 h/1 h (or 0 h/2 h) algorithm (I B).");
  if (a.adherence === "stopped" || a.adherence === "missed") rec.push("Interrupted antiplatelet therapy is the strongest trigger of stent thrombosis: restart unless active bleeding forbids it.");
  if (risk === "stable") rec.push("Stable angina after PCI: sublingual nitrate for relief (I B); beta-blocker and/or calcium-channel blocker first line (I B); test for ischaemia or restenosis.");
  if (risk === "atypical") rec.push("Look for non-cardiac causes; keep secondary prevention unchanged.");
  return { heading: "Chest pain after ACS / PCI: risk and recommendations", rows, recommendations: rec };
};

// Closing summary: bleeding and ischaemic risk, and the regimen with its dates.
CORONARY_WIZARDS.antithrombotic.assess = (a: Answers, ctx: WizardContext): Assessment => {
  const hbr = isHbr(a);
  const isch = highIschaemic(a);
  const l = (a.hbr as string[]) ?? [];
  const major = l.filter((v) => HBR_MAJOR.includes(v)).length, minor = l.filter((v) => HBR_MINOR.includes(v)).length;
  const i0 = a.from === "today" ? ctx.today : localDay(ctx.coronary?.pciAt ?? ctx.coronary?.indexAt ?? ctx.today);
  const stops = CORONARY_WIZARDS.antithrombotic.outcome!(a, ctx).filter((o) => o.kind === "plan");
  const rows: Assessment["rows"] = [
    { label: "Counted from", value: `${a.from === "today" ? "today (new event)" : ctx.coronary?.pciAt ? "PCI" : ctx.coronary ? ctx.coronary.indexTitle : "today"} · ${fmtDay(i0, { year: true })}` },
    { label: "Bleeding risk (ARC-HBR)", value: hbr ? `High · ${major} major, ${minor} minor` : `Not high · ${major} major, ${minor} minor`, tone: hbr ? "orange" : "green" },
    { label: "Ischaemic risk", value: isch ? "High" : "Not high", tone: isch ? "orange" : undefined },
    ...stops.map((o) => ({ label: o.kind === "plan" ? fmtDay(o.dueDate, { year: true }) : "", value: o.kind === "plan" ? o.title : "" })),
  ];
  const rec: string[] = [];
  const potent = ctx.meds.some((m) => m.tags.includes("p2y12-potent"));
  const now = (a.now as string[]) ?? [];
  if (a.oac === "yes" && potent && !now.includes("to-clopidogrel")) rec.push("With an anticoagulant, clopidogrel is the P2Y12 inhibitor: ticagrelor or prasugrel are not recommended as part of triple therapy (ESC ACS 2023).");
  if (a.oac === "no" && hbr && (a.dapt === "12m" || a.dapt === "6m")) rec.push(a.setting === "acs" ? "High bleeding risk: single antiplatelet after 1 month of DAPT may be considered (ESC ACS 2023, IIb A)." : "High bleeding risk without high ischaemic risk: DAPT 1–3 months (ESC CCS 2024, I A).");
  if (a.setting === "acs" && a.oac === "no") rec.push("Do not de-escalate antiplatelet therapy in the first 30 days after ACS.");
  const combined = ctx.meds.filter((m) => m.tags.some((t) => t === "antiplatelet" || t === "oac")).length >= 2 || a.oac === "yes";
  if (combined && !ctx.meds.some((m) => m.tags.includes("ppi")) && !now.includes("ppi")) rec.push("Combined antithrombotic therapy at increased GI-bleeding risk: proton-pump inhibitor (ESC ACS 2023, I A).");
  if (a.oac === "yes") rec.push("After the antiplatelet stops, the anticoagulant continues alone (ESC ACS 2023 / CCS 2024).");
  return { heading: "Antithrombotic plan", rows, recommendations: rec };
};

// After CABG (audit finish, 6 Oct): the next steps once a CABG is recorded, like the after-PCI sheet.
// Sources: 2024 ESC CCS — aspirin 75–100 mg daily after CABG; high-intensity statin; cardiac rehabilitation
// (I A). 2023 ESC ACS — CABG during an ACS: the P2Y12 inhibitor is resumed after surgery to complete 12
// months of DAPT; rehabilitation (I A); LDL-C goal <1.4 mmol/L, lipids at 4–6 weeks. 2024 ESC AF —
// post-operative AF after cardiac surgery: long-term oral anticoagulation should be considered (IIa B),
// by CHA₂DS₂-VA. CardioFlow does not dose after-surgery drugs beyond the catalogue maintenance doses.
CORONARY_WIZARDS["after-cabg"] = {
  id: "after-cabg", title: "After CABG: next steps", tone: "blue", group: "Coronary", episode: false,
  source: "ESC CCS 2024 · ESC ACS 2023 · ESC AF 2024",
  note: "Secondary prevention and follow-up after coronary bypass surgery, counted from the operation. Surgical wound and sternal care follow the surgical team.",
  facts: ["lvef", "ldl-c", "haemoglobin", "egfr", "hr"],
  steps: [
    {
      id: "setting", title: "The operation",
      questions: [
        { id: "setting", label: "Setting", type: "single", required: true, options: [{ value: "acs", label: "During an acute coronary syndrome" }, { value: "ccs", label: "Chronic coronary syndrome (elective)" }] },
        { id: "poaf", label: "Post-operative atrial fibrillation", type: "single", required: true, options: [{ value: "no", label: "No" }, { value: "yes", label: "Yes", hint: "Long-term anticoagulation should be considered (ESC AF 2024, IIa B)" }] },
      ],
    },
    {
      id: "meds", title: "Medicines",
      questions: [
        {
          id: "meds", label: "Start or plan", type: "multi", required: true,
          options: [
            { value: "none", label: "Nothing to change" },
            { value: "aspirin", label: "Aspirin 100 mg daily, long term", unless: ["aspirin"], hint: "After CABG (ESC CCS 2024)" },
            { value: "statin", label: "High-intensity statin: atorvastatin 80 mg", unless: ["statin"] },
            { value: "intensify", label: "Increase the statin to high intensity", requires: ["statin"] },
            { value: "p2y12", label: "Resume the P2Y12 inhibitor to complete 12 months of DAPT", hint: "CABG during an ACS (ESC ACS 2023)" },
            { value: "oac", label: "Decide long-term anticoagulation (post-operative AF)", hint: "By CHA₂DS₂-VA (ESC AF 2024, IIa B)" },
          ],
        },
      ],
    },
    {
      id: "follow", title: "Follow-up",
      questions: [
        {
          id: "followup", label: "Arrange", type: "multi", required: true,
          options: [
            { value: "none", label: "Nothing more" },
            { value: "rehab", label: "Cardiac rehabilitation referral", hint: "I A" },
            { value: "lipids", label: "Lipid profile 4–6 weeks after the operation" },
            { value: "echo", label: "Echo: LV function after surgery" },
            { value: "surgical", label: "Surgical follow-up (wound, sternum) as set by the surgical team" },
          ],
        },
        { id: "review", label: "Review", type: "single", options: REVIEW, required: true },
      ],
    },
  ],
};
CORONARY_WIZARDS["after-cabg"].outcome = (a: Answers, ctx: WizardContext): OutcomeItem[] => {
  const out: OutcomeItem[] = [];
  const day = ctx.cabgAt ?? ctx.today;
  const due = (days: number) => { const d = addDays(day, days); return d < ctx.today ? ctx.today : d; };
  const plan = (category: string, title: string, dueDate: string, completesOn: Record<string, unknown> = { type: "manual" }, medicationId: string | null = null): OutcomeItem =>
    ({ kind: "plan", category, title, dueDate, completesOn, label: "", medicationId });
  const has = (re: RegExp) => (ctx.planned ?? []).some((t) => re.test(t));
  const meds = ((a.meds as string[]) ?? []).filter((v) => v !== "none");
  if (meds.includes("aspirin") && !ctx.meds.some((m) => m.code === "aspirin")) out.push({ kind: "start", code: "aspirin", doseValue: 100, frequency: "OD", indication: "cad", label: "Aspirin 100 mg daily: start (long term after CABG)" });
  if (meds.includes("statin") && !ctx.meds.some((m) => m.tags.includes("statin"))) out.push({ kind: "start", code: ACS_MEDS.statin.code, doseValue: ACS_MEDS.statin.dose, frequency: "OD", indication: "cad", label: `${ACS_MEDS.statin.label}: start` });
  if (meds.includes("intensify")) {
    const st = ctx.meds.find((m) => m.tags.includes("statin"));
    if (st) out.push(plan("medication", "Increase the statin to high intensity (atorvastatin 40–80 mg / rosuvastatin 20–40 mg)", ctx.today, { type: "manual" }, st.id));
  }
  if (meds.includes("p2y12")) {
    const p2 = ctx.meds.find((m) => m.tags.includes("p2y12"));
    out.push(plan("medication", p2 ? `Resume ${p2.name.toLowerCase()} after CABG` : "Resume a P2Y12 inhibitor after CABG", ctx.today, { type: "manual" }, p2?.id ?? null));
    const acsAt = ctx.coronary?.acsAt;
    if (acsAt) out.push(plan("medication", "End of 12-month DAPT after the ACS: stop the P2Y12 inhibitor, continue aspirin", addDays(acsAt, 365) < ctx.today ? ctx.today : addDays(acsAt, 365), { type: "manual" }, p2?.id ?? null));
  }
  if (meds.includes("oac")) out.push(plan("medication", "Post-operative AF after CABG: decide long-term anticoagulation by CHA₂DS₂-VA", ctx.today));
  const f = ((a.followup as string[]) ?? []).filter((v) => v !== "none");
  if (f.includes("rehab") && !has(/rehabilitation/i)) out.push(plan("referral", "Cardiac rehabilitation referral", due(7)));
  if (f.includes("lipids") && !has(/lipid/i)) out.push(plan("monitoring", "Lipid profile 4–6 weeks after CABG", due(42), { type: "lab", codes: ["ldl-c"] }));
  if (f.includes("echo") && !has(/echo/i)) out.push(plan("investigation", "Echo: LV function after CABG", ctx.today, { type: "study", kind: "echo" }));
  if (f.includes("surgical")) out.push(plan("follow_up", "Surgical follow-up after CABG (wound, sternum)", due(28), { type: "visit" }));
  return out;
};
CORONARY_WIZARDS["after-cabg"].assess = (a: Answers, ctx: WizardContext): Assessment => {
  const on = (...t: string[]) => ctx.meds.some((m) => m.tags.some((x) => t.includes(x)));
  const meds = (a.meds as string[]) ?? [];
  const f = (a.followup as string[]) ?? [];
  const ldl = ctx.values?.["ldl-c"]?.value ?? null;
  const rows: Assessment["rows"] = [
    { label: "Operation", value: `CABG${ctx.cabgAt ? ` · ${ctx.cabgAt}` : ""} · ${a.setting === "acs" ? "during an ACS" : "elective"}` },
    { label: "Aspirin", value: ctx.meds.some((m) => m.code === "aspirin") ? "On aspirin" : meds.includes("aspirin") ? "To start" : "Not on aspirin", tone: ctx.meds.some((m) => m.code === "aspirin") || meds.includes("aspirin") ? "green" : "orange" },
    { label: "LDL-C", value: ldl != null ? `${ldl} mmol/L · goal <1.4` : "Not measured", tone: ldl == null || ldl >= 1.4 ? "orange" : "green" },
  ];
  if (a.poaf === "yes") rows.push({ label: "Post-operative AF", value: on("oac") ? "On an anticoagulant" : "No anticoagulant", tone: on("oac") ? "green" : "orange" });
  const rec: string[] = [];
  if (!ctx.meds.some((m) => m.code === "aspirin") && !meds.includes("aspirin")) rec.push("Aspirin 75–100 mg daily after CABG (ESC CCS 2024).");
  if (!on("statin") && !meds.includes("statin")) rec.push("High-intensity statin; LDL-C goal <1.4 mmol/L.");
  else if (ldl != null && ldl >= 1.4 && !on("ezetimibe")) rec.push("LDL-C not at goal on a statin: add ezetimibe (ESC ACS 2023, I B).");
  if (a.setting === "acs" && !meds.includes("p2y12")) rec.push("CABG during an ACS: resume the P2Y12 inhibitor after surgery to complete 12 months of DAPT (ESC ACS 2023).");
  if (a.poaf === "yes" && !on("oac") && !meds.includes("oac")) rec.push("Post-operative AF after cardiac surgery: long-term anticoagulation should be considered (ESC AF 2024, IIa B).");
  if (!f.includes("rehab") && !(ctx.planned ?? []).some((t) => /rehabilitation/i.test(t))) rec.push("Cardiac rehabilitation after CABG (I A).");
  if (!rec.length) rec.push("All guideline steps after CABG are in place.");
  return { heading: "After CABG", rows, recommendations: rec };
};
