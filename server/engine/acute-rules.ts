// Rules that open the acute and safety pathways. Every number is a governed parameter; all
// start in CLINICAL_REVIEW (sandbox only). Sources are listed in shared/wizards-acute.ts.
import { formatNumber, MEASURES } from "../../shared/catalog.js";
import { daysBetween, fmtDay } from "../../shared/clinical.js";
import { series, type Obs, type PatientState } from "../kernel/state.js";
import type { Fact, Finding, RuleDef } from "./rules.js";

const within = (s: PatientState, code: string, days: number): Obs | null => {
  const c = s.resolved(code).current;
  return c && c.value_num != null && daysBetween(c.effective_at, s.today) <= days ? c : null;
};
const f = (o: Obs | null, tone?: Fact["tone"]): Fact | null =>
  o ? { label: MEASURES[o.code]?.display ?? o.code, value: `${formatNumber(o.value_num!, MEASURES[o.code]?.decimals ?? 0)} ${MEASURES[o.code]?.unit ?? ""}`.trim(), date: o.effective_at, tone } : null;
const facts = (...xs: (Fact | null | undefined | false)[]) => xs.filter(Boolean) as Fact[];
const on = (s: PatientState, ...tags: string[]) => s.meds.filter((m) => m.status === "active" && m.tags.some((t) => tags.includes(t)));
const one = (x: Finding | null) => (x ? [x] : []);
const src = (value: string): Fact => ({ label: "Guideline", value });

export const ACUTE_RULES: RuleDef[] = [
  {
    id: "acute.shock",
    kind: "clinical",
    title: "Possible shock",
    inputs: ["sbp", "lactate"],
    defaultParams: { sbp_below: 90, lactate_min: 2, lactate_alone: 4, days: 2 },
    evidence: "SCAI SHOCK 2022; Surviving Sepsis 2021: hypotension with raised lactate, or lactate ≥4 mmol/L, indicates hypoperfusion.",
    evaluate(s, p) {
      const sbp = within(s, "sbp", p.days), lac = within(s, "lactate", p.days);
      const hypo = sbp && sbp.value_num! < p.sbp_below;
      if (!lac || !((hypo && lac.value_num! >= p.lactate_min) || lac.value_num! >= p.lactate_alone)) return [];
      return [{
        key: "shock", signature: `${sbp?.id ?? ""}:${lac.id}`, severity: "red",
        title: `Possible shock: ${hypo ? `SBP ${formatNumber(sbp!.value_num!, 0)} mmHg, ` : ""}lactate ${formatNumber(lac.value_num!, 1)} mmol/L`,
        detail: "Decide the type and SCAI stage; support perfusion and treat the cause.",
        facts: facts(f(sbp, hypo ? "red" : undefined), f(lac, "red"), f(within(s, "hr", p.days)), src("SCAI SHOCK 2022")),
        missing: [], action: { type: "wizard", wizard: "shock" },
      }];
    },
  },
  {
    id: "acute.sepsis-screen",
    kind: "clinical",
    title: "Possible sepsis",
    inputs: ["temp", "hr", "rr", "sbp", "lactate", "wbc"],
    defaultParams: { temp_high: 38, temp_low: 36, hr_above: 90, rr_min: 22, sbp_max: 100, lactate_min: 2, wbc_high: 12, wbc_low: 4, days: 2 },
    evidence: "Surviving Sepsis Campaign 2021: screen patients with suspected infection; abnormal temperature with tachycardia, tachypnoea, hypotension, raised lactate or abnormal WBC should prompt the hour-1 bundle.",
    evaluate(s, p) {
      const t = within(s, "temp", p.days);
      if (!t || !(t.value_num! >= p.temp_high || t.value_num! <= p.temp_low)) return [];
      const hr = within(s, "hr", p.days), rr = within(s, "rr", p.days), sbp = within(s, "sbp", p.days), lac = within(s, "lactate", p.days), wbc = within(s, "wbc", p.days);
      const hits = [
        hr && hr.value_num! > p.hr_above && f(hr, "orange"),
        rr && rr.value_num! >= p.rr_min && f(rr, "orange"),
        sbp && sbp.value_num! <= p.sbp_max && f(sbp, "orange"),
        lac && lac.value_num! >= p.lactate_min && f(lac, "red"),
        wbc && (wbc.value_num! > p.wbc_high || wbc.value_num! < p.wbc_low) && f(wbc, "orange"),
      ].filter(Boolean) as Fact[];
      if (!hits.length) return [];
      const device = s.conditions.some((c) => c.code === "prosthetic-valve" || c.code === "cied");
      return [{
        key: "sepsis", signature: `${t.id}:${hits.length}`, severity: "red",
        title: `Possible sepsis: temperature ${formatNumber(t.value_num!, 1)} °C with ${hits.length} other sign${hits.length === 1 ? "" : "s"}`,
        detail: `Hour-1 bundle: lactate, cultures before antibiotics, antibiotics, fluids with reassessment.${device ? " Prosthetic valve or device: think endocarditis (3 blood culture sets, Echo/TOE)." : ""}`,
        facts: facts(f(t, "red"), ...hits, src("Surviving Sepsis Campaign 2021")),
        missing: [!lac && "Lactate", !wbc && "White cell count"].filter(Boolean) as string[],
        action: { type: "wizard", wizard: "sepsis" },
      }];
    },
  },
  {
    id: "dm.hyperglycaemic-crisis",
    kind: "clinical",
    title: "Hyperglycaemic crisis (DKA / HHS)",
    inputs: ["glucose", "ketones", "bicarbonate", "ph", "meds", "conditions"],
    defaultParams: { ketones_min: 3, bicarb_below: 18, ph_below: 7.3, glucose_dka: 11.1, glucose_hhs: 33.3, days: 2 },
    evidence: "ADA/EASD hyperglycaemic crises consensus 2024: DKA = diabetes or glucose ≥11.1 mmol/L + β-hydroxybutyrate ≥3.0 + pH <7.3 and/or bicarbonate <18; euglycaemic DKA on SGLT2 inhibitors; HHS glucose ≥33.3 mmol/L.",
    evaluate(s, p) {
      const k = within(s, "ketones", p.days), hco3 = within(s, "bicarbonate", p.days), ph = within(s, "ph", p.days), glu = within(s, "glucose", p.days);
      const acid = (hco3 && hco3.value_num! < p.bicarb_below) || (ph && ph.value_num! < p.ph_below);
      const sglt2 = on(s, "sglt2");
      if (k && k.value_num! >= p.ketones_min && acid) {
        const eu = sglt2.length > 0 && (!glu || glu.value_num! < p.glucose_dka);
        return [{
          key: "dka", signature: `${k.id}:${hco3?.id ?? ph?.id}`, severity: "red",
          title: eu ? "Euglycaemic DKA on an SGLT2 inhibitor" : "Diabetic ketoacidosis",
          detail: "Emergency DKA protocol; stop the SGLT2 inhibitor; find the trigger.",
          facts: facts(f(k, "red"), f(hco3), f(ph), f(glu), ...sglt2.map((m) => ({ label: "SGLT2 inhibitor", value: m.name })), src("ADA/EASD hyperglycaemic crises 2024")),
          missing: [], action: { type: "wizard", wizard: "hyperglycaemia" },
        }];
      }
      if (glu && glu.value_num! >= p.glucose_hhs)
        return [{
          key: "hhs", signature: glu.id, severity: "red", title: `Glucose ${formatNumber(glu.value_num!, 1)} mmol/L: exclude HHS / DKA`,
          detail: "Check ketones, bicarbonate/pH, sodium and osmolality.", facts: facts(f(glu, "red"), f(k), f(hco3), src("ADA/EASD hyperglycaemic crises 2024")),
          missing: [!k && "Ketones", !hco3 && "Bicarbonate"].filter(Boolean) as string[], action: { type: "wizard", wizard: "hyperglycaemia" },
        }];
      // an HbA1c above target (including "uncontrolled") is dm.glycaemic-control
      return [];
    },
  },
  {
    id: "dm.hypoglycaemia",
    kind: "clinical",
    title: "Hypoglycaemia",
    inputs: ["glucose", "meds"],
    defaultParams: { level1: 3.9, level2: 3.0, days: 7 },
    evidence: "ADA Standards of Care 2026: level 1 glucose <3.9 mmol/L, level 2 <3.0 mmol/L.",
    evaluate(s, p) {
      const g = within(s, "glucose", p.days);
      if (!g || g.value_num! >= p.level1) return [];
      const culprits = on(s, "sulfonylurea", "insulin");
      return [{
        key: "hypo", signature: g.id, severity: g.value_num! < p.level2 ? "red" : "orange",
        title: `Hypoglycaemia ${formatNumber(g.value_num!, 1)} mmol/L (level ${g.value_num! < p.level2 ? 2 : 1})${culprits.length ? ` on ${culprits.map((m) => m.name.toLowerCase()).join(" and ")}` : ""}`,
        detail: "Treat now; then find the cause and reduce the culprit drug.", facts: facts(f(g, "red"), f(within(s, "egfr", 180)), ...culprits.map((m) => ({ label: m.drugClass, value: m.name })), src("ADA Standards of Care 2026")),
        missing: [], action: { type: "wizard", wizard: "hypoglycaemia" },
      }];
    },
  },
  {
    id: "safety.bleeding",
    kind: "clinical",
    title: "Haemoglobin fall on antithrombotic therapy",
    inputs: ["haemoglobin", "meds"],
    defaultParams: { drop_g_dl: 2, days: 30 },
    evidence: "A haemoglobin fall ≥2 g/dL is a major-bleeding criterion (ISTH/BARC); on antithrombotics it prompts a bleeding assessment (EHRA NOAC guide 2021).",
    evaluate(s, p) {
      const agents = on(s, "antiplatelet", "oac");
      if (!agents.length) return [];
      const hb = series(s, "haemoglobin").filter((o) => daysBetween(o.effective_at, s.today) <= p.days);
      if (hb.length < 2) return [];
      const top = hb.slice(1).reduce((a, b) => (b.value_num! > a.value_num! ? b : a));
      const drop = top.value_num! - hb[0].value_num!;
      if (drop < p.drop_g_dl) return [];
      return one({
        key: "hb-drop", signature: hb[0].id, severity: "orange",
        title: `Haemoglobin down ${formatNumber(drop, 1)} g/dL on ${agents.map((m) => m.name.toLowerCase()).join(" and ")}`,
        detail: "Look for bleeding; decide hold, reversal and the restart plan.",
        facts: facts({ label: "Haemoglobin", value: `${formatNumber(top.value_num!, 1)} → ${formatNumber(hb[0].value_num!, 1)} g/dL`, date: hb[0].effective_at, tone: "orange" }, f(within(s, "platelets", 30)), f(within(s, "inr", 30)), src("EHRA NOAC guide 2021")),
        missing: [], action: { type: "wizard", wizard: "bleeding" },
      });
    },
  },
  {
    id: "safety.low-potassium",
    kind: "clinical",
    title: "Low potassium / magnesium",
    inputs: ["potassium", "magnesium"],
    defaultParams: { k_below: 3.5, k_severe: 3.0, mg_below: 0.7, days: 14 },
    evidence: "ESC HF practical guidance: low K and Mg increase arrhythmic risk, particularly with diuretics and digoxin; replace and address the cause.",
    evaluate(s, p) {
      const k = within(s, "potassium", p.days), mg = within(s, "magnesium", p.days);
      const lowK = k && k.value_num! < p.k_below, lowMg = mg && mg.value_num! < p.mg_below;
      if (!lowK && !lowMg) return [];
      const severe = lowK && k!.value_num! < p.k_severe;
      return [{
        key: "low-k", signature: `${k?.id ?? ""}:${mg?.id ?? ""}`, severity: severe ? "red" : "orange",
        title: [lowK ? `Potassium ${formatNumber(k!.value_num!, 1)} mmol/L` : null, lowMg ? `magnesium ${formatNumber(mg!.value_num!, 2)} mmol/L` : null].filter(Boolean).join(", ") + " low",
        detail: on(s, "digoxin").length ? "On digoxin: toxicity risk rises with low K." : "Replace and address diuretic or GI losses.",
        facts: facts(f(k, lowK ? "orange" : undefined), f(mg, lowMg ? "orange" : undefined), ...on(s, "loop", "thiazide", "digoxin").map((m) => ({ label: m.drugClass, value: m.name })), src("ESC HF practical guidance")),
        missing: mg ? [] : ["Magnesium"], action: { type: "wizard", wizard: "low-potassium" },
      }];
    },
  },
  {
    id: "safety.hyponatraemia",
    kind: "clinical",
    title: "Low sodium",
    inputs: ["sodium"],
    defaultParams: { na_below: 130, na_severe: 125, days: 14 },
    evidence: "ESC HF 2021/2026: hyponatraemia in HF is common and prognostic; assess volume, stop thiazides, restrict fluid in hypervolaemia. Severity bands (moderate 125–129, profound <125 mmol/L) from the European hyponatraemia guideline (ESE/ESICM/ERA-EDTA 2014).",
    evaluate(s, p) {
      const na = within(s, "sodium", p.days);
      if (!na || na.value_num! >= p.na_below) return [];
      return [{
        key: "na", signature: na.id, severity: na.value_num! < p.na_severe ? "red" : "orange",
        title: `Sodium ${formatNumber(na.value_num!, 0)} mmol/L`,
        detail: "Judge volume first; stop thiazides; correct slowly.",
        facts: facts(f(na, "orange"), f(within(s, "creatinine", 30)), ...on(s, "thiazide", "loop").map((m) => ({ label: m.drugClass, value: m.name })), src("ESC HF · hyponatraemia")),
        missing: [], action: { type: "wizard", wizard: "hyponatraemia" },
      }];
    },
  },
  {
    id: "safety.inr",
    kind: "clinical",
    title: "INR out of range on warfarin",
    inputs: ["inr", "meds", "conditions"],
    defaultParams: { low: 2.0, high: 3.0, valve_low: 2.5, valve_high: 3.5, very_high: 9, days: 14 },
    evidence: "Warfarin target INR 2.0–3.0 for AF; mechanical valves need a higher, prosthesis-specific target (ESC/EACTS 2025; range 2.5–3.5 used here pending review). INR >9 without bleeding needs same-day action (ACCP).",
    evaluate(s, p) {
      if (!on(s, "oac").some((m) => m.code === "warfarin")) return [];
      const inr = within(s, "inr", p.days);
      if (!inr) return [];
      const valve = s.tags.has("mechanical-valve");
      const lo = valve ? p.valve_low : p.low, hi = valve ? p.valve_high : p.high;
      const v = inr.value_num!;
      if (v >= lo && v <= hi) return [];
      const high = v > hi;
      return [{
        key: "inr", signature: inr.id, severity: high ? (v > p.very_high ? "red" : "orange") : valve ? "red" : "yellow",
        title: `INR ${formatNumber(v, 1)} ${high ? "above" : "below"} target ${lo}–${hi}${valve ? " (mechanical valve)" : ""}`,
        detail: high ? "Check for bleeding and interacting drugs; omit/adjust per anticoagulation clinic." : valve ? "Sub-therapeutic with a mechanical valve: adjust today and consider bridging." : "Check adherence and interactions; adjust the dose.",
        facts: facts(f(inr, high ? "orange" : "yellow"), f(within(s, "haemoglobin", 30)), src(valve ? "ESC/EACTS VHD 2025" : "EHRA VKA guidance")),
        missing: [], action: { type: "wizard", wizard: "inr" },
      }];
    },
  },
  {
    id: "safety.digoxin",
    kind: "clinical",
    title: "Digoxin toxicity risk",
    inputs: ["digoxin-level", "potassium", "egfr", "meds"],
    defaultParams: { level_above: 2.0, target_high: 0.9, k_below: 3.5, egfr_below: 30 },
    evidence: "ESC HF: target digoxin level 0.5–0.9 ng/mL; toxicity likelier with low K, impaired renal function and interacting drugs (amiodarone, verapamil). Level >2.0 ng/mL as toxic is a sandbox value pending review.",
    evaluate(s, p) {
      const dig = on(s, "digoxin")[0];
      const lvl = within(s, "digoxin-level", 30);
      if (lvl && lvl.value_num! > p.level_above)
        return [{ key: "dig-level", signature: lvl.id, severity: "red", title: `Digoxin level ${formatNumber(lvl.value_num!, 1)} ng/mL`, detail: "Assess for toxicity; hold digoxin; correct K and Mg.", facts: facts(f(lvl, "red"), f(within(s, "potassium", 30)), f(within(s, "egfr", 90)), src("ESC HF · target 0.5–0.9 ng/mL")), missing: [], action: { type: "wizard", wizard: "digoxin" } }];
      if (!dig) return [];
      const k = within(s, "potassium", 30), egfr = within(s, "egfr", 90);
      const inter = on(s, "qt", "ndhp-ccb");
      const risks = [k && k.value_num! < p.k_below && f(k, "orange"), egfr && egfr.value_num! < p.egfr_below && f(egfr, "orange"), ...inter.map((m) => ({ label: "Interacting drug", value: m.name }))].filter(Boolean) as Fact[];
      if (!risks.length) return [];
      return [{
        key: "dig-risk", signature: `${k?.id ?? ""}:${egfr?.id ?? ""}:${inter.map((m) => m.id).join(",")}`, severity: "orange",
        title: `Digoxin with ${risks.length} toxicity risk factor${risks.length === 1 ? "" : "s"}`,
        detail: lvl ? `Latest level ${formatNumber(lvl.value_num!, 1)} ng/mL (${fmtDay(lvl.effective_at)}).` : "Check a digoxin level and review the dose.",
        facts: facts(...risks, f(lvl), src("ESC HF · digoxin")), missing: lvl ? [] : ["Digoxin level"], action: { type: "wizard", wizard: "digoxin" },
      }];
    },
  },
  {
    id: "htn.severe",
    kind: "clinical",
    title: "Severe hypertension",
    inputs: ["sbp", "dbp"],
    defaultParams: { sbp_min: 180, dbp_min: 110, days: 2 },
    evidence: "ESC 2024 hypertension: severe BP (≥180/110) requires assessment for acute organ damage; emergency if present.",
    evaluate(s, p) {
      const sbp = within(s, "sbp", p.days), dbp = within(s, "dbp", p.days);
      if (!((sbp && sbp.value_num! >= p.sbp_min) || (dbp && dbp.value_num! >= p.dbp_min))) return [];
      return [{
        key: "severe-bp", signature: `${sbp?.id ?? ""}:${dbp?.id ?? ""}`, severity: "orange",
        title: `BP ${sbp ? formatNumber(sbp.value_num!, 0) : "—"}/${dbp ? formatNumber(dbp.value_num!, 0) : "—"} mmHg: exclude acute organ damage`,
        detail: "Emergency if chest pain, pulmonary oedema, neurological signs, dissection, AKI or pregnancy.",
        facts: facts(f(sbp, "orange"), f(dbp), f(within(s, "creatinine", 30)), src("ESC hypertension 2024")),
        missing: [], action: { type: "wizard", wizard: "severe-hypertension" },
      }];
    },
  },
];
