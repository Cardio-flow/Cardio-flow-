// The coronary profile (coronary module, slice 1): one view model for the Coronary panel, notes
// and documents. Descriptive only: what happened and when (ACS, MI, PCI, CABG, angiography), the
// antithrombotic regimen now with each drug's start and planned stop date, and the secondary
// prevention picture (LDL-C against the ESC/EAS goal, LVEF, BP, rehabilitation).
import { DIAGNOSIS, MEDICATION, doseLabel } from "../../shared/catalog.js";
import { attributesText } from "../../shared/history.js";
import { daysBetween } from "../../shared/clinical.js";
import { PROCEDURE_LABEL, isAcsProcedure, isComplexPci } from "../../shared/procedures.js";
import { obstructiveCad } from "../../shared/studies.js";
import type { MedState, PatientState } from "../kernel/state.js";
import { lipidRisk, statinIntensity } from "./guidelines.js";

export type CadEvent = { at: string; kind: "acs" | "mi" | "pci" | "cabg" | "cath"; title: string; detail: string; acs: boolean; dateKnown: boolean };

// admission reasons that mean an acute coronary syndrome ("STEMI", "NSTE-ACS", free text "NSTEMI"…)
const ACS_REASON = /STEMI|NSTE/i;
const live = (s: PatientState) => s.meds.filter((m) => m.status === "active" || m.status === "held");

export function cadEvents(s: PatientState): CadEvent[] {
  const ev: CadEvent[] = [];
  for (const c of s.contexts.filter((c) => c.kind === "admission")) {
    const r = c.reasons.find((x) => ACS_REASON.test(x));
    if (r) ev.push({ at: c.started_at, kind: "acs", title: `${r} admission`, detail: c.ended_at ? `discharged ${c.ended_at.slice(0, 10)}` : "in hospital", acs: true, dateKnown: true });
  }
  for (const c of s.conditions.filter((c) => ["acs-stemi", "acs-nstemi", "prior-mi"].includes(c.code))) {
    const year = c.attributes?.onsetYear;
    const at = c.onset ?? (year ? `${year}-07-01` : null);
    if (!at) continue;
    // an MI already represented by an ACS admission within a week is not listed twice
    if (ev.some((e) => e.kind === "acs" && Math.abs(daysBetween(e.at, at)) <= 7)) continue;
    ev.push({ at, kind: "mi", title: DIAGNOSIS[c.code]?.display ?? c.display, detail: [attributesText(c.code, c.attributes), c.onset ? null : `${year}, month not recorded`].filter(Boolean).join(" · "), acs: true, dateKnown: !!c.onset });
  }
  for (const p of s.procedures)
    ev.push({ at: p.performed_at, kind: p.kind as "pci" | "cabg", title: PROCEDURE_LABEL[p.kind as "pci"] ?? p.kind, detail: p.summary, acs: isAcsProcedure(p), dateKnown: true });
  for (const st of s.studies.filter((x) => x.kind === "cath")) {
    const cad = obstructiveCad("cath", st.attributes);
    ev.push({ at: st.performed_at, kind: "cath", title: "Coronary angiography", detail: [cad ?? "no obstructive disease", st.attributes.outcome].filter(Boolean).join(" · "), acs: false, dateKnown: true });
  }
  return ev.sort((a, b) => a.at.localeCompare(b.at));
}

// The event that times antithrombotic therapy: the latest ACS or PCI.
export function indexEvent(s: PatientState) {
  const ev = cadEvents(s).filter((e) => e.kind === "acs" || e.kind === "mi" || e.kind === "pci");
  const last = ev[ev.length - 1];
  if (!last) return null;
  const pci = [...s.procedures].reverse().find((p) => p.kind === "pci");
  // an ACS within a week of the PCI makes the PCI an ACS-PCI even when recorded as staged
  const acsNear = ev.some((e) => (e.kind === "acs" || e.kind === "mi") && e.dateKnown && pci && Math.abs(daysBetween(e.at, pci.performed_at)) <= 30);
  return {
    at: last.at, kind: last.kind, title: last.title, detail: last.detail,
    acs: last.acs || acsNear, days: daysBetween(last.at, s.today),
    pci: pci ? { at: pci.performed_at, complex: isComplexPci(pci), summary: pci.summary } : null,
  };
}

// The antithrombotic regimen now, named the way it is discussed on the ward.
export function antithrombotic(s: PatientState) {
  const meds = live(s).filter((m) => m.tags.includes("antiplatelet") || m.tags.includes("oac"));
  const aspirin = meds.find((m) => m.code === "aspirin");
  const p2y12 = meds.find((m) => m.tags.includes("p2y12"));
  const oac = meds.find((m) => m.tags.includes("oac"));
  const regimen =
    aspirin && p2y12 && oac ? "Triple therapy" :
    oac && p2y12 ? "Anticoagulant + P2Y12 inhibitor" :
    oac && aspirin ? "Anticoagulant + aspirin" :
    aspirin && p2y12 ? "DAPT" :
    oac ? "Anticoagulant alone" :
    aspirin ? "Aspirin alone" :
    p2y12 ? "P2Y12 inhibitor alone" : "No antithrombotic";
  const role = (m: MedState) => (m.tags.includes("oac") ? "Anticoagulant" : m.tags.includes("p2y12") ? "P2Y12 inhibitor" : "Aspirin");
  return {
    regimen,
    drugs: meds.map((m) => {
      const stop = s.plan.filter((p) => p.status === "planned" && p.medication_id === m.id && p.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
      return {
        id: m.id, name: m.name, role: role(m), status: m.status,
        dose: MEDICATION[m.code] ? `${doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)} ${m.frequency ?? ""}`.trim() : "",
        since: m.startedAt, days: m.startedAt ? daysBetween(m.startedAt, s.today) : null,
        plannedStop: stop ? { at: stop.due_date, title: stop.title } : null,
      };
    }),
  };
}

export function cadProfile(s: PatientState) {
  const events = cadEvents(s);
  if (!s.tags.has("cad") && !events.length) return null;
  const ldl = s.resolved("ldl-c").current;
  const risk = lipidRisk(s);
  const lipidMeds = live(s).filter((m) => m.tags.includes("statin") || m.tags.includes("ezetimibe") || m.tags.includes("pcsk9") || m.code === "bempedoic-acid" || m.code === "inclisiran");
  const lvef = s.resolved("lvef").current;
  const sbp = s.resolved("sbp").current;
  const rehab = s.plan.filter((p) => /rehabilitation/i.test(p.title)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  return {
    events,
    index: indexEvent(s),
    antithrombotic: antithrombotic(s),
    lipids: {
      ldl: ldl?.value_num != null ? { value: ldl.value_num, at: ldl.effective_at } : null,
      goal: risk ? { value: risk.goal, category: risk.category, why: risk.why } : null,
      atGoal: ldl?.value_num != null && risk ? ldl.value_num < risk.goal : null,
      therapy: lipidMeds.map((m) => ({
        name: m.name,
        dose: MEDICATION[m.code] ? `${doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)} ${m.frequency ?? ""}`.trim() : "",
        intensity: m.tags.includes("statin") ? statinIntensity(m) : null,
      })),
    },
    lvef: lvef?.value_num != null ? { value: lvef.value_num, at: lvef.effective_at } : null,
    sbp: sbp?.value_num != null ? { value: sbp.value_num, at: sbp.effective_at } : null,
    smoker: s.conditions.some((c) => c.code === "smoker"),
    rehab: rehab ? { status: rehab.status, due: rehab.due_date, title: rehab.title } : null,
  };
}
export type CadProfile = NonNullable<ReturnType<typeof cadProfile>>;
