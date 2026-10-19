import { useState } from "react";
import { ShieldCheck, CalendarCheck, ChevronRight } from "lucide-react";
import { Link } from "../ui";
import { fmtDay } from "../../shared/clinical";
import { ActionButton } from "./Summary";
import type { Open } from "./Patient";

// Rendering only: the server selects, prioritizes and groups the findings.
export function MedicationReview({
  review,
  open,
}: {
  review: any;
  open(o: Open): void;
}) {
  const [filter, setFilter] = useState("all");
  if (!review) return null;
  const groups = [
    "all",
    "safety",
    "regimen",
    "monitoring",
    "optimization",
  ] as const;
  const labels = {
    all: "All",
    safety: "Safety & doses",
    regimen: "Medication list",
    monitoring: "Monitoring",
    optimization: "Treatment goals",
  };
  const issues = review.issues.filter(
    (r: any) => filter === "all" || r.group === filter,
  );
  return (
    <section className="med-review card pad" aria-label="Medication review">
      <div className="med-review-head">
        <div>
          <h2>
            <ShieldCheck size={19} aria-hidden="true" /> Medication review
          </h2>
          <p>
            {review.counts.active} active
            {review.counts.held ? ` · ${review.counts.held} held` : ""}
            {review.counts.notTaking
              ? ` · ${review.counts.notTaking} not taking`
              : ""}
          </p>
        </div>
        {!!review.checks.length && (
          <button
            className="btn secondary small"
            onClick={() =>
              open({ kind: "wizard", wizard: "medication-monitoring" })
            }
          >
            <CalendarCheck size={16} /> Plan due checks
          </button>
        )}
      </div>
      {review.renal && (
        <div className="med-review-renal">
          CrCl {review.renal.value} mL/min{" "}
          <span>
            · Cockcroft–Gault · Cr {fmtDay(review.renal.creatinineAt)} · weight{" "}
            {fmtDay(review.renal.weightAt)}
          </span>
        </div>
      )}
      {!!review.issues.length && (
        <div
          className="med-review-filters"
          role="group"
          aria-label="Medication review filters"
        >
          {groups.filter(k=>k==="all" || k===filter || review.issues.some((r:any)=>r.group===k)).map((k) => {
            const n =
              k === "all"
                ? review.issues.length
                : review.issues.filter((r: any) => r.group === k).length;
            return (
              <button
                key={k}
                className={`chip ${filter === k ? "selected" : "outline"}`}
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
              >
                {labels[k]} <span>{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {!review.issues.length && (
        <p className="med-review-empty">
          No open medication alerts. Checks use the recorded medicines and
          results.
        </p>
      )}
      {!!review.issues.length && !issues.length && (
        <p className="med-review-empty">No open findings in this group.</p>
      )}
      <div className="med-review-list">
        {issues.map((r: any) => (
          <article key={r.id} className={`med-review-row sev-${r.severity}`}>
            <div className="med-review-finding">
              <b>{r.title}</b>
              <details>
                <summary>Why & evidence</summary>
                <p>{r.detail}</p>
                {r.facts?.map((f: any, i: number) => (
                  <p key={i}>
                    {f.label}: {f.value}
                    {f.date ? ` · ${fmtDay(f.date, { year: true })}` : ""}
                  </p>
                ))}
                {r.related.map((a: any) => (
                  <p key={a.id}>
                    {a.title} · {a.detail}
                  </p>
                ))}
                {r.ruleEvidence && <small>{r.ruleEvidence}</small>}
              </details>
            </div>
            <ActionButton a={r} open={open} />
          </article>
        ))}
      </div>
      {!!review.appointments.length && (
        <details className="med-review-bookings">
          <summary>
            {review.appointments.length} monitoring appointment
            {review.appointments.length === 1 ? "" : "s"}
          </summary>
          {review.appointments.map((p: any) => (
            <button
              key={p.id}
              className="med-review-booking"
              onClick={() => open({ kind: "plan-item", planId: p.id })}
            >
              <span>
                {p.title}
                <small>
                  {p.dueDate
                    ? fmtDay(p.dueDate, { year: true })
                    : "Date needed"}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </details>
      )}
    </section>
  );
}
export function MedicationReviewLink({
  id,
  count,
}: {
  id: string;
  count: number;
}) {
  return (
    <Link className="btn secondary small" to={`/patients/${id}/medications`}>
      Review medicines{count ? ` · ${count}` : ""}
    </Link>
  );
}
