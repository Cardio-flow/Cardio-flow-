import { LAA_DEVICES, LAA_METHODS, LAA_RESULTS, LAA_REGIMENS } from "../../shared/af";
import { useState } from "react";
import { HeartPulse } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, MultiChoice, Segmented, SingleChoice, DateInput } from "../ui";
import { STRUCTURAL_RESULTS, STRUCTURAL_COMPLICATIONS, RESIDUAL_GRADES, structuralTarget } from "../../shared/structural";
import {
  ABLATION_ENERGY, ABLATION_RESULT, ABLATION_TARGETS, ACCESS, CABG_GRAFTS, COMPLEX_FEATURES, CV_METHOD, CV_PREP, CV_RESULT, CV_RHYTHM,
  DEVICE_ACTIONS, DEVICE_INDICATIONS, DEVICE_TYPES, PACING_SITES, REMOTE_MONITORING, VALVE_POSITIONS, VALVE_PROCEDURES, VALVE_PROSTHESES, VALVE_ACCESS, MECH_DESIGNS, PCI_COMPLICATIONS, PCI_DEVICES, PCI_SETTINGS, PCI_VESSELS, PROCEDURE_LABEL, RHC_NUMBERS, VASOREACTIVITY, cleanProcedure, procedureSummary, rhcClass, rhcPvr, type ProcedureKind,
} from "../../shared/procedures";

const opts = (l: readonly string[]) => l.map((x) => ({ value: x, label: x }));

// Record a procedure with its exact date: PCI or CABG (antithrombotic durations count from here), or a
// device implant, ablation or cardioversion (rhythm & devices).
export function ProcedureDrawer({ patientId, contextId, group = "coronary", initialKind, onClose, onDone, onAfterPci, onAfter }: { patientId: string; contextId?: string; group?: "coronary" | "rhythm" | "valve" | "ph"; initialKind?: ProcedureKind; onClose(): void; onDone(m?: string, r?: any): void; onAfterPci?(): void; onAfter?(wizard: string): void }) {
  const { data: health } = useData<any>("/health");
  const [kind, setKind] = useState<ProcedureKind>(initialKind ?? (group === "rhythm" ? "device" : group === "valve" ? "valve" : group === "ph" ? "rhc" : "pci"));
  const [date, setDate] = useState("");
  const [v, setV] = useState<Record<string, any>>({ devices: ["Drug-eluting stent"], complex: [], complications: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string, x: any) => setV((o) => ({ ...o, [k]: x }));
  const details = kind === "pci"
    ? { setting: v.setting, vessels: v.vessels ?? [], devices: v.devices ?? [], stents: (v.devices ?? []).includes("Drug-eluting stent") ? Number(v.stents ?? 1) : null, dcb: (v.devices ?? []).includes("Drug-coated balloon") ? Number(v.dcb ?? 1) : null, complex: v.complex ?? [], complications: v.complications ?? [], access: v.access ?? null }
    : kind === "cabg" ? { grafts: v.grafts ?? [], count: v.count ? Number(v.count) : null, setting: v.cabgSetting ?? "elective" }
    : kind === "device" ? { type: v.devType ?? null, action: v.devAction ?? "New implant", indication: v.indication ?? null, pacing: v.pacing ?? null, remote: v.remote ?? null }
    : kind === "ablation" ? { targets: v.targets ?? [], energy: v.energy ?? null, result: v.ablResult ?? "Acute success" }
    : kind === "laao" ? { method: v.laaMethod, device: v.laaDevice, result: v.laaResult, regimen: v.laaRegimen, reviewDate: v.laaReview ?? null }
    : kind === "valve" ? { position: v.position ?? null, procedure: v.vproc ?? null, prosthesis: v.prosthesis ?? null, design: v.design ?? null, access: v.vaccess ?? null, result:v.valveResult ?? "Completed", deviceModel:v.deviceModel || null, deviceSize:v.deviceSize || null, implantCount:v.implantCount || null, residualGrade:v.residualGrade || null, meanGradient:v.meanGradient || null, complications:v.valveComplications ?? [] }
    : kind === "rhc" ? { ...Object.fromEntries(RHC_NUMBERS.map((n) => [n.key, v[n.key] === undefined || v[n.key] === "" ? null : Number(v[n.key])])), vasoreactivity: v.vasoreactivity ?? "Not done" }
    : { method: v.method ?? null, rhythm: v.cvRhythm ?? "Atrial fibrillation", prep: v.prep ?? null, result: v.cvResult ?? "Sinus rhythm restored" };
  const missing = (kind === "pci" ? [!v.setting && "setting", !(v.vessels ?? []).length && "vessels", !(v.devices ?? []).length && "device"]
    : kind === "cabg" ? [!(v.grafts ?? []).length && "grafts"]
    : kind === "device" ? [!v.devType && "device"]
    : kind === "ablation" ? [!(v.targets ?? []).length && "target"]
    : kind === "laao" ? [!v.laaMethod && "closure method", !v.laaDevice && "closure device", !v.laaResult && "closure result", !v.laaRegimen && "regimen"]
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
      // the procedure goes straight on to its next steps (PCI: the after-PCI sheet; CABG, device implant and valve
      // intervention: their pathway); the alerts they answer are not toasted
      const next = kind === "laao" && (details as any).result === "Implanted / completed" ? "after-laao" : kind === "ablation" && ((details as any).targets ?? []).some((t: string) => /^AF/.test(t)) ? "after-af-ablation" : kind === "cabg" ? "after-cabg" : kind === "device" && ["New implant", "Upgrade"].includes((details as any).action) ? "after-device" : kind === "valve" ? (details as any).result === "Aborted / no implant" ? null : structuralTarget(details) ? "after-structural" : "valve-antithrombotic" : null;
      onDone(`${PROCEDURE_LABEL[kind]} recorded`, (kind === "pci" && onAfterPci) || (next && onAfter) ? undefined : r);
      if (kind === "pci") onAfterPci?.();
      else if (next) onAfter?.(next);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={group === "rhythm" ? "Record rhythm procedure / LAA closure" : group === "valve" ? "Record valve intervention" : group === "ph" ? "Record right heart catheterisation" : "Record PCI or CABG"}
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
          {group !== "valve" && group !== "ph" && <Segmented label="Procedure" options={(group === "rhythm" ? (["device", "ablation", "cardioversion", "laao"] as ProcedureKind[]) : (["pci", "cabg"] as ProcedureKind[])).map((k) => ({ value: k, label: PROCEDURE_LABEL[k] }))} value={kind} onChange={(x) => setKind(x as ProcedureKind)} />}
          <label className="field">
            <span>Date</span>
            <DateInput aria-label="Procedure date" className="input" max={health?.today} value={date} onChange={(e) => setDate(e.target.value)} />
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
            <div className="q">
              <div className="label">Devices used</div>
              <div className="ap-devs">
                {PCI_DEVICES.map((d) => {
                  const on = (v.devices ?? []).includes(d);
                  const key = d === "Drug-eluting stent" ? "stents" : d === "Drug-coated balloon" ? "dcb" : null;
                  return (
                    <div key={d} className={`ap-dev${on ? " on" : ""}`}>
                      <button type="button" role="checkbox" aria-checked={on} onClick={() => set("devices", on ? (v.devices ?? []).filter((x: string) => x !== d) : [...(v.devices ?? []), d])}>{d}</button>
                      {on && key && (
                        <span className="ap-count" aria-label={`Number of ${d === "Drug-eluting stent" ? "stents" : "balloons"}`}>
                          <button type="button" onClick={() => set(key, Math.max(1, Number(v[key] ?? 1) - 1))} aria-label="Fewer">−</button>
                          <b>{v[key] ?? 1}</b>
                          <button type="button" onClick={() => set(key, Math.min(12, Number(v[key] ?? 1) + 1))} aria-label="More">+</button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {Number(v.stents ?? 1) >= 3 && (v.devices ?? []).includes("Drug-eluting stent") && <div className="help">≥3 stents counts as complex PCI (ESC).</div>}
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
            <div className="q">
              <div className="label">Complications <span className="muted">(none if left empty)</span></div>
              <MultiChoice options={PCI_COMPLICATIONS.map((x) => ({ value: x, label: x }))} value={v.complications ?? []} onChange={(x) => set("complications", x)} />
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
              <Segmented label="Valve" options={opts(VALVE_POSITIONS)} value={v.position} onChange={(x) => { set("position", x); if ((x !== "Aortic" && v.vproc === "TAVI") || (!["Mitral", "Tricuspid"].includes(x) && v.vproc === "Transcatheter edge-to-edge repair (TEER)")) set("vproc", undefined); }} />
            </div>
            <div className="q">
              <div className="label">Procedure</div>
              <SingleChoice label="Procedure" options={opts(VALVE_PROCEDURES.filter((p) => (p !== "TAVI" || v.position === "Aortic" || !v.position) && (p !== "Transcatheter edge-to-edge repair (TEER)" || !v.position || ["Mitral","Tricuspid"].includes(v.position))))} value={v.vproc} onChange={(x) => set("vproc", x)} />
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
            {structuralTarget({procedure:v.vproc,position:v.position}) && <>
              <div className="q"><div className="label">Procedure result</div><SingleChoice label="Procedure result" options={opts(STRUCTURAL_RESULTS)} value={v.valveResult ?? "Completed"} onChange={x=>set("valveResult",x)}/></div>
              <label className="q"><span className="label">Device model</span><input className="input" value={v.deviceModel ?? ""} onChange={e=>set("deviceModel",e.target.value)} maxLength={80}/></label>
              <div className="row wrap"><label className="q grow"><span className="label">Device size (mm, if applicable)</span><input type="number" className="input" value={v.deviceSize ?? ""} onChange={e=>set("deviceSize",e.target.value)}/></label><label className="q grow"><span className="label">Number of implants / clips</span><input type="number" className="input" value={v.implantCount ?? ""} onChange={e=>set("implantCount",e.target.value)}/></label></div>
              <div className="q"><div className="label">Residual regurgitation / leak</div><SingleChoice label="Residual regurgitation / leak" options={opts(RESIDUAL_GRADES)} value={v.residualGrade} onChange={x=>set("residualGrade",x)}/></div>
              <label className="q"><span className="label">Postprocedure mean valve gradient (mmHg)</span><input type="number" className="input" value={v.meanGradient ?? ""} onChange={e=>set("meanGradient",e.target.value)}/></label>
              <div className="q"><div className="label">Procedure complications</div><MultiChoice options={opts(STRUCTURAL_COMPLICATIONS)} value={v.valveComplications ?? []} onChange={x=>set("valveComplications",x)}/></div>
            </>}
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
        ) : kind === "laao" ? (
          <>
            <div className="q"><div className="label">Closure method</div><SingleChoice label="Closure method" options={opts(LAA_METHODS)} value={v.laaMethod} onChange={x => { set("laaMethod", x); set("laaDevice", ""); }} /></div>
            <div className="q"><div className="label">Closure device</div><SingleChoice label="Closure device" options={opts(LAA_DEVICES.filter(d => v.laaMethod === "Surgical exclusion" ? d.startsWith("Surgical") : !d.startsWith("Surgical")))} value={v.laaDevice} onChange={x => set("laaDevice", x)} /></div>
            <div className="q"><div className="label">Closure result</div><SingleChoice label="Closure result" options={opts(LAA_RESULTS)} value={v.laaResult} onChange={x => set("laaResult", x)} /></div>
            <div className="q"><div className="label">Antithrombotic regimen documented by implant team</div><SingleChoice label="Antithrombotic regimen" options={opts(LAA_REGIMENS)} value={v.laaRegimen} onChange={x => set("laaRegimen", x)} /></div>
            <label className="field"><span>Regimen review date (optional)</span><DateInput aria-label="Regimen review date" className="input" value={v.laaReview ?? ""} onChange={e => set("laaReview", e.target.value)} /></label>
            <p className="help">Record the actual device and prescribed regimen. Confirm its current instructions for use. Aftercare records a review decision; it never stops an anticoagulant automatically.</p>
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
