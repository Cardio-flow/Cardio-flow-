import { useState } from "react";
import { Eraser, PencilLine } from "lucide-react";
import { api } from "../api";
import { Drawer, SingleChoice, DateInput } from "../ui";
import { MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog";
import { fmtDay } from "../../shared/clinical";

// Correcting medical data. History is append-only: a wrong entry is marked entered in error (or replaced by a
// corrected copy); it leaves the record, the alerts are recalculated, and the original stays for the audit.
const REASONS = ["Wrong entry", "Wrong patient", "Duplicate entry", "Never happened"];
const KIND: Record<string, string> = { start: "Started", restart: "Restarted", increase: "Increased", decrease: "Reduced", hold: "Held", stop: "Stopped", continue: "Changed", not_taking: "Not taking", resume: "Taken again", planned: "Planned" };
const AUDIT_NOTE = "Nothing is erased: the original and the correction are both kept, and the alerts are recalculated.";

function useSave(onDone: (m?: string, r?: any) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(path: string, body: unknown, message: string) {
    setBusy(true);
    setError("");
    try {
      onDone(message, await api(path, { body }));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return { busy, error, run };
}

// A study, echo or procedure entered in error.
export function VoidEntry({ patientId, what, path, onClose, onDone }: { patientId: string; what: string; path: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useSave(onDone);
  return (
    <Drawer
      title="Entered in error"
      subtitle={what}
      icon={<Eraser size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!reason || busy} onClick={() => run(`/patients/${patientId}/${path}`, { reason }, `${what}: marked entered in error`)}>
            Remove from the record
          </button>
        </span>
      }
    >
      <div className="drawer-body">
        <div className="q">
          <div className="label">Why is it wrong?</div>
          <SingleChoice label="Why is it wrong" options={REASONS.map((r) => ({ value: r, label: r }))} value={reason} onChange={setReason} />
        </div>
        <div className="infobox">{AUDIT_NOTE} To replace it with the right values, record it again afterwards.</div>
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

// One test's recent values: correct a value, or mark it entered in error.
export function CorrectResult({ patientId, result, onClose, onDone }: { patientId: string; result: any; onClose(): void; onDone(m?: string, r?: any): void }) {
  const def = MEASURES[result.code];
  const values = [...result.series].reverse().filter((p: any) => p.status !== "entered_in_error");
  const [sel, setSel] = useState<string>(values[0]?.id ?? "");
  const [mode, setMode] = useState<"value" | "error" | "">("");
  const [value, setValue] = useState("");
  const { busy, error, run } = useSave(onDone);
  const cur = values.find((p: any) => p.id === sel);
  const num = Number(value);
  const ok = mode === "error" || (mode === "value" && value.trim() !== "" && Number.isFinite(num) && num >= 0 && num !== cur?.value);
  return (
    <Drawer
      title={`Correct ${def?.display ?? result.display}`}
      subtitle="Choose the wrong value, then give the right one or mark it entered in error."
      icon={<PencilLine size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!ok || busy}
            onClick={() =>
              run(
                `/patients/${patientId}/observations/${sel}/correct`,
                mode === "error" ? { enteredInError: true } : { value: num },
                mode === "error" ? `${def?.display ?? result.display} of ${fmtDay(cur.at)} removed` : `${def?.display ?? result.display} corrected to ${value} ${result.unit}`,
              )
            }
          >
            Save correction
          </button>
        </span>
      }
    >
      <div className="drawer-body">
        <div className="q">
          <div className="label">Which value?</div>
          <SingleChoice
            label="Which value"
            options={values.map((p: any) => ({ value: p.id, label: `${formatNumber(p.value, result.decimals)} ${result.unit} · ${fmtDay(p.at, { year: true })}` }))}
            value={sel}
            onChange={(v) => (setSel(v), setValue(""))}
          />
        </div>
        {sel && (
          <div className="q">
            <div className="label">Correction</div>
            <SingleChoice
              label="Correction"
              options={[{ value: "value", label: "The value was wrong" }, { value: "error", label: "Entered in error (remove it)" }]}
              value={mode}
              onChange={(v) => setMode(v as any)}
            />
          </div>
        )}
        {mode === "value" && (
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Right value ({result.unit})</span>
            <input className="input" inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} />
          </label>
        )}
        {result.code === "creatinine" && <div className="infobox">The eGFR calculated from this creatinine follows the correction.</div>}
        <div className="infobox">{AUDIT_NOTE}</div>
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

// A medicine: fix the last entry (dose, frequency, date), take back the last change, or remove the medicine.
export function CorrectMedication({ patientId, med, today, onClose, onDone }: { patientId: string; med: any; today: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const def = MEDICATION[med.code];
  const events = (med.events ?? []).filter((e: any) => e.kind !== "planned");
  const last = events[events.length - 1];
  const [mode, setMode] = useState<string>("");
  const [dose, setDose] = useState<string>(last?.dose_value != null ? String(last.dose_value) : "");
  const [freq, setFreq] = useState<string>(last?.frequency ?? "");
  const [day, setDay] = useState<string>(last ? String(last.effective_at).slice(0, 10) : today);
  const [reason, setReason] = useState("");
  const { busy, error, run } = useSave(onDone);
  if (!last || !def) return null;
  const lastText = `${KIND[last.kind] ?? last.kind}${last.dose_value != null ? ` · ${doseLabel(def, last.dose_value)}` : ""}${last.frequency ? ` ${last.frequency}` : ""} · ${fmtDay(last.effective_at, { year: true })}`;
  const options = [
    { value: "fix", label: "Fix the last entry", hint: "Wrong dose, frequency or date" },
    ...(events.length > 1 ? [{ value: "undo", label: "Take back the last change", hint: `${KIND[last.kind] ?? last.kind} on ${fmtDay(last.effective_at)} was recorded by mistake` }] : []),
    { value: "void", label: "Remove the medicine", hint: "It should not be on this patient's list at all" },
  ];
  const sameFix = Number(dose) === last.dose_value && freq === (last.frequency ?? "") && day === String(last.effective_at).slice(0, 10);
  const ok = mode === "fix" ? !sameFix && day <= today : mode === "undo" || (mode === "void" && !!reason);
  const at = (d: string) => new Date(`${d}T${new Date(last.effective_at).toISOString().slice(11, 19)}Z`).toISOString();
  function save() {
    if (mode === "fix")
      run(`/patients/${patientId}/medications/${med.id}/correct`, { doseValue: last.dose_value != null ? Number(dose) : undefined, frequency: freq || undefined, effectiveAt: at(day), reason: "Corrected" }, `${def.name}: entry corrected`);
    else if (mode === "undo") run(`/patients/${patientId}/medications/${med.id}/undo`, { reason: reason || "Recorded by mistake" }, `${def.name}: last change taken back`);
    else run(`/patients/${patientId}/medications/${med.id}/void`, { reason }, `${def.name} removed (entered in error)`);
  }
  return (
    <Drawer
      title={`Correct ${def.name}`}
      subtitle={`Last entry: ${lastText}`}
      icon={<PencilLine size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!ok || busy} onClick={save}>{mode === "void" ? "Remove the medicine" : mode === "undo" ? "Take back the change" : "Save correction"}</button>
        </span>
      }
    >
      <div className="drawer-body">
        <div className="q">
          <div className="label">What was wrong?</div>
          <SingleChoice label="What was wrong" options={options} value={mode} onChange={setMode} />
        </div>
        {mode === "fix" && (
          <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
            {last.dose_value != null && (
              <label className="field">
                <span>Dose</span>
                <select className="input" value={dose} onChange={(e) => setDose(e.target.value)}>
                  {[...new Set([last.dose_value, ...def.doses])].sort((a, b) => a - b).map((d) => (
                    <option key={d} value={d}>{doseLabel(def, d)}</option>
                  ))}
                </select>
              </label>
            )}
            {last.frequency && (
              <label className="field">
                <span>Frequency</span>
                <select className="input" value={freq} onChange={(e) => setFreq(e.target.value)}>
                  {[...new Set([last.frequency, ...def.frequencies])].map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Date</span>
              <DateInput className="input" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
          </div>
        )}
        {(mode === "void" || mode === "undo") && (
          <div className="q">
            <div className="label">{mode === "void" ? "Why should it not be there?" : "Why (optional)"}</div>
            <SingleChoice label="Reason" options={REASONS.map((r) => ({ value: r, label: r }))} value={reason} onChange={setReason} />
          </div>
        )}
        {mode === "void" && <div className="infobox">Its planned medication steps are cancelled with it. If the patient really took it and stopped, use Change → Stop instead.</div>}
        <div className="infobox">{AUDIT_NOTE}</div>
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}
