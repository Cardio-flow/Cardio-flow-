// History tab (rebuilt 19 Oct 2026, Ahmed: "the whole section of history and risk factors need to be built
// properly"). What is present comes first with its detail and year; the cardiac past is one dated timeline
// (MI, PCI/POBA, CABG, valve interventions, LAA closure, devices, ablations); what was answered No and what
// is not recorded yet are one line each, never a long list of blanks.
import { ClipboardList, IdCard, Pencil, Plus } from "lucide-react";
import { useData } from "../api";
import { fmtDay } from "../../shared/clinical";
import type { Open } from "./Patient";

const year = (c: any) => (c.onsetYear ? String(c.onsetYear) : c.onset ? fmtDay(c.onset, { year: true }).replace(/^\d+ /, "") : null);

export function HistoryTab({ id, version, open }: { id: string; version: number; open(o: Open): void }) {
  const { data } = useData<any>(`/patients/${id}/history`, [version]);
  if (!data) return <main className="page" aria-busy="true" />;
  const risk = data.items.filter((i: any) => i.section === "risk");
  const cardiac = data.items.filter((i: any) => i.section === "cardiac");
  const idn = data.identity;
  const timeline = (data.timeline ?? []) as any[];
  // the timeline carries coronary events, valve interventions and devices with their own dates
  const inTimeline = new Set(["coronary", ...(timeline.some((e) => e.kind === "valve") ? ["valve"] : []), ...(timeline.some((e) => e.kind === "device") ? ["device"] : [])]);
  const cardiacPresent = cardiac.filter((i: any) => i.status === "present" && (i.key === "coronary" || !inTimeline.has(i.key)));
  return (
    <main className="page hx-page">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 22 }}>History</h1>
          <p>Past cardiac events by year, risk factors and other conditions. A blank is shown as not recorded, never as no.</p>
        </div>
        <div className="row wrap"><button className="btn secondary small" onClick={()=>open({kind:"pregnancy-context"})}>Pregnancy context</button>
        <button className="btn primary" onClick={() => open({ kind: "history" })}>
          <ClipboardList size={18} /> Update history
        </button></div>
      </div>
      <div className="grid-main">
        <div className="stack">
          <section className="card pad" aria-label="Cardiac history">
            <div className="card-head">
              <h2>Cardiac history</h2>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn ghost small" onClick={() => open({ kind: "history", focus: "past" })}><Plus size={14} /> MI or procedure</button>
                <button className="btn ghost small" onClick={() => open({ kind: "history", focus: "cardiac" })}><Pencil size={14} /> Edit</button>
              </span>
            </div>
            {cardiacPresent.length > 0 && (
              <div className="hx-present">
                {cardiacPresent.map((i: any) => (
                  <div key={i.key} className="hx-pres">
                    <b>{i.key === "coronary" && data.ihd ? "Ischaemic heart disease" : i.label}</b>
                    {!inTimeline.has(i.key) && (
                      <span className="small">
                        {i.conditions.map((c: any) => `${c.label}${year(c) ? ` (${year(c)})` : ""}`).join(" · ")}
                      </span>
                    )}
                    {i.key === "coronary" && data.ihd && <span className="small">{data.ihd.label.replace(/^IHD · ?/, "") || "No events recorded"}</span>}
                  </div>
                ))}
              </div>
            )}
            {timeline.length > 0 ? (
              <ol className="hx-timeline" aria-label="Past cardiac events">
                {timeline.map((e, n) => (
                  <li key={`${e.ref.id}-${n}`} className={`k-${e.kind}`}>
                    <time>{e.when ?? "Year?"}</time>
                    <div>
                      <b>{e.title}</b>
                      {e.detail && <span className="small">{e.detail}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="empty">No past MI, intervention or device recorded. <button className="btn ghost small" onClick={() => open({ kind: "history", focus: "past" })}>Add</button></div>
            )}
            <StatusLines items={cardiac} onRecord={() => open({ kind: "history", focus: "cardiac" })} />
          </section>
          <section className="card pad" aria-label="Risk factors">
            <div className="card-head">
              <h2>Risk factors</h2>
              <button className="btn ghost small" onClick={() => open({ kind: "history", focus: "risk" })}><Pencil size={14} /> Edit</button>
            </div>
            <div className="hx-present">
              {risk.filter((i: any) => i.status === "present").map((i: any) => (
                <div key={i.key} className={`hx-pres${i.major ? " major" : ""}`}>
                  <b>{i.label}</b>
                  <span className="small">
                    {i.conditions.length
                      ? i.conditions.map((c: any) => (c.label === i.label ? (year(c) ? `since ${year(c)}` : "") : `${c.label}${year(c) ? ` (since ${year(c)})` : ""}`)).filter(Boolean).join(" · ")
                      : i.text}
                    {i.key === "obesity" && data.bmi && !i.conditions.length ? ` · BMI ${data.bmi.value.toFixed(1)}` : ""}
                  </span>
                  {i.conflict && <span className="small hx-conflict">{i.conflict}</span>}
                </div>
              ))}
              {!risk.some((i: any) => i.status === "present") && <div className="empty">No risk factor recorded as present.</div>}
            </div>
            <StatusLines items={risk} onRecord={() => open({ kind: "history", focus: "risk" })} />
            {data.bmi && <p className="small muted" style={{ marginTop: 8 }}>BMI {data.bmi.value.toFixed(1)} · {fmtDay(data.bmi.at, { year: true })}</p>}
          </section>
        </div>
        <div className="stack">
          <section className="card pad" aria-label="Other conditions">
            <div className="card-head">
              <h2>Other conditions</h2>
              <button className="btn ghost small" onClick={() => open({ kind: "dx" })}>+ Add</button>
            </div>
            {data.comorbidities.length === 0 ? (
              <div className="empty">None on the diagnosis list.</div>
            ) : (
              <div className="hx-present">
                {data.comorbidities.map((c: any) => {
                  const brief = (data.others ?? []).find((o: any) => o.id === c.id)?.brief;
                  return (
                    <div key={c.id} className="hx-pres">
                      <b>{c.label}</b>
                      {(brief || year(c)) && <span className="small">{brief || `since ${year(c)}`}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <section className="card pad">
            <div className="card-head">
              <h2>Registration</h2>
              <button className="btn ghost small" onClick={() => open({ kind: "identity", identity: idn })}><IdCard size={14} /> Edit details</button>
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
        </div>
      </div>
    </main>
  );
}

// "No: Diabetes · Smoking (never)" and "Not recorded: …" as one line each
function StatusLines({ items, onRecord }: { items: any[]; onRecord(): void }) {
  const no = items.filter((i) => ["absent", "unknown", "not-assessed", "na"].includes(i.status));
  const blank = items.filter((i) => i.status === "not-recorded");
  const word = (i: any) =>
    i.status !== "absent" ? `${i.short ?? i.label} (${i.status === "unknown" ? "unknown" : i.status === "na" ? "n/a" : "not assessed"})`
      : i.key === "smoking" ? String(i.text).split(" · ")[0]
      : i.text && i.text !== "No" ? `${i.short ?? i.label}: ${String(i.text).toLowerCase()}` : i.short ?? i.label;
  return (
    <div className="hx-status">
      {no.length > 0 && <p><b>No</b> {no.map(word).join(" · ")}</p>}
      {blank.length > 0 && (
        <p className="blank">
          <b>Not recorded</b> {blank.map((i) => i.short ?? i.label).join(" · ")}
          <button className="btn ghost small" onClick={onRecord}>Record</button>
        </p>
      )}
    </div>
  );
}
