// The overview's first screen (workflow redesign, slice 1): one flow bar, then the open findings in four
// lanes — act now, decide, order & book, consider — with merged cards (shared/triage.ts).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, FlaskConical } from "lucide-react";
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
  const draft = s.attention.some((a: any) => a.rule_status !== "PUBLISHED");
  const row = { why, setWhy, open, done, patientId: s.header.id, s, line, setLine };
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
      {draft && <p className="tb-draft">Items marked “in review” come from rules still in clinical review. They run on this sandbox only.</p>}
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

type RowProps = { why: string | null; setWhy(id: string | null): void; open(o: Open): void; done(message?: string): void; patientId: string; s: any; line: string | null; setLine(id: string | null): void };

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
          {inline ? (
            <button className="go" aria-expanded={p.line === a.id} onClick={() => p.setLine(p.line === a.id ? null : a.id)}>{a.action.label}</button>
          ) : (
            <ActionButton a={a} open={p.open} />
          )}
        </div>
      </div>
      {p.why === a.id && <WhyPanel a={a} patientId={p.patientId} done={p.done} />}
      {inline && p.line === a.id && <SuggestLine a={a} s={p.s} open={p.open} done={p.done} onCancel={() => p.setLine(null)} />}
    </div>
  );
}

function CardRow({ c, ...p }: { c: Card } & RowProps) {
  if (c.items.length === 1)
    return (
      <div className={`tcard sev-${c.severity}`}>
        {c.lane === "act" && <div className="ic"><SevIcon sev={c.severity} /></div>}
        <div className="tcard-body">
          <Item a={c.lead} {...p} />
          {c.lead.also?.length > 0 && <span className="also">Also: {c.lead.also.map((x: any) => x.title).join(" · ")}</span>}
          {c.note && <span className="note">{c.note}</span>}
        </div>
      </div>
    );
  return (
    <div className={`tcard bundle sev-${c.severity}`}>
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
