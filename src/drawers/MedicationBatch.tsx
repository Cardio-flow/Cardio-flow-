// Several medicines at once (clinic visit, 7 Oct 2026): the guideline suggestions for this patient are
// listed first and can be ticked; any other medicine is added from the search; each row keeps its own dose,
// frequency, indication, pre-start check and monitoring; one Save starts them all (all or none).
import { useEffect, useMemo, useState, useId } from "react";
import { Pill, Search, X } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, Tag } from "../ui";
import { MEDICATION, MEDICATIONS, PURPOSE_FOR_TAG, PURPOSE_ORDER, doseLabel, medicationSearchText } from "../../shared/catalog";
import { addDays } from "../../shared/clinical";
import { monitoringFor, targetCodes } from "../../shared/drug-monitoring";
import { patientTags, tagLabel } from "./Medication";

type Hit = { severity: "red" | "orange" | "yellow"; title: string; detail: string; source: string };
type Row = { code: string; dose: string; freq: string; indication: string; reason?: string; book: boolean; override: string };

export function AddMedications({ patientId, summary, contextId, onClose, onDone }: { patientId: string; summary: any; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const tags = patientTags(summary);
  const active = new Set<string>(summary.medications.groups.flatMap((g: any) => g.meds.map((m: any) => m.code)));
  // guideline start suggestions, one per drug
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    return (summary.attention ?? [])
      .filter((a: any) => a.action?.type === "start-med" && MEDICATION[a.action.code] && !active.has(a.action.code))
      .filter((a: any) => (seen.has(a.action.code) ? false : (seen.add(a.action.code), true)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hits, setHits] = useState<Record<string, Hit[]>>({});
  const relevant = PURPOSE_ORDER.filter((p) => [...tags].some((t) => PURPOSE_FOR_TAG[t]?.includes(p)));
  const taken = new Set(rows.map((r) => r.code));
  const matches = useMemo(
    () => MEDICATIONS.filter((m) => !active.has(m.code) && !taken.has(m.code) && (q.trim() ? medicationSearchText(m).includes(q.trim().toLowerCase()) : m.indications.some((t) => tags.has(t)))).slice(0, q.trim() ? 30 : 16),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, rows.length],
  );
  function add(code: string, dose?: number, reason?: string) {
    const d = MEDICATION[code];
    if (!d || taken.has(code)) return;
    const matching = [...new Set(d.indications.filter((t) => tags.has(t)))];
    const pickDose = dose != null ? dose : d.doses[0];
    setRows((r) => [...r, { code, dose: pickDose != null ? String(pickDose) : "", freq: d.frequencies[0], indication: matching[0] ?? (d.indicationChoices?.[0] ?? "unspecified"), reason, book: true, override: "" }]);
    setQ("");
  }
  const remove = (code: string) => setRows((r) => r.filter((x) => x.code !== code));
  const upd = (code: string, p: Partial<Row>) => setRows((r) => r.map((x) => (x.code === code ? { ...x, ...p } : x)));
  const needOverride = rows.filter((r) => (hits[r.code] ?? []).some((h) => h.severity === "red") && r.override.trim().length < 3);
  const valid = rows.length > 0 && rows.every((r) => r.freq && (r.dose === "" || Number(r.dose) > 0)) && needOverride.length === 0;
  async function save() {
    setBusy(true);
    setError("");
    try {
      const items = rows.map((r) => {
        const d = MEDICATION[r.code];
        const schedule = monitoringFor(d.code, d.tags);
        const scheduleRenal = schedule.some((k) => targetCodes(k.target).some((c) => c === "potassium" || c === "creatinine"));
        const renalK = !scheduleRenal && d.monitoring.some((c) => c === "potassium" || c === "creatinine");
        const reds = (hits[r.code] ?? []).some((h) => h.severity === "red");
        return {
          code: r.code, doseValue: r.dose ? Number(r.dose) : null, frequency: r.freq, route: d.routes[0], indication: r.indication || "unspecified",
          contextId: contextId ?? null, reason: r.reason,
          monitoring: renalK && r.book ? { dueDate: addDays(summary.today, 7), title: "Renal function and potassium check", codes: ["potassium", "creatinine"] } : null,
          bookSchedule: schedule.length > 0 && r.book,
          ...(reds ? { override: r.override.trim() } : {}),
        };
      });
      const res = await api(`/patients/${patientId}/medications/batch`, { body: { items } });
      onDone(`${rows.length} medicine${rows.length === 1 ? "" : "s"} started: ${rows.map((r) => MEDICATION[r.code].name).join(", ")}`, res);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      wide
      title="Add medicines"
      subtitle="Tick the suggestions, add any others, check each line, then save them together"
      icon={<Pill size={22} />}
      onClose={onClose}
      footer={
        <>
          <span className="note">{rows.length ? `${rows.length} to start${needOverride.length ? ` · reason needed for ${needOverride.map((r) => MEDICATION[r.code].name).join(", ")}` : ""}` : "Nothing chosen yet"}</span>
          <span className="end">
            <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : rows.length > 1 ? `Start all ${rows.length}` : "Start"}</button>
          </span>
        </>
      }
    >
      <div className="drawer-body">
        {suggestions.length > 0 && (
          <section className="mb-box">
            <div className="mb-head"><b>Suggested by the guidelines</b><span>tap to add · the starting dose is the suggestion's</span></div>
            <div className="mb-sugs">
              {suggestions.map((a: any) => {
                const on = taken.has(a.action.code);
                return (
                  <button key={a.id} type="button" className={`mb-sug sev-${a.severity}`} aria-pressed={on} onClick={() => (on ? remove(a.action.code) : add(a.action.code, a.action.dose, a.title))}>
                    <b>{MEDICATION[a.action.code].name}{a.action.dose ? ` ${doseLabel(MEDICATION[a.action.code], a.action.dose)}` : ""}</b>
                    <span>{a.title}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        <section className="mb-box">
          <div className="mb-head"><b>Add another medicine</b><span>{q ? "search results" : relevant.length ? "relevant to this patient" : "search by generic or trade name"}</span></div>
          <label className="row dx-search">
            <Search size={18} color="var(--ink-4)" />
            <input className="grow" placeholder="Search by generic or trade name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search medicines" />
          </label>
          <div className="mb-picks">
            {matches.map((m) => (
              <button key={m.code} type="button" className="dx-pick" onClick={() => add(m.code)}>
                {m.name} <span className="muted small">{m.drugClass}</span>
              </button>
            ))}
            {!matches.length && <span className="muted small">No match.</span>}
          </div>
        </section>
        {rows.length > 0 && (
          <section className="mb-box">
            <div className="mb-head"><b>To start</b><span>check each line</span></div>
            {rows.map((r) => (
              <MedRow key={r.code} patientId={patientId} summary={summary} row={r} upd={(p) => upd(r.code, p)} remove={() => remove(r.code)} onHits={(h) => setHits((x) => (x[r.code] === h ? x : { ...x, [r.code]: h }))} />
            ))}
          </section>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

function MedRow({ patientId, summary, row, upd, remove, onHits }: { patientId: string; summary: any; row: Row; upd(p: Partial<Row>): void; remove(): void; onHits(h: Hit[]): void }) {
  const d = MEDICATION[row.code];
  const [editing, setEditing] = useState(false);
  const fieldsId = useId();
  const tags = patientTags(summary);
  const { data: check } = useData<{ hits: Hit[]; start: { dose: number } | null }>(`/patients/${patientId}/medication-check/${row.code}`, [row.code]);
  const hits = check?.hits ?? [];
  useEffect(() => {
    if (check) onHits(check.hits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check]);
  const reds = hits.filter((h) => h.severity === "red");
  const schedule = monitoringFor(d.code, d.tags);
  const renal = d.monitoring.some((c) => c === "potassium" || c === "creatinine");
  const indications = d.indicationChoices ?? [...new Set([...d.indications.filter((t) => tags.has(t)), "unspecified"])];
  const doses = [...new Set([...(row.dose ? [Number(row.dose)] : []), ...d.doses])].sort((a, b) => a - b);
  return (
    <div className={`mb-row ${reds.length ? "red" : ""}`}>
      <div className="mb-row-top">
        <b>{d.name}</b>
        <span className="muted small mb-meta">{d.drugClass}{d.brands?.length ? ` · ${d.brands.join(", ")}` : ""}</span>
        <button type="button" className="btn ghost small" style={{ marginLeft: "auto" }} onClick={remove} aria-label={`Remove ${d.name}`}><X size={14} /> Remove</button>
      </div>
      <div className="mb-summary">
        <div><b>{row.dose ? doseLabel(d, Number(row.dose)) : "Dose not specified"} · {row.freq}</b><span>{row.indication === "unspecified" ? "Indication not specified" : d.indicationChoices ? row.indication : tagLabel(row.indication, summary)}</span></div>
        <button type="button" className="btn ghost small" aria-expanded={editing} aria-controls={fieldsId} onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit"}<span className="sr-only"> {d.name}</span></button>
      </div>
      <div id={fieldsId} className="mb-fields" data-editing={editing}>
        <label className="field">
          <span>Dose</span>
          <select className="input" value={row.dose} onChange={(e) => upd({ dose: e.target.value })}>
            {doses.map((x) => <option key={x} value={x}>{doseLabel(d, x)}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Frequency</span>
          <select className="input" value={row.freq} onChange={(e) => upd({ freq: e.target.value })}>
            {[...new Set([row.freq, ...d.frequencies])].map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Indication</span>
          <select className="input" value={row.indication} onChange={(e) => upd({ indication: e.target.value })}>
            {indications.map((t) => <option key={t} value={t}>{t === "unspecified" ? "Not specified" : d.indicationChoices ? t : tagLabel(t, summary)}</option>)}
          </select>
        </label>
      </div>
      {(schedule.length > 0 || renal) && (
        <label className="mb-book">
          <input type="checkbox" checked={row.book} onChange={(e) => upd({ book: e.target.checked })} />
          <span>{schedule.length ? "Book its monitoring schedule" : "Book K⁺ and creatinine in 1 week"}</span>
        </label>
      )}
      {check?.start && <div className="mb-note">Label starting dose {check.start.dose} mg for this patient.</div>}
      {hits.length > 0 && (
        <div className="mb-hits">
          {hits.map((h, i) => <span key={i} className={`chip sev sev-${h.severity}`}><span className="dot" />{h.title}</span>)}
        </div>
      )}
      {reds.length > 0 && (
        <label className="sl-override">
          <span>Reason to start despite the contraindication (required)</span>
          <input className="input" value={row.override} onChange={(e) => upd({ override: e.target.value })} placeholder="e.g. specialist advice, benefit outweighs risk" />
        </label>
      )}
      {!check && <Tag sev="gray">Checking…</Tag>}
    </div>
  );
}
