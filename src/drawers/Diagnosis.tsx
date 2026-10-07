// Edit one diagnosis (7 Oct 2026): its details and onset, change it to another diagnosis (it changed over time,
// or it was the wrong pick), or remove it (resolved / entered in error). History is kept: nothing is overwritten.
import { useState } from "react";
import { Stethoscope } from "lucide-react";
import { api } from "../api";
import { DateInput, Drawer, Segmented, SingleChoice } from "../ui";
import { DIAGNOSES, DIAGNOSIS } from "../../shared/catalog";
import { DIAGNOSIS_ATTRIBUTES, fieldShown } from "../../shared/history";
import { localDay } from "../../shared/clinical";

type Dx = { id: string; code: string; label: string; family: string; onset: string | null; attributes: Record<string, any> };

export function EditDiagnosis({ patientId, dx, onClose, onDone }: { patientId: string; dx: Dx; onClose(): void; onDone(m?: string, r?: any): void }) {
  const today = localDay(new Date().toISOString());
  const fields = DIAGNOSIS_ATTRIBUTES[dx.code] ?? [];
  const [what, setWhat] = useState<"details" | "change" | "remove">("details");
  const [attrs, setAttrs] = useState<Record<string, any>>(() => Object.fromEntries(Object.entries(dx.attributes ?? {}).filter(([k]) => k !== "onsetYear")));
  const [onset, setOnset] = useState<string>(dx.onset ? String(dx.onset).slice(0, 10) : "");
  const [year, setYear] = useState<string>(dx.attributes?.onsetYear ? String(dx.attributes.onsetYear) : "");
  const [to, setTo] = useState("");
  const [mode, setMode] = useState<"changed" | "error">("changed");
  const [status, setStatus] = useState<"" | "resolved" | "entered_in_error">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const family = DIAGNOSIS[dx.code]?.family;
  // same family first (CKD stage, HF phenotype, valve lesion…), then every other diagnosis by search
  const [q, setQ] = useState("");
  const others = DIAGNOSES.filter((d) => !d.hidden && d.code !== dx.code && (q ? d.display.toLowerCase().includes(q.toLowerCase()) : d.family === family));
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (what === "details") {
        const r = await api(`/patients/${patientId}/conditions/${dx.id}/update`, { body: { onset: onset || null, onsetYear: !onset && year ? Number(year) : null, attributes: attrs } });
        onDone(`${DIAGNOSIS[dx.code]?.display}: details saved`, r);
      } else if (what === "change") {
        const r = await api(`/patients/${patientId}/conditions/${dx.id}/change`, { body: { code: to, mode } });
        onDone(`${DIAGNOSIS[dx.code]?.display} → ${DIAGNOSIS[to]?.display}`, r);
      } else {
        const r = await api(`/patients/${patientId}/conditions/${dx.id}/status`, { body: { status } });
        onDone(`${DIAGNOSIS[dx.code]?.display} ${status === "resolved" ? "marked resolved" : "removed (entered in error)"}`, r);
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const yearBad = !!year && (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > Number(today.slice(0, 4)));
  const ok = what === "details" ? !yearBad : what === "change" ? !!to : !!status;
  return (
    <Drawer
      title={`Edit ${DIAGNOSIS[dx.code]?.display ?? dx.label}`}
      subtitle="Details, a change over time, or a correction. The earlier entry stays in the history."
      icon={<Stethoscope size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!ok || busy} onClick={save}>{busy ? "Saving…" : what === "change" ? "Change diagnosis" : what === "remove" ? (status === "resolved" ? "Mark resolved" : "Remove") : "Save"}</button>
        </span>
      }
    >
      <div className="drawer-body">
        <Segmented label="What to edit" options={[{ value: "details", label: "Details and onset" }, { value: "change", label: "Change diagnosis" }, { value: "remove", label: "Resolve or remove" }]} value={what} onChange={(v) => setWhat(v as any)} />
        {what === "details" && (
          <section className="study-box">
            <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
              <label className="field">
                <span>Onset date</span>
                <DateInput className="input" max={today} value={onset} onChange={(e) => (setOnset(e.target.value), e.target.value && setYear(""))} />
              </label>
              <label className="field" style={{ width: 120 }}>
                <span>or year</span>
                <input className={`input ${yearBad ? "bad" : ""}`} inputMode="numeric" placeholder="YYYY" disabled={!!onset} value={year} onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, "").slice(0, 4))} />
              </label>
            </div>
            {fields.filter((f) => fieldShown(f, attrs)).map((f) => (
              <div key={f.key} className="q">
                <div className="label">{f.label}</div>
                {f.multi ? (
                  <div className="choices">
                    {f.options.map((o) => {
                      const cur: string[] = attrs[f.key] ?? [];
                      const on = cur.includes(o);
                      return <button key={o} type="button" className="choice" aria-pressed={on} onClick={() => setAttrs({ ...attrs, [f.key]: on ? cur.filter((x) => x !== o) : [...cur, o] })}>{o}</button>;
                    })}
                  </div>
                ) : (
                  <SingleChoice label={f.label} options={f.options.map((o) => ({ value: o, label: o }))} value={attrs[f.key]} onChange={(v) => setAttrs({ ...attrs, [f.key]: attrs[f.key] === v ? undefined : v })} />
                )}
              </div>
            ))}
            {!fields.length && <div className="help">No further details are recorded for this diagnosis.</div>}
          </section>
        )}
        {what === "change" && (
          <section className="study-box">
            <div className="q">
              <div className="label">Why</div>
              <SingleChoice
                label="Why"
                options={[
                  { value: "changed", label: "It changed over time", hint: "For example CKD 3a → 3b, HFrEF → HF with improved EF. The old diagnosis is kept as resolved; the new one starts today." },
                  { value: "error", label: "The diagnosis was wrong", hint: "The wrong one is marked entered in error; the new one keeps its onset and matching details." },
                ]}
                value={mode}
                onChange={(v) => setMode(v as any)}
              />
            </div>
            <div className="q">
              <div className="label">Change to</div>
              <label className="row dx-search">
                <input className="grow" placeholder={`Search, or pick from ${family ?? "the same group"}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search diagnoses" />
              </label>
              <div className="dx-chips">
                {others.map((d) => (
                  <button key={d.code} type="button" className="dx-pick" aria-pressed={to === d.code} onClick={() => setTo(d.code)}>{d.display}</button>
                ))}
                {!others.length && <span className="muted small">No match.</span>}
              </div>
            </div>
          </section>
        )}
        {what === "remove" && (
          <section className="study-box">
            <SingleChoice
              label="Resolve or remove"
              options={[
                { value: "resolved", label: "Resolved", hint: "It was true and is no longer active (kept in the history)" },
                { value: "entered_in_error", label: "Entered in error", hint: "It should never have been recorded" },
              ]}
              value={status}
              onChange={(v) => setStatus(v as any)}
            />
          </section>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}
