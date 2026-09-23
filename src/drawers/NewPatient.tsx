import { useMemo, useState } from "react";
import { UserPlus, Stethoscope, Search } from "lucide-react";
import { api } from "../api";
import { Drawer, Segmented } from "../ui";
import { DIAGNOSES } from "../../shared/catalog";

function DiagnosisPicker({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  const [q, setQ] = useState("");
  const families = useMemo(() => [...new Set(DIAGNOSES.map((d) => d.family))], []);
  const shown = DIAGNOSES.filter((d) => (d.display + d.family).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="col">
      <label className="row" style={{ height: 46, padding: "0 14px", border: "1px solid var(--control)", borderRadius: 12 }}>
        <Search size={18} color="var(--ink-4)" />
        <input className="grow" style={{ border: 0, outline: "none" }} placeholder="Search diagnoses and comorbidities" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search diagnoses" />
      </label>
      {value.length > 0 && (
        <div className="row wrap" style={{ gap: 8 }}>
          {value.map((c) => (
            <button key={c} type="button" className="chip dx" style={{ border: 0, cursor: "pointer" }} onClick={() => onChange(value.filter((v) => v !== c))} aria-label={`Remove ${DIAGNOSES.find((d) => d.code === c)?.display}`}>
              {DIAGNOSES.find((d) => d.code === c)?.display} ×
            </button>
          ))}
        </div>
      )}
      {families.map((f) => {
        const items = shown.filter((d) => d.family === f);
        if (!items.length) return null;
        return (
          <div key={f} className="col" style={{ gap: 8 }}>
            <span className="eyebrow">{f}</span>
            <div className="choices">
              {items.map((d) => (
                <button key={d.code} type="button" className="choice" style={{ minHeight: 38 }} aria-pressed={value.includes(d.code)} onClick={() => onChange(value.includes(d.code) ? value.filter((v) => v !== d.code) : [...value, d.code])}>
                  {d.display}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function NewPatient({ onClose, onCreated }: { onClose(): void; onCreated(id: string): void }) {
  const [f, setF] = useState({ name: "", mrn: "", sex: "", birthDate: "", allergies: "" });
  const [dx, setDx] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = f.name.trim().length > 1 && f.mrn.trim() && f.sex && f.birthDate;
  async function save() {
    setBusy(true);
    try {
      const r = await api("/patients", { body: { ...f, conditions: dx } });
      onCreated(r.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="New patient"
      subtitle="Registration only. Registry enrolment is separate and optional."
      icon={<UserPlus size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : "Create patient"}</button>
        </span>
      }
    >
      <div className="drawer-body">
        <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
          <label className="field grow">
            <span>Full name</span>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label className="field">
            <span>MRN / file number</span>
            <input className="input" value={f.mrn} onChange={(e) => setF({ ...f, mrn: e.target.value })} />
          </label>
        </div>
        <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
          <div className="field">
            <span>Sex</span>
            <Segmented label="Sex" options={[{ value: "Male", label: "Male" }, { value: "Female", label: "Female" }]} value={f.sex} onChange={(v) => setF({ ...f, sex: v })} />
          </div>
          <label className="field">
            <span>Date of birth</span>
            <input type="date" className="input" value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value })} />
          </label>
          <label className="field grow">
            <span>Allergies</span>
            <input className="input" placeholder="e.g. No known drug allergies" value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} />
          </label>
        </div>
        <div className="q">
          <div className="label">Diagnoses and comorbidities</div>
          <DiagnosisPicker value={dx} onChange={setDx} />
        </div>
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

export function AddDiagnosis({ patientId, onClose, onDone }: { patientId: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const [dx, setDx] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/conditions`, { body: { codes: dx } });
      onDone(`${dx.length} diagnosis${dx.length === 1 ? "" : "es"} added`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Add diagnosis"
      subtitle="Select, don't type"
      icon={<Stethoscope size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!dx.length || busy} onClick={save}>Add</button>
        </span>
      }
    >
      <div className="drawer-body">
        <DiagnosisPicker value={dx} onChange={setDx} />
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}
