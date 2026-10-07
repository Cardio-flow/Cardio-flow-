import { useState } from "react";
import { FileHeart } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, MultiChoice, SingleChoice, DateInput } from "../ui";
import { STUDIES, STUDY, fieldActive, studySummary, type StudyField } from "../../shared/studies";

// One drawer for every study kind: choose the kind, then fill its short template.
export function AddStudy({ patientId, kind: initialKind, initial, contextId, onClose, onDone }: { patientId: string; kind?: string; initial?: Record<string, any>; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data: health } = useData<any>("/health");
  const [kind, setKind] = useState(initialKind ?? "");
  const [date, setDate] = useState("");
  const [values, setValues] = useState<Record<string, any>>(initial ?? {});
  const [conclusion, setConclusion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const def = STUDY[kind];
  const active = def ? def.fields.filter((f) => fieldActive(f, values)) : [];
  const missing = active.filter((f) => (f as any).required && (values[f.key] == null || values[f.key] === "")).map((f) => f.label);
  const bad = active.filter((f) => f.type === "number" && values[f.key] !== "" && values[f.key] != null && (Number(values[f.key]) < f.min || Number(values[f.key]) > f.max)).map((f) => f.label);
  const clean = () => Object.fromEntries(active.map((f) => [f.key, f.type === "number" ? (values[f.key] === "" || values[f.key] == null ? null : Number(values[f.key])) : values[f.key] ?? null]).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)));
  const preview = def ? studySummary(kind, clean()) : "";

  async function save() {
    setBusy(true);
    setError("");
    try {
      const at = date ? new Date(`${date}T10:00:00+03:00`).toISOString() : new Date().toISOString();
      const r = await api(`/patients/${patientId}/studies`, { body: { kind, date: at, findings: clean(), conclusion: conclusion || undefined, contextId: contextId ?? null } });
      onDone(`${def.short} recorded`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={def ? `Add ${def.label}` : "Add study"}
      subtitle={def ? def.help : "Choose the investigation. Echo and labs have their own quick entry."}
      icon={<FileHeart size={22} />}
      wide={!!def}
      onClose={onClose}
      footer={
        def && (
          <>
            <span className="note">{missing.length ? `Needed: ${missing.join(", ")}` : bad.length ? `Check: ${bad.join(", ")}` : preview || "Select the findings"}</span>
            <span className="end">
              <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={busy || missing.length > 0 || bad.length > 0 || !preview} onClick={save}>{busy ? "Saving…" : `Save ${def.short}`}</button>
            </span>
          </>
        )
      }
    >
      <div className="drawer-body">
        {!def ? (
          <div className="study-kinds">
            {STUDIES.map((s) => (
              <button key={s.kind} className="study-kind" onClick={() => setKind(s.kind)}>
                <b>{s.label}</b>
                <span>{s.help}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="row wrap" style={{ gap: 18, alignItems: "flex-end" }}>
              <label className="field">
                <span>Study date</span>
                <DateInput className="input" max={health?.today} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              {!initialKind && (
                <button className="btn ghost small" onClick={() => (setKind(""), setValues({}))}>Change study type</button>
              )}
            </div>
            {/* boxed: what the report must say first, then the optional detail */}
            {[
              { title: "Result", fields: active.filter((f) => (f as any).required) },
              { title: "Details", hint: "optional", fields: active.filter((f) => !(f as any).required) },
            ].filter((b) => b.fields.length).map((b) => (
              <section key={b.title} className="study-box">
                <div className="study-box-head"><b>{b.title}</b>{b.hint && <span>{b.hint}</span>}</div>
                {groups(b.fields).map((g, i) =>
                  g.length > 1 ? (
                    <div key={i} className="study-nums">
                      {g.map((f) => <Field key={f.key} f={f} value={values[f.key]} onChange={(v) => setValues((x) => ({ ...x, [f.key]: v }))} />)}
                    </div>
                  ) : (
                    <Field key={g[0].key} f={g[0]} value={values[g[0].key]} onChange={(v) => setValues((x) => ({ ...x, [g[0].key]: v }))} />
                  ),
                )}
              </section>
            ))}
            <label className="field">
              <span>Report conclusion (optional)</span>
              <textarea className="input" rows={2} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
            </label>
            {error && <div className="error-box">{error}</div>}
          </>
        )}
      </div>
    </Drawer>
  );
}

// consecutive numeric fields share one row (rate · PR · QRS …)
function groups(fields: StudyField[]) {
  const out: StudyField[][] = [];
  for (const f of fields) {
    const last = out[out.length - 1];
    if (f.type === "number" && last && last[0].type === "number") last.push(f);
    else out.push([f]);
  }
  return out;
}

function Field({ f, value, onChange }: { f: StudyField; value: any; onChange(v: any): void }) {
  const label = (
    <span className="study-label">
      {f.label}
      {(f as any).required ? "" : <em> (optional)</em>}
    </span>
  );
  if (f.type === "number")
    return (
      <label className="field study-field">
        {label}
        <span className="row">
          <input
            className={`input num study-num ${value !== "" && value != null && (Number(value) < f.min || Number(value) > f.max) ? "bad" : ""}`}
            inputMode="decimal"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value.replace(f.min < 0 ? /[^\d.-]/g : /[^\d.]/g, "").replace(/(?!^)-/g, "").slice(0, 6))}
            aria-label={f.label}
          />
          {f.unit && <b className="muted">{f.unit}</b>}
        </span>
      </label>
    );
  if (f.type === "multi")
    return (
      <div className="q study-field">
        {label}
        <MultiChoice
          options={f.options.map((o) => ({ value: o, label: o }))}
          value={value ?? []}
          onChange={(v) => onChange(v.includes("None") && !(value ?? []).includes("None") ? ["None"] : v.filter((x: string) => x !== "None" || v.length === 1))}
        />
      </div>
    );
  return (
    <div className="q study-field">
      {label}
      <SingleChoice label={f.label} options={f.options.map((o) => ({ value: o, label: o }))} value={value} onChange={(v) => onChange(value === v ? undefined : v)} />
    </div>
  );
}
