import { useState } from "react";
import { CalendarPlus, CalendarCheck, FlaskConical } from "lucide-react";
import { api, useData } from "../api";
import { Drawer, SingleChoice, Segmented, Tag } from "../ui";
import { PLAN_TEMPLATES } from "../../shared/catalog";
import { addDays, fmtDay } from "../../shared/clinical";
import { VIEW_LABEL, VIEW_SEV } from "../screens/Summary";
import type { Open } from "../screens/Patient";

const CATEGORIES = [
  ["monitoring", "Monitoring"], ["follow_up", "Follow-up"], ["investigation", "Investigation"], ["medication", "Medication"], ["referral", "Referral"], ["procedure", "Procedure"], ["education", "Education"], ["other", "Other"],
] as const;

export function AddPlan({ patientId, template, medicationId, contextId, onClose, onDone }: { patientId: string; template?: string; medicationId?: string; contextId?: string; onClose(): void; onDone(m?: string, r?: any): void }) {
  const { data: health } = useData<any>("/health");
  const today = health?.today;
  const [picked, setPicked] = useState<string[]>(template ? [template] : []);
  const [dates, setDates] = useState<Record<string, string>>(() => (template ? { [template]: String(PLAN_TEMPLATES.find((t) => t.id === template)!.offsets[0]) } : {}));
  const [custom, setCustom] = useState<{ title: string; category: string; date: string }>({ title: "", category: "follow_up", date: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!today) return null;
  const toggle = (id: string) => {
    if (picked.includes(id)) setPicked(picked.filter((p) => p !== id));
    else {
      setPicked([...picked, id]);
      setDates({ ...dates, [id]: String(PLAN_TEMPLATES.find((t) => t.id === id)!.offsets[0]) });
    }
  };
  const items = [
    ...picked.map((id) => {
      const t = PLAN_TEMPLATES.find((x) => x.id === id)!;
      const v = dates[id];
      const due = v?.includes("-") ? v : addDays(today, Number(v ?? t.offsets[0]));
      return { category: t.category, title: t.title, dueDate: due, completesOn: t.completesOn, medicationId: t.id === "renal-k" ? medicationId ?? null : null };
    }),
    ...(custom.title.trim() ? [{ category: custom.category, title: custom.title.trim(), dueDate: custom.date || null, completesOn: { type: "manual" } }] : []),
  ];
  async function save() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/plan`, { body: { items, contextId: contextId ?? null } });
      onDone(`${items.length} plan item${items.length === 1 ? "" : "s"} added`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title="Add to plan"
      subtitle="Every item gets a real date and is tracked until it happens"
      icon={<CalendarPlus size={22} />}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!items.length || busy} onClick={save}>{busy ? "Saving…" : `Add ${items.length || ""} to plan`}</button>
        </span>
      }
    >
      <div className="drawer-body">
        <div className="q">
          <div className="label">Common actions</div>
          <div className="choices">
            {PLAN_TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="choice" aria-pressed={picked.includes(t.id)} onClick={() => toggle(t.id)}>
                {t.title}
              </button>
            ))}
          </div>
        </div>
        {picked.map((id) => {
          const t = PLAN_TEMPLATES.find((x) => x.id === id)!;
          return (
            <div className="q" key={id}>
              <div className="label" style={{ fontSize: 15 }}>{t.title}</div>
              <div className="row wrap">
                <Segmented
                  label={`${t.title} date`}
                  options={t.offsets.map((d) => ({ value: String(d), label: `${d === 0 ? "Today" : d < 7 ? `${d} days` : d % 7 === 0 && d < 60 ? `${d / 7} week${d === 7 ? "" : "s"}` : `${Math.round(d / 30)} months`} · ${fmtDay(addDays(today, d))}` }))}
                  value={dates[id]}
                  onChange={(v) => setDates({ ...dates, [id]: v })}
                />
                <input type="date" className="input" style={{ height: 40 }} aria-label={`${t.title} exact date`} min={today} value={dates[id]?.includes("-") ? dates[id] : ""} onChange={(e) => setDates({ ...dates, [id]: e.target.value || String(t.offsets[0]) })} />
              </div>
            </div>
          );
        })}
        <div className="q">
          <div className="label">Something else</div>
          <div className="row wrap">
            <input className="input grow" placeholder="Action (e.g. Discuss at Heart Team)" value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} aria-label="Custom action" />
            <select className="input" value={custom.category} onChange={(e) => setCustom({ ...custom, category: e.target.value })} aria-label="Category">
              {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="date" className="input" min={today} value={custom.date} onChange={(e) => setCustom({ ...custom, date: e.target.value })} aria-label="Due date" />
          </div>
        </div>
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}

export function PlanItem({ patientId, planId, onClose, onDone, open }: { patientId: string; planId: string; onClose(): void; onDone(m?: string, r?: any): void; open(o: Open): void }) {
  const { data: rec } = useData<any>(`/patients/${patientId}/record`);
  const [action, setAction] = useState<string>("");
  const [outcome, setOutcome] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const p = rec?.plan.find((x: any) => x.id === planId);
  if (!rec) return null;
  if (!p) return null;
  const lab = p.completesOn?.type === "lab";
  async function save() {
    setBusy(true);
    try {
      const r = await api(`/patients/${patientId}/plan/${planId}`, { body: { action, outcome, dueDate: date || undefined, version: p.version } });
      onDone(action === "complete" ? `Completed · ${p.title}` : action === "cancel" ? "Plan item cancelled" : `Moved to ${fmtDay(date, { weekday: true })}`, r);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer
      title={p.title}
      subtitle={`${p.source ? `${p.source.label} · ${fmtDay(p.source.at)} · ` : ""}${p.dueDate ? "due " + fmtDay(p.dueDate, { weekday: true }) : "no date"}`}
      icon={<CalendarCheck size={22} />}
      tone={VIEW_SEV[p.view]}
      onClose={onClose}
      footer={
        <span className="end">
          <button className="btn ghost" style={{ color: "var(--ink-3)" }} onClick={onClose}>Close</button>
          {p.status === "planned" && (
            <button className="btn primary" disabled={!action || busy || ((action === "reschedule") && !date) || (action === "cancel" && outcome.trim().length < 3)} onClick={save}>
              {busy ? "Saving…" : "Confirm"}
            </button>
          )}
        </span>
      }
    >
      <div className="drawer-body">
        <div className="row">
          <Tag sev={VIEW_SEV[p.view]}>{VIEW_LABEL(p, rec.today)}</Tag>
          {p.reason && <span className="muted" style={{ fontWeight: 600 }}>{p.reason}</span>}
        </div>
        {lab && p.status === "planned" && (
          <div className="infobox" style={{ alignItems: "center" }}>
            <FlaskConical size={20} color="var(--action)" style={{ flexShrink: 0 }} />
            <span className="grow">
              <b>Closes itself when the result is recorded</b>
              Add the {(p.completesOn.codes ?? []).join(" and ")} result and this item completes automatically.
            </span>
            <button className="btn secondary small" onClick={() => open({ kind: "labs", codes: [...new Set(["creatinine", "potassium", ...(p.completesOn.codes ?? [])])] })}>Add result</button>
          </div>
        )}
        {p.status === "planned" ? (
          <>
            <div className="q">
              <div className="label">Update</div>
              <SingleChoice label="Update plan item" options={[{ value: "complete", label: "Mark done" }, { value: "reschedule", label: "Change date" }, { value: "cancel", label: "Cancel" }]} value={action} onChange={setAction} />
            </div>
            {action === "reschedule" && (
              <label className="field">
                <span>New date</span>
                <input type="date" className="input" style={{ width: 220 }} min={rec.today} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            )}
            {action && (
              <label className="field">
                <span>{action === "cancel" ? "Reason (required)" : "Outcome / note"}</span>
                <input className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder={action === "complete" ? "e.g. Referral sent to cardiac rehab" : ""} />
              </label>
            )}
          </>
        ) : (
          <div className="infobox">
            {p.outcome || "Closed"}
            {p.completedAt ? ` · ${fmtDay(p.completedAt, { year: true })}` : ""}
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>
    </Drawer>
  );
}
