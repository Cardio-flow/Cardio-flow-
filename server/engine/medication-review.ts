import { pregnancyProfile } from "./pregnancy-profile.js";
import type { PatientState } from "../kernel/state.js";
import { monitoringDue, monContext } from "./med-rules.js";
import { monitoringFor } from "../../shared/drug-monitoring.js";
import { facts } from "./med-safety.js";
import { localDay, daysBetween } from "../../shared/clinical.js";
import type {
  MedicationCheck,
  MedicationReviewContext,
} from "../../shared/medication-review.js";

// Reuse the medicine-specific schedules; do not create a second threshold engine.
export function medicationReviewContext(
  s: PatientState,
): MedicationReviewContext {
  const checks = new Map<string, MedicationCheck>();
  for (const m of s.meds.filter((m) => m.status === "active")) {
    const c = monContext(s, m);
    for (const check of monitoringFor(m.code, m.tags)) {
      if (check.when && !check.when(c)) continue;
      const due = monitoringDue(s, m, check);
      if (!due) continue;
      const target = check.target;
      // Reuse future appointments and expose overdue ones through their existing plan action.
      // Keep panels whole: both verified renal/K results are required for a paired check.
      const covered = s.plan.some(
        (p) =>
          p.status === "planned" &&
          ("study" in target
            ? p.completes_on?.type === "study" &&
              p.completes_on.kind === target.study
            : p.completes_on?.type === "lab" &&
              target.lab.every((code) => p.completes_on.codes?.includes(code))),
      );
      if (covered) continue;
      const id = "study" in target ? target.study : "bloods";
      const row = checks.get(id) ?? {
        id,
        title:
          "study" in target ? check.what : "Medication monitoring blood tests",
        ...("study" in target
          ? { study: target.study }
          : { codes: [] as string[] }),
        medicines: [],
        sources: [],
      };
      if ("lab" in target)
        row.codes = [...new Set([...row.codes!, ...target.lab])];
      if (!row.medicines.includes(m.name)) row.medicines.push(m.name);
      if (!row.sources.includes(check.source)) row.sources.push(check.source);
      checks.set(id, row);
    }
  }
  return { checks: [...checks.values()] };
}

const MEDICATION_RULES = new Set([
  "af.doac-dose",
  "valve.doac-contraindicated",
  "ops.monitoring-after-change",
  "hf.hyperkalaemia-review",
  "hf.worsening-renal-function",
  "hf.rechallenge-after-hold",
  "safety.bleeding",
  "safety.inr",
  "safety.digoxin",
  "event.amiodarone-thyroid",
  "lab.liver-enzymes",
  "lab.statin-ck",
]);
export function medicationReview(s: PatientState, attention: any[]) {
  const live = s.meds.filter((m) =>
    ["active", "held", "not_taking"].includes(m.status),
  );
  const f = facts(s);
  const monitoring = medicationReviewContext(s);
  const pregnant=s.conditions.some(c=>c.code === "pregnancy-care" && c.attributes.phase === "Pregnant");
  const rows = attention.filter(
    (a) =>
      a.rule_id.startsWith("med.") ||
      a.rule_id === "meds.not-taking" ||
      ["start-med", "titrate", "med-action", "med-correct"].includes(
        a.action?.type,
      ) ||
      MEDICATION_RULES.has(a.rule_id) || a.rule_id === "pregnancy.care" && pregnancyProfile(s).medicationFlags.length>0,
  );
  // One actionable row per pathway; all supporting findings remain available in Why.
  const seen = new Map<string, any>();
  for (const original of rows) {
    const row =
      (original.rule_id === "med.monitoring" || original.rule_id === "event.amiodarone-thyroid" && !s.resolved("tsh").current && monitoring.checks.some(c=>c.codes?.includes("tsh"))) && monitoring.checks.length
        ? {
            ...original,
            title: "Medication monitoring is due",
            action: {
              type: "wizard",
              wizard: "medication-monitoring",
              standalone: true,
            },
          }
        : original;
    const key =
      row.action?.type === "wizard" ? `wizard:${row.action.wizard}` : row.id;
    const old = seen.get(key);
    if (old) old.related.push(row);
    else
      seen.set(key, {
        ...row,
        group:
          row.severity === "blue"
            ? "optimization"
            : row.rule_id === "med.regimen" || row.rule_id === "meds.not-taking"
              ? "regimen"
              : row.rule_id === "med.monitoring" ||
                  row.rule_id === "ops.monitoring-after-change"
                ? "monitoring"
                : "safety",
        related: [],
      });
  }
  const cr = s.resolved("creatinine").current;
  const wt = s.resolved("weight").current;
  return {
    counts: {
      active: live.filter((m) => m.status === "active").length,
      held: live.filter((m) => m.status === "held").length,
      notTaking: live.filter((m) => m.status === "not_taking").length,
    },
    renal:
      pregnant || f.crcl == null || cr?.status !== "final" || wt?.status !== "final" || daysBetween(cr.effective_at,s.today)>180 || daysBetween(wt.effective_at,s.today)>365
        ? null
        : {
            value: Math.round(f.crcl),
            creatinineAt: cr ? localDay(cr.effective_at) : null,
            weightAt: wt ? localDay(wt.effective_at) : null,
          },
    renalNote:pregnant?"Pregnancy: use creatinine and specialist renal assessment; estimated filtration is not a dosing validation.":null,
    issues: [...seen.values()],
    ...monitoring,
    appointments: s.plan
      .filter((p) => p.status === "planned" && p.category === "monitoring")
      .map((p) => ({ id: p.id, title: p.title, dueDate: p.due_date })),
  };
}
