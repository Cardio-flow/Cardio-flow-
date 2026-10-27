import { isRoutine, isRoutinePlan } from "./routine.js";
import { problemOfRule } from "./overview.js";

// A projection of existing recommendations and plan states, never a new clinical rule.
type Rec = {
  id: string;
  rule_id: string;
  severity: string;
  title: string;
  missing?: string[];
  clinicalContext?: { problem?: string };
  action?: { type: string; planId?: string };
};
type Task = {
  id: string;
  title: string;
  status: string;
  dueDate?: string | null;
  awaitingReview?: boolean;
  clinicalContext?: { problem?: string; urgent?: boolean };
};
type Medicine = {
  id: string;
  name: string;
  status: string;
  doseValue: number | null;
  frequency: string | null;
  route?: string | null;
};
export function consultationPriorities(
  attention: Rec[],
  plan: Task[],
  today: string,
  medicines: Medicine[] = [],
) {
  const pending = plan.filter(
    (p) => p.status === "planned" || p.awaitingReview,
  );
  const routineIds = attention
    .filter(
      (a) =>
        isRoutine(a) ||
        (a.severity !== "red" &&
          a.action?.type === "plan" &&
          pending.some((p) => p.id === a.action?.planId && isRoutinePlan(p))),
    )
    .map((a) => a.id);
  const routine = new Set(routineIds);
  const live = attention.filter((a) => !routine.has(a.id));
  const urgent = live.filter((a) => a.severity === "red");
  const clarify = live.filter(
    (a) =>
      a.severity !== "red" &&
      a.action?.type !== "plan" &&
      (a.missing?.length ?? 0) > 0,
  );
  const classified = new Set([...urgent, ...clarify].map((a) => a.id));
  const decisions = live.filter(
    (a) =>
      !classified.has(a.id) &&
      a.action?.type !== "plan" &&
      a.severity !== "blue",
  );
  const follow = pending.filter((p) => !isRoutinePlan(p));
  const review = follow.filter((p) => p.awaitingReview);
  const due = follow.filter(
    (p) => !p.awaitingReview && p.dueDate && p.dueDate <= today,
  );
  const next =
    follow
      .filter((p) => p.status === "planned" && p.dueDate && p.dueDate > today)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0] ?? null;
  const problem = (a: Rec) =>
    a.clinicalContext?.problem ?? problemOfRule(a.rule_id);
  const connected = [
    {
      keys: ["hf", "kidney"],
      label: "Review HF medicines and renal / potassium findings together",
    },
    {
      keys: ["af", "cad"],
      label:
        "Review anticoagulation and coronary antiplatelet therapy together",
    },
  ].flatMap((c) => {
    const items = live.filter((a) => c.keys.includes(problem(a)));
    return c.keys.every((k) => items.some((a) => problem(a) === k))
      ? [{ label: c.label, recommendationIds: items.map((a) => a.id) }]
      : [];
  });
  const reconciliation = medicines
    .filter((m) => ["active", "held", "not_taking"].includes(m.status))
    .flatMap((m) => {
      const missing = [
        m.doseValue == null ? "dose" : "",
        !m.frequency ? "frequency" : "",
        !m.route ? "route" : "",
      ].filter(Boolean);
      return missing.length
        ? [{ id: m.id, label: `${m.name}: confirm ${missing.join(", ")}` }]
        : [];
    });
  return {
    reconciliation,
    urgentIds: urgent.map((a) => a.id),
    clarifyIds: clarify.map((a) => a.id),
    decisionIds: decisions.map((a) => a.id),
    routineIds,
    gaps: [...new Set(clarify.flatMap((a) => a.missing ?? []))],
    connected,
    reviewIds: review.map((p) => p.id),
    dueIds: due.map((p) => p.id),
    next: next
      ? { id: next.id, title: next.title, dueDate: next.dueDate }
      : null,
    // Counts stay separate: receiving evidence is not equivalent to clinician review.
    counts: {
      urgent: urgent.length,
      clarify: clarify.length,
      decisions: new Set(decisions.map(problem)).size,
      review: review.length,
      due: due.length,
    },
  };
}
