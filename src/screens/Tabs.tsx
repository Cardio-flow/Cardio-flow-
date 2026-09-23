import { useState } from "react";
import { Plus, Activity, FlaskConical, Stethoscope, BedDouble } from "lucide-react";
import { api, useData } from "../api";
import { Sparkline, Tag, useToast } from "../ui";
import { MEASURES, MEDICATION, PURPOSE_ORDER, doseLabel, formatNumber } from "../../shared/catalog";
import { flagFor, fmtDay } from "../../shared/clinical";
import { PlanMark, VIEW_LABEL, VIEW_SEV } from "./Summary";
import type { Open } from "./Patient";

export function MedicationsTab({ id, version, open }: { id: string; version: number; open(o: Open): void }) {
  const { data } = useData<any>(`/patients/${id}/record`, [version]);
  if (!data) return <main className="page" />;
  const live = data.meds.filter((m: any) => m.status !== "stopped");
  const stopped = data.meds.filter((m: any) => m.status === "stopped");
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 22 }}>Medications</h1>
          <p>Grouped by clinical purpose. Select a medication for dose change, hold, stop or history.</p>
        </div>
        <button className="btn primary" onClick={() => open({ kind: "med-add" })}>
          <Plus size={18} /> Add medication
        </button>
      </div>
      {PURPOSE_ORDER.map((purpose) => {
        const meds = live.filter((m: any) => m.purpose === purpose);
        if (!meds.length) return null;
        return (
          <section key={purpose} className="card pad">
            <div className="card-head">
              <h2>{purpose}</h2>
            </div>
            <table className="data">
              <thead>
                <tr><th>Medication</th><th>Dose</th><th>Frequency</th><th>Since</th><th>Last change</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {meds.map((m: any) => (
                  <tr key={m.id}>
                    <td><b>{m.name}</b><div className="small muted">{m.drugClass}</div></td>
                    <td>{doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)}</td>
                    <td>{m.frequency} {m.route}</td>
                    <td>{m.startedAt ? fmtDay(m.startedAt, { year: true }) : "—"}</td>
                    <td>{m.lastChange ? `${m.lastChange.kind} · ${fmtDay(m.lastChange.effective_at)}` : "—"}</td>
                    <td><Tag sev={m.status === "held" ? "orange" : "green"}>{m.status === "held" ? "Held" : "Active"}</Tag></td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn secondary small" onClick={() => open({ kind: "med-action", medId: m.id })}>Change</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {stopped.length > 0 && (
        <section className="card pad">
          <div className="card-head"><h2>Stopped</h2></div>
          <div className="row wrap" style={{ gap: 8 }}>
            {stopped.map((m: any) => (
              <span key={m.id} className="chip outline">{m.name} · stopped {fmtDay(m.lastChange?.effective_at)}{m.lastChange?.reason ? ` · ${m.lastChange.reason}` : ""}</span>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

export function InvestigationsTab({ id, version, open, done }: { id: string; version: number; open(o: Open): void; done(m?: string, r?: any): void }) {
  const { data } = useData<any>(`/patients/${id}/record`, [version]);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!data) return <main className="page" />;
  const lvef = data.vitals.find((v: any) => v.code === "lvef");
  async function prefer(observationId: string | null, reason: string) {
    setBusy(true);
    try {
      const r = await api(`/patients/${id}/preferences`, { body: { code: "lvef", observationId, reason } });
      done(observationId ? "Preferred LVEF set" : "Automatic LVEF selection restored", r);
    } catch (e) {
      toast({ text: (e as Error).message, err: true });
    }
    setBusy(false);
  }
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 22 }}>Investigations</h1>
          <p>Every value keeps its date, source and quality. Nothing is overwritten.</p>
        </div>
        <div className="row">
          <button className="btn secondary" onClick={() => open({ kind: "echo" })}><Activity size={18} /> Add Echo</button>
          <button className="btn primary" onClick={() => open({ kind: "labs" })}><FlaskConical size={18} /> Add labs</button>
        </div>
      </div>
      <section className="card pad">
        <div className="card-head">
          <h2>Echo</h2>
          <span className="meta">
            Current LVEF: {lvef ? `${formatNumber(lvef.current.value, 0)}% · ${lvef.reason}` : "none"}
          </span>
        </div>
        {data.studies.length === 0 ? <div className="empty">No Echo recorded.</div> : (
          <table className="data">
            <thead><tr><th>Date</th><th>Quality</th><th>LVEF</th><th>Findings</th><th>Used as current</th><th /></tr></thead>
            <tbody>
              {[...data.studies].reverse().map((s: any) => {
                const obsId = lvef?.series.find((p: any) => Math.abs(Date.parse(p.at) - Date.parse(s.performed_at)) < 1000)?.id;
                const isCurrent = obsId && lvef?.current.id === obsId;
                return (
                  <tr key={s.id}>
                    <td>{fmtDay(s.performed_at, { year: true })}</td>
                    <td><Tag sev={s.quality === "formal" ? "blue" : "gray"}>{s.quality}</Tag></td>
                    <td><b>{s.lvef != null ? `${formatNumber(s.lvef, 0)}%` : "—"}</b></td>
                    <td className="small">{s.findings.join(" · ")}</td>
                    <td>{isCurrent ? <Tag sev="green">Current</Tag> : null}</td>
                    <td style={{ textAlign: "right" }}>
                      {obsId && !isCurrent && (
                        <button className="btn ghost small" disabled={busy} onClick={() => prefer(obsId, "Clinician preferred this study")}>Use this study</button>
                      )}
                      {isCurrent && data.lvefResolution.preferred && (
                        <button className="btn ghost small" disabled={busy} onClick={() => prefer(null, "Return to automatic selection")}>Automatic</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="card pad">
        <div className="card-head"><h2>Laboratory</h2><span className="meta">Latest value, trend and previous results</span></div>
        {data.results.length === 0 ? <div className="empty">No results yet.</div> : (
          <table className="data">
            <thead><tr><th>Test</th><th>Latest</th><th>Date</th><th>Trend</th><th>Previous</th></tr></thead>
            <tbody>
              {data.results.map((r: any) => {
                const def = MEASURES[r.code];
                const flag = flagFor(r.current.value, def?.ref);
                return (
                  <tr key={r.code}>
                    <td><b>{r.display}</b>{def?.derived && <div className="small" style={{ color: "var(--blue-ink)", fontWeight: 700 }}>Calculated</div>}</td>
                    <td><b style={{ color: flag === "high" ? "var(--red-ink)" : flag === "low" ? "var(--orange-ink)" : undefined }}>{formatNumber(r.current.value, r.decimals)}</b> <span className="muted small">{r.unit}</span> {flag && <Tag sev={flag === "high" ? "red" : "orange"}>{flag.toUpperCase()}</Tag>}</td>
                    <td>{fmtDay(r.current.at, { year: true })}</td>
                    <td><Sparkline values={r.series.map((p: any) => p.value)} tone={flag ? "orange" : "gray"} /></td>
                    <td className="small muted">{r.series.slice(0, -1).reverse().slice(0, 3).map((p: any) => `${formatNumber(p.value, r.decimals)} (${fmtDay(p.at)})`).join(" · ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

export function PlanTab({ id, version, open }: { id: string; version: number; open(o: Open): void }) {
  const { data } = useData<any>(`/patients/${id}/record`, [version]);
  const [showClosed, setShowClosed] = useState(false);
  if (!data) return <main className="page" />;
  const plan = data.plan.filter((p: any) => showClosed || p.status === "planned");
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 22 }}>Plan & follow-up</h1>
          <p>Each action has a real date and closes itself when the result, visit or study is recorded.</p>
        </div>
        <button className="btn primary" onClick={() => open({ kind: "plan-add" })}><Plus size={18} /> Add to plan</button>
      </div>
      <section className="card pad">
        <label className="row small" style={{ fontWeight: 600, color: "var(--ink-3)", marginBottom: 8 }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show completed and cancelled
        </label>
        {plan.length === 0 && <div className="empty">Nothing open.</div>}
        <div className="plan-list">
          {plan.map((p: any) => (
            <div key={p.id} className={`plan-row ${p.view === "done" ? "done" : ""}`}>
              <PlanMark view={p.view} />
              <span className="title">
                {p.title}
                <small>
                  {p.source ? `${p.source.label} · ${fmtDay(p.source.at)}` : p.category.replace("_", " ")}
                  {p.completesOn?.type === "lab" ? " · closes on result" : p.completesOn?.type === "visit" ? " · closes at visit" : p.completesOn?.type === "study" ? " · closes on Echo" : ""}
                  {p.outcome ? ` · ${p.outcome}` : ""}
                </small>
              </span>
              <span className="when">{p.dueDate ? fmtDay(p.dueDate, { weekday: true, year: true }) : "No date"}</span>
              <span><Tag sev={VIEW_SEV[p.view]}>{VIEW_LABEL(p, data.today)}</Tag></span>
              <span>{p.status === "planned" && <button className="btn ghost small" onClick={() => open({ kind: "plan-item", planId: p.id })}>Update</button>}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export function VisitsTab({ id, version, open }: { id: string; version: number; open(o: Open): void }) {
  const { data } = useData<any>(`/patients/${id}/journey`, [version]);
  const [note, setNote] = useState<Record<string, string>>({});
  if (!data) return <main className="page" />;
  const contexts = [...data.contexts].reverse();
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 22 }}>Visits & admissions</h1>
          <p>Admissions, clinic visits and follow-up belong to one journey.</p>
        </div>
      </div>
      {contexts.length === 0 && <div className="empty">No visits or admissions yet.</div>}
      {contexts.map((c: any) => (
        <section key={c.id} className="card pad">
          <div className="card-head">
            <div className="row">
              {c.kind === "admission" ? <BedDouble size={20} color="var(--navy)" /> : <Stethoscope size={20} color="var(--navy)" />}
              <h2>{c.kind === "admission" ? "Admission" : c.service ?? "Clinic visit"}</h2>
              <Tag sev={c.status === "open" ? "yellow" : "gray"}>{c.status === "open" ? "Open" : "Closed"}</Tag>
            </div>
            <span className="meta">{fmtDay(c.startedAt, { weekday: true, year: true })}{c.endedAt ? ` → ${fmtDay(c.endedAt, { weekday: true })}` : ""} · {c.location}</span>
          </div>
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            {c.reasons.map((r: string) => <span key={r} className="chip dx">{r}</span>)}
            {c.summary?.dischargeStatus && <span className="chip outline">{c.summary.dischargeStatus}</span>}
          </div>
          {c.actions.length > 0 && (
            <div className="row wrap" style={{ gap: 8 }}>
              {c.actions.map((a: any) => <Tag key={a.id} sev={VIEW_SEV[a.view]}>{a.title} · {fmtDay(a.dueDate)}</Tag>)}
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {c.status === "open" && c.kind === "admission" && <button className="btn primary small" onClick={() => open({ kind: "discharge", contextId: c.id })}>Discharge</button>}
            {c.status === "open" && c.kind === "clinic_visit" && <button className="btn primary small" onClick={() => open({ kind: "visit", contextId: c.id })}>Continue visit</button>}
            {c.status === "closed" && (
              <button className="btn secondary small" onClick={() => api(`/patients/${id}/contexts/${c.id}/note`).then((n) => setNote({ ...note, [c.id]: c.summary?.note || n.text }))}>
                {c.kind === "admission" ? "Discharge summary" : "Clinic note"}
              </button>
            )}
          </div>
          {note[c.id] && (
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5, background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 12, padding: 14, margin: "12px 0 0" }}>{note[c.id]}</pre>
          )}
        </section>
      ))}
    </main>
  );
}

export function RegistriesTab() {
  return (
    <main className="page">
      <section className="card pad">
        <div className="card-head"><h2>Registries</h2></div>
        <p style={{ fontWeight: 500, color: "var(--ink-3)", lineHeight: 1.6, margin: 0, maxWidth: 720 }}>
          Registry linkage switches on after the HF slice is in daily use. Registries will read from the clinical record already captured here
          (diagnoses, Echo, medications, labs, admissions) and only ask for registry-only fields. Your existing HF, CAD and EP registries keep running until then.
        </p>
      </section>
    </main>
  );
}
