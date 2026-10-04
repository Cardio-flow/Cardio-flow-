// Coronary pathways (coronary module, 4 Oct 2026). Content only; the one wizard engine renders them.
//
// Antithrombotic plan after ACS / PCI — dates are counted from the PCI (or the ACS when there was
// no PCI) and each stop is a dated plan item linked to the medicine, so the Coronary panel shows it.
// Sources:
//  - 2023 ESC ACS: aspirin + P2Y12 inhibitor for 12 months by default (I A); in event-free patients
//    single antiplatelet after 3–6 months (IIa A); in high bleeding risk, single antiplatelet after
//    1 month of DAPT (IIb A); de-escalation not in the first 30 days. With an oral anticoagulant:
//    triple therapy up to 1 week (I A), up to 1 month if high ischaemic risk; then anticoagulant +
//    one antiplatelet (clopidogrel) to 12 months (I A), then anticoagulant alone; ticagrelor or
//    prasugrel not recommended as part of triple therapy; PPI with combined antithrombotic therapy
//    at increased GI-bleeding risk (I A).
//  - 2024 ESC CCS: after PCI, 6 months of aspirin + clopidogrel; 1–3 months if high bleeding risk
//    and not high ischaemic risk (I A); then clopidogrel or aspirin monotherapy (I A); with an
//    anticoagulant, triple therapy up to 1 week, then anticoagulant + clopidogrel to 6 months.
//  - ARC-HBR (Urban 2019): high bleeding risk = ≥1 major or ≥2 minor criteria.
// CardioFlow never gives loading doses; clopidogrel 75 mg daily is the maintenance dose.
import { addDays, localDay } from "./clinical.js";
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

export const CORONARY_WIZARDS: Record<string, WizardDef> = {
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
              { value: "colchicine", label: "Colchicine 0.5 mg daily" },
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
  const i0 = localDay(ctx.coronary?.pciAt ?? ctx.coronary?.indexAt ?? ctx.today);
  const due = (days: number) => addDays(i0, days);
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
    if (a.sapt === "clopidogrel" && aspirin) out.push(plan(`${what}: stop aspirin, continue clopidogrel${p2y12 && !p2y12.code.includes("clopidogrel") && !switching ? " (switch from " + p2y12.name.toLowerCase() + ")" : ""}`, due(days), { id: aspirin.id }));
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
