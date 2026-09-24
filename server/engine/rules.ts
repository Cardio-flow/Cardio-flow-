// The rules engine. Rule LOGIC is code (reviewable, testable); rule THRESHOLDS and
// wording are versioned parameters in cf.rule_version with a governance status.
// Production sites run PUBLISHED versions only. Sandbox sites may run versions that
// are still in review, and every output carries that status so it is labelled.
import { MEASURES, MEDICATION, formatNumber } from "../../shared/catalog.js";
import { daysBetween, fmtDay, planStatusView } from "../../shared/clinical.js";
import { latestDischarge, medsWithTag, series, type PatientState } from "../kernel/state.js";
import { GUIDELINE_RULES } from "./guidelines.js";

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
    | { type: "add-labs"; codes: string[]; label: string };
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

export const RULES: RuleDef[] = [
  {
    id: "hf.hyperkalaemia-review",
    kind: "clinical",
    title: "Hyperkalaemia review",
    inputs: ["potassium", "creatinine", "meds"],
    defaultParams: { review_threshold_mmol: 5.5 },
    evidence: "Candidate from HF Clinical Review Pack (ESC HF guideline; ESC CVD/CKD). Threshold is a sandbox value pending clinical review.",
    evaluate(s, p) {
      const k = s.resolved("potassium");
      const cur = k.current;
      if (!cur || cur.value_num == null || cur.value_num < Number(p.review_threshold_mmol)) return [];
      const hist = k.history.slice(0, 3).reverse();
      const raas = s.meds.filter((m) => m.status === "active" && (m.tags.includes("raas") || m.tags.includes("potassium-sparing")));
      const cr = s.resolved("creatinine").current;
      const egfr = s.resolved("egfr").current;
      const missing: string[] = [];
      if (!cr || Math.abs(daysBetween(cr.effective_at, cur.effective_at)) > 7) missing.push("Creatinine within 7 days of this potassium");
      return [
        {
          key: "k",
          signature: cur.id,
          severity: "red",
          title: `Potassium ${v("potassium", cur.value_num)}${hist.length > 1 && hist[hist.length - 1].value_num! > hist[0].value_num! ? " and rising" : ""}`,
          detail:
            (hist.length > 1 ? hist.map((o) => formatNumber(o.value_num!, 1)).join(" → ") + " · " : "") +
            (raas.length ? "on " + raas.map((m) => m.name.toLowerCase()).join(" and ") : "no RAAS or MRA therapy recorded"),
          facts: [
            ...hist.map((o) => ({ label: "Potassium", value: v("potassium", o.value_num), date: o.effective_at, tone: (o.id === cur.id ? "red" : undefined) as Fact["tone"] })),
            ...(cr ? [{ label: "Creatinine", value: v("creatinine", cr.value_num), date: cr.effective_at }] : []),
            ...(egfr ? [{ label: "eGFR", value: v("egfr", egfr.value_num), date: egfr.effective_at }] : []),
            ...raas.map((m) => ({ label: "Therapy", value: `${m.name}${m.startedAt ? " · since " + day(m.startedAt) : ""}` })),
            { label: "Trigger", value: `K ≥ ${p.review_threshold_mmol} mmol/L` },
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
    title: "Worsening renal function review",
    inputs: ["creatinine", "egfr", "weight", "meds"],
    defaultParams: { baseline_days: 90, relative_rise: 0.25, absolute_rise_umol: 26.5 },
    evidence: "Candidate from HF Clinical Review Pack. Baseline window and rise criteria are sandbox values pending clinical review.",
    evaluate(s, p) {
      const cr = s.resolved("creatinine");
      const cur = cr.current;
      if (!cur || cur.value_num == null) return [];
      const prior = cr.history.filter((o) => o.id !== cur.id && o.effective_at < cur.effective_at && daysBetween(o.effective_at, cur.effective_at) <= Number(p.baseline_days));
      if (!prior.length) return [];
      const baseline = prior.reduce((a, b) => (b.value_num! < a.value_num! ? b : a));
      const rise = cur.value_num - baseline.value_num!;
      const rel = rise / baseline.value_num!;
      if (rise < Number(p.absolute_rise_umol) && rel < Number(p.relative_rise)) return [];
      const egfr = s.resolved("egfr");
      const wt = series(s, "weight");
      const facts: Fact[] = [
        { label: "Creatinine baseline", value: v("creatinine", baseline.value_num), date: baseline.effective_at },
        { label: "Creatinine now", value: v("creatinine", cur.value_num), date: cur.effective_at, tone: "orange" },
      ];
      if (egfr.current) facts.push({ label: "eGFR", value: v("egfr", egfr.current.value_num), date: egfr.current.effective_at });
      if (wt.length > 1) facts.push({ label: "Weight", value: `${formatNumber(wt[wt.length - 1].value_num!, 1)} → ${formatNumber(wt[0].value_num!, 1)} kg` });
      for (const m of s.meds.filter((m) => m.status === "active" && (m.tags.includes("raas") || m.tags.includes("sglt2") || m.tags.includes("loop"))))
        facts.push({ label: "Therapy", value: `${m.name}${m.lastChange ? " · " + m.lastChange.kind + " " + day(m.lastChange.effective_at) : ""}` });
      return [
        {
          key: "cr",
          signature: cur.id,
          severity: "orange",
          title: `Creatinine up ${Math.round(rel * 100)}% from baseline`,
          detail: `${formatNumber(baseline.value_num!, 0)} → ${formatNumber(cur.value_num, 0)} µmol/L` + (egfr.current ? ` · eGFR ${formatNumber(egfr.current.value_num!, 0)}` : ""),
          facts,
          missing: [],
          action: { type: "wizard", wizard: "renal-function" },
        },
      ];
    },
  },
  {
    id: "hf.device-assessment",
    kind: "clinical",
    title: "ICD/CRT assessment relevance",
    inputs: ["lvef", "conditions"],
    defaultParams: { lvef_threshold: 35 },
    evidence: "Candidate hf.icd-assessment / hf.crt-assessment (ESC HF). Threshold is a sandbox value pending clinical review; never an implant recommendation.",
    evaluate(s, p) {
      if (!s.tags.has("hf")) return [];
      const ef = s.resolved("lvef").current;
      if (!ef || ef.value_num == null || ef.value_num > Number(p.lvef_threshold)) return [];
      if (s.plan.some((a) => a.status === "planned" && /ICD|CRT|device/i.test(a.title))) return [];
      return [
        {
          key: "device",
          signature: ef.id,
          severity: "blue",
          title: `LVEF ${formatNumber(ef.value_num, 0)}%: ICD/CRT assessment may become relevant`,
          detail: "Reassess on a repeat Echo after optimised therapy. This is not an implant recommendation.",
          facts: [
            { label: "LVEF", value: `${formatNumber(ef.value_num, 0)}% (${ef.quality})`, date: ef.effective_at },
            { label: "Trigger", value: `LVEF ≤ ${p.lvef_threshold}%` },
          ],
          missing: s.observations.some((o) => o.code === "qrs") ? [] : ["QRS duration and morphology"],
          action: { type: "add-plan", template: "device" },
        },
      ];
    },
  },
  {
    id: "hf.lvef-change",
    kind: "clinical",
    title: "LVEF category change",
    inputs: ["lvef"],
    defaultParams: {},
    evidence: "2026 ESC HF guidelines: HFrEF = LVEF <50%, HFpEF ≥50%; LVEF ≤35% is the device threshold. Continue foundational therapy when EF improves. Pending clinical review.",
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
          title: `LVEF ${formatNumber(before.value_num!, 0)}% → ${formatNumber(now.value_num!, 0)}%: review HF classification and plan`,
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
        const after = s.observations.some((o) => (o.code === "potassium" || o.code === "creatinine") && o.effective_at > change.effective_at && o.status !== "entered_in_error");
        const planned = s.plan.some((a) => a.status === "planned" && a.completes_on?.type === "lab" && a.completes_on.codes?.includes("potassium"));
        if (after || planned) continue;
        out.push({
          key: "mon-" + m.id,
          signature: change.id,
          severity: "orange",
          title: `No renal/K check planned after ${m.name.toLowerCase()} ${change.kind === "start" ? "start" : "change"}`,
          detail: `${change.kind === "start" ? "Started" : "Changed"} ${day(change.effective_at)} · no later potassium or creatinine and no check booked`,
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
              (ctx ? `From ${ctx.kind === "admission" ? "discharge plan" : "visit plan"} ${day(ctx.ended_at ?? ctx.started_at)} · ` : "") +
              (state === "overdue" ? `due ${day(a.due_date!)} · ${late} day${late === 1 ? "" : "s"} overdue` : "due today"),
            facts: [{ label: "Due", value: fmtDay(a.due_date!, { weekday: true }) }],
            missing: [],
            action: { type: "plan" as const, planId: a.id },
          };
        });
    },
  },
  ...GUIDELINE_RULES,
];

// Bump when rule logic changes so every patient is re-evaluated once on the next boot.
export const RULESET = "2026-09-24.2";

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
