import { useState } from "react";
import { useData } from "../api";
import { Link, Segmented, useToast } from "../ui";

// Each registry as a whole: every eligible patient of the site, how much of the registry form the
// record already fills, what is still missing, and one CSV with a row per patient. Read-only.
// HF Clinic Registry (heart failure) and CAD Registry (PCI, angiography or ACS admission).
const REGS = [
  { value: "hf", name: "MKH HF Clinic Registry", label: "HF Clinic Registry", who: "patients with heart failure", type: "HF type", file: "hf-registry.csv" },
  { value: "cad", name: "CAD Registry", label: "CAD Registry", who: "patients with a PCI, angiography or ACS admission", type: "Presentation", file: "cad-registry.csv" },
];
export function Registries() {
  const [reg, setReg] = useState("hf");
  const def = REGS.find((x) => x.value === reg)!;
  const { data: r } = useData<any>(`/registries/${reg}`, [reg]);
  const toast = useToast();
  const [q, setQ] = useState("");
  const head = (
    <div className="page-head">
      <div>
        <h1>Registries</h1>
        <p>{def.label} · filled from the CardioFlow record · nothing is sent to the registry</p>
      </div>
      <Segmented label="Registry" options={REGS.map((x) => ({ value: x.value, label: x.label }))} value={reg} onChange={setReg} />
    </div>
  );
  if (!r || r.registry !== def.name) return <main className="page">{head}<p className="muted">Loading…</p></main>;
  const rows = r.patients.filter((p: any) => !q || `${p.name} ${p.mrn}`.toLowerCase().includes(q.toLowerCase()));
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.csv], { type: "text/csv" }));
    a.download = def.file;
    a.click();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(r.csv); toast({ text: `Registry CSV copied (${r.counts.patients} rows)` }); } catch { toast({ text: "Copy not available in this browser", err: true }); }
  };
  return (
    <main className="page">
      {head}
      <section className="card pad reg">
        <div className="reg-sum">
          <div>
            <b>{r.counts.patients} {def.who}</b>
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
          <div className="muted small">Enrolment, the codebook and statistics are built at the end of the build. Registry-only fields ({reg === "hf" ? "doctor, referral source" : "Killip class, door-to-balloon, lesion form, follow-up"} and others) are still entered in the registry.</div>
        </div>
        <input className="input" style={{ maxWidth: 420, marginBottom: 12 }} placeholder="Filter by name or MRN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter registry patients" />
        <table className="data">
          <thead><tr><th>Patient</th><th>{def.type}</th>{reg === "hf" ? <th>LVEF</th> : <th>Index record</th>}<th>Registry fields</th><th>Not recorded yet</th></tr></thead>
          <tbody>
            {rows.map((p: any) => {
              const pct = Math.round((p.filled / p.mapped) * 100);
              return (
                <tr key={p.id}>
                  <td data-label="Patient"><Link to={`/patients/${p.id}/registries`}><b>{p.name}</b></Link> <span className="muted small">MRN {p.mrn}</span></td>
                  <td data-label={def.type}>{p.type}</td>
                  {reg === "hf" ? <td data-label="LVEF">{p.lvef != null ? `${Math.round(p.lvef)}%` : "—"}</td> : <td data-label="Index record" className="small">{p.index}</td>}
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
