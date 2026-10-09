import { useState } from "react";
import { Plus, Activity, FlaskConical, Stethoscope, BedDouble, FileHeart } from "lucide-react";
import { STUDIES, STUDY_LABEL } from "../../shared/studies";
import { api, useData } from "../api";
import { Sparkline, Tag, useToast } from "../ui";
import { MEASURES, MEDICATION, PURPOSE_ORDER, doseLabel, formatNumber } from "../../shared/catalog";
import { flagFor, fmtDay } from "../../shared/clinical";
import { PlanMark, VIEW_LABEL, VIEW_SEV } from "./Summary";
import type { Open } from "./Patient";

const PROC_LABEL: Record<string, string> = { pci: "PCI", cabg: "CABG", valve: "Valve intervention", device: "Device", ablation: "Ablation", cardioversion: "Cardioversion", rhc: "Right heart catheterisation" };

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
        <span className="row wrap" style={{ gap: 8 }}>
          <button className="btn secondary" onClick={() => open({ kind: "med-batch" })}>Add several</button>
          <button className="btn primary" onClick={() => open({ kind: "med-add" })}>
            <Plus size={18} /> Add medication
          </button>
        </span>
      </div>
      {PURPOSE_ORDER.map((purpose) => {
        const meds = live.filter((m: any) => m.purpose === purpose);
        if (!meds.length) return null;
        return (
          <section key={purpose} className="card pad">
            <div className="card-head">
              <h2>{purpose}</h2>
            </div>
            <table className="data meds">
              <thead>
                <tr><th>Medication</th><th>Dose</th><th>Frequency</th><th>Since</th><th>Last change</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {meds.map((m: any) => (
                  <tr key={m.id}>
                    <td data-label="Medication"><b>{m.name}</b><div className="small muted">{m.drugClass}{MEDICATION[m.code]?.brands?.length ? ` · ${MEDICATION[m.code].brands!.join(", ")}` : ""}</div></td>
                    {/* phones: dose, frequency and start on one line under the name */}
                    <td className="med-compact">{doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)} · {m.frequency} {m.route}{m.startedAt ? ` · since ${fmtDay(m.startedAt, { year: true })}` : ""}</td>
                    <td data-label="Dose">{doseLabel(MEDICATION[m.code], m.doseValue, m.doseUnit)}</td>
                    <td data-label="Frequency">{m.frequency} {m.route}</td>
                    <td data-label="Since">{m.startedAt ? fmtDay(m.startedAt, { year: true }) : "—"}</td>
                    <td data-label="Last change">{m.lastChange ? `${({ start: "Started", increase: "Increased", decrease: "Reduced", hold: "Held", restart: "Restarted", not_taking: "Not taking", resume: "Taken again", continue: /^Frequency changed/.test(m.lastChange.reason ?? "") ? "Frequency changed" : "Continued" } as Record<string, string>)[m.lastChange.kind] ?? m.lastChange.kind} · ${fmtDay(m.lastChange.effective_at)}` : "—"}</td>
                    <td data-label="Status"><Tag sev={m.status === "held" || m.status === "not_taking" ? "orange" : "green"}>{m.status === "held" ? "Held" : m.status === "not_taking" ? "Not taking" : "Active"}</Tag></td>
                    <td data-cell="action" style={{ textAlign: "right" }}>
                      <span className="row-actions">
                        <button className="btn secondary small" onClick={() => open({ kind: "med-action", medId: m.id })}>Change</button>
                        <button className="btn ghost small" title="Correct a wrong entry" onClick={() => open({ kind: "med-correct", med: m })}>Correct</button>
                      </span>
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
              <button key={m.id} className="chip outline" style={{ cursor: "pointer" }} title="Correct a wrong entry" onClick={() => open({ kind: "med-correct", med: m })}>
                {m.name} · stopped {fmtDay(m.lastChange?.effective_at)}{m.lastChange?.reason ? ` · ${m.lastChange.reason}` : ""}
              </button>
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
  const echoes = data.studies.filter((s: any) => s.kind === "echo");
  const others = data.studies.filter((s: any) => s.kind !== "echo").sort((a: any, b: any) => (a.performed_at < b.performed_at ? 1 : -1));
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
        <div className="row wrap">
          <button className="btn secondary" onClick={() => open({ kind: "echo" })}><Activity size={18} /> Add Echo</button>
          <button className="btn secondary" onClick={() => open({ kind: "study" })}><FileHeart size={18} /> Add study</button>
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
        {echoes.length === 0 ? <div className="empty">No Echo recorded.</div> : (
          <table className="data">
            <thead><tr><th>Date</th><th>Quality</th><th>LVEF</th><th>Findings</th><th>Used as current</th><th /></tr></thead>
            <tbody>
              {[...echoes].reverse().map((s: any) => {
                const obsId = lvef?.series.find((p: any) => Math.abs(Date.parse(p.at) - Date.parse(s.performed_at)) < 1000)?.id;
                const isCurrent = obsId && lvef?.current.id === obsId;
                return (
                  <tr key={s.id}>
                    <td data-label="Date">{fmtDay(s.performed_at, { year: true })}</td>
                    <td data-label="Quality"><Tag sev={s.quality === "formal" ? "blue" : "gray"}>{s.quality}</Tag></td>
                    <td data-label="LVEF"><b>{s.lvef != null ? `${formatNumber(s.lvef, 0)}%` : "—"}</b></td>
                    <td data-label="Findings" className="small">{s.findings.join(" · ")}</td>
                    <td data-label="Used as current">{isCurrent ? <Tag sev="green">Current</Tag> : null}</td>
                    <td data-cell="action" style={{ textAlign: "right" }}>
                      {obsId && !isCurrent && (
                        <button className="btn ghost small" disabled={busy} onClick={() => prefer(obsId, "Clinician preferred this study")}>Use this study</button>
                      )}
                      {isCurrent && data.lvefResolution.preferred && (
                        <button className="btn ghost small" disabled={busy} onClick={() => prefer(null, "Return to automatic selection")}>Automatic</button>
                      )}
                      <button className="btn ghost small" onClick={() => open({ kind: "void", what: `Echo of ${fmtDay(s.performed_at, { year: true })}`, path: `studies/${s.id}/void` })}>Entered in error</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="card pad">
        <div className="card-head">
          <h2>ECG, rhythm, ischaemia and imaging</h2>
          <span className="meta">
            {STUDIES.map((k) => (
              <button key={k.kind} className="btn ghost small" onClick={() => open({ kind: "study", studyKind: k.kind })}>+ {k.short}</button>
            ))}
          </span>
        </div>
        {others.length === 0 ? (
          <div className="empty">No ECG, Holter, stress test, CT, CMR or angiography recorded yet.</div>
        ) : (
          <table className="data">
            <thead><tr><th>Date</th><th>Study</th><th>Findings</th><th>Conclusion</th><th /></tr></thead>
            <tbody>
              {others.map((st: any) => (
                <tr key={st.id}>
                  <td data-label="Date">{fmtDay(st.performed_at, { year: true })}</td>
                  <td data-label="Study"><Tag sev="blue">{STUDY_LABEL[st.kind] ?? st.kind}</Tag></td>
                  <td data-label="Findings"><b>{st.findings[0] ?? "—"}</b></td>
                  <td data-label="Conclusion" className="small muted">{st.conclusion || "—"}</td>
                  <td data-cell="action" style={{ textAlign: "right" }}>
                    <button className="btn ghost small" onClick={() => open({ kind: "void", what: `${STUDY_LABEL[st.kind] ?? st.kind} of ${fmtDay(st.performed_at, { year: true })}`, path: `studies/${st.id}/void` })}>Entered in error</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {data.procedures?.length > 0 && (
        <section className="card pad">
          <div className="card-head"><h2>Procedures</h2><span className="meta">PCI, CABG, valve, device and ablation</span></div>
          <table className="data">
            <thead><tr><th>Date</th><th>Procedure</th><th>Details</th><th /></tr></thead>
            <tbody>
              {[...data.procedures].reverse().map((p: any) => (
                <tr key={p.id}>
                  <td data-label="Date">{fmtDay(p.performed_at, { year: true })}</td>
                  <td data-label="Procedure"><Tag sev="blue">{PROC_LABEL[p.kind] ?? p.kind}</Tag></td>
                  <td data-label="Details" className="small">{p.summary || "—"}</td>
                  <td data-cell="action" style={{ textAlign: "right" }}>
                    <button className="btn ghost small" onClick={() => open({ kind: "void", what: `${PROC_LABEL[p.kind] ?? p.kind} of ${fmtDay(p.performed_at, { year: true })}`, path: `procedures/${p.id}/void` })}>Entered in error</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section className="card pad">
        <div className="card-head"><h2>Laboratory</h2><span className="meta">Latest value, trend and previous results</span></div>
        {data.results.length === 0 ? <div className="empty">No results yet.</div> : (
          <table className="data">
            <thead><tr><th>Test</th><th>Latest</th><th>Date</th><th>Trend</th><th>Previous</th><th /></tr></thead>
            <tbody>
              {data.results.map((r: any) => {
                const def = MEASURES[r.code];
                const flag = flagFor(r.current.value, def?.ref);
                return (
                  <tr key={r.code}>
                    <td data-label="Test"><b>{r.display}</b>{def?.derived && <div className="small" style={{ color: "var(--blue-ink)", fontWeight: 700 }}>Calculated</div>}</td>
                    <td data-label="Latest"><b style={{ color: flag === "high" ? "var(--red-ink)" : flag === "low" ? "var(--orange-ink)" : undefined }}>{formatNumber(r.current.value, r.decimals)}</b> <span className="muted small">{r.unit}</span> {flag && <Tag sev={flag === "high" ? "red" : "orange"}>{flag.toUpperCase()}</Tag>}</td>
                    <td data-label="Date">{fmtDay(r.current.at, { year: true })}</td>
                    <td data-label="Trend"><Sparkline values={r.series.map((p: any) => p.value)} tone={flag ? "orange" : "gray"} /></td>
                    <td data-label="Previous" className="small muted">{r.series.slice(0, -1).reverse().slice(0, 3).map((p: any) => `${formatNumber(p.value, r.decimals)} (${fmtDay(p.at)})`).join(" · ") || "—"}</td>
                    <td data-cell="action" style={{ textAlign: "right" }}>
                      {!def?.derived && <button className="btn ghost small" onClick={() => open({ kind: "result-correct", result: r })}>Correct</button>}
                    </td>
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
  const plan = data.plan.filter((p: any) => showClosed || p.status === "planned" || p.awaitingReview);
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 22 }}>Plan & follow-up</h1>
          <p>Track the owner, booking, recorded evidence and clinical review of each action.</p>
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
                  {p.owner ? ` · Owner: ${p.owner}` : ""}
                  {["ordered", "booked"].includes(p.progress) ? ` · ${p.progress}` : ""}
                </small>
              </span>
              <span className="when">{p.dueDate ? fmtDay(p.dueDate, { weekday: true, year: true }) : "No date"}</span>
              <span><Tag sev={VIEW_SEV[p.view]}>{VIEW_LABEL(p, data.today)}</Tag></span>
              <span className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                {p.checklist && <button className="btn ghost small" onClick={() => open({ kind: "checklist", check: p.checklist })}>Checklist</button>}
                {(p.status === "planned" || p.awaitingReview) && <button className="btn ghost small" onClick={() => open({ kind: "plan-item", planId: p.id })}>{p.awaitingReview ? "Review" : "Update"}</button>}
              </span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export function VisitsTab({ id, version, summary, open }: { id: string; version: number; summary: any; open(o: Open): void }) {
  const { data } = useData<any>(`/patients/${id}/journey`, [version]);
  const [note, setNote] = useState<Record<string, string>>({});
  if (!data) return <main className="page" />;
  const contexts = [...data.contexts].reverse();
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 22 }}>Admissions & visits</h1>
          <p>Admissions, clinic visits and follow-up belong to one journey.</p>
        </div>
        {!summary.header.deceased && <span className="row wrap" style={{ gap: 8 }}>
          <button className="btn secondary" disabled={!!summary.header.openContext} onClick={() => open({ kind: "admit" })}><BedDouble size={18} />New admission</button>
          {!summary.header.openContext && <button className="btn primary" onClick={() => open({ kind: "visit" })}><Stethoscope size={18} />Start clinic visit</button>}
        </span>}
      </div>
      {summary.header.openContext?.kind === "clinic_visit" && <p className="infobox">A clinic visit is open. Use Continue visit to finish it before starting a new admission.</p>}
      {summary.header.openContext?.kind === "admission" && <p className="infobox">An admission is open. Record decisions and results below, then discharge when ready.</p>}
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
          {c.kind === "admission" && <details open={c.status === "open"} style={{ margin: "14px 0" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Milestones & events</summary>
            <ol style={{ listStyle: "none", margin: "12px 0", padding: 0 }}>
              {data.events.filter((e: any) => e.context_id === c.id && !e.planned).map((e: any) => <li key={e.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line-2)" }}>
                <span className="meta">{fmtDay(e.occurred_at, { weekday: true })}</span>
                <div><b>{e.title}</b></div>
                {e.detail && <div className="help">{e.detail}</div>}
              </li>)}
            </ol>
            {c.summary?.events?.length > 0 && <p className="help">In-hospital events: {c.summary.events.join(" · ")}</p>}
            {c.meds.length > 0 && <div className="col" style={{ gap: 6 }}>
              <span className="eyebrow">Medication changes during admission</span>
              {c.meds.map((m: any, i: number) => <span key={i}><b>{m.name}</b> · {m.kind} {m.dose}</span>)}
            </div>}
          </details>}
          {c.actions.length > 0 && (
            <div className="row wrap" style={{ gap: 8 }}>
              {c.actions.map((a: any) => <Tag key={a.id} sev={VIEW_SEV[a.view]}>{a.title} · {fmtDay(a.dueDate)}</Tag>)}
            </div>
          )}
          <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
            {c.status === "open" && c.kind === "admission" && <>
              <button className="btn secondary small" onClick={() => open({ kind: "pathways" })}>Review pathways</button>
              <button className="btn secondary small" onClick={() => open({ kind: "labs" })}>Add labs</button>
              <button className="btn secondary small" onClick={() => open({ kind: "med-batch" })}>Add medicines</button>
              <button className="btn secondary small" onClick={() => open({ kind: "plan-add" })}>Add plan item</button>
            </>}
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

export function RegistriesTab({ id, version }: { id: string; version: number }) {
  const { data: hf } = useData<any>(`/patients/${id}/registries/hf`, [version]);
  const { data: cad } = useData<any>(`/patients/${id}/registries/cad`, [version]);
  const { data: eps } = useData<any>(`/patients/${id}/registries/eps`, [version]);
  const list = [hf, cad, eps].filter((r) => r && r.applicable !== false);
  if (!hf || !cad || !eps || !list.length) {
    return (
      <main className="page">
        <section className="card pad">
          <div className="card-head"><h2>Registries</h2></div>
          <p className="reg-intro">{hf && cad && eps ? "Registry projections appear for patients with heart failure (Heart Failure Registry), a PCI, angiography or ACS admission (CAD Registry), or a device procedure or ablation (EP Registry)." : "Loading…"}</p>
        </section>
      </main>
    );
  }
  return <main className="page">{list.map((r) => <RegistryCard key={r.registry} r={r} />)}</main>;
}

// One registry projection: what CardioFlow fills, what is missing, and the registry-only fields.
function RegistryCard({ r }: { r: any }) {
  const toast = useToast();
  const [showOnly, setShowOnly] = useState(false);
  const pct = Math.round((r.counts.filled / r.counts.mapped) * 100);
  const file = r.registry.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
  const copy = async () => {
    try { await navigator.clipboard.writeText(r.csv); toast({ text: "Registry row copied (CSV)" }); } catch { toast({ text: "Copy not available in this browser", err: true }); }
  };
  const download = (coded = false) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([coded ? r.csvCoded : r.csv], { type: "text/csv" }));
    a.download = `${file}-row${coded ? "-spss-codes" : ""}.csv`;
    a.click();
  };
  return (
    <section className="card pad reg">
      <div className="card-head">
        <h2>{r.registry}</h2>
        <span className="meta">Read from the CardioFlow record · nothing is sent to the registry</span>
      </div>
      {r.index && <p className="reg-intro"><b>Index record:</b> {r.index}{r.admission ? ` · admission ${r.admission.from}${r.admission.open ? " (in hospital)" : r.admission.to ? ` to ${r.admission.to}` : ""}` : ""}</p>}
      <div className="reg-sum">
        <div>
          <b>{r.counts.filled} of {r.counts.mapped}</b> registry fields filled from the record
          <span className="bar" aria-label={`${pct}% filled`}><i style={{ width: `${pct}%` }} /></span>
        </div>
        <div className="muted small">{r.counts.mapped - r.counts.filled} mapped fields not recorded yet · {r.counts.registryOnly} fields are asked in the registry only</div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn secondary small" onClick={copy}>Copy registry row (CSV)</button>
          <button className="btn ghost small" onClick={() => download()}>Download CSV</button>
          {r.csvCoded && <button className="btn ghost small" onClick={() => download(true)}>CSV with SPSS codes</button>}
          <label className="row small" style={{ gap: 6, fontWeight: 700 }}>
            <input type="checkbox" checked={showOnly} onChange={(e) => setShowOnly(e.target.checked)} /> Show registry-only fields
          </label>
        </div>
      </div>
      {r.sections.map((sec: any) => {
        const rows = sec.fields.filter((f: any) => f.mapped || showOnly);
        if (!rows.length) return null;
        return (
          <div key={sec.title} className="reg-sec">
            <div className="tgt-title">{sec.title}</div>
            <table className="data">
              <thead><tr><th>Registry field</th><th>Value</th><th>From CardioFlow</th></tr></thead>
              <tbody>
                {rows.map((f: any) => (
                  <tr key={f.key} className={f.mapped ? (f.value == null ? "reg-missing" : "") : "reg-only"}>
                    <td data-label="Registry field"><b>{f.label}</b> <span className="muted small">{f.key}</span></td>
                    <td data-label="Value">{f.mapped ? f.value ?? "Not recorded" : "Asked in the registry"}{f.code != null && f.code !== "" && f.code !== f.value ? <span className="muted small"> · code {f.code}</span> : null}</td>
                    <td data-label="From CardioFlow">{[f.at, f.note].filter(Boolean).join(" · ") || (f.mapped ? "" : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
