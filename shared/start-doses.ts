// Starting doses for the medicines a pathway starts or intensifies (23 Oct 2026, Ahmed: "add label doses to
// every start or titrate step"). Every number is the label (SmPC) starting dose or the guideline's stated
// starting dose, cited on the line; where the label adjusts for kidney function the eGFR in the record decides,
// and where the label says not to start, nothing is started (the reason is returned instead). Insulin,
// antibiotics, acute drugs, loading doses and antiarrhythmics are never dosed here. The pre-start medication
// check (interactions, contraindications) still runs on every start before it is recorded.
import { MEDICATION, doseLabel } from "./catalog.js";
import type { OutcomeItem, WizardContext } from "./wizards.js";

type Start = { code: string; dose: number; frequency: string; why: string };
const v = (c: WizardContext, code: string) => c.values?.[code]?.value ?? null;

export const START: Record<string, (c: WizardContext) => Start | string> = {
  // ESC HF 2021/2023 (I A); Jardiance SmPC: 10 mg once daily, not started below eGFR 20
  sglt2: (c) => { const e = v(c, "egfr"); return e != null && e < 20 ? `eGFR ${Math.round(e)} <20: an SGLT2 inhibitor is not started (SmPC)` : { code: "empagliflozin", dose: 10, frequency: "OD", why: "label dose; no titration (Jardiance SmPC; ESC HF 2021/2023)" }; },
  // Ozempic SmPC: 0.25 mg once weekly for 4 weeks, then 0.5 mg
  glp1: () => ({ code: "semaglutide", dose: 0.25, frequency: "Weekly", why: "SmPC start for 4 weeks, then 0.5 mg weekly (Ozempic SmPC)" }),
  // Mounjaro SmPC: 2.5 mg once weekly for 4 weeks, then 5 mg
  tirzepatide: () => ({ code: "tirzepatide", dose: 2.5, frequency: "Weekly", why: "SmPC start for 4 weeks, then 5 mg weekly (Mounjaro SmPC)" }),
  // Kerendia SmPC: eGFR ≥60 20 mg, 25–59 10 mg; not started below 25 or with K >5.0
  finerenone: (c) => {
    const e = v(c, "egfr"), k = v(c, "potassium");
    if (e == null) return "No eGFR in the record: the finerenone starting dose depends on it (SmPC)";
    if (e < 25) return `eGFR ${Math.round(e)} <25: finerenone is not started (SmPC)`;
    if (k != null && k > 5.0) return `K ${k} >5.0: finerenone is not started (SmPC)`;
    return { code: "finerenone", dose: e >= 60 ? 20 : 10, frequency: "OD", why: `eGFR ${Math.round(e)}: ${e >= 60 ? "20" : "10"} mg starting dose; potassium at 4 weeks (Kerendia SmPC)` };
  },
  // ADA 2026: start 500 mg once or twice daily with food; label: not below eGFR 30, maximum 1000 mg/day at 30–44
  metformin: (c) => { const e = v(c, "egfr"); return e != null && e < 30 ? `eGFR ${Math.round(e)} <30: metformin is not started (label)` : { code: "metformin", dose: 500, frequency: "OD", why: `start low with food and titrate (ADA 2026)${e != null && e < 45 ? `; eGFR ${Math.round(e)}: maximum 1000 mg/day (label)` : ""}` }; },
  // Trajenta SmPC: 5 mg once daily, no renal adjustment
  dpp4: () => ({ code: "linagliptin", dose: 5, frequency: "OD", why: "label dose, no renal adjustment (Trajenta SmPC)" }),
  // Diamicron MR SmPC: start 30 mg once daily with breakfast
  gliclazide: () => ({ code: "gliclazide", dose: 30, frequency: "OD", why: "SmPC starting dose with breakfast; hypoglycaemia advice" }),
  // ESC HF 2021 diuretic table: furosemide starting dose 20–40 mg
  loop: () => ({ code: "furosemide", dose: 40, frequency: "OD", why: "within the ESC HF 2021 starting range 20–40 mg; adjust to weight and congestion" }),
  // ESC HF practical guidance on MRA: spironolactone 25 mg (12.5 mg with eGFR 30–49); not below eGFR 30 or with K >5.0
  mra: (c) => {
    const e = v(c, "egfr"), k = v(c, "potassium");
    if (k != null && k > 5.0) return `K ${k} >5.0: an MRA is not started (ESC HF practical guidance)`;
    if (e != null && e < 30) return `eGFR ${Math.round(e)} <30: an MRA is not started (ESC HF practical guidance)`;
    return { code: "spironolactone", dose: e != null && e < 50 ? 12.5 : 25, frequency: "OD", why: `${e != null && e < 50 ? `eGFR ${Math.round(e)} 30–49: 12.5 mg` : "25 mg"} starting dose; potassium and creatinine at 1 and 4 weeks (ESC HF practical guidance)` };
  },
  // pantoprazole 40 mg once daily with combined antithrombotic therapy (ESC ACS 2023; label dose)
  ppi: () => ({ code: "pantoprazole", dose: 40, frequency: "OD", why: "gastroprotection with antithrombotic therapy (ESC 2023; label dose)" }),
};

// a start item, or a note saying why the label does not allow it; nothing when the class is already taken
export function startItem(key: string, c: WizardContext, indication: string, tag?: string): OutcomeItem | null {
  if (tag && c.meds.some((m) => m.tags.includes(tag) && m.status !== "stopped")) return null;
  const s = START[key]?.(c);
  if (!s) return null;
  if (typeof s === "string") return { kind: "note", label: s };
  const def = MEDICATION[s.code];
  const freq = s.frequency === "OD" ? "once daily" : s.frequency === "BID" ? "twice daily" : s.frequency === "Weekly" ? "once weekly" : s.frequency;
  return { kind: "start", code: s.code, doseValue: s.dose, frequency: s.frequency, indication, label: `${def?.name ?? s.code} ${doseLabel(def, s.dose, def?.unit ?? "mg")} ${freq}: start — ${s.why}` };
}

// high-intensity statin (ESC/EAS 2019/2025: atorvastatin 40–80 mg, rosuvastatin 20–40 mg): the next dose that
// reaches it from the current one; other statins are switched to atorvastatin 40 mg
export function statinUp(c: WizardContext): OutcomeItem[] {
  const st = c.meds.find((m) => m.tags.includes("statin"));
  if (!st) return [];
  const e = v(c, "egfr");
  const target = st.code === "atorvastatin" ? (st.doseValue != null && st.doseValue >= 40 ? 80 : 40) : st.code === "rosuvastatin" ? (st.doseValue != null && st.doseValue >= 20 ? (e != null && e < 30 ? null : 40) : 20) : null;
  if (target != null && st.doseValue != null && target > st.doseValue)
    return [{ kind: "medication", medicationId: st.id, event: "increase", doseValue: target, label: `${st.name}: ${st.doseValue} mg → ${target} mg — high intensity (ESC/EAS: atorvastatin 40–80 mg, rosuvastatin 20–40 mg)` }];
  if (target == null && st.code !== "atorvastatin" && st.code !== "rosuvastatin")
    return [{ kind: "medication", medicationId: st.id, event: "stop", doseValue: null, label: `${st.name}: stop — switch to a high-intensity statin` },
      { kind: "start", code: "atorvastatin", doseValue: 40, frequency: "OD", indication: "cad", label: "Atorvastatin 40 mg once daily: start — high intensity (ESC/EAS)" }];
  return [{ kind: "note", label: `${st.name} ${st.doseValue ?? ""} mg is already the highest intensity this patient can take${e != null && e < 30 && st.code === "rosuvastatin" ? " (rosuvastatin 40 mg is contraindicated with eGFR <30)" : ""}: consider ezetimibe` }];
}
