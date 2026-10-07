import { useMemo, useState } from "react";
import { UserPlus, Stethoscope, Search } from "lucide-react";
import { api } from "../api";
import { Drawer, Segmented } from "../ui";
import { DIAGNOSES, DIAGNOSIS } from "../../shared/catalog";
import { IdentityFields } from "./History";
import { civilIdBirthDate } from "../../shared/civil-id";

// Diagnoses grouped as clinicians think of them: cardiac families, then comorbidities in small groups.
// Mutually exclusive sets pick one (HF phenotype, diabetes type, CKD stage); search narrows every group.
const COMORBIDITY_GROUPS: { title: string; codes: string[] }[] = [
  { title: "Risk factors and metabolic", codes: ["htn", "dyslipidaemia", "fh", "statin-intolerance", "obesity"] },
  { title: "Diabetes", codes: ["t2dm", "t1dm", "dm-other", "prediabetes"] },
  { title: "Kidney", codes: ["ckd-1-2", "ckd-3a", "ckd-3b", "ckd-4", "ckd-5", "dialysis"] },
  { title: "Vascular and thrombosis", codes: ["stroke-tia", "pad", "pe", "aps"] },
  { title: "Lung and sleep", codes: ["copd", "ild", "osa"] },
  { title: "Other", codes: ["anaemia", "thyroid", "liver-disease", "cancer"] },
];
const ONE_OF = [["hfref", "hfmref", "hfpef", "hfimpef"], ["t2dm", "t1dm", "dm-other", "prediabetes"], ["ckd-1-2", "ckd-3a", "ckd-3b", "ckd-4", "ckd-5"]];
const SHORT: Record<string, string> = { "ckd-1-2": "1–2 (albuminuria)", "ckd-3a": "3a", "ckd-3b": "3b", "ckd-4": "4", "ckd-5": "5", "dm-other": "Other type (LADA, MODY, secondary)", t2dm: "Type 2", t1dm: "Type 1" };

function DiagnosisPicker({ value, onChange }: { value: string[]; onChange(v: string[]): void }) {
  const [q, setQ] = useState("");
  const visible = useMemo(() => DIAGNOSES.filter((d) => !d.hidden), []);
  const cardiacFamilies = useMemo(() => [...new Set(visible.filter((d) => d.family !== "Comorbidity").map((d) => d.family))], [visible]);
  const groups = [
    ...cardiacFamilies.map((f) => ({ title: f, codes: visible.filter((d) => d.family === f).map((d) => d.code), cardiac: true })),
    ...COMORBIDITY_GROUPS.map((g) => ({ ...g, cardiac: false })),
  ];
  const match = (code: string) => {
    const d = DIAGNOSIS[code];
    return !!d && (!q || (d.display + " " + d.family).toLowerCase().includes(q.toLowerCase()));
  };
  const toggle = (code: string) => {
    if (value.includes(code)) return onChange(value.filter((v) => v !== code));
    const set = ONE_OF.find((s) => s.includes(code));
    onChange([...value.filter((v) => !set?.includes(v)), code]);
  };
  const render = (g: { title: string; codes: string[]; cardiac: boolean }) => {
    const codes = g.codes.filter(match);
    if (!codes.length) return null;
    const n = g.codes.filter((c) => value.includes(c)).length;
    const one = ONE_OF.some((s) => g.codes.some((c) => s.includes(c)));
    return (
      <div key={g.title} className={`dx-group ${n ? "has" : ""}`}>
        <div className="dx-group-head">
          <span>{g.title}</span>
          {n > 0 && <b>{n} selected</b>}
          {one && !n && <em>pick one</em>}
        </div>
        <div className="dx-chips">
          {codes.map((c) => (
            <button key={c} type="button" className="dx-pick" aria-pressed={value.includes(c)} onClick={() => toggle(c)}>
              {g.title === "Kidney" && c.startsWith("ckd") ? `CKD ${SHORT[c]}` : g.title === "Diabetes" && SHORT[c] ? SHORT[c] : DIAGNOSIS[c].display}
            </button>
          ))}
        </div>
      </div>
    );
  };
  const cardiac = groups.filter((g) => g.cardiac).map(render).filter(Boolean);
  const other = groups.filter((g) => !g.cardiac).map(render).filter(Boolean);
  return (
    <div className="col" style={{ gap: 14 }}>
      <label className="row dx-search">
        <Search size={18} color="var(--ink-4)" />
        <input className="grow" placeholder="Search diagnoses and comorbidities" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search diagnoses" />
        {q && <button type="button" className="btn ghost small" onClick={() => setQ("")}>Clear</button>}
      </label>
      {value.length > 0 && (
        <div className="dx-selected">
          <span className="small muted">Selected</span>
          {value.map((c) => (
            <button key={c} type="button" className="chip dx" style={{ border: 0, cursor: "pointer" }} onClick={() => onChange(value.filter((v) => v !== c))} aria-label={`Remove ${DIAGNOSIS[c]?.display}`}>
              {DIAGNOSIS[c]?.display} ×
            </button>
          ))}
        </div>
      )}
      {cardiac.length > 0 && (
        <>
          <div className="dx-section">Cardiac</div>
          <div className="dx-grid">{cardiac}</div>
        </>
      )}
      {other.length > 0 && (
        <>
          <div className="dx-section">Comorbidities</div>
          <div className="dx-grid">{other}</div>
        </>
      )}
      {!cardiac.length && !other.length && <div className="empty">No diagnosis matches “{q}”.</div>}
    </div>
  );
}

export function NewPatient({ onClose, onCreated, sample = false }: { onClose(): void; onCreated(id: string): void; sample?: boolean }) {
  const [test, setTest] = useState(sample);
  const [f, setF] = useState({ name: "", mrn: "", sex: "", birthDate: "", allergies: "", civilId: "", nationality: "", mobile: "" });
  const [dx, setDx] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = f.name.trim().length > 1 && f.mrn.trim() && f.sex && f.birthDate && (!f.civilId || (/^\d{12}$/.test(f.civilId) && !!civilIdBirthDate(f.civilId)));
  async function save() {
    setBusy(true);
    try {
      const r = await api("/patients", { body: { ...f, conditions: dx, sample: test } });
      onCreated(r.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={test ? "New sample patient" : "New patient"}
      subtitle={test ? "Synthetic record for practice. Kept with the sample patients, never with real ones." : "Registration only. Registry enrolment is separate and optional."}
      icon={<UserPlus size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : test ? "Create sample patient" : "Create patient"}</button>
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
            <span>File number (MRN)</span>
            <input className="input" value={f.mrn} onChange={(e) => setF({ ...f, mrn: e.target.value })} />
          </label>
        </div>
        <IdentityFields f={f} setF={setF} />
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
          <div className="help">Tap what applies. Smoking, family history and details such as MI type or valve prosthesis follow in the patient's History.</div>
          <DiagnosisPicker value={dx} onChange={setDx} />
        </div>
        <label className="check-line">
          <input type="checkbox" checked={test} onChange={(e) => setTest(e.target.checked)} />
          <span>
            <b>Sample patient for practice</b>
            <span className="muted small"> — synthetic data; the file number gets the SYN- prefix and the patient stays out of real lists and registries</span>
          </span>
        </label>
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
