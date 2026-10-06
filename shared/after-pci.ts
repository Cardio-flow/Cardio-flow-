// After PCI (workflow redesign, slice 3): the next steps on one sheet — the antithrombotic plan as a dated
// timeline, plus the secondary-prevention steps the guidelines ask for after PCI. Pure functions: the
// server sends the context, the sheet computes the default plan and its dates, the clinician edits them.
//
// Durations and choices are the antithrombotic pathway's (shared/wizards-coronary.ts), from:
//  - 2023 ESC ACS: aspirin + a P2Y12 inhibitor for 12 months by default (I A); single antiplatelet after
//    3–6 months in event-free patients (IIa A); after 1 month in high bleeding risk (IIb A); prasugrel or
//    ticagrelor in ACS (I B); with an anticoagulant: triple therapy up to 1 week (I A), up to 1 month at
//    high ischaemic risk (e.g. stent thrombosis, complex PCI); then anticoagulant + clopidogrel to 12 months
//    (I A); ticagrelor/prasugrel not recommended in triple therapy; PPI with combined antithrombotic therapy
//    at increased GI-bleeding risk (I A); high-intensity statin (I A); cardiac rehabilitation (I A).
//  - 2024 ESC CCS: after elective PCI aspirin + clopidogrel 6 months; 1–3 months at high bleeding risk (I A);
//    with an anticoagulant, triple therapy up to 1 week then anticoagulant + clopidogrel to 6 months.
//  - ARC-HBR (Urban 2019): high bleeding risk = ≥1 major or ≥2 minor criteria (server/engine/cad-profile.ts).
//  - Maintenance doses only (product labels): aspirin 75–100 mg daily; clopidogrel 75 mg daily; ticagrelor
//    90 mg twice daily; prasugrel 10 mg daily, 5 mg below 60 kg (SmPC Efient 4.2; at ≥75 years generally not
//    recommended, 5 mg if used). CardioFlow never gives loading doses.
import { addDays } from "./clinical.js";

export type PciContext = {
  today: string;
  pci: { id: string; at: string; acs: boolean; summary: string; complex: boolean; complications: string[] };
  age: number; weight: number | null;
  oac: { id: string; name: string } | null;
  aspirin: { id: string; name: string; dose: number | null } | null;
  p2y12: { id: string; name: string; code: string; potent: boolean } | null;
  hbr: { major: string[]; minor: string[]; hbr: boolean };
  statin: { name: string; high: boolean } | null;
  ppi: boolean;
  nsaid: boolean;
  planned: { rehab: boolean; echo: boolean; lipids: boolean; stops: boolean };
  lvefSince: boolean;
  priorStroke: boolean;
};

export type Choice = {
  regimen: "dapt" | "oac";
  p2y12: "ticagrelor" | "prasugrel" | "clopidogrel";
  aspirinDose: number;
  dapt: "12m" | "3-6m" | "1m-acs" | "6m" | "1-3m";
  sapt: "aspirin" | "clopidogrel";
  tat: "1w" | "1m";
  dual: "12m" | "6m";
};

export const DAPT_OPTIONS: { value: Choice["dapt"]; label: string; days: number; acs: boolean; hint: string }[] = [
  { value: "12m", label: "12 months", days: 365, acs: true, hint: "ACS default · ESC ACS 2023, I A" },
  { value: "3-6m", label: "3–6 months, then one antiplatelet", days: 90, acs: true, hint: "ACS, event-free · IIa A" },
  { value: "1m-acs", label: "1 month, then one antiplatelet", days: 30, acs: true, hint: "ACS, high bleeding risk · IIb A" },
  { value: "6m", label: "6 months", days: 182, acs: false, hint: "Elective PCI default · ESC CCS 2024" },
  { value: "1-3m", label: "1–3 months", days: 30, acs: false, hint: "Elective PCI, high bleeding risk · I A" },
];
export const TAT_OPTIONS = [
  { value: "1w" as const, label: "Up to 1 week", days: 7, hint: "ESC ACS 2023 / CCS 2024, I A" },
  { value: "1m" as const, label: "Up to 1 month", days: 30, hint: "High ischaemic risk" },
];
export const DUAL_OPTIONS = [
  { value: "12m" as const, label: "To 12 months", days: 365, hint: "ACS · I A" },
  { value: "6m" as const, label: "To 6 months", days: 182, hint: "Elective PCI or high bleeding risk" },
];

// high ischaemic risk features that the sheet can see in the record
export const highIschaemic = (c: PciContext) => c.pci.complex || c.pci.complications.some((x) => /stent thrombosis|Peri-procedural MI/i.test(x));

export function defaultChoice(c: PciContext): Choice {
  const acs = c.pci.acs, hbr = c.hbr.hbr;
  const current = c.p2y12?.code as Choice["p2y12"] | undefined;
  const p2y12: Choice["p2y12"] = c.oac ? "clopidogrel" : current && ["ticagrelor", "prasugrel", "clopidogrel"].includes(current) ? current : acs ? "ticagrelor" : "clopidogrel";
  return {
    regimen: c.oac ? "oac" : "dapt",
    p2y12,
    aspirinDose: c.aspirin?.dose ?? 100,
    dapt: acs ? (hbr ? "1m-acs" : "12m") : hbr ? "1-3m" : "6m",
    sapt: "aspirin",
    tat: highIschaemic(c) ? "1m" : "1w",
    dual: acs && !hbr ? "12m" : "6m",
  };
}

export const P2Y12: Record<Choice["p2y12"], { name: string; frequency: string; dose: (c: PciContext) => number; note: (c: PciContext) => string | null }> = {
  ticagrelor: { name: "Ticagrelor", frequency: "BID", dose: () => 90, note: () => null },
  prasugrel: {
    name: "Prasugrel", frequency: "OD",
    dose: (c) => (c.age >= 75 || (c.weight != null && c.weight < 60) ? 5 : 10),
    note: (c) => c.priorStroke ? "Contraindicated after stroke or TIA (label)." : c.age >= 75 ? "Age ≥75: generally not recommended; 5 mg if used (label)." : c.weight != null && c.weight < 60 ? "Weight <60 kg: 5 mg (label)." : null,
  },
  clopidogrel: { name: "Clopidogrel", frequency: "OD", dose: () => 75, note: () => null },
};

export type Phase = { key: string; label: string; drugs: string[]; from: string; to: string | null; stop?: { target: "aspirin" | "p2y12"; title: string } };

// the plan as phases with dates; `ends` holds the clinician's own end dates, keyed by phase
export function phases(c: PciContext, ch: Choice, ends: Record<string, string> = {}): Phase[] {
  const at = c.pci.at;
  const p2 = P2Y12[ch.p2y12].name;
  const end = (key: string, days: number) => ends[key] ?? addDays(at, days);
  if (ch.regimen === "oac") {
    const oac = c.oac?.name ?? "Anticoagulant";
    const t = TAT_OPTIONS.find((x) => x.value === ch.tat)!, d = DUAL_OPTIONS.find((x) => x.value === ch.dual)!;
    const t1 = end("triple", t.days), t2 = end("dual", d.days);
    return [
      { key: "triple", label: "Triple therapy", drugs: [oac, "Aspirin", p2], from: at, to: t1, stop: { target: "aspirin", title: `End of triple therapy: stop aspirin (${t.label.toLowerCase()})` } },
      { key: "dual", label: "Anticoagulant + clopidogrel", drugs: [oac, p2], from: t1, to: t2, stop: { target: "p2y12", title: `Stop ${p2.toLowerCase()}: anticoagulant alone after ${ch.dual === "12m" ? "12" : "6"} months` } },
      { key: "after", label: "Anticoagulant alone", drugs: [oac], from: t2, to: null },
    ];
  }
  const o = DAPT_OPTIONS.find((x) => x.value === ch.dapt)!;
  const d1 = end("dapt", o.days);
  const what = { "12m": "End of 12-month DAPT", "3-6m": "DAPT 3–6 months: if event-free", "1m-acs": "High bleeding risk: after 1 month of DAPT", "6m": "End of 6-month DAPT", "1-3m": "High bleeding risk: DAPT 1–3 months" }[ch.dapt];
  const keepClop = ch.sapt === "clopidogrel";
  return [
    { key: "dapt", label: "DAPT", drugs: ["Aspirin", p2], from: at, to: d1,
      stop: keepClop
        ? { target: "aspirin", title: `${what}: stop aspirin, continue clopidogrel${ch.p2y12 !== "clopidogrel" ? ` (switch from ${p2.toLowerCase()})` : ""}` }
        : { target: "p2y12", title: `${what}: stop ${p2.toLowerCase()}, continue aspirin` } },
    { key: "after", label: "Single antiplatelet", drugs: [keepClop ? "Clopidogrel" : "Aspirin"], from: d1, to: null },
  ];
}

// the other steps after PCI, each with its default (ticked when the guideline asks for it and it is not done)
export type Extra = { id: string; label: string; detail: string; on: boolean };
export function extras(c: PciContext, ch: Choice): Extra[] {
  const out: Extra[] = [];
  const statinDose = c.pci.acs ? 80 : 40;
  if (!c.statin) out.push({ id: "statin", label: `Start atorvastatin ${statinDose} mg daily`, detail: "High-intensity statin (ESC ACS 2023 / CCS 2024, I A); LDL-C booked 6 weeks after the start.", on: true });
  else if (!c.statin.high) out.push({ id: "statin-up", label: /atorva|rosuva/i.test(c.statin.name) ? `Increase ${c.statin.name.toLowerCase()} to high intensity` : `Change ${c.statin.name.toLowerCase()} to a high-intensity statin`, detail: "Atorvastatin 40–80 mg or rosuvastatin 20–40 mg (I A). Adds a dated plan item.", on: true });
  if (!c.ppi) out.push({ id: "ppi", label: "Start pantoprazole 40 mg daily", detail: "PPI with combined antithrombotic therapy at increased GI-bleeding risk: anticoagulant, age ≥65, NSAID or steroid (ESC ACS 2023, I A).", on: !!c.oac || c.age >= 65 || c.nsaid });
  if (!c.planned.rehab) out.push({ id: "rehab", label: "Cardiac rehabilitation referral", detail: "Exercise-based rehabilitation after ACS or PCI (I A). Due in 1 week.", on: true });
  if (c.pci.acs && !c.lvefSince && !c.planned.echo) out.push({ id: "echo", label: "Echo: LV function", detail: "LVEF after ACS guides HF therapy and the ICD decision.", on: true });
  if (c.pci.acs && c.statin && !c.planned.lipids) out.push({ id: "lipids", label: "Lipid profile in 6 weeks", detail: "LDL-C 4–6 weeks after an ACS (ESC/EAS).", on: true });
  void ch;
  return out;
}
