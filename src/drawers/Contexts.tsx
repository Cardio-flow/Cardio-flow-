import { useEffect, useRef, useState } from "react";
import { BedDouble, LogOut, Stethoscope, FileText } from "lucide-react";
import {EntryDraftStatus} from "../EntryDraftStatus";
import {bpPairNeedsReview, type AssessmentAnswers} from "../../shared/assessment-entry";
import {useEntryDraft} from "../useEntryDraft";
import { api, useData } from "../api";
import { Drawer, DateInput, navigate, MultiChoice, Segmented, SevChip, SingleChoice, Tag } from "../ui";
import { ADMISSION_REASONS, ADMISSION_ROUTES, CAUSE_GROUPS, DISCHARGE_CONDITION, DISCHARGE_DESTINATION, HF_REASONS, IN_HOSPITAL_EVENTS, SYMPTOMS, readmissionBand } from "../../shared/encounters";
import { FINDINGS, PLAN_TEMPLATES, formatNumber } from "../../shared/catalog";
import { addDays, daysBetween, fmtDay, localDay } from "../../shared/clinical";
import { ActionButton } from "../screens/Summary";
import { VIEW_LABEL, VIEW_SEV } from "../screens/Summary";
import type { Open } from "../screens/Patient";
import { triage } from "../../shared/triage";
import { existingClinicReview } from "../../shared/follow-up";
const VISIT_REASONS = ["Heart failure", "Post-discharge", "Medication titration", "Post-ACS", "Post-PCI", "Valve", "Prosthetic valve problem", "Arrhythmia", "Device", "ICD shock", "Pre-operative assessment", "Chest pain", "Bleeding", "Chest infection", "Myocarditis", "Pericarditis", "Routine cardiology"];

const LOCATIONS = ["CCU", "Ward 3A", "Ward 3B", "Step-down"];

export function Admission({ patientId, summary, onClose, onDone }: { patientId: string; summary: any; onClose(): void; onDone(m?: string, r?: any): void }) {
  const [narrative, setNarrative] = useState("");
  async function close() {
    if (busy) return;
    if(entry.conflict) {if(window.confirm("Close without saving this window’s edits? The saved draft will be kept.")) {entry.complete();onClose();} return;}
    try {await entry.flush(); onClose();} catch(e) {if((e as any).status!==409) setError((e as Error).message);}
  }
  const [reasons, setReasons] = useState<string[]>([]);
  const [hfChoice, setHfChoice] = useState<string>("");
  const [route, setRoute] = useState<string>("Emergency department");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const { data: jr } = useData<any>(`/patients/${patientId}/journey`);
  const lastDischarge = jr?.contexts.filter((c: any) => c.kind === "admission" && c.status === "closed" && c.endedAt).sort((a: any, b: any) => (a.endedAt < b.endedAt ? 1 : -1))[0];
  const readmitDays = lastDischarge ? daysBetween(lastDischarge.endedAt, summary.today) : null;
  const hfAuto = reasons.some((r) => HF_REASONS.includes(r));
  const hfRelated = hfChoice ? hfChoice === "yes" : hfAuto;
  const [loc, setLoc] = useState("Ward 3B");
  const [bed, setBed] = useState("");
  const meds = summary.medications.groups.flatMap((g: any) => g.meds);
  const [conf, setConf] = useState<Record<string, string>>(() => Object.fromEntries([...summary.header.diagnoses.map((d: any) => [d.id, "unchanged"]), ...meds.map((m: any) => [m.id, "unchanged"])]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openAdmissionId,setOpenAdmissionId] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    try {
      await entry.flush();
      const r = await api(`/patients/${patientId}/admissions`, {
        body: {
          startedAt: new Date().toISOString(), draftVersion: entry.getVersion(),
          location: bed ? `${loc} · Bed ${bed}` : loc,
          reasons,
          route,
          symptoms,
          hfRelated,
          narrative,
          confirmations: [
            ...summary.header.diagnoses.map((d: any) => ({ kind: "condition", id: d.id, answer: conf[d.id] })),
            ...meds.map((m: any) => ({ kind: "medication", id: m.id, answer: conf[m.id] })),
          ],
        },
      });
      entry.complete();
      onDone("Admission started", r);
    } catch (e) {
      setBusy(false);
      if((e as any).code === "entry_draft_changed") {setError("");await entry.refreshConflict("draft");}
      else {setError((e as Error).message); if((e as any).code === "admission_open") setOpenAdmissionId((e as any).details?.contextId ?? "open");}
    }
  }
  const entry = useEntryDraft(patientId, "admission-entry", {narrative,reasons,hfChoice,route,symptoms,loc,bed,conf}, d => {setNarrative(d.narrative ?? "");setReasons(d.reasons ?? []);setHfChoice(d.hfChoice ?? "");setRoute(d.route ?? "Emergency department");setSymptoms(d.symptoms ?? []);setLoc(d.loc ?? "Ward 3B");setBed(d.bed ?? "");setConf({...conf,...(d.conf ?? {})});});
  const opts = [{ value: "unchanged", label: "Confirmed" }, { value: "changed", label: "Changed" }, { value: "unknown", label: "Unknown today" }];
  return (
    <Drawer
      title="Start admission"
      subtitle="Known history is brought forward for confirmation, never copied as today's data"
      icon={<BedDouble size={22} />}
      onClose={close}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={close}>Cancel</button>
          <button className="btn primary" disabled={!entry.loaded || !!entry.conflict || !!openAdmissionId || !reasons.length || busy} onClick={save}>{busy ? "Saving…" : "Admit"}</button>
        </span>
      }
    >
      <fieldset className="drawer-body" disabled={!entry.loaded || busy} style={{border:0,margin:0}}>
        <EntryDraftStatus draft={entry} showStatus onDiscard={()=>{entry.complete();onClose();}} />
        {error && !entry.conflict && <div className="error-box" role="alert">{error}{openAdmissionId && <button type="button" className="btn secondary small" onClick={()=>{entry.complete();onDone();navigate(`/patients/${patientId}/visits`);}}>View existing admission</button>}</div>}
        <label className="field"><span>Admission narrative</span><textarea aria-label="Admission narrative" className="input" rows={3} maxLength={4000} value={narrative} onChange={e => setNarrative(e.target.value)} /></label>
        {readmitDays != null && (
          <div className={`infobox ${readmitDays <= 30 ? "warn" : ""}`}>
            Previous discharge {fmtDay(lastDischarge.endedAt, { year: true })}: this is a readmission after {readmitDays} days ({readmissionBand(readmitDays)}).
          </div>
        )}
        <div className="q">
          <div className="label">Reason for admission</div>
          <MultiChoice options={ADMISSION_REASONS.map((r) => ({ value: r, label: r }))} value={reasons} onChange={setReasons} />
        </div>
        <div className="row wrap" style={{ gap: 24 }}>
          <div className="q">
            <div className="label" style={{ fontSize: 15 }}>HF-related admission</div>
            <Segmented label="HF-related admission" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} value={hfChoice || (hfAuto ? "yes" : reasons.length ? "no" : "")} onChange={setHfChoice} />
          </div>
          <div className="q">
            <div className="label" style={{ fontSize: 15 }}>Came through</div>
            <Segmented label="Admission route" options={ADMISSION_ROUTES.map((r) => ({ value: r, label: r.replace("Transfer from another hospital", "Transfer") }))} value={route} onChange={setRoute} />
          </div>
        </div>
        <div className="q">
          <div className="label" style={{ fontSize: 15 }}>Presenting symptoms</div>
          <MultiChoice options={SYMPTOMS.map((r) => ({ value: r, label: r }))} value={symptoms} onChange={setSymptoms} />
        </div>
        <div className="row wrap" style={{ gap: 20 }}>
          <div className="q">
            <div className="label" style={{ fontSize: 15 }}>Location</div>
            <Segmented label="Location" options={LOCATIONS.map((l) => ({ value: l, label: l }))} value={loc} onChange={setLoc} />
          </div>
          <label className="field">
            <span>Bed</span>
            <input className="input" style={{ width: 100 }} value={bed} onChange={(e) => setBed(e.target.value)} />
          </label>
        </div>
        <div className="q">
          <div className="label">Previously recorded</div>
          <div className="help">Confirm what still applies. Weight, vitals and labs are never carried forward as today's values.</div>
          {[...summary.header.diagnoses.map((d: any) => ({ id: d.id, label: d.label, kind: "Diagnosis" })), ...meds.map((m: any) => ({ id: m.id, label: `${m.name} ${m.dose} ${m.frequency}`, kind: "Medication" }))].map((x) => (
            <div key={x.id} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line-2)", paddingBottom: 8 }}>
              <span>
                <span className="small muted" style={{ fontWeight: 700, marginRight: 8 }}>{x.kind}</span>
                <b>{x.label}</b>
              </span>
              <Segmented label={x.label} options={opts} value={conf[x.id]} onChange={(v) => setConf({ ...conf, [x.id]: v })} />
            </div>
          ))}
        </div>
      </fieldset>
    </Drawer>
  );
}

const HF_DEFAULT: Record<string, number> = { "renal-k": 7, "hf-clinic": 14, titration: 28, echo: 90, rehab: 7, education: 0 };

export function Discharge({ patientId, summary, contextId, onClose, onDone }: { patientId: string; summary: any; contextId: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const [review, setReview] = useState<{summary: any; evidenceKey: string} | null>(null);
  const [reviewChanged, setReviewChanged] = useState(false);
  const currentSummary = review?.summary ?? summary;
  const { data: jr } = useData<any>(`/patients/${patientId}/journey`);
  const hf = currentSummary.header.diagnoses.some((d: any) => /HF/.test(d.label));
  const [outcome, setOutcome] = useState<"alive" | "died">("alive");
  const [status, setStatus] = useState<string>("");
  const [destination, setDestination] = useState<string>("Home");
  const [events, setEvents] = useState<string[]>([]);
  const [cause, setCause] = useState<string>("");
  const [weight, setWeight] = useState<string>("");
  const [reuseClinicFollowUp, setReuseClinicFollowUp] = useState(true);
  const [handover, setHandover] = useState("");
  // an item already booked (open in the plan) is not preselected again — it would be a duplicate task
  const booked = (title: string, days = 14) => /^(HF )?clinic review$/i.test(title) ? existingClinicReview(currentSummary.plan ?? [], title, addDays(currentSummary.today, days), currentSummary.today) : (currentSummary.plan ?? []).find((p: any) => p.title === title && p.status === "planned");
  const [picked, setPicked] = useState<Record<string, number | string | null>>(() => {
    const base: Record<string, number | null> = hf ? { ...HF_DEFAULT } : { "hf-clinic": 14 };
    for (const id of Object.keys(base)) {
      const t = PLAN_TEMPLATES.find((x) => x.id === id);
      if (t && booked(t.title, base[id]!)) base[id] = null;
    }
    return base;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = currentSummary.today;
  const draftVersion = useRef(0);
  const pending = useRef<any>(null);
  const request = useRef<Promise<any> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseline = useRef("");
  const finished = useRef(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const payload = {outcome, status, destination, events, cause, weight, reuseClinicFollowUp, handover, picked, ...(review ? {evidenceKey: review.evidenceKey} : {})};
  const payloadKey = JSON.stringify(payload);
  function restoreDraft(d: any) {
    draftVersion.current = d.version;
    pending.current = null;
    if (d.handover !== undefined) {
      setOutcome(d.outcome); setStatus(d.status); setDestination(d.destination); setEvents(d.events); setCause(d.cause); setWeight(d.weight); setReuseClinicFollowUp(d.reuseClinicFollowUp); setHandover(d.handover); setPicked(d.picked);
      const {version, ...answers} = d;
      baseline.current = JSON.stringify({...payload, ...answers});
      setDraftSaved(true);
    } else baseline.current = payloadKey;
    setDraftLoaded(true);
  }
  async function flushDraft() {
    if (timer.current) clearTimeout(timer.current);
    await request.current;
    const body = pending.current;
    if (!body || finished.current) return;
    pending.current = null;
    const req = api(`/patients/${patientId}/admissions/${contextId}/draft`, {body: {...body, version: draftVersion.current}});
    request.current = req;
    try {const r = await req; draftVersion.current = r.version; baseline.current = JSON.stringify(body); setDraftSaved(!pending.current);}
    catch (e) {pending.current = body; throw e;}
    finally {request.current = null;}
    if (pending.current) await flushDraft();
  }
  useEffect(() => {
    let live = true;
    api(`/patients/${patientId}/discharge-review`).then(r => {if (live) setReview(r);}).catch(e => {if (live) setError(e.message);});
    api(`/patients/${patientId}/admissions/${contextId}/draft`).then(d => {if (live) restoreDraft(d);}).catch(e => {if (live) setError(`Draft could not be restored: ${e.message}`);});
    return () => {live = false;};
  }, [patientId, contextId]);
  useEffect(() => {
    if (!draftLoaded || finished.current || (payloadKey === baseline.current && !pending.current && !request.current)) return;
    pending.current = payload;
    setDraftSaved(false);
    timer.current = setTimeout(() => {void flushDraft().catch(e => setError(`Draft not saved: ${e.message}`));}, 300);
    return () => {if (timer.current) clearTimeout(timer.current);};
  }, [payloadKey, draftLoaded]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {if (pending.current || request.current) {e.preventDefault(); e.returnValue = "";}};
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const ctx = jr?.contexts.find((c: any) => c.id === contextId);
  async function closeDischarge() {
    if (busy) return;
    try {await flushDraft();}
    catch (e) {setError(`Draft not saved: ${(e as Error).message}`); if (!window.confirm("Close without saving the latest discharge edits?")) return;}
    onClose();
  }
  const meds = currentSummary.medications.groups.flatMap((g: any) => g.meds);
  async function save() {
    setBusy(true);
    try {
      await flushDraft();
      const latest = await api(`/patients/${patientId}/discharge-review`);
      if (!review || latest.evidenceKey !== review.evidenceKey) {
        const clinic = PLAN_TEMPLATES.find(t => t.id === "hf-clinic")!;
        if (reuseClinicFollowUp && picked["hf-clinic"] == null && booked(clinic.title) && !existingClinicReview(latest.summary.plan ?? [], clinic.title, addDays(latest.summary.today, status === "Still congested" ? 7 : 14), latest.summary.today)) setPicked(p => ({...p, "hf-clinic": status === "Still congested" ? 7 : 14}));
        setReview(latest); setReviewChanged(true); setError(""); setBusy(false); return;
      }
      const plan = Object.entries(picked)
        .filter(([, d]) => d != null)
        .map(([id, d]) => {
          const t = PLAN_TEMPLATES.find((x) => x.id === id)!;
          return { category: t.category, title: t.title, dueDate: typeof d === "string" ? d : addDays(today, d!), completesOn: t.completesOn };
        });
      const died = outcome === "died";
      const r = await api(`/patients/${patientId}/admissions/${contextId}/discharge`, {
        body: {
          endedAt: new Date().toISOString(), evidenceKey: review.evidenceKey, draftVersion: draftVersion.current, outcome, status: died ? "Died" : status, destination: died ? null : destination, events,
          causeGroup: died ? cause : null, dischargeWeight: !died && weight ? Number(weight) : null, plan: died ? [] : plan, reuseClinicFollowUp, handover,
        },
      });
      finished.current = true;
      onDone(died ? "Death in hospital recorded" : "Discharged · follow-up plan saved", r);
    } catch (e) {
      setError((e as Error).message);
      if ((e as any).status === 409 && (e as Error).message.includes("record changed")) {
        setError(""); setReviewChanged(true);
        void api(`/patients/${patientId}/discharge-review`).then(latest => {
          const clinic = PLAN_TEMPLATES.find(t => t.id === "hf-clinic")!;
          if (reuseClinicFollowUp && picked["hf-clinic"] == null && booked(clinic.title) && !existingClinicReview(latest.summary.plan ?? [], clinic.title, addDays(latest.summary.today, status === "Still congested" ? 7 : 14), latest.summary.today)) setPicked(p => ({...p,"hf-clinic":status === "Still congested" ? 7 : 14}));
          setReview(latest);
        }).catch(e => setError(e.message));
      }
      setBusy(false);
    }
  }
  return (
    <Drawer
      wide
      title="Discharge"
      subtitle={ctx ? `Admitted ${fmtDay(ctx.startedAt, { weekday: true })} · ${ctx.location ?? ""}` : "Review, reconcile, plan"}
      icon={<LogOut size={22} />}
      onClose={closeDischarge}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={closeDischarge}>Cancel</button>
          <button className="btn primary" disabled={!draftLoaded || !review || reviewChanged || (outcome === "alive" ? !status : !cause) || busy || (outcome === "alive" && Object.values(picked).some(d => d === ""))} onClick={save}>{busy ? "Saving…" : outcome === "died" ? "Record death" : "Confirm discharge"}</button>
        </span>
      }
    >
      <>
      {reviewChanged && <div className="infobox warn" role="alert" style={{flexWrap:"wrap",alignItems:"center",flexShrink:0}}><span style={{flex:"1 1 180px",minWidth:0}}>Record updated. Review results and bookings.</span><button className="btn secondary" onClick={() => {setReviewChanged(false); setError("");}} aria-label="Updated record reviewed">Reviewed</button></div>}
      <fieldset className="drawer-body" disabled={!draftLoaded || busy} style={{border:0,margin:0}}>
        <div className="help" role="status">{!draftLoaded ? "Restoring discharge draft…" : draftSaved ? "Draft saved" : "Changes are saved as a draft"}</div>
        <div className="row wrap" style={{ gap: 24, alignItems: "flex-end" }}>
          <div className="q">
            <div className="label" style={{ fontSize: 15 }}>Outcome</div>
            <Segmented label="Outcome" options={[{ value: "alive", label: "Discharged alive" }, { value: "died", label: "Died in hospital" }]} value={outcome} onChange={(v) => setOutcome(v as "alive" | "died")} />
          </div>
          {ctx && <span className="chip gray">Length of stay · {Math.max(0, daysBetween(ctx.startedAt, today))} days</span>}
          {ctx?.summary?.readmission && <span className="chip outline">Readmission after {ctx.summary.readmission.days} d ({ctx.summary.readmission.band})</span>}
        </div>
        <div className="q">
          <div className="label" style={{ fontSize: 15 }}>In-hospital events</div>
          <MultiChoice options={IN_HOSPITAL_EVENTS.map((e) => ({ value: e, label: e }))} value={events} onChange={(v) => setEvents(v.includes("None") && !events.includes("None") ? ["None"] : v.filter((x) => x !== "None"))} />
        </div>
        {outcome === "died" ? (
          <div className="q">
            <div className="label">Cause of death</div>
            <div className="help">Recording a death closes the admission, cancels open plan items and removes the patient from every reminder list.</div>
            <SingleChoice label="Cause of death" options={CAUSE_GROUPS} value={cause} onChange={setCause} />
          </div>
        ) : (
        <>
        <div className="q">
          <div className="label">Outstanding decisions & results</div>
          {(currentSummary.attention ?? []).filter((a: any) => a.severity === "red" || a.severity === "orange").map((a: any) => <div key={a.id}><SevChip sev={a.severity}>{a.title}</SevChip></div>)}
          {(currentSummary.plan ?? []).filter((p: any) => p.awaitingReview).map((p: any) => <div key={p.id} className="help">Result awaiting review · {p.title}</div>)}
          <label className="field">
            <span>Handover / outstanding issues <em className="muted" style={{ fontStyle: "normal" }}>(optional)</em></span>
            <textarea className="input" disabled={!draftLoaded} maxLength={4000} rows={3} value={handover} onChange={(e) => setHandover(e.target.value)} placeholder="Record how outstanding issues will be handled and by whom." />
          </label>
        </div>
        <div className="q">
          <div className="label">Condition at discharge</div>
          <SingleChoice label="Condition at discharge" options={DISCHARGE_CONDITION.map((s) => ({ value: s, label: s }))} value={status} onChange={(v) => { setStatus(v); if (v === "Still congested" && hf) setPicked((p) => ({ ...p, "hf-clinic": reuseClinicFollowUp && existingClinicReview(currentSummary.plan ?? [], "HF clinic review", addDays(currentSummary.today, 7), currentSummary.today) ? null : 7 })); }} />
          {status === "Still congested" && <div className="infobox warn">Residual congestion at discharge is high risk: the HF clinic review is moved to 7 days.</div>}
        </div>
        <div className="row wrap" style={{ gap: 24, alignItems: "flex-end" }}>
          <div className="q">
            <div className="label" style={{ fontSize: 15 }}>Discharged to</div>
            <SingleChoice label="Discharge destination" options={DISCHARGE_DESTINATION.map((s) => ({ value: s, label: s }))} value={destination} onChange={setDestination} />
          </div>
          <label className="field">
            <span>Discharge (dry) weight <em className="muted" style={{ fontStyle: "normal", fontWeight: 600 }}>(optional)</em></span>
            <span className="row">
              <input className="input num" style={{ width: 110 }} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ""))} />
              <b className="muted">kg</b>
            </span>
          </label>
        </div>
        <div className="q">
          <div className="label">Medication reconciliation</div>
          {ctx?.meds.length ? (
            <div className="col" style={{ gap: 6 }}>
              <span className="eyebrow">Changed during this admission</span>
              {ctx.meds.map((m: any, i: number) => (
                <div key={i} className="row">
                  <Tag sev={m.kind === "start" ? "green" : m.kind === "stop" ? "red" : "blue"}>{m.kind}</Tag>
                  <b>{m.name}</b>
                  <span className="muted small" style={{ fontWeight: 600 }}>{m.dose}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="help">No medication changes recorded during this admission.</div>
          )}
          <span className="eyebrow" style={{ marginTop: 8 }}>Discharge medications</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
            {meds.map((m: any) => (
              <div key={m.id} className="fact">
                <small>{m.drugClass}</small>
                <b>{m.name} {m.dose} {m.frequency}{m.status === "held" ? " · HELD" : ""}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="q">
          <div className="label">Follow-up plan</div>
          <div className="help">Each item becomes a dated task. Unfinished items carry forward to the next visit automatically.</div>
          {booked("HF clinic review", status === "Still congested" ? 7 : 14) && <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={reuseClinicFollowUp} onChange={(e) => {
              setReuseClinicFollowUp(e.target.checked);
              setPicked((p) => ({ ...p, "hf-clinic": e.target.checked ? null : status === "Still congested" ? 7 : 14 }));
            }} />
            Reuse the existing clinic booking (uncheck for a separate review)
          </label>}
          {PLAN_TEMPLATES.filter((t) => ["renal-k", "hf-clinic", "titration", "echo", "device", "rehab", "education", "lipids", "phone"].includes(t.id)).map((t) => {
            const on = picked[t.id] != null;
            return (
              <div key={t.id} className="row wrap" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line-2)", paddingBottom: 8 }}>
                <button type="button" className="choice" aria-pressed={on} onClick={() => setPicked({ ...picked, [t.id]: on ? null : t.offsets[0] })}>{t.title}</button>
                {!on && (() => { const existing = booked(t.title, status === "Still congested" && t.id === "hf-clinic" ? 7 : 14); return existing ? <span className="help">Already booked · {existing.title}{existing.dueDate ? ` · ${fmtDay(existing.dueDate, { weekday: true })}` : ""}</span> : null; })()}
                {on && (
                  <div className="col discharge-date">
                  <Segmented
                    label={`${t.title} date`}
                    options={[...new Set([...(HF_DEFAULT[t.id] != null ? [HF_DEFAULT[t.id]] : []), ...t.offsets])].sort((a, b) => a - b).map((d) => ({ value: String(d), label: fmtDay(addDays(today, d), { weekday: true }) }))}
                    value={String(picked[t.id])}
                    onChange={(v) => setPicked({ ...picked, [t.id]: Number(v) })}
                  />
                  <label className="manual-date"><span>Manual date</span><DateInput className="input" min={today} aria-label={`${t.title} exact date`} value={typeof picked[t.id] === "string" ? String(picked[t.id]) : addDays(today, Number(picked[t.id]))} onChange={e => setPicked(p => ({...p,[t.id]:e.target.value}))} /></label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>
        )}

      </fieldset>
        {error && <div className="error-box" role="alert">{error}<button className="btn secondary small" type="button" onClick={() => {if (!window.confirm("Replace this window’s discharge edits with the latest saved draft?")) return; if (timer.current) clearTimeout(timer.current); void api(`/patients/${patientId}/admissions/${contextId}/draft`).then(d => {restoreDraft(d); setError("");}).catch(e => setError(e.message));}}>Load saved discharge draft</button></div>}
      </>
    </Drawer>
  );
}

export function ClinicVisit({ patientId, summary, contextId, onClose, onDone, open, onStarted, active = true }: { patientId: string; summary: any; contextId?: string; active?: boolean; onClose(): void; onDone(m?: string, r?: any): void; open(o: Open): void; onStarted?(): void }) {
  const [narrative, setNarrative] = useState("");
  const [narrativeOpen,setNarrativeOpen] = useState(false);
  const [bpPairConfirmed,setBpPairConfirmed] = useState(false);
  const narrativeAtStart = useRef("");
  const narrativeInNote = useRef("");
  const [visitId, setVisitId] = useState<string | undefined>(contextId);
  const [step, setStep] = useState(contextId ? 1 : 0);
  // resuming an open visit keeps the reasons chosen when it was started
  const resumed = contextId && summary.header.openContext?.id === contextId ? summary.header.openContext : null;
  const [reasons, setReasons] = useState<string[]>(resumed?.reasons?.length ? resumed.reasons : summary.header.where.startsWith("Post-discharge") ? ["Heart failure", "Post-discharge"] : []);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [vit, setVit] = useState<Record<string, string>>({});
  const [nyha, setNyha] = useState<string>("");
  const [cong, setCong] = useState<string>("");
  // HF assessment (HF patients or an HF visit): KCCQ-12, 6-minute walk, dry (target) weight
  const [hfa, setHfa] = useState<Record<string, string>>({});
  const isHf = !!summary.hf || reasons.includes("Heart failure");
  const [note, setNote] = useState("");
  const [noteLoading, setNoteLoading] = useState(true);
  const generatedNote = useRef("");
  const [noteKey, setNoteKey] = useState("");
  const [freshNote, setFreshNote] = useState<{ text: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<any>(summary);
  const [measurementBaseline,setMeasurementBaseline]=useState<AssessmentAnswers["baseline"]>({});
  const [measurementValues,setMeasurementValues]=useState<AssessmentAnswers["baselineValues"]>({});
  const noteDraft = useEntryDraft(patientId, visitId ? `note:${visitId}` : null,
    {note,narrative,generatedNote:generatedNote.current,evidenceKey:noteKey}, (d,meta)=>{
      setNote(d.note ?? "");setNarrative(d.narrative ?? "");
      if(d.narrative) setNarrativeOpen(true);
      narrativeAtStart.current=meta?.originalNarrative ?? "";
      narrativeInNote.current=d.narrative ?? "";
      generatedNote.current=d.generatedNote ?? "";setNoteKey(d.evidenceKey ?? "");setFreshNote(null);setError("");
      if(meta?.resolution && step === 3) setStep(2);
    }, true, {path:visitId ? `/patients/${patientId}/contexts/${visitId}/draft` : null,flat:true});
  const draftLoaded=noteDraft.loaded;
  function discardVisit() {assessment.complete();noteDraft.complete();visitId ? onDone() : onClose();}
  function viewSavedVisit() {discardVisit();navigate(`/patients/${patientId}/visits`);}
  async function recoverVisitError(e:any, draft=noteDraft) {
    if(["visit_closed","visit_unavailable"].includes(e.code)) {setError("");await draft.refreshConflict("closed",e.message);}
    else if(["entry_draft_changed","visit_draft_changed"].includes(e.code)) {setError("");await draft.refreshConflict("draft");}
    else if(e.code === "assessment_changed") {setError("");await assessment.refreshConflict("record");}
    else setError(e.message);
  }
  useEffect(()=>setBpPairConfirmed(false),[vit.sbp,vit.dbp,measurementBaseline]);
  useEffect(() => {
    setNote(x => {
      if (!x || narrative === narrativeInNote.current) return x;
      const previous = narrativeInNote.current ? `Reviewed narrative:\n${narrativeInNote.current}` : "";
      narrativeInNote.current = narrative;
      const next = narrative ? `Reviewed narrative:\n${narrative}` : "";
      return previous && x.includes(previous) ? x.replace(previous, next) : [x, next].filter(Boolean).join("\n\n");
    });
  }, [narrative]);
  const [already, setAlready] = useState<string[]>([]);
  useEffect(() => {
    let current = true;
    if (step === 3 && visitId && draftLoaded && active) {
      setNoteLoading(true);
      api(`/patients/${patientId}/contexts/${visitId}/note`).then(n => {
        if (!current) return;
        let draft = n.text;
        if (narrativeAtStart.current) draft = draft.replace(`Reviewed narrative: ${narrativeAtStart.current}\n`, "");
        if (narrative) draft += `\n\nReviewed narrative:\n${narrative}`;
        narrativeInNote.current = narrative;
        if (!note || note === generatedNote.current) {
          generatedNote.current = draft; setNote(draft); setNoteKey(n.evidenceKey); setFreshNote(null);
        } else if (noteKey !== n.evidenceKey) setFreshNote({text: draft, key: n.evidenceKey});
      }).catch(e => setError(e.message)).finally(() => { if (current) setNoteLoading(false); });
    }
    if (step === 2 && active) api(`/patients/${patientId}/summary`).then(setLive).catch(e => setError(e.message));
    return () => { current = false; };
  }, [step, visitId, patientId, active, draftLoaded]);
  const assessment = useEntryDraft(patientId, visitId ? `assessment:${visitId}` : null, {vit,hfa,nyha,cong,baseline:measurementBaseline,baselineValues:measurementValues}, (d,meta) => {setVit(d.vit ?? {});setHfa(d.hfa ?? {});setNyha(d.nyha ?? "");setCong(d.cong ?? "");setMeasurementBaseline(d.baseline ?? {});setMeasurementValues(d.baselineValues ?? {});setAlready(Object.entries(meta?.latestAnswers?.baseline ?? {}).filter(([,id])=>!!id).map(([code])=>code));});
  const needsBpReview=bpPairNeedsReview({vit,hfa,nyha,cong,baselineValues:measurementValues});
  const previous = summary.plan;
  async function start() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/visits`, { body: { reasons, symptoms, narrative, service: reasons.includes("Heart failure") ? "HF clinic" : "Cardiology clinic" } });
      setVisitId(r.id);
      narrativeAtStart.current = narrative;
      setStep(1);
      onStarted?.();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  async function saveAssessment() {
    if (busy) return;
    setBusy(true);
    try {
      await assessment.flush();
      const items = [
        ...["sbp", "dbp", "hr", "weight"].filter((c) => vit[c]?.trim()).map((c) => ({ code: c, value: Number(vit[c]) })),
        ...(nyha ? [{ code: "nyha", text: nyha }] : []),
        ...(cong ? [{ code: "congestion", text: cong }] : []),
        ...(isHf ? ["kccq", "6mwd", "dry-weight"].filter((c) => hfa[c]?.trim()).map((c) => ({ code: c, value: Number(hfa[c]) })) : []),
      ];
      const r=await api(`/patients/${patientId}/visits/${visitId}/assessment`, {body:{items,baseline:measurementBaseline,draftVersion:assessment.getVersion(),confirmBpPair:bpPairConfirmed}});
      assessment.confirmed(r.answers,r.draftVersion);
      setStep(2);
    } catch (e) {
      await recoverVisitError(e,assessment);
    }
    setBusy(false);
  }
  async function finish() {
    setBusy(true);
    try {
      await noteDraft.flush();
      await assessment.flush();
      const r = await api(`/patients/${patientId}/visits/${visitId}/close`, { body: { note, narrative, evidenceKey: noteKey, draftVersion: noteDraft.getVersion() } });
      assessment.complete();
      noteDraft.complete();
      onDone("Visit closed · note saved", r);
    } catch (e) {
      await recoverVisitError(e);
      setBusy(false);
    }
  }
  const decisionCards = triage(live.attention.filter((a: any) => a.rule_id !== "ops.plan-due"));
  const steps = ["Since last review", "Assessment", "Decisions & plan", "Note"];
  return (
    <Drawer
      wide
      title={visitId ? "Clinic visit" : "Start clinic visit"}
      active={active}
      subtitle={`${summary.header.name} · ${summary.header.where}`}
      icon={<Stethoscope size={22} />}
      onClose={async () => {
        if (busy) return;
        if (assessment.conflict || noteDraft.conflict) {if(window.confirm("Close without saving this window’s edits? The saved draft will be kept.")) discardVisit(); return;}
        if (!visitId && narrative !== narrativeAtStart.current && !window.confirm("Discard this unstarted visit narrative?")) return;
        setBusy(true);
        try { await assessment.flush(); await noteDraft.flush(); visitId && step > 0 ? onDone() : onClose(); } catch(e) { await recoverVisitError(e); setBusy(false); }
      }}
      head={
        <ol className="steps" data-caption={`Step ${step + 1} of ${steps.length} · ${steps[step]}`} style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          {steps.map((t, i) => (
            <li key={t} className={i < step ? "done" : i === step ? "cur" : ""}>
              <i />
              {i + 1} · {t}
            </li>
          ))}
        </ol>
      }
      footer={
        <>
          {step > 1 && <button className="btn secondary" disabled={busy} onClick={() => setStep(step - 1)}>Back</button>}
          <span className="end">
            {step === 0 && <button className="btn primary" disabled={!reasons.length || busy} onClick={start}>Start visit</button>}
            {step === 1 && <button className="btn primary" disabled={busy || !assessment.loaded || !!assessment.conflict || !noteDraft.loaded || !!noteDraft.conflict || (needsBpReview && !bpPairConfirmed)} onClick={saveAssessment}>{assessment.loaded ? "Save and continue" : "Loading…"}</button>}
            {step === 2 && <button className="btn primary" disabled={busy} onClick={() => setStep(3)}>Continue to note</button>}
            {step === 3 && <button className="btn primary" disabled={busy || noteLoading || !!freshNote || !!noteDraft.conflict || !draftLoaded || !noteKey} onClick={finish}>Finish visit</button>}
          </span>
        </>
      }
    >
      <div className="drawer-body">
        <EntryDraftStatus draft={noteDraft} label="Visit note" savedLabel="Use newer saved note" onDiscard={discardVisit} onViewClosed={viewSavedVisit} />
        {noteDraft.conflict?.kind !== "closed" && <EntryDraftStatus draft={assessment} onDiscard={discardVisit} onViewClosed={viewSavedVisit} />}
        {step < 3 && !narrativeOpen && <button type="button" className="btn ghost small" onClick={()=>setNarrativeOpen(true)}>Add narrative</button>}
        {step < 3 && narrativeOpen && <label className="field"><span>Visit narrative</span><textarea aria-label="Visit narrative" disabled={!noteDraft.loaded || busy} className="input" rows={3} maxLength={4000} value={narrative} onChange={e => setNarrative(e.target.value)} /></label>}
        {step === 0 && (
          <>
            <div className="q">
              <div className="label">Since last review</div>
              <div className="plan-list">
                {previous.length === 0 && <div className="help">No earlier plan.</div>}
                {previous.map((p: any) => (
                  <div key={p.id} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line-2)", padding: "8px 0" }}>
                    <b>{p.title}</b>
                    <Tag sev={VIEW_SEV[p.view]}>{VIEW_LABEL(p, summary.today)}</Tag>
                  </div>
                ))}
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                {summary.changes.items.slice(0, 6).map((c: any, i: number) => (
                  <span key={i} className="chip outline">
                    {c.label}: {c.kind === "value" ? `${c.before} → ${c.after}` : c.text}
                  </span>
                ))}
              </div>
            </div>
            <div className="q">
              <div className="label">Reason for visit</div>
              <div className="help">Pick every problem addressed today. One visit produces one integrated plan.</div>
              <MultiChoice options={VISIT_REASONS.map((r) => ({ value: r, label: r }))} value={reasons} onChange={setReasons} />
            </div>
            <div className="q">
              <div className="label">Symptoms today</div>
              <MultiChoice options={SYMPTOMS.map((r) => ({ value: r, label: r }))} value={symptoms} onChange={(v) => setSymptoms(v.includes("No symptoms") && !symptoms.includes("No symptoms") ? ["No symptoms"] : v.filter((x) => x !== "No symptoms"))} />
            </div>
          </>
        )}
        {step === 1 && (
          <fieldset disabled={!assessment.loaded || busy} style={{border:0,margin:0,padding:0}}>
            <div className="q">
              <div className="label">Vital signs today</div>
              {["sbp", "dbp", "hr", "weight"].some((c) => already.includes(c)) && <div className="help">Values already recorded today are filled in; change one only if it is a new reading.</div>}
              <div className="row wrap" style={{ gap: 16 }}>
                {[["sbp", "Systolic BP", "mmHg"], ["dbp", "Diastolic BP", "mmHg"], ["hr", "Heart rate", "bpm"], ["weight", "Weight", "kg"]].map(([c, l, u]) => (
                  <label key={c} className="field">
                    <span>{l}</span>
                    <span className="row">
                      <input className="input num" style={{ width: 110 }} inputMode="decimal" value={vit[c] ?? ""} onChange={(e) => setVit({ ...vit, [c]: e.target.value })} />
                      <span className="muted small" style={{ fontWeight: 700 }}>{u}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {needsBpReview && <label className="infobox" style={{display:"flex",gap:10,alignItems:"center"}}><input type="checkbox" aria-label="Both BP values checked" checked={bpPairConfirmed} onChange={e=>setBpPairConfirmed(e.target.checked)} />New BP {vit.sbp}/{vit.dbp} mmHg · both values checked</label>}
            <div className="q">
              <div className="label">NYHA class</div>
              <Segmented label="NYHA class" options={FINDINGS.nyha.options.map((o) => ({ value: o, label: o }))} value={nyha} onChange={setNyha} />
            </div>
            <div className="q">
              <div className="label">Congestion</div>
              <Segmented label="Congestion" options={FINDINGS.congestion.options.map((o) => ({ value: o, label: o }))} value={cong} onChange={setCong} />
            </div>
            {isHf && (
              <div className="q">
                <div className="label">HF assessment <em className="muted" style={{ fontStyle: "normal", fontWeight: 600 }}>(optional)</em></div>
                <div className="row wrap" style={{ gap: 16 }}>
                  {[
                    ["kccq", "KCCQ-12 summary score", "/ 100", summary.hf?.kccq?.now],
                    ["6mwd", "6-minute walk", "m", summary.hf?.walk?.now],
                    ["dry-weight", "Dry (target) weight", "kg", summary.hf?.weight?.dry],
                  ].map(([c, l, u, last]: any) => (
                    <label key={c} className="field">
                      <span>{l}</span>
                      <span className="row">
                        <input className="input num" style={{ width: 110 }} inputMode="decimal" value={hfa[c] ?? ""} onChange={(e) => setHfa({ ...hfa, [c]: e.target.value.replace(/[^\d.]/g, "") })} />
                        <span className="muted small" style={{ fontWeight: 700 }}>{u}</span>
                      </span>
                      <em className="muted small" style={{ fontStyle: "normal" }}>{last ? `Last ${formatNumber(last.value, c === "dry-weight" ? 1 : 0)} · ${fmtDay(last.at)}` : "Not recorded before"}</em>
                    </label>
                  ))}
                </div>
                {hfa.kccq && Number(hfa.kccq) > 100 && <div className="infobox warn">The KCCQ-12 summary score runs from 0 to 100.</div>}
              </div>
            )}
          </fieldset>
        )}
        {step === 2 && (
          <>
            <div className="q">
              <div className="label">Needs a decision</div>
              {live.attention.length === 0 && <div className="help">Nothing open.</div>}
              {decisionCards.map((card, index) => (
                <details key={card.key} open={index < 3 || card.severity === "red"} className="col visit-dec" style={{ borderBottom: "1px solid var(--line-2)", paddingBottom: 10, gap: 8 }}>
                  <summary><SevChip sev={card.severity}>{card.title}</SevChip></summary>
                  {card.key.startsWith("wiz-") && <span className="help">Also covers: {card.items.filter((a) => a !== card.lead).map((a) => a.title).join(" · ")}</span>}
                  {(card.key.startsWith("wiz-") ? [card.lead] : card.items).map((a) => (
                  <span key={a.id} className={`alert sev-${a.severity}`} style={{ all: "unset" }}>
                    <ActionButton key={a.id} a={a} open={open} />
                  </span>
                  ))}
                  {card.note && <span className="help">{card.note}</span>}
                </details>
              ))}
              <div className="help">After saving or closing an action, you return here with your place and entries kept.</div>
            </div>
            <div className="q">
              <div className="label">Medications now</div>
              {(() => {
                const meds = (live.medications?.groups ?? []).flatMap((g: any) => g.meds);
                if (!meds.length) return <div className="help">No current medications recorded.</div>;
                return (
                  <div className="visit-meds">
                    {meds.map((m: any) => {
                      const today = !!m.startedAt && localDay(String(m.startedAt)) === live.today;
                      return (
                        <span key={m.id} className={`visit-med ${today ? "new" : ""}`}>
                          <b>{m.name}</b> {m.dose} {m.frequency}
                          {today && <em>started today</em>}
                          {m.status === "held" && <em>held</em>}
                        </span>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div className="q">
              <div className="label">Due tasks</div>
              {(live.plan ?? []).filter((p: any) => p.view !== "done" && p.dueDate <= live.today).map((p: any) => <div key={p.id} className="row wrap" style={{justifyContent:"space-between",padding:"8px 0"}}><span>{p.title}</span><button className="btn secondary small" onClick={() => open({kind:"plan-item",planId:p.id})}>Review task</button></div>)}
              <div className="row wrap">
                <button className="btn secondary" onClick={() => open({ kind: "plan-add" })}>Add plan item</button>
                <button className="btn secondary" onClick={() => open({ kind: "med-batch" })}>Add medicines</button>
                <button className="btn secondary" onClick={() => open({ kind: "labs" })}>Add labs</button>
              </div>
            </div>
          </>
        )}
        {step === 3 && (
          <div className="q">
            <div className="label row"><FileText size={18} /> Draft clinic note</div>
            <div className="help">Edit before finishing. {noteDraft.status}</div>
            {freshNote && <div className="infobox warn" role="alert" style={{display:"grid",gap:10}}>
              <b>Patient data changed. Review the note before finishing.</b>
              <details><summary>Latest generated note</summary><pre style={{whiteSpace:"pre-wrap"}}>{freshNote.text}</pre></details>
              <div className="row wrap">
                <button className="btn secondary" onClick={() => { if (!window.confirm("Replace your edits with the latest generated note?")) return; generatedNote.current = freshNote.text; setNote(freshNote.text); setNoteKey(freshNote.key); setFreshNote(null); }}>Use latest note</button>
                <button className="btn secondary" onClick={() => { setNoteKey(freshNote.key); setFreshNote(null); }}>I reviewed my edited note</button>
              </div>
            </div>}
            <textarea className="input" disabled={busy || noteLoading} aria-busy={noteLoading} placeholder={noteLoading ? "Preparing clinic note…" : undefined} rows={18} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={64000} aria-label="Clinic note" />
          </div>
        )}
        {error && !noteDraft.conflict && !assessment.conflict && <div className="error-box" role="alert">{error}</div>}
      </div>
    </Drawer>
  );
}
