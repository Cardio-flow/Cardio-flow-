// Import a case file (14 Oct 2026): a patient's existing record in one step — choose the file (or paste it),
// check the preview (name, file number, sex, age, counts), then record. Nothing is saved before "Record patient".
import { useState } from "react";
import { FileUp } from "lucide-react";
import { api } from "../api";
import { Drawer } from "../ui";

export function ImportCase({ onClose, onCreated }: { onClose(): void; onCreated(id: string): void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [age, setAge] = useState("");
  let parsed: any = null, parseError = "";
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
      if (parsed?.format !== "cardioflow-case/1") parseError = "Not a CardioFlow case file";
    } catch {
      parseError = "The file could not be read as a case file";
    }
  }
  const p = parsed?.patient;
  // a case without date of birth, age or civil ID: the age is asked here
  const needAge = !!p && !p.birthDate && !p.age && !p.civilId;
  if (needAge && Number(age) > 0) parsed.patient = { ...p, age: Number(age) };
  async function pick(f: File | undefined) {
    if (!f) return;
    setText(await f.text());
    setError("");
  }
  async function save() {
    if (!parsed || parseError || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string }>("/patients/import", { body: parsed });
      onCreated(r.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const count = (k: string) => (Array.isArray(parsed?.[k]) ? parsed[k].length : 0);
  const n = (k: string | string[], one: string, many: string) => { const c = [k].flat().reduce((a, x) => a + count(x), 0); return `${c} ${c === 1 ? one : many}`; };
  return (
    <Drawer
      title="Import case"
      subtitle="A patient's existing record from a case file: diagnoses, results, studies, procedures and current medicines"
      icon={<FileUp size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!parsed || !!parseError || busy || (needAge && !(Number(age) > 0))} onClick={save}>{busy ? "Recording…" : "Record patient"}</button>
        </span>
      }
    >
      <div className="drawer-body">
        <label className="field">
          <span>Case file</span>
          <input className="input" type="file" accept=".json,application/json" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <details>
          <summary className="small muted">or paste the file content</summary>
          <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"format":"cardioflow-case/1", …}' />
        </details>
        {parseError && <div className="error-box">{parseError}</div>}
        {p && !parseError && (
          <div className="infobox" style={{ display: "grid", gap: 4 }}>
            <b>{p.name} · MRN {p.mrn} · {p.sex}{p.age ? ` · ${p.age} y` : p.birthDate ? ` · born ${p.birthDate}` : ""}</b>
            <span>{parsed.sample ? "Sample patient" : "Real patient"} · {n("conditions", "diagnosis", "diagnoses")} · {n("results", "result date", "result dates")} · {n(["echoes", "studies"], "study", "studies")} · {n("procedures", "procedure", "procedures")} · {n("medications", "medicine", "medicines")} ({(parsed.medications ?? []).filter((m: any) => !m.since).length} already taking)</span>
            <span className="small muted">Every entry goes through the same checks as manual entry; if one fails, nothing is recorded and the message names it.</span>
          </div>
        )}
        {needAge && (
          <label className="field" style={{ maxWidth: 200 }}>
            <span>Age (years) — not in the file</span>
            <input className="input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, "").slice(0, 3))} />
          </label>
        )}
        {error && <div className="error-box" role="alert">{error}</div>}
      </div>
    </Drawer>
  );
}
