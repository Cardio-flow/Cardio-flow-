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
          <Attention s={s} open={open} done={done} />
          <HfPanel hf={s.hf} open={open} />
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
          diabetes: "Diabetes plan", "sick-day": "Sick-day rules", ramadan: "Ramadan plan" } as Record<string, string>)[act.wizard] ?? "Review"}
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
        {act.template === "renal-k" ? "Book renal/K check" : act.template === "ecg" ? "Book ECG" : act.template === "device" ? "Plan device review" : act.template === "dm-eyes" ? "Book retinal screening" : act.template === "dm-feet" ? "Plan foot examination" : "Add to plan"}
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
                  {m.lastChange && m.lastChange.kind !== "start" ? ` · ${({ hold: "held", decrease: "reduced", increase: "increased", not_taking: "not taking since", resume: "taken again" } as Record<string, string>)[m.lastChange.kind] ?? m.lastChange.kind} ${fmtDay(m.lastChange.at)}` : m.startedAt ? ` · since ${fmtDay(m.startedAt)}` : ""}
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
const LAST_CHANGE: Record<string, string> = { start: "started", restart: "restarted", increase: "increased", decrease: "reduced", hold: "held", not_taking: "not taking", resume: "taken again" };
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
