// The editable suggestion line (workflow redesign, slice 2): a guideline suggestion opens inline as one line —
// medicine, dose, start date and the check that follows — each prefilled and each changeable, with the
// pre-start safety check underneath. Confirm records it; "More options" opens the full medicine drawer.
// A red contraindication needs a reason before the start is accepted (the server enforces it too).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { api, useData } from "../api";
import { DIAGNOSIS, MEASURES, MEDICATION, MEDICATIONS, doseLabel, formatNumber, type MedicationDef } from "../../shared/catalog";
import { addDays, flagFor, fmtDay } from "../../shared/clinical";
import { monitoringFor, targetCodes } from "../../shared/drug-monitoring";
import type { Open } from "./Patient";

// the class a suggestion can be swapped within (same class, single agents only)
const CLASS_KEYS = ["raas", "bb", "mra", "sglt2", "glp1-cv", "statin", "p2y12", "doac", "pcsk9", "loop", "iv-iron", "dpp4", "ppi"];
export function alternatives(def: MedicationDef, active: Set<string>) {
  const key = CLASS_KEYS.find((k) => def.tags.includes(k));
  if (!key) return [def];
  return [def, ...MEDICATIONS.filter((m) => m.code !== def.code && m.tags.includes(key) && !/combination/i.test(m.drugClass) && !active.has(m.code) && (key === "ppi" || m.indications.some((t) => def.indications.includes(t))))];
}

type Hit = { severity: "red" | "orange" | "yellow"; title: string; detail: string; source: string };
const noonIso = (day: string, today: string) => (day === today ? undefined : new Date(`${day}T12:00:00`).toISOString());

export function DateField({ label, value, onChange, today, quick, max }: { label: string; value: string; onChange(v: string): void; today: string; quick: { label: string; days: number }[]; max?: string }) {
  return (
    <span className="sl-field sl-date">
      <small>{label}</small>
      <span className="sl-date-row">
        {quick.map((q) => {
          const d = addDays(today, q.days);
          return (
            <button key={q.label} type="button" className="sl-q" aria-pressed={value === d} onClick={() => onChange(d)}>{q.label}</button>
          );
        })}
        <input type="date" className="sl-input" aria-label={label} value={value} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} />
      </span>
    </span>
  );
}

function patientTags(s: any) {
  return new Set<string>(s.header.diagnoses.flatMap((d: any) => DIAGNOSIS[d.code]?.tags ?? []));
}

export function SuggestLine({ a, s, open, done, onCancel }: { a: any; s: any; open(o: Open): void; done(message?: string, r?: any): void; onCancel(): void }) {
  const act = a.action;
  return act.type === "titrate" ? <TitrateLine a={a} s={s} open={open} done={done} onCancel={onCancel} /> : <StartLine a={a} s={s} open={open} done={done} onCancel={onCancel} />;
}

function StartLine({ a, s, open, done, onCancel }: { a: any; s: any; open(o: Open): void; done(message?: string, r?: any): void; onCancel(): void }) {
  const today: string = s.today;
  const active = useMemo(() => new Set<string>(s.medications.groups.flatMap((g: any) => g.meds.map((m: any) => m.code))), [s]);
  const first = MEDICATION[a.action.code];
  const alts = useMemo(() => alternatives(first, active), [first, active]);
  const [code, setCode] = useState<string>(first.code);
  const def = MEDICATION[code];
  const [dose, setDose] = useState<number | null>(a.action.dose ?? def.doses[0] ?? null);
  const [start, setStart] = useState(today);
  const [override, setOverride] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data: check } = useData<{ hits: Hit[]; start: { dose: number } | null }>(`/patients/${s.header.id}/medication-check/${code}`, [code]);
  useEffect(() => {
    if (check?.start) setDose(check.start.dose);
  }, [check?.start?.dose]);
  const pickDrug = (c: string) => {
    setCode(c);
    const d = MEDICATION[c];
    // keep the suggested dose only for the suggested medicine; others start at their lowest strength
    setDose(c === first.code ? a.action.dose ?? d.doses[0] ?? null : d.doses[0] ?? null);
  };
  // monitoring: the medicine's schedule (label / guideline), else a renal/K check when it needs one
  const schedule = monitoringFor(def.code, def.tags);
  const scheduleRenal = schedule.some((k) => targetCodes(k.target).some((c) => c === "potassium" || c === "creatinine"));
  const renalK = !scheduleRenal && def.monitoring.some((c) => c === "potassium" || c === "creatinine");
  const [check1, setCheck1] = useState(addDays(today, 7));
  const tags = patientTags(s);
  const indication = def.indicationChoices?.[0] ?? def.indications.find((t) => tags.has(t)) ?? "unspecified";
  const reds = (check?.hits ?? []).filter((h) => h.severity === "red");
  const needReason = reds.length > 0;
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api(`/patients/${s.header.id}/medications`, {
        body: {
          code, doseValue: dose, frequency: def.frequencies[0], route: def.routes[0], indication, reason: a.title,
          effectiveAt: noonIso(start, today), contextId: s.header.openContext?.id ?? null,
          monitoring: renalK ? { dueDate: check1, title: "Renal function and potassium check", codes: ["potassium", "creatinine"] } : null,
          bookSchedule: schedule.length > 0,
          ...(needReason ? { override } : {}),
        },
      });
      done(`${def.name} started${renalK ? ` · K/creatinine check ${fmtDay(check1, { weekday: true })}` : schedule.length ? " · monitoring booked" : ""}`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="sline" role="group" aria-label={`Start ${def.name}`}>
      <div className="sl-row">
        <label className="sl-field">
          <small>Medicine</small>
          <span className="sl-select">
            <select value={code} onChange={(e) => pickDrug(e.target.value)} aria-label="Medicine" disabled={alts.length < 2}>
              {alts.map((m) => <option key={m.code} value={m.code}>{m.name}{m.code === first.code ? " (suggested)" : ""}</option>)}
            </select>
            {alts.length > 1 && <ChevronDown size={16} aria-hidden="true" />}
          </span>
        </label>
        {def.doses.length > 0 && (
          <label className="sl-field">
            <small>Dose</small>
            <span className="sl-select">
              <select value={dose ?? ""} onChange={(e) => setDose(Number(e.target.value))} aria-label="Dose">
                {def.doses.map((d) => <option key={d} value={d}>{doseLabel(def, d)}{d === a.action.dose && code === first.code ? " (suggested)" : ""}</option>)}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </label>
        )}
        <span className="sl-field sl-static"><small>How</small><b>{def.frequencies[0]} · {def.routes[0]}</b></span>
        <DateField label="Start" value={start} onChange={setStart} today={today} max={today} quick={[{ label: "Today", days: 0 }]} />
        {renalK && <DateField label="K / creatinine check" value={check1} onChange={setCheck1} today={today} quick={[{ label: "1 wk", days: 7 }, { label: "2 wk", days: 14 }]} />}
      </div>
      <BeforeStart codes={def.monitoring} s={s} />
      <Safety hits={check?.hits ?? null} />
      {schedule.length > 0 && <div className="sl-note">Monitoring booked from the label schedule: {schedule.map((k) => `${k.what.toLowerCase()} (${k.schedule})`).join("; ")}.</div>}
      {needReason && (
        <label className="sl-override">
          <span>Reason to start despite the contraindication</span>
          <input className="input" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. specialist advice, benefit outweighs risk, interacting drug stopped" />
        </label>
      )}
      {error && <div className="error-box">{error}</div>}
      <div className="sl-actions">
        <button className={`btn small ${needReason ? "danger" : "primary"}`} disabled={busy || (needReason && override.trim().length < 3)} onClick={save}>
          {busy ? "Saving…" : needReason ? `Start ${def.name} anyway` : `Start ${def.name}${dose != null ? " " + doseLabel(def, dose) : ""}`}
        </button>
        <button className="btn ghost small" onClick={() => open({ kind: "med-add", code, dose: dose ?? undefined, reason: a.title })}>More options</button>
        <button className="btn ghost small" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function TitrateLine({ a, s, open, done, onCancel }: { a: any; s: any; open(o: Open): void; done(message?: string, r?: any): void; onCancel(): void }) {
  const today: string = s.today;
  const med = s.medications.groups.flatMap((g: any) => g.meds).find((m: any) => m.id === a.action.medicationId);
  const def = med ? MEDICATION[med.code] : null;
  const [dose, setDose] = useState<number>(a.action.dose);
  const [when, setWhen] = useState(today);
  // the check after a dose change: the medicine's own schedule (label / guideline) when it has one, else K/creatinine
  // at 1 week for drugs that need it, else a titration review at 2 weeks (ESC HF: uptitrate every 1–2 weeks)
  const sched = def ? monitoringFor(def.code, def.tags).find((k) => k.on === "change" && k.after?.length && "lab" in k.target) : undefined;
  const kidney = !sched && !!def?.monitoring.some((c) => c === "potassium" || c === "creatinine");
  const follow = sched
    ? { days: sched.after![0], title: `${sched.what} check`, codes: targetCodes(sched.target), label: `${sched.what} check`, source: `${sched.schedule} (${sched.source})` }
    : kidney ? { days: 7, title: "Renal function and potassium check", codes: ["potassium", "creatinine"], label: "K / creatinine check", source: null }
    : { days: 14, title: `${def?.name ?? ""} titration review`, codes: [] as string[], label: "Review", source: null };
  const [review, setReview] = useState(addDays(today, follow.days));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!med || !def) return null;
  const up = a.action.direction === "increase";
  const options = def.doses.filter((d) => (up ? med.doseValue == null || d > med.doseValue : med.doseValue == null || d < med.doseValue));
  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api(`/patients/${s.header.id}/medications/${med.id}/events`, {
        body: {
          kind: dose > (med.doseValue ?? 0) ? "increase" : "decrease", doseValue: dose, reason: up ? "Titration toward target" : a.title,
          effectiveAt: noonIso(when, today), contextId: s.header.openContext?.id ?? null,
          review: { dueDate: review, title: follow.title, ...(follow.codes.length ? { codes: follow.codes } : {}) },
        },
      });
      done(`${def!.name} ${up ? "increased" : "reduced"} to ${doseLabel(def!, dose)} · ${follow.label.toLowerCase()} ${fmtDay(review, { weekday: true })}`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="sline" role="group" aria-label={`Change ${def.name} dose`}>
      <div className="sl-row">
        <span className="sl-field sl-static"><small>Medicine</small><b>{def.name} {med.doseValue != null ? doseLabel(def, med.doseValue) : ""}</b></span>
        <label className="sl-field">
          <small>New dose</small>
          <span className="sl-select">
            <select value={dose} onChange={(e) => setDose(Number(e.target.value))} aria-label="New dose">
              {options.map((d) => <option key={d} value={d}>{doseLabel(def, d)}{d === a.action.dose ? " (suggested)" : ""}{def.target === d ? " · target" : ""}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </label>
        <DateField label="From" value={when} onChange={setWhen} today={today} max={today} quick={[{ label: "Today", days: 0 }]} />
        <DateField label={follow.label} value={review} onChange={setReview} today={today} quick={follow.days > 14 ? [{ label: `${Math.round(follow.days / 7)} wk`, days: follow.days }] : [{ label: "1 wk", days: 7 }, { label: "2 wk", days: 14 }]} />
      </div>
      {follow.source && <div className="sl-note">{follow.label}: {follow.source}.</div>}
      {error && <div className="error-box">{error}</div>}
      <div className="sl-actions">
        <button className="btn primary small" disabled={busy} onClick={save}>{busy ? "Saving…" : `${up ? "Increase" : "Reduce"} to ${doseLabel(def, dose)}`}</button>
        <button className="btn ghost small" onClick={() => open({ kind: "med-action", medId: med.id, action: a.action.direction, dose, reason: up ? "Titration toward target" : a.title })}>More options</button>
        <button className="btn ghost small" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// the values this medicine is checked against before a start (its monitoring list), as a one-line checklist
function BeforeStart({ codes, s }: { codes: string[]; s: any }) {
  const rows = codes.map((code) => {
    const r = s.results?.find((x: any) => x.code === code);
    const v = r ? { value: r.current.value, at: r.current.at } : s.vitals?.find((x: any) => x.code === code);
    const m = MEASURES[code];
    return { code, label: m?.short ?? code, v, flag: v ? flagFor(v.value, m?.ref) : null, unit: m?.unit ?? "", dec: m?.decimals ?? 0 };
  });
  if (!rows.length) return null;
  return (
    <div className="sl-before" aria-label="Before starting">
      <span>Before starting</span>
      {rows.map((r) => (
        <em key={r.code} className={!r.v ? "miss" : r.flag ? "flag" : "ok"} title={r.v ? fmtDay(r.v.at, { year: true }) : "Not recorded"}>
          {r.label} {r.v ? `${formatNumber(r.v.value, r.dec)}${r.unit && r.unit !== "ratio" ? " " + r.unit : ""} · ${fmtDay(r.v.at)}` : "not recorded"}
        </em>
      ))}
    </div>
  );
}

function Safety({ hits }: { hits: Hit[] | null }) {
  if (!hits) return <div className="sl-safety muted">Checking contraindications and interactions…</div>;
  if (!hits.length) return <div className="sl-safety ok"><CheckCircle2 size={15} /> No contraindication or interaction with the current medicines and problem list.</div>;
  return (
    <div className="sl-hits">
      {hits.map((h, i) => (
        <div key={i} className={`sl-hit sev-${h.severity}`}>
          <AlertTriangle size={15} />
          <span><b>{h.title}</b> {h.detail} <small>{h.source}</small></span>
        </div>
      ))}
    </div>
  );
}
