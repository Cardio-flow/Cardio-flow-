import { createContext, useContext, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { AlertTriangle, Activity, Clock, Info, CheckCircle2, X, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { maskDate, parseDate as parseShown, shownDate as toShown, validDate } from "../shared/dates";

// ---------- routing ----------
export function navigate(to: string) {
  if (to === location.pathname + location.search) return;
  history.pushState({}, "", to);
  window.dispatchEvent(new Event("cf:navigate"));
  window.scrollTo(0, 0);
}
export function usePath() {
  const [path, setPath] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => setPath(location.pathname + location.search);
    window.addEventListener("popstate", on);
    window.addEventListener("cf:navigate", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("cf:navigate", on);
    };
  }, []);
  return path;
}
export function Link({ to, children, ...rest }: { to: string; children: ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// ---------- brand ----------
export function Logo({ dark = false, size = 32 }: { dark?: boolean; size?: number }) {
  const id = useId().replace(/:/g, "");
  const w = size * 5.4;
  return (
    <div className="logo" style={{ display: "flex", flexDirection: "column", width: w }} aria-label="CardioFlow" role="img">
      <svg width={w} height={size * 0.69} viewBox="0 0 172 22" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={dark ? "#3FA3FF" : "#1E88E5"} />
            <stop offset="1" stopColor={dark ? "#FF4D4D" : "#E53935"} />
          </linearGradient>
        </defs>
        <path d="M46 19 C 80 -1, 118 -1, 170 12 C 124 5, 86 5, 46 19 Z" fill={`url(#${id})`} />
      </svg>
      <div style={{ fontFamily: "var(--font-brand)", fontWeight: 700, fontSize: size, letterSpacing: -size * 0.038, lineHeight: 1, marginTop: -size * 0.12 }}>
        <span style={{ color: dark ? "#fff" : "#0B2D5B" }}>Cardio</span>
        <span style={{ color: dark ? "#FF4D4D" : "#E53935" }}>flow</span>
      </div>
    </div>
  );
}

export type Sev = "red" | "orange" | "yellow" | "blue" | "green" | "gray";
export function SevIcon({ sev, size = 22 }: { sev: Sev; size?: number }) {
  if (sev === "red") return <AlertTriangle size={size} strokeWidth={2.2} />;
  if (sev === "orange") return <Activity size={size} strokeWidth={2.2} />;
  if (sev === "yellow") return <Clock size={size} strokeWidth={2.2} />;
  if (sev === "green") return <CheckCircle2 size={size} strokeWidth={2.2} />;
  return <Info size={size} strokeWidth={2.2} />;
}
export function SevChip({ sev, children }: { sev: Sev; children: ReactNode }) {
  return (
    <span className={`chip sev sev-${sev}`}>
      <span className="dot" />
      {children}
    </span>
  );
}
export function Tag({ sev, children }: { sev: Sev; children: ReactNode }) {
  return <span className={`tag sev sev-${sev}`}>{children}</span>;
}
export const initials = (name: string) => {
  const parts = name.split(/\s+/).filter((p) => !/^(al-?|dr\.?)$/i.test(p)).map((p) => p.replace(/^Al-/i, ""));
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

// ---------- drawer ----------
export const DrawerWorkspace = createContext<ReactNode>(null);
export function Drawer({
  title, subtitle, icon, tone = "blue", wide, onClose, children, footer, head, active = true,
}: {
  title: string; subtitle?: string; icon: ReactNode; tone?: Sev; wide?: boolean; onClose(): void; children: ReactNode; footer?: ReactNode; head?: ReactNode; active?: boolean;
}) {
  const workspace = useContext(DrawerWorkspace);
  const ref = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const suspendedScroll = useRef<{ width: number; top: number } | null>(null);
  const lastScroll = useRef<{ width: number; top: number } | null>(null);
  // keep the latest onClose without re-running the mount effect (which would steal focus on every keystroke)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = (lastFocus.current && ref.current?.contains(lastFocus.current) ? lastFocus.current : null) ?? ref.current?.querySelector<HTMLElement>("[data-autofocus], input[autofocus], textarea[autofocus]") ?? ref.current?.querySelector<HTMLElement>("input,button:not([aria-label='Close']),select,textarea");
    first?.focus({ preventScroll: !!lastFocus.current });
    const restoreScroll = () => {
      const saved = suspendedScroll.current;
      const body = ref.current?.querySelector<HTMLElement>(".drawer-body");
      if (saved && body && saved.width === window.innerWidth) {
        body.scrollTop = saved.top;
        suspendedScroll.current = null;
      }
    };
    restoreScroll();
    window.addEventListener("resize", restoreScroll);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); }
      if (e.key !== "Tab") return;
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>("button, input, select, textarea, summary, a[href], [tabindex]") ?? []).filter((n) => n.tabIndex >= 0 && !n.hasAttribute("disabled") && n.getClientRects().length > 0);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) return;
      if (!ref.current?.contains(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      const body = ref.current?.querySelector<HTMLElement>(".drawer-body");
      if (body && !suspendedScroll.current) suspendedScroll.current = body.getClientRects().length ? { width: window.innerWidth, top: body.scrollTop } : lastScroll.current;
      window.removeEventListener("resize", restoreScroll);
      if (ref.current?.contains(document.activeElement)) lastFocus.current = document.activeElement as HTMLElement;
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [active]);
  return (
    <>
      <div className={`scrim ${workspace ? "workspace-scrim" : ""}`} style={!active ? { display: "none" } : undefined} onClick={() => closeRef.current()} />
      <div ref={ref} onScrollCapture={e => { const target = e.target as HTMLElement; if (active && target.classList.contains("drawer-body") && target.getClientRects().length) lastScroll.current = { width: window.innerWidth, top: target.scrollTop }; }} onFocusCapture={(e) => { lastFocus.current = e.target as HTMLElement; }} role="dialog" aria-modal={active || undefined} aria-label={title} style={!active ? { display: "none" } : undefined} className={`drawer ${wide ? "wide" : ""} ${workspace ? "with-workspace" : ""}`}>
        {workspace && <aside className="drawer-context">{workspace}</aside>}
        <div className="drawer-main">
        <div className="drawer-head">
          <div className={`drawer-title sev-${tone}`}>
            <div className="ic">{icon}</div>
            <div>
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
          {head}
        </div>
        {children}
        {footer && <div className="drawer-foot">{footer}</div>}
        </div>
      </div>
    </>
  );
}

// ---------- inputs ----------
export function Segmented({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string | undefined; onChange(v: string): void }) {
  return (
    <div role="radiogroup" aria-label={label} className="seg">
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function MultiChoice({
  options, value, onChange, auto = [], rec = [],
}: { options: { value: string; label: string }[]; value: string[]; onChange(v: string[]): void; auto?: string[]; rec?: string[] }) {
  return (
    <div className="choices">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button type="button" key={o.value} className="choice" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : o.value === "none" ? ["none"] : [...value.filter((v) => v !== "none"), o.value])}>
            {on && <CheckMark />}
            {o.label}
            {auto.includes(o.value) && <span className="auto">AUTO</span>}
            {rec.includes(o.value) && <span className="rec">GUIDELINE</span>}
          </button>
        );
      })}
    </div>
  );
}
export function SingleChoice({ options, value, onChange, label, rec = [] }: { options: { value: string; label: string; hint?: string }[]; value: string | undefined; onChange(v: string): void; label: string; rec?: string[] }) {
  // options with a hint render as full-width cards: title on the first line, examples beneath
  const cards = options.some((o) => o.hint);
  return (
    <div className={cards ? "choices cards" : "choices"} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" className="choice" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {cards ? (
            <span className="choice-text">
              <b>{o.label}</b>
              {o.hint && <span className="choice-hint">{o.hint}</span>}
            </span>
          ) : o.label}
          {rec.includes(o.value) && <span className="rec">GUIDELINE</span>}
        </button>
      ))}
    </div>
  );
}
const CheckMark = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function Sparkline({ values, tone = "gray", width = 96, height = 28 }: { values: number[]; tone?: Sev; width?: number; height?: number }) {
  if (values.length < 2) return <span style={{ width }} />;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [4 + (i * (width - 8)) / (values.length - 1), height - 4 - ((v - min) / span) * (height - 8)]);
  const color = { red: "#D92D20", orange: "#F97316", yellow: "#CA8A04", blue: "#1E88E5", green: "#17B26A", gray: "#667085" }[tone];
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  );
}

// ---------- toasts ----------
type Toast = { text: string; err?: boolean };
const ToastCtx = createContext<(t: Toast) => void>(() => {});
export function ToastHost({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const [height, setHeight] = useState(0);
  const rail = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!toast || !rail.current) { setHeight(0); return; }
    const measure = () => setHeight(rail.current?.getBoundingClientRect().height ?? 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail.current);
    return () => observer.disconnect();
  }, [toast]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.err ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={setToast}>
      <div className="app-feedback" style={{ "--feedback-space": `${height}px` } as CSSProperties}>
        {toast && <div ref={rail} className={`toast ${toast.err ? "err" : ""}`} role="status" aria-live="polite">
          {toast.err ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <span className="toast-text">{toast.text}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={18} /></button>
        </div>}
        {children}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// Holds the signed-in session and site for every screen
export const SessionCtx = createContext<{ name: string; role: string; siteMode: string }>({ name: "", role: "", siteMode: "sandbox" });
export const useSession = () => useContext(SessionCtx);

// Dates: typed (dd/mm/yyyy, slashes added as you type) or picked from the calendar button. The value stays
// ISO (yyyy-mm-dd) and onChange receives { target: { value } } like a native date input, so it drops in for one.
export function DateInput({
  value, onChange, min, max, className = "input", style, autoFocus, ...rest
}: {
  value: string; onChange(e: { target: { value: string } }): void; min?: string; max?: string; className?: string; style?: CSSProperties; autoFocus?: boolean; "aria-label"?: string;
}) {
  const [text, setText] = useState(toShown(value));
  const field = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLSpanElement>(null);
  const calendarButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pickerPosition, setPickerPosition] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => { const r=root.current?.getBoundingClientRect(); if (!r) return; const footer=root.current?.closest(".drawer")?.querySelector(".drawer-foot")?.getBoundingClientRect(); const bottom=footer?.top ?? innerHeight; setPickerPosition({left:Math.max(8,Math.min(r.left,innerWidth-302)),top:Math.max(8,Math.min(r.bottom+6+318 > bottom ? r.top-318 : r.bottom+6,innerHeight-326))}); };
    position(); window.addEventListener("resize",position); document.addEventListener("scroll",position,true);
    return () => { window.removeEventListener("resize",position); document.removeEventListener("scroll",position,true); };
  }, [open]);
  const [month, setMonth] = useState(() => (validDate(value) ? value : new Date().toISOString().slice(0, 10)).slice(0, 7));
  const [focused, setFocused] = useState("");
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caret.current != null && field.current === document.activeElement) field.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const allowed = (d: string) => validDate(d) && !(min && d < min) && !(max && d > max);
  const selectDate = (d: string) => { if (!allowed(d)) return; setText(toShown(d)); onChange({ target: { value: d } }); setOpen(false); calendarButton.current?.focus(); };
  const [year, mo] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, mo - 1, 1));
  const start = new Date(first); start.setUTCDate(1 - (first.getUTCDay() + 6) % 7);
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  const changeMonth = (by: number) => { const d = new Date(first); d.setUTCMonth(d.getUTCMonth() + by); setMonth(d.toISOString().slice(0, 7)); };
  const focusDay = (d: string) => { setFocused(d); setMonth(d.slice(0, 7)); requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>(`[data-day="${d}"]`)?.focus()); };
  useEffect(() => {
    // a half-typed or invalid date is reported as "" — keep the text so the clinician can finish it
    if (parseShown(text) !== value && !(value === "" && !parseShown(text))) setText(toShown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const iso = parseShown(text);
  const out = !!iso && ((min && iso < min) || (max && iso > max));
  const bad = (text.length >= 10 && !iso) || out;
  function typed(raw: string, cursor = raw.length) {
    const t = maskDate(raw);
    const count = raw.slice(0, cursor).replace(/\D/g, "").length;
    let seen = 0, pos = 0;
    while (pos < t.length && seen < count) { if (/\d/.test(t[pos])) seen++; pos++; }
    if (t[pos] === "/") pos++;
    caret.current = pos;
    setText(t);
    const p = parseShown(t);
    // anything not a complete, allowed date clears the value, so a stale earlier date is never saved
    onChange({ target: { value: p && !((min && p < min) || (max && p > max)) ? p : "" } });
  }
  return (
    <span ref={root} className={`date-in ${bad ? "bad" : ""}`} style={style} onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); calendarButton.current?.focus(); } }}>
      <input
        ref={field}
        className={`${className} date-text`}
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={text}
        autoFocus={autoFocus}
        aria-label={rest["aria-label"] ?? "Date (day/month/year)"}
        aria-invalid={bad || undefined}
        onChange={(e) => typed(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyDown={(e) => {
          const at = e.currentTarget.selectionStart ?? 0;
          if (e.key === "Backspace" && at === e.currentTarget.selectionEnd && text[at - 1] === "/") {
            e.preventDefault(); typed(text.slice(0, at - 2) + text.slice(at), at - 2);
          }
        }}
      />
      <button
        type="button"
        className="date-cal"
        aria-label="Choose from calendar"
        title={bad ? (out ? `Outside the allowed dates${min ? ` (from ${toShown(min)})` : ""}${max ? ` (until ${toShown(max)})` : ""}` : "Not a valid date") : "Choose from calendar"}
        ref={calendarButton}
        aria-expanded={open}
        onClick={() => {
          const initial = allowed(value) ? value : min ?? max ?? new Date().toISOString().slice(0, 10);
          setMonth(initial.slice(0, 7)); setFocused(initial); setOpen(!open);
        }}
      >
        <CalendarDays size={21} aria-hidden="true" />
      </button>
      {open && <span className="date-picker" style={pickerPosition} role="group" aria-label="Calendar">
        <span className="date-picker-head">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></button>
          <select aria-label="Calendar month" value={mo} onChange={(e) => setMonth(`${year}-${e.target.value.padStart(2, "0")}`)}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2026, i, 1).toLocaleString("en-GB", { month: "short" })}</option>)}</select>
          <select aria-label="Calendar year" value={year} onChange={(e) => setMonth(`${e.target.value}-${String(mo).padStart(2, "0")}`)}>{Array.from({ length: Math.max(1, Number((max ?? `${new Date().getFullYear() + 100}`).slice(0, 4)) - Number((min ?? "1900").slice(0, 4)) + 1) }, (_, i) => Number((min ?? "1900").slice(0, 4)) + i).map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={18} /></button>
        </span>
        <span className="date-picker-grid">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <small key={i} aria-hidden="true">{d}</small>)}
          {days.map((d) => <button type="button" key={d} data-day={d} className={d.slice(0, 7) !== month ? "other-month" : ""} aria-label={new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} aria-pressed={value === d} disabled={!allowed(d)} tabIndex={d === focused ? 0 : -1} onFocus={() => setFocused(d)} onClick={() => selectDate(d)} onKeyDown={(e) => {
            const by = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
            if (by) { e.preventDefault(); const next = new Date(`${d}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + by); const iso = next.toISOString().slice(0, 10); if (allowed(iso)) focusDay(iso); }
          }}>{Number(d.slice(8))}</button>)}
        </span>
      </span>}
    </span>
  );
}
