import { useState } from "react";
import { ChevronRight, Clock, Plus } from "lucide-react";
import { setSampleMode, useData, useSampleMode, withSample } from "../api";
import { Link, SevChip, initials, navigate, type Sev } from "../ui";
import { fmtDay } from "../../shared/clinical";
import { NewPatient } from "../drawers/NewPatient";

type Row = {
  id: string; name: string; mrn: string; age: number; sex: string; where: string; inpatient: boolean; postDischarge: boolean; problem: string;
  alert: { severity: Sev; title: string; draft: boolean } | null; alertCounts: Record<string, number>;
  next: { title: string; dueDate: string; view: string } | null; overdue: number; dueToday: number; awaitingReview: number;
};

const FILTERS = [
  ["all", "All"], ["attention", "Needs attention"], ["review", "Results to review"], ["inpatients", "Inpatients"], ["opd", "OPD"], ["today", "Due today"], ["overdue", "Overdue"], ["post", "Post-discharge"],
] as const;

export function Worklist() {
  const sample = useSampleMode();
  const { data, error } = useData<{ today: string; rows: Row[]; counts?: { real: number; sample: number } }>(withSample("/worklist", sample));
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const [adding, setAdding] = useState(false);
  const rows = data?.rows ?? [];
  const count = (sev: string) => rows.reduce((n, r) => n + (r.alertCounts[sev] ?? 0), 0);
  const shown = rows.filter((r) =>
    filter === "all" ? true
    : filter === "attention" ? r.alert && (r.alert.severity === "red" || r.alert.severity === "orange")
    : filter === "inpatients" ? r.inpatient
    : filter === "opd" ? !r.inpatient
    : filter === "today" ? r.dueToday > 0
    : filter === "overdue" ? r.overdue > 0
    : filter === "review" ? r.awaitingReview > 0
    : r.postDischarge,
  );
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{sample ? "Sample worklist" : "Worklist"}</h1>
          <p>{sample ? "Synthetic patients for practice" : "Who needs attention now"}</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          <Plus size={18} strokeWidth={2.4} />
          New patient
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {data && !sample && data.counts?.real === 0 ? (
        <FirstPatient samples={data.counts?.sample ?? 0} onAdd={() => setAdding(true)} />
      ) : (
      <>
      <div className="stats">
        <Stat sev="red" label="Critical" value={count("red")} sub="Safety alerts open" onClick={() => setFilter("attention")} />
        <Stat sev="orange" label="Review" value={count("orange")} sub="Decisions waiting" onClick={() => setFilter("attention")} />
        <Stat sev="yellow" label="Due today" value={rows.reduce((n, r) => n + r.dueToday, 0)} sub="Planned actions" onClick={() => setFilter("today")} />
        <Stat sev="red" label="Overdue" value={rows.reduce((n, r) => n + r.overdue, 0)} sub="From earlier plans" icon onClick={() => setFilter("overdue")} />
        <Stat sev="blue" label="Inpatients" value={rows.filter((r) => r.inpatient).length} sub={`${rows.length} patient${rows.length === 1 ? "" : "s"} followed`} onClick={() => setFilter("inpatients")} />
      </div>
      <div className="filters" role="toolbar" aria-label="Filter worklist">
        {FILTERS.map(([id, label]) => (
          <button key={id} className="filter" aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
            {id === "all" ? ` · ${rows.length}` : ""}
          </button>
        ))}
      </div>
      <div className="card wl">
        <div className="wl-head">
          <span>PATIENT</span>
          <span>WHERE</span>
          <span>MAIN PROBLEM</span>
          <span>TOP ALERT</span>
          <span>NEXT</span>
          <span />
        </div>
        {data && !shown.length && <div className="empty" style={{ margin: 20 }}>No patients in this view.</div>}
        {shown.map((r) => (
          <Link key={r.id} to={`/patients/${r.id}`} className="wl-row">
            <span className="person">
              <span className="avatar">{initials(r.name)}</span>
              <span style={{ minWidth: 0 }}>
                <b>{r.name}</b>
                <span>
                  {r.age} y · {r.sex[0]} · {r.mrn}
                </span>
              </span>
            </span>
            <span>
              <span className={`where ${r.inpatient ? "in" : ""}`}>{r.where}</span>
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-2)" }}>{r.problem}</span>
            <span style={{ minWidth: 0 }}>
              {r.alert ? <SevChip sev={r.alert.severity}>{r.alert.title}</SevChip> : <span className="muted small" style={{ fontWeight: 600 }}>No open alerts</span>}
                {r.awaitingReview > 0 && <span className="small" style={{ display: "block", color: "var(--orange-ink)", marginTop: 4 }}>{r.awaitingReview} result{r.awaitingReview === 1 ? "" : "s"} to review</span>}
            </span>
            <span className="next">
              {r.next ? (
                <>
                  <b>{r.next.title}</b>
                  <span style={{ color: r.next.view === "overdue" ? "var(--red-ink)" : r.next.view === "due" ? "var(--yellow-ink)" : undefined, fontWeight: r.next.view === "planned" ? 600 : 700 }}>
                    {r.next.view === "overdue" ? `Overdue · ${fmtDay(r.next.dueDate)}` : r.next.view === "due" ? "Today" : fmtDay(r.next.dueDate, { weekday: true })}
                  </span>
                </>
              ) : (
                <span>Nothing planned</span>
              )}
            </span>
            <ChevronRight size={18} color="#98A2B3" />
          </Link>
        ))}
      </div>
      </>
      )}
      {adding && <NewPatient sample={sample} onClose={() => setAdding(false)} onCreated={(id) => navigate(`/patients/${id}`)} />}
    </main>
  );
}

function Stat({ sev, label, value, sub, icon, onClick }: { sev: Sev; label: string; value: number; sub: string; icon?: boolean; onClick(): void }) {
  return (
    <button className={`stat sev-${sev}`} onClick={onClick} style={{ cursor: "pointer" }}>
      <span className="k text-sev">
        {icon ? <Clock size={14} strokeWidth={2.4} /> : <span className="dot" style={{ background: "var(--c)" }} />}
        {label}
      </span>
      <span className="v" style={{ color: "#0F1B2D" }}>{value}</span>
      <span className="s">{sub}</span>
    </button>
  );
}

// No real patient yet: the worklist is the place to register the first one.
function FirstPatient({ samples, onAdd }: { samples: number; onAdd(): void }) {
  return (
    <div className="card first-patient">
      <h2>No patients yet</h2>
      <p>Register a patient with the hospital file number. CardioFlow starts following them from the first diagnosis, result or medication you record.</p>
      <div className="row wrap" style={{ gap: 12 }}>
        <button className="btn primary" onClick={onAdd}>
          <Plus size={18} strokeWidth={2.4} />
          Register first patient
        </button>
        {samples > 0 && (
          <button className="btn ghost" onClick={() => setSampleMode(true)}>
            Look at the {samples} sample patients
          </button>
        )}
      </div>
    </div>
  );
}
