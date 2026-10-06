// Coronary rules (coronary module, slice 2): the antithrombotic timeline after ACS / PCI, PPI with
// combined antithrombotic therapy, and cardiac rehabilitation. Durations are the guideline's own.
// Sources: 2023 ESC ACS (DAPT 12 months I A; with an anticoagulant triple therapy up to 1 week I A,
// up to 1 month if high ischaemic risk; ticagrelor/prasugrel not recommended in triple therapy;
// PPI with combined antithrombotic therapy at GI-bleeding risk I A; cardiac rehabilitation I A);
// 2024 ESC CCS (DAPT 6 months after PCI; rehabilitation I A).
import { addDays, fmtDay, localDay } from "../../shared/clinical.js";
import type { PatientState } from "../kernel/state.js";
import { acsIndex, antithrombotic, indexEvent } from "./cad-profile.js";
import type { Finding, RuleDef } from "./rules.js";

const live = (s: PatientState) => s.meds.filter((m) => m.status === "active" || m.status === "held");
const months = (d: number) => (d < 60 ? `${d} days` : `${Math.round(d / 30.4)} months`);
const antithromboticMeds = (s: PatientState) => live(s).filter((m) => m.tags.includes("antiplatelet") || m.tags.includes("oac"));
// a dated stop is planned for one of the antithrombotic medicines (open, due in the future or today)
const plannedStop = (s: PatientState, ids: string[]) => s.plan.some((p) => p.status === "planned" && p.medication_id && ids.includes(p.medication_id) && !!p.due_date);

const bundleDone = (s: PatientState, acsAt: string) => !!s.pathwaysDone["acs-discharge"] && localDay(s.pathwaysDone["acs-discharge"]) >= acsAt;
const plannedTitle = (s: PatientState, re: RegExp) => s.plan.some((p) => p.status === "planned" && re.test(p.title));
const measuredSince = (s: PatientState, code: string, from: string) =>
  s.observations.some((o) => o.code === code && o.status !== "entered_in_error" && o.value_num != null && localDay(o.effective_at) >= from);

export const CAD_RULES: RuleDef[] = [
  {
    id: "cad.acs-bundle",
    kind: "clinical",
    title: "Secondary-prevention bundle after ACS",
    inputs: ["procedures", "contexts", "conditions", "pathways"],
    defaultParams: {},
    evidence: "2023 ESC ACS, long-term management: rehabilitation (I A), high-intensity statin and LDL-C goal (I A), lipids re-evaluated at 4–6 weeks, beta-blocker / ACE inhibitor / MRA by LVEF and comorbidity (I A), echocardiography during the admission, glycaemic status, influenza vaccination, complete revascularisation. Offered once per ACS within the 12-month DAPT window, until the ACS discharge bundle is completed.",
    evaluate(s) {
      const ix = acsIndex(s);
      if (!ix || ix.acsDays > 365 || bundleDone(s, ix.acsAt)) return [];
      const inHospital = s.contexts.some((c) => c.kind === "admission" && !c.ended_at && localDay(c.started_at) >= addDays(ix.acsAt, -2));
      return [{
        key: "bundle", signature: ix.acsAt, severity: "orange",
        title: inHospital ? "ACS: complete the secondary-prevention bundle before discharge" : `ACS ${fmtDay(ix.acsAt)}: secondary-prevention bundle not completed`,
        detail: "Statin and LDL-C goal, beta-blocker / ACE inhibitor / MRA by LVEF, rehabilitation, lipids at 4–6 weeks, LVEF follow-up.",
        facts: [{ label: "Event", value: `${ix.title}${ix.detail ? ` · ${ix.detail}` : ""}`, date: ix.at }, { label: "Guideline", value: "ESC ACS 2023" }],
        missing: [], action: { type: "wizard", wizard: "acs-discharge" },
      }];
    },
  },
  {
    id: "cad.lvef-after-acs",
    kind: "clinical",
    title: "No LVEF after ACS",
    inputs: ["lvef", "plan", "pathways", "procedures", "contexts", "conditions"],
    defaultParams: {},
    evidence: "2023 ESC ACS: echocardiography during the admission to assess LV function. Shown once the ACS bundle is done (until then the bundle covers it).",
    evaluate(s) {
      const ix = acsIndex(s);
      if (!ix || ix.acsDays > 365 || !bundleDone(s, ix.acsAt) || measuredSince(s, "lvef", ix.acsAt) || plannedTitle(s, /echo/i)) return [];
      return [{
        key: "lvef", signature: ix.acsAt, severity: "yellow",
        title: "No LVEF recorded since the ACS",
        detail: "LV function guides beta-blocker, ACE inhibitor, MRA and ICD decisions.",
        facts: [{ label: "ACS", value: ix.title, date: ix.acsAt }, { label: "Guideline", value: "ESC ACS 2023" }],
        missing: [], action: { type: "add-plan", template: "echo" },
      }];
    },
  },
  {
    id: "cad.lvef-reassess-after-mi",
    kind: "clinical",
    title: "LVEF ≤40% after MI: reassess at 6–12 weeks",
    inputs: ["lvef", "plan", "procedures", "contexts", "conditions"],
    defaultParams: {},
    evidence: "2022 ESC ventricular arrhythmias: in patients with pre-discharge LVEF ≤40%, re-evaluation of LVEF 6–12 weeks after MI is recommended to assess the need for a primary-prevention ICD (I C).",
    evaluate(s) {
      const ix = acsIndex(s);
      if (!ix || ix.acsDays < 42 || ix.acsDays > 365) return [];
      const efs = s.observations.filter((o) => o.code === "lvef" && o.status !== "entered_in_error" && o.value_num != null && localDay(o.effective_at) >= ix.acsAt).sort((a, b) => a.effective_at.localeCompare(b.effective_at));
      const early = efs.find((o) => localDay(o.effective_at) < addDays(ix.acsAt, 42));
      if (!early || early.value_num! > 40 || efs.some((o) => localDay(o.effective_at) >= addDays(ix.acsAt, 42)) || plannedTitle(s, /echo/i)) return [];
      return [{
        key: "reassess", signature: early.id, severity: "orange",
        title: `LVEF ${early.value_num}% after MI: reassess LVEF now (ICD decision)`,
        detail: `${Math.round(ix.acsDays / 7)} weeks since the ACS; re-evaluate LVEF 6–12 weeks after MI on optimal therapy.`,
        facts: [{ label: "LVEF after the ACS", value: `${early.value_num}%`, date: early.effective_at }, { label: "Guideline", value: "ESC VA 2022 · I C" }],
        missing: [], action: { type: "add-plan", template: "echo" },
      }];
    },
  },
  {
    id: "cad.lipids-after-acs",
    kind: "clinical",
    title: "Lipids 4–6 weeks after ACS",
    inputs: ["ldl-c", "plan", "pathways", "procedures", "contexts", "conditions"],
    defaultParams: {},
    evidence: "2023 ESC ACS: lipid levels re-evaluated 4–6 weeks after ACS to check the LDL-C goal (<1.4 mmol/L and ≥50% reduction); ezetimibe if not at goal (I B). Shown once the ACS bundle is done.",
    evaluate(s) {
      const ix = acsIndex(s);
      if (!ix || ix.acsDays <= 42 || ix.acsDays > 365 || !bundleDone(s, ix.acsAt) || measuredSince(s, "ldl-c", addDays(ix.acsAt, 28)) || plannedTitle(s, /lipid/i)) return [];
      return [{
        key: "lipids", signature: ix.acsAt, severity: "yellow",
        title: "No lipid profile since 4 weeks after the ACS",
        detail: "Re-evaluate LDL-C against the goal <1.4 mmol/L; add ezetimibe if not reached.",
        facts: [{ label: "ACS", value: ix.title, date: ix.acsAt }, { label: "Guideline", value: "ESC ACS 2023" }],
        missing: [], action: { type: "add-plan", template: "lipids" },
      }];
    },
  },
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
    inputs: ["procedures", "contexts", "conditions", "plan", "pathways"],
    defaultParams: {},
    evidence: "2023 ESC ACS and 2024 ESC CCS: a structured, supervised, exercise-based cardiac rehabilitation programme is recommended after ACS and revascularisation (I A).",
    evaluate(s) {
      const ix = indexEvent(s);
      const cabg = [...s.procedures].reverse().find((p) => p.kind === "cabg");
      const at = [ix?.at, cabg?.performed_at].filter(Boolean).sort().pop();
      if (!at) return [];
      const days = Math.round((Date.parse(s.today) - Date.parse(localDay(at))) / 86400000);
      if (days > 365 || (!ix?.acs && ix?.kind !== "pci" && !cabg)) return [];
      if (s.plan.some((p) => /rehabilitation/i.test(p.title))) return [];
      // after an ACS the bundle carries rehabilitation until it is completed
      const acs = acsIndex(s);
      if (acs && acs.acsDays <= 365 && !bundleDone(s, acs.acsAt)) return [];
      return [{
        key: "rehab", signature: at, severity: "orange",
        title: "No cardiac rehabilitation referral after " + (cabg && cabg.performed_at === at ? "CABG" : ix?.acs ? "ACS" : "PCI"),
        detail: "Structured, supervised exercise-based rehabilitation improves outcomes (I A).",
        facts: [{ label: "Event", value: cabg && cabg.performed_at === at ? "CABG" : ix!.title, date: at }, { label: "Guideline", value: "ESC ACS 2023 · CCS 2024 · I A" }],
        missing: [], action: { type: "add-plan", template: "rehab" },
      }];
    },
  },
  {
    id: "cad.pci-complication",
    kind: "clinical",
    title: "Follow-up of a PCI complication",
    inputs: ["procedures", "creatinine", "haemoglobin", "lvef", "plan"],
    defaultParams: {},
    evidence: "Complications recorded with the PCI (audit, 6 Oct): contrast-associated kidney injury → creatinine and potassium again (KDIGO 2012 AKI: monitor serum creatinine); access-site bleeding → haemoglobin again; peri-procedural MI, acute stent thrombosis, VT/VF or perforation → echocardiography for LV function and pericardial effusion (ESC ACS 2023: LV function after MI). Each closes once the result is recorded after the PCI, or an echo is planned. Shown for 30 days after the PCI; no threshold is applied.",
    evaluate(s) {
      const pci = [...s.procedures].reverse().find((p) => p.kind === "pci");
      const comp: string[] = (pci?.attributes.complications as string[] | undefined) ?? [];
      if (!pci || !comp.length) return [];
      const at = localDay(pci.performed_at);
      if (Math.round((Date.parse(s.today) - Date.parse(at)) / 86400000) > 30) return [];
      const facts: Finding["facts"] = [{ label: "PCI", value: pci.summary, date: at }];
      const out: Finding[] = [];
      if (comp.includes("Contrast-associated kidney injury") && !measuredSince(s, "creatinine", at))
        out.push({
          key: "aki", signature: at, severity: "orange" as const,
          title: "Kidney injury after PCI contrast: recheck creatinine and potassium",
          detail: "Contrast-associated kidney injury was recorded with the PCI and no creatinine has been recorded since.",
          facts: [...facts, { label: "Guideline", value: "KDIGO 2012 AKI" }], missing: [], action: { type: "add-labs", codes: ["creatinine", "potassium"], label: "Enter creatinine and potassium" },
        });
      if (comp.includes("Access-site haematoma or bleeding") && !measuredSince(s, "haemoglobin", at))
        out.push({
          key: "bleed", signature: at, severity: "orange" as const,
          title: "Access-site bleeding after PCI: recheck haemoglobin",
          detail: "Bleeding at the access site was recorded with the PCI and no haemoglobin has been recorded since. Antithrombotic therapy continues unless the bleeding pathway decides otherwise.",
          facts, missing: [], action: { type: "add-labs", codes: ["haemoglobin"], label: "Enter haemoglobin" },
        });
      const lv = comp.filter((c) => ["Peri-procedural MI", "Acute stent thrombosis", "VT / VF needing treatment", "Coronary perforation"].includes(c));
      if (lv.length && !measuredSince(s, "lvef", at) && !plannedTitle(s, /echo/i))
        out.push({
          key: "echo", signature: at, severity: "orange" as const,
          title: `${lv[0]} during PCI: echo for LV function${lv.includes("Coronary perforation") ? " and effusion" : ""}`,
          detail: `${lv.join(", ")} recorded with the PCI; no echo since.`,
          facts: [...facts, { label: "Guideline", value: "ESC ACS 2023" }], missing: [], action: { type: "add-plan", template: "echo" },
        });
      return out;
    },
  },
];
