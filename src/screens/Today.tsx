// Shared overview parts: a fold that remembers its state, and dismissing / restoring an alert. The problem-card
// board that lived here (14–20 Oct 2026) was replaced by the Consult overview on 25 Oct and removed on 10 Nov 2026.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { api } from "../api";
import { fmtDay } from "../../shared/clinical";

export function Fold({ k, hot, children }: { k: string; hot: boolean; children: ReactNode }) {
  const key = "cf.fold." + k;
  const [isOpen, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key);
      if (v != null) return v === "1";
    } catch {}
    // phones: module panels start folded (Today already lists what needs doing) so the page stays short
    const phone = typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches;
    return hot && !phone;
  });
  const ref = useRef<HTMLDivElement>(null);
  const toggle = () =>
    setOpen((v) => {
      try { localStorage.setItem(key, v ? "0" : "1"); } catch {}
      return !v;
    });
  useEffect(() => {
    const h = ref.current?.querySelector<HTMLElement>(".card-head h2");
    if (!h) return;
    h.tabIndex = 0;
    h.setAttribute("role", "button");
    h.setAttribute("aria-expanded", String(isOpen));
  });
  return (
    <div
      ref={ref}
      className={`fold${isOpen ? " open" : ""}`}
      onClick={(e) => { if ((e.target as HTMLElement).closest(".card-head h2")) toggle(); }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).matches(".card-head h2")) { e.preventDefault(); toggle(); } }}
    >
      {children}
    </div>
  );
}

// "Not needed": the clinician closes an alert or decision with a one-tap reason. It stays closed until the data
// behind it change (the engine then raises a new one) and can be shown again from "Dismissed".
const DISMISS_REASONS: { value: string; label: string; outcome: "declined" | "deferred" }[] = [
  { value: "not-relevant", label: "Not relevant for this patient", outcome: "declined" },
  { value: "done", label: "Already done or managed elsewhere", outcome: "declined" },
  { value: "patient", label: "Patient declined", outcome: "declined" },
  { value: "later", label: "Not now — review later", outcome: "deferred" },
];
export function DismissPanel({ a, patientId, done, onCancel }: { a: any; patientId: string; done(message?: string): void; onCancel(): void }) {
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const r = DISMISS_REASONS.find((x) => x.value === pick);
  async function save() {
    if (!r || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${patientId}/recommendations/${a.id}/decline`, { body: { outcome: r.outcome, reason: [r.label, note.trim()].filter(Boolean).join(": "), also: (a.also ?? []).map((x: any) => x.id) } });
      done(r.outcome === "deferred" ? "Set aside for later · shown under Dismissed" : "Dismissed · shown again if the data change");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="dismiss-panel">
      <b>Not needed?</b>
      <div className="choices" role="radiogroup" aria-label="Why it is not needed">
        {DISMISS_REASONS.map((x) => (
          <button key={x.value} type="button" className="choice small" role="radio" aria-checked={pick === x.value} aria-pressed={pick === x.value} onClick={() => setPick(x.value)}>{x.label}</button>
        ))}
      </div>
      <input className="input" placeholder="Note (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn secondary small" disabled={!r || busy} onClick={save}>{busy ? "Saving…" : "Dismiss"}</button>
        <button className="btn ghost small" onClick={onCancel}>Keep it</button>
        {error && <span className="small" style={{ color: "var(--red-ink)", fontWeight: 700 }}>{error}</span>}
      </div>
    </div>
  );
}

export function Dismissed({ s, done }: { s: any; done(message?: string): void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const list: any[] = s.dismissed ?? [];
  if (!list.length) return null;
  async function restore(id: string) {
    setBusy(id);
    try {
      await api(`/patients/${s.header.id}/recommendations/${id}/restore`, { body: {} });
      done("Shown again");
    } catch (e) {
      done((e as Error).message);
    }
    setBusy(null);
  }
  return (
    <details className="lane dismissed-list">
      <summary>
        <span className="lane-title">Dismissed</span>
        <span className="lane-hint">{list.length} in the last 90 days · tap to show one again</span>
        <ChevronDown size={18} className="chev" />
      </summary>
      <div className="lane-rows">
        {list.map((d) => (
          <div className="dismissed-row" key={d.id}>
            <span className={`tick sev-${d.severity}`} aria-hidden="true" />
            <div className="grow">
              <b>{d.title}</b>
              <span className="small muted">{d.outcome === "deferred" ? "Later" : "Not needed"} · {d.reason}{d.closed_at ? ` · ${fmtDay(d.closed_at)}` : ""}</span>
            </div>
            <button className="btn ghost small" disabled={busy === d.id} onClick={() => restore(d.id)}><RotateCcw size={14} /> Show again</button>
          </div>
        ))}
      </div>
    </details>
  );
}

// Problems at a glance: each active problem with where it stands against its guideline goal and the first open
