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
//  - Valve intervention (audit finish, 6 Oct): ESC/EACTS 2025 — Heart Team decision (I C); coronary
//    assessment before intervention (angiography or CCTA); CT for TAVI planning. ESC endocarditis 2023 —
//    potential dental sources of sepsis eliminated before prosthetic valve implantation (I C).
//  - CABG (audit, 7 Oct): ESC myocardial revascularisation 2018 / ESC ACS 2023 — continue low-dose aspirin;
//    stop ticagrelor ≥3 days, clopidogrel ≥5 days, prasugrel ≥7 days before elective CABG (IIa B); LV function
//    by echo; glycaemic status (HbA1c).
//  - Pericardiocentesis: ESC pericardial diseases 2015 — echo (or fluoroscopy) guided; anticoagulation and
//    platelets checked before an elective procedure.
//  - Right heart catheterisation: ESC/ERS 2022 PH — echocardiography first (probability of PH); RHC in a PH
//    centre; V/Q scan to look for CTEPH in unexplained PH (I C).
import { DIAGNOSIS, MEASURES, formatNumber } from "../../shared/catalog.js";
import { daysBetween, flagFor, fmtDay } from "../../shared/clinical.js";
import { latestStudy, type PatientState } from "../kernel/state.js";
import { latestPhEcho } from "./ph-profile.js";
import type { CheckKind } from "../../shared/procedures.js";
export type { CheckKind };

export const CHECK_TITLE: Record<CheckKind, string> = {
  pci: "Before coronary angiography / PCI",
  cardioversion: "Before cardioversion of AF",
  ablation: "Before AF ablation",
  device: "Before device implantation",
  valve: "Before a valve intervention",
  rhc: "Before right heart catheterisation",
  cabg: "Before coronary bypass surgery (CABG)",
  pericardiocentesis: "Before pericardiocentesis",
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
  if (kind === "valve") {
    const team = s.pathwaysDone["valve-heart-team"];
    items.push(team
      ? { key: "team", label: "Heart Team decision", status: "ok", date: team, why: ago(daysBetween(team, s.today)), source: "ESC/EACTS 2025 · I C" }
      : { key: "team", label: "Heart Team decision", status: "flag", why: "Not recorded: the intervention follows a Heart Team decision.", source: "ESC/EACTS 2025 · I C", action: { type: "wizard", wizard: "valve-heart-team", label: "Heart Team" } });
    const echo = latestStudy(s, "echo", 100000);
    items.push(echo
      ? { key: "echo", label: "Echo", status: "ok", value: echo.attributes?.lvef != null ? `LVEF ${echo.attributes.lvef}%` : "recorded", date: echo.performed_at, why: ago(daysBetween(echo.performed_at, s.today)) }
      : { key: "echo", label: "Echo", status: "missing", why: "No echo on record." });
    const cor = [latestStudy(s, "cath", 100000), latestStudy(s, "ccta", 100000)].filter(Boolean).sort((a, b) => (a!.performed_at < b!.performed_at ? 1 : -1))[0];
    items.push(cor
      ? { key: "coronary", label: "Coronary assessment", status: "ok", value: cor.kind === "ccta" ? "CT coronary angiography" : "Coronary angiography", date: cor.performed_at, why: ago(daysBetween(cor.performed_at, s.today)) }
      : { key: "coronary", label: "Coronary assessment", status: "missing", why: "No coronary angiography or CCTA on record: coronary assessment before the intervention.", source: "ESC/EACTS 2025" });
    items.push({ key: "ct", label: "CT for TAVI planning", status: "info", why: "TAVI: CT of the annulus and the access route." });
    items.push({ key: "dental", label: "Dental check", status: "info", why: "Eliminate potential dental sources of sepsis before a prosthetic valve is implanted.", source: "ESC endocarditis 2023 · I C" });
    items.push(oac.length
      ? { key: "oac", label: "Anticoagulant", status: "flag", value: oac.map((m) => m.name).join(", "), why: "Plan the peri-procedural anticoagulation; afterwards the valve antithrombotic pathway sets the regimen.", action: { type: "wizard", wizard: "pre-procedure", label: "Plan interruption" } }
      : { key: "oac", label: "Anticoagulant", status: "ok", value: "None" });
  }

  if (kind === "rhc") {
    const ph = latestPhEcho(s);
    const echo = latestStudy(s, "echo", 100000);
    items.push(ph
      ? { key: "echo", label: "Echo: probability of PH", status: "ok", value: `${ph.probability} probability${ph.trv != null ? ` · TRV ${ph.trv} m/s` : ""}`, date: ph.at, why: ago(daysBetween(ph.at, s.today)), source: "ESC/ERS 2022" }
      : echo
      ? { key: "echo", label: "Echo: probability of PH", status: "flag", date: echo.performed_at, why: "The latest echo does not record TR velocity or PH signs: the probability of PH is not set.", source: "ESC/ERS 2022" }
      : { key: "echo", label: "Echo: probability of PH", status: "missing", why: "Echo first: it sets the probability of PH.", source: "ESC/ERS 2022" });
    const pe = s.conditions.some((c) => c.code === "pe");
    items.push({ key: "vq", label: "V/Q scan (CTEPH)", status: pe ? "flag" : "info", why: pe ? "Previous pulmonary embolism: V/Q scan for chronic thromboembolic disease." : "In unexplained PH, a V/Q scan looks for CTEPH.", source: "ESC/ERS 2022 · I C" });
    items.push({ key: "centre", label: "PH centre", status: "info", why: "Right heart catheterisation is done in a PH centre, with a standardised protocol.", source: "ESC/ERS 2022" });
    if (oac.length) items.push({ key: "oac", label: "Anticoagulant", status: "flag", value: oac.map((m) => m.name).join(", "), why: "Venous access: plan the peri-procedural anticoagulation with the PH centre." });
  }
  if (kind === "cabg") {
    const asa = meds.find((m) => m.code === "aspirin");
    items.push(asa ? { key: "aspirin", label: "Aspirin", status: "ok", value: asa.name, why: "Continue low-dose aspirin through surgery.", source: "ESC revascularisation 2018" }
      : { key: "aspirin", label: "Aspirin", status: "info", value: "Not on the list", why: "Low-dose aspirin is continued through CABG." });
    const P2: Record<string, number> = { ticagrelor: 3, clopidogrel: 5, prasugrel: 7 };
    for (const m of meds.filter((x) => P2[x.code]))
      items.push({ key: "p2y12-" + m.id, label: `${m.name}: stop before elective surgery`, status: "flag", value: `≥${P2[m.code]} days before`, why: "Interrupt before elective CABG; urgent surgery is decided with the surgical team.", source: "ESC ACS 2023 · IIa B" });
    if (oac.length) items.push({ key: "oac", label: "Anticoagulant", status: "flag", value: oac.map((m) => m.name).join(", "), why: "Plan the interruption.", action: { type: "wizard", wizard: "pre-procedure", label: "Plan interruption" } });
    const echo = latestStudy(s, "echo", 100000);
    items.push(echo
      ? { key: "echo", label: "Echo (LV function)", status: "ok", value: echo.attributes?.lvef != null ? `LVEF ${echo.attributes.lvef}%` : "recorded", date: echo.performed_at, why: ago(daysBetween(echo.performed_at, s.today)) }
      : { key: "echo", label: "Echo (LV function)", status: "missing", why: "No echo on record." });
    items.push(lab(s, "hba1c", "HbA1c (glycaemic status)"));
  }

  if (kind === "pericardiocentesis") {
    const echo = latestStudy(s, "echo", 100000);
    items.push(echo
      ? { key: "echo", label: "Echo (effusion size and site)", status: "ok", date: echo.performed_at, why: `${ago(daysBetween(echo.performed_at, s.today))} · echo-guided procedure` }
      : { key: "echo", label: "Echo (effusion size and site)", status: "missing", why: "Echo guides the procedure.", source: "ESC pericardial 2015" });
    if (oac.length) items.push({ key: "oac", label: "Anticoagulant", status: "flag", value: oac.map((m) => m.name).join(", "), why: "Elective procedure: plan the interruption; tamponade is not delayed for it." });
    if (antiplatelets.length) items.push({ key: "ap", label: "Antiplatelet therapy", status: "info", value: antiplatelets.map((m) => m.name).join(", "), why: "Weigh against the indication with the team." });
  }
  return { title: CHECK_TITLE[kind], items };
}
