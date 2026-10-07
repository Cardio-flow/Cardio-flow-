import { useEffect, useRef, useState } from "react";
import { BedDouble, LogOut, Stethoscope, FileText } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, MultiChoice, Segmented, SevChip, SingleChoice, Tag } from "../ui";
import { ADMISSION_REASONS, ADMISSION_ROUTES, CAUSE_GROUPS, DISCHARGE_CONDITION, DISCHARGE_DESTINATION, HF_REASONS, IN_HOSPITAL_EVENTS, SYMPTOMS, readmissionBand } from "../../shared/encounters";
import { FINDINGS, PLAN_TEMPLATES, formatNumber } from "../../shared/catalog";
import { addDays, daysBetween, fmtDay } from "../../shared/clinical";
import { ActionButton } from "../screens/Summary";
import { VIEW_LABEL, VIEW_SEV } from "../screens/Summary";
import type { Open } from "../screens/Patient";

const LOCATIONS = ["CCU", "Ward 3A", "Ward 3B", "Step-down"];

export function Admission({ patientId, summary, onClose, onDone }: { patientId: string; summary: any; onClose(): void; onDone(m?: string, r?: any): void }) {
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
  async function save() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/admissions`, {
        body: {
          startedAt: new Date().toISOString(),
          location: bed ? `${loc} · Bed ${bed}` : loc,
          reasons,
          route,
          symptoms,
          hfRelated,
          confirmations: [
            ...summary.header.diagnoses.map((d: any) => ({ kind: "condition", id: d.id, answer: conf[d.id] })),
            ...meds.map((m: any) => ({ kind: "medication", id: m.id, answer: conf[m.id] })),
          ],
        },
      });
      onDone("Admission started", r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const opts = [{ value: "unchanged", label: "Confirmed" }, { value: "changed", label: "Changed" }, { value: "unknown", label: "Unknown today" }];
  return (
    <Drawer
      title="Start admission"
      subtitle="Known history is brought forward for confirmation, never copied as today's data"
      icon={<BedDouble size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!reasons.length || busy} onClick={save}>{busy ? "Saving…" : "Admit"}</button>
        </span>
      }
    >
      <div className="drawer-body">
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
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

const HF_DEFAULT: Record<string, number> = { "renal-k": 7, "hf-clinic": 14, titration: 28, echo: 90, rehab: 7, education: 0 };

export function Discharge({ patientId, summary, contextId, onClose, onDone }: { patientId: string; summary: any; contextId: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data: jr } = useData<any>(`/patients/${patientId}/journey`);
  const hf = summary.header.diagnoses.some((d: any) => /HF/.test(d.label));
  const [outcome, setOutcome] = useState<"alive" | "died">("alive");
  const [status, setStatus] = useState<string>("");
  const [destination, setDestination] = useState<string>("Home");
  const [events, setEvents] = useState<string[]>([]);
  const [cause, setCause] = useState<string>("");
  const [weight, setWeight] = useState<string>("");
  const [picked, setPicked] = useState<Record<string, number | null>>(() => (hf ? { ...HF_DEFAULT } : { "hf-clinic": 14 }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = summary.today;
  const ctx = jr?.contexts.find((c: any) => c.id === contextId);
  const meds = summary.medications.groups.flatMap((g: any) => g.meds);
  async function save() {
    setBusy(true);
    try {
      const plan = Object.entries(picked)
        .filter(([, d]) => d != null)
        .map(([id, d]) => {
          const t = PLAN_TEMPLATES.find((x) => x.id === id)!;
          return { category: t.category, title: t.title, dueDate: addDays(today, d!), completesOn: t.completesOn };
        });
      const died = outcome === "died";
      const r = await api(`/patients/${patientId}/admissions/${contextId}/discharge`, {
        body: {
          endedAt: new Date().toISOString(), outcome, status: died ? "Died" : status, destination: died ? null : destination, events,
          causeGroup: died ? cause : null, dischargeWeight: !died && weight ? Number(weight) : null, plan: died ? [] : plan,
        },
      });
      onDone(died ? "Death in hospital recorded" : `Discharged · ${plan.length} plan actions created`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      wide
      title="Discharge"
      subtitle={ctx ? `Admitted ${fmtDay(ctx.startedAt, { weekday: true })} · ${ctx.location ?? ""}` : "Review, reconcile, plan"}
      icon={<LogOut size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={(outcome === "alive" ? !status : !cause) || busy} onClick={save}>{busy ? "Saving…" : outcome === "died" ? "Record death" : "Confirm discharge"}</button>
        </span>
      }
    >
      <div className="drawer-body">
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
          <div className="label">Condition at discharge</div>
          <SingleChoice label="Condition at discharge" options={DISCHARGE_CONDITION.map((s) => ({ value: s, label: s }))} value={status} onChange={(v) => { setStatus(v); if (v === "Still congested" && hf) setPicked((p) => ({ ...p, "hf-clinic": 7 })); }} />
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
          {PLAN_TEMPLATES.filter((t) => ["renal-k", "hf-clinic", "titration", "echo", "device", "rehab", "education", "lipids", "phone"].includes(t.id)).map((t) => {
            const on = picked[t.id] != null;
            return (
              <div key={t.id} className="row wrap" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line-2)", paddingBottom: 8 }}>
                <button type="button" className="choice" aria-pressed={on} onClick={() => setPicked({ ...picked, [t.id]: on ? null : t.offsets[0] })}>{t.title}</button>
                {on && (
                  <Segmented
                    label={`${t.title} date`}
                    options={[...new Set([...(HF_DEFAULT[t.id] != null ? [HF_DEFAULT[t.id]] : []), ...t.offsets])].sort((a, b) => a - b).map((d) => ({ value: String(d), label: fmtDay(addDays(today, d), { weekday: true }) }))}
                    value={String(picked[t.id])}
                    onChange={(v) => setPicked({ ...picked, [t.id]: Number(v) })}
                  />
                )}
              </div>
            );
          })}
        </div>
        </>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

const VISIT_REASONS = ["Heart failure", "Post-discharge", "Medication titration", "Post-ACS", "Post-PCI", "Valve", "Prosthetic valve problem", "Arrhythmia", "Device", "ICD shock", "Pre-operative assessment", "Chest pain", "Bleeding", "Chest infection", "Myocarditis", "Pericarditis", "Routine cardiology"];

export function ClinicVisit({ patientId, summary, contextId, onClose, onDone, open }: { patientId: string; summary: any; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void; open(o: Open): void }) {
  const [visitId, setVisitId] = useState<string | undefined>(contextId);
  const [step, setStep] = useState(contextId ? 1 : 0);
  const [reasons, setReasons] = useState<string[]>(summary.header.where.startsWith("Post-discharge") ? ["Heart failure", "Post-discharge"] : []);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [vit, setVit] = useState<Record<string, string>>({});
  const [nyha, setNyha] = useState<string>("");
  const [cong, setCong] = useState<string>("");
  // HF assessment (HF patients or an HF visit): KCCQ-12, 6-minute walk, dry (target) weight
  const [hfa, setHfa] = useState<Record<string, string>>({});
  const isHf = !!summary.hf || reasons.includes("Heart failure");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<any>(summary);
  const savedRef = useRef<Record<string, string>>({});
  const [already, setAlready] = useState<string[]>([]);
  // values already recorded today (an earlier part of this visit, quick labs, a reading at the desk): shown
  // filled in and marked, and not recorded again unless changed
  useEffect(() => {
    api(`/patients/${patientId}/record`).then((r) => {
      const t = r.todayValues ?? {};
      const num = (c: string) => (t[c]?.value != null ? String(t[c].value) : undefined);
      const v: Record<string, string> = {};
      for (const c of ["sbp", "dbp", "hr", "weight"]) if (num(c)) v[c] = num(c)!;
      const h: Record<string, string> = {};
      for (const c of ["kccq", "6mwd", "dry-weight"]) if (num(c)) h[c] = num(c)!;
      setVit((x) => ({ ...v, ...x }));
      setHfa((x) => ({ ...h, ...x }));
      if (t.nyha?.text) setNyha((x) => x || t.nyha.text);
      if (t.congestion?.text) setCong((x) => x || t.congestion.text);
      for (const [c, val] of Object.entries(v)) savedRef.current[c] = JSON.stringify({ code: c, value: Number(val) });
      for (const [c, val] of Object.entries(h)) savedRef.current[c] = JSON.stringify({ code: c, value: Number(val) });
      if (t.nyha?.text) savedRef.current.nyha = JSON.stringify({ code: "nyha", text: t.nyha.text });
      if (t.congestion?.text) savedRef.current.congestion = JSON.stringify({ code: "congestion", text: t.congestion.text });
      setAlready(Object.keys(t));
    }).catch(() => {});
  }, [patientId]);
  useEffect(() => {
    if (step === 3 && visitId) api(`/patients/${patientId}/contexts/${visitId}/note`).then((n) => setNote(n.text));
    if (step === 2) api(`/patients/${patientId}/summary`).then(setLive);
  }, [step, visitId, patientId]);
  const previous = summary.plan;
  async function start() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/visits`, { body: { reasons, symptoms, service: reasons.includes("Heart failure") ? "HF clinic" : "Cardiology clinic" } });
      setVisitId(r.id);
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  async function saveAssessment() {
    setBusy(true);
    try {
      const items = [
        ...["sbp", "dbp", "hr", "weight"].filter((c) => vit[c]?.trim()).map((c) => ({ code: c, value: Number(vit[c]) })),
        ...(nyha ? [{ code: "nyha", text: nyha }] : []),
        ...(cong ? [{ code: "congestion", text: cong }] : []),
        ...(isHf ? ["kccq", "6mwd", "dry-weight"].filter((c) => hfa[c]?.trim()).map((c) => ({ code: c, value: Number(hfa[c]) })) : []),
      ];
      // going Back and saving again records only what changed since the last save (no duplicate vitals)
      const fresh = items.filter((i: any) => savedRef.current[i.code] !== JSON.stringify(i));
      if (fresh.length) await api(`/patients/${patientId}/observations`, { body: { effectiveAt: new Date().toISOString(), contextId: visitId, items: fresh } });
      for (const i of fresh) savedRef.current[i.code] = JSON.stringify(i);
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  async function finish() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/visits/${visitId}/close`, { body: { note } });
      onDone("Visit closed · note saved", r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const steps = ["Since last review", "Assessment", "Decisions & plan", "Note"];
  return (
    <Drawer
      wide
      title={visitId ? "Clinic visit" : "Start clinic visit"}
      subtitle={`${summary.header.name} · ${summary.header.where}`}
      icon={<Stethoscope size={22} />}
      onClose={() => (visitId && step > 0 ? onDone() : onClose())}
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
          {step > 1 && <button className="btn secondary" onClick={() => setStep(step - 1)}>Back</button>}
          <span className="end">
            {step === 0 && <button className="btn primary" disabled={!reasons.length || busy} onClick={start}>Start visit</button>}
            {step === 1 && <button className="btn primary" disabled={busy} onClick={saveAssessment}>Save and continue</button>}
            {step === 2 && <button className="btn primary" onClick={() => setStep(3)}>Continue to note</button>}
            {step === 3 && <button className="btn primary" disabled={busy} onClick={finish}>Finish visit</button>}
          </span>
        </>
      }
    >
      <div className="drawer-body">
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
          <>
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
          </>
        )}
        {step === 2 && (
          <>
            <div className="q">
              <div className="label">Needs a decision</div>
              {live.attention.length === 0 && <div className="help">Nothing open.</div>}
              {live.attention.map((a: any) => (
                <div key={a.id} className="row wrap visit-dec" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line-2)", paddingBottom: 10, gap: 8 }}>
                  <SevChip sev={a.severity}>{a.title}</SevChip>
                  <span className={`alert sev-${a.severity}`} style={{ all: "unset" }}>
                    <ActionButton a={a} open={open} />
                  </span>
                </div>
              ))}
              <div className="help">Opening a decision keeps this visit open. Return with “Continue visit”.</div>
            </div>
            <div className="q">
              <div className="label">Medications now</div>
              {(() => {
                const meds = (live.medications?.groups ?? []).flatMap((g: any) => g.meds);
                if (!meds.length) return <div className="help">No current medications recorded.</div>;
                return (
                  <div className="visit-meds">
                    {meds.map((m: any) => {
                      const today = String(m.startedAt ?? "").slice(0, 10) === live.today;
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
              <div className="label">Plan</div>
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
            <div className="help">Generated from what you selected. Edit freely before finishing.</div>
            <textarea className="input" rows={18} style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Clinic note" />
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}
