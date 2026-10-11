import { useState } from "react";
import { History } from "lucide-react";
import { fmtDay, fmtTime } from "../../shared/clinical";

const LABEL: Record<string, string> = {
  start: "Started",
  restart: "Restarted",
  increase: "Increased",
  decrease: "Reduced",
  hold: "Held",
  stop: "Stopped",
  not_taking: "Not taking",
  resume: "Taken again",
  frequency: "Frequency changed",
  continue: "Continued",
  planned: "Planned",
};
export function MedicationHistory({
  entries = [],
  preview = 3,
}: {
  entries?: any[];
  preview?: number;
}) {
  const [all, setAll] = useState(false);
  return (
    <section className="med-history" aria-label="Medication history">
      <div className="snapshot-subhead">
        <h3>
          <History size={16} aria-hidden="true" /> Medication history
        </h3>
        <span className="small muted">{entries.length} changes</span>
      </div>
      {!entries.length ? (
        <p className="small muted">No medication changes recorded.</p>
      ) : (
        <ol className="med-history-list">
          {(all ? entries : entries.slice(0, preview)).map((e) => (
            <li
              key={e.id}
              data-medication-event={e.id}
              className={`change-${e.kind}`}
            >
              <details>
                <summary>
                  <span>
                    <b>{e.name}</b>
                    <small>{LABEL[e.kind] ?? e.kind}</small>
                  </span>
                  <time dateTime={e.at}>{fmtDay(e.at, { year: true })}</time>
                </summary>
                <div className="med-history-detail">
                  <b>
                    {e.before && e.before !== e.after ? `${e.before} → ` : ""}
                    {e.after}
                  </b>
                  {e.reason && <span>{e.reason}</span>}
                  <small>{fmtTime(e.at)}</small>
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
      {entries.length > preview && (
        <button
          className="btn ghost small snapshot-more"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Recent changes" : `All changes (${entries.length})`}
        </button>
      )}
    </section>
  );
}

export function DoseProgress({ progress }: { progress: any }) {
  if (!progress) return null;
  const paused = progress.status !== "active";
  return (
    <div
      className={`dose-progress${paused ? " paused" : ""}`}
      aria-label="HF reference dose progress"
    >
      <span className="dose-caption">
        <b>{progress.percent != null ? `${progress.percent}%` : "—"}</b>
        <span>
          {progress.percent != null ? "of reference target" : progress.note}
        </span>
      </span>
      {progress.percent != null && (
        <span
          className="dose-track"
          role="meter"
          aria-label="Prescribed dose compared with HF reference target"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, progress.percent)}
          aria-valuetext={`${progress.percent}% of reference target${paused ? ` · ${progress.status.replace("_", " ")}` : ""}`}
        >
          <i style={{ width: `${Math.min(100, progress.percent)}%` }} />
        </span>
      )}
      {progress.target && (
        <span className="dose-reference">Reference {progress.target}</span>
      )}
    </div>
  );
}
