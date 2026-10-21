import { fmtDay } from "../../shared/clinical";
import type { Open } from "./Patient";

// A compact view of the existing dated tasks; each keeps its own evidence and completion.
export function PlanTasks({
  tasks,
  open,
  today,
}: {
  tasks: any[];
  open(o: Open): void;
  today: string;
}) {
  if (!tasks.length) return null;
  const row = (p: any) => (
    <div
      className={`task-row${p.clinicalContext?.urgent ? " urgent-task" : ""}`}
      key={p.id}
    >
      <div>
        <b>{p.title}</b>
        <span>
          {p.awaitingReview
            ? "Awaiting review"
            : p.dueDate === today
              ? "Due today"
              : p.dueDate
                ? `${p.dueDate < today ? "Overdue · " : ""}${fmtDay(p.dueDate, { year: true })}`
                : "Date needed"}
        </span>
      </div>
      <button
        className="btn secondary small"
        onClick={() => open({ kind: "plan-item", planId: p.id })}
      >
        {p.awaitingReview ? "Review result" : "Open task"}
      </button>
    </div>
  );
  const urgent = tasks.filter((p) => p.clinicalContext?.urgent);
  const routine = tasks.filter((p) => !p.clinicalContext?.urgent);
  const due = routine.filter(
    (p) => p.dueDate && p.dueDate <= today && !p.awaitingReview,
  ).length;
  const review = routine.filter((p) => p.awaitingReview).length;
  return (
    <div className="problem-tasks">
      {urgent.map(row)}
      {routine.length > 0 && (
        <details>
          <summary>
            {routine.length} task{routine.length === 1 ? "" : "s"}
            {due ? ` · ${due} due` : ""}
            {review ? ` · ${review} awaiting review` : ""}
          </summary>
          <div>{routine.map(row)}</div>
        </details>
      )}
    </div>
  );
}
