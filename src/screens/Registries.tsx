import { useState } from "react";
import { useData } from "../api";
import { Link, useToast } from "../ui";

// The HF registry as a whole: every HF patient of the site, how much of the registry form the
// record already fills, what is still missing, and one CSV with a row per patient. Read-only.
export function Registries() {
  const { data: r } = useData<any>(`/registries/hf`);
  const toast = useToast();
  const [q, setQ] = useState("");
  if (!r) return <main className="page"><p className="muted">Loading…</p></main>;
  const rows = r.patients.filter((p: any) => !q || `${p.name} ${p.mrn}`.toLowerCase().includes(q.toLowerCase()));
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.csv], { type: "text/csv" }));
    a.download = "hf-registry.csv";
    a.click();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(r.csv); toast({ text: `Registry CSV copied (${r.counts.patients} rows)` }); } catch { toast({ text: "Copy not available in this browser", err: true }); }
  };
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Registries</h1>
          <p>{r.registry} · filled from the CardioFlow record · nothing is sent to the registry</p>
        </div>
      </div>
      <section className="card pad reg">
        <div className="reg-sum">
          <div>
            <b>{r.counts.patients} patients with heart failure</b>
            {Object.entries(r.counts.byType).map(([t, n]) => <span key={t} className="reg-chip">{t} · {n as number}</span>)}
          </div>
          {r.counts.filledPct != null && (
            <div>
              {r.counts.filledPct}% of the mapped registry fields are filled from the record
              <span className="bar" aria-label={`${r.counts.filledPct}% filled`}><i style={{ width: `${r.counts.filledPct}%` }} /></span>
            </div>
          )}
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn secondary small" onClick={download}>Download registry CSV (all patients)</button>
            <button className="btn ghost small" onClick={copy}>Copy CSV</button>
          </div>
          <div className="muted small">Enrolment, the codebook and statistics are built at the end of the build. Registry-only fields (doctor, referral source and others) are still entered in the registry.</div>
        </div>
        <input className="input" style={{ maxWidth: 420, marginBottom: 12 }} placeholder="Filter by name or MRN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter registry patients" />
        <table className="data">
          <thead><tr><th>Patient</th><th>HF type</th><th>LVEF</th><th>Registry fields</th><th>Not recorded yet</th></tr></thead>
          <tbody>
            {rows.map((p: any) => {
              const pct = Math.round((p.filled / p.mapped) * 100);
              return (
                <tr key={p.id}>
                  <td data-label="Patient"><Link to={`/patients/${p.id}/registries`}><b>{p.name}</b></Link> <span className="muted small">MRN {p.mrn}</span></td>
                  <td data-label="HF type">{p.type}</td>
                  <td data-label="LVEF">{p.lvef != null ? `${Math.round(p.lvef)}%` : "—"}</td>
                  <td data-label="Registry fields">
                    {p.filled} of {p.mapped}
                    <span className="reg-mini" aria-hidden><i style={{ width: `${pct}%` }} /></span>
                  </td>
                  <td data-label="Not recorded yet" className="small">{p.missing.length ? p.missing.slice(0, 4).join(", ") + (p.missing.length > 4 ? ` +${p.missing.length - 4} more` : "") : "Complete"}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="muted">No patients match.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
