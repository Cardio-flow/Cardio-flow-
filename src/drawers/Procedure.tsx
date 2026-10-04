import { useState } from "react";
import { HeartPulse } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, MultiChoice, Segmented, SingleChoice } from "../ui";
import { ACCESS, CABG_GRAFTS, COMPLEX_FEATURES, PCI_DEVICES, PCI_SETTINGS, PCI_VESSELS, procedureSummary, type ProcedureKind } from "../../shared/procedures";

// Record a PCI or CABG with its exact date and setting: antithrombotic durations count from here.
export function ProcedureDrawer({ patientId, contextId, onClose, onDone }: { patientId: string; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data: health } = useData<any>("/health");
  const [kind, setKind] = useState<ProcedureKind>("pci");
  const [date, setDate] = useState("");
  const [v, setV] = useState<Record<string, any>>({ device: "Drug-eluting stent", complex: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string, x: any) => setV((o) => ({ ...o, [k]: x }));
  const details = kind === "pci"
    ? { setting: v.setting, vessels: v.vessels ?? [], device: v.device, stents: v.device === "Drug-eluting stent" && v.stents ? Number(v.stents) : null, complex: v.complex ?? [], access: v.access ?? null }
    : { grafts: v.grafts ?? [], count: v.count ? Number(v.count) : null, setting: v.cabgSetting ?? "elective" };
  const missing = kind === "pci" ? [!v.setting && "setting", !(v.vessels ?? []).length && "vessels"].filter(Boolean) : [!(v.grafts ?? []).length && "grafts"].filter(Boolean);
  const preview = missing.length ? "" : procedureSummary(kind, details);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const at = new Date(`${date}T10:00:00+03:00`).toISOString();
      const r = await api(`/patients/${patientId}/procedures`, { body: { kind, date: at, details, contextId: contextId ?? null } });
      onDone(`${kind === "pci" ? "PCI" : "CABG"} recorded`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Record PCI or CABG"
      subtitle="The exact date and setting time DAPT and anticoagulant combinations"
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
          <Segmented label="Procedure" options={[{ value: "pci", label: "PCI" }, { value: "cabg", label: "CABG" }]} value={kind} onChange={(x) => setKind(x as ProcedureKind)} />
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
