import { useMemo, useState } from "react";
import { Calendar, FlaskConical, X, Check } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, Tag, DateInput } from "../ui";
import { LABS, LAB_PRESETS, MEASURES, formatNumber } from "../../shared/catalog";
import { egfrCkdEpi2021, flagFor, fmtDay } from "../../shared/clinical";

export function QuickLabs({ patientId, codes, contextId, onClose, onDone }: { patientId: string; codes?: string[]; contextId?: string; onClose(): void; onDone(msg?: string, r?: any): void }) {
  const { data: rec } = useData<any>(`/patients/${patientId}/record`);
  const { data: sum } = useData<any>(`/patients/${patientId}/summary`);
  const [preset, setPreset] = useState<string | null>(codes ? null : "renal");
  const [rows, setRows] = useState<string[]>(codes ?? LAB_PRESETS[0].codes);
  const [values, setValues] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [date, setDate] = useState<string>("today");
  const [dateEditing, setDateEditing] = useState(false);
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
  const close = () => {
    if (busy) return;
    if (Object.values(values).some((v) => v.trim()) && !window.confirm("Discard the unsaved lab results?")) return;
    onClose();
  };
  const choosePreset = (id: string) => {
    const p = LAB_PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setRows([...new Set([...p.codes, ...rows.filter((c) => values[c]?.trim())])]);
  };
  const addable = useMemo(() => LABS.filter((l) => !l.derived && !rows.includes(l.code) && (l.display + l.short).toLowerCase().includes(q.toLowerCase())), [rows, q]);
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !filled.length || invalid.length || !date) return;
    setBusy(true);
    setError("");
    try {
      const effectiveAt = date === "today" ? new Date().toISOString() : new Date(`${date}T08:00:00+03:00`).toISOString();
      const r = await api(`/patients/${patientId}/observations`, {
        body: { effectiveAt, contextId: contextId ?? null, items: filled.map((code) => ({ code, value: Number(values[code].replace(",", ".")), unit: units[code] ?? MEASURES[code].unit })) },
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
      onClose={close}
      head={
        <div className="row wrap" style={{ gap: 8 }}>
          <select className="input" style={{ width: "auto", minHeight: 38 }} aria-label="Lab panel" value={preset ?? "custom"} onChange={(e) => choosePreset(e.target.value)}>
            <option value="custom" disabled>Selected tests</option>
            {LAB_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button type="button" className="choice" style={{ minHeight: 38, borderStyle: "dashed" }} aria-pressed={false} onClick={() => setAdding(true)}>
            + Any test
          </button>
        </div>
      }
      footer={
        <>
          <span className="note">Tab: next result · Alt+U: units · Enter: save</span>
          <span className="end">
            <button className="btn ghost" onClick={close} style={{ color: "var(--ink-3)" }}>Cancel</button>
            <button className="btn primary" form="labs-form" disabled={busy || !filled.length || invalid.length > 0 || !date}>
              {busy ? "Saving…" : `Save ${filled.length || ""} result${filled.length === 1 ? "" : "s"}`}
            </button>
          </span>
        </>
      }
    >
      <form id="labs-form" className="drawer-body" onSubmit={save}>
        <div className="lab-date">
          <div className="lab-date-current">
            <Calendar size={17} aria-hidden="true" />
            <span><b>Result date</b><span>{date === "today" ? `Today${today ? ` · ${fmtDay(today, { weekday: true })}` : ""}` : date ? fmtDay(date, { weekday: true, year: true }) : "Choose a date"}</span></span>
            <button type="button" className="btn ghost small" aria-expanded={dateEditing} aria-controls="lab-date-edit" onClick={() => setDateEditing(!dateEditing)}>{dateEditing ? "Hide date entry" : "Change date"}</button>
          </div>
          {dateEditing && <div id="lab-date-edit" className="lab-date-edit">
            <DateInput className="input" aria-label="Result date" autoFocus max={today} value={date === "today" ? today ?? "" : date} onChange={(e) => setDate(e.target.value)} />
            <button type="button" className="btn secondary small" onClick={() => { setDate("today"); setDateEditing(false); }}>Use today</button>
            {!date && <span className="help">Enter a complete past or current date, or use today.</span>}
          </div>}
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
                    data-autofocus={i === 0 || undefined}
                    value={values[code] ?? ""}
                    onChange={(e) => setValues({ ...values, [code]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.altKey && e.key.toLowerCase() === "u") {
                        const unit = e.currentTarget.parentElement?.querySelector("select");
                        if (unit) { e.preventDefault(); unit.focus(); }
                      }
                      if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
                        const next = rows[i + (e.shiftKey ? -1 : 1)];
                        if (next) { e.preventDefault(); document.getElementById(`lab-${next}`)?.focus(); }
                      }
                    }}
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
                  <button type="button" className="icon-btn" style={{ width: 32, height: 32, border: 0 }} aria-label={`Remove ${def.display}`} onClick={() => {
                    if (values[code]?.trim() && !window.confirm(`Discard the unsaved ${def.display} result?`)) return;
                    setRows(rows.filter((c) => c !== code));
                    setValues((v) => { const next = { ...v }; delete next[code]; return next; });
                  }}>
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
