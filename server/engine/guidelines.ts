// Guideline-driven decision support. Every rule cites its source and class of
// recommendation, runs as a governed rule (CLINICAL_REVIEW until a clinician approves it)
// and only SUGGESTS: the clinician confirms every start, dose change or test.
//
// Sources (verify against the full texts during clinical review):
//  - 2026 ESC Guidelines for heart failure (HFrEF now LVEF <50%; foundational medical therapy;
//    MRA class I independent of LVEF; uptitration every 1–2 weeks; semaglutide/tirzepatide IIa in
//    HFpEF with obesity; SGLT2i in-hospital after stabilisation)
//  - 2023 ESC HF focused update (iron deficiency definition; IV iron)
//  - 2025 focused update of the 2019 ESC/EAS dyslipidaemia guidelines (LDL-C goals unchanged from
//    2019; Lp(a) once; bempedoic acid; statin+ezetimibe in ACS)
//  - 2026 ESC/ERA guidelines on CVD and CKD (eGFR + UACR in every CVD patient; SGLT2i; finerenone)
//  - 2023 ESC diabetes & CVD guidelines (SGLT2i and GLP-1 RA with proven benefit in T2DM + ASCVD)
//  - ESC clinical consensus on obesity & CVD (semaglutide 2.4 mg in CVD with BMI ≥27, IIa)
//  - 2024 ESC AF guidelines (CHA2DS2-VA; DOAC dosing)
//  - 2024 ESC hypertension guidelines (SBP target 120–129 mmHg if tolerated)
//  - 2023 ESC ACS guidelines (DAPT 12 months by default)
import { DIAGNOSIS, MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog.js";
import { bmi, cockcroftGault, daysBetween, fmtDay } from "../../shared/clinical.js";
import type { MedState, PatientState } from "../kernel/state.js";
import type { Fact, Finding, RuleDef } from "./rules.js";

// ---------- helpers ----------
const cur = (s: PatientState, code: string) => s.resolved(code).current;
const recent = (s: PatientState, code: string, days: number) => {
  const c = cur(s, code);
  return c && daysBetween(c.effective_at, s.today) <= days ? c : null;
};
const val = (s: PatientState, code: string, days = 3650) => recent(s, code, days)?.value_num ?? null;
const live = (s: PatientState) => s.meds.filter((m) => m.status === "active");
const onTag = (s: PatientState, tag: string) => live(s).filter((m) => m.tags.includes(tag));
const has = (s: PatientState, ...codes: string[]) => s.conditions.some((c) => codes.includes(c.code));
const fact = (s: PatientState, code: string, days = 3650): Fact | null => {
  const o = recent(s, code, days);
  const d = MEASURES[code];
  return o && d ? { label: d.display, value: `${formatNumber(o.value_num!, d.decimals)} ${d.unit}`, date: o.effective_at } : null;
};
const src = (text: string): Fact => ({ label: "Guideline", value: text });
const facts = (...f: (Fact | null | false | undefined)[]) => f.filter(Boolean) as Fact[];
const medLine = (m: MedState) => `${m.name} ${doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)} ${m.frequency ?? ""}`.trim();

export function isHF(s: PatientState) {
  return s.tags.has("hf");
}
// ESC 2026: HFrEF = LVEF <50%, HFpEF = LVEF ≥50%
export function hfPhenotype(s: PatientState): "HFrEF" | "HFpEF" | null {
  if (!isHF(s)) return null;
  const ef = cur(s, "lvef")?.value_num;
  if (ef != null) return ef < 50 ? "HFrEF" : "HFpEF";
  if (has(s, "hfpef")) return "HFpEF";
  return "HFrEF";
}
export function patientBmi(s: PatientState) {
  const w = val(s, "weight", 365), h = val(s, "height", 36500);
  return w && h ? bmi(w, h) : null;
}

// ---------- ESC 2024 AF: CHA2DS2-VA ----------
export function cha2ds2va(s: PatientState) {
  const age = s.patient.age;
  const items = [
    { key: "C", label: "Heart failure", pts: isHF(s) || (cur(s, "lvef")?.value_num ?? 100) <= 40 ? 1 : 0 },
    { key: "H", label: "Hypertension", pts: has(s, "htn") ? 1 : 0 },
    { key: "A2", label: "Age ≥75", pts: age >= 75 ? 2 : 0 },
    { key: "D", label: "Diabetes", pts: s.tags.has("dm") ? 1 : 0 },
    { key: "S2", label: "Stroke/TIA/thromboembolism", pts: s.tags.has("stroke") ? 2 : 0 },
    { key: "V", label: "Vascular disease", pts: s.conditions.some((c) => (DIAGNOSIS[c.code]?.tags ?? []).includes("ascvd") && !(DIAGNOSIS[c.code]?.tags ?? []).includes("stroke")) ? 1 : 0 },
    { key: "A", label: "Age 65–74", pts: age >= 65 && age < 75 ? 1 : 0 },
  ];
  return { score: items.reduce((n, i) => n + i.pts, 0), items: items.filter((i) => i.pts > 0) };
}

// ---------- ESC/EAS lipids: risk category and LDL-C goal ----------
export function lipidRisk(s: PatientState) {
  const egfr = val(s, "egfr", 365);
  const ascvd = s.tags.has("ascvd");
  const dm = s.tags.has("dm");
  const tod = dm && (ascvd || (egfr != null && egfr < 45) || (val(s, "uacr", 730) ?? 0) >= 3);
  const recentAcs = s.conditions.some((c) => DIAGNOSIS[c.code]?.tags.includes("acs") && (!c.onset || daysBetween(c.onset, s.today) <= 730));
  if (ascvd || tod || (egfr != null && egfr < 30) || (s.tags.has("fh") && ascvd))
    return { category: "very high", goal: 1.4, reduction: 50, why: ascvd ? "established ASCVD" : tod ? "diabetes with target-organ damage" : "eGFR <30", recentAcs };
  if (dm || (egfr != null && egfr < 60) || s.tags.has("fh"))
    return { category: "high", goal: 1.8, reduction: 50, why: dm ? "diabetes" : egfr != null && egfr < 60 ? "CKD, eGFR 30–59" : "familial hypercholesterolaemia", recentAcs: false };
  return null; // needs SCORE2 — not estimated automatically
}
const statinIntensity = (m: MedState) => {
  if (!m.tags.includes("statin") || m.doseValue == null) return "none";
  if (m.code === "atorvastatin") return m.doseValue >= 40 ? "high" : "moderate";
  if (m.code === "rosuvastatin") return m.doseValue >= 20 ? "high" : "moderate";
  return "moderate";
};

// ---------- ESC HF foundational therapy ----------
type Pillar = { key: string; label: string; tags: string[]; start: { code: string; dose: number } };
const pillarsFor = (s: PatientState): Pillar[] => {
  const phen = hfPhenotype(s);
  const egfr = val(s, "egfr", 90);
  const sglt2: Pillar = { key: "sglt2", label: "SGLT2 inhibitor", tags: ["sglt2"], start: { code: "dapagliflozin", dose: 10 } };
  if (phen === "HFpEF")
    return [sglt2, { key: "mra", label: "MRA (finerenone preferred)", tags: ["mra"], start: { code: "finerenone", dose: egfr != null && egfr < 60 ? 10 : 20 } }];
  return [
    { key: "raas", label: "ARNI / ACE inhibitor / ARB", tags: ["raas"], start: { code: "sacubitril-valsartan", dose: 24 } },
    { key: "bb", label: "Beta-blocker", tags: ["bb"], start: { code: "bisoprolol", dose: 1.25 } },
    { key: "mra", label: "MRA", tags: ["mra"], start: { code: "spironolactone", dose: egfr != null && egfr < 45 ? 12.5 : 25 } },
    sglt2,
  ];
};
// Safety gates before suggesting a start or an increase. Returns the blocking reason or missing data.
function pillarGate(s: PatientState, key: string, mode: "start" | "increase"): { block?: string; missing: string[] } {
  const k = val(s, "potassium", 60), egfr = val(s, "egfr", 60), sbp = val(s, "sbp", 60), hr = val(s, "hr", 60);
  const missing: string[] = [];
  if (key === "raas") {
    if (k == null) missing.push("Potassium (last 60 days)");
    if (sbp == null) missing.push("Blood pressure (last 60 days)");
    if (k != null && k > 5.0) return { block: `K ${formatNumber(k, 1)} > 5.0`, missing };
    if (sbp != null && sbp < (mode === "start" ? 90 : 100)) return { block: `SBP ${sbp} mmHg`, missing };
  }
  if (key === "bb") {
    if (hr == null) missing.push("Heart rate (last 60 days)");
    if (hr != null && hr < (mode === "start" ? 50 : 60)) return { block: `HR ${hr} bpm`, missing };
    if (mode === "increase" && sbp != null && sbp < 90) return { block: `SBP ${sbp} mmHg`, missing };
  }
  if (key === "mra") {
    if (k == null) missing.push("Potassium (last 60 days)");
    if (egfr == null) missing.push("eGFR (last 60 days)");
    if (k != null && k > 5.0) return { block: `K ${formatNumber(k, 1)} > 5.0`, missing };
    if (egfr != null && egfr < (mode === "start" ? 30 : 30)) return { block: `eGFR ${Math.round(egfr)} < 30`, missing };
  }
  if (key === "sglt2") {
    if (egfr == null) missing.push("eGFR (last 60 days)");
    if (egfr != null && egfr < 20) return { block: `eGFR ${Math.round(egfr)} < 20`, missing };
    if (has(s, "t1dm")) return { block: "type 1 diabetes", missing };
  }
  return { missing };
}
export function fmtStatus(s: PatientState) {
  const phen = hfPhenotype(s);
  if (!phen) return null;
  return {
    phenotype: phen,
    lvef: cur(s, "lvef")?.value_num ?? null,
    pillars: pillarsFor(s).map((p) => {
      const on = live(s).find((m) => p.tags.some((t) => m.tags.includes(t)));
      const held = s.meds.find((m) => m.status === "held" && p.tags.some((t) => m.tags.includes(t)));
      const def = on ? MEDICATION[on.code] : null;
      const pct = on && def?.target && on.doseValue != null ? Math.round((on.doseValue / def.target) * 100) : null;
      const gate = pillarGate(s, p.key, "start");
      return {
        key: p.key,
        label: p.label,
        state: on ? (pct != null && pct >= 100 ? "target" : "on") : held ? "held" : gate.block ? "blocked" : "missing",
        med: on ? medLine(on) : held ? medLine(held) + " (held)" : null,
        percentOfTarget: pct,
        target: on && def?.target ? doseLabel(def, def.target, on.doseUnit) : null,
        note: !on && gate.block ? `Not now: ${gate.block}` : null,
      };
    }),
  };
}

// ---------- the rules ----------
const RECENT_CHANGE_DAYS = 14; // ESC 2026: uptitrate every 1–2 weeks

export const GUIDELINE_RULES: RuleDef[] = [
  {
    id: "hf.foundational-therapy",
    kind: "clinical",
    title: "HF foundational medical therapy gaps",
    inputs: ["lvef", "conditions", "meds", "potassium", "egfr", "sbp", "hr"],
    defaultParams: {},
    evidence: "2026 ESC HF guidelines: foundational medical therapy (class I). HFrEF (LVEF <50%): beta-blocker, ARNI/ACEi/ARB, MRA, SGLT2i. HFpEF (LVEF ≥50%): SGLT2i and MRA.",
    evaluate(s) {
      const phen = hfPhenotype(s);
      if (!phen) return [];
      const ef = cur(s, "lvef");
      const out: Finding[] = [];
      for (const p of pillarsFor(s)) {
        if (s.meds.some((m) => (m.status === "active" || m.status === "held") && p.tags.some((t) => m.tags.includes(t)))) continue;
        const gate = pillarGate(s, p.key, "start");
        if (gate.block) continue;
        const def = MEDICATION[p.start.code];
        out.push({
          key: "fmt-" + p.key,
          signature: `${p.key}:${phen}:${ef?.id ?? "noef"}`,
          severity: "orange",
          title: `${phen}: ${p.label} not started`,
          detail: `Foundational therapy${ef ? ` · LVEF ${formatNumber(ef.value_num!, 0)}%` : ""} · suggested start: ${def.name} ${doseLabel(def, p.start.dose)}`,
          facts: facts(ef && { label: "LVEF", value: `${formatNumber(ef.value_num!, 0)}% (${ef.quality})`, date: ef.effective_at }, fact(s, "potassium", 60), fact(s, "egfr", 60), fact(s, "sbp", 60), fact(s, "hr", 60),
            src(phen === "HFrEF" ? "ESC HF 2026 · foundational medical therapy for HFrEF (LVEF <50%) · Class I" : "ESC HF 2026 · SGLT2i and MRA in HFpEF · Class I")),
          missing: gate.missing,
          action: { type: "start-med", code: p.start.code, dose: p.start.dose, label: `Start ${def.name}` },
        });
      }
      // ARNI in place of ACEi/ARB
      const acei = live(s).find((m) => m.tags.includes("acei") || m.tags.includes("arb"));
      if (phen === "HFrEF" && acei && !onTag(s, "arni").length && !pillarGate(s, "raas", "increase").block)
        out.push({
          key: "arni-switch",
          signature: acei.id,
          severity: "blue",
          title: `Consider replacing ${acei.name.toLowerCase()} with sacubitril/valsartan`,
          detail: "ARNI is the preferred RAS inhibitor in HFrEF · stop ACE inhibitor 36 h before the first dose",
          facts: facts({ label: "Current", value: medLine(acei) }, fact(s, "sbp", 60), fact(s, "potassium", 60), src("ESC HF · ARNI in place of ACEi in ambulatory HFrEF")),
          missing: [],
          action: { type: "start-med", code: "sacubitril-valsartan", dose: 24, label: "Plan ARNI switch" },
        });
      return out;
    },
  },
  {
    id: "hf.titration",
    kind: "clinical",
    title: "HF therapy uptitration opportunity",
    inputs: ["meds", "potassium", "egfr", "sbp", "hr", "lvef", "conditions"],
    defaultParams: { min_days_since_change: RECENT_CHANGE_DAYS },
    evidence: "2026 ESC HF guidelines: uptitrate foundational therapy at least every 1–2 weeks to target or maximally tolerated doses (class I).",
    evaluate(s, p) {
      if (hfPhenotype(s) !== "HFrEF") return [];
      const out: Finding[] = [];
      for (const m of live(s)) {
        const def = MEDICATION[m.code];
        if (!def?.target || m.doseValue == null || m.doseValue >= def.target) continue;
        const key = m.tags.includes("bb") ? "bb" : m.tags.includes("mra") ? "mra" : m.tags.includes("raas") ? "raas" : null;
        if (!key) continue;
        const last = m.lastChange;
        if (last && daysBetween(last.effective_at, s.today) < Number(p.min_days_since_change)) continue;
        const gate = pillarGate(s, key, "increase");
        if (gate.block || gate.missing.length) continue;
        const next = def.doses.find((d) => d > m.doseValue!);
        if (next == null) continue;
        out.push({
          key: "titrate-" + m.id,
          signature: `${m.id}:${m.doseValue}`,
          severity: "blue",
          title: `Uptitrate ${m.name}: ${doseLabel(def, m.doseValue)} → ${doseLabel(def, next)}`,
          detail: `Target ${doseLabel(def, def.target)} · ${Math.round((m.doseValue / def.target) * 100)}% of target · last change ${last ? fmtDay(last.effective_at) : "—"}`,
          facts: facts({ label: "Current", value: medLine(m) }, { label: "Target", value: doseLabel(def, def.target) }, fact(s, "sbp", 60), fact(s, "hr", 60), fact(s, "potassium", 60), fact(s, "egfr", 60),
            src("ESC HF 2026 · uptitrate every 1–2 weeks to target/maximally tolerated dose · Class I")),
          missing: [],
          action: { type: "titrate", medicationId: m.id, dose: next, direction: "increase", label: `Increase to ${doseLabel(def, next)}` },
        });
      }
      return out;
    },
  },
  {
    id: "hf.iron-deficiency",
    kind: "clinical",
    title: "Iron deficiency in heart failure",
    inputs: ["ferritin", "tsat", "haemoglobin", "conditions", "meds"],
    defaultParams: { ferritin_low: 100, ferritin_mid: 300, tsat_low: 20, screen_days: 365 },
    evidence: "ESC HF (2023 focused update, retained 2026): screen all HF patients for iron deficiency; ID = ferritin <100 ng/mL or 100–299 with TSAT <20%; IV iron in symptomatic HFrEF.",
    evaluate(s, p) {
      if (!isHF(s)) return [];
      const fer = recent(s, "ferritin", Number(p.screen_days)), ts = recent(s, "tsat", Number(p.screen_days));
      if (!fer || !ts)
        return [{
          key: "iron-screen", signature: `${fer?.id ?? "-"}:${ts?.id ?? "-"}`, severity: "yellow",
          title: "Iron studies due (ferritin and TSAT)", detail: "Not checked in the last 12 months",
          facts: facts(fact(s, "haemoglobin", 365), src("ESC HF · screen for iron deficiency · Class I")), missing: [],
          action: { type: "add-labs", codes: ["haemoglobin", "ferritin", "tsat"], label: "Add iron studies" },
        }];
      const f = fer.value_num!, t = ts.value_num!;
      const id = f < Number(p.ferritin_low) || (f < Number(p.ferritin_mid) && t < Number(p.tsat_low));
      if (!id || onTag(s, "iv-iron").some((m) => daysBetween(m.startedAt ?? s.today, s.today) < 90)) return [];
      return [{
        key: "iron-deficiency", signature: `${fer.id}:${ts.id}`, severity: "orange",
        title: `Iron deficiency: ferritin ${formatNumber(f, 0)}, TSAT ${formatNumber(t, 0)}%`,
        detail: "Consider IV iron (ferric carboxymaltose or ferric derisomaltose)",
        facts: facts(fact(s, "ferritin", 365), fact(s, "tsat", 365), fact(s, "haemoglobin", 365), src("ESC HF · IV iron in symptomatic HF with iron deficiency")),
        missing: [], action: { type: "start-med", code: "ferric-derisomaltose", dose: 1000, label: "Plan IV iron" },
      }];
    },
  },
  {
    id: "lipids.ldl-goal",
    kind: "clinical",
    title: "LDL-C goal and lipid-lowering escalation",
    inputs: ["ldl-c", "conditions", "meds", "egfr", "uacr"],
    defaultParams: { recheck_days: 365 },
    evidence: "ESC/EAS dyslipidaemia (2019 goals, 2025 focused update): very high risk LDL-C <1.4 mmol/L and ≥50% reduction; high risk <1.8 mmol/L. Stepwise: high-intensity statin → ezetimibe → PCSK9 mAb/inclisiran; bempedoic acid if statin not tolerated.",
    evaluate(s, p) {
      const risk = lipidRisk(s);
      if (!risk) return [];
      const ldl = recent(s, "ldl-c", Number(p.recheck_days));
      const statin = onTag(s, "statin")[0];
      if (!ldl)
        return [{
          key: "ldl-due", signature: cur(s, "ldl-c")?.id ?? "never", severity: "yellow",
          title: "Lipid profile due", detail: `${risk.category[0].toUpperCase() + risk.category.slice(1)} risk (${risk.why}) · no LDL-C in 12 months`,
          facts: facts(fact(s, "ldl-c"), src("ESC/EAS · reassess LDL-C to confirm goal attainment")), missing: [],
          action: { type: "add-labs", codes: ["total-cholesterol", "ldl-c", "hdl-c", "triglycerides"], label: "Add lipid profile" },
        }];
      const v = ldl.value_num!;
      const goal = risk.goal;
      if (v < goal) return [];
      // next step on the ladder
      let action: Finding["action"];
      let step: string;
      const intolerant = has(s, "statin-intolerance");
      if (!statin && !intolerant) { step = "start high-intensity statin"; action = { type: "start-med", code: "atorvastatin", dose: 40, label: "Start atorvastatin 40 mg" }; }
      else if (statin && statinIntensity(statin) !== "high" && !intolerant) {
        const next = statin.code === "rosuvastatin" ? 20 : 40;
        step = `increase ${statin.name.toLowerCase()} to high intensity`;
        action = { type: "titrate", medicationId: statin.id, dose: next, direction: "increase", label: `Increase to ${next} mg` };
      } else if (!onTag(s, "ezetimibe").length) { step = "add ezetimibe"; action = { type: "start-med", code: "ezetimibe", dose: 10, label: "Add ezetimibe 10 mg" }; }
      else if (intolerant && !live(s).some((m) => m.code === "bempedoic-acid")) { step = "add bempedoic acid"; action = { type: "start-med", code: "bempedoic-acid", dose: 180, label: "Add bempedoic acid" }; }
      else if (!onTag(s, "pcsk9").length) { step = "add a PCSK9 inhibitor (evolocumab, alirocumab or inclisiran)"; action = { type: "start-med", code: "evolocumab", dose: 140, label: "Add PCSK9 therapy" }; }
      else { step = "review adherence; therapy already maximal"; action = { type: "add-plan", template: "lipids" }; }
      return [{
        key: "ldl-goal", signature: `${ldl.id}:${live(s).filter((m) => m.tags.includes("lipid")).map((m) => m.code + m.doseValue).join(",")}`,
        severity: "orange",
        title: `LDL-C ${formatNumber(v, 2)} mmol/L above goal <${goal}`,
        detail: `${risk.category[0].toUpperCase() + risk.category.slice(1)} risk (${risk.why}) · next step: ${step}` + (risk.recentAcs ? " · recurrent event within 2 years: goal <1.0 may be considered" : ""),
        facts: facts(fact(s, "ldl-c"), { label: "Goal", value: `<${goal} mmol/L and ≥${risk.reduction}% reduction` },
          ...live(s).filter((m) => m.tags.includes("lipid")).map((m) => ({ label: "Therapy", value: medLine(m) })),
          src("ESC/EAS dyslipidaemia 2019/2025 · LDL-C goals · Class I")),
        missing: [], action,
      }];
    },
  },
  {
    id: "lipids.lpa-once",
    kind: "clinical",
    title: "Lipoprotein(a) measured once",
    inputs: ["lpa", "conditions"],
    defaultParams: {},
    evidence: "2025 ESC/EAS focused update: measure Lp(a) at least once in every adult (IIa); >105 nmol/L (>50 mg/dL) is a risk modifier.",
    evaluate(s) {
      if (!(s.tags.has("ascvd") || s.tags.has("dm") || s.tags.has("fh"))) return [];
      if (s.observations.some((o) => o.code === "lpa")) return [];
      return [{ key: "lpa", signature: "never", severity: "blue", title: "Lipoprotein(a) never measured", detail: "Measure once in adulthood to refine risk",
        facts: [src("ESC/EAS 2025 · measure Lp(a) once · IIa")], missing: [], action: { type: "add-labs", codes: ["lpa"], label: "Add Lp(a)" } }];
    },
  },
  {
    id: "cardiorenal.screening",
    kind: "clinical",
    title: "Kidney screening in cardiovascular disease",
    inputs: ["egfr", "uacr", "conditions"],
    defaultParams: { days: 365 },
    evidence: "2026 ESC/ERA CVD and CKD guidelines: test every patient with CVD for CKD with eGFR and urine albumin:creatinine ratio (class I).",
    evaluate(s, p) {
      if (!(s.tags.has("ascvd") || isHF(s) || s.tags.has("af") || has(s, "htn") || s.tags.has("dm"))) return [];
      const missing = [!recent(s, "egfr", Number(p.days)) && "eGFR", !recent(s, "uacr", Number(p.days)) && "UACR"].filter(Boolean) as string[];
      if (!missing.length) return [];
      return [{ key: "ckd-screen", signature: missing.join(","), severity: "yellow", title: `Kidney screening due: ${missing.join(" and ")}`,
        detail: "eGFR and albuminuria classify CKD and guide SGLT2i / finerenone", facts: facts(fact(s, "egfr"), fact(s, "uacr"), src("ESC/ERA CVD–CKD 2026 · Class I")), missing: [],
        action: { type: "add-labs", codes: missing.includes("UACR") ? ["creatinine", "uacr"] : ["creatinine"], label: "Add renal labs" } }];
    },
  },
  {
    id: "metabolic.diabetes-cv-protection",
    kind: "clinical",
    title: "Type 2 diabetes: agents with proven CV benefit",
    inputs: ["conditions", "meds", "egfr"],
    defaultParams: {},
    evidence: "2023 ESC diabetes & CVD: in T2DM with ASCVD, SGLT2i and GLP-1 RA with proven CV benefit are recommended independent of HbA1c (class I); in T2DM with CKD (eGFR ≥20) SGLT2i (class I).",
    evaluate(s) {
      if (!s.tags.has("t2dm")) return [];
      const out: Finding[] = [];
      const egfr = val(s, "egfr", 180);
      const needSglt2 = s.tags.has("ascvd") || isHF(s) || s.tags.has("ckd") || (egfr != null && egfr < 60);
      if (needSglt2 && !onTag(s, "sglt2").length && !(egfr != null && egfr < 20) && !isHF(s))
        out.push({ key: "dm-sglt2", signature: "sglt2", severity: "orange", title: "T2DM with ASCVD/CKD: SGLT2 inhibitor not prescribed",
          detail: "Cardiorenal protection independent of HbA1c", facts: facts(fact(s, "egfr", 180), fact(s, "hba1c", 365), src("ESC diabetes & CVD 2023 · Class I")), missing: egfr == null ? ["eGFR"] : [],
          action: { type: "start-med", code: "empagliflozin", dose: 10, label: "Start empagliflozin 10 mg" } });
      if (s.tags.has("ascvd") && !onTag(s, "glp1").length)
        out.push({ key: "dm-glp1", signature: "glp1", severity: "blue", title: "T2DM with ASCVD: GLP-1 RA with proven CV benefit not prescribed",
          detail: "Semaglutide, liraglutide or dulaglutide · reduces MACE independent of HbA1c", facts: facts(fact(s, "hba1c", 365), fact(s, "weight", 365), src("ESC diabetes & CVD 2023 · Class I")), missing: [],
          action: { type: "start-med", code: "semaglutide", dose: 0.25, label: "Start semaglutide 0.25 mg weekly" } });
      return out;
    },
  },
  {
    id: "metabolic.obesity",
    kind: "clinical",
    title: "Obesity with cardiovascular disease",
    inputs: ["weight", "height", "conditions", "meds", "lvef"],
    defaultParams: { bmi_cvd: 27, bmi_hfpef: 30 },
    evidence: "ESC consensus on obesity & CVD: semaglutide 2.4 mg weekly in established CVD with BMI ≥27 without diabetes (IIa). 2026 ESC HF: semaglutide or tirzepatide in symptomatic HF with LVEF ≥45% and BMI ≥30 (IIa).",
    evaluate(s, p) {
      const b = patientBmi(s);
      if (b == null || onTag(s, "glp1").length) return [];
      const ef = cur(s, "lvef")?.value_num;
      if (isHF(s) && ef != null && ef >= 45 && b >= Number(p.bmi_hfpef))
        return [{ key: "obesity-hfpef", signature: `hf:${Math.round(b)}`, severity: "blue", title: `HF with LVEF ${Math.round(ef)}% and BMI ${formatNumber(b, 1)}: consider semaglutide or tirzepatide`,
          detail: "Improves symptoms, exercise capacity and weight in HFpEF with obesity", facts: facts(fact(s, "weight", 365), { label: "BMI", value: formatNumber(b, 1) + " kg/m²" }, src("ESC HF 2026 · IIa")), missing: [],
          action: { type: "start-med", code: "semaglutide", dose: 0.25, label: "Start semaglutide (titrate to 2.4 mg)" } }];
      if (s.tags.has("ascvd") && !s.tags.has("dm") && b >= Number(p.bmi_cvd))
        return [{ key: "obesity-cvd", signature: `cvd:${Math.round(b)}`, severity: "blue", title: `ASCVD with BMI ${formatNumber(b, 1)}: consider semaglutide 2.4 mg weekly`,
          detail: "Reduces MACE in established CVD with overweight/obesity without diabetes (SELECT)", facts: facts(fact(s, "weight", 365), { label: "BMI", value: formatNumber(b, 1) + " kg/m²" }, src("ESC consensus obesity & CVD · IIa")), missing: [],
          action: { type: "start-med", code: "semaglutide", dose: 0.25, label: "Start semaglutide (titrate to 2.4 mg)" } }];
      return [];
    },
  },
  {
    id: "cardiorenal.finerenone",
    kind: "clinical",
    title: "Finerenone in T2DM with albuminuric CKD",
    inputs: ["conditions", "meds", "egfr", "uacr", "potassium"],
    defaultParams: { egfr_min: 25, uacr_min: 3 },
    evidence: "2023 ESC diabetes & CVD / 2026 ESC-ERA CVD–CKD: finerenone added to ACEi/ARB in T2DM with CKD, eGFR ≥25 and albuminuria (class I).",
    evaluate(s, p) {
      if (!s.tags.has("t2dm") || onTag(s, "mra").length || !onTag(s, "raas").length) return [];
      const egfr = val(s, "egfr", 180), uacr = val(s, "uacr", 365), k = val(s, "potassium", 90);
      if (egfr == null || uacr == null || egfr < Number(p.egfr_min) || uacr < Number(p.uacr_min) || (k != null && k > 5.0)) return [];
      return [{ key: "finerenone", signature: `${cur(s, "uacr")?.id}`, severity: "blue", title: `T2DM + albuminuric CKD (UACR ${formatNumber(uacr, 1)} mg/mmol): consider finerenone`,
        detail: `eGFR ${Math.round(egfr)} · start ${egfr < 60 ? "10" : "20"} mg OD · recheck K at 4 weeks`, facts: facts(fact(s, "egfr", 180), fact(s, "uacr", 365), fact(s, "potassium", 90), src("ESC 2023 / ESC-ERA 2026 · Class I")), missing: k == null ? ["Potassium"] : [],
        action: { type: "start-med", code: "finerenone", dose: egfr < 60 ? 10 : 20, label: "Start finerenone" } }];
    },
  },
  {
    id: "af.anticoagulation",
    kind: "clinical",
    title: "AF stroke prevention (CHA2DS2-VA)",
    inputs: ["conditions", "meds", "lvef"],
    defaultParams: {},
    evidence: "2024 ESC AF guidelines: OAC recommended with CHA2DS2-VA ≥2 (class I), considered with score 1 (IIa); DOAC preferred over VKA except mechanical valve or moderate–severe mitral stenosis.",
    evaluate(s) {
      if (!s.tags.has("af")) return [];
      const vka = live(s).find((m) => m.code === "warfarin");
      if (vka && !has(s, "ms") && !s.conditions.some((c) => /mechanical/i.test(c.detail ?? "")))
        return [{ key: "af-doac", signature: vka.id, severity: "blue", title: "AF on warfarin: a DOAC is preferred",
          detail: "No mitral stenosis or mechanical valve recorded · check eGFR, weight and interactions before switching",
          facts: facts({ label: "Current", value: medLine(vka) }, fact(s, "inr", 90), fact(s, "creatinine", 180), src("ESC AF 2024 · DOAC in preference to VKA · Class I")),
          missing: [], action: { type: "start-med", code: "apixaban", dose: 5, label: "Plan DOAC switch" } }];
      if (onTag(s, "oac").length) return [];
      const c = cha2ds2va(s);
      if (c.score < 1) return [];
      return [{ key: "af-oac", signature: `score:${c.score}`, severity: c.score >= 2 ? "red" : "blue",
        title: `AF with CHA2DS2-VA ${c.score}: ${c.score >= 2 ? "oral anticoagulation recommended" : "consider oral anticoagulation"}`,
        detail: c.items.map((i) => i.label).join(" · "),
        facts: facts({ label: "CHA2DS2-VA", value: String(c.score) }, fact(s, "creatinine", 180), fact(s, "haemoglobin", 180), fact(s, "weight", 365), src(`ESC AF 2024 · ${c.score >= 2 ? "Class I" : "IIa"}`)),
        missing: [], action: { type: "start-med", code: "apixaban", dose: 5, label: "Start a DOAC" } }];
    },
  },
  {
    id: "af.doac-dose",
    kind: "clinical",
    title: "DOAC dose appropriateness",
    inputs: ["meds", "creatinine", "weight"],
    defaultParams: {},
    evidence: "2024 ESC AF / EHRA practical guide: apixaban 2.5 mg BID only if ≥2 of age ≥80, weight ≤60 kg, creatinine ≥133 µmol/L; rivaroxaban 15 mg if CrCl 15–49; edoxaban 30 mg if CrCl 15–50 or weight ≤60 kg; dabigatran 110 mg if age ≥80.",
    evaluate(s) {
      const out: Finding[] = [];
      const cr = val(s, "creatinine", 180), wt = val(s, "weight", 365), age = s.patient.age;
      const crcl = cr && wt ? cockcroftGault(cr, age, wt, s.patient.sex) : null;
      const push = (m: MedState, right: number, why: string) => {
        if (m.doseValue == null || m.doseValue === right) return;
        const def = MEDICATION[m.code];
        out.push({ key: "doac-" + m.id, signature: `${m.id}:${m.doseValue}:${right}`, severity: "orange",
          title: `${m.name} ${doseLabel(def, m.doseValue)}: label dose is ${doseLabel(def, right)}`, detail: why,
          facts: facts({ label: "Age", value: `${age} y` }, fact(s, "weight", 365), fact(s, "creatinine", 180), crcl ? { label: "CrCl (Cockcroft-Gault)", value: `${Math.round(crcl)} mL/min` } : null, src("ESC AF 2024 / EHRA DOAC guide")),
          missing: [cr == null && "Creatinine", wt == null && "Weight"].filter(Boolean) as string[],
          action: { type: "titrate", medicationId: m.id, dose: right, direction: right > m.doseValue ? "increase" : "decrease", label: `Change to ${doseLabel(def, right)}` } });
      };
      for (const m of onTag(s, "oac")) {
        if (m.code === "apixaban" && cr != null && wt != null) {
          const n = [age >= 80, wt <= 60, cr >= 133].filter(Boolean).length;
          push(m, n >= 2 ? 2.5 : 5, `${n} of 3 dose-reduction criteria (age ≥80, weight ≤60 kg, creatinine ≥133 µmol/L)`);
        }
        if (m.code === "rivaroxaban" && crcl != null && crcl >= 15) push(m, crcl < 50 ? 15 : 20, `CrCl ${Math.round(crcl)} mL/min`);
        if (m.code === "edoxaban" && crcl != null && wt != null && crcl >= 15) push(m, crcl <= 50 || wt <= 60 ? 30 : 60, `CrCl ${Math.round(crcl)} mL/min · weight ${formatNumber(wt, 0)} kg`);
        if (m.code === "dabigatran") push(m, age >= 80 ? 110 : 150, `Age ${age}`);
      }
      return out;
    },
  },
  {
    id: "htn.bp-target",
    kind: "clinical",
    title: "Blood pressure above target",
    inputs: ["sbp", "dbp", "conditions", "meds"],
    defaultParams: { treat_sbp: 140, target_high: 130, days: 90 },
    evidence: "2024 ESC hypertension guidelines: target SBP 120–129 mmHg if tolerated (class I).",
    evaluate(s, p) {
      if (!(has(s, "htn") || s.tags.has("ascvd") || s.tags.has("dm") || s.tags.has("ckd"))) return [];
      const sbp = recent(s, "sbp", Number(p.days));
      if (!sbp || sbp.value_num! < Number(p.target_high)) return [];
      const high = sbp.value_num! >= Number(p.treat_sbp);
      return [{ key: "bp", signature: sbp.id, severity: high ? "orange" : "blue",
        title: `SBP ${Math.round(sbp.value_num!)} mmHg above target 120–129`,
        detail: high ? "Confirm with repeat or home readings and intensify treatment" : "Intensify if tolerated; confirm with home readings",
        facts: facts(fact(s, "sbp", Number(p.days)), fact(s, "dbp", Number(p.days)), ...live(s).filter((m) => m.purpose === "Blood pressure" || m.tags.includes("raas")).map((m) => ({ label: "Therapy", value: medLine(m) })), src("ESC hypertension 2024 · Class I")),
        missing: [], action: { type: "tab", tab: "medications" } }];
    },
  },
  {
    id: "acs.dapt",
    kind: "clinical",
    title: "Antiplatelet therapy after ACS / in CAD",
    inputs: ["conditions", "meds"],
    defaultParams: { dapt_days: 365 },
    evidence: "2023 ESC ACS guidelines: DAPT (aspirin + P2Y12 inhibitor) for 12 months by default after ACS (class I); single antiplatelet long-term in CAD unless on OAC.",
    evaluate(s, p) {
      if (!s.tags.has("cad") || onTag(s, "oac").length) return [];
      const acs = s.conditions.find((c) => DIAGNOSIS[c.code]?.tags.includes("acs"));
      const acsDays = acs ? daysBetween(acs.onset ?? acs.recorded_at, s.today) : null;
      const anti = onTag(s, "antiplatelet");
      if (!anti.length)
        return [{ key: "no-antiplatelet", signature: "none", severity: "orange", title: "Coronary disease without antiplatelet therapy", detail: "Aspirin 75–100 mg (or clopidogrel) unless on anticoagulation or contraindicated",
          facts: [src("ESC CCS 2024 / ACS 2023 · Class I")], missing: [], action: { type: "start-med", code: "aspirin", dose: 100, label: "Start aspirin" } }];
      if (acsDays != null && acsDays <= Number(p.dapt_days) && !onTag(s, "p2y12").length)
        return [{ key: "dapt", signature: acs!.id, severity: "orange", title: "ACS within 12 months without a P2Y12 inhibitor", detail: "DAPT for 12 months by default unless high bleeding risk",
          facts: [{ label: "ACS", value: acs!.display, date: acs!.onset ?? acs!.recorded_at }, src("ESC ACS 2023 · Class I")], missing: [], action: { type: "start-med", code: "ticagrelor", dose: 90, label: "Add P2Y12 inhibitor" } }];
      return [];
    },
  },
  {
    id: "dm.hba1c-due",
    kind: "operational",
    title: "HbA1c monitoring in diabetes",
    inputs: ["hba1c", "conditions"],
    defaultParams: { days: 180 },
    evidence: "Workflow: HbA1c at least every 6 months in diabetes (ADA/ESC).",
    evaluate(s, p) {
      if (!s.tags.has("dm") || recent(s, "hba1c", Number(p.days))) return [];
      return [{ key: "hba1c", signature: cur(s, "hba1c")?.id ?? "never", severity: "yellow", title: "HbA1c due", detail: "Not measured in the last 6 months",
        facts: facts(fact(s, "hba1c")), missing: [], action: { type: "add-labs", codes: ["hba1c"], label: "Add HbA1c" } }];
    },
  },
];

// Therapy & targets panel for the Summary
export function targets(s: PatientState) {
  const risk = lipidRisk(s);
  const ldl = cur(s, "ldl-c");
  const sbp = recent(s, "sbp", 180), dbp = recent(s, "dbp", 180);
  const b = patientBmi(s);
  const af = s.tags.has("af") ? cha2ds2va(s) : null;
  return {
    hf: fmtStatus(s),
    ldl: risk
      ? { category: risk.category, why: risk.why, goal: risk.goal, value: ldl?.value_num ?? null, at: ldl?.effective_at ?? null, met: ldl?.value_num != null ? ldl.value_num < risk.goal : null,
          therapy: live(s).filter((m) => m.tags.includes("lipid")).map(medLine) }
      : null,
    bp: has(s, "htn") || s.tags.has("ascvd") || s.tags.has("dm") ? { target: "120–129", sbp: sbp?.value_num ?? null, dbp: dbp?.value_num ?? null, at: sbp?.effective_at ?? null, met: sbp?.value_num != null ? sbp.value_num < 130 : null } : null,
    metabolic: s.tags.has("dm") || (b != null && b >= 27)
      ? { bmi: b, hba1c: cur(s, "hba1c")?.value_num ?? null, sglt2: onTag(s, "sglt2").map(medLine), glp1: onTag(s, "glp1").map(medLine) }
      : null,
    af: af ? { score: af.score, items: af.items.map((i) => i.label), oac: onTag(s, "oac").map(medLine) } : null,
    kidney: { egfr: cur(s, "egfr")?.value_num ?? null, egfrAt: cur(s, "egfr")?.effective_at ?? null, uacr: cur(s, "uacr")?.value_num ?? null, uacrAt: cur(s, "uacr")?.effective_at ?? null },
  };
}
