// The overview's first screen (workflow redesign, slice 1): one flow bar, then the open findings in four
// lanes — act now, decide, order & book, consider — with merged cards (shared/triage.ts).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, FlaskConical, X, RotateCcw } from "lucide-react";
import { api } from "../api";
import { formatNumber } from "../../shared/catalog";
import { SevIcon } from "../ui";
import { fmtDay } from "../../shared/clinical";
import { triage, type Card, type Lane, PANEL_OF } from "../../shared/triage";
import { ActionButton, WhyPanel } from "./Summary";
import { SuggestLine } from "./SuggestLine";
import { MEDICATION } from "../../shared/catalog";
import type { Open } from "./Patient";

const LANES: { key: Lane; label: string; hint: string }[] = [
  { key: "act", label: "Act now", hint: "Safety and acute events" },
  { key: "decide", label: "Decide", hint: "Treatment and pathway decisions" },
  { key: "order", label: "Order & book", hint: "Labs, tests and checks due" },
  { key: "consider", label: "Consider", hint: "Prevention to discuss" },
];

export function useTriage(s: any) {
  const cards = triage(s.attention);
  const by = (l: Lane) => cards.filter((c) => c.lane === l);
  const count = (l: Lane) => (l === "order" ? by(l).reduce((n, c) => n + c.items.length, 0) : by(l).length);
  // panels that hold an act-now or decide finding open by default
  const hot = new Set(cards.filter((c) => c.lane === "act" || c.lane === "decide").flatMap((c) => c.items.map((f) => PANEL_OF(f.rule_id))).filter(Boolean) as string[]);
  return { cards, by, count, hot };
}

export function TodayBoard({ s, open, done }: { s: any; open(o: Open): void; done(message?: string): void }) {
  const t = useTriage(s);
  const [why, setWhy] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const total = LANES.reduce((n, l) => n + t.count(l.key), 0);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const rdn = t.cards.find(c => c.items.some(a => a.rule_id === "htn.rdn"));
  const draft = s.attention.some((a: any) => a.rule_status !== "PUBLISHED");
  const [dismiss, setDismiss] = useState<string | null>(null);
  const row = { why, setWhy, open, done, patientId: s.header.id, s, line, setLine, dismiss, setDismiss };
  return (
    <section className="tb" aria-labelledby="att-h" id="att">
      <div className="tb-head">
        <h2 id="att-h">Today</h2>
        <Brief o={s.overview} />
      </div>
      {total === 0 && !s.plan.some((p: any) => p.awaitingReview) ? (
        <div className="tb-clear">
          <CheckCircle2 size={22} /> Nothing needs attention. Every plan item is on track.
        </div>
      ) : total > 0 ? (
        <div className="flowbar" role="list" aria-label="Open items by lane">
          {LANES.filter((l) => t.count(l.key) > 0).map((l) => (
            <button key={l.key} role="listitem" className={`seg lane-${l.key}`} style={{ flexGrow: Math.max(1, Math.min(4, t.count(l.key))) }} onClick={() => go("lane-" + l.key)}>
              <b>{t.count(l.key)}</b>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {rdn && <button className="btn secondary small rdn-jump" onClick={() => go(`decision-${rdn.key}`)}>RDN assessment available ↓</button>}
      {draft && <p className="tb-draft">Items marked “in review” come from rules still in clinical review. They run on this sandbox only.</p>}
      <ProblemBoard s={s} open={open} />
      <DecisionContext context={s.reviewContext} open={open} />


      {t.by("act").length > 0 && (
        <LaneBox lane="act">
          {t.by("act").map((c) => <CardRow key={c.key} c={c} {...row} />)}
        </LaneBox>
      )}
      {s.plan.some((p: any) => p.awaitingReview) && <div className="lane review-queue" aria-label="Results awaiting review">
        <div className="lane-head"><span className="lane-title">Results to review</span><span className="lane-hint">Recorded evidence, awaiting your decision</span></div>
        <div className="lane-rows">{s.plan.filter((p: any) => p.awaitingReview).map((p: any) => <div className="review-row" key={p.id}><div><b>{p.title}</b><span className="small muted">{p.owner ? `Owner: ${p.owner} · ` : ""}{p.completedAt ? fmtDay(p.completedAt) : "Result recorded"}</span></div><button className="btn secondary small" onClick={() => open({ kind: "plan-item", planId: p.id })}>Review result</button></div>)}</div>
      </div>}

      {t.by("decide").length > 0 && (
        <LaneBox lane="decide">
          {t.by("decide").map((c) => <CardRow key={c.key} c={c} {...row} />)}
        </LaneBox>
      )}
      {t.by("order").length > 0 && <OrderLane cards={t.by("order")} {...row} />}
      {t.by("consider").length > 0 && (
        <details className="lane lane-consider" id="lane-consider">
          <summary>
            <span className="lane-title">Consider</span>
            <span className="lane-hint">{t.count("consider")} prevention suggestion{t.count("consider") === 1 ? "" : "s"} to discuss when there is time</span>
            <ChevronDown size={18} className="chev" />
          </summary>
          <div className="lane-rows">{t.by("consider").map((c) => <CardRow key={c.key} c={c} {...row} />)}</div>
        </details>
      )}
      <Dismissed s={s} done={done} />
    </section>
  );
}

function DecisionContext({ context, open }: { context: any; open(o: Open): void }) {
  if (!context) return null;
  return <section className="decision-context" aria-label="Latest results and medicines">
    <div className="context-head"><h3>For today's decisions</h3><span className="small muted">Latest recorded · dates shown</span></div>
    <dl className="context-results">{context.results.map((r: any) => <div key={r.code}><dt>{r.label}</dt><dd>{r.value == null ? "Not recorded" : <>{Number(r.value).toLocaleString("en-GB", { maximumFractionDigits: r.code === "potassium" ? 1 : 0 })}<small> {r.unit}</small></>}</dd><span className="small muted">{r.at ? fmtDay(r.at) : "Missing"}</span></div>)}</dl>
    <details className="context-medicines"><summary>Relevant medicines · {context.medicines.length}</summary><div className="context-med-list">{context.medicines.map((m: any) => <button key={m.id} className="context-med" onClick={() => open({ kind: "med-action", medId: m.id })}><b>{m.name}</b><span>{m.dose} {m.frequency ?? ""}{m.status === "held" ? " · ON HOLD" : m.status === "not_taking" ? " · NOT TAKING" : ""}</span></button>)}{context.medicines.length === 0 && <span className="small muted">No relevant medicines recorded.</span>}</div></details>
  </section>;
}

function LaneBox({ lane, children, extra }: { lane: Lane; children: ReactNode; extra?: ReactNode }) {
  const l = LANES.find((x) => x.key === lane)!;
  return (
    <div className={`lane lane-${lane}`} id={"lane-" + lane}>
      <div className="lane-head">
        <span className="lane-title">{l.label}</span>
        <span className="lane-hint">{l.hint}</span>
        {extra}
      </div>
      <div className="lane-rows">{children}</div>
    </div>
  );
}

type RowProps = { dismiss: string | null; setDismiss(id: string | null): void; why: string | null; setWhy(id: string | null): void; open(o: Open): void; done(message?: string): void; patientId: string; s: any; line: string | null; setLine(id: string | null): void };

function Item({ a, compact, ...p }: { a: any; compact?: boolean } & RowProps) {
  // a medicine start or dose change opens inline as an editable line (drug, dose, dates)
  const inline = (a.action?.type === "start-med" && MEDICATION[a.action.code]) || a.action?.type === "titrate";
  return (
    <div className={`item${compact ? " compact" : ""}`}>
      <div className="item-main">
        <span className={`tick sev-${a.severity}`} aria-hidden="true" />
        <div className="item-txt">
          <span className="t">
            {a.title}
            {a.rule_status !== "PUBLISHED" && <em className="review">in review</em>}
          </span>
          {!compact && a.detail && <span className="d">{a.detail}</span>}
        </div>
        <div className="item-acts">
          <button className="why" aria-expanded={p.why === a.id} onClick={() => p.setWhy(p.why === a.id ? null : a.id)}>Why?</button>
          <button className="dismiss" aria-expanded={p.dismiss === a.id} aria-label={`Not needed: ${a.title}`} title="Not needed — dismiss" onClick={() => p.setDismiss(p.dismiss === a.id ? null : a.id)}><X size={16} /></button>
          {inline ? (
            <button className="go" aria-expanded={p.line === a.id} onClick={() => p.setLine(p.line === a.id ? null : a.id)}>{a.action.label}</button>
          ) : (
            <ActionButton a={a} open={p.open} />
          )}
        </div>
      </div>
      {p.why === a.id && <WhyPanel a={a} patientId={p.patientId} done={p.done} />}
      {p.dismiss === a.id && <DismissPanel a={a} patientId={p.patientId} done={p.done} onCancel={() => p.setDismiss(null)} />}
      {inline && p.line === a.id && <SuggestLine a={a} s={p.s} open={p.open} done={p.done} onCancel={() => p.setLine(null)} />}
    </div>
  );
}

function CardRow({ c, ...p }: { c: Card } & RowProps) {
  if (c.items.length === 1)
    return (
      <div className={`tcard sev-${c.severity}`} id={`decision-${c.key}`}>
        {c.lane === "act" && <div className="ic"><SevIcon sev={c.severity} /></div>}
        <div className="tcard-body">
          <Item a={c.lead} {...p} />
          {c.lead.also?.length > 0 && <span className="also">Also: {c.lead.also.map((x: any) => x.title).join(" · ")}</span>}
          {c.note && <span className="note">{c.note}</span>}
        </div>
      </div>
    );
  return (
    <div className={`tcard bundle sev-${c.severity}`} id={`decision-${c.key}`}>
      {c.lane === "act" && <div className="ic"><SevIcon sev={c.severity} /></div>}
      <div className="tcard-body">
        {c.key.startsWith("wiz-") ? (
          <Item a={c.lead} {...p} />
        ) : (
          <>
            <span className="bundle-title">{c.title}</span>
            <div className="bundle-items">
              {c.items.map((a) => <Item key={a.id} a={a} compact {...p} />)}
            </div>
          </>
        )}
        {c.key.startsWith("wiz-") && <span className="also">Same pathway also covers: {c.items.filter((x) => x !== c.lead).map((x) => x.title).join(" · ")}</span>}
        {c.note && <span className="note">{c.note}</span>}
      </div>
    </div>
  );
}

// Everything due in one list: blood tests gathered into one "enter results" step, then each check to book.
function OrderLane({ cards, ...p }: { cards: Card[] } & RowProps) {
  const items = cards.flatMap((c) => c.items);
  const labs = items.filter((a) => a.action?.type === "add-labs");
  const codes = [...new Set(labs.flatMap((a) => a.action.codes ?? []))];
  const rest = items.filter((a) => a.action?.type !== "add-labs");
  return (
    <LaneBox
      lane="order"
      extra={codes.length > 0 && (
        <button className="btn primary small lane-cta" onClick={() => p.open({ kind: "labs", codes })}>
          <FlaskConical size={16} /> Enter {labs.length > 1 ? "all " : ""}results
        </button>
      )}
    >
      {labs.length > 0 && (
        <div className="order-group">
          <span className="order-label">Blood and urine tests</span>
          {labs.map((a) => <Item key={a.id} a={a} compact {...p} />)}
        </div>
      )}
      {rest.length > 0 && (
        <div className="order-group">
          <span className="order-label">Tests, checks and visits</span>
          {rest.map((a) => <Item key={a.id} a={a} compact {...p} />)}
        </div>
      )}
    </LaneBox>
  );
}

// why here · what changed · unfinished · next, in one line each
function Brief({ o }: { o: any }) {
  if (!o) return null;
  const parts: [string, string][] = [
    ["Why here", o.why.text + (o.why.sub ? ` · ${o.why.sub}` : "")],
    ["Changed", o.changed.since ? `${o.changed.count} since ${o.changed.label?.toLowerCase().replace(/^since /, "") ?? "last review"}` : "No earlier review"],
    ["Unfinished", o.unfinished.overdue + o.unfinished.due + (o.unfinished.review ?? 0) === 0 ? "Nothing overdue" : [o.unfinished.overdue && `${o.unfinished.overdue} overdue`, o.unfinished.due && `${o.unfinished.due} due today`, o.unfinished.review && `${o.unfinished.review} to review`].filter(Boolean).join(", ")],
    ["Next", o.next[0] ? `${o.next[0].title} · ${fmtDay(o.next[0].dueDate, { weekday: true })}` : "Nothing booked"],
  ];
  return (
    <dl className="brief">
      {parts.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// A module panel that folds to its header and one-line summary. Panels holding an act-now or decide
// finding start open; the clinician's choice is remembered on this device.
export function Fold({ k, hot, children }: { k: string; hot: boolean; children: ReactNode }) {
  const key = "cf.fold." + k;
  const [isOpen, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key);
      if (v != null) return v === "1";
    } catch {}
    // phones: module panels start folded (Today already lists what needs doing) so the page stays short
    const phone = typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches;
    return hot && !phone;
  });
  const ref = useRef<HTMLDivElement>(null);
  const toggle = () =>
    setOpen((v) => {
      try { localStorage.setItem(key, v ? "0" : "1"); } catch {}
      return !v;
    });
  useEffect(() => {
    const h = ref.current?.querySelector<HTMLElement>(".card-head h2");
    if (!h) return;
    h.tabIndex = 0;
    h.setAttribute("role", "button");
    h.setAttribute("aria-expanded", String(isOpen));
  });
  return (
    <div
      ref={ref}
      className={`fold${isOpen ? " open" : ""}`}
      onClick={(e) => { if ((e.target as HTMLElement).closest(".card-head h2")) toggle(); }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).matches(".card-head h2")) { e.preventDefault(); toggle(); } }}
    >
      {children}
    </div>
  );
}

// "Not needed": the clinician closes an alert or decision with a one-tap reason. It stays closed until the data
// behind it change (the engine then raises a new one) and can be shown again from "Dismissed".
const DISMISS_REASONS: { value: string; label: string; outcome: "declined" | "deferred" }[] = [
  { value: "not-relevant", label: "Not relevant for this patient", outcome: "declined" },
  { value: "done", label: "Already done or managed elsewhere", outcome: "declined" },
  { value: "patient", label: "Patient declined", outcome: "declined" },
  { value: "later", label: "Not now — review later", outcome: "deferred" },
];
function DismissPanel({ a, patientId, done, onCancel }: { a: any; patientId: string; done(message?: string): void; onCancel(): void }) {
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const r = DISMISS_REASONS.find((x) => x.value === pick);
  async function save() {
    if (!r || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${patientId}/recommendations/${a.id}/decline`, { body: { outcome: r.outcome, reason: [r.label, note.trim()].filter(Boolean).join(": "), also: (a.also ?? []).map((x: any) => x.id) } });
      done(r.outcome === "deferred" ? "Set aside for later · shown under Dismissed" : "Dismissed · shown again if the data change");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="dismiss-panel">
      <b>Not needed?</b>
      <div className="choices" role="radiogroup" aria-label="Why it is not needed">
        {DISMISS_REASONS.map((x) => (
          <button key={x.value} type="button" className="choice small" role="radio" aria-checked={pick === x.value} aria-pressed={pick === x.value} onClick={() => setPick(x.value)}>{x.label}</button>
        ))}
      </div>
      <input className="input" placeholder="Note (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn secondary small" disabled={!r || busy} onClick={save}>{busy ? "Saving…" : "Dismiss"}</button>
        <button className="btn ghost small" onClick={onCancel}>Keep it</button>
        {error && <span className="small" style={{ color: "var(--red-ink)", fontWeight: 700 }}>{error}</span>}
      </div>
    </div>
  );
}

function Dismissed({ s, done }: { s: any; done(message?: string): void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const list: any[] = s.dismissed ?? [];
  if (!list.length) return null;
  async function restore(id: string) {
    setBusy(id);
    try {
      await api(`/patients/${s.header.id}/recommendations/${id}/restore`, { body: {} });
      done("Shown again");
    } catch (e) {
      done((e as Error).message);
    }
    setBusy(null);
  }
  return (
    <details className="lane dismissed-list">
      <summary>
        <span className="lane-title">Dismissed</span>
        <span className="lane-hint">{list.length} in the last 90 days · tap to show one again</span>
        <ChevronDown size={18} className="chev" />
      </summary>
      <div className="lane-rows">
        {list.map((d) => (
          <div className="dismissed-row" key={d.id}>
            <span className={`tick sev-${d.severity}`} aria-hidden="true" />
            <div className="grow">
              <b>{d.title}</b>
              <span className="small muted">{d.outcome === "deferred" ? "Later" : "Not needed"} · {d.reason}{d.closed_at ? ` · ${fmtDay(d.closed_at)}` : ""}</span>
            </div>
            <button className="btn ghost small" disabled={busy === d.id} onClick={() => restore(d.id)}><RotateCcw size={14} /> Show again</button>
          </div>
        ))}
      </div>
    </details>
  );
}

// Problems at a glance: each active problem with where it stands against its guideline goal and the first open
// decision for it — so the overview answers "what do I do for this patient today", problem by problem.
const SEV_RANK: Record<string, number> = { red: 0, orange: 1, yellow: 2, blue: 3 };
const PROBLEM_OF = (ruleId: string): string | null => {
  if (["hf.hyperkalaemia-review", "hf.worsening-renal-function", "safety.low-potassium", "safety.hyponatraemia"].includes(ruleId) || ruleId.startsWith("cardiorenal.")) return "kidney";
  if (ruleId.startsWith("hf.")) return "hf";
  if (ruleId.startsWith("htn.")) return "bp";
  if (ruleId.startsWith("lipids.")) return "lipids";
  if (ruleId.startsWith("dm.") || ruleId.startsWith("metabolic.")) return "diabetes";
  if (ruleId.startsWith("af.") || ruleId.startsWith("rhythm.")) return "af";
  if (ruleId.startsWith("cad.") || ruleId.startsWith("acs.")) return "cad";
  if (ruleId.startsWith("valve.") || ruleId.startsWith("structural.")) return "valve";
  return null;
};
type Stat = { label: string; value: string; tone?: "ok" | "warn" | "bad" };
function ProblemBoard({ s, open }: { s: any; open(o: Open): void }) {
  const t = s.targets;
  if (!t) return null;
  const n = (v: number | null | undefined, d = 0) => (v == null ? "—" : formatNumber(v, d));
  const rows: { key: string; label: string; stats: Stat[]; goal?: string }[] = [];
  if (t.hf) {
    const on = t.hf.pillars.filter((p: any) => p.state === "on" || p.state === "target").length;
    rows.push({
      key: "hf", label: `Heart failure · ${t.hf.phenotype}${t.hf.lvef != null ? ` · LVEF ${n(t.hf.lvef)}%` : ""}`,
      stats: t.hf.pillars.map((p: any) => ({ label: p.label.split(" (")[0].replace("ARNI / ACE inhibitor / ARB", "ARNI/ACEi/ARB"), value: p.state === "target" ? "At target" : p.state === "on" ? `${p.percentOfTarget ?? "?"}% of target` : p.state === "held" ? "Held" : p.state === "blocked" ? "Not now" : "Not started", tone: p.state === "target" ? "ok" : p.state === "on" ? undefined : "warn" })),
      goal: `${on} of ${t.hf.pillars.length} foundational medicines · goal: all at target or maximum tolerated dose`,
    });
  }
  const k = t.kidney;
  if (k && (k.egfr != null || k.k != null)) {
    const stats: Stat[] = [];
    if (k.egfr != null) stats.push({ label: "eGFR", value: `${n(k.egfr)}${k.egfrAt ? ` · ${fmtDay(k.egfrAt)}` : ""}`, tone: k.egfr < 30 ? "bad" : k.egfr < 60 ? "warn" : "ok" });
    if (k.creatinine) stats.push({ label: "Creatinine vs baseline", value: `${n(k.creatinine.baseline)} → ${n(k.creatinine.current)} (${k.creatinine.rise >= 0 ? "+" : ""}${k.creatinine.rise}%)`, tone: k.creatinine.review ? "bad" : undefined });
    if (k.k != null) stats.push({ label: "Potassium", value: `${n(k.k, 1)}${k.kAt ? ` · ${fmtDay(k.kAt)}` : ""}`, tone: k.k > 5.5 || k.k < 3.5 ? "bad" : k.k > 5.0 ? "warn" : "ok" });
    if (k.uacr != null) stats.push({ label: "UACR", value: `${n(k.uacr, 1)} mg/mmol`, tone: k.uacr >= 3 ? "warn" : "ok" });
    rows.push({ key: "kidney", label: "Kidney & potassium", stats });
  }
  if (t.bp) rows.push({ key: "bp", label: "Blood pressure", stats: [{ label: "Latest", value: t.bp.sbp != null ? `${n(t.bp.sbp)}${t.bp.dbp != null ? "/" + n(t.bp.dbp) : ""} mmHg${t.bp.at ? ` · ${fmtDay(t.bp.at)}` : ""}` : "Not measured", tone: t.bp.met === true ? "ok" : t.bp.met === false ? "warn" : undefined }], goal: t.bp.target === "Individualized" ? "Individualized target" : `Goal ${t.bp.target}/${t.bp.diastolicTarget} if tolerated (ESC 2024)` });
  if (t.ldl) rows.push({ key: "lipids", label: "Lipids", stats: [{ label: "LDL-C", value: t.ldl.value != null ? `${n(t.ldl.value, 2)} mmol/L${t.ldl.at ? ` · ${fmtDay(t.ldl.at)}` : ""}` : "Not measured", tone: t.ldl.met === true ? "ok" : t.ldl.met === false ? "warn" : undefined }, { label: "Therapy", value: t.ldl.therapy.length ? t.ldl.therapy.join(" + ") : "None" }], goal: `Goal <${t.ldl.goal} mmol/L · ${t.ldl.category} risk` });
  if (t.diabetes) rows.push({ key: "diabetes", label: "Diabetes", stats: [{ label: "HbA1c", value: t.diabetes.hba1c != null ? `${n(t.diabetes.hba1c, 1)}%${t.diabetes.at ? ` · ${fmtDay(t.diabetes.at)}` : ""}` : "Not measured", tone: t.diabetes.met === true ? "ok" : t.diabetes.met === false ? "warn" : undefined }, { label: "Therapy", value: t.diabetes.therapy.length ? t.diabetes.therapy.join(" · ") : "None" }], goal: `Target ${t.diabetes.target}` });
  if (t.af) rows.push({ key: "af", label: "Atrial fibrillation", stats: [{ label: "CHA₂DS₂-VA", value: String(t.af.score) }, { label: "Anticoagulant", value: t.af.oac.length ? t.af.oac.join(" · ") : "None", tone: t.af.oac.length ? "ok" : t.af.score >= 2 ? "bad" : undefined }, ...(t.af.inr != null ? [{ label: "INR", value: n(t.af.inr, 1) }] : [])] });
  const recs = (key: string) => (s.attention as any[]).filter((a) => PROBLEM_OF(a.rule_id) === key).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  for (const key of ["cad", "valve"]) if (recs(key).length) rows.push({ key, label: key === "cad" ? "Coronary disease" : "Valve / structural", stats: [] });
  if (!rows.length) return null;
  // the most urgent problem first; problems without an open decision last
  const rank = (key: string) => { const r = recs(key)[0]; return r ? SEV_RANK[r.severity] : 9; };
  rows.sort((x, y) => rank(x.key) - rank(y.key));
  return (
    <section className="problems" aria-labelledby="prob-h">
      <div className="context-head"><h3 id="prob-h">Problems at a glance</h3><span className="small muted">Where each stands · the next decision</span></div>
      {rows.map((r) => {
        const open1 = recs(r.key);
        const top = open1[0];
        return (
          <div className={`problem ${top ? `p-${top.severity}` : "ok"}`} key={r.key}>
            <div className="problem-head">
              <b>{r.label}</b>
              {!top && <span className="problem-ok"><CheckCircle2 size={15} /> No open decision</span>}
            </div>
            {r.stats.length > 0 && (
              <div className="problem-stats">
                {r.stats.map((x, i) => <span key={i} className={`pstat ${x.tone ?? ""}`}><small>{x.label}</small>{x.value}</span>)}
              </div>
            )}
            {r.goal && <span className="problem-goal">{r.goal}</span>}
            {top && (
              <div className="problem-next">
                <span className={`tick sev-${top.severity}`} aria-hidden="true" />
                <span className="grow">{top.title}{open1.length > 1 ? <em> · +{open1.length - 1} more below</em> : null}</span>
                <ActionButton a={top} open={open} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
