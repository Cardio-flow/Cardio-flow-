// Starting doses for the medicines a pathway starts or intensifies (23 Oct 2026, Ahmed: "add label doses to
// every start or titrate step"). Every number is the label (SmPC) starting dose or the guideline's stated
// starting dose, cited on the line; where the label adjusts for kidney function the eGFR in the record decides,
// and where the label says not to start, nothing is started (the reason is returned instead). Insulin,
// antibiotics, acute drugs, loading doses and antiarrhythmics are never dosed here. The pre-start medication
// check (interactions, contraindications) still runs on every start before it is recorded.
import { cockcroftGault } from "./clinical.js";
import { MEDICATION, doseLabel } from "./catalog.js";
import type { OutcomeItem, WizardContext } from "./wizards.js";

type Start = { code: string; dose: number; frequency: string; why: string };

// ---- one source for the starting dose of each HF / CKD class, read by the alert engine (server guidelines.ts
// pillarsFor) and by every pathway (START below), so the two can never disagree (27 Oct 2026 audit) ----
type Dose = { code: string; dose: number; why: string };
// dapagliflozin is not started below eGFR 25 (Forxiga SmPC 4.2); empagliflozin from eGFR 20 (Jardiance SmPC 4.2)
export function sglt2Start(egfr: number | null): Dose | string {
  if (egfr != null && egfr < 20) return `eGFR ${Math.round(egfr)} <20: an SGLT2 inhibitor is not started (SmPC)`;
  return egfr != null && egfr < 25
    ? { code: "empagliflozin", dose: 10, why: `eGFR ${Math.round(egfr)} 20–24: empagliflozin 10 mg (dapagliflozin not started below 25; Jardiance / Forxiga SmPC)` }
    : { code: "dapagliflozin", dose: 10, why: "label dose, no titration (Forxiga SmPC; ESC HF)" };
}
// Spironolactone in heart failure (27 Oct 2026, Ahmed: "use the latest guidelines"). Aldactone UK SmPC 4.2: start
// 25 mg once daily if potassium ≤5.0 and creatinine ≤2.5 mg/dL (221 µmol/L); 25 mg every other day if 25 mg daily
// is not tolerated; then 50 mg daily as indicated. The label has no eGFR-based 12.5 mg start: the earlier
// 12.5 mg below eGFR 45 / 50 had no verified source and is removed. Not started below eGFR 30 (ESC HF practical
// guidance, as the HF alert gate). The ESC 2026 dose table (Table 11) could not be retrieved to cross-check.
export const SPIRONOLACTONE_MAX_CREATININE = 221; // µmol/L = 2.5 mg/dL (Aldactone SmPC 4.2)
export function spironolactoneStart(egfr: number | null, creatinine: number | null = null): Dose | string {
  if (egfr != null && egfr < 30) return `eGFR ${Math.round(egfr)} <30: an MRA is not started (ESC HF practical guidance)`;
  if (creatinine != null && creatinine > SPIRONOLACTONE_MAX_CREATININE) return `Creatinine ${Math.round(creatinine)} µmol/L >221 (2.5 mg/dL): spironolactone is not started (Aldactone SmPC)`;
  return { code: "spironolactone", dose: 25, why: "25 mg once daily (Aldactone SmPC; 25 mg every other day if not tolerated)" };
}
// eplerenone after MI with LVEF ≤40% (Inspra SmPC 4.2/4.3): 25 mg once daily; not started with K >5.0 or eGFR <30
export function eplerenoneStart(egfr: number | null, k: number | null): Dose | string {
  if (egfr == null || k == null) return "Record eGFR and potassium before starting eplerenone (Inspra SmPC)";
  if (k > 5.0) return `K ${k} >5.0: eplerenone is not started (Inspra SmPC)`;
  if (egfr < 30) return `eGFR ${Math.round(egfr)} <30: eplerenone is not started (Inspra SmPC)`;
  return { code: "eplerenone", dose: 25, why: "25 mg once daily; potassium and creatinine in the first week and at 1 month (Inspra SmPC)" };
}
// Kerendia SmPC 4.2: eGFR ≥60 20 mg, 25–<60 10 mg; not started below 25
export function finerenoneStart(egfr: number | null): Dose | string {
  if (egfr != null && egfr < 25) return `eGFR ${Math.round(egfr)} <25: finerenone is not started (SmPC)`;
  return egfr != null && egfr >= 60
    ? { code: "finerenone", dose: 20, why: `eGFR ${Math.round(egfr)}: 20 mg starting dose (Kerendia SmPC)` }
    : { code: "finerenone", dose: 10, why: `eGFR ${egfr == null ? "not recorded" : Math.round(egfr)}: 10 mg starting dose (Kerendia SmPC)` };
}
const v = (c: WizardContext, code: string) => c.values?.[code]?.value ?? null;

export const START: Record<string, (c: WizardContext) => Start | string> = {
  // ESC HF 2021/2023 (I A); the same drug and dose as the HF alert engine (sglt2Start)
  sglt2: (c) => { const e = v(c, "egfr"); if (e == null) return "Record eGFR before starting an SGLT2 inhibitor (SmPC)"; const st = sglt2Start(e); return typeof st === "string" ? st : { ...st, frequency: "OD" }; },
  // Ozempic SmPC: 0.25 mg once weekly for 4 weeks, then 0.5 mg
  glp1: () => ({ code: "semaglutide", dose: 0.25, frequency: "Weekly", why: "SmPC start for 4 weeks, then 0.5 mg weekly (Ozempic SmPC)" }),
  // Mounjaro SmPC: 2.5 mg once weekly for 4 weeks, then 5 mg
  tirzepatide: () => ({ code: "tirzepatide", dose: 2.5, frequency: "Weekly", why: "SmPC start for 4 weeks, then 5 mg weekly (Mounjaro SmPC)" }),
  // Kerendia SmPC: eGFR ≥60 20 mg, 25–59 10 mg; not started below 25 or with K >5.0
  finerenone: (c) => {
    const e = v(c, "egfr"), k = v(c, "potassium");
    if (e == null) return "No eGFR in the record: the finerenone starting dose depends on it (SmPC)";
    if (k == null) return "Record potassium before starting finerenone (SmPC)";
    if (k != null && k > 5.0) return `K ${k} >5.0: finerenone is not started (SmPC)`;
    const st = finerenoneStart(e);
    // CKD with type 2 diabetes (Kerendia SmPC 4.2): start with K ≤4.8; 4.8–5.0 only with extra potassium monitoring
    const extra = k > 4.8 && !(c.dx ?? []).some((d) => d === "hf" || d.startsWith("hf")) ? `; K ${k} 4.8–5.0: start only with additional potassium monitoring in the first 4 weeks (SmPC)` : "";
    return typeof st === "string" ? st : { ...st, frequency: "OD", why: `${st.why}; potassium at 4 weeks (Kerendia SmPC)${extra}` };
  },
  // ADA 2026: start 500 mg once or twice daily with food; label: not below eGFR 30, maximum 1000 mg/day at 30–44
  metformin: (c) => { const e = v(c, "egfr"); return e == null ? "Record eGFR before starting metformin (SmPC)" : e < 30 ? `eGFR ${Math.round(e)} <30: metformin is not started (label)` : { code: "metformin", dose: 500, frequency: "OD", why: `start low with food and titrate (ADA 2026)${e != null && e < 45 ? `; eGFR ${Math.round(e)}: maximum 1000 mg/day (label)` : ""}` }; },
  // Trajenta SmPC: 5 mg once daily, no renal adjustment
  dpp4: () => ({ code: "linagliptin", dose: 5, frequency: "OD", why: "label dose, no renal adjustment (Trajenta SmPC)" }),
  // Diamicron MR SmPC: start 30 mg once daily with breakfast
  gliclazide: () => ({ code: "gliclazide", dose: 30, frequency: "OD", why: "SmPC starting dose with breakfast; hypoglycaemia advice" }),
  // ESC HF 2021 diuretic table: furosemide starting dose 20–40 mg
  loop: () => ({ code: "furosemide", dose: 40, frequency: "OD", why: "within the ESC HF 2021 starting range 20–40 mg; adjust to weight and congestion" }),
  // spironolactone 25 mg once daily (Aldactone SmPC); not with K >5.0, creatinine >221 µmol/L or eGFR <30
  mra: (c) => {
    const e = v(c, "egfr"), k = v(c, "potassium");
    if (e == null || k == null) return "Record eGFR and potassium before starting an MRA (ESC HF practical guidance)";
    if (k != null && k > 5.0) return `K ${k} >5.0: an MRA is not started (ESC HF practical guidance)`;
    const st = spironolactoneStart(e, v(c, "creatinine"));
    return typeof st === "string" ? st : { ...st, frequency: "OD", why: `${st.why}; potassium and creatinine at 1 week, then monthly for 3 months (SmPC)` };
  },
  // pantoprazole 40 mg once daily with combined antithrombotic therapy (ESC ACS 2023; label dose)
  ppi: () => ({ code: "pantoprazole", dose: 40, frequency: "OD", why: "gastroprotection with antithrombotic therapy (ESC 2023; label dose)" }),
};

// the results each labelled start is dosed from
export const START_NEEDS: Record<string, string[]> = { sglt2: ["egfr"], finerenone: ["egfr", "potassium"], metformin: ["egfr"], mra: ["egfr", "potassium"], eplerenone: ["egfr", "potassium"] };

// a start item, or a note saying why the label does not allow it; nothing when the class is already taken
export function startItem(key: string, c: WizardContext, indication: string, tag?: string): OutcomeItem | null {
  if (tag && c.meds.some((m) => m.tags.includes(tag) && m.status !== "stopped")) return null;
  const s = START[key]?.(c);
  if (!s) return null;
  // a start the label rules out, or one waiting for a result, is shown in the decision (never dropped silently);
  // the missing result becomes "record this" in the decision card
  if (typeof s === "string") {
    const needs = (START_NEEDS[key] ?? []).filter((code) => v(c, code) == null);
    return { kind: "note", label: s, decision: true, ...(needs.length ? { needs } : {}) };
  }
  const def = MEDICATION[s.code];
  const freq = s.frequency === "OD" ? "once daily" : s.frequency === "BID" ? "twice daily" : s.frequency === "Weekly" ? "once weekly" : s.frequency;
  return { kind: "start", code: s.code, doseValue: s.dose, frequency: s.frequency, indication, label: `${def?.name ?? s.code} ${doseLabel(def, s.dose, def?.unit ?? "mg")} ${freq}: start — ${s.why}` };
}

// high-intensity statin (ESC/EAS 2019/2025: atorvastatin 40–80 mg, rosuvastatin 20–40 mg): the next dose that
// reaches it from the current one; other statins are switched to atorvastatin 40 mg
export function statinUp(c: WizardContext): OutcomeItem[] {
  const st = c.meds.find((m) => m.tags.includes("statin") && (!m.status || m.status === "active"));
  if (!st) return [];
  if (st.doseValue == null || !st.frequency) return [{kind:"note",label:`Confirm ${st.name} dose and frequency before increasing it`}];
  const cr = v(c,"creatinine"), weight = v(c,"weight");
  const e = cr != null && weight != null && c.profile?.sex ? cockcroftGault(cr,c.profile.age,weight,c.profile.sex) : v(c,"egfr");
  if(st.code === "rosuvastatin" && (e == null || e < 30)) return [{kind:"note",label:e == null ? "Record renal function before increasing rosuvastatin" : "Rosuvastatin is contraindicated with CrCl <30 mL/min (Crestor SmPC); review an alternative statin"}];
  const target = st.code === "atorvastatin" ? (st.doseValue != null && st.doseValue >= 40 ? 80 : 40) : st.code === "rosuvastatin" ? (st.doseValue != null && st.doseValue >= 20 ? (e != null && e < 60 ? null : 40) : 20) : null;
  if (target != null && st.doseValue != null && target > st.doseValue)
    return [{ kind: "medication", medicationId: st.id, event: "increase", doseValue: target, label: `${st.name}: ${st.doseValue} mg → ${target} mg — high intensity (ESC/EAS: atorvastatin 40–80 mg, rosuvastatin 20–40 mg)` }];
  if (target == null && st.code !== "atorvastatin" && st.code !== "rosuvastatin")
    return [{ kind: "medication", medicationId: st.id, event: "stop", doseValue: null, label: `${st.name}: stop — switch to a high-intensity statin` },
      { kind: "start", code: "atorvastatin", doseValue: 40, frequency: "OD", indication: "cad", label: "Atorvastatin 40 mg once daily: start — high intensity (ESC/EAS)" }];
  return [{ kind: "note", label: `${st.name} ${st.doseValue ?? ""} mg has no automatic dose increase${e != null && e < 60 && st.code === "rosuvastatin" ? " (40 mg is contraindicated with CrCl <60 mL/min, Crestor SmPC)" : ""}: review tolerance and consider ezetimibe` }];
}
