import { useState } from "react";
import { PencilLine, Trash2 } from "lucide-react";
import { useData, useSampleMode, withSample } from "../api";
import { IdentityDrawer } from "../drawers/History";
import { Link, useToast } from "../ui";

export function PatientAdmin() {
  const sample = useSampleMode();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<{
    patient: any;
    remove: boolean;
  } | null>(null);
  const { data, error, reload } = useData<{ rows: any[]; hasMore: boolean }>(
    withSample(
      `/admin/patients?q=${encodeURIComponent(q)}&offset=${offset}`,
      sample,
    ),
  );
  const toast = useToast();
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
          <p>
            {sample ? "Sample records" : "Real patient records"} · registration
            changes and audited removal
          </p>
        </div>
        <Link className="btn secondary" to="/patients">
          Back to patients
        </Link>
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
                MRN {patient.mrn} · {patient.sex}
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
      {editing && (
        <IdentityDrawer
          key={editing.patient.id}
          patientId={editing.patient.id}
          identity={editing.patient}
          initialRemove={editing.remove}
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
