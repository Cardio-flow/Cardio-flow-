import { useEffect, useRef, useState } from "react";
import { BarChart3, ListChecks, LogOut, Search, ShieldCheck, Users, Bell } from "lucide-react";
import { api, setCsrf, type Session } from "./api";
import { Link, Logo, SessionCtx, ToastHost, initials, navigate, usePath } from "./ui";
import { SignIn } from "./SignIn";
import { Worklist } from "./screens/Worklist";
import { PatientPage } from "./screens/Patient";
import { Patients } from "./screens/Patients";
import { Governance } from "./screens/Governance";
import { fmtDay } from "../shared/clinical";

export function App() {
  const [config, setConfig] = useState<{ hosted: boolean } | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [site, setSite] = useState<{ name: string; mode: string } | null>(null);
  useEffect(() => {
    api("/config").then(setConfig);
    api<Session>("/session")
      .then((s) => (setCsrf(s.csrf), setSession(s)))
      .catch(() => setSession(null));
  }, []);
  useEffect(() => {
    if (session) api("/site").then(setSite);
  }, [session]);
  if (!config || session === undefined) return null;
  if (!session)
    return (
      <SignIn
        hosted={config.hosted}
        onSignedIn={(s) => {
          setCsrf(s.csrf);
          setSession(s);
        }}
      />
    );
  return (
    <SessionCtx.Provider value={{ name: session.name, role: session.role, siteMode: site?.mode ?? "sandbox" }}>
      <ToastHost>
        <Shell session={session} site={site} onLogout={async () => (await api("/logout", { body: {} }), setSession(null))} />
      </ToastHost>
    </SessionCtx.Provider>
  );
}

function Shell({ session, site, onLogout }: { session: Session; site: { name: string; mode: string } | null; onLogout(): void }) {
  const path = usePath();
  const [today, setToday] = useState<string>("");
  const [attention, setAttention] = useState(0);
  useEffect(() => {
    api("/health").then((h) => setToday(h.today));
  }, []);
  useEffect(() => {
    api("/attention-count").then((r) => setAttention(r.count)).catch(() => {});
  }, [path]);
  const section = path.startsWith("/patients") ? "patients" : path.startsWith("/governance") ? "governance" : "worklist";
  const patientMatch = path.match(/^\/patients\/([0-9a-f-]{36})(?:\/(\w+))?/);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" style={{ textDecoration: "none" }}>
          <Logo dark size={32} />
        </Link>
        <nav className="nav" aria-label="Main">
          <div className="nav-label">CLINICAL</div>
          <Link to="/" aria-current={section === "worklist" ? "page" : undefined}>
            <ListChecks size={18} />
            Worklist
            {attention > 0 && <span className="count">{attention}</span>}
          </Link>
          <Link to="/patients" aria-current={section === "patients" ? "page" : undefined}>
            <Users size={18} />
            Patients
          </Link>
          <a href="#" onClick={(e) => e.preventDefault()} title="Registries switch on after the HF slice is in daily use" style={{ opacity: 0.6 }}>
            <BarChart3 size={18} />
            Registries &amp; Analytics
          </a>
        </nav>
        <nav className="nav" aria-label="Administration">
          <div className="nav-label">ADMIN</div>
          <Link to="/governance" aria-current={section === "governance" ? "page" : undefined}>
            <ShieldCheck size={18} />
            Rule governance
          </Link>
        </nav>
        <div className="me">
          <div className="avatar">{initials(session.name)}</div>
          <div className="who">
            <b>{session.name}</b>
            <span>{session.role}</span>
          </div>
          <button aria-label="Sign out" title="Sign out" onClick={onLogout}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <PatientSearch />
          <span className="spacer" />
          {site?.mode === "sandbox" && <span className="pill-note">Sandbox · synthetic data</span>}
          {today && <span className="today">{fmtDay(today, { weekday: true, year: true })}</span>}
          <button className="icon-btn" aria-label="Alerts" onClick={() => navigate("/")}>
            <Bell size={20} />
            {attention > 0 && <span style={{ position: "absolute", top: 10, right: 11, width: 8, height: 8, borderRadius: "50%", background: "var(--red)", border: "2px solid #fff" }} />}
          </button>
        </header>
        {patientMatch ? (
          <PatientPage key={patientMatch[1]} id={patientMatch[1]} tab={patientMatch[2] ?? "summary"} />
        ) : section === "patients" ? (
          <Patients />
        ) : section === "governance" ? (
          <Governance />
        ) : (
          <Worklist />
        )}
      </div>
    </div>
  );
}

function PatientSearch() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!q.trim()) return setRows([]);
    const t = setTimeout(() => api(`/patients?q=${encodeURIComponent(q.trim())}`).then((r) => (setRows(r), setSel(0))), 120);
    return () => clearTimeout(t);
  }, [q]);
  const open = (id: string) => {
    setQ("");
    setRows([]);
    input.current?.blur();
    navigate(`/patients/${id}`);
  };
  return (
    <div className="search">
      <label>
        <Search size={18} />
        <span className="sr-only">Search patients</span>
        <input
          ref={input}
          placeholder="Search patient, MRN or file number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, rows.length - 1));
            if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
            if (e.key === "Enter" && rows[sel]) open(rows[sel].id);
            if (e.key === "Escape") setQ("");
          }}
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls="patient-results"
        />
        <kbd>/</kbd>
      </label>
      {rows.length > 0 && (
        <div className="results" id="patient-results" role="listbox">
          {rows.map((r, i) => (
            <button key={r.id} role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => open(r.id)}>
              <span className="person">
                <span className="avatar">{initials(r.name)}</span>
                <span>
                  <b>{r.name}</b>
                  <span>MRN {r.mrn}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
