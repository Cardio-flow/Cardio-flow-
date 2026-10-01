import { useMemo, useState } from "react";
import { ClipboardList, IdCard, X } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, SingleChoice } from "../ui";
import { DIAGNOSIS } from "../../shared/catalog";
import { DIAGNOSIS_ATTRIBUTES, HISTORY_ITEMS, MULTIPLE_ALLOWED, fieldShown, type HistoryItem } from "../../shared/history";
import { fmtDay } from "../../shared/clinical";

// One editable diagnosis: new (add) or existing (update).
type Dx = { key: string; code: string; logicalId?: string; attributes: Record<string, any>; onset: string; onsetYear: string; dirty?: boolean; label?: string; expanded?: boolean };
type Row = {
  answer?: string; // yes | no | unknown | not-assessed | <status option>
  initial?: string;
  resolveAs?: "resolved" | "entered_in_error";
  packYears?: string;
  quitYear?: string;
  initialDetail?: string;
  dx: Dx[];
};

const CONDITION_ANSWERS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Unknown" },
  { value: "not-assessed", label: "Not assessed" },
];

function initialRow(item: HistoryItem, v: any): Row {
  const dx: Dx[] = (v?.conditions ?? []).map((c: any) => ({
    key: c.id, code: c.code, logicalId: c.id, attributes: { ...c.attributes }, onset: c.onset ?? "", onsetYear: c.onsetYear ? String(c.onsetYear) : "",
    label: c.label + (c.onset ? ` · ${fmtDay(c.onset, { year: true })}` : c.onsetYear ? ` · ${c.onsetYear}` : ""),
  }));
  if (item.conditions) {
    const answer = v?.status === "present" ? "yes" : v?.status === "absent" ? "no" : v?.status === "unknown" || v?.status === "not-assessed" ? v.status : undefined;
    return { answer, initial: answer, dx };
  }
  // status items: the current answer and its numeric detail
  const opt = v?.status === "not-recorded" || v?.source !== "history" ? undefined : v.answer ?? undefined;
  const pack = v?.details?.packYears != null ? String(v.details.packYears) : "";
  const quit = v?.details?.quitYear != null ? String(v.details.quitYear) : "";
  return { answer: opt, initial: opt, packYears: pack, quitYear: quit, initialDetail: pack + "|" + quit, dx };
}

export function HistoryDrawer({ patientId, focus, onClose, onDone }: { patientId: string; focus?: "risk" | "cardiac"; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data } = useData<any>(`/patients/${patientId}/history`);
  const [rows, setRows] = useState<Record<string, Row> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asOf, setAsOf] = useState("");
  if (data && !rows) {
    setRows(Object.fromEntries(HISTORY_ITEMS.map((i) => [i.key, initialRow(i, data.items.find((x: any) => x.key === i.key))])));
    setAsOf(data.today);
  }
  const set = (key: string, patch: Partial<Row>) => setRows((r) => ({ ...r!, [key]: { ...r![key], ...patch } }));

  const payload = useMemo(() => {
    if (!rows) return null;
    const answers: any[] = [], add: any[] = [], update: any[] = [], problems: string[] = [];
    for (const item of HISTORY_ITEMS) {
      const r = rows[item.key];
      if (item.conditions) {
        if (r.answer === "yes") {
          const fresh = r.dx.filter((d) => !d.logicalId);
          if (!r.dx.length) problems.push(`${item.label}: choose the diagnosis`);
          for (const d of fresh) add.push(dxBody(d));
          for (const d of r.dx.filter((d) => d.logicalId && d.dirty)) update.push({ logicalId: d.logicalId, ...dxBody(d) });
        } else if (r.answer && r.answer !== r.initial) {
          if (r.initial === "yes" && r.answer !== "no") problems.push(`${item.label}: to remove a diagnosis answer "No" and say why`);
          else if (r.initial === "yes" && !r.resolveAs) problems.push(`${item.label}: resolved, or entered in error?`);
          else answers.push({ item: item.key, answer: r.answer, resolveAs: r.initial === "yes" ? r.resolveAs : undefined });
        }
      } else if (r.answer && (r.answer !== r.initial || (r.packYears ?? "") + "|" + (r.quitYear ?? "") !== r.initialDetail)) {
        const body: any = { item: item.key, answer: r.answer };
        if (r.packYears && ["current", "ex"].includes(r.answer)) body.packYears = Number(r.packYears);
        if (r.quitYear && r.answer === "ex") body.quitYear = Number(r.quitYear);
        answers.push(body);
      }
    }
    return { answers, add, update, problems };
  }, [rows]);
  const count = payload ? payload.answers.length + payload.add.length + payload.update.length : 0;

  async function save() {
    if (!payload) return;
    setBusy(true);
    setError("");
    try {
      const effectiveAt = asOf && data && asOf !== data.today ? new Date(`${asOf}T12:00:00+03:00`).toISOString() : undefined;
      const r = await api(`/patients/${patientId}/history`, { body: { answers: payload.answers, add: payload.add, update: payload.update, effectiveAt } });
      onDone(`History saved · ${count} change${count === 1 ? "" : "s"}`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const sections: { key: "risk" | "cardiac"; title: string; help: string }[] = [
    { key: "risk", title: "Risk factors", help: "Yes is a diagnosis on the problem list. No, Unknown and Not assessed are dated statements, so a blank is never read as no." },
    { key: "cardiac", title: "Past cardiac history", help: "Add each diagnosis with its detail and date (the year is enough when the day is not known)." },
  ];
  const ordered = focus === "cardiac" ? [sections[1], sections[0]] : sections;
  return (
    <Drawer
      title="Structured history"
      subtitle="Select, don't type. Only what you change is saved, dated as below."
      icon={<ClipboardList size={22} />}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="note">
            {payload?.problems.length ? <span style={{ color: "var(--orange-ink)" }}>{payload.problems[0]}</span> : count ? `${count} change${count === 1 ? "" : "s"} to save` : "No changes yet"}
          </span>
          <span className="end">
            <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!count || !!payload?.problems.length || busy} onClick={save}>{busy ? "Saving…" : "Save history"}</button>
          </span>
        </>
      }
    >
      <div className="drawer-body">
        {!rows && <div className="empty">Loading…</div>}
        {rows && (
          <label className="field" style={{ maxWidth: 260 }}>
            <span>History taken on</span>
            <input type="date" className="input" value={asOf} max={data.today} onChange={(e) => setAsOf(e.target.value)} />
          </label>
        )}
        {rows &&
          ordered.map((sec) => (
            <section key={sec.key} className="hx-section">
              <div className="hx-section-head">
                <h3>{sec.title}</h3>
                <p>{sec.help}</p>
              </div>
              {HISTORY_ITEMS.filter((i) => i.section === sec.key).map((item) => (
                <HistoryRow key={item.key} item={item} row={rows[item.key]} view={data.items.find((x: any) => x.key === item.key)} bmi={item.key === "obesity" ? data.bmi : null} onChange={(p) => set(item.key, p)} />
              ))}
            </section>
          ))}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

function dxBody(d: Dx) {
  const attributes = Object.fromEntries(Object.entries(d.attributes).filter(([k, v]) => k !== "onsetYear" && v != null && v !== "" && !(Array.isArray(v) && !v.length)));
  return { code: d.code, attributes, onset: d.onset || null, onsetYear: !d.onset && d.onsetYear ? Number(d.onsetYear) : null };
}

function HistoryRow({ item, row, view, bmi, onChange }: { item: HistoryItem; row: Row; view: any; bmi: any; onChange(p: Partial<Row>): void }) {
  const since = view?.at ? `Recorded ${fmtDay(view.at, { year: true })}` : view?.source === "diagnosis" ? "On the diagnosis list" : "Not recorded";
  return (
    <div className={`hx-row ${row.answer && row.answer !== row.initial ? "changed" : ""}`}>
      <div className="hx-label">
        <b>{item.label}</b>
        <small>
          {since}
          {bmi ? ` · BMI ${bmi.value.toFixed(1)} (${fmtDay(bmi.at)})` : ""}
        </small>
        {view?.conflict && <small className="hx-conflict">{view.conflict}</small>}
      </div>
      <div className="hx-input">
        {item.conditions ? (
          <>
            <SingleChoice label={item.label} options={CONDITION_ANSWERS} value={row.answer} onChange={(v) => onChange({ answer: v, dx: v === "yes" ? row.dx : row.dx.filter((d) => d.logicalId) })} />
            {row.initial === "yes" && row.answer === "no" && (
              <div className="hx-resolve">
                <span>The diagnosis will leave the problem list. Was it</span>
                <SingleChoice
                  label="Reason"
                  options={[{ value: "resolved", label: "Resolved" }, { value: "entered_in_error", label: "Entered in error" }]}
                  value={row.resolveAs}
                  onChange={(v) => onChange({ resolveAs: v as Row["resolveAs"] })}
                />
              </div>
            )}
            {row.answer === "yes" && <DiagnosisEditor item={item} dx={row.dx} onChange={(dx) => onChange({ dx })} />}
          </>
        ) : (
          <>
            <SingleChoice label={item.label} options={item.options!} value={row.answer} onChange={(v) => onChange({ answer: v })} />
            {(item.details ?? []).filter((d) => row.answer && d.when.includes(row.answer)).length > 0 && (
              <div className="row wrap" style={{ gap: 14 }}>
                {item.details!
                  .filter((d) => d.when.includes(row.answer!))
                  .map((d) => (
                    <label key={d.key} className="field">
                      <span>{d.label} <em className="muted" style={{ fontWeight: 600, fontStyle: "normal" }}>(optional)</em></span>
                      <input
                        className="input num"
                        inputMode="numeric"
                        value={(row as any)[d.key] ?? ""}
                        onChange={(e) => onChange({ [d.key]: e.target.value.replace(/[^\d]/g, "").slice(0, 4) } as any)}
                        aria-invalid={!!(row as any)[d.key] && (Number((row as any)[d.key]) < d.min || Number((row as any)[d.key]) > d.max)}
                      />
                    </label>
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DiagnosisEditor({ item, dx, onChange }: { item: HistoryItem; dx: Dx[]; onChange(dx: Dx[]): void }) {
  const codes = item.conditions!.filter((c) => DIAGNOSIS[c] && !DIAGNOSIS[c].hidden);
  const addable = codes.filter((c) => MULTIPLE_ALLOWED.has(c) || !dx.some((d) => d.code === c));
  const upd = (key: string, patch: Partial<Dx>) => onChange(dx.map((d) => (d.key === key ? { ...d, ...patch, dirty: true } : d)));
  return (
    <div className="hx-dx">
      {dx.map((d) =>
        d.logicalId && !d.expanded ? (
          <div key={d.key} className="hx-dx-line">
            <b>{d.label}</b>
            <span className="small muted">On the problem list</span>
            <button type="button" className="btn ghost small" onClick={() => onChange(dx.map((x) => (x.key === d.key ? { ...x, expanded: true } : x)))}>
              Edit detail
            </button>
          </div>
        ) : (
        <div key={d.key} className="hx-dx-card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{DIAGNOSIS[d.code]?.display ?? d.code}</b>
            {!d.logicalId ? (
              <button type="button" className="icon-btn" aria-label={`Remove ${DIAGNOSIS[d.code]?.display}`} onClick={() => onChange(dx.filter((x) => x.key !== d.key))}>
                <X size={16} />
              </button>
            ) : (
              <span className="small muted" style={{ fontWeight: 700 }}>On the problem list</span>
            )}
          </div>
          {(DIAGNOSIS_ATTRIBUTES[d.code] ?? []).filter((f) => fieldShown(f, d.attributes)).map((f) => (
            <div key={f.key} className="hx-attr">
              <span>{f.label}</span>
              <div className="choices">
                {f.options.map((o) => {
                  const cur = d.attributes[f.key];
                  const on = f.multi ? (cur ?? []).includes(o) : cur === o;
                  return (
                    <button
                      key={o}
                      type="button"
                      className="choice small"
                      aria-pressed={on}
                      onClick={() =>
                        upd(d.key, { attributes: { ...d.attributes, [f.key]: f.multi ? (on ? cur.filter((x: string) => x !== o) : [...(cur ?? []), o]) : on ? undefined : o } })
                      }
                    >
                      {o}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="row wrap" style={{ gap: 14, alignItems: "flex-end" }}>
            <label className="field">
              <span>Date</span>
              <input type="date" className="input" value={d.onset} max={new Date().toISOString().slice(0, 10)} onChange={(e) => upd(d.key, { onset: e.target.value, onsetYear: e.target.value ? "" : d.onsetYear })} />
            </label>
            <span className="small muted" style={{ fontWeight: 700, paddingBottom: 14 }}>or</span>
            <label className="field">
              <span>Year only</span>
              <input className="input num" style={{ width: 110 }} inputMode="numeric" placeholder="YYYY" value={d.onsetYear} disabled={!!d.onset} onChange={(e) => upd(d.key, { onsetYear: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })} />
            </label>
          </div>
        </div>
        ),
      )}
      {addable.length > 0 && (
        <div className="choices">
          {addable.map((c) => (
            <button key={c} type="button" className="choice small add" onClick={() => onChange([...dx, { key: "new-" + c + "-" + Math.random().toString(36).slice(2, 6), code: c, attributes: {}, onset: "", onsetYear: "" }])}>
              + {DIAGNOSIS[c].display}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Registration details: civil ID, nationality, mobile, allergies.
export const NATIONALITIES = ["Kuwaiti", "Egyptian", "Indian", "Saudi", "Syrian", "Jordanian", "Lebanese", "Iraqi", "Iranian", "Pakistani", "Bangladeshi", "Filipino", "Sri Lankan", "Nepali", "Other"];

export function IdentityFields({ f, setF }: { f: any; setF(f: any): void }) {
  const civilBad = !!f.civilId && !/^\d{12}$/.test(f.civilId);
  return (
    <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
      <label className="field">
        <span>Civil ID</span>
        <input className={`input ${civilBad ? "bad" : ""}`} inputMode="numeric" placeholder="12 digits" value={f.civilId ?? ""} onChange={(e) => setF({ ...f, civilId: e.target.value.replace(/[^\d]/g, "").slice(0, 12) })} />
      </label>
      <label className="field">
        <span>Nationality</span>
        <select className="input" value={f.nationality ?? ""} onChange={(e) => setF({ ...f, nationality: e.target.value })}>
          <option value="">Not recorded</option>
          {NATIONALITIES.map((n) => <option key={n}>{n}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Mobile</span>
        <input className="input" inputMode="tel" placeholder="+965" value={f.mobile ?? ""} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/[^\d+ ]/g, "").slice(0, 16) })} />
      </label>
    </div>
  );
}

export function IdentityDrawer({ patientId, identity, onClose, onDone }: { patientId: string; identity: any; onClose(): void; onDone(m?: string, r?: any): void }) {
  const [f, setF] = useState({ civilId: identity.civilId ?? "", nationality: identity.nationality ?? "", mobile: identity.mobile ?? "", allergies: identity.allergies === "Not recorded" ? "" : identity.allergies ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const civilBad = !!f.civilId && !/^\d{12}$/.test(f.civilId);
  async function save() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/identity`, { body: f });
      onDone("Registration details saved", r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Registration details"
      subtitle="Identifiers and contact. Changes are audited."
      icon={<IdCard size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={civilBad || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </span>
      }
    >
      <div className="drawer-body">
        <IdentityFields f={f} setF={setF} />
        <label className="field">
          <span>Allergies</span>
          <input className="input" placeholder="e.g. No known drug allergies" value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} />
        </label>
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}
