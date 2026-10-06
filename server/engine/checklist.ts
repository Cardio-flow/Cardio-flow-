// Checklists before a procedure (workflow redesign, slice 7): one list per procedure, each line read from the
// record — ticked when the record shows it, flagged when it needs attention, open when it is not recorded.
// Thresholds are guideline or product-label values only; recency is shown as the date, never judged against a
// locally chosen number. Sources:
//  - Contrast (angiography / PCI): ESC 2018 myocardial revascularisation — hydration with isotonic saline in
//    moderate-to-severe CKD (I C); metformin label (SmPC 4.4): stop at or before iodinated contrast with eGFR
//    30–60 (and below 30 metformin is contraindicated), restart ≥48 h later if renal function is stable.
//  - Cardioversion of AF: ESC AF 2024 — therapeutic oral anticoagulation for ≥3 weeks before elective
//    cardioversion, or imaging to exclude thrombus (I B); VKA INR target 2.0–3.0.
//  - AF ablation: ESC AF 2024 — uninterrupted oral anticoagulation in patients undergoing ablation (I A).
//  - Device implantation: ESC 2021 pacing — antibiotic prophylaxis within 1 h of incision (I A); continue
//    uninterrupted VKA rather than heparin bridging (heparin bridging not recommended, III).
import { DIAGNOSIS, MEASURES, formatNumber } from "../../shared/catalog.js";
import { daysBetween, flagFor, fmtDay } from "../../shared/clinical.js";
import { latestStudy, type PatientState } from "../kernel/state.js";

export type CheckKind = "pci" | "cardioversion" | "ablation" | "device";
export const CHECK_TITLE: Record<CheckKind, string> = {
  pci: "Before coronary angiography / PCI",
  cardioversion: "Before cardioversion of AF",
  ablation: "Before AF ablation",
  device: "Before device implantation",
};
export type CheckItem = {
  key: string; label: string;
  status: "ok" | "flag" | "missing" | "info";
  value?: string; date?: string; why?: string; source?: string;
  action?: { type: "add-labs"; codes: string[]; label: string } | { type: "wizard"; wizard: string; label: string };
};

const ago = (d: number) => (d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);
const live = (s: PatientState) => s.meds.filter((m) => m.status === "active" || m.status === "held");

function lab(s: PatientState, code: string, label?: string): CheckItem {
  const c = s.resolved(code).current;
  const def = MEASURES[code];
  const name = label ?? def?.display ?? code;
  if (!c || c.value_num == null) return { key: code, label: name, status: "missing", why: "Not recorded", action: { type: "add-labs", codes: [code === "egfr" ? "creatinine" : code], label: "Enter result" } };
  const flag = flagFor(c.value_num, def?.ref);
  return {
    key: code, label: name, status: flag ? "flag" : "ok",
    value: `${formatNumber(c.value_num, def?.decimals ?? 0)} ${def?.unit ?? ""}`.trim(), date: c.effective_at,
    why: `${ago(daysBetween(c.effective_at, s.today))}${flag ? ` · ${flag === "high" ? "above" : "below"} the reference range` : ""}`,
  };
}

export function checklist(s: PatientState, kind: CheckKind): { title: string; items: CheckItem[] } {
  const meds = live(s);
  const oac = meds.filter((m) => m.tags.includes("oac"));
  const vka = meds.find((m) => m.tags.includes("vka"));
  const antiplatelets = meds.filter((m) => m.tags.includes("antiplatelet"));
  const egfr = s.resolved("egfr").current?.value_num ?? null;
  const items: CheckItem[] = [lab(s, "haemoglobin"), lab(s, "platelets"), lab(s, "egfr", "Renal function (eGFR)"), lab(s, "potassium")];
  if (vka) {
    const inr = lab(s, "inr");
    if (inr.status === "ok" && s.resolved("inr").current!.value_num! < 2) { inr.status = "flag"; inr.why += " · below 2.0"; }
    items.push(inr);
  }
  const allergies = s.patient.allergies;
  items.push({ key: "allergies", label: "Allergies", status: allergies && allergies !== "Not recorded" ? "ok" : "missing", value: allergies && allergies !== "Not recorded" ? allergies : undefined, why: allergies && allergies !== "Not recorded" ? undefined : "Not recorded — ask about contrast, latex, antibiotics" });

  if (kind === "pci") {
    if (egfr != null && egfr < 60)
      items.push({ key: "hydration", label: "Contrast: hydration", status: "flag", value: `eGFR ${Math.round(egfr)}`, why: "Moderate-to-severe CKD: hydration with isotonic saline is recommended; keep contrast volume low.", source: "ESC myocardial revascularisation 2018 · I C" });
    const metformin = meds.find((m) => m.code === "metformin");
    if (metformin)
      items.push({
        key: "metformin", label: "Metformin", status: egfr != null && egfr <= 60 ? "flag" : "info", value: metformin.name,
        why: egfr == null ? "Check eGFR: with eGFR 30–60, stop at or before contrast and restart ≥48 h later if renal function is stable." : egfr <= 60 ? `eGFR ${Math.round(egfr)}: stop at or before contrast; restart ≥48 h later if renal function is stable.` : "eGFR >60: no interruption needed for contrast.",
        source: "SmPC metformin 4.4",
      });
    items.push(oac.length
      ? { key: "oac", label: "Anticoagulant", status: "flag", value: oac.map((m) => m.name).join(", "), why: "Plan the peri-procedural anticoagulation and, after PCI, the combined antithrombotic regimen.", action: { type: "wizard", wizard: "pre-procedure", label: "Plan interruption" } }
      : { key: "oac", label: "Anticoagulant", status: "ok", value: "None" });
    items.push({ key: "antiplatelet", label: "Antiplatelet therapy", status: antiplatelets.length ? "ok" : "info", value: antiplatelets.length ? antiplatelets.map((m) => m.name).join(", ") : "None on the list", why: antiplatelets.length ? undefined : "Loading is given in the cath lab per local protocol (CardioFlow does not dose loading)." });
  }

  if (kind === "cardioversion") {
    const af = s.conditions.find((c) => c.code === "af" || c.code === "flutter");
    if (!oac.length)
      items.push({ key: "oac", label: "Anticoagulation ≥3 weeks or imaging", status: "flag", value: "No anticoagulant", why: "Elective cardioversion needs ≥3 weeks of therapeutic anticoagulation before, or imaging (TOE) to exclude thrombus.", source: "ESC AF 2024 · I B", action: { type: "wizard", wizard: "peri-af-procedure", label: "Plan anticoagulation" } });
    else
      for (const m of oac) {
        const d = m.startedAt ? daysBetween(m.startedAt, s.today) : null;
        items.push({
          key: "oac-" + m.id, label: "Anticoagulation ≥3 weeks or imaging", status: d != null && d >= 21 ? "ok" : "flag",
          value: `${m.name}${m.startedAt ? ` since ${fmtDay(m.startedAt, { year: true })}` : ""}`,
          why: d == null ? "Start date not recorded." : d >= 21 ? `${d} days${vka ? "; INR must have been therapeutic (2.0–3.0) throughout" : ""}. Ask about missed doses.` : `${d} days: less than 3 weeks — TOE before cardioversion, or wait.`,
          source: "ESC AF 2024 · I B", action: { type: "wizard", wizard: "peri-af-procedure", label: "Plan anticoagulation" },
        });
      }
    if (meds.some((m) => m.tags.includes("digoxin"))) items.push(lab(s, "digoxin-level", "Digoxin level"));
    items.push({ key: "af", label: "AF type", status: af ? "ok" : "missing", value: af ? `${DIAGNOSIS[af.code]?.display ?? af.code}${af.attributes?.type ? ` · ${af.attributes.type}` : ""}` : undefined, why: af ? undefined : "AF not on the problem list" });
  }

  if (kind === "ablation") {
    items.push(oac.length
      ? { key: "oac", label: "Uninterrupted anticoagulation", status: "ok", value: oac.map((m) => m.name).join(", "), why: "Keep oral anticoagulation uninterrupted through the ablation.", source: "ESC AF 2024 · I A", action: { type: "wizard", wizard: "peri-af-procedure", label: "Plan anticoagulation" } }
      : { key: "oac", label: "Uninterrupted anticoagulation", status: "flag", value: "No anticoagulant", why: "Ablation is done on uninterrupted oral anticoagulation; start and plan the peri-procedural course.", source: "ESC AF 2024 · I A", action: { type: "wizard", wizard: "peri-af-procedure", label: "Plan anticoagulation" } });
    const echo = latestStudy(s, "echo", 100000);
    items.push(echo
      ? { key: "echo", label: "Echo (LV function, LA)", status: "ok", value: echo.attributes?.lvef != null ? `LVEF ${echo.attributes.lvef}%` : "recorded", date: echo.performed_at, why: ago(daysBetween(echo.performed_at, s.today)) }
      : { key: "echo", label: "Echo (LV function, LA)", status: "missing", why: "No echo on record." });
    items.push(lab(s, "tsh", "TSH"));
  }

  if (kind === "device") {
    items.push({ key: "antibiotic", label: "Antibiotic prophylaxis", status: "info", why: "Within 1 hour of incision (local protocol for the agent; CardioFlow does not dose antibiotics).", source: "ESC pacing 2021 · I A" });
    if (vka) items.push({ key: "vka", label: "Warfarin: continue, no heparin bridging", status: "info", value: vka.name, why: "Uninterrupted VKA is preferred; heparin bridging is not recommended (haematoma).", source: "ESC pacing 2021" });
    else if (oac.length) items.push({ key: "oac", label: "Anticoagulant", status: "flag", value: oac.map((m) => m.name).join(", "), why: "Plan the peri-procedural interruption.", action: { type: "wizard", wizard: "pre-procedure", label: "Plan interruption" } });
    if (antiplatelets.length > 1) items.push({ key: "dapt", label: "Dual antiplatelet therapy", status: "flag", value: antiplatelets.map((m) => m.name).join(", "), why: "Higher pocket-haematoma risk: weigh the timing against the indication for DAPT." });
    items.push(lab(s, "crp", "CRP (active infection)"));
  }
  return { title: CHECK_TITLE[kind], items };
}
