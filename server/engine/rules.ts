import { PREGNANCY_RULES } from "./pregnancy-rules.js";
import { AORTA_RULES } from "./aorta-rules.js";
import { SYNCOPE_RULES } from "./syncope-rules.js";
import { renalReview, RENAL_REVIEW_PARAMS } from "./renal-review.js";
import { exposureChange } from "../../shared/medication-exposure.js";
// The rules engine. Rule LOGIC is code (reviewable, testable); rule THRESHOLDS and
// wording are versioned parameters in cf.rule_version with a governance status.
// Production sites run PUBLISHED versions only. Sandbox sites may run versions that
// are still in review, and every output carries that status so it is labelled.
import { MEASURES, MEDICATION, formatNumber, formatRange } from "../../shared/catalog.js";
import { daysBetween, fmtDay, planStatusView } from "../../shared/clinical.js";
import { latestDischarge, medsWithTag, series, type PatientState } from "../kernel/state.js";
import { LAB_RULES } from "./lab-rules.js";
import { GUIDELINE_RULES } from "./guidelines.js";
import { STUDY_RULES, crtClass } from "./study-rules.js";
import { ENCOUNTER_RULES } from "./encounter-rules.js";
import { COMPLICATION_RULES } from "./complication-rules.js";
import { ACUTE_RULES } from "./acute-rules.js";
import { DIABETES_RULES } from "./diabetes-rules.js";
import { HF_RULES } from "./hf-rules.js";
import { EPISODE_RULES } from "./episode-rules.js";
import { CAD_RULES } from "./cad-rules.js";
import { CAD_TEST_RULES } from "./cad-tests.js";
import { RHYTHM_RULES } from "./rhythm-rules.js";
import { VALVE_RULES } from "./valve-rules.js";
import { HYPERTENSION_RULES } from "./hypertension-rules.js";
import { STRUCTURAL_RULES } from "./structural-rules.js";
import { CMP_RULES } from "./cmp-rules.js";
import { PH_RULES } from "./ph-rules.js";
import { MED_RULES } from "./med-rules.js";
import { latestStudy } from "../kernel/state.js";

export type Fact = { label: string; value: string; date?: string; tone?: "red" | "orange" | "yellow" | "blue" | "green" };
export type Finding = {
  key: string; // stable identity of this finding within the rule
  signature: string; // changes when the underlying data changes → supersedes the old recommendation
  severity: "red" | "orange" | "yellow" | "blue";
  title: string;
  detail: string;
  facts: Fact[];
  missing: string[];
  action:
    | { type: "wizard"; wizard: string }
    | { type: "plan"; planId: string }
    | { type: "add-plan"; template: string; medicationId?: string }
    | { type: "tab"; tab: string }
    | { type: "start-med"; code: string; dose?: number; label: string }
    | { type: "titrate"; medicationId: string; dose: number; direction: "increase" | "decrease"; label: string }
    | { type: "add-labs"; codes: string[]; label: string }
    | { type: "med-correct"; medicationId: string; label: string }
    | { type: "med-action"; medicationId: string; action?: "stop" | "hold" | "decrease" | "resume"; label: string }
    | { type: "history"; focus: "risk" | "cardiac"; label: string }
    | { type: "edit-dx"; code: string; label: string }
    | { type: "pregnancy-context"; label:string };
  // guideline provenance shown in "Why?"
  source?: string;
};
export type RuleDef = {
  id: string;
  kind: "clinical" | "operational";
  title: string;
  // data this rule reads; a change to any of them triggers re-evaluation
  inputs: string[];
  defaultParams: Record<string, number | string>;
  evidence: string;
  evaluate(state: PatientState, params: Record<string, any>): Finding[];
};

const v = (code: string, value: number | null | undefined) => {
  if (value == null) return "—";
  const def = MEASURES[code];
  return `${formatNumber(value, def?.decimals ?? 0)}${def?.unit ? " " + def.unit : ""}`;
};
const day = (iso: string) => fmtDay(iso);

import { RENAL_DEFAULTS, creatinineTrend } from "./renal-trend.js";
export const RULES: RuleDef[] = [
  ...PREGNANCY_RULES,
  ...AORTA_RULES, ...SYNCOPE_RULES,
  {
    id: "hf.hyperkalaemia-review",
    kind: "clinical",
    title: "Hyperkalaemia review",
    inputs: ["potassium", "creatinine", "egfr", "meds"],
    defaultParams: { review_threshold_mmol: 5.5 },
    evidence: "ESC HF 2021 practical guidance on MRA and RAAS inhibitors (retained 2023/2026): potassium >5.5 mmol/L needs dose reduction and review; >6.0 stop. ESC/ERA CVD–CKD 2026: manage hyperkalaemia to keep cardiorenal therapy.",
    evaluate(s, p) {
      const k = s.resolved("potassium");
      const cur = k.current;
      // ESC: act above 5.5 mmol/L (5.5 itself is not yet "above")
      if (!cur || cur.value_num == null || cur.value_num <= Number(p.review_threshold_mmol)) return [];
      const hist = k.history.slice(0, 3).reverse();
      const raas = s.meds.filter((m) => m.status === "active" && (m.tags.includes("raas") || m.tags.includes("potassium-sparing")));
      const cr = s.resolved("creatinine").current;
      const egfr = s.resolved("egfr").current;
      const missing: string[] = [];
      if (!cr || Math.abs(daysBetween(cr.effective_at, cur.effective_at)) > 7) missing.push("Creatinine within 7 days of this potassium");
      return [
        {
          key: "k",
          // Re-exposure after this result needs a fresh decision. Holding treatment
          // does not invalidate a decision that just instructed that hold.
          signature: [cur.id, ...s.meds.filter(m => m.tags.includes("raas") || m.tags.includes("potassium-sparing")).flatMap(m => [...m.events.filter((e, i) => {
            const prior = m.events.slice(0, i).reverse();
            const dose = prior.find(x => x.dose_value != null)?.dose_value ?? null;
            const frequency = prior.find(x => x.frequency)?.frequency ?? null;
            return e.effective_at >= cur.effective_at && (["start", "restart", "resume", "increase"].includes(e.kind) || (e.kind === "continue" && ["increase", "unknown"].includes(exposureChange(dose, frequency, e.dose_value ?? dose, e.frequency ?? frequency))));
          }).map(e => e.id), ...(m.status === "active" ? (s.medicationCorrections ?? []).filter(c => c.medication_id === m.id && c.recorded_at >= cur.effective_at && (["hold", "stop", "not_taking"].includes(c.kind) || ["increase", "unknown"].includes(exposureChange(c.beforeDose ?? null, c.beforeFrequency ?? null, m.doseValue, m.frequency)))).map(c => c.id) : [])]).sort()].join(":"),
          severity: "red",
          // an old result is still the latest: say how old, so it is rechecked rather than acted on blindly
          title: `Potassium ${v("potassium", cur.value_num)}${hist.length > 1 && hist[hist.length - 1].value_num! > hist[0].value_num! ? " and rising" : ""}${daysBetween(cur.effective_at, s.today) > 14 ? ` (result from ${day(cur.effective_at)} — recheck)` : ""}`,
          detail:
            (hist.length > 1 ? hist.map((o) => formatNumber(o.value_num!, 1)).join(" → ") + " · " : "") +
            (raas.length ? "on " + raas.map((m) => m.name.toLowerCase()).join(" and ") : "no RAAS or MRA therapy recorded"),
          facts: [
            ...hist.map((o) => ({ label: "Potassium", value: v("potassium", o.value_num), date: o.effective_at, tone: (o.id === cur.id ? "red" : undefined) as Fact["tone"] })),
            ...(cr ? [{ label: "Creatinine", value: v("creatinine", cr.value_num), date: cr.effective_at }] : []),
            ...(egfr ? [{ label: "eGFR", value: v("egfr", egfr.value_num), date: egfr.effective_at }] : []),
            ...raas.map((m) => ({ label: "Therapy", value: `${m.name}${m.startedAt ? " · since " + day(m.startedAt) : ""}` })),
            { label: "Trigger", value: `K > ${p.review_threshold_mmol} mmol/L` },
          ],
          missing,
          action: { type: "wizard", wizard: "hyperkalaemia" },
        },
      ];
    },
  },
  {
    id: "hf.worsening-renal-function",
    kind: "clinical",
    title: "Creatinine rise on RAAS / MRA therapy",
    inputs: ["creatinine", "egfr", "weight", "meds"],
    defaultParams: RENAL_REVIEW_PARAMS,
    evidence: "ESC HF practical guidance (2016 web addenda, retained 2021/2023) for ACEi/ARB/ARNI: a creatinine rise of up to 50% above baseline, or to 266 µmol/L (3.0 mg/dL) / eGFR 25, whichever is smaller, is acceptable; above that, halve the dose and recheck; a rise >100% or to >310 µmol/L (3.5 mg/dL) / eGFR <20: stop and seek advice. MRA: creatinine >221 µmol/L (2.5 mg/dL) or eGFR <30 halve; >310 µmol/L or eGFR <20 stop. Baseline = the last creatinine before the most recent start or dose increase of these drugs (else the oldest result since, within a year). An eGFR limit counts only when crossed.",
    evaluate: renalReview,
  },
  {
    id: "hf.lvef-change",
    kind: "clinical",
    title: "LVEF category change",
    inputs: ["lvef"],
    defaultParams: {},
    evidence: "2026 ESC HF guidelines: HFrEF = LVEF <50%, HFpEF ≥50%; LVEF ≤35% is the device threshold. Continue foundational therapy when EF improves.",
    evaluate(s) {
      const hist = s.resolved("lvef").history.filter((o) => o.status === "final");
      if (hist.length < 2) return [];
      const now = s.resolved("lvef").current!;
      const older = hist.filter((o) => o.effective_at < now.effective_at);
      const before = older.find((o) => o.quality === "formal") ?? older[0];
      if (!before) return [];
      const cat = (x: number) => (x <= 35 ? "≤35% (device range)" : x < 50 ? "36–49% (reduced, above the device threshold)" : "≥50%");
      if (cat(now.value_num!) === cat(before.value_num!)) return [];
      if (Math.abs(daysBetween(now.effective_at, s.today)) > 60) return [];
      return [
        {
          key: "ef",
          signature: now.id,
          severity: "blue",
          title: `LVEF ${formatRange(before.value_num!, before.value_high, 0)}% → ${formatRange(now.value_num!, now.value_high, 0)}%: review HF classification and plan`,
          detail: `Now ${cat(now.value_num!)}. Recheck device plans; keep foundational therapy (withdrawal risks relapse).`,
          facts: [
            { label: "Previous LVEF", value: `${formatNumber(before.value_num!, 0)}%`, date: before.effective_at },
            { label: "Current LVEF", value: `${formatNumber(now.value_num!, 0)}%`, date: now.effective_at, tone: "blue" },
          ],
          missing: [],
          action: { type: "tab", tab: "plan" },
        },
      ];
    },
  },
  {
    id: "ops.monitoring-after-change",
    kind: "operational",
    title: "Monitoring after starting or increasing a RAAS/MRA drug",
    inputs: ["potassium", "creatinine", "meds", "plan"],
    defaultParams: { window_days: 30 },
    evidence: "Workflow safeguard: a drug that needs renal/K monitoring should have a result or a planned check after each change.",
    evaluate(s, p) {
      const out: Finding[] = [];
      for (const m of s.meds.filter((m) => m.status === "active" && (m.tags.includes("raas") || m.tags.includes("mra")))) {
        const change = [...m.events].reverse().find((e) => e.kind === "start" || e.kind === "increase" || e.kind === "restart");
        if (!change || daysBetween(change.effective_at, s.today) > Number(p.window_days)) continue;
        const after = ["potassium", "creatinine"].every(code => s.observations.some((o) => o.code === code && o.effective_at > change.effective_at && o.status === "final" && daysBetween(o.effective_at, s.today) >= 0));
        const planned = s.plan.some((a) => a.status === "planned" && a.due_date != null && a.due_date >= s.today && a.completes_on?.type === "lab" && ["potassium", "creatinine"].every(code => a.completes_on.codes?.includes(code)));
        if (after || planned) continue;
        out.push({
          key: "mon-" + m.id,
          signature: change.id,
          severity: "orange",
          title: `No renal/K check planned after ${m.name.toLowerCase()} ${change.kind === "start" ? "start" : "change"}`,
          detail: `${change.kind === "start" ? "Started" : "Changed"} ${day(change.effective_at)} · both verified potassium and creatinine are needed after the change, or a paired check booked`,
          facts: [{ label: "Change", value: `${m.name} ${change.kind}`, date: change.effective_at }],
          missing: ["Planned potassium and creatinine check"],
          action: { type: "add-plan", template: "renal-k", medicationId: m.id },
        });
      }
      return out;
    },
  },
  {
    id: "ops.plan-due",
    kind: "operational",
    title: "Planned actions due or overdue",
    inputs: ["plan"],
    defaultParams: {},
    evidence: "Workflow: every plan action with a date is tracked until it happens.",
    evaluate(s) {
      return s.plan
        .filter((a) => a.status === "planned" && a.due_date && a.due_date <= s.today)
        .map((a) => {
          const state = planStatusView(a.status, a.due_date, s.today);
          const late = daysBetween(a.due_date!, s.today);
          const ctx = s.contexts.find((c) => c.id === a.source_context_id);
          return {
            key: "plan-" + a.id,
            signature: `${a.id}:${a.version}:${state}`,
            severity: "yellow" as const,
            title: state === "overdue" ? `${a.title} overdue` : `${a.title} due today`,
            detail:
              (ctx ? `From ${ctx.kind === "admission" ? (ctx.ended_at ? "discharge plan" : "admission plan") : "visit plan"} ${day(ctx.ended_at ?? ctx.started_at)} · ` : "") +
              (state === "overdue" ? `due ${day(a.due_date!)} · ${late} day${late === 1 ? "" : "s"} overdue` : "due today"),
            facts: [{ label: "Due", value: fmtDay(a.due_date!, { weekday: true }) }],
            missing: [],
            action: { type: "plan" as const, planId: a.id },
          };
        });
    },
  },
  {
    id: "meds.not-taking",
    kind: "operational",
    title: "Prescribed medicine not being taken",
    inputs: ["meds"],
    defaultParams: {},
    evidence: "Workflow: a prescribed medicine the patient reports not taking is shown until the record matches reality (taken again, changed or stopped). Disease-modifying and antithrombotic drugs are flagged orange.",
    evaluate(s) {
      const key = ["bb", "raas", "arni", "mra", "sglt2", "oac", "p2y12", "antiplatelet", "statin", "glp1"];
      return s.meds
        .filter((m) => m.status === "not_taking")
        .map((m) => {
          const e = [...m.events].reverse().find((x) => x.kind === "not_taking")!;
          return {
            key: "nt-" + m.id,
            signature: e.id,
            severity: m.tags.some((t) => key.includes(t)) ? ("orange" as const) : ("yellow" as const),
            title: `${m.name} prescribed but not taken${e.reason ? `: ${e.reason.toLowerCase()}` : ""}`,
            detail: "Address the reason, then mark it taken again, change it or stop it so the record matches what the patient takes.",
            facts: [{ label: "Prescribed", value: `${m.name}${m.doseValue != null ? " " + formatNumber(m.doseValue) + " " + (m.doseUnit ?? "") : ""} ${m.frequency ?? ""}`.trim() }, { label: "Reported not taking", value: e.reason || "reason not given", date: e.effective_at }],
            missing: [],
            action: { type: "med-action" as const, medicationId: m.id, label: "Update medicine" },
          };
        });
    },
  },
  ...LAB_RULES,
  ...GUIDELINE_RULES,
  ...STUDY_RULES,
  ...ENCOUNTER_RULES,
  ...COMPLICATION_RULES,
  ...ACUTE_RULES,
  ...DIABETES_RULES,
  ...HF_RULES,
  ...EPISODE_RULES,
  ...CAD_RULES,
  ...CAD_TEST_RULES,
  ...RHYTHM_RULES,
  ...VALVE_RULES,
  ...STRUCTURAL_RULES,
  ...HYPERTENSION_RULES,
  ...CMP_RULES,
  ...PH_RULES,
  ...MED_RULES,
];

// Bump when rule logic changes so every patient is re-evaluated once on the next boot.
export const RULESET = "2026-10-20.clinic3";

export const RULE = Object.fromEntries(RULES.map((r) => [r.id, r]));

// Used by "what changed" and wizard context
export function recentRaasStart(s: PatientState, days = 30) {
  return s.meds.some(
    (m) =>
      m.status !== "stopped" &&
      m.tags.includes("raas") &&
      m.events.some((e) => (e.kind === "start" || e.kind === "increase") && daysBetween(e.effective_at, s.today) <= days),
  );
}
export { latestDischarge, medsWithTag, MEDICATION };
