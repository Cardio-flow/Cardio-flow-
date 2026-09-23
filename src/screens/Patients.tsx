import { useState } from "react";
import { Plus, ChevronRight } from "lucide-react";
import { useData } from "../api";
import { Link, initials, navigate } from "../ui";
import { fmtDay } from "../../shared/clinical";
import { NewPatient } from "../drawers/NewPatient";

export function Patients() {
  const [q, setQ] = useState("");
  const { data } = useData<any[]>(`/patients?q=${encodeURIComponent(q)}`);
  const [adding, setAdding] = useState(false);
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Patients</h1>
          <p>One record per patient across admissions, clinic and procedures</p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={18} /> New patient</button>
      </div>
      <input className="input" style={{ maxWidth: 420 }} placeholder="Filter by name or MRN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter patients" />
      <div className="card wl">
        {(data ?? []).map((p) => (
          <Link key={p.id} to={`/patients/${p.id}`} className="wl-row" style={{ gridTemplateColumns: "1fr 200px 20px" }}>
            <span className="person">
              <span className="avatar">{initials(p.name)}</span>
              <span>
                <b>{p.name}</b>
                <span>MRN {p.mrn} · {p.sex}</span>
              </span>
            </span>
            <span className="muted" style={{ fontWeight: 600 }}>Born {fmtDay(p.birth_date, { year: true })}</span>
            <ChevronRight size={18} color="#98A2B3" />
          </Link>
        ))}
        {data && !data.length && <div className="empty" style={{ margin: 20 }}>No patients match.</div>}
      </div>
      {adding && <NewPatient onClose={() => setAdding(false)} onCreated={(id) => navigate(`/patients/${id}`)} />}
    </main>
  );
}
