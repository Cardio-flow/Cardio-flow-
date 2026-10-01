// Diabetes in cardiac patients: individual glycaemic target, drug safety in heart failure and
// CKD, hypoglycaemia risk, duplicate incretin therapy, annual checks and SGLT2i before procedures.
// Cardio-renal protection itself (SGLT2i, GLP-1 RA, finerenone) lives in guidelines.ts.
// Every number is a governed parameter; all start in CLINICAL_REVIEW (sandbox only).
//
// Sources (confirm wording and class during clinical review):
//  - ADA Standards of Care in Diabetes 2026: §6 individualised HbA1c goals (<7% for many adults,
//    less stringent with severe hypoglycaemia, limited life expectancy or advanced complications);
//    §9 pharmacological therapy (metformin eGFR limits; no DPP-4i with GLP-1 RA); §10 heart failure
//    (avoid thiazolidinediones; saxagliptin not recommended); §13 older adults (deintensify drugs
//    that cause hypoglycaemia); §16 hospital care (SGLT2i stopped 3 days before surgery).
//  - 2023 ESC diabetes & CVD: pioglitazone not recommended in HF (III); saxagliptin not recommended
//    in HF (III); HbA1c <7% to reduce microvascular complications.
//  - Metformin SmPC (EMA): eGFR 30–44 maximum 1000 mg/day; contraindicated below 30.
import { MEASURES, formatNumber } from "../../shared/catalog.js";
import { daysBetween, fmtDay } from "../../shared/clinical.js";
import { HBA1C_TARGETS, hba1cTarget } from "../../shared/history.js";
import type { MedState, PatientState } from "../kernel/state.js";
import type { Fact, Finding, RuleDef } from "./rules.js";

const DM_CODES = ["t2dm", "t1dm", "dm-other"];
const on = (s: PatientState, ...tags: string[]) => s.meds.filter((m) => m.status === "active" && m.tags.some((t) => tags.includes(t)));
const within = (s: PatientState, code: string, days: number) => {
  const c = s.resolved(code).current;
  return c && c.value_num != null && daysBetween(c.effective_at, s.today) <= days ? c : null;
};
const f = (o: { value_num: number | null; effective_at: string; code: string } | null, tone?: Fact["tone"]): Fact | null =>
  o && MEASURES[o.code] ? { label: MEASURES[o.code].display, value: `${formatNumber(o.value_num!, MEASURES[o.code].decimals)} ${MEASURES[o.code].unit}`.trim(), date: o.effective_at, tone } : null;
const src = (v: string): Fact => ({ label: "Guideline", value: v });
const facts = (...x: (Fact | null | false | undefined)[]) => x.filter(Boolean) as Fact[];
const perDay: Record<string, number> = { OD: 1, Nightly: 1, BID: 2, TID: 3 };
export const dailyDose = (m: MedState) => (m.doseValue != null && perDay[m.frequency ?? ""] ? m.doseValue * perDay[m.frequency!] : null);
const medFact = (m: MedState): Fact => ({ label: m.drugClass, value: `${m.name}${m.doseValue != null ? ` ${formatNumber(m.doseValue)} ${m.doseUnit ?? ""}`.trimEnd() : ""} ${m.frequency ?? ""}`.trim() });

export function diabetesRecord(s: PatientState) {
  return s.conditions.find((c) => DM_CODES.includes(c.code)) ?? null;
}

// The HbA1c target used for this patient: the clinician's individual target when set, otherwise
// the default, or the less stringent value when a reason for it is on record.
export function glycaemicTarget(s: PatientState, p: { target_default: number | string; target_relaxed: number | string; egfr_relaxed: number | string }) {
  const dm = diabetesRecord(s);
  const set = hba1cTarget(dm?.attributes);
  const noFixed = String(dm?.attributes?.target ?? "").startsWith("No fixed");
  const reasons: string[] = [];
  if (s.tags.has("severe-hypo")) reasons.push("severe hypoglycaemia in the past year");
  const egfr = within(s, "egfr", 365)?.value_num;
  if (s.tags.has("dialysis") || (egfr != null && egfr < Number(p.egfr_relaxed))) reasons.push(`eGFR <${p.egfr_relaxed}`);
  if (set != null) return { value: set, label: `<${set}%`, source: "individual" as const, reasons };
  if (noFixed) return { value: null, label: HBA1C_TARGETS[HBA1C_TARGETS.length - 1], source: "individual" as const, reasons };
  if (reasons.length) return { value: Number(p.target_relaxed), label: `<${p.target_relaxed}%`, source: "suggested" as const, reasons };
  return { value: Number(p.target_default), label: `<${p.target_default}%`, source: "default" as const, reasons };
}

const TARGET_PARAMS = { target_default: 7, target_relaxed: 8, egfr_relaxed: 30 };

export const DIABETES_RULES: RuleDef[] = [
  {
    id: "dm.glycaemic-control",
    kind: "clinical",
    title: "HbA1c above the individual target",
    inputs: ["hba1c", "conditions", "meds", "egfr"],
    defaultParams: { ...TARGET_PARAMS, uncontrolled: 9, days: 180 },
    evidence: "ADA Standards of Care 2026 §6: individualised HbA1c goals (<7% for many adults; less stringent with severe hypoglycaemia, advanced CKD or limited life expectancy). ESC diabetes & CVD 2023: HbA1c <7%; cardiorenal protection independent of HbA1c.",
    evaluate(s, p) {
      const dm = diabetesRecord(s);
      const a1c = within(s, "hba1c", Number(p.days));
      if (!dm || !a1c) return [];
      const t = glycaemicTarget(s, p as any);
      if (t.value == null || a1c.value_num! < t.value) return [];
      const high = a1c.value_num! >= Number(p.uncontrolled);
      const prev = s.resolved("hba1c").history[1];
      const lowering = on(s, "metformin", "sglt2", "glp1", "dpp4", "sulfonylurea", "tzd", "insulin");
      return [{
        key: "a1c", signature: `${a1c.id}:${t.label}`, severity: high ? "orange" : "yellow",
        title: high ? `Uncontrolled diabetes: HbA1c ${formatNumber(a1c.value_num!, 1)}% (target ${t.label})` : `HbA1c ${formatNumber(a1c.value_num!, 1)}% above target ${t.label}`,
        detail: "Check adherence; heart and kidney protection first (SGLT2i, GLP-1 RA), then intensify glucose lowering without hypoglycaemia.",
        facts: facts(
          f(a1c, high ? "orange" : "yellow"),
          prev?.value_num != null && { label: "Previous HbA1c", value: `${formatNumber(prev.value_num, 1)} %`, date: prev.effective_at },
          { label: "Target", value: `${t.label} · ${t.source === "individual" ? "set by clinician" : t.source === "suggested" ? "less stringent: " + t.reasons.join(", ") : "default, not yet individualised"}` },
          f(within(s, "egfr", 365)),
          ...(lowering.length ? lowering.map(medFact) : [{ label: "Glucose-lowering therapy", value: "None recorded" }]),
          src("ADA 2026 §6, §9 · ESC diabetes & CVD 2023"),
        ),
        missing: within(s, "egfr", 365) ? [] : ["eGFR"],
        action: { type: "wizard", wizard: "diabetes" },
      }];
    },
  },
  {
    id: "dm.hf-unsafe-agent",
    kind: "clinical",
    title: "Glucose-lowering drug to avoid in heart failure",
    inputs: ["meds", "conditions"],
    defaultParams: {},
    evidence: "ESC diabetes & CVD 2023 and ESC HF: pioglitazone not recommended in HF (III, fluid retention, HF hospitalisation); saxagliptin not recommended in HF (III, SAVOR-TIMI 53). ADA 2026 §10: avoid thiazolidinediones in HF; FDA HF warning for saxagliptin and alogliptin.",
    evaluate(s) {
      if (!s.tags.has("hf")) return [];
      const out: Finding[] = [];
      for (const m of on(s, "tzd"))
        out.push({ key: `tzd:${m.code}`, signature: m.id, severity: "red", title: `${m.name} in heart failure: stop`,
          detail: "Thiazolidinediones cause fluid retention and increase HF hospitalisation. Replace with an SGLT2 inhibitor or GLP-1 RA.",
          facts: [medFact(m), src("ESC diabetes & CVD 2023 · Class III · ADA 2026 §10")], missing: [],
          action: { type: "med-action", medicationId: m.id, action: "stop", label: `Stop ${m.name.toLowerCase()}` } });
      for (const m of on(s, "dpp4-hf"))
        out.push({ key: `dpp4:${m.code}`, signature: m.id, severity: "orange", title: `${m.name} in heart failure: switch`,
          detail: "Associated with HF hospitalisation. If a DPP-4 inhibitor is still needed, sitagliptin or linagliptin are neutral for HF.",
          facts: [medFact(m), src(m.code === "saxagliptin" ? "ESC diabetes & CVD 2023 · Class III" : "ADA 2026 §10 · FDA HF warning")], missing: [],
          action: { type: "med-action", medicationId: m.id, action: "stop", label: `Stop ${m.name.toLowerCase()}` } });
      return out;
    },
  },
  {
    id: "dm.metformin-renal",
    kind: "clinical",
    title: "Metformin and kidney function",
    inputs: ["meds", "egfr"],
    defaultParams: { egfr_stop: 30, egfr_reduce: 45, max_daily_reduced_mg: 1000, days: 180 },
    evidence: "Metformin SmPC and ADA 2026 §9: contraindicated with eGFR <30; eGFR 30–44 do not start and limit to 1000 mg/day.",
    evaluate(s, p) {
      const met = on(s, "metformin")[0];
      const e = within(s, "egfr", Number(p.days));
      if (!met || !e) return [];
      if (e.value_num! < Number(p.egfr_stop))
        return [{ key: "met-stop", signature: `${e.id}:${met.id}`, severity: "red", title: `Metformin with eGFR ${Math.round(e.value_num!)}: stop`,
          detail: "Contraindicated below eGFR 30 (lactic acidosis risk).", facts: facts(f(e, "red"), medFact(met), src("Metformin SmPC · ADA 2026 §9")), missing: [],
          action: { type: "med-action", medicationId: met.id, action: "stop", label: "Stop metformin" } }];
      const daily = dailyDose(met);
      if (e.value_num! < Number(p.egfr_reduce) && daily != null && daily > Number(p.max_daily_reduced_mg))
        return [{ key: "met-dose", signature: `${e.id}:${met.id}:${daily}`, severity: "orange", title: `Metformin ${formatNumber(daily)} mg/day with eGFR ${Math.round(e.value_num!)}: reduce`,
          detail: `With eGFR 30–44 the maximum is ${p.max_daily_reduced_mg} mg/day. Recheck eGFR every 3–6 months.`, facts: facts(f(e, "orange"), medFact(met), src("Metformin SmPC · ADA 2026 §9")), missing: [],
          action: { type: "med-action", medicationId: met.id, action: "decrease", label: "Reduce metformin" } }];
      return [];
    },
  },
  {
    id: "dm.hypo-risk",
    kind: "clinical",
    title: "Hypoglycaemia risk from sulfonylurea or insulin",
    inputs: ["meds", "hba1c", "egfr", "conditions"],
    defaultParams: { egfr_low: 30, days: 180 },
    evidence: "ADA 2026 §9 and §13: glibenclamide carries the highest hypoglycaemia risk; deintensify sulfonylureas/insulin with advanced CKD or after severe hypoglycaemia; prefer agents without hypoglycaemia. Sulfonylureas avoided with eGFR <30 (labels).",
    evaluate(s, p) {
      const drugs = on(s, "sulfonylurea", "insulin");
      if (!drugs.length) return [];
      const e = within(s, "egfr", 365), a1c = within(s, "hba1c", Number(p.days));
      const reasons: string[] = [];
      const glib = drugs.find((m) => m.tags.includes("glibenclamide"));
      if (s.tags.has("severe-hypo")) reasons.push("severe hypoglycaemia in the past year");
      if (glib) reasons.push("long-acting sulfonylurea");
      if (e && e.value_num! < Number(p.egfr_low) && on(s, "sulfonylurea").length) reasons.push(`sulfonylurea with eGFR ${Math.round(e.value_num!)}`);
      if (!reasons.length) return [];
      const orange = s.tags.has("severe-hypo") || !!glib;
      return [{
        key: "hypo-risk", signature: `${drugs.map((m) => m.id).join(",")}:${reasons.join("|")}`, severity: orange ? "orange" : "yellow",
        title: `Hypoglycaemia risk on ${drugs.map((m) => m.name.toLowerCase()).join(" and ")}: ${reasons[0]}`,
        detail: glib ? "Switch glibenclamide to gliclazide, or to an agent without hypoglycaemia (SGLT2i, GLP-1 RA, DPP-4i)." : "Consider reducing the sulfonylurea or insulin, or switching to agents without hypoglycaemia.",
        facts: facts(...drugs.map(medFact), f(a1c), f(e), reasons.length > 1 && { label: "Also", value: reasons.slice(1).join(" · ") }, src("ADA 2026 §9, §13")),
        missing: [], action: { type: "wizard", wizard: "diabetes" },
      }];
    },
  },
  {
    id: "dm.dpp4-with-glp1",
    kind: "clinical",
    title: "DPP-4 inhibitor with a GLP-1 receptor agonist",
    inputs: ["meds"],
    defaultParams: {},
    evidence: "ADA 2026 §9: no added glucose lowering from a DPP-4 inhibitor on top of a GLP-1 RA; stop the DPP-4 inhibitor.",
    evaluate(s) {
      const d = on(s, "dpp4")[0], g = on(s, "glp1")[0];
      if (!d || !g) return [];
      return [{ key: "dpp4-glp1", signature: `${d.id}:${g.id}`, severity: "yellow", title: `${d.name} with ${g.name.toLowerCase()}: stop the DPP-4 inhibitor`,
        detail: "Same pathway; no added benefit, extra cost and tablets.", facts: [medFact(d), medFact(g), src("ADA 2026 §9")], missing: [],
        action: { type: "med-action", medicationId: d.id, action: "stop", label: `Stop ${d.name.toLowerCase()}` } }];
    },
  },
  {
    id: "dm.annual-checks",
    kind: "clinical",
    title: "Annual eye and foot checks in diabetes",
    inputs: ["conditions", "plan"],
    defaultParams: { days: 365 },
    evidence: "ADA 2026 §12: retinal screening and comprehensive foot examination at least yearly. Kidney screening (eGFR, UACR) is covered by cardiorenal.screening.",
    evaluate(s, p) {
      if (!diabetesRecord(s)) return [];
      const covered = (re: RegExp) =>
        s.plan.some((a) => re.test(a.title) && (a.status === "planned" || (a.status === "completed" && a.completed_at && daysBetween(a.completed_at, s.today) <= Number(p.days))));
      const eyes = !covered(/retina/i), feet = !covered(/foot/i);
      if (!eyes && !feet) return [];
      const missing = [eyes && "retinal screening", feet && "foot examination"].filter(Boolean) as string[];
      return [{ key: "annual", signature: missing.join(","), severity: "yellow", title: `Diabetes annual check due: ${missing.join(" and ")}`,
        detail: "Not recorded in the past year.", facts: [src("ADA 2026 §12 · yearly")], missing: [],
        action: eyes && feet ? { type: "wizard", wizard: "diabetes" } : { type: "add-plan", template: eyes ? "dm-eyes" : "dm-feet" } }];
    },
  },
  {
    id: "dm.sglt2-before-procedure",
    kind: "clinical",
    title: "SGLT2 inhibitor before a procedure",
    inputs: ["meds", "plan"],
    defaultParams: { hold_days: 3, window_days: 7 },
    evidence: "ADA 2026 §16 and FDA labels: stop SGLT2 inhibitors 3 days before scheduled surgery (4 days for ertugliflozin) because of euglycaemic DKA; restart when eating and drinking.",
    evaluate(s, p) {
      const sg = on(s, "sglt2")[0];
      if (!sg) return [];
      const proc = s.plan
        .filter((a) => a.status === "planned" && a.category === "procedure" && a.due_date && daysBetween(s.today, a.due_date) >= 0 && daysBetween(s.today, a.due_date) <= Number(p.window_days))
        .sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
      if (!proc) return [];
      return [{ key: "sglt2-proc", signature: `${proc.id}:${sg.id}`, severity: "yellow", title: `${proc.title} on ${fmtDay(proc.due_date!)}: hold ${sg.name.toLowerCase()} ${p.hold_days} days before`,
        detail: "Euglycaemic DKA risk with fasting and surgery. Restart once eating and drinking normally.", facts: [medFact(sg), { label: "Procedure", value: proc.title, date: proc.due_date! }, src("ADA 2026 §16")], missing: [],
        action: { type: "med-action", medicationId: sg.id, action: "hold", label: `Hold ${sg.name.toLowerCase()}` } }];
    },
  },
];
