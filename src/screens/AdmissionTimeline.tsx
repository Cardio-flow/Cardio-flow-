import { Activity, BedDouble, CalendarDays, Pill } from "lucide-react";
import { useData } from "../api";
import { Tag } from "../ui";
import { fmtDay } from "../../shared/clinical";
import { VIEW_SEV } from "./Summary";

// Presentation only: the journey supplies the events, medicines and follow-up.
export function AdmissionTimeline({ context: c, events }: { context: any; events: any[] }) {
  const recorded = events.filter((e) => e.context_id === c.id && !e.planned);
  return <div className="admission-timeline">
    <h3 className="eyebrow">Milestones & events</h3>
    <ol className="milestone-list">
      {recorded.map((e) => <li key={e.id}>
        <span className="milestone-date">{fmtDay(e.occurred_at)}</span>
        <span className="milestone-icon"><Activity size={18} /></span>
        {e.detail ? <details className="milestone-content"><summary>{e.title}</summary><p>{e.detail}</p></details> : <b className="milestone-content">{e.title}</b>}
      </li>)}
    </ol>
    {!recorded.length && <p className="help">No milestones recorded yet.</p>}
    {c.summary?.events?.length > 0 && <p className="help">In-hospital events: {c.summary.events.join(" · ")}</p>}
    {c.meds.length > 0 && <details className="admission-fold" open>
      <summary><Pill size={17} />Medication changes during admission</summary>
      <div className="admission-meds">{c.meds.map((m: any, i: number) => <p key={i}><b>{m.name}</b><span>{m.kind} {m.dose}</span></p>)}</div>
    </details>}
    {c.actions.length > 0 && <details className="admission-fold" open>
      <summary><CalendarDays size={17} />Follow-up & plan</summary>
      <div className="admission-followup">{c.actions.map((a: any) => <Tag key={a.id} sev={VIEW_SEV[a.view]}>{a.title} · {fmtDay(a.dueDate)}</Tag>)}</div>
    </details>}
  </div>;
}

export function AdmissionBrief({ id, contextId, header, attention, version }: { id: string; contextId: string; header: any; attention: any[]; version: number }) {
  const { data, error } = useData<any>(`/patients/${id}/journey`, [version]);
  const c = data?.contexts.find((c: any) => c.id === contextId);
  return <section className="admission-brief" aria-label="Admission context">
    <div className="workspace-identity"><h3>{header.name}</h3><p>{header.birthDateEstimated ? "~" : ""}{header.age} y · {header.sex} · MRN {header.mrn}</p><div className="row wrap">{header.sample && <span className="chip sample-chip">Sample patient · synthetic</span>}{attention.length > 0 && <Tag sev={attention[0].severity}>{attention.length} alerts</Tag>}</div><p>Allergies: {header.allergies}</p></div>
    <div className="row"><BedDouble size={20} /><h2>Current admission</h2></div>
    {error && <div className="error-box">Admission context could not load: {error}</div>}
    {!error && !c && <p role="status">Loading admission…</p>}
    {c && <><p className="meta">{fmtDay(c.startedAt, { year: true })} · {c.location}</p><div className="row wrap">{c.reasons.map((r: string) => <span key={r} className="chip dx">{r}</span>)}</div><AdmissionTimeline context={c} events={data.events} /></>}
  </section>;
}
