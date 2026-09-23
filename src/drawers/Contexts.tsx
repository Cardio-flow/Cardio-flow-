import { useEffect, useState } from "react";
import { BedDouble, LogOut, Stethoscope, FileText } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, MultiChoice, Segmented, SevChip, Tag } from "../ui";
import { FINDINGS, PLAN_TEMPLATES } from "../../shared/catalog";
import { addDays, fmtDay } from "../../shared/clinical";
import { ActionButton } from "../screens/Summary";
import { VIEW_LABEL, VIEW_SEV } from "../screens/Summary";
import type { Open } from "../screens/Patient";

const ADMIT_REASONS = ["Acute decompensated HF", "ACS", "Chest pain", "Arrhythmia", "Syncope", "Valve disease", "Post-procedure", "Other"];
const LOCATIONS = ["CCU", "Ward 3A", "Ward 3B", "Step-down"];

export function Admission({ patientId, summary, onClose, onDone }: { patientId: string; summary: any; onClose(): void; onDone(m?: string, r?: any): void }) {
  const [reasons, setReasons] = useState<string[]>([]);
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
        <div className="q">
          <div className="label">Reason for admission</div>
          <MultiChoice options={ADMIT_REASONS.map((r) => ({ value: r, label: r }))} value={reasons} onChange={setReasons} />
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

const DISCHARGE_STATUS = ["Euvolaemic", "Stable, pain-free", "Improved", "Rate controlled", "Other"];
const HF_DEFAULT: Record<string, number> = { "renal-k": 7, "hf-clinic": 14, titration: 28, echo: 90, rehab: 7, education: 0 };

export function Discharge({ patientId, summary, contextId, onClose, onDone }: { patientId: string; summary: any; contextId: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data: jr } = useData<any>(`/patients/${patientId}/journey`);
  const hf = summary.header.diagnoses.some((d: any) => /HF/.test(d.label));
  const [status, setStatus] = useState<string>("");
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
      const r = await api(`/patients/${patientId}/admissions/${contextId}/discharge`, { body: { endedAt: new Date().toISOString(), status, plan } });
      onDone(`Discharged · ${plan.length} plan actions created`, r);
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
          <button className="btn primary" disabled={!status || busy} onClick={save}>{busy ? "Saving…" : "Confirm discharge"}</button>
        </span>
      }
    >
      <div className="drawer-body">
        <div className="q">
          <div className="label">Status at discharge</div>
          <Segmented label="Status at discharge" options={DISCHARGE_STATUS.map((s) => ({ value: s, label: s }))} value={status} onChange={setStatus} />
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
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

const VISIT_REASONS = ["Heart failure", "Post-discharge", "Medication titration", "Post-ACS", "Post-PCI", "Valve", "Arrhythmia", "Device", "Routine cardiology"];

export function ClinicVisit({ patientId, summary, contextId, onClose, onDone, open }: { patientId: string; summary: any; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void; open(o: Open): void }) {
  const [visitId, setVisitId] = useState<string | undefined>(contextId);
  const [step, setStep] = useState(contextId ? 1 : 0);
  const [reasons, setReasons] = useState<string[]>(summary.header.where.startsWith("Post-discharge") ? ["Heart failure", "Post-discharge"] : []);
  const [vit, setVit] = useState<Record<string, string>>({});
  const [nyha, setNyha] = useState<string>("");
  const [cong, setCong] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<any>(summary);
  useEffect(() => {
    if (step === 3 && visitId) api(`/patients/${patientId}/contexts/${visitId}/note`).then((n) => setNote(n.text));
    if (step === 2) api(`/patients/${patientId}/summary`).then(setLive);
  }, [step, visitId, patientId]);
  const previous = summary.plan;
  async function start() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/visits`, { body: { reasons, service: reasons.includes("Heart failure") ? "HF clinic" : "Cardiology clinic" } });
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
      ];
      if (items.length) await api(`/patients/${patientId}/observations`, { body: { effectiveAt: new Date().toISOString(), contextId: visitId, items } });
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
        <ol className="steps" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
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
          </>
        )}
        {step === 1 && (
          <>
            <div className="q">
              <div className="label">Vital signs today</div>
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
          </>
        )}
        {step === 2 && (
          <>
            <div className="q">
              <div className="label">Needs a decision</div>
              {live.attention.length === 0 && <div className="help">Nothing open.</div>}
              {live.attention.map((a: any) => (
                <div key={a.id} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line-2)", paddingBottom: 10 }}>
                  <SevChip sev={a.severity}>{a.title}</SevChip>
                  <span className={`alert sev-${a.severity}`} style={{ all: "unset" }}>
                    <ActionButton a={a} open={open} />
                  </span>
                </div>
              ))}
              <div className="help">Opening a decision keeps this visit open. Return with “Continue visit”.</div>
            </div>
            <div className="q">
              <div className="label">Plan</div>
              <div className="row wrap">
                <button className="btn secondary" onClick={() => open({ kind: "plan-add" })}>Add plan item</button>
                <button className="btn secondary" onClick={() => open({ kind: "med-add" })}>Start a medication</button>
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
