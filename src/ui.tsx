import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Activity, Clock, Info, CheckCircle2, X } from "lucide-react";

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
export function Drawer({
  title, subtitle, icon, tone = "blue", wide, onClose, children, footer, head,
}: {
  title: string; subtitle?: string; icon: ReactNode; tone?: Sev; wide?: boolean; onClose(): void; children: ReactNode; footer?: ReactNode; head?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // keep the latest onClose without re-running the mount effect (which would steal focus on every keystroke)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input,button:not([aria-label='Close']),select,textarea");
    first?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, []);
  return (
    <>
      <div className="scrim" onClick={() => closeRef.current()} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`drawer ${wide ? "wide" : ""}`}>
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
  options, value, onChange, auto = [],
}: { options: { value: string; label: string }[]; value: string[]; onChange(v: string[]): void; auto?: string[] }) {
  return (
    <div className="choices">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button type="button" key={o.value} className="choice" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}>
            {on && <CheckMark />}
            {o.label}
            {auto.includes(o.value) && <span className="auto">AUTO</span>}
          </button>
        );
      })}
    </div>
  );
}
export function SingleChoice({ options, value, onChange, label }: { options: { value: string; label: string }[]; value: string | undefined; onChange(v: string): void; label: string }) {
  return (
    <div className="choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" className="choice" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
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
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.err ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={setToast}>
      {children}
      {toast && (
        <div className={`toast ${toast.err ? "err" : ""}`} role="status" aria-live="polite">
          {toast.err ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          {toast.text}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// Holds the signed-in session and site for every screen
export const SessionCtx = createContext<{ name: string; role: string; siteMode: string }>({ name: "", role: "", siteMode: "sandbox" });
export const useSession = () => useContext(SessionCtx);
