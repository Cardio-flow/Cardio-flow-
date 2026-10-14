// The pathway behind an alert, shown as its decision (14 Oct 2026, Ahmed: "the pathways as the hidden brain:
// collect the data needed and only give us what is necessary to fill before the decision"). The server runs
// the pathway with everything the record and the guideline can answer; the card shows the plan, the reasons,
// the one or two answers only the clinician can give and the results still needed — and records the plan with
// one confirmation. The full pathway stays one tap away for changes.
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, FlaskConical } from "lucide-react";
import { api } from "../api";
import { fmtDay } from "../../shared/clinical";
import type { Open } from "./Patient";

type Preview = {
  wizard: string; title: string; note: string; source: string | null;
  answers: Record<string, unknown>;
  reasons: { question: string; answer: string; why: string; source: "record" | "guideline" | "you" }[];
  needed: { id: string; label: string; help: string | null; type: string; options: { value: string; label: string }[] }[];
  needData: { code: string; label: string; why: string; last: { value: number; at: string } | null }[];
  plan: { kind: string; label: string; dueDate?: string }[];
  medReview: { title: string; source: string; tone: "warn" | "keep" }[];
  ready: boolean;
};

export function DecisionPanel({ a, patientId, open, done }: { a: any; patientId: string; open(o: Open): void; done(m?: string, r?: any): void }) {
  const wizard = a.action?.wizard as string;
  const [given, setGiven] = useState<Record<string, unknown>>({});
  const [p, setP] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    api<Preview>(`/patients/${patientId}/decisions/${wizard}/preview`, { body: { answers: given } })
      .then((r) => n === seq.current && (setP(r), setError("")))
      .catch((e) => n === seq.current && setError((e as Error).message));
  }, [patientId, wizard, JSON.stringify(given)]);
  // one stable element (a drawer opened over the card marks it inert; it must stay the same node)
  if (!p) return <div className={`decision${error ? "" : " loading"}`} aria-busy={!error || undefined}>{error && <span className="small muted">{error}</span>}</div>;
  const set = (id: string, v: unknown) => setGiven((g) => ({ ...g, [id]: v }));
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const r = await api(`/patients/${patientId}/wizards/${wizard}/complete`, { body: { answers: p!.answers, recommendationId: a.id } });
      done(`${p!.title} recorded · ${p!.plan.filter((x) => x.kind !== "note").length} action${p!.plan.length === 1 ? "" : "s"} added`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const steps = p.plan.filter((x) => x.kind !== "note"), notes = p.plan.filter((x) => x.kind === "note");
  return (
    <div className="decision" aria-label={`Decision: ${p.title}`}>
      <div className="decision-head">
        <b>{p.ready ? "Guideline plan" : "To decide"}</b>
        <span>{p.ready ? "filled in from the record and the guideline" : `${p.needed.length + p.needData.length} to complete before the plan`}</span>
      </div>
      {p.needData.length > 0 && (
        <div className="decision-need">
          {p.needData.map((n) => (
            <div key={n.code} className="decision-q">
              <span className="decision-ql">{n.label}{n.last ? <em> · last {n.last.value} on {fmtDay(n.last.at, { year: true })} (out of date)</em> : <em> · not recorded</em>}<small>{n.why}</small></span>
            </div>
          ))}
          <button className="btn secondary small" onClick={() => open({ kind: "labs", codes: p.needData.map((n) => n.code) })}><FlaskConical size={14} /> Record {p.needData.map((n) => n.label.toLowerCase()).join(" and ")}</button>
        </div>
      )}
      {p.needed.map((q) => (
        <div key={q.id} className="decision-q">
          <span className="decision-ql">{q.label}{q.help && <small>{q.help}</small>}</span>
          {q.type === "date" ? (
            <input className="input" type="date" min={new Date().toISOString().slice(0, 10)} value={String(given[q.id] ?? "")} onChange={(e) => set(q.id, e.target.value)} aria-label={`Decision: ${q.label}`} />
          ) : q.type === "multi" ? (
            <div className="decision-checks" role="group" aria-label={`Decision: ${q.label}`}>
              {q.options.map((o) => {
                const cur = ((given[q.id] as string[] | undefined) ?? []);
                const on = cur.includes(o.value);
                return <label key={o.value} className={`decision-check${on ? " on" : ""}`}><input type="checkbox" aria-label={`Decision: ${o.label}`} checked={on} onChange={() => set(q.id, on ? cur.filter((x) => x !== o.value) : [...cur, o.value])} /> {o.label}</label>;
              })}
              {q.options.length > 2 && <button className="btn ghost small" onClick={() => set(q.id, q.options.map((o) => o.value))}>All confirmed</button>}
            </div>
          ) : (
            <div className="decision-opts" role="radiogroup" aria-label={`Decision: ${q.label}`}>
              {q.options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={given[q.id] === o.value} onClick={() => set(q.id, o.value)}>{o.label}</button>)}
            </div>
          )}
        </div>
      ))}
      {p.reasons.length > 0 && (
        <ul className="decision-reasons">
          {p.reasons.map((r, i) => (
            <li key={i}><span className={`src ${r.source}`}>{r.source === "record" ? "Record" : r.source === "you" ? "You" : "Guideline"}</span> <b>{r.question.replace(/[?:]$/, "")}:</b> {r.answer}{why && r.why && <small>{r.why}</small>}</li>
          ))}
        </ul>
      )}
      {p.medReview.length > 0 && (
        <ul className="decision-meds">{p.medReview.map((m, i) => <li key={i} className={m.tone}>{m.title}{why && <small>{m.source}</small>}</li>)}</ul>
      )}
      {steps.length > 0 && (
        <ol className="decision-plan">{steps.map((x, i) => <li key={i}><CheckCircle2 size={14} /> {x.label}</li>)}</ol>
      )}
      {notes.map((x, i) => <p key={i} className="decision-note">{x.label}</p>)}
      {error && <div className="error-box">{error}</div>}
      <div className="decision-acts">
        <button className="btn ghost small" onClick={() => setWhy(!why)} aria-expanded={why}>{why ? "Hide reasons" : "Reasons & sources"} <ChevronDown size={14} style={{ transform: why ? "rotate(180deg)" : undefined }} /></button>
        <button className="btn primary small" disabled={!p.ready || busy} onClick={apply}>{busy ? "Recording…" : "Apply plan"}</button>
      </div>
    </div>
  );
}
