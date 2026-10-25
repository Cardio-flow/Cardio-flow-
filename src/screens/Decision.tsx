import { useEffect, useRef, useState } from "react";
import { Clock3, ChevronDown, FlaskConical, Pencil } from "lucide-react";
import { api } from "../api";
import { DateInput } from "../ui";
import { validDate } from "../../shared/dates";
import { fmtDay } from "../../shared/clinical";
import type { Open } from "./Patient";

type Question = {
  id: string;
  label: string;
  help: string | null;
  type: string;
  exclusive?: string[];
  options: { value: string; label: string }[];
  // a safety screen answered on an earlier day: offered, never filled
  last?: { value: string | string[]; label: string; at: string; title: string } | null;
};
type Preview = {
  wizard: string;
  title: string;
  source: string | null;
  today: string;
  evidenceKey: string;
  answers: Record<string, unknown>;
  questions: Question[];
  needed: Question[];
  assumed?: string[];
  blockers: string[];
  reasons: { question: string; answer: string; why: string; source: string }[];
  needData: {
    code: string;
    label: string;
    why: string;
    last: { value: number; at: string } | null;
  }[];
  plan: { kind: string; decision?: boolean; routine?: boolean; label: string; title?: string; dueDate?: string }[];
  medReview: { title: string; source: string; tone: string }[];
  ready: boolean;
  joined: { next: string; title: string; why: string } | null;
};
export function DecisionPanel({
  a,
  patientId,
  open,
  done,
}: {
  a: any;
  patientId: string;
  open(o: Open): void;
  done(m?: string, r?: any): void;
}) {
  const wizard = a.action.wizard as string;
  const [given, setGiven] = useState<Record<string, unknown>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const [p, setP] = useState<Preview | null>(null),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [why, setWhy] = useState(false),
    [editing, setEditing] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  const [asked, setAsked] = useState<string[]>([]),
    [loaded, setLoaded] = useState("");
  const seq = useRef(0);
  const key = JSON.stringify({ given, dates });
  const invalidDate = Object.values(dates).some((d) => !validDate(d));
  useEffect(() => {
    if (invalidDate) return;
    const n = ++seq.current;
    api<Preview>(`/patients/${patientId}/decisions/${wizard}/preview`, {
      body: { answers: given, dueDates: dates },
    })
      .then((r) => {
        if (n !== seq.current) return;
        setP(r);
        setLoaded(key);
        setError("");
        setAsked((old) => [...new Set([...old, ...r.needed.map((q) => q.id)])]);
      })
      .catch((e) => {
        if (n === seq.current) setError((e as Error).message);
      });
    return () => {
      seq.current++;
    };
  }, [patientId, wizard, key, invalidDate]);
  const set = (id: string, v: unknown) => setGiven((g) => ({ ...g, [id]: v }));
  async function apply() {
    if (!p || loaded !== key || invalidDate) return;
    setBusy(true);
    setError("");
    try {
      const r = await api(`/patients/${patientId}/wizards/${wizard}/complete`, {
        body: {
          answers: p.answers,
          dueDates: dates,
          evidenceKey: p.evidenceKey,
          recommendationId: a.id,
        },
      });
      done(`${p.title} recorded`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  if (!p)
    return (
      <div className="decision" aria-busy={!error || undefined}>
        {error && (
          <div role="alert" className="error-box">
            {error}
          </div>
        )}
      </div>
    );
  const questions = p.questions.filter(
    (q) =>
      editing || asked.includes(q.id) || p.needed.some((n) => n.id === q.id) || (editing && (p.assumed ?? []).includes(q.id)),
  );
  return (
    <div className="decision" aria-label={`Decision: ${p.title}`}>
      <div className="decision-head">
        <b>{p.ready ? "Proposed plan" : "To decide"}</b>
        <button
          className="btn ghost small"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          <Pencil size={13} />
          {editing ? "Fewer fields" : "Edit answers"}
        </button>
      </div>
      {p.plan.filter((x) => (x.kind !== "note" || x.decision) && (routineOpen || !x.routine)).length > 0 && (
        <ol className="decision-plan draft">
          {p.plan
            .filter((x) => (x.kind !== "note" || x.decision) && (routineOpen || !x.routine))
            .map((x, i) => (
              <li key={x.title ?? i}>
                <Clock3 size={14} />
                <div>
                  <b>{x.title ?? x.label}</b>
                  {x.kind === "plan" && x.title && (
                    <DateInput
                      value={dates[x.title] ?? x.dueDate ?? ""}
                      min={p.today}
                      aria-label={`Date: ${x.title}`}
                      onChange={(e) =>
                        setDates((d) => ({ ...d, [x.title!]: e.target.value }))
                      }
                    />
                  )}
                </div>
              </li>
            ))}
        </ol>
      )}
      {p.plan.some(x => x.routine) && <button type="button" className="btn ghost small" aria-expanded={routineOpen} onClick={() => setRoutineOpen(!routineOpen)}>Also due · routine checks ({p.plan.filter(x => x.routine).length})</button>}
      {p.blockers.map((t) => (
        <div key={t} role="alert" className="error-box">
          {t}
          {wizard === "renal-function" && (
            <button
              className="btn secondary small"
              onClick={() => open({ kind: "wizard", wizard: "hyperkalaemia" })}
            >
              Manage potassium first
            </button>
          )}
        </div>
      ))}
      {p.needData.length > 0 && (
        <div className="decision-need">
          {p.needData.map((n) => (
            <div key={n.code} className="small">
              <b>{n.label}</b> · {n.last ? "update result" : "needed"}
              <small>{n.why}</small>
            </div>
          ))}
          <button
            className="btn secondary small"
            onClick={() =>
              open({ kind: "labs", codes: p.needData.map((n) => n.code) })
            }
          >
            <FlaskConical size={14} />
            Record missing data
          </button>
        </div>
      )}
      {questions.map((q) => (
        <div key={q.id} className="decision-q">
          <span className="decision-ql">
            {q.label}
            {q.help && <small>{q.help}</small>}
          </span>
          {(() => {
            const last = p.needed.find((n) => n.id === q.id)?.last;
            return last && given[q.id] == null ? (
              <button type="button" className="btn ghost small decision-same" onClick={() => set(q.id, last.value)} title={`Answered in ${last.title}`}>
                Same as {fmtDay(last.at)}: {last.label}
              </button>
            ) : null;
          })()}
          {q.type === "date" ? (
            <DateInput
              value={String(given[q.id] ?? p.answers[q.id] ?? "")}
              min={p.today}
              onChange={(e) => set(q.id, e.target.value)}
              aria-label={`Decision: ${q.label}`}
            />
          ) : q.type === "multi" ? (
            <div
              className="decision-checks"
              role="group"
              aria-label={`Decision: ${q.label}`}
            >
              {q.options.map((o) => {
                const cur =
                    ((given[q.id] ?? p.answers[q.id]) as
                      string[] | undefined) ?? [],
                  on = cur.includes(o.value);
                return (
                  <label
                    key={o.value}
                    className={`decision-check${on ? " on" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      aria-label={`Decision: ${o.label}`}
                      onChange={() =>
                        set(
                          q.id,
                          on
                            ? cur.filter((x) => x !== o.value)
                            : o.value === "none" ? ["none"] : [...cur.filter(x => x !== "none" && !(q.exclusive?.includes(o.value) && q.exclusive.includes(x))), o.value],
                        )
                      }
                    />
                    {o.label}
                  </label>
                );
              })}
            </div>
          ) : (
            <div
              className="decision-opts"
              role="radiogroup"
              aria-label={`Decision: ${q.label}`}
            >
              {q.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={
                    String(given[q.id] ?? p.answers[q.id] ?? "") === o.value
                  }
                  onClick={() => set(q.id, o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <button
        className="btn ghost small"
        onClick={() => setWhy(!why)}
        aria-expanded={why}
      >
        Reasons & sources <ChevronDown size={14} />
      </button>
      {why && (
        <div className="decision-detail">
          <ul className="decision-reasons">
            {p.reasons.map((r, i) => (
              <li key={i}>
                <span className="src">{r.source}</span> <b>{r.question}:</b>{" "}
                {r.answer}
                <small>{r.why}</small>
              </li>
            ))}
          </ul>
          <ul className="decision-meds">
            {p.medReview.map((m, i) => (
              <li key={i} className={m.tone}>
                {m.title}
                <small>{m.source}</small>
              </li>
            ))}
          </ul>
          {p.plan
            .filter((x) => x.kind === "note" && !x.decision)
            .map((x, i) => (
              <p key={i} className="decision-note">
                {x.label}
              </p>
            ))}
          <span className="small muted">{p.source}</span>
        </div>
      )}
      {p.joined && (
        <div className="decision-joined">
          Continues into {p.joined.title}. Confirm both parts in the pathway.
        </div>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
          <button
            className="btn ghost small"
            onClick={() =>
              open({ kind: "wizard", wizard, recommendationId: a.id })
            }
          >
            Reopen current review
          </button>
        </div>
      )}
      {invalidDate && (
        <div role="alert" className="error-box">
          Enter a complete valid date
        </div>
      )}
      <div className="decision-acts">
        <button
          className="btn secondary small"
          onClick={() =>
            open({ kind: "wizard", wizard, recommendationId: a.id })
          }
        >
          Full pathway
        </button>
        {!p.joined && (
          <button
            className="btn primary small"
            disabled={!p.ready || busy || loaded !== key || invalidDate}
            onClick={apply}
          >
            {busy ? "Recording…" : loaded !== key ? "Updating…" : "Apply plan"}
          </button>
        )}
      </div>
    </div>
  );
}
