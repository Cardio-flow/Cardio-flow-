import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarCheck, Check, FlaskConical, HeartPulse, Pill, Stethoscope, AlertTriangle, BedDouble } from "lucide-react";
import { api, useData } from "../api";
import { Tag } from "../ui";
import { fmtDay, fmtTime, isoDay } from "../../shared/clinical";
import { VIEW_LABEL, VIEW_SEV } from "./Summary";

const FILTERS = [
  ["all", "All"], ["visit", "Visits & admissions"], ["investigation", "Investigations"], ["medication", "Medications"], ["complication", "Decisions"], ["plan", "Plans"],
] as const;

function icon(e: any) {
  if (e.planned) return null;
  if (e.kind === "admission") return <BedDouble size={16} />;
  if (e.kind === "discharge") return <Check size={16} strokeWidth={2.6} />;
  if (e.kind === "clinic-visit") return <Stethoscope size={16} />;
  if (e.kind === "echo") return <Activity size={16} />;
  if (e.kind === "labs") return <FlaskConical size={16} />;
  if (e.category === "medication") return <Pill size={16} />;
  if (e.category === "complication") return <AlertTriangle size={16} />;
  if (e.category === "plan") return <CalendarCheck size={16} />;
  return <HeartPulse size={16} />;
}

export function JourneyTab({ id, version }: { id: string; version: number }) {
  const { data } = useData<any>(`/patients/${id}/journey`, [version]);
  const [filter, setFilter] = useState<string>("all");
  const [recent, setRecent] = useState(true);
  const [sel, setSel] = useState<any>(null);
  const [note, setNote] = useState<{ title: string; text: string } | null>(null);
  const events = useMemo(() => {
    if (!data) return [];
    const cutoff = new Date(Date.parse(data.today) - 120 * 86400000).toISOString();
    return data.events
      .filter((e: any) => filter === "all" || e.category === filter)
      .filter((e: any) => !recent || e.planned || e.occurred_at >= cutoff);
  }, [data, filter, recent]);
  useEffect(() => {
    if (data && !sel) setSel([...data.events].reverse().find((e: any) => e.kind === "discharge") ?? data.events.filter((e: any) => !e.planned).pop());
  }, [data, sel]);
  useEffect(() => setNote(null), [sel]);
  if (!data) return <main className="page" />;
  const ctx = sel?.context_id ? data.contexts.find((c: any) => c.id === sel.context_id) : null;
  const pastCount = events.filter((e: any) => !e.planned).length;
  return (
    <main className="page">
      <div className="grid-main" style={{ gridTemplateColumns: "minmax(0, 1fr) 400px" }}>
        <section className="card pad">
          <div className="card-head" style={{ flexWrap: "wrap" }}>
            <h2>Journey</h2>
            <div className="filters">
              {FILTERS.map(([k, l]) => (
                <button key={k} className="filter" style={{ height: 34, fontSize: 12.5 }} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className="row small" style={{ fontWeight: 600, color: "var(--ink-3)", marginBottom: 8 }}>
            <input type="checkbox" checked={!recent} onChange={(e) => setRecent(!e.target.checked)} /> Show older history
          </label>
          {events.length === 0 && <div className="empty">No events in this view.</div>}
          <div>
            {events.map((e: any, i: number) => {
              const day = isoDay(new Date(e.occurred_at));
              const prevDay = i > 0 ? isoDay(new Date(events[i - 1].occurred_at)) : null;
              const isToday = day === data.today;
              const last = i === events.length - 1;
              return (
                <div key={e.id}>
                  {i === pastCount && pastCount > 0 && (
                    <div className="today-mark">
                      <span>TODAY</span>
                      <hr />
                    </div>
                  )}
                  <div className={`jr ${sel?.id === e.id ? "sel" : ""} ${e.planned ? "planned" : ""}`}>
                    <div className="date">
                      {day !== prevDay && (
                        <>
                          <b style={{ color: isToday ? "var(--red-ink)" : e.planned ? "var(--ink-3)" : undefined }}>{fmtDay(day)}</b>
                          <span>{e.planned ? "Planned" : isToday ? "Today" : new Date(day).getFullYear() !== new Date(data.today).getFullYear() ? new Date(day).getFullYear() : fmtTime(e.occurred_at)}</span>
                        </>
                      )}
                    </div>
                    <div className="rail">
                      <span className={`node ${e.planned ? "planned" : e.category}`}>{icon(e)}</span>
                      {!last && <span className={`line ${e.planned || events[i + 1]?.planned ? "dash" : ""}`} />}
                    </div>
                    <div className="body">
                      <button onClick={() => setSel(e)} aria-pressed={sel?.id === e.id}>
                        <div className="t">{e.title}</div>
                        {e.detail && <div className="dt">{e.detail}</div>}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <aside className="card pad" style={{ position: "sticky", top: 96, boxShadow: "var(--shadow-lg)" }}>
          {sel ? (
            <div className="col" style={{ gap: 14 }}>
              <div className="col" style={{ gap: 4 }}>
                <span className="eyebrow" style={{ color: "var(--action)" }}>Selected · {sel.planned ? "planned" : sel.category}</span>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--navy)" }}>{fmtDay(sel.occurred_at, { weekday: true, year: true })}</h2>
                <b style={{ fontSize: 15 }}>{sel.title}</b>
                {sel.detail && <span className="muted" style={{ fontWeight: 600 }}>{sel.detail}</span>}
              </div>
              {ctx && (
                <>
                  <div className="col" style={{ gap: 6 }}>
                    <span className="eyebrow">{ctx.kind === "admission" ? "Admission" : "Visit"}</span>
                    <span style={{ fontWeight: 600 }}>
                      {fmtDay(ctx.startedAt)}{ctx.endedAt ? ` → ${fmtDay(ctx.endedAt)}` : " · open"} · {ctx.location ?? ctx.service}
                    </span>
                  </div>
                  {ctx.meds.length > 0 && (
                    <div className="col" style={{ gap: 6 }}>
                      <span className="eyebrow">Medication changes</span>
                      {ctx.meds.map((m: any, i: number) => (
                        <span key={i} style={{ fontWeight: 600 }}>
                          <b style={{ color: m.kind === "start" ? "var(--green-ink)" : m.kind === "stop" ? "var(--red-ink)" : "var(--action)" }}>
                            {m.kind === "start" ? "+" : m.kind === "stop" ? "−" : m.kind === "increase" ? "↑" : m.kind === "decrease" ? "↓" : "•"}
                          </b>{" "}
                          {m.name} {m.kind !== "stop" && m.kind !== "hold" ? m.dose : `(${m.kind})`}
                        </span>
                      ))}
                    </div>
                  )}
                  {ctx.actions.length > 0 && (
                    <div className="col" style={{ gap: 8 }}>
                      <span className="eyebrow">Plan actions · status today</span>
                      {ctx.actions.map((a: any) => (
                        <div key={a.id} className="row" style={{ justifyContent: "space-between" }}>
                          <span style={{ fontWeight: 600, fontSize: 13.5 }}>
                            {a.title} · {fmtDay(a.dueDate)}
                          </span>
                          <Tag sev={VIEW_SEV[a.view]}>{VIEW_LABEL(a, data.today)}</Tag>
                        </div>
                      ))}
                    </div>
                  )}
                  {ctx.status === "closed" && (
                    <button className="btn secondary" onClick={() => api(`/patients/${id}/contexts/${ctx.id}/note`).then(setNote)}>
                      {ctx.kind === "admission" ? "Open discharge summary" : "Open clinic note"}
                    </button>
                  )}
                  {note && (
                    <pre style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, margin: 0 }}>
                      {(ctx.summary?.note as string) || note.text}
                    </pre>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="muted">Select an event</div>
          )}
        </aside>
      </div>
    </main>
  );
}
