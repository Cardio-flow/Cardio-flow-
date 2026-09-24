import { useState } from "react";
import { BookOpen, Check } from "lucide-react";
import { Link, SevIcon, Sparkline, Tag, type Sev } from "../ui";
import { fmtDay, fmtTime } from "../../shared/clinical";
import { formatNumber } from "../../shared/catalog";
import type { Open } from "./Patient";

export function SummaryTab({ s, open }: { s: any; open(o: Open): void }) {
  return (
    <main className="page">
      <div className="grid-main">
        <div className="stack">
          <Attention s={s} open={open} />
          <Targets s={s} open={open} />
          <Changes changes={s.changes} />
          <ActivePlan s={s} open={open} />
        </div>
        <div className="stack">
          <Meds s={s} open={open} />
          <Results s={s} open={open} />
          <Upcoming s={s} />
        </div>
      </div>
    </main>
  );
}

function Attention({ s, open }: { s: any; open(o: Open): void }) {
  const [why, setWhy] = useState<string | null>(null);
  return (
    <section className="card pad" aria-labelledby="att">
      <div className="card-head">
        <h2 id="att">Needs attention</h2>
        <span className="meta">Rules re-run whenever new data arrives</span>
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
                {a.rule_status !== "PUBLISHED" && <span className="draft">RULE IN CLINICAL REVIEW · SANDBOX ONLY</span>}
              </div>
              <button className="why" aria-expanded={why === a.id} onClick={() => setWhy(why === a.id ? null : a.id)}>
                Why?
              </button>
              <ActionButton a={a} open={open} />
            </div>
            {why === a.id && <WhyPanel a={a} />}
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
        {act.wizard === "hyperkalaemia" ? "Manage hyperkalaemia" : act.wizard === "renal-function" ? "Review renal function" : "Review"}
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
        {act.template === "renal-k" ? "Book renal/K check" : "Add to plan"}
      </button>
    );
  if (act.type === "tab")
    return (
      <Link className="go" to={`${location.pathname.replace(/\/(journey|visits|medications|investigations|plan|registries)$/, "")}/${act.tab}`}>
        {act.tab === "medications" ? "Review medications" : "Review plan"}
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
  if (act.type === "add-labs")
    return (
      <button className="go" onClick={() => open({ kind: "labs", codes: act.codes })}>
        {act.label}
      </button>
    );
  return null;
}

export function WhyPanel({ a }: { a: any }) {
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
      {a.facts.filter((f: any) => f.label === "Guideline").map((f: any, i: number) => (
        <div className="guideline-src" key={"g" + i}>
          <BookOpen size={14} /> {f.value}
        </div>
      ))}
      {a.missing.length > 0 && (
        <div className="small" style={{ fontWeight: 700, color: "var(--orange-ink)" }}>
          Assessment incomplete: {a.missing.join(", ")} not available. Missing data is never assumed normal.
        </div>
      )}
    </div>
  );
}

function Changes({ changes }: { changes: any }) {
  return (
    <section className="card pad">
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
    <section className="card pad">
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

function Meds({ s, open }: { s: any; open(o: Open): void }) {
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
                <span className="n" style={{ fontSize: 14.5, fontWeight: 700, textDecoration: m.status === "held" ? "line-through" : undefined, color: m.status === "held" ? "var(--ink-4)" : undefined }}>{m.name}</span>
                <span className="s" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-4)" }}>
                  {m.dose} · {m.frequency}
                  {m.lastChange && m.lastChange.kind !== "start" ? ` · ${m.lastChange.kind === "hold" ? "held" : m.lastChange.kind === "decrease" ? "reduced" : m.lastChange.kind === "increase" ? "increased" : m.lastChange.kind} ${fmtDay(m.lastChange.at)}` : m.startedAt ? ` · since ${fmtDay(m.startedAt)}` : ""}
                </span>
              </span>
              <MedTag m={m} s={s} />
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}

function MedTag({ m, s }: { m: any; s: any }) {
  if (m.status === "held") return <Tag sev="orange">Held</Tag>;
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
  const blocks = [t.hf, t.ldl, t.bp, t.metabolic, t.af].filter(Boolean);
  if (!blocks.length && t.kidney.egfr == null) return null;
  const num = (v: number | null, d = 0) => (v == null ? "—" : formatNumber(v, d));
  return (
    <section className="card pad targets" aria-labelledby="tgt">
      <div className="card-head">
        <h2 id="tgt">Therapy &amp; targets</h2>
        <span className="meta">ESC guideline goals · suggestions need clinician confirmation</span>
      </div>
      {t.hf && (
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
        {t.af && (
          <Goal label="AF stroke risk" value={`CHA₂DS₂-VA ${t.af.score}`} goal={t.af.score >= 2 ? "OAC recommended" : t.af.score === 1 ? "Consider OAC" : "No OAC indicated"} met={t.af.score === 0 || t.af.oac.length > 0} sub={t.af.oac.length ? t.af.oac.join(" · ") : t.af.items.join(" · ")} />
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
