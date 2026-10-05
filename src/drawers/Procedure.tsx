import { useState } from "react";
import { HeartPulse } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, MultiChoice, Segmented, SingleChoice } from "../ui";
import {
  ABLATION_ENERGY, ABLATION_RESULT, ABLATION_TARGETS, ACCESS, CABG_GRAFTS, COMPLEX_FEATURES, CV_METHOD, CV_PREP, CV_RESULT, CV_RHYTHM,
  DEVICE_ACTIONS, DEVICE_INDICATIONS, DEVICE_TYPES, PACING_SITES, REMOTE_MONITORING, VALVE_POSITIONS, VALVE_PROCEDURES, VALVE_PROSTHESES, VALVE_ACCESS, MECH_DESIGNS, PCI_DEVICES, PCI_SETTINGS, PCI_VESSELS, PROCEDURE_LABEL, RHC_NUMBERS, VASOREACTIVITY, cleanProcedure, procedureSummary, rhcClass, rhcPvr, type ProcedureKind,
} from "../../shared/procedures";

const opts = (l: readonly string[]) => l.map((x) => ({ value: x, label: x }));

// Record a procedure with its exact date: PCI or CABG (antithrombotic durations count from here), or a
// device implant, ablation or cardioversion (rhythm & devices).
export function ProcedureDrawer({ patientId, contextId, group = "coronary", onClose, onDone }: { patientId: string; contextId?: string; group?: "coronary" | "rhythm" | "valve" | "ph"; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data: health } = useData<any>("/health");
  const [kind, setKind] = useState<ProcedureKind>(group === "rhythm" ? "device" : group === "valve" ? "valve" : group === "ph" ? "rhc" : "pci");
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
    : kind === "valve" ? { position: v.position ?? null, procedure: v.vproc ?? null, prosthesis: v.prosthesis ?? null, design: v.design ?? null, access: v.vaccess ?? null }
    : kind === "rhc" ? { ...Object.fromEntries(RHC_NUMBERS.map((n) => [n.key, v[n.key] === undefined || v[n.key] === "" ? null : Number(v[n.key])])), vasoreactivity: v.vasoreactivity ?? "Not done" }
    : { method: v.method ?? null, rhythm: v.cvRhythm ?? "Atrial fibrillation", prep: v.prep ?? null, result: v.cvResult ?? "Sinus rhythm restored" };
  const missing = (kind === "pci" ? [!v.setting && "setting", !(v.vessels ?? []).length && "vessels"]
    : kind === "cabg" ? [!(v.grafts ?? []).length && "grafts"]
    : kind === "device" ? [!v.devType && "device"]
    : kind === "ablation" ? [!(v.targets ?? []).length && "target"]
    : kind === "valve" ? [!v.position && "valve", !v.vproc && "procedure", v.vproc === "Surgical replacement" && !v.prosthesis && "prosthesis"]
    : kind === "rhc" ? [!v.mpap && "mean PA pressure", !v.pawp && "wedge pressure", ...RHC_NUMBERS.filter((n) => v[n.key] && !(Number(v[n.key]) >= n.min && Number(v[n.key]) <= n.max)).map((n) => `${n.label} ${n.min}–${n.max}`)]
    : [!v.method && "method"]).filter(Boolean);
  const preview = missing.length ? "" : (() => { try { return procedureSummary(kind, kind === "rhc" ? cleanProcedure(kind, details) : details); } catch { return ""; } })();

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
      title={group === "rhythm" ? "Record device, ablation or cardioversion" : group === "valve" ? "Record valve intervention" : group === "ph" ? "Record right heart catheterisation" : "Record PCI or CABG"}
      subtitle={group === "rhythm" ? "Dated so device follow-up and anticoagulation around cardioversion and ablation can be timed" : group === "ph" ? "Classified by the 2022 ESC/ERS haemodynamic definitions; PH joins the problem list" : group === "valve" ? "The prosthesis or repair joins the problem list; antithrombotic therapy and follow-up are timed from this date" : "The exact date and setting time DAPT and anticoagulant combinations"}
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
          {group !== "valve" && group !== "ph" && <Segmented label="Procedure" options={(group === "rhythm" ? (["device", "ablation", "cardioversion"] as ProcedureKind[]) : (["pci", "cabg"] as ProcedureKind[])).map((k) => ({ value: k, label: PROCEDURE_LABEL[k] }))} value={kind} onChange={(x) => setKind(x as ProcedureKind)} />}
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
        ) : kind === "rhc" ? (
          <>
            <div className="echo-nums">
              {RHC_NUMBERS.map((n) => (
                <label key={n.key} className="field">
                  <span>{n.label} <span className="muted">{n.unit}</span></span>
                  <input className="input num" inputMode="decimal" value={v[n.key] ?? ""} onChange={(e) => set(n.key, e.target.value)} aria-label={`${n.label} ${n.unit}`} />
                </label>
              ))}
            </div>
            <div className="q">
              <div className="label">Vasoreactivity test</div>
              <Segmented label="Vasoreactivity" options={opts(VASOREACTIVITY)} value={v.vasoreactivity ?? "Not done"} onChange={(x) => set("vasoreactivity", x)} />
            </div>
            {v.mpap && v.pawp && (() => {
              const n = { mpap: Number(v.mpap), pawp: Number(v.pawp), co: v.co ? Number(v.co) : null, pvr: v.pvr ? Number(v.pvr) : null };
              const pvr = rhcPvr(n);
              return <div className="infobox"><span>{`${rhcClass(n)}${pvr != null ? ` · PVR ${pvr} WU${v.pvr ? "" : " (computed)"}` : ""} · ESC/ERS 2022: PH mPAP >20; pre-capillary PAWP ≤15 and PVR >2; post-capillary PAWP >15`}</span></div>;
            })()}
          </>
        ) : kind === "valve" ? (
          <>
            <div className="q">
              <div className="label">Valve</div>
              <Segmented label="Valve" options={opts(VALVE_POSITIONS)} value={v.position} onChange={(x) => { set("position", x); if (x !== "Aortic" && v.vproc === "TAVI") set("vproc", undefined); }} />
            </div>
            <div className="q">
              <div className="label">Procedure</div>
              <SingleChoice label="Procedure" options={opts(VALVE_PROCEDURES.filter((p) => p !== "TAVI" || v.position === "Aortic" || !v.position))} value={v.vproc} onChange={(x) => set("vproc", x)} />
            </div>
            {v.vproc === "Surgical replacement" && (
              <div className="q">
                <div className="label">Prosthesis</div>
                <Segmented label="Prosthesis" options={opts(VALVE_PROSTHESES)} value={v.prosthesis} onChange={(x) => set("prosthesis", x)} />
              </div>
            )}
            {v.vproc === "Surgical replacement" && v.prosthesis === "Mechanical" && (
              <div className="q">
                <div className="label">Mechanical valve design</div>
                <div className="help">Sets the INR target with the position and the patient's risk factors (ESC/EACTS 2025).</div>
                <SingleChoice label="Valve design" options={opts(MECH_DESIGNS)} value={v.design} onChange={(x) => set("design", x)} />
              </div>
            )}
            {(v.vproc === "TAVI" || v.vproc === "Valve-in-valve") && (
              <div className="q">
                <div className="label">Access</div>
                <Segmented label="Access" options={opts(VALVE_ACCESS)} value={v.vaccess} onChange={(x) => set("vaccess", x)} />
              </div>
            )}
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
