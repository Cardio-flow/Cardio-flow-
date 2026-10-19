import { useState } from "react";
import { LockKeyhole, PencilLine, Trash2 } from "lucide-react";
import { api, setAdminUnlock, useData } from "../api";
import { IdentityDrawer } from "../drawers/History";
import { Link, useToast } from "../ui";

export function PatientAdmin() {
  const { data: pinStatus, error: pinStatusError, reload: reloadPinStatus } = useData<{ configured: boolean }>("/admin/pin/status");
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState<"all" | "real" | "sample">("all");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<{
    patient: any;
    remove: boolean;
  } | null>(null);
  const { data, error, reload } = useData<{ rows: any[]; hasMore: boolean }>(unlocked
    ? `/admin/patients?q=${encodeURIComponent(q)}&offset=${offset}&group=${group}`
    : null);
  const toast = useToast();
  const lock = () => { setAdminUnlock(""); setUnlocked(false); setEditing(null); setPin(""); };
  async function submitPin() {
    if (busy) return;
    setBusy(true);
    setPinError("");
    try {
      if (!pinStatus?.configured) {
        if (pin !== confirm) throw new Error("PINs do not match");
        await api("/admin/pin/set", { body: { pin } });
        reloadPinStatus();
        setConfirm("");
        setPin("");
        toast({ text: "Administration PIN set. Enter it to unlock." });
      } else {
        const result = await api<{ token: string }>("/admin/pin/unlock", { body: { pin } });
        setAdminUnlock(result.token);
        setUnlocked(true);
        setPin("");
      }
    } catch (e) { setPinError((e as Error).message); }
    finally { setBusy(false); }
  }
  const done = () => {
    setEditing(null);
    setOffset(0);
    reload();
  };
  return (
    <main className="page patient-admin">
      <div className="page-head">
        <div>
          <h1>Patient administration</h1>
          <p>Real and synthetic patients · audited changes and removal</p>
        </div>
        <span className="row wrap" style={{ gap: 8 }}>
          {unlocked && <button className="btn secondary" onClick={lock}><LockKeyhole size={16} /> Lock</button>}
          <Link className="btn secondary" to="/patients">Back to patients</Link>
        </span>
      </div>
      {pinStatusError && <div className="error-box" role="alert">{pinStatusError}</div>}
      {!unlocked && pinStatus && <form className="card pad admin-pin" onSubmit={(e) => { e.preventDefault(); void submitPin(); }}>
        <h2><LockKeyhole size={19} /> {pinStatus.configured ? "Unlock administration" : "Set administration PIN"}</h2>
        <p className="muted small">{pinStatus.configured ? "Enter your PIN to manage patient records." : "Choose a 6–12 digit PIN for this site. Only administrators can set it."}</p>
        <label className="field"><span>PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} required /></label>
        {!pinStatus.configured && <label className="field"><span>Confirm PIN</span><input className="input" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} required /></label>}
        {pinError && <div className="error-box" role="alert">{pinError}</div>}
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Checking…" : pinStatus.configured ? "Unlock" : "Set PIN"}</button>
      </form>}
      {unlocked && <>
      <div className="row wrap" role="group" aria-label="Patient group" style={{ gap: 8, marginBottom: 12 }}>
        {([ ["all", "All patients"], ["real", "Real"], ["sample", "Synthetic"] ] as const).map(([value, label]) => <button key={value} className={`btn small ${group === value ? "primary" : "secondary"}`} aria-pressed={group === value} onClick={() => { setGroup(value); setOffset(0); }}>{label}</button>)}
      </div>
      <input
        className="input"
        style={{ maxWidth: 420 }}
        aria-label="Find patient to manage"
        placeholder="Search name, MRN or civil ID"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOffset(0);
        }}
      />
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <div className="card">
        {!data && !error && (
          <div className="empty" role="status">
            Loading patients…
          </div>
        )}
        {data?.rows.map((patient) => (
          <div className="patient-admin-row" key={patient.id}>
            <Link
              to={`/patients/${patient.id}`}
              className="patient-admin-person"
            >
              <b>{patient.name}</b>
              <span className="small muted">
                MRN {patient.mrn} · {patient.sex} · {patient.sample ? "Synthetic" : "Real"}
              </span>
            </Link>
            <span className="row" style={{ gap: 6 }}>
              <button
                className="btn ghost small"
                aria-label={`Edit ${patient.name}`}
                onClick={() => setEditing({ patient, remove: false })}
              >
                <PencilLine size={16} />
                Edit
              </button>
              <button
                className="btn ghost small"
                aria-label={`Delete ${patient.name}`}
                onClick={() => setEditing({ patient, remove: true })}
              >
                <Trash2 size={16} />
                Delete
              </button>
            </span>
          </div>
        ))}
        {data && !data.rows.length && (
          <div className="empty">
            {q ? "No matching patients." : "No patients in this group."}
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn secondary small"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          Previous
        </button>
        <span className="small muted">Page {Math.floor(offset / 30) + 1}</span>
        <button
          className="btn secondary small"
          disabled={!data?.hasMore}
          onClick={() => setOffset(offset + 30)}
        >
          Next
        </button>
      </div>
      </>}
      {editing && (
        <IdentityDrawer
          key={editing.patient.id}
          patientId={editing.patient.id}
          identity={editing.patient}
          initialRemove={editing.remove}
          admin
          onClose={() => setEditing(null)}
          onDone={(m) => {
            if (m) toast({ text: m });
            done();
          }}
          onRemoved={done}
        />
      )}
    </main>
  );
}
