import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarCheck,
  Check,
  FlaskConical,
  HeartPulse,
  Pill,
  Stethoscope,
  AlertTriangle,
  BedDouble,
} from "lucide-react";
import { api, useData } from "../api";
import { Drawer, DrawerWorkspace, Tag } from "../ui";
import { fmtDay, fmtTime, isoDay } from "../../shared/clinical";
import { VIEW_LABEL, VIEW_SEV } from "./Summary";

const FILTERS = [
  ["all", "All"],
  ["visit", "Visits & admissions"],
  ["investigation", "Investigations"],
  ["medication", "Medications"],
  ["complication", "Decisions"],
  ["plan", "Plans"],
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const events = useMemo(() => {
    if (!data) return [];
    const cutoff = new Date(
      Date.parse(data.today) - 120 * 86400000,
    ).toISOString();
    return data.events
      .filter((e: any) => filter === "all" || e.category === filter)
      .filter((e: any) => !recent || e.planned || e.occurred_at >= cutoff);
  }, [data, filter, recent]);
  const narrow = useNarrow();
  const sel = events.find((e: any) => e.id === selectedId) ?? null;
  useEffect(() => {
    if (!narrow && !sel)
      setSelectedId(
        (
          [...events].reverse().find((e: any) => e.kind === "discharge") ??
          events.filter((e: any) => !e.planned).at(-1)
        )?.id ?? null,
      );
  }, [events, narrow, sel]);
  if (!data) return <main className="page" />;
  const ctx = sel?.context_id
    ? data.contexts.find((c: any) => c.id === sel.context_id)
    : null;
  const pastCount = events.filter((e: any) => !e.planned).length;
  const detail = sel ? (
    <EventDetail
      key={sel.id}
      event={sel}
      context={ctx}
      patientId={id}
      today={data.today}
    />
  ) : (
    <div className="muted">Select an event</div>
  );
  return (
    <main className="page">
      <div className="grid-main grid-journey">
        <section className="card pad journey-card">
          <div className="card-head" style={{ flexWrap: "wrap" }}>
            <h2>Journey</h2>
            <select
              className="input journey-filter"
              aria-label="Journey filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {FILTERS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <label
            className="row small"
            style={{ fontWeight: 600, color: "var(--ink-3)", marginBottom: 8 }}
          >
            <input
              type="checkbox"
              checked={!recent}
              onChange={(e) => setRecent(!e.target.checked)}
            />{" "}
            Show older history
          </label>
          {events.length === 0 && (
            <div className="empty">No events in this view.</div>
          )}
          <div>
            {events.map((e: any, i: number) => {
              const day = isoDay(new Date(e.occurred_at));
              const prevDay =
                i > 0 ? isoDay(new Date(events[i - 1].occurred_at)) : null;
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
                  <div
                    className={`jr ${sel?.id === e.id ? "sel" : ""} ${e.planned ? "planned" : ""}`}
                  >
                    <div className="date">
                      {day !== prevDay && (
                        <>
                          <b
                            style={{
                              color: isToday
                                ? "var(--red-ink)"
                                : e.planned
                                  ? "var(--ink-3)"
                                  : undefined,
                            }}
                          >
                            {fmtDay(day)}
                          </b>
                          <span>
                            {e.planned
                              ? "Planned"
                              : isToday
                                ? "Today"
                                : new Date(day).getFullYear() !==
                                    new Date(data.today).getFullYear()
                                  ? new Date(day).getFullYear()
                                  : fmtTime(e.occurred_at)}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="rail">
                      <span
                        className={`node ${e.planned ? "planned" : e.category}`}
                      >
                        {icon(e)}
                      </span>
                      {!last && (
                        <span
                          className={`line ${e.planned || events[i + 1]?.planned ? "dash" : ""}`}
                        />
                      )}
                    </div>
                    <div className="body">
                      <button
                        className="jr-event"
                        onClick={() => {
                          setSelectedId(e.id);
                          setOpened(true);
                        }}
                        aria-pressed={sel?.id === e.id}
                        aria-haspopup={narrow ? "dialog" : undefined}
                      >
                        <div className="t">{e.title}</div>
                        {e.detail && (
                          <div className="dt">
                            {e.category === "complication"
                              ? "Decision recorded · View details"
                              : e.detail}
                          </div>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        {!narrow && (
          <aside
            className="card pad journey-panel"
            style={{ position: "sticky", top: 96 }}
          >
            {sel && (
              <div className="journey-detail-heading">
                <span className="eyebrow">
                  {fmtDay(sel.occurred_at, { year: true })}
                </span>
                <h2>{sel.title}</h2>
              </div>
            )}
            {detail}
          </aside>
        )}
      </div>
      {narrow && opened && sel && (
        <div className="journey-focus">
          <DrawerWorkspace.Provider value={null}>
            <Drawer
              title={sel.title}
              subtitle={`${fmtDay(sel.occurred_at, { year: true })} · ${sel.planned ? "Planned" : sel.ref_type === "decision" ? "Decision recorded" : "Recorded event"}`}
              icon={icon(sel) ?? <CalendarCheck size={20} />}
              onClose={() => setOpened(false)}
              footer={
                <button
                  className="btn secondary"
                  onClick={() => setOpened(false)}
                >
                  Back to Journey
                </button>
              }
            >
              <div className="drawer-body journey-focus-body">{detail}</div>
            </Drawer>
          </DrawerWorkspace.Provider>
        </div>
      )}
    </main>
  );
}

function EventDetail({
  event: e,
  context: ctx,
  patientId,
  today,
}: {
  event: any;
  context: any;
  patientId: string;
  today: string;
}) {
  const [view, setView] = useState("summary");
  const actions = e.linked?.actions ?? [];
  const meds = e.linked?.meds ?? [];
  const facts = e.reading?.facts ?? [];
  const notes = e.reading?.notes ?? (e.detail ? [e.detail] : []);
  const count = actions.length + meds.length;
  return (
    <div className="journey-detail">
      <div
        className="journey-switch"
        role="group"
        aria-label="Event detail view"
      >
        {[
          ["summary", "Summary"],
          ["actions", `Actions${count ? ` · ${count}` : ""}`],
          ["record", "Record"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={view === value}
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "summary" && (
        <section className="journey-summary" aria-label="Event summary">
          {facts.length > 0 && (
            <>
              <h3 className="eyebrow">At the decision</h3>
              <dl className="journey-facts">
                {facts.map((f: any, i: number) => {
                  const split = f.value.indexOf(" (");
                  return (
                    <div key={i}>
                      <dt>{f.label}</dt>
                      <dd>
                        {split > 0 ? (
                          <>
                            {f.value.slice(0, split)}
                            <small>{f.value.slice(split + 1)}</small>
                          </>
                        ) : (
                          f.value
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </>
          )}
          {notes.length > 0 && (
            <ul className="journey-key-points">
              {notes.map((text: string, i: number) => (
                <li key={i}>
                  {text.length > 180 ? text.slice(0, 177) + "…" : text}
                </li>
              ))}
            </ul>
          )}
          {!facts.length && !notes.length && (
            <p className="help">No additional narrative recorded.</p>
          )}
          {count > 0 && (
            <button
              className="journey-action-link"
              onClick={() => setView("actions")}
            >
              <CalendarCheck size={18} aria-hidden="true" />
              <span>
                <b>
                  {actions.length} plan{" "}
                  {actions.length === 1 ? "action" : "actions"}
                </b>
                {meds.length > 0 && (
                  <small>
                    {meds.length} medication{" "}
                    {meds.length === 1 ? "change" : "changes"}
                  </small>
                )}
              </span>
              <span className="journey-view-link">View →</span>
            </button>
          )}
        </section>
      )}
      {view === "actions" && (
        <section className="journey-actions" aria-label="Event actions">
          {!count && (
            <p className="help">No linked actions recorded for this event.</p>
          )}
          {meds.length > 0 && (
            <>
              <h3 className="eyebrow">Medication changes</h3>
              <ul className="journey-medicine-list">
                {meds.map((m: any, i: number) => (
                  <li key={i}>
                    <Pill size={17} aria-hidden="true" />
                    <span>
                      <b>{m.name}</b>
                      <small>
                        {m.kind.replaceAll("_", " ")}
                        {!["hold", "stop", "not_taking"].includes(m.kind) &&
                        m.dose
                          ? ` · ${m.dose}`
                          : ""}
                        {m.frequency ? ` · ${m.frequency}` : ""}
                        {m.route ? ` · ${m.route}` : ""}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {actions.length > 0 && (
            <>
              <h3 className="eyebrow">Plan · status today</h3>
              <ul className="journey-action-list">
                {actions.map((a: any) => (
                  <li key={a.id} className="journey-action">
                    <div>
                      <b>{a.title}</b>
                      <small>
                        <CalendarCheck size={13} aria-hidden="true" />
                        {a.dueDate
                          ? fmtDay(a.dueDate, { year: true })
                          : "No date recorded"}
                      </small>
                    </div>
                    <Tag sev={VIEW_SEV[a.view] ?? "gray"}>
                      {VIEW_LABEL(a, today)}
                    </Tag>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {view === "record" && (
        <section className="journey-record" aria-label="Original event record">
          {ctx && (
            <div className="journey-context-strip">
              <BedDouble size={18} aria-hidden="true" />
              <div>
                <b>
                  {ctx.kind === "admission" ? "Admission" : "Clinic visit"} ·{" "}
                  {ctx.location ?? ctx.service}
                </b>
                <small>
                  {fmtDay(ctx.startedAt, { year: true })}
                  {ctx.endedAt
                    ? ` → ${fmtDay(ctx.endedAt, { year: true })}`
                    : " · Open"}
                </small>
              </div>
            </div>
          )}
          <h3 className="eyebrow">Full recorded entry</h3>
          <p className="journey-original">
            {e.detail || "No additional narrative recorded."}
          </p>
          {ctx?.status === "closed" && (
            <ContextNote key={ctx.id} patientId={patientId} context={ctx} />
          )}
        </section>
      )}
    </div>
  );
}

function ContextNote({
  patientId,
  context: ctx,
}: {
  patientId: string;
  context: any;
}) {
  const [requested, setRequested] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!requested) return;
    let active = true;
    api<{ text: string }>(`/patients/${patientId}/contexts/${ctx.id}/note`)
      .then((n) => {
        if (active) setNote((ctx.summary?.note as string) || n.text);
      })
      .catch((e) => {
        if (active) {
          setError((e as Error).message);
          setRequested(false);
        }
      });
    return () => {
      active = false;
    };
  }, [requested, patientId, ctx.id]);
  return (
    <>
      {note === null && (
        <button
          className="btn secondary small"
          disabled={requested}
          onClick={() => {
            setError("");
            setRequested(true);
          }}
        >
          {requested
            ? "Loading…"
            : ctx.kind === "admission"
              ? "Open discharge summary"
              : "Open clinic note"}
        </button>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {note !== null && <pre className="journey-note">{note}</pre>}
    </>
  );
}

// phones and narrow windows: one column
function useNarrow(px = 900) {
  const q = `(max-width: ${px}px)`;
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(q).matches,
  );
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return narrow;
}
