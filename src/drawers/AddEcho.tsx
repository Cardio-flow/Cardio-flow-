import { useState } from "react";
import { Activity } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, MultiChoice, Segmented } from "../ui";

const FINDINGS = [
  "Dilated LV", "LV size normalised", "Regional wall motion abnormality", "LV thrombus", "RV dysfunction", "Moderate secondary MR", "Severe secondary MR",
  "Mild secondary MR", "Severe calcific AS", "Moderate AS", "Moderate AR", "Severe TR", "Raised PASP", "Dilated IVC", "Pericardial effusion", "Limited windows",
];

export function AddEcho({ patientId, contextId, onClose, onDone }: { patientId: string; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data: health } = useData<any>("/health");
  const [date, setDate] = useState("");
  const [quality, setQuality] = useState("formal");
  const [lvef, setLvef] = useState("");
  const [findings, setFindings] = useState<string[]>([]);
  const [conclusion, setConclusion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ef = Number(lvef);
  const valid = ef >= 5 && ef <= 85;
  async function save() {
    setBusy(true);
    try {
      const at = date ? new Date(`${date}T10:00:00+03:00`).toISOString() : new Date().toISOString();
      const r = await api(`/patients/${patientId}/echo`, { body: { date: at, quality, lvef: ef, findings, conclusion, contextId: contextId ?? null } });
      onDone(`Echo recorded · LVEF ${ef}%`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Add Echo"
      subtitle="One Echo source for HF, valve and device decisions"
      icon={<Activity size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : "Save Echo"}</button>
        </span>
      }
    >
      <div className="drawer-body">
        <div className="row wrap" style={{ gap: 28 }}>
          <label className="field">
            <span>Study date</span>
            <input type="date" className="input" max={health?.today} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="q">
            <div className="label" style={{ fontSize: 13, fontWeight: 800 }}>Study quality</div>
            <Segmented label="Study quality" options={[{ value: "formal", label: "Formal TTE" }, { value: "limited", label: "Limited" }, { value: "bedside", label: "Bedside / POCUS" }]} value={quality} onChange={setQuality} />
          </div>
        </div>
        <label className="field">
          <span>LVEF</span>
          <span className="row">
            <input className="input num" inputMode="numeric" autoFocus value={lvef} onChange={(e) => setLvef(e.target.value)} aria-label="LVEF percent" />
            <b className="muted">%</b>
          </span>
        </label>
        {quality !== "formal" && (
          <div className="infobox">A limited or bedside study is kept in the record but does not replace a recent formal study as the current LVEF. You can override that in Investigations.</div>
        )}
        <div className="q">
          <div className="label" style={{ fontSize: 15 }}>Key findings</div>
          <MultiChoice options={FINDINGS.map((f) => ({ value: f, label: f }))} value={findings} onChange={setFindings} />
        </div>
        <label className="field">
          <span>Conclusion (optional)</span>
          <textarea className="input" rows={3} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
        </label>
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}
