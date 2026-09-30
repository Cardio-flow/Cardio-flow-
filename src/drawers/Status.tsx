import { useState } from "react";
import { HeartPulse } from "lucide-react";
import { api } from "../api";
import { Drawer, Segmented, SingleChoice } from "../ui";
import { CAUSE_GROUPS, FOLLOW_UP_STATUS } from "../../shared/encounters";

// Vital status (alive / died) is kept apart from follow-up status (active, lost, transferred…).
export function StatusDrawer({ patientId, today, current, onClose, onDone }: { patientId: string; today: string; current: any; onClose(): void; onDone(m?: string, r?: any): void }) {
  const [kind, setKind] = useState<"follow_up" | "vital">("follow_up");
  const [status, setStatus] = useState<string>("");
  const [date, setDate] = useState(today);
  const [place, setPlace] = useState("out_of_hospital");
  const [cause, setCause] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const died = kind === "vital" && status === "died";
  const valid = status && date && (!died || cause);
  async function save() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/status`, { body: { kind, status, effectiveOn: date, place: died ? place : null, causeGroup: died ? cause : null, detail } });
      onDone(died ? "Death recorded · reminders closed" : "Status saved", r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Patient status"
      subtitle="Vital status and follow-up status are recorded separately, each with its date"
      icon={<HeartPulse size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : died ? "Record death" : "Save status"}</button>
        </span>
      }
    >
      <div className="drawer-body">
        <div className="row wrap small" style={{ gap: 10, fontWeight: 700, color: "var(--ink-3)" }}>
          <span className="chip gray">Vital: {current?.vital ? (current.vital.status === "died" ? `Died ${current.vital.effective_on}` : "Alive") : "Alive (not recorded)"}</span>
          <span className="chip gray">Follow-up: {FOLLOW_UP_STATUS.find((f) => f.value === current?.followUp?.status)?.label ?? "Active (not recorded)"}</span>
        </div>
        <Segmented label="What to record" options={[{ value: "follow_up", label: "Follow-up status" }, { value: "vital", label: "Vital status" }]} value={kind} onChange={(v) => (setKind(v as any), setStatus(""))} />
        <div className="q">
          <div className="label" style={{ fontSize: 15 }}>{kind === "vital" ? "Vital status" : "Follow-up status"}</div>
          <SingleChoice
            label="Status"
            options={kind === "vital" ? [{ value: "alive", label: "Alive (confirmed)" }, { value: "died", label: "Died" }] : FOLLOW_UP_STATUS}
            value={status}
            onChange={setStatus}
          />
        </div>
        <label className="field">
          <span>{died ? "Date of death" : "Date"}</span>
          <input type="date" className="input" style={{ maxWidth: 220 }} max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {died && (
          <>
            <div className="q">
              <div className="label" style={{ fontSize: 15 }}>Place</div>
              <Segmented label="Place of death" options={[{ value: "out_of_hospital", label: "Out of hospital" }, { value: "in_hospital", label: "In hospital" }, { value: "unknown", label: "Unknown" }]} value={place} onChange={setPlace} />
            </div>
            <div className="q">
              <div className="label" style={{ fontSize: 15 }}>Cause of death</div>
              <SingleChoice label="Cause of death" options={CAUSE_GROUPS} value={cause} onChange={setCause} />
            </div>
            <div className="infobox warn">Recording a death cancels open plan items and removes the patient from every reminder list. A mistaken entry is corrected by recording "Alive (confirmed)".</div>
          </>
        )}
        <label className="field">
          <span>Detail (optional)</span>
          <input className="input" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={kind === "follow_up" ? "e.g. transferred to Adan Hospital" : ""} />
        </label>
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}
