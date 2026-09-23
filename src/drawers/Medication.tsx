import { useMemo, useState } from "react";
import { Pill, Search, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, SingleChoice, Segmented, Tag } from "../ui";
import { DIAGNOSIS, MEASURES, MEDICATION, MEDICATIONS, PURPOSE_FOR_TAG, PURPOSE_ORDER, doseLabel, formatNumber, type MedicationDef } from "../../shared/catalog";
import { addDays, flagFor, fmtDay } from "../../shared/clinical";

function patientTags(summary: any) {
  return new Set<string>(summary.header.diagnoses.flatMap((d: any) => DIAGNOSIS[d.code]?.tags ?? []));
}

export function AddMedication({ patientId, summary, contextId, onClose, onDone }: { patientId: string; summary: any; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data: rec } = useData<any>(`/patients/${patientId}/record`);
  const tags = patientTags(summary);
  const active = new Set<string>(summary.medications.groups.flatMap((g: any) => g.meds.map((m: any) => m.code)));
  const relevant = PURPOSE_ORDER.filter((p) => [...tags].some((t) => PURPOSE_FOR_TAG[t]?.includes(p)));
  const [q, setQ] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const def = code ? MEDICATION[code] : null;
  const [dose, setDose] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [freq, setFreq] = useState<string>("");
  const [route, setRoute] = useState<string>("");
  const [indication, setIndication] = useState<string>("");
  const [monitor, setMonitor] = useState<string>("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = rec?.today ?? summary.today;
  const pick = (d: MedicationDef) => {
    setCode(d.code);
    setDose(d.doses.length ? String(d.doses[0]) : "custom");
    setFreq(d.frequencies[0]);
    setRoute(d.routes[0]);
    const matching = d.indications.filter((t) => tags.has(t));
    setIndication(matching.length === 1 ? matching[0] : "");
    setMonitor(d.monitoring.some((c) => c === "potassium" || c === "creatinine") ? "7" : "none");
  };
  const matches = useMemo(() => MEDICATIONS.filter((m) => !active.has(m.code) && (m.name + " " + m.drugClass).toLowerCase().includes(q.toLowerCase())), [q]);
  const indicationOptions = def
    ? [
        ...[...new Set(def.indications.filter((t) => tags.has(t)))].map((t) => ({ value: t, label: tagLabel(t, summary) })),
        ...summary.header.diagnoses.filter((d: any) => !def.indications.some((t) => DIAGNOSIS[d.code]?.tags.includes(t))).slice(0, 4).map((d: any) => ({ value: "dx:" + d.code, label: d.label })),
        { value: "other", label: "Other indication" },
      ]
    : [];
  const autoIndication = def && def.indications.filter((t) => tags.has(t)).length === 1;
  const doseValue = dose === "custom" ? Number(custom) : Number(dose);
  const renalK = def?.monitoring.some((c) => c === "potassium" || c === "creatinine");
  async function save() {
    if (!def) return;
    setBusy(true);
    setError("");
    try {
      const r = await api(`/patients/${patientId}/medications`, {
        body: {
          code: def.code, doseValue: Number.isFinite(doseValue) && doseValue > 0 ? doseValue : null, frequency: freq, route,
          indication: indication || "unspecified", contextId: contextId ?? null,
          monitoring: renalK && monitor !== "none" ? { dueDate: addDays(today, Number(monitor)), title: "Renal function and potassium check", codes: ["potassium", "creatinine"] } : null,
        },
      });
      onDone(`${def.name} started${renalK && monitor !== "none" ? ` · check booked ${fmtDay(addDays(today, Number(monitor)), { weekday: true })}` : ""}`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const valid = def && freq && route && indication && (dose !== "custom" || Number(custom) > 0);
  return (
    <Drawer
      wide
      title={def ? `Start ${def.name}` : "Add medication"}
      subtitle={def ? `${def.drugClass} · ${def.purpose}` : "Medications relevant to this patient are shown first"}
      icon={<Pill size={22} />}
      onClose={onClose}
      footer={
        <>
          {def && <button className="btn ghost" onClick={() => setCode(null)}>Choose another</button>}
          <span className="end">
            <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : "Confirm"}</button>
          </span>
        </>
      }
    >
      <div className="drawer-body">
        {!def ? (
          <>
            <label className="row" style={{ height: 46, padding: "0 14px", border: "1px solid var(--control)", borderRadius: 12 }}>
              <Search size={18} color="var(--ink-4)" />
              <input autoFocus className="grow" style={{ border: 0, outline: "none" }} placeholder="Search all medications" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search medications" />
            </label>
            <div className="combo-list" style={{ maxHeight: "none" }}>
              {(q ? ["Search results"] : [...relevant.map((r) => "Relevant · " + r), ...PURPOSE_ORDER.filter((p) => !relevant.includes(p))]).map((title) => {
                const purpose = title.replace("Relevant · ", "");
                const items = q ? matches : matches.filter((m) => m.purpose === purpose);
                if (!items.length) return null;
                return (
                  <div key={title}>
                    <div className="group-title">{title}</div>
                    {items.map((m) => (
                      <button key={m.code} onClick={() => pick(m)}>
                        <span className="col grow" style={{ gap: 0 }}>
                          <b>{m.name}</b>
                          <span className="small muted" style={{ fontWeight: 600 }}>{m.drugClass}</span>
                        </span>
                        {m.indications.some((t) => tags.has(t)) && <Tag sev="blue">Relevant</Tag>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="q">
              <div className="label">Indication</div>
              {autoIndication ? (
                <div className="row">
                  <span className="chip dx">{tagLabel(indication, summary)}</span>
                  <span className="small muted" style={{ fontWeight: 600 }}>Set from the patient's diagnoses</span>
                  <button className="btn ghost small" onClick={() => setIndication("")}>Change</button>
                </div>
              ) : (
                <>
                  {!def.indications.some((t) => tags.has(t)) && <div className="help" style={{ color: "var(--orange-ink)", fontWeight: 700 }}>This medication does not match a recorded diagnosis. Choose the indication.</div>}
                  <SingleChoice label="Indication" options={indicationOptions} value={indication} onChange={setIndication} />
                </>
              )}
            </div>
            <div className="q">
              <div className="label">Dose</div>
              <div className="choices" role="radiogroup" aria-label="Dose">
                {def.doses.map((d) => (
                  <button key={d} type="button" role="radio" className="choice" aria-checked={dose === String(d)} onClick={() => setDose(String(d))}>
                    {doseLabel(def, d)}
                  </button>
                ))}
                <button type="button" role="radio" className="choice" aria-checked={dose === "custom"} onClick={() => setDose("custom")}>Custom</button>
                {dose === "custom" && (
                  <label className="row">
                    <input className="input num" inputMode="decimal" autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom dose" />
                    <span className="muted" style={{ fontWeight: 700 }}>{def.unit}</span>
                  </label>
                )}
              </div>
              <div className="help">Dose options are label strengths (catalogue draft, pending pharmacist review). CardioFlow never chooses a dose for you.</div>
            </div>
            <div className="row wrap" style={{ gap: 28 }}>
              <div className="q">
                <div className="label">Frequency</div>
                <Segmented label="Frequency" options={def.frequencies.map((f) => ({ value: f, label: f }))} value={freq} onChange={setFreq} />
              </div>
              <div className="q">
                <div className="label">Route</div>
                <Segmented label="Route" options={def.routes.map((r) => ({ value: r, label: r }))} value={route} onChange={setRoute} />
              </div>
            </div>
            <PreStart def={def} rec={rec} summary={summary} />
            {renalK && (
              <div className="q">
                <div className="label">Monitoring</div>
                <div className="help">Book a renal function and potassium check. It becomes a task that closes itself when the result arrives.</div>
                <Segmented
                  label="Monitoring"
                  options={[{ value: "7", label: `1 week · ${fmtDay(addDays(today, 7))}` }, { value: "14", label: `2 weeks · ${fmtDay(addDays(today, 14))}` }, { value: "none", label: "Not now" }]}
                  value={monitor}
                  onChange={setMonitor}
                />
              </div>
            )}
            {error && <div className="error-box">{error}</div>}
          </>
        )}
      </div>
    </Drawer>
  );
}

function tagLabel(t: string, summary: any) {
  if (t.startsWith("dx:")) return DIAGNOSIS[t.slice(3)]?.display ?? t;
  const dx = summary.header.diagnoses.find((d: any) => DIAGNOSIS[d.code]?.tags.includes(t));
  return dx?.label ?? { hf: "Heart failure", cad: "Coronary disease", af: "Atrial fibrillation", htn: "Hypertension", dm: "Diabetes", ckd: "CKD", lipids: "Dyslipidaemia" }[t] ?? t;
}

function PreStart({ def, rec, summary }: { def: MedicationDef; rec: any; summary: any }) {
  const items = def.monitoring.map((code) => {
    const r = rec?.results.find((x: any) => x.code === code) ?? rec?.vitals.find((x: any) => x.code === code);
    const m = MEASURES[code];
    if (!r) return { code, label: m?.display ?? code, missing: true };
    const flag = flagFor(r.current.value, m?.ref);
    return { code, label: m?.display ?? code, value: `${formatNumber(r.current.value, m?.decimals ?? 0)} ${m?.unit ?? ""}`, at: r.current.at, flag };
  });
  const missing = items.filter((i) => i.missing);
  return (
    <div className="q">
      <div className="label">Pre-start check</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
        {items.map((i) => (
          <div key={i.code} className="fact" style={{ background: i.missing ? "var(--orange-soft)" : i.flag ? "var(--red-soft)" : undefined }}>
            <small>{i.label}{i.at ? ` · ${fmtDay(i.at)}` : ""}</small>
            <b style={{ color: i.missing ? "var(--orange-ink)" : i.flag ? "var(--red-ink)" : undefined }}>{i.missing ? "Not available" : i.value}</b>
          </div>
        ))}
        <div className="fact">
          <small>Allergies</small>
          <b>{summary.header.allergies}</b>
        </div>
      </div>
      {missing.length > 0 ? (
        <div className="row small" style={{ fontWeight: 700, color: "var(--orange-ink)" }}>
          <AlertTriangle size={16} /> Safety assessment incomplete: {missing.map((m) => m.label.toLowerCase()).join(", ")} unavailable. Not assumed normal.
        </div>
      ) : (
        <div className="row small" style={{ fontWeight: 700, color: "var(--green-ink)" }}>
          <CheckCircle2 size={16} /> Required values are available. Review them before confirming.
        </div>
      )}
    </div>
  );
}

const ACTIONS = [
  { value: "increase", label: "Increase dose" },
  { value: "decrease", label: "Reduce dose" },
  { value: "hold", label: "Hold" },
  { value: "stop", label: "Stop" },
  { value: "continue", label: "Continue unchanged" },
];

export function MedicationAction({ patientId, summary, medId, initial, contextId, onClose, onDone }: { patientId: string; summary: any; medId: string; initial?: string; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const med = summary.medications.groups.flatMap((g: any) => g.meds).find((m: any) => m.id === medId);
  const { data: rec } = useData<any>(`/patients/${patientId}/record`);
  const def = med ? MEDICATION[med.code] : null;
  const [action, setAction] = useState<string>(initial ?? (med?.status === "held" ? "restart" : ""));
  const [dose, setDose] = useState<string>("");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!med || !def) return null;
  const doses = def.doses.filter((d) => (action === "increase" ? med.doseValue == null || d > med.doseValue : action === "decrease" ? med.doseValue == null || d < med.doseValue : true));
  const today = summary.today;
  const renalK = def.monitoring.some((c) => c === "potassium" || c === "creatinine");
  const history = rec?.meds.find((m: any) => m.id === medId)?.events ?? [];
  const actions = med.status === "held" ? [{ value: "restart", label: "Restart" }, { value: "stop", label: "Stop" }] : ACTIONS;
  async function save() {
    setBusy(true);
    setError("");
    try {
      const reviewBody =
        review === "none" ? null
        : review.startsWith("lab") ? { dueDate: addDays(today, Number(review.split("-")[1])), title: "Renal function and potassium check", codes: ["potassium", "creatinine"] }
        : { dueDate: addDays(today, Number(review.split("-")[1])), title: `${def!.name} titration review` };
      const r = await api(`/patients/${patientId}/medications/${medId}/events`, {
        body: { kind: action, doseValue: dose ? Number(dose) : null, reason, contextId: contextId ?? null, review: reviewBody },
      });
      onDone(`${def!.name}: ${ACTIONS.find((a) => a.value === action)?.label.toLowerCase() ?? action} recorded`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const needsDose = action === "increase" || action === "decrease";
  return (
    <Drawer
      title={def.name}
      subtitle={`${med.dose} · ${med.frequency}${med.status === "held" ? " · currently held" : ""}`}
      icon={<Pill size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!action || busy || (needsDose && !dose)} onClick={save}>{busy ? "Saving…" : "Confirm"}</button>
        </span>
      }
    >
      <div className="drawer-body">
        <div className="q">
          <div className="label">What do you want to do?</div>
          <SingleChoice label="Medication action" options={actions} value={action} onChange={(v) => (setAction(v), setDose(""), setReview(v === "increase" && renalK ? "lab-7" : "none"))} />
        </div>
        {needsDose && (
          <div className="q">
            <div className="label">New dose</div>
            {doses.length ? (
              <SingleChoice label="New dose" options={doses.map((d) => ({ value: String(d), label: doseLabel(def, d) }))} value={dose} onChange={setDose} />
            ) : (
              <div className="infobox">No {action === "increase" ? "higher" : "lower"} catalogue strength. Current dose is at the end of the listed range.</div>
            )}
          </div>
        )}
        {action && action !== "continue" && (
          <div className="q">
            <div className="label">Reason</div>
            <SingleChoice
              label="Reason"
              options={(action === "increase" ? ["Titration toward target", "Symptoms not controlled"] : action === "decrease" ? ["Hyperkalaemia", "Renal function", "Hypotension", "Bradycardia", "Side effect"] : action === "hold" ? ["Hyperkalaemia", "Acute kidney injury", "Hypotension", "Procedure", "Intercurrent illness"] : action === "stop" ? ["Adverse effect", "No longer indicated", "Replaced by another drug", "Patient preference"] : ["Tolerating, repeat checks normal"]).map((r) => ({ value: r, label: r }))}
              value={reason}
              onChange={setReason}
            />
          </div>
        )}
        {action && action !== "stop" && action !== "continue" && (
          <div className="q">
            <div className="label">Follow-up</div>
            <Segmented
              label="Follow-up"
              options={[
                ...(renalK ? [{ value: "lab-7", label: `K/Cr check · ${fmtDay(addDays(today, 7))}` }] : []),
                { value: "visit-14", label: `Review · ${fmtDay(addDays(today, 14))}` },
                { value: "none", label: "None" },
              ]}
              value={review}
              onChange={setReview}
            />
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
        <div className="q">
          <div className="label" style={{ fontSize: 15 }}>History</div>
          {history.slice().reverse().map((e: any) => (
            <div key={e.id} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid var(--line-2)", padding: "8px 0" }}>
              <span style={{ fontWeight: 700 }}>{e.kind[0].toUpperCase() + e.kind.slice(1)}{e.dose_value != null ? ` · ${doseLabel(def, e.dose_value)}` : ""}</span>
              <span className="small muted" style={{ fontWeight: 600 }}>{e.reason ? e.reason + " · " : ""}{fmtDay(e.effective_at, { year: true })}</span>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  );
}
