// Coronary rules (coronary module, slice 2): the antithrombotic timeline after ACS / PCI, PPI with
// combined antithrombotic therapy, and cardiac rehabilitation. Durations are the guideline's own.
// Sources: 2023 ESC ACS (DAPT 12 months I A; with an anticoagulant triple therapy up to 1 week I A,
// up to 1 month if high ischaemic risk; ticagrelor/prasugrel not recommended in triple therapy;
// PPI with combined antithrombotic therapy at GI-bleeding risk I A; cardiac rehabilitation I A);
// 2024 ESC CCS (DAPT 6 months after PCI; rehabilitation I A).
import { fmtDay } from "../../shared/clinical.js";
import type { PatientState } from "../kernel/state.js";
import { antithrombotic, indexEvent } from "./cad-profile.js";
import type { RuleDef } from "./rules.js";

const live = (s: PatientState) => s.meds.filter((m) => m.status === "active" || m.status === "held");
const months = (d: number) => (d < 60 ? `${d} days` : `${Math.round(d / 30.4)} months`);
const antithromboticMeds = (s: PatientState) => live(s).filter((m) => m.tags.includes("antiplatelet") || m.tags.includes("oac"));
// a dated stop is planned for one of the antithrombotic medicines (open, due in the future or today)
const plannedStop = (s: PatientState, ids: string[]) => s.plan.some((p) => p.status === "planned" && p.medication_id && ids.includes(p.medication_id) && !!p.due_date);

export const CAD_RULES: RuleDef[] = [
  {
    id: "cad.antithrombotic-plan",
    kind: "clinical",
    title: "Antithrombotic plan after ACS / PCI",
    inputs: ["procedures", "conditions", "contexts", "meds", "plan"],
    defaultParams: {},
    evidence: "2023 ESC ACS and 2024 ESC CCS: the duration of DAPT, and of triple and dual therapy with an anticoagulant, is decided at the index event (ACS 12 months by default; elective PCI 6 months; triple therapy up to 1 week).",
    evaluate(s) {
      const ix = indexEvent(s);
      // within the default DAPT window (ACS 12 months, elective PCI 6 months); beyond it the
      // DAPT-beyond-default finding takes over
      if (!ix || (ix.kind !== "pci" && !ix.acs) || ix.days > (ix.acs ? 365 : 182)) return [];
      const meds = antithromboticMeds(s);
      if (!meds.some((m) => m.tags.includes("antiplatelet")) || plannedStop(s, meds.map((m) => m.id))) return [];
      // ticagrelor/prasugrel with an anticoagulant has its own, more specific finding (same pathway)
      if (meds.some((m) => m.tags.includes("oac")) && meds.some((m) => m.tags.includes("p2y12-potent"))) return [];
      const reg = antithrombotic(s).regimen;
      const what = ix.kind === "pci" ? (ix.acs ? "ACS PCI" : "Elective PCI") : ix.title;
      return [{
        key: "plan", signature: ix.at, severity: "orange",
        title: `${what} ${fmtDay(ix.at)}: antithrombotic stop dates not set`,
        detail: `${reg} with no planned stop date. ${ix.acs ? "ACS: DAPT 12 months by default" : "Elective PCI: DAPT 6 months"}; with an anticoagulant, triple therapy up to 1 week.`,
        facts: [{ label: "Index event", value: `${ix.title}${ix.detail ? ` · ${ix.detail}` : ""}`, date: ix.at }, { label: "Regimen", value: reg }, { label: "Guideline", value: "ESC ACS 2023 · ESC CCS 2024" }],
        missing: [], action: { type: "wizard", wizard: "antithrombotic" },
      }];
    },
  },
  {
    id: "cad.potent-p2y12-with-oac",
    kind: "clinical",
    title: "Ticagrelor or prasugrel with an anticoagulant",
    inputs: ["meds"],
    defaultParams: {},
    evidence: "2023 ESC ACS: with an oral anticoagulant, clopidogrel is the P2Y12 inhibitor of choice; ticagrelor or prasugrel are not recommended as part of triple antithrombotic therapy.",
    evaluate(s) {
      const oac = live(s).find((m) => m.tags.includes("oac"));
      const potent = live(s).find((m) => m.tags.includes("p2y12-potent"));
      if (!oac || !potent) return [];
      const triple = live(s).some((m) => m.code === "aspirin");
      return [{
        key: "potent", signature: `${oac.id}:${potent.id}`, severity: "orange",
        title: `${potent.name} with ${oac.name}${triple ? " and aspirin" : ""}: switch to clopidogrel`,
        detail: "Ticagrelor and prasugrel are not recommended with an anticoagulant (bleeding); clopidogrel is the P2Y12 inhibitor of choice.",
        facts: [{ label: "P2Y12 inhibitor", value: potent.name, tone: "orange" }, { label: "Anticoagulant", value: oac.name }, { label: "Guideline", value: "ESC ACS 2023" }],
        missing: [], action: { type: "wizard", wizard: "antithrombotic" },
      }];
    },
  },
  {
    id: "cad.triple-beyond-1-month",
    kind: "clinical",
    title: "Triple therapy longer than 1 month",
    inputs: ["meds", "procedures", "contexts", "conditions"],
    defaultParams: {},
    evidence: "2023 ESC ACS / 2024 ESC CCS: triple antithrombotic therapy up to 1 week, extended up to 1 month only with high ischaemic risk; then anticoagulant + one antiplatelet.",
    evaluate(s) {
      const meds = live(s);
      const oac = meds.find((m) => m.tags.includes("oac")), asp = meds.find((m) => m.code === "aspirin"), p2 = meds.find((m) => m.tags.includes("p2y12"));
      if (!oac || !asp || !p2) return [];
      const ix = indexEvent(s);
      const days = ix?.days ?? null;
      if (days == null || days <= 30) return [];
      return [{
        key: "triple", signature: `${asp.id}:${ix!.at}`, severity: "orange",
        title: `Triple therapy ${months(days)} after ${ix!.title}: stop aspirin`,
        detail: "Up to 1 week (1 month with high ischaemic risk), then anticoagulant + clopidogrel.",
        facts: [{ label: "Since", value: fmtDay(ix!.at, { year: true }) }, { label: "Regimen", value: `${oac.name} + aspirin + ${p2.name}`, tone: "orange" }, { label: "Guideline", value: "ESC ACS 2023 · CCS 2024" }],
        missing: [], action: { type: "med-action", medicationId: asp.id, action: "stop", label: "Stop aspirin" },
      }];
    },
  },
  {
    id: "cad.dapt-beyond-default",
    kind: "clinical",
    title: "DAPT beyond the default duration",
    inputs: ["meds", "procedures", "contexts", "conditions", "plan"],
    defaultParams: {},
    evidence: "2023 ESC ACS: DAPT 12 months by default; 2024 ESC CCS: 6 months after PCI. Extending DAPT is considered only with high ischaemic risk and no high bleeding risk.",
    evaluate(s) {
      const meds = live(s);
      if (meds.some((m) => m.tags.includes("oac"))) return [];
      const asp = meds.find((m) => m.code === "aspirin"), p2 = meds.find((m) => m.tags.includes("p2y12"));
      const ix = indexEvent(s);
      if (!asp || !p2 || !ix) return [];
      const limit = ix.acs ? 365 : ix.kind === "pci" ? 182 : null;
      if (limit == null || ix.days <= limit || plannedStop(s, [asp.id, p2.id])) return [];
      return [{
        key: "dapt", signature: `${p2.id}:${ix.at}`, severity: "yellow",
        title: `DAPT ${months(ix.days)} after ${ix.acs ? "ACS" : "elective PCI"}: beyond the ${ix.acs ? "12" : "6"}-month default`,
        detail: "Continue only for high ischaemic risk without high bleeding risk; otherwise single antiplatelet.",
        facts: [{ label: "Index event", value: ix.title, date: ix.at }, { label: "DAPT", value: `aspirin + ${p2.name}` }, { label: "Guideline", value: ix.acs ? "ESC ACS 2023" : "ESC CCS 2024" }],
        missing: [], action: { type: "wizard", wizard: "antithrombotic" },
      }];
    },
  },
  {
    id: "cad.ppi-combined-antithrombotic",
    kind: "clinical",
    title: "PPI with combined antithrombotic therapy",
    inputs: ["meds"],
    defaultParams: {},
    evidence: "2023 ESC ACS: a proton-pump inhibitor is recommended with combined antithrombotic therapy (DAPT, or anticoagulant + antiplatelet) in patients at increased risk of GI bleeding (I A).",
    evaluate(s) {
      const meds = antithromboticMeds(s);
      if (meds.length < 2 || live(s).some((m) => m.tags.includes("ppi"))) return [];
      const why = [
        meds.some((m) => m.tags.includes("oac")) && "on an anticoagulant",
        s.patient.age >= 65 && `age ${s.patient.age}`,
        live(s).some((m) => m.tags.includes("nsaid") || m.tags.includes("steroid")) && "NSAID or steroid",
      ].filter(Boolean) as string[];
      if (!why.length) return [];
      return [{
        key: "ppi", signature: meds.map((m) => m.id).sort().join(","), severity: "yellow",
        title: `${meds.length === 3 ? "Triple therapy" : "Combined antithrombotic therapy"} without a PPI`,
        detail: `GI-bleeding risk: ${why.join(", ")}. A PPI is recommended (ESC ACS 2023, I A).`,
        facts: [{ label: "Antithrombotics", value: meds.map((m) => m.name).join(" + ") }, { label: "Guideline", value: "ESC ACS 2023 · I A" }],
        missing: [], action: { type: "start-med", code: "pantoprazole", dose: 40, label: "Start pantoprazole 40 mg" },
      }];
    },
  },
  {
    id: "cad.rehab",
    kind: "clinical",
    title: "Cardiac rehabilitation after ACS / PCI / CABG",
    inputs: ["procedures", "contexts", "conditions", "plan"],
    defaultParams: {},
    evidence: "2023 ESC ACS and 2024 ESC CCS: a structured, supervised, exercise-based cardiac rehabilitation programme is recommended after ACS and revascularisation (I A).",
    evaluate(s) {
      const ix = indexEvent(s);
      const cabg = [...s.procedures].reverse().find((p) => p.kind === "cabg");
      const at = [ix?.at, cabg?.performed_at].filter(Boolean).sort().pop();
      if (!at) return [];
      const days = Math.round((Date.parse(s.today) - Date.parse(at.slice(0, 10))) / 86400000);
      if (days > 365 || (!ix?.acs && ix?.kind !== "pci" && !cabg)) return [];
      if (s.plan.some((p) => /rehabilitation/i.test(p.title))) return [];
      return [{
        key: "rehab", signature: at, severity: "orange",
        title: "No cardiac rehabilitation referral after " + (cabg && cabg.performed_at === at ? "CABG" : ix?.acs ? "ACS" : "PCI"),
        detail: "Structured, supervised exercise-based rehabilitation improves outcomes (I A).",
        facts: [{ label: "Event", value: cabg && cabg.performed_at === at ? "CABG" : ix!.title, date: at }, { label: "Guideline", value: "ESC ACS 2023 · CCS 2024 · I A" }],
        missing: [], action: { type: "add-plan", template: "rehab" },
      }];
    },
  },
];
