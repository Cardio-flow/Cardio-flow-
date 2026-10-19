import { useMemo, useState, useEffect } from "react";
import { ClipboardList, IdCard, X } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, Segmented, SingleChoice, navigate, useToast, DateInput } from "../ui";
import { DIAGNOSIS, MEDICATION } from "../../shared/catalog";
import { DIAGNOSIS_ATTRIBUTES, HISTORY_ITEMS, MI_FEATURES, MULTIPLE_ALLOWED, fieldShown, siblingsOf, type HistoryItem } from "../../shared/history";
import { ageOn, fmtDay, localDay } from "../../shared/clinical";
import { DateField } from "../screens/SuggestLine";
import { civilIdBirthDate, civilIdCheckDigitOk } from "../../shared/civil-id";
import { HTN_DIAGNOSIS_STATUS } from "../../shared/hypertension";

// One editable diagnosis: new (add) or existing (update).
type Dx = { key: string; code: string; logicalId?: string; attributes: Record<string, any>; onset: string; onsetYear: string; dirty?: boolean; label?: string; expanded?: boolean; changeTo?: string };
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

export function HistoryDrawer({ patientId, focus, summary, onClose, onDone }: { patientId: string; focus?: "risk" | "cardiac" | "past"; summary?: any; onClose(): void; onDone(m?: string, r?: any): void }) {
  const hints = useMemo(() => riskHints(summary), [summary]);
  const { data } = useData<any>(`/patients/${patientId}/history`);
  const [rows, setRows] = useState<Record<string, Row> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asOf, setAsOf] = useState("");
  const [past, setPast] = useState<PastProc[]>([]);
  const pastProblem = past.find((p) => !/^\d{4}$/.test(p.year) || Number(p.year) < 1960 || Number(p.year) > Number((data?.today ?? "2100").slice(0, 4)));
  if (data && !rows) {
    setRows(Object.fromEntries(HISTORY_ITEMS.map((i) => [i.key, initialRow(i, data.items.find((x: any) => x.key === i.key))])));
    setAsOf(data.today);
  }
  const set = (key: string, patch: Partial<Row>) => setRows((r) => ({ ...r!, [key]: { ...r![key], ...patch } }));

  const payload = useMemo(() => {
    if (!rows) return null;
    const answers: any[] = [], add: any[] = [], update: any[] = [], change: { logicalId: string; code: string }[] = [], problems: string[] = [];
    for (const item of HISTORY_ITEMS) {
      const r = rows[item.key];
      if (item.conditions) {
        if (r.answer === "yes") {
          const fresh = r.dx.filter((d) => !d.logicalId);
          if (!r.dx.length) problems.push(`${item.label}: choose the diagnosis`);
          for (const d of fresh) add.push(dxBody(d));
          for (const d of r.dx.filter((d) => d.logicalId && d.changeTo)) change.push({ logicalId: d.logicalId!, code: d.changeTo! });
          for (const d of r.dx.filter((d) => d.logicalId && d.dirty && !d.changeTo)) update.push({ logicalId: d.logicalId, ...dxBody(d) });
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
    return { answers, add, update, change, problems };
  }, [rows]);
  const count = (payload ? payload.answers.length + payload.add.length + payload.update.length + payload.change.length : 0) + past.length;

  async function save() {
    if (!payload) return;
    setBusy(true);
    setError("");
    try {
      const effectiveAt = asOf && data && asOf !== data.today ? new Date(`${asOf}T12:00:00+03:00`).toISOString() : undefined;
      // a new CKD stage / diabetes type / HF phenotype replaces the old one (a dated change, not a second diagnosis)
      for (const c of payload.change) await api(`/patients/${patientId}/conditions/${c.logicalId}/change`, { body: { code: c.code, mode: "changed" } });
      const r = payload.answers.length + payload.add.length + payload.update.length
        ? await api(`/patients/${patientId}/history`, { body: { answers: payload.answers, add: payload.add, update: payload.update, effectiveAt } })
        : null;
      // a past MI is the "Previous MI" diagnosis (one per record): completed if listed, added if not
      const listedMi = data.items.find((x: any) => x.key === "coronary")?.conditions.find((c: any) => c.code === "prior-mi");
      for (const p of past.filter((x) => x.preset === "mi")) {
        const b = miBody(p);
        if (listedMi) await api(`/patients/${patientId}/conditions/${listedMi.id}/update`, { body: { onset: b.onset, onsetYear: b.onsetYear, attributes: { ...listedMi.attributes, ...b.attributes } } });
        else await api(`/patients/${patientId}/history`, { body: { add: [b], effectiveAt } });
      }
      for (const p of past.filter((x) => x.preset !== "mi")) await api(`/patients/${patientId}/procedures`, { body: pastBody(p) });
      onDone(`History saved · ${count} change${count === 1 ? "" : "s"}`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const sections: { key: "risk" | "cardiac"; title: string; help: string }[] = [
    { key: "risk", title: "Risk factors", help: "One tap each. Yes adds the diagnosis to the problem list; No and ? are dated statements, so a blank is never read as no. Hints come from the record." },
    { key: "cardiac", title: "Past cardiac history", help: "One tap each. Yes adds the diagnosis; pick the type when there are several. The year is enough; the detail is optional." },
  ];
  const ordered = focus === "cardiac" ? [sections[1], sections[0]] : sections;
  const pastSection = rows && <PastProcedures rows={past} setRows={setPast} thisYear={Number(String(data.today).slice(0, 4))} recorded={(data.timeline ?? []).map((e: any) => `${e.title}${e.when ? ` ${e.when}` : ""}`)} />;
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
            {pastProblem ? <span style={{ color: "var(--orange-ink)" }}>{PAST_PRESETS.find((x) => x.id === pastProblem.preset)?.label}: enter the year</span> : payload?.problems.length ? <span style={{ color: "var(--orange-ink)" }}>{payload.problems[0]}</span> : count ? `${count} change${count === 1 ? "" : "s"} to save` : "No changes yet"}
          </span>
          <span className="end">
            <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={!count || !!payload?.problems.length || !!pastProblem || busy} onClick={save}>{busy ? "Saving…" : "Save history"}</button>
          </span>
        </>
      }
    >
      <div className="drawer-body">
        {!rows && <div className="empty">Loading…</div>}
        {rows && (
          <DateField label="History taken on" value={asOf} onChange={setAsOf} today={data.today} max={data.today} quick={[{ label: "Today", days: 0 }]} />
        )}
        {focus === "past" && pastSection}
        {rows &&
          ordered.map((sec) => (
            <section key={sec.key} className="hx-section">
              <div className="hx-section-head">
                <h3>{sec.title}</h3>
                <p>{sec.help}</p>
              </div>
              {sec.key === "risk" ? (
                <>
                  <div className="tap-grid">
                    {HISTORY_ITEMS.filter((i) => i.section === "risk").map((item) => (
                      <TapRow key={item.key} item={item} row={rows[item.key]} view={data.items.find((x: any) => x.key === item.key)} hint={hints[item.key]} bmi={item.key === "obesity" ? data.bmi : null} onChange={(p) => set(item.key, p)} />
                    ))}
                  </div>
                  {(() => {
                    const open = HISTORY_ITEMS.filter((i) => i.section === "risk" && !rows[i.key].answer && !hints[i.key]);
                    return open.length > 0 ? (
                      <button type="button" className="btn secondary small tap-rest" onClick={() => setRows((r) => {
                        const n = { ...r! };
                        for (const i of open) n[i.key] = { ...n[i.key], answer: i.conditions || i.options!.some((o) => o.value === "no") ? "no" : "never" };
                        return n;
                      })}>
                        Mark the {open.length} unanswered as No / never
                      </button>
                    ) : null;
                  })()}
                </>
              ) : (
                <>
                  {HISTORY_ITEMS.filter((i) => i.section === sec.key).map((item) => (
                    <HistoryRow key={item.key} item={item} row={rows[item.key]} view={data.items.find((x: any) => x.key === item.key)} bmi={null} onChange={(p) => set(item.key, p)} />
                  ))}
                  {(() => {
                    const open = HISTORY_ITEMS.filter((i) => i.section === "cardiac" && !rows[i.key].answer);
                    return open.length > 0 ? (
                      <button type="button" className="btn secondary small tap-rest" onClick={() => setRows((r) => {
                        const n = { ...r! };
                        for (const i of open) n[i.key] = { ...n[i.key], answer: "no" };
                        return n;
                      })}>
                        Mark the {open.length} unanswered as No
                      </button>
                    ) : null;
                  })()}
                </>
              )}
            </section>
          ))}
        {focus !== "past" && pastSection}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

// Hints from the record (never answers): guideline diagnostic values and the medicines the patient takes.
//  - diabetes: HbA1c ≥6.5% (ADA 2026 / ESC 2023 diagnostic threshold) or a glucose-lowering medicine
//  - obesity: BMI ≥30 kg/m² (WHO)
//  - CKD: eGFR <60 (KDIGO 2024), with the G stage preselected
//  - hypertension: a blood-pressure medicine; dyslipidaemia: a lipid-lowering medicine
type Hint = { text: string; code?: string };
const KDIGO = (e: number) => (e >= 45 ? "ckd-3a" : e >= 30 ? "ckd-3b" : e >= 15 ? "ckd-4" : "ckd-5");
function riskHints(s: any): Record<string, Hint> {
  if (!s) return {};
  const out: Record<string, Hint> = {};
  const res = (code: string) => s.results?.find((r: any) => r.code === code)?.current?.value as number | undefined;
  const meds: { name: string; code: string }[] = (s.medications?.groups ?? []).flatMap((g: any) => g.meds);
  const on = (pred: (d: any) => boolean) => meds.filter((m) => MEDICATION[m.code] && pred(MEDICATION[m.code])).map((m) => m.name);
  const a1c = res("hba1c");
  const dm = on((d) => d.tags.some((t: string) => ["metformin", "insulin", "sulfonylurea", "dpp4", "tzd"].includes(t)));
  if ((a1c != null && a1c >= 6.5) || dm.length) out.diabetes = { text: [a1c != null && a1c >= 6.5 ? `HbA1c ${a1c}%` : null, dm.length ? `on ${dm.join(", ").toLowerCase()}` : null].filter(Boolean).join(" · "), code: "t2dm" };
  const egfr = res("egfr");
  if (egfr != null && egfr < 60) out.ckd = { text: `eGFR ${Math.round(egfr)}`, code: KDIGO(egfr) };
  const bp = on((d) => d.purpose === "Blood pressure");
  if (bp.length) out.hypertension = { text: `on ${bp.join(", ").toLowerCase()}` };
  const lip = on((d) => d.tags.includes("lipid"));
  if (lip.length) out.dyslipidaemia = { text: `on ${lip.join(", ").toLowerCase()}` };
  return out;
}

// One risk factor in one tap: Yes / No / ? (and the smoking states). Yes adds the diagnosis straight away —
// the hinted or most common one — and shows it as a chip to change.
const DEFAULT_CODE: Record<string, string> = { diabetes: "t2dm", dyslipidaemia: "dyslipidaemia", hypertension: "htn", obesity: "obesity" };
function TapRow({ item, row, view, hint, bmi, onChange }: { item: HistoryItem; row: Row; view: any; hint?: Hint; bmi: any; onChange(p: Partial<Row>): void }) {
  const obeseHint = item.key === "obesity" && bmi && bmi.value >= 30 ? { text: `BMI ${bmi.value.toFixed(1)}` } : null;
  const h = hint ?? obeseHint ?? null;
  const choose = (answer: string) => {
    if (!item.conditions) return onChange({ answer: row.answer === answer ? row.initial : answer });
    if (answer === "yes") {
      if (row.dx.length) return onChange({ answer });
      const code = (h as Hint | null)?.code ?? DEFAULT_CODE[item.key];
      return onChange({ answer, dx: code ? [{ key: "new-" + code, code, attributes: {}, onset: "", onsetYear: "" }] : [] });
    }
    onChange({ answer: row.answer === answer ? row.initial : answer, dx: row.dx.filter((d) => d.logicalId) });
  };
  const opts = item.conditions
    ? [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "unknown", label: "?" }]
    : item.options!.filter((o) => o.value !== "not-assessed").map((o) => ({ value: o.value, label: o.value === "unknown" ? "?" : o.label.replace(" smoker", "").replace("Never smoked", "Never") }));
  const codes = item.conditions?.filter((c) => DIAGNOSIS[c] && !DIAGNOSIS[c].hidden) ?? [];
  const fresh = row.dx.filter((d) => !d.logicalId);
  return (
    <div className={`tap-row${row.answer && row.answer !== row.initial ? " changed" : ""}${row.answer === "yes" || item.options?.find((o) => o.value === row.answer)?.present ? " present" : ""}`}>
      <div className="tap-label">
        <b>{item.short}</b>
        <small className={h && row.answer !== "yes" ? "hint" : ""}>
          {h && row.answer !== "yes" ? `Suggests yes · ${h.text}` : view?.at ? `Recorded ${fmtDay(view.at, { year: true })}` : view?.source === "diagnosis" ? "On the problem list" : "Not recorded"}
        </small>
      </div>
      <div className="tap-opts" role="radiogroup" aria-label={item.label}>
        {opts.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={row.answer === o.value} className={`tap-o${o.value === "yes" && h && row.answer !== "yes" ? " hinted" : ""}`} onClick={() => choose(o.value)} title={o.value === "unknown" ? "Unknown" : undefined}>
            {o.label}
          </button>
        ))}
      </div>
      {item.key === "hypertension" && row.answer === "yes" && row.dx.filter(d => d.code === "htn").map(d => (
        <div key={d.key} className="tap-sub" style={{display:"grid",gap:6}}>
          <span className="small">Hypertension status</span>
          <Segmented label="Hypertension status" options={HTN_DIAGNOSIS_STATUS.map(value => ({value,label:value}))} value={d.attributes.diagnosisStatus} onChange={value => {if(value !== d.attributes.diagnosisStatus) onChange({dx:row.dx.map(x => x.key === d.key ? {...x,dirty:true,attributes:{...x.attributes,diagnosisStatus:value}} : x)});}} />
        </div>
      ))}
      {item.conditions && row.answer === "yes" && codes.length > 1 && (fresh.length > 0 || !row.dx.length) && (
        <div className="tap-sub">
          {codes.map((c) => (
            <button key={c} type="button" className="tap-chip" aria-pressed={fresh.some((d) => d.code === c)} onClick={() => onChange({ dx: [...row.dx.filter((d) => d.logicalId), { key: "new-" + c, code: c, attributes: {}, onset: "", onsetYear: "" }] })}>
              {DIAGNOSIS[c].display.replace(/^Diabetes, /, "").replace(/ \(.*\)$/, "")}
            </button>
          ))}
        </div>
      )}
      {item.conditions && row.initial === "yes" && row.answer === "no" && (
        <div className="tap-sub">
          <span className="small muted">Leaves the problem list as</span>
          {(["resolved", "entered_in_error"] as const).map((v) => (
            <button key={v} type="button" className="tap-chip" aria-pressed={row.resolveAs === v} onClick={() => onChange({ resolveAs: v })}>{v === "resolved" ? "Resolved" : "Entered in error"}</button>
          ))}
        </div>
      )}
      {!item.conditions && (item.details ?? []).some((d) => row.answer && d.when.includes(row.answer)) && (
        <div className="tap-sub">
          {item.details!.filter((d) => d.when.includes(row.answer!)).map((d) => (
            <label key={d.key} className="tap-num">
              <span>{d.label}</span>
              <input inputMode="numeric" value={(row as any)[d.key] ?? ""} onChange={(e) => onChange({ [d.key]: e.target.value.replace(/[^\d]/g, "").slice(0, 4) } as any)} />
            </label>
          ))}
        </div>
      )}
    </div>
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
            <div className="tap-opts" role="radiogroup" aria-label={item.label}>
              {CONDITION_ANSWERS.filter((o) => o.value !== "not-assessed").map((o) => (
                <button key={o.value} type="button" role="radio" aria-checked={row.answer === o.value} className="tap-o" title={o.label}
                  onClick={() => onChange({ answer: o.value, dx: o.value === "yes" ? (row.dx.length ? row.dx : oneCode(item)) : row.dx.filter((d) => d.logicalId) })}>
                  {o.value === "unknown" ? "?" : o.label}
                </button>
              ))}
            </div>
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

// an item with one diagnosis (pulmonary embolism, device, PH): Yes adds it at once
const newDx = (code: string): Dx => ({ key: "new-" + code + "-" + Math.random().toString(36).slice(2, 6), code, attributes: {}, onset: "", onsetYear: "" });
function oneCode(item: HistoryItem): Dx[] {
  const codes = (item.conditions ?? []).filter((c) => DIAGNOSIS[c] && !DIAGNOSIS[c].hidden);
  return codes.length === 1 ? [newDx(codes[0])] : [];
}

function DiagnosisEditor({ item, dx, onChange }: { item: HistoryItem; dx: Dx[]; onChange(dx: Dx[]): void }) {
  const codes = item.conditions!.filter((c) => DIAGNOSIS[c] && !DIAGNOSIS[c].hidden);
  // one CKD stage / diabetes type: a recorded one is changed, not joined by a second
  const addable = codes.filter((c) => MULTIPLE_ALLOWED.has(c) || !dx.some((d) => d.code === c || siblingsOf(d.code).includes(c)));
  const upd = (key: string, patch: Partial<Dx>) => onChange(dx.map((d) => (d.key === key ? { ...d, ...patch, dirty: true } : d)));
  return (
    <div className="hx-dx">
      {dx.map((d) =>
        d.logicalId && !d.expanded ? (
          <div key={d.key} className="hx-dx-line">
            <b>{d.changeTo ? `${DIAGNOSIS[d.code]?.display} → ${DIAGNOSIS[d.changeTo]?.display}` : d.label}</b>
            {siblingsOf(d.code).filter((c) => codes.includes(c)).length > 0 ? (
              <select className="input small" aria-label={`Change ${DIAGNOSIS[d.code]?.display}`} value={d.changeTo ?? ""} onChange={(e) => onChange(dx.map((x) => (x.key === d.key ? { ...x, changeTo: e.target.value || undefined } : x)))}>
                <option value="">On the problem list</option>
                {siblingsOf(d.code).filter((c) => codes.includes(c)).map((c) => <option key={c} value={c}>Change to {DIAGNOSIS[c].display}</option>)}
              </select>
            ) : (
              <span className="small muted">On the problem list</span>
            )}
            <button type="button" className="btn ghost small" onClick={() => onChange(dx.map((x) => (x.key === d.key ? { ...x, expanded: true } : x)))}>
              Edit detail
            </button>
          </div>
        ) : !d.logicalId && !d.expanded ? (
          // a new diagnosis: one line — the year is enough; the detail opens on demand
          <div key={d.key} className="hx-dx-line new">
            <b>{DIAGNOSIS[d.code]?.display ?? d.code}</b>
            <input className="input num hx-year" inputMode="numeric" placeholder="Year" aria-label={`${DIAGNOSIS[d.code]?.display} year`} value={d.onsetYear} onChange={(e) => upd(d.key, { onsetYear: e.target.value.replace(/[^\d]/g, "").slice(0, 4) })} />
            {(DIAGNOSIS_ATTRIBUTES[d.code] ?? []).length > 0 && (
              <button type="button" className="btn ghost small" onClick={() => onChange(dx.map((x) => (x.key === d.key ? { ...x, expanded: true } : x)))}>Add detail</button>
            )}
            <button type="button" className="icon-btn" aria-label={`Remove ${DIAGNOSIS[d.code]?.display}`} onClick={() => onChange(dx.filter((x) => x.key !== d.key))}>
              <X size={16} />
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
              <DateInput className="input" value={d.onset} max={localDay(new Date().toISOString())} onChange={(e) => upd(d.key, { onset: e.target.value, onsetYear: e.target.value ? "" : d.onsetYear })} />
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
            <button key={c} type="button" className="choice small add" onClick={() => onChange([...dx, newDx(c)])}>
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

// Date of birth, or the age when the date is not known (the date is then estimated and flagged).
// With a valid civil ID both come from it.
export function BirthFields({ f, setF }: { f: any; setF(f: any): void }) {
  const today = localDay(new Date().toISOString());
  const fromId = civilIdBirthDate(f.civilId);
  const age = f.birthDate ? ageOn(f.birthDate, today) : null;
  const [ageText, setAgeText] = useState<string>(age != null ? String(age) : "");
  useEffect(() => {
    if (age != null && String(age) !== ageText) setAgeText(String(age));
    if (age == null && !f.birthDateEstimated && ageText && !f.birthDate) setAgeText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.birthDate]);
  function typedAge(v: string) {
    const t = v.replace(/[^\d]/g, "").slice(0, 3);
    setAgeText(t);
    const n = Number(t);
    if (t && n >= 0 && n <= 120) {
      const y = Number(today.slice(0, 4)) - n;
      setF({ ...f, birthDate: `${y}${today.slice(4)}`.replace(/-02-29$/, "-02-28"), birthDateEstimated: true });
    }
  }
  return (
    <>
      <label className="field">
        <span>Date of birth{f.birthDateEstimated ? " · estimated" : ""}</span>
        <DateInput className="input" max={today} value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value, birthDateEstimated: false })} />
      </label>
      <label className="field" style={{ width: 110 }}>
        <span>Age</span>
        <input className="input" inputMode="numeric" placeholder="years" disabled={!!fromId} value={ageText} onChange={(e) => typedAge(e.target.value)} title={fromId ? "From the civil ID" : "Type the age when the date of birth is not known"} />
      </label>
    </>
  );
}

// Civil ID fills the date of birth (Kuwaiti civil ID carries it); the age is then calculated, never typed.
export function IdentityFields({ f, setF }: { f: any; setF(f: any): void }) {
  const civilBad = !!f.civilId && (!/^\d{12}$/.test(f.civilId) || (f.civilId.length === 12 && !civilIdBirthDate(f.civilId)));
  const born = civilIdBirthDate(f.civilId);
  const checkOff = !!born && !civilIdCheckDigitOk(f.civilId);
  return (
    <div className="row wrap" style={{ gap: 16, alignItems: "flex-start" }}>
      <label className="field">
        <span>Civil ID</span>
        <input
          className={`input ${civilBad ? "bad" : ""}`}
          inputMode="numeric"
          placeholder="12 digits"
          value={f.civilId ?? ""}
          onChange={(e) => {
            const civilId = e.target.value.replace(/[^\d]/g, "").slice(0, 12);
            const b = civilIdBirthDate(civilId);
            setF({ ...f, civilId, ...(b && "birthDate" in f ? { birthDate: b, birthDateEstimated: false } : {}) });
          }}
        />
        {born ? (
          <small className={checkOff ? "civil-note warn" : "civil-note"}>
            {checkOff ? "Check digit does not match: check the number" : `Born ${fmtDay(born, { year: true })} · age from the civil ID`}
          </small>
        ) : civilBad && f.civilId.length === 12 ? (
          <small className="civil-note warn">No valid birth date in this number</small>
        ) : null}
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

const REMOVAL_REASONS = ["Registered in error", "Duplicate record", "Test or practice record"];

// Patient details: name, file number, sex, date of birth, identifiers, contact and allergies — all audited.
// Also: move a mistaken test patient to the sample patients, or remove a record registered in error.
export function IdentityDrawer({ patientId, identity, onClose, onDone, onRemoved, initialRemove = false }: { patientId: string; identity: any; onClose(): void; onDone(m?: string, r?: any): void; onRemoved?(): void; initialRemove?: boolean }) {
  const sample = !!identity.sample;
  const shownMrn = (identity.mrn ?? "").replace(sample ? /^SYN-/ : /^$/, "");
  const [f, setF] = useState({
    name: identity.name ?? "", mrn: shownMrn, sex: identity.sex ?? "", birthDate: identity.birthDate ?? "", birthDateEstimated: !!identity.birthDateEstimated,
    civilId: identity.civilId ?? "", nationality: identity.nationality ?? "", mobile: identity.mobile ?? "", allergies: identity.allergies === "Not recorded" ? "" : identity.allergies ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toast = useToast();
  const civilBad = !!f.civilId && !/^\d{12}$/.test(f.civilId);
  const valid = !civilBad && f.name.trim().length > 1 && !!f.mrn.trim() && !!f.sex && !!f.birthDate;
  const [confirmSample, setConfirmSample] = useState(false);
  const [removing, setRemoving] = useState(initialRemove);
  const [reason, setReason] = useState("");
  async function toSample() {
    setBusy(true);
    try {
      await api(`/patients/${patientId}/move-to-sample`, { body: {} });
      onDone("Moved to the sample patients", { changed: ["patient"] });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/patients/${patientId}/remove`, { body: { reason } });
      toast({ text: `${identity.name ?? "Patient"} removed (${reason.toLowerCase()})` });
      if (onRemoved) onRemoved(); else navigate("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/identity`, { body: f });
      onDone("Patient details saved", r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={removing ? "Delete patient" : "Patient details"}
      subtitle="Registration, identifiers and contact. Every change is audited with the previous value."
      icon={<IdCard size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          {!removing && <button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>}
        </span>
      }
    >
      <div className="drawer-body">
        {!removing && <>
        <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
          <label className="field grow">
            <span>Full name</span>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label className="field">
            <span>File number (MRN){sample ? " · saved as SYN-…" : ""}</span>
            <input className="input" value={f.mrn} onChange={(e) => setF({ ...f, mrn: e.target.value })} />
          </label>
        </div>
        <IdentityFields f={f} setF={setF} />
        <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
          <div className="field">
            <span>Sex</span>
            <Segmented label="Sex" options={[{ value: "Male", label: "Male" }, { value: "Female", label: "Female" }]} value={f.sex} onChange={(v) => setF({ ...f, sex: v })} />
          </div>
          <BirthFields f={f} setF={setF} />
        </div>
        <label className="field">
          <span>Allergies</span>
          <input className="input" placeholder="e.g. No known drug allergies" value={f.allergies} onChange={(e) => setF({ ...f, allergies: e.target.value })} />
        </label>
        </>}
        {error && <div className="error-box">{error}</div>}
        {!sample && !removing && (
          <div className="sample-move">
            <b>Registered only to try the app?</b>
            <span className="muted small">Move this record to the sample patients. It leaves the real worklist and registries and its file number gets the SYN- prefix. This cannot be undone.</span>
            {confirmSample ? (
              <span className="row wrap" style={{ gap: 8 }}>
                <button className="btn small" disabled={busy} onClick={toSample}>Yes, move to sample patients</button>
                <button className="btn ghost small" onClick={() => setConfirmSample(false)}>Keep as real patient</button>
              </span>
            ) : (
              <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmSample(true)}>Move to sample patients…</button>
            )}
          </div>
        )}
        <div className="remove-box">
          <b>Remove this record</b>
          <span className="muted small">For a record that should not exist. Nothing is erased: it leaves every list, search, count and registry, and stays in the database with who removed it, when and why. Its file number and civil ID can be used again.</span>
          {removing ? (
            <>
              <SingleChoice label="Why remove it" options={REMOVAL_REASONS.map((r) => ({ value: r, label: r }))} value={reason} onChange={setReason} />
              <span className="row wrap" style={{ gap: 8 }}>
                <button className="btn small remove-btn" disabled={!reason || busy} onClick={remove}>Remove {identity.name ?? "record"}</button>
                <button className="btn ghost small" onClick={() => (setRemoving(false), setReason(""))}>Keep the record</button>
              </span>
            </>
          ) : (
            <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setRemoving(true)}>Remove record…</button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ---------- Past procedures & devices (19 Oct 2026, Ahmed: "add mitral clipping, Watchman devices to the history")
// What a referral letter gives: the procedure, the year (month if known) and its one detail. Recorded as a
// past procedure (date precision kept), so the clip, the occluder, the ICD and the stents count in every rule
// while the early after-procedure checks do not start.
export type PastProc = { key: string; preset: string; year: string; month: string; detail: Record<string, any> };
export const PAST_PRESETS: { id: string; label: string; kind: string; base: Record<string, any> }[] = [
  { id: "mi", label: "MI", kind: "mi", base: {} },
  { id: "pci", label: "PCI / POBA", kind: "pci", base: {} },
  { id: "cabg", label: "CABG", kind: "cabg", base: {} },
  { id: "teer", label: "Mitral clip (TEER)", kind: "valve", base: { position: "Mitral", procedure: "Transcatheter edge-to-edge repair (TEER)" } },
  { id: "tavi", label: "TAVI", kind: "valve", base: { position: "Aortic", procedure: "TAVI" } },
  { id: "valve-surgery", label: "Valve surgery", kind: "valve", base: { procedure: "Surgical replacement", prosthesis: "Mechanical", position: "Mitral" } },
  { id: "laao", label: "Watchman / LAA closure", kind: "laao", base: { device: "WATCHMAN (model not known)" } },
  { id: "icd", label: "ICD", kind: "device", base: { type: "ICD (transvenous)" } },
  { id: "crt", label: "CRT", kind: "device", base: { type: "CRT-D" } },
  { id: "ppm", label: "Pacemaker", kind: "device", base: { type: "Pacemaker (type not known)" } },
  { id: "ablation", label: "Ablation", kind: "ablation", base: { targets: ["AF (pulmonary vein isolation)"] } },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const chips = (opts: string[], value: string | string[] | undefined, multi: boolean, set: (v: any) => void, label: string) => (
  <div className="past-chips" role="group" aria-label={label}>
    <span className="past-lab" aria-hidden="true">{label}</span>
    {opts.map((o) => {
      const on = multi ? ((value as string[] | undefined) ?? []).includes(o) : value === o;
      return <button key={o} type="button" aria-pressed={on} className={on ? "on" : ""} onClick={() => set(multi ? (on ? ((value as string[]) ?? []).filter((x) => x !== o) : [...((value as string[]) ?? []), o]) : o)}>{o}</button>;
    })}
  </div>
);
export function miBody(p: PastProc) {
  const y = Number(p.year), m = p.month ? MONTHS.indexOf(p.month) + 1 : 0;
  const attributes = Object.fromEntries(Object.entries(p.detail).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length)));
  return { code: "prior-mi", attributes, onset: m ? `${y}-${String(m).padStart(2, "0")}-15` : null, onsetYear: m ? null : y };
}
export function pastBody(p: PastProc) {
  const pre = PAST_PRESETS.find((x) => x.id === p.preset)!;
  const y = Number(p.year), m = p.month ? MONTHS.indexOf(p.month) + 1 : 0;
  const date = new Date(`${y}-${String(m || 7).padStart(2, "0")}-${m ? 15 : "01"}T09:00:00+03:00`).toISOString();
  return { kind: pre.kind, date, details: { ...pre.base, ...p.detail, historical: m ? "month" : "year" } };
}
export function PastProcedures({ rows, setRows, recorded, thisYear }: { rows: PastProc[]; setRows(r: PastProc[]): void; recorded: string[]; thisYear: number }) {
  const upd = (key: string, patch: Partial<PastProc>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const det = (r: PastProc, k: string, v: any) => upd(r.key, { detail: { ...r.detail, [k]: v } });
  return (
    <section className="hx-section">
      <div className="hx-section-head">
        <h3>Past MI, procedures & devices</h3>
        <p>Tap what the patient had, then the year (and month if known). Details are optional; the record keeps each as past history with its year.</p>
      </div>
      {recorded.length > 0 && <p className="small muted">Already in the record: {recorded.join(" · ")}</p>}
      <div className="past-chips add" role="group" aria-label="Add a past procedure">
        {PAST_PRESETS.map((p) => <button key={p.id} type="button" onClick={() => setRows([...rows, { key: `${p.id}-${Date.now()}`, preset: p.id, year: "", month: "", detail: {} }])}>+ {p.label}</button>)}
      </div>
      {rows.map((r) => {
        const pre = PAST_PRESETS.find((x) => x.id === r.preset)!;
        const d = { ...pre.base, ...r.detail };
        const yOk = /^\d{4}$/.test(r.year) && Number(r.year) >= 1960 && Number(r.year) <= thisYear;
        return (
          <div key={r.key} className="past-row">
            <div className="past-head">
              <b>{pre.label}</b>
              <label className="past-year"><span>Year</span><input className={`input num${r.year && !yOk ? " bad" : ""}`} inputMode="numeric" value={r.year} onChange={(e) => upd(r.key, { year: e.target.value.replace(/\D/g, "").slice(0, 4) })} aria-label={`${pre.label} year`} placeholder="YYYY" /></label>
              <label className="past-month"><span>Month</span><select className="input" value={r.month} onChange={(e) => upd(r.key, { month: e.target.value })} aria-label={`${pre.label} month`}><option value="">—</option>{MONTHS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <button type="button" className="icon-btn" aria-label={`Remove ${pre.label}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><X size={16} /></button>
            </div>
            {r.preset === "mi" && <>{chips(["STEMI", "NSTEMI", "Type 2 MI"], d.type, false, (v) => det(r, "type", v), "MI type")}{chips(["Anterior", "Inferior", "Lateral", "Posterior"], d.territory, false, (v) => det(r, "territory", v), "Territory")}{chips([...MI_FEATURES], d.features, true, (v) => det(r, "features", v), "Course")}</>}
            {r.preset === "pci" && <>{chips(["LAD", "LCx", "RCA", "Left main", "Graft"], d.vessels, true, (v) => det(r, "vessels", v), "Vessels")}{chips(["Stent (DES)", "Drug-coated balloon", "POBA (balloon only)"], (d.devices ?? []).map((x: string) => (x === "Drug-eluting stent" ? "Stent (DES)" : x === "Balloon only" ? "POBA (balloon only)" : x)), true, (v: string[]) => det(r, "devices", v.map((x) => (x === "Stent (DES)" ? "Drug-eluting stent" : x === "POBA (balloon only)" ? "Balloon only" : x))), "Device")}{chips(["Stent thrombosis", "In-stent restenosis"], d.reason, false, (v) => det(r, "reason", d.reason === v ? null : v), "Done for")}{chips(["Primary PCI (STEMI)", "NSTE-ACS", "Elective"], d.settingLabel, false, (v) => upd(r.key, { detail: { ...r.detail, settingLabel: v, setting: v === "Elective" ? "elective" : v === "NSTE-ACS" ? "nste-acs" : "stemi" } }), "Setting")}</>}
            {r.preset === "teer" && <>{chips(["Mitral", "Tricuspid"], d.position, false, (v) => det(r, "position", v), "Valve")}{chips(["Not known", "MitraClip", "PASCAL", "TriClip"], d.deviceModel ?? "Not known", false, (v) => det(r, "deviceModel", v === "Not known" ? null : v), "Device")}</>}
            {r.preset === "valve-surgery" && <>{chips(["Aortic", "Mitral", "Tricuspid"], d.position, false, (v) => det(r, "position", v), "Valve")}{chips(["Mechanical", "Bioprosthetic", "Repair"], d.procedure === "Surgical repair" ? "Repair" : d.prosthesis, false, (v) => upd(r.key, { detail: { ...r.detail, ...(v === "Repair" ? { procedure: "Surgical repair", prosthesis: null } : { procedure: "Surgical replacement", prosthesis: v }) } }), "Type")}</>}
            {r.preset === "laao" && chips(["WATCHMAN (model not known)", "WATCHMAN FLX", "WATCHMAN FLX Pro", "Amplatzer Amulet", "Other transcatheter device", "Surgical clip"], d.device, false, (v) => det(r, "device", v), "Device")}
            {r.preset === "icd" && chips(["ICD (transvenous)", "Subcutaneous ICD"], d.type, false, (v) => det(r, "type", v), "Device")}
            {r.preset === "crt" && chips(["CRT-D", "CRT-P"], d.type, false, (v) => det(r, "type", v), "Device")}
            {r.preset === "ppm" && chips(["Pacemaker (type not known)", "Pacemaker (single chamber)", "Pacemaker (dual chamber)", "Leadless pacemaker"], d.type, false, (v) => det(r, "type", v), "Device")}
            {r.preset === "ablation" && chips(["AF (pulmonary vein isolation)", "Atrial flutter (CTI)", "AVNRT", "Accessory pathway", "VT", "AV node (pace and ablate)"], d.targets, true, (v) => det(r, "targets", v), "Ablation")}
          </div>
        );
      })}
    </section>
  );
}
