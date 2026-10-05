import { useState } from "react";
import { Activity } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, MultiChoice, Segmented } from "../ui";
import { ECHO_NUMBERS, ECHO_VALVES, MR_TYPES, VALVE_GRADES } from "../../shared/studies";
import { PH_SIGNS, PROBABILITY_LABEL, phEchoProbability } from "../../shared/ph";

// valve lesions are graded in the Valves section below; these are the other findings
const FINDINGS = [
  "Dilated LV", "LV size normalised", "Regional wall motion abnormality", "LV thrombus", "LV hypertrophy", "RV dysfunction", "Calcified aortic valve", "Bicuspid aortic valve",
  "Asymmetric septal hypertrophy", "Systolic anterior motion (SAM)", "LV apical aneurysm", "Rheumatic mitral valve", "Prosthetic valve dysfunction", "Prosthetic valve thrombus", "Paravalvular leak", "Dilated aortic root / ascending aorta", "Raised PASP", "Dilated IVC", "Pericardial effusion", "Limited windows",
];

export function AddEcho({ patientId, contextId, onClose, onDone }: { patientId: string; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data: health } = useData<any>("/health");
  const [date, setDate] = useState("");
  const [quality, setQuality] = useState("formal");
  const [lvef, setLvef] = useState("");
  const [findings, setFindings] = useState<string[]>([]);
  const [conclusion, setConclusion] = useState("");
  const [valves, setValves] = useState<Record<string, string>>({});
  const [mrType, setMrType] = useState<string | undefined>();
  const [nums, setNums] = useState<Record<string, string>>({});
  const [phSigns, setPhSigns] = useState<string[]>([]);
  const trvNum = nums.trv ? Number(nums.trv) : null;
  const prob = trvNum != null || phSigns.length ? phEchoProbability(trvNum, phSigns) : null;
  const badNum = ECHO_NUMBERS.filter((n) => nums[n.code] && !(Number(nums[n.code]) >= n.min && Number(nums[n.code]) <= n.max));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ef = Number(lvef);
  const valid = ef >= 5 && ef <= 85 && !badNum.length;
  async function save() {
    setBusy(true);
    try {
      const at = date ? new Date(`${date}T10:00:00+03:00`).toISOString() : new Date().toISOString();
      const r = await api(`/patients/${patientId}/echo`, { body: {
        date: at, quality, lvef: ef, findings, conclusion, contextId: contextId ?? null,
        valves, mrType: valves.mr && valves.mr !== "None" ? mrType ?? null : null,
        measures: Object.fromEntries(Object.entries(nums).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])),
        phSigns,
      } });
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
          <div className="label" style={{ fontSize: 15 }}>Valves <span className="muted">(grade as reported)</span></div>
          <div className="echo-valves">
            {ECHO_VALVES.map((v) => (
              <div key={v.key} className="echo-valve">
                <span>{v.label}</span>
                <Segmented label={v.label} options={VALVE_GRADES.map((g) => ({ value: g, label: g }))} value={valves[v.key]} onChange={(g) => setValves({ ...valves, [v.key]: g })} />
                {v.key === "mr" && valves.mr && valves.mr !== "None" && (
                  <Segmented label="MR mechanism" options={MR_TYPES.map((g) => ({ value: g, label: g }))} value={mrType} onChange={setMrType} />
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="q">
          <div className="label" style={{ fontSize: 15 }}>Measurements <span className="muted">(optional)</span></div>
          <div className="echo-nums">
            {ECHO_NUMBERS.map((n) => (
              <label key={n.code} className="field">
                <span>{n.label} <span className="muted">{n.unit}</span></span>
                <input className={`input num${badNum.includes(n) ? " bad" : ""}`} inputMode="decimal" value={nums[n.code] ?? ""} onChange={(e) => setNums({ ...nums, [n.code]: e.target.value })} aria-label={`${n.label} ${n.unit}`} />
              </label>
            ))}
          </div>
          {badNum.length > 0 && <div className="error-box">{badNum.map((n) => `${n.label}: ${n.min}–${n.max} ${n.unit}`).join(" · ")}</div>}
        </div>
        <div className="q">
          <div className="label" style={{ fontSize: 15 }}>Signs of pulmonary hypertension <span className="muted">(with the TR velocity above)</span></div>
          <MultiChoice options={PH_SIGNS.map((s) => ({ value: s.key, label: s.label }))} value={phSigns} onChange={setPhSigns} />
          {prob && <div className="infobox"><span>{`Echo probability of PH: ${PROBABILITY_LABEL[prob.probability]}${prob.trv != null ? ` · TRV ${prob.trv} m/s` : " · TRV not measured"}${prob.categories.length ? ` · signs in ${prob.categories.length} categor${prob.categories.length > 1 ? "ies" : "y"}` : ""} (ESC/ERS 2022)`}</span></div>}
        </div>
        <div className="q">
          <div className="label" style={{ fontSize: 15 }}>Other findings</div>
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
