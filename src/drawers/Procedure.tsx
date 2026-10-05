import { useState } from "react";
import { HeartPulse } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, MultiChoice, Segmented, SingleChoice } from "../ui";
import {
  ABLATION_ENERGY, ABLATION_RESULT, ABLATION_TARGETS, ACCESS, CABG_GRAFTS, COMPLEX_FEATURES, CV_METHOD, CV_PREP, CV_RESULT, CV_RHYTHM,
  DEVICE_ACTIONS, DEVICE_INDICATIONS, DEVICE_TYPES, PACING_SITES, REMOTE_MONITORING, PCI_DEVICES, PCI_SETTINGS, PCI_VESSELS, PROCEDURE_LABEL, procedureSummary, type ProcedureKind,
} from "../../shared/procedures";

const opts = (l: readonly string[]) => l.map((x) => ({ value: x, label: x }));

// Record a procedure with its exact date: PCI or CABG (antithrombotic durations count from here), or a
// device implant, ablation or cardioversion (rhythm & devices).
export function ProcedureDrawer({ patientId, contextId, group = "coronary", onClose, onDone }: { patientId: string; contextId?: string; group?: "coronary" | "rhythm"; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data: health } = useData<any>("/health");
  const [kind, setKind] = useState<ProcedureKind>(group === "rhythm" ? "device" : "pci");
  const [date, setDate] = useState("");
  const [v, setV] = useState<Record<string, any>>({ device: "Drug-eluting stent", complex: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string, x: any) => setV((o) => ({ ...o, [k]: x }));
  const details = kind === "pci"
    ? { setting: v.setting, vessels: v.vessels ?? [], device: v.device, stents: v.device === "Drug-eluting stent" && v.stents ? Number(v.stents) : null, complex: v.complex ?? [], access: v.access ?? null }
    : kind === "cabg" ? { grafts: v.grafts ?? [], count: v.count ? Number(v.count) : null, setting: v.cabgSetting ?? "elective" }
    : kind === "device" ? { type: v.devType ?? null, action: v.devAction ?? "New implant", indication: v.indication ?? null, pacing: v.pacing ?? null, remote: v.remote ?? null }
    : kind === "ablation" ? { targets: v.targets ?? [], energy: v.energy ?? null, result: v.ablResult ?? "Acute success" }
    : { method: v.method ?? null, rhythm: v.cvRhythm ?? "Atrial fibrillation", prep: v.prep ?? null, result: v.cvResult ?? "Sinus rhythm restored" };
  const missing = (kind === "pci" ? [!v.setting && "setting", !(v.vessels ?? []).length && "vessels"]
    : kind === "cabg" ? [!(v.grafts ?? []).length && "grafts"]
    : kind === "device" ? [!v.devType && "device"]
    : kind === "ablation" ? [!(v.targets ?? []).length && "target"]
    : [!v.method && "method"]).filter(Boolean);
  const preview = missing.length ? "" : procedureSummary(kind, details);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const at = new Date(`${date}T10:00:00+03:00`).toISOString();
      const r = await api(`/patients/${patientId}/procedures`, { body: { kind, date: at, details, contextId: contextId ?? null } });
      onDone(`${PROCEDURE_LABEL[kind]} recorded`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={group === "rhythm" ? "Record device, ablation or cardioversion" : "Record PCI or CABG"}
      subtitle={group === "rhythm" ? "Dated so device follow-up and anticoagulation around cardioversion and ablation can be timed" : "The exact date and setting time DAPT and anticoagulant combinations"}
      icon={<HeartPulse size={22} />}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="note">{!date ? "Needed: date" : missing.length ? `Needed: ${missing.join(", ")}` : preview}</span>
          <span className="end">
            <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || !date || missing.length > 0} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          </span>
        </>
      }
    >
      <div className="drawer-body">
        <div className="row wrap" style={{ gap: 18, alignItems: "flex-end" }}>
          <Segmented label="Procedure" options={(group === "rhythm" ? (["device", "ablation", "cardioversion"] as ProcedureKind[]) : (["pci", "cabg"] as ProcedureKind[])).map((k) => ({ value: k, label: PROCEDURE_LABEL[k] }))} value={kind} onChange={(x) => setKind(x as ProcedureKind)} />
          <label className="field">
            <span>Date</span>
            <input type="date" className="input" max={health?.today} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {kind === "pci" ? (
          <>
            <div className="q">
              <div className="label">Setting</div>
              <SingleChoice label="Setting" options={PCI_SETTINGS.map((s) => ({ value: s.value, label: s.label }))} value={v.setting} onChange={(x) => set("setting", x)} />
            </div>
            <div className="q">
              <div className="label">Vessels treated</div>
              <MultiChoice options={PCI_VESSELS.map((x) => ({ value: x, label: x }))} value={v.vessels ?? []} onChange={(x) => set("vessels", x)} />
            </div>
            <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
              <div className="q">
                <div className="label">Device</div>
                <SingleChoice label="Device" options={PCI_DEVICES.map((x) => ({ value: x, label: x }))} value={v.device} onChange={(x) => set("device", x)} />
              </div>
              {v.device === "Drug-eluting stent" && (
                <label className="field" style={{ maxWidth: 140 }}>
                  <span>Number of stents</span>
                  <input type="number" min={1} max={12} className="input" value={v.stents ?? ""} onChange={(e) => set("stents", e.target.value)} />
                </label>
              )}
            </div>
            <div className="q">
              <div className="label">Complex PCI (any of these)</div>
              <div className="help">ESC definition used for DAPT decisions.</div>
              <MultiChoice options={COMPLEX_FEATURES.map((x) => ({ value: x, label: x }))} value={v.complex ?? []} onChange={(x) => set("complex", x)} />
            </div>
            <div className="q">
              <div className="label">Access</div>
              <Segmented label="Access" options={ACCESS.map((x) => ({ value: x, label: x }))} value={v.access} onChange={(x) => set("access", x)} />
            </div>
          </>
        ) : kind === "device" ? (
          <>
            <div className="q">
              <div className="label">Device</div>
              <SingleChoice label="Device" options={opts(DEVICE_TYPES)} value={v.devType} onChange={(x) => set("devType", x)} />
            </div>
            <div className="q">
              <div className="label">Procedure</div>
              <SingleChoice label="Procedure" options={opts(DEVICE_ACTIONS)} value={v.devAction ?? "New implant"} onChange={(x) => set("devAction", x)} />
            </div>
            <div className="q">
              <div className="label">Indication</div>
              <SingleChoice label="Indication" options={opts(DEVICE_INDICATIONS)} value={v.indication} onChange={(x) => set("indication", x)} />
            </div>
            {v.devType !== "Implantable loop recorder" && v.devType !== "Subcutaneous ICD" && (
              <div className="q">
                <div className="label">Ventricular pacing</div>
                <SingleChoice label="Ventricular pacing" options={opts(PACING_SITES)} value={v.pacing} onChange={(x) => set("pacing", x)} />
              </div>
            )}
            {v.devAction !== "Extraction" && (
              <div className="q">
                <div className="label">Remote monitoring <span className="muted">(optional)</span></div>
                <SingleChoice label="Remote monitoring" options={opts(REMOTE_MONITORING)} value={v.remote} onChange={(x) => set("remote", x)} />
              </div>
            )}
          </>
        ) : kind === "ablation" ? (
          <>
            <div className="q">
              <div className="label">Ablated</div>
              <MultiChoice options={opts(ABLATION_TARGETS)} value={v.targets ?? []} onChange={(x) => set("targets", x)} />
            </div>
            <div className="q">
              <div className="label">Energy</div>
              <Segmented label="Energy" options={opts(ABLATION_ENERGY)} value={v.energy} onChange={(x) => set("energy", x)} />
            </div>
            <div className="q">
              <div className="label">Result</div>
              <Segmented label="Result" options={opts(ABLATION_RESULT)} value={v.ablResult ?? "Acute success"} onChange={(x) => set("ablResult", x)} />
            </div>
          </>
        ) : kind === "cardioversion" ? (
          <>
            <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
              <Segmented label="Method" options={opts(CV_METHOD)} value={v.method} onChange={(x) => set("method", x)} />
              <Segmented label="Rhythm" options={opts(CV_RHYTHM)} value={v.cvRhythm ?? "Atrial fibrillation"} onChange={(x) => set("cvRhythm", x)} />
            </div>
            <div className="q">
              <div className="label">Before cardioversion</div>
              <SingleChoice label="Before cardioversion" options={opts(CV_PREP)} value={v.prep} onChange={(x) => set("prep", x)} />
            </div>
            <div className="q">
              <div className="label">Result</div>
              <Segmented label="Result" options={opts(CV_RESULT)} value={v.cvResult ?? "Sinus rhythm restored"} onChange={(x) => set("cvResult", x)} />
            </div>
          </>
        ) : (
          <>
            <div className="q">
              <div className="label">Grafts</div>
              <MultiChoice options={CABG_GRAFTS.map((x) => ({ value: x, label: x }))} value={v.grafts ?? []} onChange={(x) => set("grafts", x)} />
            </div>
            <div className="row wrap" style={{ gap: 16, alignItems: "flex-end" }}>
              <label className="field" style={{ maxWidth: 160 }}>
                <span>Number of grafts</span>
                <input type="number" min={1} max={8} className="input" value={v.count ?? ""} onChange={(e) => set("count", e.target.value)} />
              </label>
              <Segmented label="Setting" options={[{ value: "elective", label: "Elective" }, { value: "acs", label: "During ACS" }]} value={v.cabgSetting ?? "elective"} onChange={(x) => set("cabgSetting", x)} />
            </div>
          </>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}
