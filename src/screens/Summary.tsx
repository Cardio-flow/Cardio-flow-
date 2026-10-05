import { useState } from "react";
import { BookOpen, Check } from "lucide-react";
import { Link, SevIcon, Sparkline, Tag, type Sev } from "../ui";
import { api } from "../api";
import { fmtDay, fmtTime } from "../../shared/clinical";
import { BARRIER_CATEGORIES, MEDICATION, formatNumber } from "../../shared/catalog";
import type { Open } from "./Patient";

export function SummaryTab({ s, open, done }: { s: any; open(o: Open): void; done(message?: string): void }) {
  return (
    <main className="page">
      <Glance o={s.overview} />
      <div className="grid-main">
        <div className="stack">
          <Episodes s={s} open={open} done={done} />
          <Attention s={s} open={open} done={done} />
          <HfPanel hf={s.hf} open={open} />
          <CadPanel cad={s.cad} open={open} />
          <RhythmPanel r={s.rhythm} open={open} />
          <ValvePanel v={s.valve} open={open} />
          <Targets s={s} open={open} />
          <Changes changes={s.changes} />
          <ActivePlan s={s} open={open} />
        </div>
        <div className="stack">
          <Meds s={s} open={open} done={done} />
          <Results s={s} open={open} />
          <Upcoming s={s} />
        </div>
      </div>
    </main>
  );
}

// The five questions (blueprint P1.10): why here, what changed, what needs attention,
// what is unfinished, what comes next. Each answers in one line from the record.
function Glance({ o }: { o: any }) {
  if (!o) return null;
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const a = o.attention;
  const total = a.red + a.orange + a.yellow + a.blue;
  return (
    <section className="glance" aria-label="Patient at a glance">
      <div>
        <small>Why here</small>
        <b>{o.why.text}</b>
        {o.why.sub && <span>{o.why.sub}</span>}
      </div>
      <button onClick={() => go("chg")}>
        <small>What changed</small>
        <b>{o.changed.since ? `${o.changed.count} change${o.changed.count === 1 ? "" : "s"} since ${o.changed.label?.toLowerCase().replace(/^since /, "") ?? "last review"}` : "No earlier review"}</b>
        {o.changed.top.length > 0 && <span>{o.changed.top.join(" · ")}</span>}
      </button>
      <button onClick={() => go("att")}>
        <small>Needs attention</small>
        {total === 0 ? <b>Nothing open</b> : (
          <span className="counts">
            {(["red", "orange", "yellow", "blue"] as Sev[]).filter((k) => a[k]).map((k) => <Tag key={k} sev={k}>{a[k]} {({ red: "urgent", orange: "review", yellow: "due", blue: "to consider" } as any)[k]}</Tag>)}
          </span>
        )}
        {a.top && <span>{a.top}</span>}
      </button>
      <button onClick={() => go("plan")}>
        <small>Unfinished</small>
        <b>{o.unfinished.overdue + o.unfinished.due === 0 ? "Nothing overdue" : [o.unfinished.overdue && `${o.unfinished.overdue} overdue`, o.unfinished.due && `${o.unfinished.due} due today`].filter(Boolean).join(" · ")}</b>
        {o.unfinished.top.length > 0 && <span>{o.unfinished.top.join(" · ")}</span>}
      </button>
      <button onClick={() => go("plan")}>
        <small>What's next</small>
        <b>{o.next[0] ? `${o.next[0].title}` : "Nothing booked"}</b>
        {o.next[0] && <span>{fmtDay(o.next[0].dueDate, { weekday: true })}{o.next[1] ? ` · then ${o.next[1].title}` : ""}</span>}
      </button>
    </section>
  );
}

function Attention({ s, open, done }: { s: any; open(o: Open): void; done(message?: string): void }) {
  const [why, setWhy] = useState<string | null>(null);
  return (
    <section className="card pad" aria-labelledby="att" id="att">
      <div className="card-head">
        <h2 id="att">Needs attention</h2>
        <span className="meta">Rules re-run when data arrives and every night</span>
      </div>
      {s.attention.length === 0 && <div className="empty">Nothing needs attention. All plan items are on track.</div>}
      <div className="attention">
        {s.attention.map((a: any) => (
          <div key={a.id}>
            <div className={`alert sev-${a.severity}`}>
              <div className="ic">
                <SevIcon sev={a.severity} />
              </div>
              <div className="txt">
                <span className="t">{a.title}</span>
                <span className="d">{a.detail}</span>
                {a.also?.length > 0 && <span className="also">Also suggested: {a.also.map((x: any) => x.title).join(" · ")}</span>}
                {a.rule_status !== "PUBLISHED" && <span className="draft">RULE IN CLINICAL REVIEW · SANDBOX ONLY</span>}
              </div>
              <button className="why" aria-expanded={why === a.id} onClick={() => setWhy(why === a.id ? null : a.id)}>
                Why?
              </button>
              <ActionButton a={a} open={open} />
            </div>
            {why === a.id && <WhyPanel a={a} patientId={s.header.id} done={done} />}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ActionButton({ a, open }: { a: any; open(o: Open): void }) {
  const act = a.action ?? {};
  if (act.type === "wizard")
    return (
      <button className="go" onClick={() => open({ kind: "wizard", wizard: act.wizard, recommendationId: a.id })}>
        {({ hyperkalaemia: "Manage hyperkalaemia", "renal-function": "Review renal function", congestion: "Manage congestion", hypotension: "Manage low BP", bradycardia: "Manage bradycardia",
          shock: "Manage shock", sepsis: "Sepsis pathway", hyperglycaemia: "Manage glucose crisis", hypoglycaemia: "Manage hypoglycaemia", bleeding: "Manage bleeding",
          "low-potassium": "Manage low K / Mg", hyponatraemia: "Manage low sodium", inr: "Manage INR", digoxin: "Manage digoxin", "severe-hypertension": "Manage severe BP",
          diabetes: "Diabetes plan", "sick-day": "Sick-day rules", ramadan: "Ramadan plan",
          "chest-infection": "Open pathway", pericarditis: "Open pathway", endocarditis: "Open pathway", "pre-procedure": "Open pathway", "amiodarone-thyroid": "Thyroid pathway", antithrombotic: "Plan antithrombotics", "acs-discharge": "Open bundle", "chest-pain-cad": "Open pathway", "af-care": "AF-CARE plan", "peri-af-procedure": "Plan anticoagulation", "icd-shock": "Open pathway", "valve-heart-team": "Heart Team decision" } as Record<string, string>)[act.wizard] ?? "Review"}
      </button>
    );
  if (act.type === "plan")
    return (
      <button className="go" onClick={() => open({ kind: "plan-item", planId: act.planId })}>
        Open
      </button>
    );
  if (act.type === "add-plan")
    return (
      <button className="go" onClick={() => open({ kind: "plan-add", template: act.template, medicationId: act.medicationId })}>
        {act.template === "renal-k" ? "Book renal/K check" : act.template === "ecg" ? "Book ECG" : act.template === "device" ? "Plan device review" : act.template === "dm-eyes" ? "Book retinal screening" : act.template === "dm-feet" ? "Plan foot examination" : act.template === "device-check" || act.template === "device-first-check" ? "Book device check" : act.template === "wound-check" ? "Book wound check" : act.template === "remote-monitoring" ? "Plan remote monitoring" : act.template === "generator-change" ? "Plan generator change" : act.template === "lead-review" ? "Refer for lead review" : "Add to plan"}
      </button>
    );
  if (act.type === "tab")
    return (
      <Link className="go" to={`${location.pathname.replace(/\/(history|journey|visits|medications|investigations|plan|registries)$/, "")}/${act.tab}`}>
        {act.tab === "medications" ? "Review medications" : act.tab === "journey" ? "Open journey" : "Review plan"}
      </Link>
    );
  if (act.type === "start-med")
    return (
      <button className="go" onClick={() => open({ kind: "med-add", code: act.code, dose: act.dose, reason: a.title })}>
        {act.label}
      </button>
    );
  if (act.type === "titrate")
    return (
      <button className="go" onClick={() => open({ kind: "med-action", medId: act.medicationId, action: act.direction, dose: act.dose, reason: act.direction === "increase" ? "Titration toward target" : undefined })}>
        {act.label}
      </button>
    );
  if (act.type === "med-action")
    return (
      <button className="go" onClick={() => open({ kind: "med-action", medId: act.medicationId, action: act.action, reason: act.action === "resume" ? undefined : a.title })}>
        {act.label}
      </button>
    );
  if (act.type === "history")
    return (
      <button className="go" onClick={() => open({ kind: "history", focus: act.focus })}>
        {act.label}
      </button>
    );
  if (act.type === "add-labs")
    return (
      <button className="go" onClick={() => open({ kind: "labs", codes: act.codes })}>
        {act.label}
      </button>
    );
  return null;
}

export function WhyPanel({ a, patientId, done }: { a: any; patientId?: string; done?(message?: string): void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cat, setCat] = useState("");
  const isDrug = a.action?.type === "start-med" || (a.action?.type === "titrate" && a.action.direction === "increase");
  const close = async (outcome: "deferred" | "declined", category?: string) => {
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${patientId}/recommendations/${a.id}/decline`, { body: { outcome, reason, also: (a.also ?? []).map((x: any) => x.id), ...(category ? { category } : {}) } });
      done?.(category ? "Reason recorded" : outcome === "deferred" ? "Suggestion deferred" : "Suggestion closed");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const sources = [a, ...(a.also ?? [])];
  return (
    <div className="why-panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b style={{ color: "var(--navy)" }}>Why am I seeing this?</b>
        <span className="small muted" style={{ fontWeight: 600 }}>
          Rule {a.rule_id} · v{a.rule_version} · <Tag sev={a.rule_status === "PUBLISHED" ? "green" : "yellow"}>{a.rule_status.replace("_", " ")}</Tag>
        </span>
      </div>
      <div className="facts">
        {a.facts.filter((f: any) => f.label !== "Guideline").map((f: any, i: number) => (
          <div className="fact" key={i}>
            <small>
              {f.label}
              {f.date ? ` · ${fmtDay(f.date)}` : ""}
            </small>
            <b style={{ color: f.tone ? `var(--${f.tone}-ink, var(--${f.tone}))` : undefined }}>{f.value}</b>
          </div>
        ))}
      </div>
      {sources.flatMap((x: any) => x.facts.filter((f: any) => f.label === "Guideline").map((f: any) => f.value)).filter((v: string, i: number, all: string[]) => all.indexOf(v) === i).map((v: string, i: number) => (
        <div className="guideline-src" key={"g" + i}>
          <BookOpen size={14} /> {v}
        </div>
      ))}
      {a.also?.length > 0 && (
        <div className="small" style={{ fontWeight: 600, color: "var(--ink-3)" }}>
          Merged with {a.also.length} other suggestion{a.also.length === 1 ? "" : "s"} for the same drug class: {a.also.map((x: any) => x.title).join(" · ")}
        </div>
      )}
      {a.missing.length > 0 && (
        <div className="small" style={{ fontWeight: 700, color: "var(--orange-ink)" }}>
          Assessment incomplete: {a.missing.join(", ")} not available. Missing data is never assumed normal.
        </div>
      )}
      {patientId && isDrug && (
        <div className="notnow">
          <span className="small" style={{ fontWeight: 700, color: "var(--ink-3)", flexBasis: "100%" }}>Not giving it? Record why once: this drug class stops being suggested.</span>
          <div className="choices" role="radiogroup" aria-label="Reason the medicine is not given" style={{ flexBasis: "100%" }}>
            {BARRIER_CATEGORIES.map((c) => (
              <button key={c.value} type="button" className="choice small" role="radio" aria-checked={cat === c.value} aria-pressed={cat === c.value} onClick={() => setCat(c.value)}>{c.label}</button>
            ))}
          </div>
          <input className="input" placeholder={cat === "other" ? "Note (required)" : "Note (optional), e.g. genital infection, angioedema"} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Note" />
          <button className="btn ghost small" disabled={busy || !cat || (cat === "other" && reason.trim().length < 3)} onClick={() => close("declined", cat)}>Record reason</button>
          {error && <span className="small" style={{ color: "var(--red-ink)", fontWeight: 700 }}>{error}</span>}
        </div>
      )}
      {patientId && a.action?.type !== "wizard" && !isDrug && (
        <div className="notnow">
          <input className="input" placeholder="Reason (e.g. patient preference, not available, already tried)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for not acting now" />
          <button className="btn ghost small" disabled={busy || reason.trim().length < 3} onClick={() => close("deferred")}>Not now</button>
          <button className="btn ghost small" disabled={busy || reason.trim().length < 3} onClick={() => close("declined")}>Not appropriate</button>
          {error && <span className="small" style={{ color: "var(--red-ink)", fontWeight: 700 }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

function Changes({ changes }: { changes: any }) {
  return (
    <section className="card pad" id="chg">
      <div className="card-head">
        <h2>What changed</h2>
        <span className="meta">{changes.since ? `${changes.label} · ${fmtDay(changes.since)}` : "No earlier discharge or visit to compare with"}</span>
      </div>
      {changes.items.length === 0 ? (
        <div className="empty">No changes since the last reference point.</div>
      ) : (
        <div className="changes">
          {changes.items.map((c: any, i: number) => (
            <div className="change" key={i}>
              <small>{c.label}</small>
              {c.kind === "value" ? (
                <div className="vals">
                  <span className="b">{c.before}</span>
                  <span className="muted">→</span>
                  <span className="a" style={{ color: c.tone ? `var(--${c.tone}-ink)` : undefined }}>{c.after}</span>
                  <span className="u">{c.text}</span>
                </div>
              ) : (
                <span className="txt" style={{ color: c.tone ? `var(--${c.tone}-ink)` : undefined }}>{c.text}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export const VIEW_SEV: Record<string, Sev> = { done: "green", overdue: "red", due: "yellow", planned: "blue", deferred: "gray", cancelled: "gray", superseded: "gray" };
export const VIEW_LABEL = (p: any, today: string) =>
  p.view === "done" ? "Completed" : p.view === "overdue" ? `Overdue ${Math.max(1, Math.round((Date.parse(today) - Date.parse(p.dueDate)) / 86400000))} d` : p.view === "due" ? "Due today" : p.view === "planned" ? "Planned" : p.view[0].toUpperCase() + p.view.slice(1);

export function PlanMark({ view }: { view: string }) {
  const sev = VIEW_SEV[view] ?? "gray";
  return (
    <span className={`pmark sev-${sev} ${view === "done" ? "fill" : ""}`} aria-hidden="true">
      {view === "done" && <Check size={14} strokeWidth={3} />}
    </span>
  );
}

// Complications followed as episodes: opened by a pathway, reviewed, then resolved.
const EPISODE_OUTCOMES = ["Resolved", "Improved, follow-up continues", "Transferred / referred", "Opened in error"];
function Episodes({ s, open, done }: { s: any; open(o: Open): void; done(message?: string): void }) {
  const eps = s.episodes ?? [];
  if (!eps.length) return null;
  const active = eps.filter((e: any) => e.status === "open");
  const closed = eps.filter((e: any) => e.status !== "open");
  return (
    <section className="card pad" aria-labelledby="eph">
      <div className="card-head">
        <h2 id="eph">Complications</h2>
        <span className="meta">{active.length ? `${active.length} open` : "None open"} · followed until resolved</span>
      </div>
      <div className="ep-list">
        {active.map((e: any) => <EpisodeCard key={e.id} e={e} s={s} open={open} done={done} />)}
      </div>
      {closed.length > 0 && (
        <div className="ep-closed">
          {closed.map((e: any) => (
            <div key={e.id}>
              <Check size={15} /> <b>{e.title}</b> · {e.outcome.toLowerCase()} {fmtDay(e.resolvedAt)} after {e.day} day{e.day === 1 ? "" : "s"}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EpisodeCard({ e, s, open, done }: { e: any; s: any; open(o: Open): void; done(message?: string): void }) {
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState("Resolved");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const resolve = async () => {
    setBusy(true);
    setErr("");
    try {
      await api(`/patients/${s.header.id}/episodes/${e.id}/resolve`, { body: { outcome, note } });
      done(`${e.title}: ${outcome.toLowerCase()}`);
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className={`ep sev-${e.tone}`}>
      <div className="ep-head">
        <span className="ep-day">Day {e.day}</span>
        <span className="ep-title">
          <b>{e.title}</b>
          <small>Opened {fmtDay(e.startedAt)}{e.reviews ? ` · ${e.reviews} review${e.reviews === 1 ? "" : "s"}, last ${fmtDay(e.lastAt)}` : ""}</small>
        </span>
      </div>
      <div className="ep-facts">
        {e.trend && (
          <span>
            {e.trend.label} {e.trend.start ? <>{e.trend.start.value} → </> : null}<b>{e.trend.now.value}</b> {e.trend.unit}
            <small> · {fmtDay(e.trend.now.at)}</small>
          </span>
        )}
        {e.held.length > 0 && <span className="ep-held">On hold: {e.held.map((m: any) => m.name).join(", ")}</span>}
        {e.next ? (
          <button className={`ep-next ${e.next.overdue ? "overdue" : ""}`} onClick={() => open({ kind: "plan-item", planId: e.next.id })}>
            Next: {e.next.title}{e.next.due ? ` · ${e.next.overdue ? "overdue since" : "due"} ${fmtDay(e.next.due, { weekday: true })}` : ""}
          </button>
        ) : (
          <span className="muted">No open plan items</span>
        )}
        {e.total > 0 && <span className="muted small">{e.done} of {e.total} plan items done</span>}
      </div>
      {!closing ? (
        <div className="ep-actions">
          <button className="btn secondary small" onClick={() => open({ kind: "wizard", wizard: e.wizard })}>Review</button>
          <button className="btn ghost small" onClick={() => setClosing(true)}>Resolve</button>
        </div>
      ) : (
        <div className="ep-resolve">
          <label className="small" style={{ fontWeight: 700 }}>
            Outcome
            <select className="input" value={outcome} onChange={(x) => setOutcome(x.target.value)}>
              {EPISODE_OUTCOMES.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          <input className="input" placeholder="Note (optional)" value={note} maxLength={300} onChange={(x) => setNote(x.target.value)} aria-label="Note" />
          {(e.held.length > 0 || e.open.length > 0) && (
            <div className="infobox small">
              {e.held.length > 0 && <div>Still on hold: {e.held.map((m: any) => m.name).join(", ")}. Restart or stop them in Medications.</div>}
              {e.open.length > 0 && <div>{e.open.length} plan item{e.open.length === 1 ? " stays" : "s stay"} open in the plan.</div>}
            </div>
          )}
          {err && <div className="error-box">{err}</div>}
          <div className="ep-actions">
            <button className="btn ghost small" onClick={() => setClosing(false)}>Cancel</button>
            <button className="btn primary small" disabled={busy} onClick={resolve}>{busy ? "Saving…" : "Close episode"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivePlan({ s, open }: { s: any; open(o: Open): void }) {
  return (
    <section className="card pad" id="plan">
      <div className="card-head">
        <h2>Active plan</h2>
        <span className="meta">
          {s.planSource ? `From ${s.planSource.kind === "admission" ? "discharge" : "visit"} · ${fmtDay(s.planSource.at)} · ` : ""}
          <button className="btn ghost small" onClick={() => open({ kind: "plan-add" })}>+ Add</button>
        </span>
      </div>
      {s.plan.length === 0 && <div className="empty">No plan yet. Add the next step so it is tracked.</div>}
      <div className="plan-list">
        {s.plan.map((p: any) => (
          <div key={p.id} className={`plan-row ${p.view === "done" ? "done" : ""}`}>
            <PlanMark view={p.view} />
            <span className="title">
              {p.title}
              {p.reason && <small>{p.reason}</small>}
            </span>
            <span className="when">{p.dueDate ? fmtDay(p.dueDate, { weekday: true }) : "No date"}</span>
            <span>
              <Tag sev={VIEW_SEV[p.view]}>{VIEW_LABEL(p, s.today)}</Tag>
            </span>
            <span>
              {p.status === "planned" && (
                <button className="btn ghost small" onClick={() => open({ kind: "plan-item", planId: p.id })}>
                  Update
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Meds({ s, open, done }: { s: any; open(o: Open): void; done(message?: string): void }) {
  const clear = async (cls: string) => {
    await api(`/patients/${s.header.id}/barriers/${encodeURIComponent(cls)}/clear`, { body: {} });
    done("Reason removed · suggestions for this drug class can return");
  };
  return (
    <section className="card pad" style={{ paddingBottom: 14 }}>
      <div className="card-head">
        <h2>Medications</h2>
        <button className="btn ghost small" onClick={() => open({ kind: "med-add" })}>+ Add</button>
      </div>
      {s.medications.groups.length === 0 && <div className="empty">No current medications recorded.</div>}
      {s.medications.groups.map((g: any) => (
        <div className="med-group" key={g.purpose}>
          <div className="eyebrow">{g.purpose}</div>
          {g.meds.map((m: any) => (
            <button key={m.id} className={`med ${m.status === "held" ? "held" : ""}`} style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid var(--line-2)", width: "100%" }} onClick={() => open({ kind: "med-action", medId: m.id })}>
              <span className="col grow" style={{ gap: 2 }}>
                <span className="n" style={{ fontSize: 14.5, fontWeight: 700, textDecoration: m.status === "held" || m.status === "not_taking" ? "line-through" : undefined, color: m.status === "held" || m.status === "not_taking" ? "var(--ink-4)" : undefined }}>
                  {m.name}
                  {MEDICATION[m.code]?.brands?.length ? <span className="trade"> · {MEDICATION[m.code].brands![0]}</span> : null}
                </span>
                <span className="s" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-4)" }}>
                  {m.dose} · {m.frequency}
                  {m.lastChange && m.lastChange.kind !== "start" ? ` · ${({ hold: "held", decrease: "reduced", increase: "increased", not_taking: "not taking since", resume: "taken again", frequency: "frequency changed" } as Record<string, string>)[m.lastChange.kind] ?? m.lastChange.kind} ${fmtDay(m.lastChange.at)}` : m.startedAt ? ` · since ${fmtDay(m.startedAt)}` : ""}
                </span>
              </span>
              <MedTag m={m} s={s} />
            </button>
          ))}
        </div>
      ))}
      {s.barriers?.length > 0 && (
        <div className="med-group">
          <div className="eyebrow">Not given · reason recorded</div>
          {s.barriers.map((b: any) => (
            <div key={b.cls} className="barrier">
              <span className="col grow" style={{ gap: 2 }}>
                <b>{b.label}</b>
                <span>{b.reason}{b.detail ? ` · ${b.detail}` : ""} · {fmtDay(b.at)}{b.lasting ? "" : b.active ? " · until next visit" : " · lapsed, suggestions can return"}</span>
              </span>
              <button className="btn ghost small" onClick={() => clear(b.cls)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MedTag({ m, s }: { m: any; s: any }) {
  if (m.status === "held") return <Tag sev="orange">Held</Tag>;
  if (m.status === "not_taking") return <Tag sev="orange">Not taking</Tag>;
  const k = s.attention.find((a: any) => a.rule_id === "hf.hyperkalaemia-review");
  if (k && (m.tags.includes("mra") || m.tags.includes("raas"))) return <Tag sev={m.tags.includes("mra") ? "red" : "orange"}>K review</Tag>;
  if (m.planned) return <Tag sev="blue">{m.planned.category === "monitoring" ? "Check" : "Review"} {fmtDay(m.planned.due_date)}</Tag>;
  return null;
}

function Results({ s, open }: { s: any; open(o: Open): void }) {
  const tone = (r: any): Sev => {
    const v = r.current.value;
    if (r.ref?.high != null && v > r.ref.high) return r.code === "potassium" || r.code === "creatinine" ? (r.code === "potassium" ? "red" : "orange") : "orange";
    if (r.ref?.low != null && v < r.ref.low) return "orange";
    return "gray";
  };
  return (
    <section className="card pad">
      <div className="card-head">
        <h2>Latest results</h2>
        <button className="btn ghost small" onClick={() => open({ kind: "labs" })}>+ Add</button>
      </div>
      {s.results.length === 0 && <div className="empty">No results yet.</div>}
      {s.results.slice(0, 6).map((r: any) => {
        const t = tone(r);
        return (
          <div className="res" key={r.code}>
            <span className="l">{r.label}</span>
            <span>
              <span className="v" style={{ color: t === "gray" ? undefined : `var(--${t}-ink)` }}>
                {formatNumber(r.current.value, r.decimals)}
                <small>{r.unit}</small>
              </span>
              <span className="when" style={{ display: "block" }}>{fmtDay(r.current.at)}</span>
            </span>
            <Sparkline values={r.series.map((p: any) => p.value)} tone={t} />
          </div>
        );
      })}
      {s.lvef && (
        <div className="res" style={{ borderTop: "1px solid var(--line-2)", paddingTop: 12, marginTop: 4 }}>
          <span className="l">LVEF</span>
          <span style={{ gridColumn: "span 2" }}>
            <span className="v">
              {formatNumber(s.lvef.value, 0)}%<small>Echo {fmtDay(s.lvef.at)} · {s.lvef.quality}</small>
            </span>
            {s.lvef.reason === "higher-quality study preferred" && (
              <span className="when" style={{ display: "block", color: "var(--blue-ink)", fontWeight: 700 }}>
                Newer {s.lvef.latestQuality} study {fmtDay(s.lvef.latestAt)} ({formatNumber(s.lvef.latestValue, 0)}%) not used: formal study preferred
              </span>
            )}
          </span>
        </div>
      )}
      {s.vitals.length > 0 && (
        <div className="row wrap small" style={{ gap: 14, marginTop: 10, fontWeight: 700, color: "var(--ink-3)" }}>
          {s.vitals.map((v: any) => (
            <span key={v.code}>
              {({ sbp: "SBP", dbp: "DBP", hr: "HR", weight: "Wt" } as any)[v.code]} {formatNumber(v.value, v.code === "weight" ? 1 : 0)}
              <span className="muted" style={{ fontWeight: 600 }}> · {fmtDay(v.at)}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Upcoming({ s }: { s: any }) {
  if (!s.upcoming.length) return null;
  return (
    <section className="navy-card">
      <h2>Upcoming</h2>
      {s.upcoming.map((p: any) => {
        const d = new Date(p.dueDate + "T12:00:00Z");
        return (
          <div className="cal" key={p.id}>
            <div className="d">
              <small>{fmtDay(p.dueDate).split(" ")[1].toUpperCase()}</small>
              <b>{String(d.getUTCDate()).padStart(2, "0")}</b>
            </div>
            <div className="t">
              <b>{p.title}</b>
              <span>{p.source ? `${p.source.label} · ${fmtDay(p.source.at)}` : p.reason ? `From ${p.reason.toLowerCase()}` : p.category.replace("_", " ")}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
export { fmtTime };

// ---------- Therapy & targets: guideline goals at a glance ----------
function Targets({ s, open }: { s: any; open(o: Open): void }) {
  const t = s.targets;
  if (!t) return null;
  const blocks = [t.ldl, t.bp, t.metabolic, t.diabetes, t.af].filter(Boolean);
  if (!blocks.length && t.kidney.egfr == null) return null;
  const num = (v: number | null, d = 0) => (v == null ? "—" : formatNumber(v, d));
  return (
    <section className="card pad targets" aria-labelledby="tgt">
      <div className="card-head">
        <h2 id="tgt">Therapy &amp; targets</h2>
        <span className="meta">ESC guideline goals · suggestions need clinician confirmation</span>
      </div>
      {t.hf && !s.hf && (
        <div className="tgt-block">
          <div className="tgt-title">
            <span>Heart failure therapy · {t.hf.phenotype}{t.hf.lvef != null ? ` · LVEF ${num(t.hf.lvef)}%` : ""}</span>
          </div>
          <div className="pillars">
            {t.hf.pillars.map((p: any) => (
              <div key={p.key} className={`pillar st-${p.state}`}>
                <small>{p.label}</small>
                <b>{p.med ?? (p.state === "blocked" ? "Not now" : "Not started")}</b>
                {p.percentOfTarget != null && (
                  <span className="bar" aria-label={`${p.percentOfTarget}% of target dose`}>
                    <i style={{ width: `${Math.min(100, p.percentOfTarget)}%` }} />
                  </span>
                )}
                <em>{p.percentOfTarget != null ? `${p.percentOfTarget}% of target ${p.target}` : p.note ?? (p.state === "missing" ? "Foundational therapy" : "")}</em>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="tgt-grid">
        {t.ldl && (
          <Goal
            label="LDL-C"
            value={t.ldl.value != null ? `${num(t.ldl.value, 2)} mmol/L` : "Not measured"}
            goal={`Goal <${t.ldl.goal} · ${t.ldl.category} risk`}
            met={t.ldl.met}
            sub={t.ldl.therapy.length ? t.ldl.therapy.join(" + ") : "No lipid-lowering therapy"}
            onAdd={() => open({ kind: "labs", codes: ["total-cholesterol", "ldl-c", "hdl-c", "triglycerides"] })}
          />
        )}
        {t.bp && (
          <Goal label="Blood pressure" value={t.bp.sbp != null ? (t.bp.dbp != null ? `${num(t.bp.sbp)}/${num(t.bp.dbp)} mmHg` : `SBP ${num(t.bp.sbp)} mmHg`) : "Not measured"} goal={`Goal SBP ${t.bp.target}`} met={t.bp.met} sub={t.bp.at ? fmtDay(t.bp.at) : ""} />
        )}
        {t.metabolic && (
          <Goal
            label="Cardiometabolic"
            value={[t.metabolic.bmi != null ? `BMI ${num(t.metabolic.bmi, 1)}` : null, t.metabolic.hba1c != null ? `HbA1c ${num(t.metabolic.hba1c, 1)}%` : null].filter(Boolean).join(" · ") || "No BMI or HbA1c"}
            goal={[t.metabolic.sglt2.length ? "SGLT2i ✓" : "SGLT2i —", t.metabolic.glp1.length ? "GLP-1 RA ✓" : "GLP-1 RA —"].join(" · ")}
            met={t.metabolic.sglt2.length > 0 && t.metabolic.glp1.length > 0 ? true : null}
            sub={[...t.metabolic.sglt2, ...t.metabolic.glp1].join(" · ")}
          />
        )}
        {t.diabetes && (
          <Goal
            label="Diabetes"
            value={t.diabetes.hba1c != null ? `HbA1c ${num(t.diabetes.hba1c, 1)}%` : "No HbA1c"}
            goal={`Target ${t.diabetes.target}${t.diabetes.source === "default" ? " (default)" : t.diabetes.source === "suggested" ? " (less stringent)" : ""}`}
            met={t.diabetes.met}
            sub={t.diabetes.therapy.length ? t.diabetes.therapy.join(" · ") : "No glucose-lowering therapy"}
          />
        )}
        {t.af && (
          t.af.vkaOnly ? (
            <Goal
              label="AF anticoagulation"
              value="Valve: VKA only"
              goal={t.af.inrTarget && t.af.inrTarget !== "unset" ? `INR target ${num(t.af.inrTarget.target, 1)} (${num(t.af.inrTarget.low, 1)}–${num(t.af.inrTarget.high, 1)})${t.af.inrTarget.source === "suggested" ? " · suggested" : ""}` : t.af.inrTarget === "unset" ? "Warfarin · record the INR target" : "Warfarin whatever the CHA₂DS₂-VA"}
              met={t.af.onVka && t.af.oac.length === 1 && (typeof t.af.inrTarget !== "object" || !t.af.inrTarget || (t.af.inr != null && t.af.inr >= t.af.inrTarget.low && t.af.inr <= t.af.inrTarget.high))}
              sub={[t.af.oac.length ? t.af.oac.join(" · ") : "No anticoagulant", t.af.inr != null ? `INR ${num(t.af.inr, 1)}` : null].filter(Boolean).join(" · ")}
            />
          ) : (
            <Goal label="AF stroke risk" value={`CHA₂DS₂-VA ${t.af.score}`} goal={t.af.score >= 2 ? "OAC recommended" : t.af.score === 1 ? "Consider OAC" : "No OAC indicated"} met={t.af.score === 0 || t.af.oac.length > 0} sub={t.af.oac.length ? t.af.oac.join(" · ") : t.af.items.join(" · ")} />
          )
        )}
        <Goal
          label="Kidney"
          value={[t.kidney.egfr != null ? `eGFR ${num(t.kidney.egfr)}` : null, t.kidney.uacr != null ? `UACR ${num(t.kidney.uacr, 1)}` : null].filter(Boolean).join(" · ") || "No eGFR"}
          goal={t.kidney.uacr == null ? "UACR not measured" : t.kidney.uacr >= 3 ? "Albuminuria" : "No albuminuria"}
          met={t.kidney.uacr == null ? null : t.kidney.uacr < 3 && (t.kidney.egfr ?? 90) >= 60}
          sub={t.kidney.egfrAt ? fmtDay(t.kidney.egfrAt) : ""}
        />
      </div>
    </section>
  );
}

// Heart failure panel (blueprint P2.1, P2.8): HF type with dates, LVEF history, today's status
// against the last value, and each foundational drug with its dates. Reads the record only.
const LAST_CHANGE: Record<string, string> = { frequency: "frequency changed", continue: "frequency changed", start: "started", restart: "restarted", increase: "increased", decrease: "reduced", hold: "held", not_taking: "not taking", resume: "taken again" };
// Coronary disease (coronary module): what happened and when, the antithrombotic regimen with
// each drug's start and planned stop, and secondary prevention at a glance.
const CAD_KIND: Record<string, string> = { acs: "ACS", mi: "MI", pci: "PCI", cabg: "CABG", cath: "Angio" };
function CadPanel({ cad, open }: { cad: any; open(o: Open): void }) {
  if (!cad) return null;
  const at = cad.antithrombotic;
  const ix = cad.index;
  const tile = (label: string, value: string | null, sub: string, warn = false) => (
    <div className={`hf-tile${value ? "" : " none"}${warn ? " warn" : ""}`}>
      <small>{label}</small>
      <b>{value ?? "Not recorded"}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
  return (
    <section className="card pad cad-panel" aria-labelledby="cadp">
      <div className="card-head">
        <h2 id="cadp">Coronary disease</h2>
        <span className="meta">
          <button className="btn ghost small" onClick={() => open({ kind: "procedure", group: "coronary" })}>+ PCI / CABG</button>
        </span>
      </div>
      {ix && (
        <div className="hf-type">
          <b>{ix.title}{ix.detail ? ` · ${ix.detail}` : ""}</b>
          <span>{fmtDay(ix.at, { year: true })} · {ix.days === 0 ? "today" : ix.days === 1 ? "yesterday" : ix.days < 60 ? `${ix.days} days ago` : `${Math.round(ix.days / 30.4)} months ago`} · {ix.acs ? "acute coronary syndrome" : "chronic coronary syndrome"}{ix.pci?.complex ? " · complex PCI" : ""}</span>
        </div>
      )}
      {cad.events.length > 0 && (
        <ol className="cad-events">
          {cad.events.map((e: any, i: number) => (
            <li key={i} className={`k-${e.kind}`}>
              <span className="cad-k">{CAD_KIND[e.kind]}</span>
              <span className="cad-t"><b>{e.title}</b>{e.detail ? <small>{e.detail}</small> : null}</span>
              <span className="cad-d">{e.dateKnown ? fmtDay(e.at, { year: true }) : e.at.slice(0, 4)}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="tgt-title" style={{ marginTop: 14 }}>
        Antithrombotic therapy
        <span className="cad-regimen">{at.regimen}</span>
      </div>
      {at.drugs.length === 0 ? (
        <div className="empty">No antiplatelet or anticoagulant recorded.</div>
      ) : (
        <div className="cad-drugs">
          {at.drugs.map((d: any) => (
            <div key={d.id} className="cad-drug">
              <small>{d.role}</small>
              <b>{d.name} <span className="muted">{d.dose}</span>{d.status === "held" ? <span className="tag-held"> ON HOLD</span> : null}</b>
              <em>{d.since ? `since ${fmtDay(d.since, { year: true })}${d.days != null ? ` · ${d.days === 0 ? "today" : d.days === 1 ? "1 day" : d.days < 60 ? `${d.days} days` : `${Math.round(d.days / 30.4)} months`}` : ""}` : "start date not recorded"}</em>
              <em className={d.plannedStop ? "stop" : "nostop"}>{d.plannedStop ? `Planned: ${d.plannedStop.title} · ${fmtDay(d.plannedStop.at, { year: true })}` : "No planned stop date"}</em>
            </div>
          ))}
        </div>
      )}
      <div className="tgt-title" style={{ marginTop: 14 }}>Secondary prevention</div>
      <div className="hf-tiles">
        {tile(
          "LDL-C",
          cad.lipids.ldl ? `${formatNumber(cad.lipids.ldl.value, 2)} mmol/L` : null,
          [cad.lipids.ldl ? fmtDay(cad.lipids.ldl.at) : null, cad.lipids.goal ? `goal <${cad.lipids.goal.value} (${cad.lipids.goal.category} risk)` : null, cad.lipids.atGoal === true ? "at goal" : cad.lipids.atGoal === false ? "above goal" : null].filter(Boolean).join(" · "),
          cad.lipids.atGoal === false,
        )}
        {tile("Lipid therapy", cad.lipids.therapy.length ? cad.lipids.therapy.map((t: any) => `${t.name} ${t.dose}`).join(" + ") : null, cad.lipids.therapy.find((t: any) => t.intensity) ? `${cad.lipids.therapy.find((t: any) => t.intensity).intensity}-intensity statin` : "", !cad.lipids.therapy.length)}
        {tile("LVEF", cad.lvef ? `${formatNumber(cad.lvef.value, 0)}%` : null, cad.lvef ? fmtDay(cad.lvef.at, { year: true }) : "")}
        {tile("Systolic BP", cad.sbp ? `${formatNumber(cad.sbp.value, 0)} mmHg` : null, cad.sbp ? fmtDay(cad.sbp.at) : "")}
        {tile("Cardiac rehab", cad.rehab ? (cad.rehab.status === "completed" ? "Done" : cad.rehab.status === "planned" ? "Referral planned" : cad.rehab.status) : null, cad.rehab?.due ? fmtDay(cad.rehab.due, { year: true }) : cad.rehab ? "" : "No referral recorded")}
        {cad.smoker && tile("Smoking", "Current smoker", "Cessation support", true)}
      </div>
    </section>
  );
}

// Rhythm & devices (rhythm module): AF with its stroke-risk score and anticoagulation, rate and
// rhythm control, the latest ECG and ambulatory ECG, devices, ablations and cardioversions.
const RH_KIND: Record<string, string> = { device: "Device", ablation: "Ablation", cardioversion: "DCCV" };
function RhythmPanel({ r, open }: { r: any; open(o: Open): void }) {
  if (!r) return null;
  const ago = (iso: string | null) => (iso ? fmtDay(iso, { year: true }) : "date not recorded");
  const drugs = (l: any[]) => (l.length ? l.map((d) => `${d.name} ${d.dose}${d.status === "held" ? " (on hold)" : ""}`).join(" + ") : null);
  const tile = (label: string, value: string | null, sub: string, warn = false) => (
    <div className={`hf-tile${value ? "" : " none"}${warn ? " warn" : ""}`}>
      <small>{label}</small>
      <b>{value ?? "None"}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
  const oac = r.anticoagulation[0];
  const needsOac = r.stroke && r.stroke.score >= 2 && !oac;
  return (
    <section className="card pad cad-panel" aria-labelledby="rhp">
      <div className="card-head">
        <h2 id="rhp">Rhythm &amp; devices</h2>
        <span className="meta">
          {r.device && (
            <button className="btn ghost small" onClick={() => open({ kind: "study", studyKind: "device_check", initial: r.device.type ? { device: r.device.type } : {} })}>+ Device check</button>
          )}
          <button className="btn ghost small" onClick={() => open({ kind: "procedure", group: "rhythm" })}>+ Device / ablation / DCCV</button>
        </span>
      </div>
      {r.af && (
        <div className="hf-type">
          <b>{r.af.title}{r.af.pattern ? ` · ${r.af.pattern.toLowerCase()}` : " · pattern not recorded"}</b>
          <span>
            {[r.af.since ? `since ${r.af.since.length === 4 ? r.af.since : fmtDay(r.af.since, { year: true })}` : null,
              r.stroke ? `CHA₂DS₂-VA ${r.stroke.score}${r.stroke.items.length ? ` (${r.stroke.items.join(", ")})` : ""} · ${r.stroke.advice}` : null].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}
      {r.conditions.length > 0 && (
        <div className="row wrap" style={{ gap: 6, margin: "4px 0 10px" }}>
          {r.conditions.map((c: any, i: number) => <span key={i} className="reg-chip">{c.title}{c.detail ? ` · ${c.detail}` : ""}</span>)}
        </div>
      )}
      <div className="hf-tiles">
        {(r.af || oac) && tile(
          "Anticoagulation",
          oac ? `${oac.name} ${oac.dose}` : needsOac ? "Not anticoagulated" : null,
          oac ? [oac.since ? `since ${fmtDay(oac.since, { year: true })}` : null, oac.doseCheck].filter(Boolean).join(" · ") : r.stroke ? `CHA₂DS₂-VA ${r.stroke.score}` : "",
          needsOac || oac?.doseOk === false,
        )}
        {tile("Rate control", drugs(r.rate), r.rate.length ? "" : "No rate-control drug")}
        {tile("Rhythm control", drugs(r.rhythm), r.rhythm.length ? r.rhythm.map((d: any) => (d.since ? `${d.name} since ${fmtDay(d.since, { year: true })}` : "")).filter(Boolean).join(" · ") : "No antiarrhythmic drug")}
        {tile("Heart rate", r.hr ? `${formatNumber(r.hr.value, 0)} bpm` : null, r.hr ? fmtDay(r.hr.at) : "Not recorded")}
        {tile(
          "Latest ECG",
          r.ecg ? `${r.ecg.rhythm ?? "Rhythm not recorded"}${r.ecg.rate ? ` · ${r.ecg.rate} bpm` : ""}` : null,
          r.ecg ? [fmtDay(r.ecg.at, { year: true }), r.ecg.qrs ? `QRS ${r.ecg.qrs} ms${r.ecg.morphology && r.ecg.morphology !== "Normal" ? ` ${r.ecg.morphology}` : ""}` : null, r.ecg.qtc ? `QTc ${r.ecg.qtc} ms` : null, r.ecg.avBlock && r.ecg.avBlock !== "None" ? r.ecg.avBlock : null].filter(Boolean).join(" · ") : "No ECG recorded",
        )}
        {tile("Ambulatory ECG", r.holter ? r.holter.summary || "Recorded" : null, r.holter ? fmtDay(r.holter.at, { year: true }) : "No Holter recorded")}
      </div>
      {r.devices.length > 0 && (
        <>
          <div className="tgt-title" style={{ marginTop: 14 }}>Devices</div>
          {r.device && (
            <div className={`dev-check${r.device.overdue || (r.device.check && r.device.check.battery !== "OK") ? " warn" : ""}`}>
              <div>
                <small>Last device check</small>
                <b>{r.device.check ? fmtDay(r.device.check.at, { year: true }) : "None recorded"}</b>
                <em>{r.device.check ? r.device.check.summary : r.device.implantAt ? `Implanted ${fmtDay(r.device.implantAt, { year: true })}` : ""}</em>
              </div>
              <div>
                <small>Next check</small>
                <b>{r.device.dueAt ? `${r.device.overdue ? "Overdue · " : ""}${fmtDay(r.device.dueAt, { year: true })}` : r.device.type === "Loop recorder" ? "Alert-based" : "—"}</b>
                <em>{r.device.intervalMonths ? `at least every ${r.device.intervalMonths} months (HRS/EHRA 2023)` : r.device.type === "Loop recorder" ? "Remote alerts; no routine visit" : "Device date not recorded"}</em>
              </div>
            </div>
          )}
          <div className="cad-drugs">
            {r.devices.map((d: any, i: number) => (
              <div key={i} className="cad-drug">
                <small>{d.action ?? "Device"}</small>
                <b>{d.type}</b>
                <em>{[ago(d.at), d.indication, d.pacing && d.pacing !== "No pacing lead" ? d.pacing : null].filter(Boolean).join(" · ")}</em>
              </div>
            ))}
          </div>
        </>
      )}
      {r.events.length > 0 && (
        <>
          <div className="tgt-title" style={{ marginTop: 14 }}>Procedures</div>
          <ol className="cad-events">
            {r.events.map((e: any, i: number) => (
              <li key={i} className={`k-${e.kind}`}>
                <span className="cad-k">{RH_KIND[e.kind] ?? e.title}</span>
                <span className="cad-t"><b>{e.title}</b>{e.detail ? <small>{e.detail}</small> : null}</span>
                <span className="cad-d">{fmtDay(e.at, { year: true })}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

// Valve module, slice 1: native lesions (problem list and latest echo), prostheses and repairs,
// echo measurements, antithrombotic therapy and INR, and valve interventions.
function ValvePanel({ v, open }: { v: any; open(o: Open): void }) {
  if (!v) return null;
  const when = (iso: string | null) => (!iso ? "date not recorded" : iso.length === 4 ? iso : fmtDay(iso, { year: true }));
  const drugs = (l: any[]) => (l.length ? l.map((d) => `${d.name} ${d.dose}${d.held ? " (on hold)" : ""}`).join(" + ") : null);
  return (
    <section className="card pad cad-panel" aria-labelledby="vlp">
      <div className="card-head">
        <h2 id="vlp">Valve disease</h2>
        <span className="meta">
          <button className="btn ghost small" onClick={() => open({ kind: "echo" } as Open)}>+ Echo</button>
          <button className="btn ghost small" onClick={() => open({ kind: "procedure", group: "valve" })}>+ Valve intervention</button>
        </span>
      </div>
      {v.lesions.length > 0 && (
        <div className="cad-drugs" style={{ marginBottom: 10 }}>
          {v.lesions.map((l: any) => {
            const differs = l.echo && l.severity && l.echo.grade !== l.severity;
            return (
              <div key={l.code} className="cad-drug">
                <small>{l.treated ? "Treated" : l.listed ? "Problem list" : "Echo only — not listed"}</small>
                <b>{l.title}{l.severity ? ` · ${l.severity.toLowerCase()}` : l.listed ? " · severity not recorded" : ""}</b>
                <em className={!l.treated && (differs || !l.listed) ? "stop" : ""}>{l.treated ? l.treated.replace(/ · (\d{4}-\d{2}-\d{2})$/, (_m: string, d: string) => ` · ${fmtDay(d, { year: true })}`) : l.echo ? `Echo ${fmtDay(l.echo.at, { year: true })}: ${l.echo.grade.toLowerCase()}` : "Not graded on a recent echo"}</em>
              </div>
            );
          })}
        </div>
      )}
      {v.prostheses.length > 0 && (
        <>
          <div className="tgt-title">Prostheses &amp; repairs</div>
          <div className="cad-drugs" style={{ marginBottom: 10 }}>
            {v.prostheses.map((p: any, i: number) => (
              <div key={i} className="cad-drug">
                <small>{p.position ?? "Position not recorded"}</small>
                <b>{p.type}{p.design ? ` · ${p.design}` : ""}</b>
                <em>{[p.procedure, `since ${when(p.since)}`, p.inrTarget ? `INR target ${p.inrTarget}` : null].filter(Boolean).join(" · ")}</em>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="hf-tiles">
        {v.echo.values.map((x: any) => (
          <div key={x.code} className="hf-tile">
            <small>{x.label}</small>
            <b>{x.value} {x.unit}</b>
            <em>{fmtDay(x.at, { year: true })}</em>
          </div>
        ))}
        <div className={`hf-tile${v.anticoagulant.length ? "" : " none"}`}>
          <small>Anticoagulation</small>
          <b>{drugs(v.anticoagulant) ?? "None"}</b>
          <em>{v.inr ? `INR ${v.inr.value} · ${fmtDay(v.inr.at)}` : v.anticoagulant.length ? "" : "—"}</em>
        </div>
        <div className={`hf-tile${v.antiplatelet.length ? "" : " none"}`}>
          <small>Antiplatelet</small>
          <b>{drugs(v.antiplatelet) ?? "None"}</b>
          <em />
        </div>
      </div>
      {v.events.length > 0 && (
        <>
          <div className="tgt-title" style={{ marginTop: 14 }}>Valve interventions</div>
          <ol className="cad-events">
            {v.events.map((e: any, i: number) => (
              <li key={i} className="k-valve">
                <span className="cad-k">Valve</span>
                <span className="cad-t"><b>{e.title}</b></span>
                <span className="cad-d">{fmtDay(e.at, { year: true })}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function HfPanel({ hf, open }: { hf: any; open(o: Open): void }) {
  if (!hf) return null;
  const n = (v: number | null | undefined, d = 0) => (v == null ? "—" : formatNumber(v, d));
  const delta = (p: any, d = 0, unit = "") =>
    p.now && p.before ? `${p.now.value > p.before.value ? "↑" : p.now.value < p.before.value ? "↓" : "→"} from ${n(p.before.value, d)}${unit} (${fmtDay(p.before.at)})` : p.now ? "First value" : "";
  const tile = (label: string, value: string | null, sub: string, extra?: React.ReactNode) => (
    <div className={`hf-tile${value ? "" : " none"}`}>
      <small>{label}</small>
      <b>{value ?? "Not recorded"}</b>
      {sub && <em>{sub}</em>}
      {extra}
    </div>
  );
  const w = hf.weight;
  const pctChange = hf.ntprobnp.now && hf.ntprobnp.before ? Math.round(((hf.ntprobnp.now.value - hf.ntprobnp.before.value) / hf.ntprobnp.before.value) * 100) : null;
  return (
    <section className="card pad hf-panel" aria-labelledby="hfp">
      <div className="card-head">
        <h2 id="hfp">Heart failure</h2>
        <span className="meta">ESC HF 2026 classification</span>
      </div>
      <div className="hf-type">
        <b>{hf.typeLabel}</b>
        <span>
          {[
            hf.typeSince ? `since ${fmtDay(hf.typeSince, { year: true })}` : null,
            hf.aetiology ? hf.aetiology : "Aetiology not recorded",
            hf.onset ? `diagnosed ${fmtDay(hf.onset, { year: true })}` : null,
            `HF admissions: ${hf.admissions.last12m} in 12 months${hf.admissions.last ? ` · last ${fmtDay(hf.admissions.last.at)}${hf.admissions.last.open ? " (current)" : ""}` : ""}`,
          ].filter(Boolean).join(" · ")}
        </span>
      </div>
      {hf.improved && <div className="infobox">LVEF has improved from {n(hf.improved.lowest)}% ({fmtDay(hf.improved.at, { year: true })}). Keep foundational therapy: stopping it risks relapse.</div>}
      <div className="hf-tiles">
        {tile(
          "LVEF",
          hf.lvef.length ? `${n(hf.lvef[hf.lvef.length - 1].value)}%` : null,
          hf.lvef.length ? `${fmtDay(hf.lvef[hf.lvef.length - 1].at)}${hf.lowestLvef && hf.lvefCount > 1 ? ` · lowest ${n(hf.lowestLvef.value)}% (${fmtDay(hf.lowestLvef.at, { year: true })})` : ""}` : "",
          hf.lvef.length > 1 ? <Sparkline values={hf.lvef.map((x: any) => x.value)} tone="blue" /> : null,
        )}
        {tile("NYHA class", hf.nyha.now?.value ?? null, hf.nyha.now ? `${fmtDay(hf.nyha.now.at)}${hf.nyha.before ? ` · was ${hf.nyha.before.value}` : ""}` : "")}
        {tile("Congestion", hf.congestion?.value ?? null, hf.congestion ? fmtDay(hf.congestion.at) : "")}
        {tile(
          "Weight",
          w.now ? `${n(w.now.value, 1)} kg` : null,
          [w.now ? fmtDay(w.now.at) : null, w.dry ? `dry ${n(w.dry.value, 1)} kg${w.dry.source === "discharge weight" ? " (discharge)" : ""}` : "dry weight not set", w.aboveDry != null ? (w.aboveDry === 0 ? "at dry weight" : `${n(Math.abs(w.aboveDry), 1)} kg ${w.aboveDry > 0 ? "above" : "below"} dry`) : null].filter(Boolean).join(" · "),
        )}
        {tile("NT-proBNP", hf.ntprobnp.now ? `${n(hf.ntprobnp.now.value)} pg/mL` : null, hf.ntprobnp.now ? `${fmtDay(hf.ntprobnp.now.at)}${pctChange != null ? ` · ${pctChange > 0 ? "+" : ""}${pctChange}% vs ${fmtDay(hf.ntprobnp.before.at)}` : ""}` : "")}
        {tile("KCCQ-12", hf.kccq.now ? `${n(hf.kccq.now.value)} / 100` : null, hf.kccq.now ? `${fmtDay(hf.kccq.now.at)} · ${delta(hf.kccq)}` : "Record at the visit")}
        {tile("6-minute walk", hf.walk.now ? `${n(hf.walk.now.value)} m` : null, hf.walk.now ? `${fmtDay(hf.walk.now.at)} · ${delta(hf.walk, 0, " m")}` : "Record at the visit")}
      </div>
      <div className="tgt-title" style={{ marginTop: 14 }}>
        Foundational therapy
        {hf.optimal && (
          <span className={`fmt-state${hf.optimal.complete ? " ok" : ""}`}>
            {hf.optimal.complete
              ? `All pillars since ${fmtDay(hf.optimal.since, { year: true })} · 3 months on ${fmtDay(hf.optimal.reassessFrom, { year: true })}`
              : `Not complete: ${hf.optimal.gaps.join(", ")}`}
          </span>
        )}
      </div>
      <div className="pillars">
        {hf.pillars.map((p: any) => {
          const d = hf.therapy.find((t: any) => p.med && p.med.startsWith(t.name));
          return (
            <div key={p.key} className={`pillar st-${p.state}`}>
              <small>{p.label}</small>
              <b>{p.med ?? (p.state === "blocked" ? "Not now" : "Not started")}</b>
              {p.percentOfTarget != null && (
                <span className="bar" aria-label={`${p.percentOfTarget}% of target dose`}>
                  <i style={{ width: `${Math.min(100, p.percentOfTarget)}%` }} />
                </span>
              )}
              <em>{p.percentOfTarget != null ? `${p.percentOfTarget}% of target ${p.target}` : p.note ?? (p.state === "missing" ? "Foundational therapy" : "")}</em>
              {d && (
                <em className="dates">
                  {d.atTargetSince
                    ? `At target since ${fmtDay(d.atTargetSince, { year: true })}`
                    : [d.started ? `Since ${fmtDay(d.started, { year: true })}` : null, d.lastChange && d.lastChange.kind !== "start" ? `${LAST_CHANGE[d.lastChange.kind] ?? d.lastChange.kind} ${fmtDay(d.lastChange.at)}` : null].filter(Boolean).join(" · ")}
                </em>
              )}
            </div>
          );
        })}
      </div>
      {hf.timeline?.lanes.length > 0 && <TreatmentTimeline t={hf.timeline} />}
      {hf.lvef.length > 1 && !(hf.timeline?.lanes.length > 0) && (
        <div className="hf-ef">
          <span className="tgt-title">LVEF history</span>
          <ol>
            {hf.lvef.map((x: any) => (
              <li key={x.at} className={x.type}>
                <b>{n(x.value)}%</b>
                <span>{fmtDay(x.at, { year: true })}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn ghost small" onClick={() => open({ kind: "labs", codes: ["nt-probnp", "creatinine", "potassium", "sodium"] })}>Add HF labs</button>
      </div>
    </section>
  );
}

// Treatment timeline: one lane per HF medicine, each dose period a bar whose shade is the % of
// target dose (one-hue ordinal ramp, validated); held = outlined, not taking = striped; HF
// admissions as grey bands across every lane; LVEF and NT-proBNP on the same time axis below.
const PCT_STEPS = [
  { min: 100, color: "#184f95", label: "At target" },
  { min: 50, color: "#2a78d6", label: "50–99%" },
  { min: 25, color: "#5598e7", label: "25–49%" },
  { min: 0, color: "#86b6ef", label: "<25%" },
];
const pctColor = (p: number | null) => (p == null ? "#9aa1ab" : PCT_STEPS.find((x) => p >= x.min)!.color);
const STATE_LABEL: Record<string, string> = { active: "", held: " · held", not_taking: " · patient not taking" };
function TreatmentTimeline({ t }: { t: any }) {
  const [focus, setFocus] = useState<string>("");
  const [table, setTable] = useState(false);
  const t0 = Date.parse(t.from), t1 = Date.parse(t.to);
  const x = (iso: string) => Math.max(0, Math.min(100, ((Date.parse(iso) - t0) / (t1 - t0)) * 100));
  const isNow = (iso: string) => iso >= t.to.slice(0, 10);
  // month ticks, at most 6
  const months: string[] = [];
  for (let d = new Date(t.from.slice(0, 7) + "-01T00:00:00Z"); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1)) if (d.getTime() >= t0) months.push(d.toISOString());
  const step = Math.max(1, Math.ceil(months.length / 5));
  const ticks = months.filter((m, i) => i % step === 0 && x(m) > 4 && x(m) < 94);
  const tickLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  const segText = (l: any, g: any) =>
    `${l.name}: ${g.dose || "dose not recorded"}${g.pct != null ? ` · ${g.pct}% of target` : ""}${STATE_LABEL[g.state]} · ${fmtDay(g.from, { year: true })} → ${isNow(g.to) ? "now" : fmtDay(g.to, { year: true })}`;
  const bands = t.admissions.filter((a: any) => a.hf);
  const Bands = () => (
    <>
      {bands.map((a: any) => (
        <i key={a.from} className="tl-band" style={{ left: `${x(a.from)}%`, width: `max(3px, ${x(a.to) - x(a.from)}%)` }} />
      ))}
    </>
  );
  // selective labels: the latest point always, earlier ones only when they do not collide
  const labelled = (pts: any[]) => {
    const keep = new Set<string>();
    let lastX = Infinity;
    for (let i = pts.length - 1; i >= 0; i--) {
      const px = x(pts[i].at);
      if (lastX - px >= 9) { keep.add(pts[i].at); lastX = px; }
    }
    return keep;
  };
  const pointRow = (label: string, pts: any[], fmt: (v: number) => string) =>
    pts.length > 0 && (
      <div className="tl-row tl-points">
        <span className="tl-name"><b>{label}</b></span>
        <div className="tl-track">
          <Bands />
          {pts.map((p: any, _i: number, all: any[]) => (
            <button key={p.at} className={`tl-pt${labelled(all).has(p.at) ? "" : " nolabel"}${x(p.at) > 90 ? " end" : x(p.at) < 6 ? " start" : ""}`} style={{ left: `${x(p.at)}%` }} onMouseEnter={() => setFocus(`${label} ${fmt(p.value)} · ${fmtDay(p.at, { year: true })}`)} onClick={() => setFocus(`${label} ${fmt(p.value)} · ${fmtDay(p.at, { year: true })}`)} aria-label={`${label} ${fmt(p.value)} on ${fmtDay(p.at, { year: true })}`}>
              <b>{fmt(p.value)}</b>
              <i />
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <div className="tl">
      <div className="tl-top">
        <span className="tgt-title">Treatment timeline</span>
        <button className="btn ghost small" onClick={() => setTable(!table)}>{table ? "Show as timeline" : "Show as table"}</button>
      </div>
      {table ? (
        <table className="data">
          <thead><tr><th>Medicine</th><th>Dose</th><th>% of target</th><th>From</th><th>To</th></tr></thead>
          <tbody>
            {t.lanes.flatMap((l: any) => l.segments.map((g: any) => (
              <tr key={l.id + g.from}>
                <td data-label="Medicine">{l.name}{STATE_LABEL[g.state]}</td>
                <td data-label="Dose">{g.dose || "—"}</td>
                <td data-label="% of target">{g.pct != null ? `${g.pct}%` : "—"}</td>
                <td data-label="From">{fmtDay(g.from, { year: true })}</td>
                <td data-label="To">{isNow(g.to) ? "now" : fmtDay(g.to, { year: true })}</td>
              </tr>
            )))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="tl-chart" onMouseLeave={() => setFocus("")}>
            {t.lanes.map((l: any) => {
              const last = l.segments[l.segments.length - 1];
              return (
                <div key={l.id} className={`tl-row${l.current ? "" : " past"}`}>
                  <span className="tl-name">
                    <b>{l.name}</b>
                    <em>{l.current ? `${last.dose}${last.pct != null ? ` · ${last.pct}%` : ""}${STATE_LABEL[last.state]}` : `stopped ${fmtDay(l.stopped, { year: true })}`}</em>
                  </span>
                  <div className="tl-track">
                    <Bands />
                    {l.segments.filter((g: any) => g.to > t.from).map((g: any) => {
                      const left = x(g.from), w = x(g.to) - left;
                      const c = pctColor(l.hasTarget ? g.pct : null);
                      return (
                        <button
                          key={g.from}
                          className={`tl-seg st-${g.state}`}
                          style={{ left: `${left}%`, width: `max(4px, calc(${w}% - 2px))`, ["--c" as any]: c }}
                          onMouseEnter={() => setFocus(segText(l, g))}
                          onFocus={() => setFocus(segText(l, g))}
                          onClick={() => setFocus(segText(l, g))}
                          aria-label={segText(l, g)}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {pointRow("LVEF", t.lvef, (v) => `${formatNumber(v, 0)}%`)}
            {pointRow("NT-proBNP", t.ntprobnp, (v) => formatNumber(v, 0))}
            <div className="tl-row tl-axis">
              <span className="tl-name" />
              <div className="tl-track">
                {ticks.map((m) => (
                  <span key={m} style={{ left: `${x(m)}%` }}>{tickLabel(m)}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="tl-focus" aria-live="polite">{focus || "Hover or tap a bar or point for details."}</div>
          <div className="tl-legend">
            <span>% of target dose:</span>
            {PCT_STEPS.slice().reverse().map((p) => (
              <span key={p.label}><i style={{ background: p.color }} />{p.label}</span>
            ))}
            <span><i style={{ background: "#9aa1ab" }} />No target dose</span>
            <span><i className="held" />Held</span>
            <span><i className="nt" />Not taking</span>
            {bands.length > 0 && <span><i className="band" />HF admission</span>}
          </div>
        </>
      )}
    </div>
  );
}

function Goal({ label, value, goal, met, sub, onAdd }: { label: string; value: string; goal: string; met: boolean | null; sub?: string; onAdd?(): void }) {
  return (
    <div className={`goal ${met === true ? "met" : met === false ? "unmet" : "unknown"}`}>
      <small>{label}</small>
      <b>{value}</b>
      <span className="g">
        {met === true ? "✓ " : met === false ? "▲ " : ""}
        {goal}
      </span>
      {sub && <em>{sub}</em>}
      {onAdd && met === null && (
        <button className="btn ghost small" onClick={onAdd}>
          Add result
        </button>
      )}
    </div>
  );
}
