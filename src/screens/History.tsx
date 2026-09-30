import { ClipboardList, IdCard, Pencil } from "lucide-react";
import { useData } from "../api";
import { fmtDay } from "../../shared/clinical";
import type { Open } from "./Patient";

const STATUS_LABEL: Record<string, string> = {
  present: "Yes", absent: "No", unknown: "Unknown", "not-assessed": "Not assessed", na: "Not applicable", "not-recorded": "Not recorded",
};

export function HistoryTab({ id, version, open }: { id: string; version: number; open(o: Open): void }) {
  const { data } = useData<any>(`/patients/${id}/history`, [version]);
  if (!data) return <main className="page" aria-busy="true" />;
  const risk = data.items.filter((i: any) => i.section === "risk");
  const cardiac = data.items.filter((i: any) => i.section === "cardiac");
  const idn = data.identity;
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 22 }}>History</h1>
          <p>Risk factors and past cardiac history, each with its date and source. A blank is shown as not recorded, never as no.</p>
        </div>
        <button className="btn primary" onClick={() => open({ kind: "history" })}>
          <ClipboardList size={18} /> Update history
        </button>
      </div>
      {data.missing.length > 0 && (
        <div className="hx-missing" role="note">
          <b>Not recorded yet:</b> {data.missing.join(" · ")}
          <button className="btn ghost small" onClick={() => open({ kind: "history" })}>Record now</button>
        </div>
      )}
      <div className="grid-main">
        <div className="stack">
          <section className="card pad">
            <div className="card-head">
              <h2>Risk factors</h2>
              <button className="btn ghost small" onClick={() => open({ kind: "history", focus: "risk" })}><Pencil size={14} /> Edit</button>
            </div>
            <HxList items={risk} bmi={data.bmi} />
          </section>
          <section className="card pad">
            <div className="card-head">
              <h2>Past cardiac history</h2>
              <button className="btn ghost small" onClick={() => open({ kind: "history", focus: "cardiac" })}><Pencil size={14} /> Edit</button>
            </div>
            <HxList items={cardiac} />
          </section>
        </div>
        <div className="stack">
          <section className="card pad">
            <div className="card-head">
              <h2>Registration</h2>
              <button className="btn ghost small" onClick={() => open({ kind: "identity", identity: idn })}><IdCard size={14} /> Edit</button>
            </div>
            <dl className="kv">
              <dt>Civil ID</dt><dd>{idn.civilId ?? <span className="muted">Not recorded</span>}</dd>
              <dt>Nationality</dt><dd>{idn.nationality ?? <span className="muted">Not recorded</span>}</dd>
              <dt>Mobile</dt><dd>{idn.mobile ?? <span className="muted">Not recorded</span>}</dd>
              <dt>Allergies</dt><dd>{idn.allergies}</dd>
            </dl>
            <div className="row" style={{ justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-2)" }}>
              <span className="small" style={{ fontWeight: 700, color: "var(--ink-3)" }}>Vital and follow-up status</span>
              <button className="btn ghost small" onClick={() => open({ kind: "status" })}>Record status</button>
            </div>
          </section>
          <section className="card pad">
            <div className="card-head">
              <h2>Other comorbidities</h2>
              <button className="btn ghost small" onClick={() => open({ kind: "dx" })}>+ Add</button>
            </div>
            {data.comorbidities.length === 0 ? (
              <div className="empty">None on the diagnosis list.</div>
            ) : (
              <div className="row wrap" style={{ gap: 8 }}>
                {data.comorbidities.map((c: any) => (
                  <span key={c.id} className="chip dx">
                    {c.label}
                    {c.onset ? ` · ${fmtDay(c.onset, { year: true })}` : c.onsetYear ? ` · ${c.onsetYear}` : ""}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

// the line under the label only when it adds something (not "Hypertension · Hypertension" or "No · No")
const showDetail = (i: any) =>
  i.status === "present"
    ? !(i.conditions.length === 1 && i.conditions[0].label === i.label && !i.conditions[0].onset && !i.conditions[0].onsetYear)
    : i.source === "history" && i.text !== STATUS_LABEL[i.status];

function HxList({ items, bmi }: { items: any[]; bmi?: any }) {
  return (
    <div className="hx-list">
      {items.map((i) => (
        <div key={i.key} className="hx-item">
          <span className={`hx-tag st-${i.status}${i.major && i.status === "present" ? " major" : ""}`}>{STATUS_LABEL[i.status]}</span>
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <b>{i.label}</b>
            {showDetail(i) ? (
              <span className="small">
                {i.conditions.length
                  ? i.conditions.map((c: any, n: number) => (
                      <span key={c.id}>
                        {n > 0 && " · "}
                        {c.label}
                        {c.onset ? ` (${fmtDay(c.onset, { year: true })})` : c.onsetYear ? ` (${c.onsetYear})` : ""}
                      </span>
                    ))
                  : i.text}
              </span>
            ) : null}
            {i.key === "obesity" && bmi && i.status !== "present" && <span className="small muted">BMI {bmi.value.toFixed(1)} · {fmtDay(bmi.at, { year: true })}</span>}
            {i.conflict && <span className="small hx-conflict">{i.conflict}</span>}
          </div>
          <span className="small muted when">
            {i.at ? fmtDay(i.at, { year: true }) : i.source === "diagnosis" ? "Diagnosis list" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
