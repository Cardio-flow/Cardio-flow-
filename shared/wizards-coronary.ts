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
import { addDays } from "./clinical.js";
import type { Answers, OutcomeItem, WizardContext, WizardDef } from "./wizards.js";

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

export const CORONARY_WIZARDS: Record<string, WizardDef> = {
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
  const i0 = (ctx.coronary?.pciAt ?? ctx.coronary?.indexAt ?? ctx.today).slice(0, 10);
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
