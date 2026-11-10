import { useState } from "react";
import { api, useData, useSampleMode, withSample } from "../api";
import { DateInput, Link, Segmented, useToast } from "../ui";
import { formatP } from "../../shared/stats";
import { isoDay } from "../../shared/clinical";

// Each registry as a whole (10 Nov 2026, phase 4): eligible and enrolled patients, statistics, the codebook and the
// exports (data in the registry's wording, data in its SPSS codes, an SPSS syntax file, the codebook). Every value is
// read from the CardioFlow record on the server; this screen shows it and records only enrolment decisions.
const REGS = [
  { value: "hf", label: "Heart Failure Registry", who: "patients with heart failure" },
  { value: "cad", label: "CAD Registry", who: "patients with a PCI, angiography or ACS admission" },
  { value: "eps", label: "EP Registry", who: "patients with a device procedure or an ablation" },
];
const VIEWS = [
  { value: "patients", label: "Patients" },
  { value: "stats", label: "Statistics" },
  { value: "codebook", label: "Codebook" },
  { value: "export", label: "Export" },
];
const WITHDRAW = ["Consent withdrawn", "Not eligible", "Entered in error", "Transferred care", "Other"];
// categorical slots 1–5 of the validated chart palette (dataviz skill); "Other" in neutral grey
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const OTHER = "#8a94a3";
const fmt = (d?: string | null) => (d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function download(name: string, text: string, type = "text/csv") {
  const a = document.createElement("a");
  // BOM: Excel and SPSS read UTF-8 names (Arabic) correctly
  a.href = URL.createObjectURL(new Blob([type === "text/csv" ? "﻿" + text : text], { type: `${type};charset=utf-8` }));
  a.download = name;
  a.click();
}

export function Registries() {
  const [reg, setReg] = useState("hf");
  const [view, setView] = useState("patients");
  const [cohort, setCohort] = useState<string | undefined>(undefined);
  const def = REGS.find((x) => x.value === reg)!;
  const sample = useSampleMode();
  const path = withSample(`/registries/${reg}${cohort ? `?cohort=${cohort}` : ""}`, sample);
  const { data: r, reload, error } = useData<any>(path, [reg, cohort]);
  const head = (
    <div className="page-head">
      <div>
        <h1>Registries</h1>
        <p>{def.label} · filled from the CardioFlow record · nothing is sent to the registry</p>
      </div>
      <Segmented label="Registry" options={REGS.map((x) => ({ value: x.value, label: x.label }))} value={reg} onChange={(v) => { setReg(v); setCohort(undefined); }} />
    </div>
  );
  if (error) return <main className="page">{head}<p className="err">{error}</p></main>;
  if (!r || r.registry !== def.label) return <main className="page">{head}<p className="muted">Loading…</p></main>;
  return (
    <main className="page reg-page">
      {head}
      <section className="card pad reg">
        <div className="reg-sum">
          <div className="reg-counts">
            <span><b>{r.counts.eligible}</b> eligible</span>
            <span><b>{r.counts.enrolled}</b> enrolled</span>
            {r.counts.filledPct != null && <span><b>{r.counts.filledPct}%</b> of mapped fields filled</span>}
          </div>
          <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
            <Segmented
              label="Who is counted"
              options={[{ value: "enrolled", label: `Enrolled · ${r.counts.enrolled}` }, { value: "eligible", label: `All eligible · ${r.counts.eligible}` }]}
              value={r.cohort}
              onChange={setCohort}
            />
            <span className="muted small">{r.cohort === "enrolled" ? "Statistics and exports use the enrolled patients." : r.counts.enrolled ? "Statistics and exports use every eligible patient." : "No one is enrolled yet: statistics and exports use every eligible patient."}</span>
          </div>
        </div>
        <Segmented label="Show" options={VIEWS} value={view} onChange={setView} />
        <div style={{ marginTop: 14 }}>
          {view === "patients" && <Patients r={r} reg={reg} who={def.who} sample={sample} reload={reload} />}
          {view === "stats" && <Stats s={r.stats} n={r.counts.inCohort} />}
          {view === "codebook" && <Codebook r={r} />}
          {view === "export" && <Export r={r} />}
        </div>
      </section>
    </main>
  );
}

function Patients({ r, reg, who, sample, reload }: { r: any; reg: string; who: string; sample: boolean; reload(): void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [on, setOn] = useState(isoDay());
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const rows = r.patients.filter((p: any) => !q || `${p.name} ${p.mrn}`.toLowerCase().includes(q.toLowerCase()));
  const waiting = r.patients.filter((p: any) => p.eligible && p.enrolment?.status !== "enrolled");
  const run = async (fn: () => Promise<any>, text: string) => {
    setBusy(true);
    try { await fn(); toast({ text }); reload(); } catch (e: any) { toast({ text: e.message, err: true }); } finally { setBusy(false); }
  };
  const enrolAll = () => run(() => api(withSample(`/registries/${reg}/enrol`, sample), { body: { patientIds: waiting.map((p: any) => p.id), effectiveOn: on } }), `${waiting.length} enrolled`);
  const enrolOne = (p: any) => run(() => api(`/patients/${p.id}/registries/${reg}/enrol`, { body: { effectiveOn: on } }), `${p.name} enrolled`);
  return (
    <>
      <div className="reg-enrol row wrap">
        <label className="small" style={{ fontWeight: 700 }}>Enrolment date</label>
        <DateInput value={on} onChange={(e) => setOn(e.target.value)} max={isoDay()} aria-label="Enrolment date" style={{ maxWidth: 170 }} />
        {waiting.length > 0 && <button className="btn primary small" disabled={busy} onClick={enrolAll}>Enrol {waiting.length === 1 ? "the eligible patient" : `all ${waiting.length} eligible not enrolled`}</button>}
        <input className="input" style={{ maxWidth: 300 }} placeholder="Filter by name or MRN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter registry patients" />
      </div>
      <table className="data">
        <thead><tr><th>Patient</th><th>Group</th><th>Registry fields</th><th>Not recorded yet</th><th>Enrolment</th></tr></thead>
        <tbody>
          {rows.map((p: any) => {
            const pct = p.mapped ? Math.round((p.filled / p.mapped) * 100) : 0;
            const e = p.enrolment;
            return (
              <tr key={p.id}>
                <td data-label="Patient"><Link to={`/patients/${p.id}/registries`}><b>{p.name}</b></Link> <span className="muted small">MRN {p.mrn}</span>{p.index && <div className="muted small">{p.index}</div>}</td>
                <td data-label="Group">{p.type}{p.lvef != null ? <span className="muted small"> · LVEF {Math.round(p.lvef)}%</span> : null}</td>
                <td data-label="Registry fields">{p.eligible ? <>{p.filled} of {p.mapped}<span className="reg-mini" aria-hidden><i style={{ width: `${pct}%` }} /></span></> : <span className="muted">No longer eligible</span>}</td>
                <td data-label="Not recorded yet" className="small">{p.eligible ? (p.missing.length ? p.missing.slice(0, 3).join(", ") + (p.missing.length > 3 ? ` +${p.missing.length - 3} more` : "") : "Complete") : ""}</td>
                <td data-label="Enrolment">
                  {e?.status === "enrolled" ? (
                    <div className="reg-status">
                      <span className="reg-in">Enrolled {fmt(e.on)}</span>
                      <button className="btn ghost small" onClick={() => setLeaving(leaving === p.id ? null : p.id)} aria-expanded={leaving === p.id}>Withdraw</button>
                    </div>
                  ) : (
                    <div className="reg-status">
                      {e?.status === "withdrawn" && <span className="muted small" title={e.reason}>Withdrawn {fmt(e.on)} · {e.reason}</span>}
                      {p.eligible && <button className="btn secondary small" disabled={busy} onClick={() => enrolOne(p)}>Enrol</button>}
                    </div>
                  )}
                  {leaving === p.id && <Withdraw p={p} reg={reg} done={() => { setLeaving(null); reload(); }} />}
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={5} className="muted">{r.patients.length ? "No patients match." : `No ${who} yet.`}</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function Withdraw({ p, reg, done }: { p: any; reg: string; done(): void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [on, setOn] = useState(isoDay());
  const save = async () => {
    try { await api(`/patients/${p.id}/registries/${reg}/withdraw`, { body: { effectiveOn: on, reason, detail } }); toast({ text: `${p.name} withdrawn` }); done(); }
    catch (e: any) { toast({ text: e.message, err: true }); }
  };
  return (
    <div className="reg-withdraw">
      <div className="chips">{WITHDRAW.map((w) => <button key={w} className={`chip${reason === w ? " on" : ""}`} aria-pressed={reason === w} onClick={() => setReason(w)}>{w}</button>)}</div>
      <input className="input" placeholder="Detail (optional)" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={300} aria-label="Withdrawal detail" />
      <div className="row" style={{ gap: 8 }}>
        <DateInput value={on} onChange={(e) => setOn(e.target.value)} max={isoDay()} aria-label="Withdrawal date" style={{ maxWidth: 170 }} />
        <button className="btn primary small" disabled={!reason} onClick={save}>Withdraw</button>
      </div>
    </div>
  );
}

function Stats({ s, n }: { s: any; n: number }) {
  if (!n) return <p className="muted">No patients in this group yet.</p>;
  const groups = s.groups as { label: string; n: number }[];
  const pCell = (t: any) => (t ? <span title={t.test}>{formatP(t.p)}<sup>{t.test === "Fisher" ? "F" : t.test === "Chi-square" ? "χ²" : "W"}</sup></span> : "");
  return (
    <div className="stack">
      <p className="muted small">
        {n} patients{groups.length ? ` · compared by ${s.groupLabel}: ${groups.map((g) => `${g.label} ${g.n}`).join(", ")}` : ` · fewer than two "${s.groupLabel}" groups with 2 or more patients, so no comparison`}.
        Descriptive statistics for the registry; confirm any analysis with the statistician.
      </p>
      <section>
        <h3 className="reg-h">Baseline characteristics</h3>
        <p className="muted small">Numbers are mean ± SD (median [IQR] below); yes/no and categories are n (%) of patients with a recorded value. p: χ² chi-square, F Fisher's exact (2×2 with small counts), W Welch t / Welch ANOVA.</p>
        {s.table.map((t: any, i: number) => (
          <details key={t.section} className="reg-fold" open={i < 2}>
            <summary>{t.section} · {t.rows.length}</summary>
            <div className="reg-scroll">
              <table className="reg-t">
                <thead><tr><th>Variable</th><th>All ({n})</th>{groups.map((g) => <th key={g.label}>{g.label} ({g.n})</th>)}{groups.length > 0 && <th>p</th>}<th>Not recorded</th></tr></thead>
                <tbody>
                  {t.rows.flatMap((row: any) => [
                    <tr key={row.key} className={row.levels ? "reg-cat" : ""}>
                      <td>{row.label}</td>
                      {row.levels ? <td colSpan={1 + groups.length} /> : <><td>{row.overall.text}{row.overall.sub && <small>{row.overall.sub}</small>}</td>{groups.map((g, j) => <td key={g.label}>{row.groups[j].text}{row.groups[j].sub && <small>{row.groups[j].sub}</small>}</td>)}</>}
                      {groups.length > 0 && <td>{pCell(row.test)}</td>}
                      <td className="muted">{row.missing || ""}</td>
                    </tr>,
                    ...(row.levels ?? []).map((l: any) => (
                      <tr key={row.key + l.label} className="reg-level"><td>{l.label}</td><td>{l.overall.text}</td>{groups.map((g, j) => <td key={g.label}>{l.groups[j].text}</td>)}{groups.length > 0 && <td />}<td /></tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </section>
      <section>
        <h3 className="reg-h">Outcomes</h3>
        <p className="muted small">
          From the {s.origin} to the event, or to the last contact in the record (lost to follow-up or transferred: that date). Deaths come from the patient's vital status.
          {s.noIndex ? ` ${s.noIndex} patient${s.noIndex === 1 ? " has" : "s have"} no index date and ${s.noIndex === 1 ? "is" : "are"} left out.` : ""}
        </p>
        <div className="reg-outcomes">{s.outcomes.map((o: any) => <Outcome key={o.key} o={o} groups={groups} />)}</div>
      </section>
    </div>
  );
}

function Outcome({ o, groups }: { o: any; groups: { label: string }[] }) {
  const lines = groups.length ? o.groups.map((g: any, i: number) => ({ label: g.group, color: g.group === "Other" ? OTHER : SERIES[i] ?? OTHER, c: g })) : [{ label: "All", color: SERIES[0], c: o.overall }];
  const maxT = Math.max(30, ...lines.flatMap((l: any) => l.c.steps.map((x: any) => x.t)));
  const W = 320, H = 150, P = { l: 34, r: 8, t: 8, b: 22 };
  const x = (t: number) => P.l + (t / maxT) * (W - P.l - P.r), y = (s: number) => P.t + (1 - s) * (H - P.t - P.b);
  const path = (steps: { t: number; s: number }[]) => {
    let d = `M${x(0)},${y(1)}`, last = 1;
    for (const k of steps) { d += ` H${x(k.t)} V${y(k.s)}`; last = k.s; }
    return d + ` H${x(maxT)} V${y(last)}`;
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="reg-out card pad">
      <div className="reg-out-h"><b>{o.label}</b><span className="muted small">{o.overall.events} event{o.overall.events === 1 ? "" : "s"} in {o.overall.n} · median follow-up {o.medianFollowUpDays != null ? `${Math.round(o.medianFollowUpDays)} days` : "—"}{o.test ? ` · log-rank p ${formatP(o.test.p)}` : ""}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Kaplan–Meier curve: ${o.label}`} className="reg-km">
        {[0, 0.5, 1].map((s) => <g key={s}><line x1={P.l} x2={W - P.r} y1={y(s)} y2={y(s)} className="reg-grid" /><text x={P.l - 6} y={y(s) + 4} textAnchor="end" className="reg-axis">{pct(s)}</text></g>)}
        <text x={P.l} y={H - 6} className="reg-axis">0</text>
        <text x={W - P.r} y={H - 6} textAnchor="end" className="reg-axis">{Math.round(maxT)} days</text>
        {/* a 2px surface halo under each line keeps overlapping curves apart; identical curves are told apart in the table below */}
        {lines.map((l: any) => <path key={l.label + "-halo"} d={path(l.c.steps)} fill="none" stroke="#fff" strokeWidth={5} />)}
        {lines.map((l: any) => <path key={l.label} d={path(l.c.steps)} fill="none" stroke={l.color} strokeWidth={2}><title>{l.label}</title></path>)}
      </svg>
      {lines.length > 1 && <div className="reg-legend">{lines.map((l: any) => <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>)}</div>}
      {/* the table view of the curve: event-free at 30, 90 and 365 days with the number still followed */}
      <table className="reg-t">
        <thead><tr><th>Event-free</th><th>30 days</th><th>90 days</th><th>1 year</th></tr></thead>
        <tbody>
          {lines.map((l: any) => (
            <tr key={l.label}><td>{l.label} ({l.c.n})</td>{l.c.at.map((a: any) => <td key={a.days}>{pct(a.survival)}<small>at risk {a.atRisk}</small></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Codebook({ r }: { r: any }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState("all");
  const rows = r.codebook.filter((c: any) => (only === "all" || (only === "record" ? c.source !== "Registry only" : c.source === "Registry only")) && (!q || `${c.variable} ${c.label} ${c.section}`.toLowerCase().includes(q.toLowerCase())));
  const flagged = r.codebook.filter((c: any) => c.unmapped.length);
  return (
    <>
      {flagged.length > 0 && (
        <div className="reg-flag">
          <b>Values the registry's list does not have</b> — left blank in the coded file; choose the registry value when entering these patients:
          <ul>{flagged.map((c: any) => <li key={c.variable}><code>{c.variable}</code> {c.unmapped.map((v: string) => `"${v}"`).join(", ")}</li>)}</ul>
        </div>
      )}
      <div className="row wrap" style={{ gap: 10, marginBottom: 10 }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Find a variable" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a variable" />
        <Segmented label="Source" options={[{ value: "all", label: "All" }, { value: "record", label: "From the record" }, { value: "registry", label: "Registry only" }]} value={only} onChange={setOnly} />
        <span className="muted small">{rows.length} of {r.codebook.length} variables</span>
      </div>
      <div className="reg-scroll">
        <table className="reg-t reg-codebook">
          <thead><tr><th>Variable</th><th>Label</th><th>Type</th><th>Values</th><th>Source</th><th>Recorded</th></tr></thead>
          <tbody>
            {rows.map((c: any) => (
              <tr key={c.variable}>
                <td><code>{c.variable}</code></td>
                <td>{c.label}<small>{c.section}</small></td>
                <td>{c.type}</td>
                <td className="reg-values">{c.values}</td>
                <td>{c.source}</td>
                <td>{c.source === "Registry only" ? "—" : c.filled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Export({ r }: { r: any }) {
  const codebookCsv = [["Variable", "Label", "Section", "Type", "Values", "Source"], ...r.codebook.map((c: any) => [c.variable, c.label, c.section, c.type, c.values, c.source])]
    .map((row: string[]) => row.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\r\n");
  const items = [
    { name: r.files.csv, text: r.csv, title: "Data · registry wording", sub: "One row per patient, the registry's own variable names and option wording. For Excel or to copy into the registry." },
    { name: r.files.csvCoded, text: r.csvCoded, title: "Data · SPSS codes", sub: "Same rows and columns, values in the registry's codes (Yes/No = 1/0; categories as the registry codes them)." },
    { name: r.files.sps, text: r.sps, title: "SPSS syntax", sub: "Reads the coded file with variable labels, value labels and measurement levels. Keep it in the same folder as the coded file and run it.", type: "text/plain" },
    { name: r.files.codebook, text: codebookCsv, title: "Codebook", sub: "Every registry variable: label, type, values or codes, and whether CardioFlow fills it." },
  ];
  return (
    <div className="stack">
      <p className="muted small">{r.counts.inCohort} patients ({r.cohort === "enrolled" ? "enrolled" : "all eligible"}). Columns starting <code>CF_</code> are added by CardioFlow after the registry's own: enrolment, group, index date, last contact, death and the outcome times for survival analysis. The files contain names and identifiers: keep them on approved hospital storage.</p>
      <div className="reg-exports">
        {items.map((it) => (
          <button key={it.name} className="reg-export" disabled={!r.counts.inCohort} onClick={() => download(it.name, it.text, it.type)}>
            <b>{it.title}</b><span>{it.sub}</span><code>{it.name}</code>
          </button>
        ))}
      </div>
    </div>
  );
}
