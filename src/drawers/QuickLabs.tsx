import { useMemo, useState } from "react";
import { Calendar, FlaskConical, X, Check } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, Tag } from "../ui";
import { LABS, LAB_PRESETS, MEASURES, formatNumber } from "../../shared/catalog";
import { egfrCkdEpi2021, flagFor, fmtDay } from "../../shared/clinical";

export function QuickLabs({ patientId, codes, onClose, onDone }: { patientId: string; codes?: string[]; onClose(): void; onDone(msg?: string, r?: any): void }) {
  const { data: rec } = useData<any>(`/patients/${patientId}/record`);
  const { data: sum } = useData<any>(`/patients/${patientId}/summary`);
  const [preset, setPreset] = useState<string | null>(codes ? null : "renal");
  const [rows, setRows] = useState<string[]>(codes ?? LAB_PRESETS[0].codes);
  const [values, setValues] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [date, setDate] = useState<string>("today");
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const today = rec?.today;
  const prev = (code: string) => rec?.results.find((r: any) => r.code === code)?.current;
  const num = (code: string) => {
    const raw = values[code];
    if (raw == null || raw.trim() === "") return null;
    const v = Number(raw.replace(",", "."));
    if (!Number.isFinite(v)) return NaN;
    const unit = units[code];
    const f = unit && unit !== MEASURES[code].unit ? MEASURES[code].convert?.[unit] ?? 1 : 1;
    return v * f;
  };
  const cr = rows.includes("creatinine") ? num("creatinine") : null;
  const egfr = cr && sum ? egfrCkdEpi2021(cr, sum.header.age, sum.header.sex) : null;
  const filled = rows.filter((c) => num(c) != null);
  const invalid = rows.filter((c) => Number.isNaN(num(c) as number));
  const choosePreset = (id: string) => {
    const p = LAB_PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setRows(p.codes);
  };
  const addable = useMemo(() => LABS.filter((l) => !l.derived && !rows.includes(l.code) && (l.display + l.short).toLowerCase().includes(q.toLowerCase())), [rows, q]);
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!filled.length || invalid.length) return;
    setBusy(true);
    setError("");
    try {
      const effectiveAt = date === "today" ? new Date().toISOString() : new Date(`${date}T08:00:00+03:00`).toISOString();
      const r = await api(`/patients/${patientId}/observations`, {
        body: { effectiveAt, items: filled.map((code) => ({ code, value: Number(values[code].replace(",", ".")), unit: units[code] ?? MEASURES[code].unit })) },
      });
      const closed = r.completed?.length ? ` · closed “${r.completed[0].title}”` : "";
      onDone(`${filled.length} result${filled.length === 1 ? "" : "s"} saved${closed}`, r);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Add results"
      subtitle="One date, one save"
      icon={<FlaskConical size={22} />}
      onClose={onClose}
      head={
        <div className="row wrap" style={{ gap: 8 }}>
          {LAB_PRESETS.map((p) => (
            <button key={p.id} type="button" className="choice" style={{ minHeight: 38 }} aria-pressed={preset === p.id} onClick={() => choosePreset(p.id)}>
              {p.label}
            </button>
          ))}
          <button type="button" className="choice" style={{ minHeight: 38, borderStyle: "dashed" }} aria-pressed={false} onClick={() => setAdding(true)}>
            + Any test
          </button>
        </div>
      }
      footer={
        <>
          <span className="note">Tab moves to the next result · Enter saves</span>
          <span className="end">
            <button className="btn ghost" onClick={onClose} style={{ color: "var(--ink-3)" }}>Cancel</button>
            <button className="btn primary" form="labs-form" disabled={busy || !filled.length || invalid.length > 0}>
              {busy ? "Saving…" : `Save ${filled.length || ""} result${filled.length === 1 ? "" : "s"}`}
            </button>
          </span>
        </>
      }
    >
      <form id="labs-form" className="drawer-body" onSubmit={save}>
        <div className="row wrap" style={{ gap: 14 }}>
          <span style={{ fontWeight: 800, width: 120 }}>Date</span>
          <div className="seg" role="radiogroup" aria-label="Result date">
            <button type="button" role="radio" aria-checked={date === "today"} onClick={() => setDate("today")}>
              Today{today ? ` · ${fmtDay(today, { weekday: true })}` : ""}
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px", fontWeight: 600, color: "var(--ink-3)" }}>
              <Calendar size={16} />
              <span className="sr-only">Other date</span>
              <input type="date" className="input" style={{ height: 36 }} max={today} value={date === "today" ? "" : date} onChange={(e) => setDate(e.target.value || "today")} />
            </label>
          </div>
        </div>
        {adding && (
          <div className="col">
            <input className="input" autoFocus placeholder="Search tests (e.g. ferritin, INR)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tests" />
            <div className="combo-list">
              {addable.slice(0, 8).map((l) => (
                <button type="button" key={l.code} onClick={() => (setRows([...rows, l.code]), setPreset(null), setQ(""), setAdding(false))}>
                  <b>{l.display}</b>
                  <span className="muted small">{l.category} · {l.unit}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="lab-grid">
          <div className="lab-row head">
            <span>TEST</span>
            <span>RESULT</span>
            <span>UNIT</span>
            <span>PREVIOUS</span>
            <span />
          </div>
          {rows.map((code, i) => {
            const def = MEASURES[code];
            const v = num(code);
            const flag = v != null && !Number.isNaN(v) ? flagFor(v, def.ref) : null;
            const p = prev(code);
            return (
              <div key={code}>
                <div className={`lab-row ${flag === "high" ? "hi" : ""}`}>
                  <label className="n" htmlFor={`lab-${code}`}>{def.display}</label>
                  <input
                    id={`lab-${code}`}
                    className={`input num ${flag ? "bad" : ""}`}
                    inputMode="decimal"
                    autoFocus={i === 0}
                    value={values[code] ?? ""}
                    onChange={(e) => setValues({ ...values, [code]: e.target.value })}
                    aria-invalid={Number.isNaN(v as number)}
                  />
                  {def.convert ? (
                    <select className="input" style={{ height: 40, width: 104, fontSize: 13 }} aria-label={`${def.display} unit`} value={units[code] ?? def.unit} onChange={(e) => setUnits({ ...units, [code]: e.target.value })}>
                      {[def.unit, ...Object.keys(def.convert)].map((u) => <option key={u}>{u}</option>)}
                    </select>
                  ) : (
                    <span className="u">{def.unit}</span>
                  )}
                  <span className="p">
                    {p ? `${formatNumber(p.value, def.decimals)} · ${fmtDay(p.at)}` : "—"}
                    {flag && <> <Tag sev={flag === "high" ? "red" : "orange"}>{flag.toUpperCase()}</Tag></>}
                  </span>
                  <button type="button" className="icon-btn" style={{ width: 32, height: 32, border: 0 }} aria-label={`Remove ${def.display}`} onClick={() => setRows(rows.filter((c) => c !== code))}>
                    <X size={16} />
                  </button>
                </div>
                {code === "creatinine" && (
                  <div className="lab-row calc">
                    <span className="n">eGFR</span>
                    <span className="calc-val">{egfr ? formatNumber(egfr, 0) : "—"}</span>
                    <span className="u">mL/min/1.73m²</span>
                    <span className="small" style={{ fontWeight: 700, color: "var(--blue-ink)" }}>Calculated · CKD-EPI 2021</span>
                    <span />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <details>
          <summary style={{ fontWeight: 700, color: "var(--action)", cursor: "pointer" }}>Advanced details · lab, specimen, collection time</summary>
          <p className="muted small" style={{ fontWeight: 500 }}>Source is recorded as clinician entry with your name and the time. Laboratory interface import is planned; nothing else is needed for routine entry.</p>
        </details>
        {filled.length > 0 && (
          <div className="infobox">
            <Check size={18} color="var(--green)" style={{ flexShrink: 0 }} />
            <span>Saving closes any planned check waiting for these results and re-runs the rules that read them.</span>
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
