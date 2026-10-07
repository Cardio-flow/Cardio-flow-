import { useEffect, useRef, useState } from "react";
import { BarChart3, ListChecks, LogOut, Search, ShieldCheck, Users, Bell } from "lucide-react";
import { api, setCsrf, setSampleMode, useSampleMode, withSample, type Session } from "./api";
import { Link, Logo, SessionCtx, ToastHost, initials, navigate, usePath } from "./ui";
import { SignIn } from "./SignIn";
import { Worklist } from "./screens/Worklist";
import { PatientPage } from "./screens/Patient";
import { Patients } from "./screens/Patients";
import { Registries } from "./screens/Registries";
import { Governance } from "./screens/Governance";
import { fmtDay } from "../shared/clinical";

type Site = { name: string; mode: string; patients?: { real: number; sample: number } };

export function App() {
  const [config, setConfig] = useState<{ hosted: boolean } | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [site, setSite] = useState<Site | null>(null);
  useEffect(() => {
    api("/config").then(setConfig);
    api<Session>("/session")
      .then((s) => (setCsrf(s.csrf), setSession(s)))
      .catch(() => setSession(null));
  }, []);
  const refreshSite = () => api("/site").then(setSite).catch(() => {});
  useEffect(() => {
    if (session) refreshSite();
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
        <Shell session={session} site={site} refreshSite={refreshSite} onLogout={async () => (await api("/logout", { body: {} }), setSession(null))} />
      </ToastHost>
    </SessionCtx.Provider>
  );
}

function Shell({ session, site, refreshSite, onLogout }: { session: Session; site: Site | null; refreshSite(): void; onLogout(): void }) {
  const path = usePath();
  const [today, setToday] = useState<string>("");
  const [attention, setAttention] = useState(0);
  const sample = useSampleMode();
  useEffect(() => {
    api("/health").then((h) => setToday(h.today));
  }, []);
  useEffect(() => {
    api(withSample("/attention-count", sample)).then((r) => setAttention(r.count)).catch(() => {});
  }, [path, sample]);
  useEffect(() => {
    refreshSite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  const samples = site?.patients?.sample ?? 0;
  const section = path.startsWith("/patients") ? "patients" : path.startsWith("/governance") ? "governance" : path.startsWith("/registries") ? "registries" : "worklist";
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
          <Link to="/registries" aria-current={section === "registries" ? "page" : undefined}>
            <BarChart3 size={18} />
            Registries
          </Link>
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
          {(samples > 0 || sample) && (
            <div className="sample-switch" role="group" aria-label="Which patients">
              <button aria-pressed={!sample} onClick={() => setSampleMode(false)}>Real patients</button>
              <button aria-pressed={sample} onClick={() => setSampleMode(true)}>Sample patients</button>
            </div>
          )}
          {today && <span className="today">{fmtDay(today, { weekday: true, year: true })}</span>}
          <button className="icon-btn" aria-label="Alerts" onClick={() => navigate("/")}>
            <Bell size={20} />
            {attention > 0 && <span style={{ position: "absolute", top: 10, right: 11, width: 8, height: 8, borderRadius: "50%", background: "var(--red)", border: "2px solid #fff" }} />}
          </button>
        </header>
        {sample && (
          <div className="sample-band" role="note">
            <b>Sample patients</b>
            <span>Synthetic records for practice and teaching. They never appear in real lists, counts or registries.</span>
            <button className="linkish" onClick={() => setSampleMode(false)}>Back to real patients</button>
          </div>
        )}
        {/* phones: the sidebar is hidden, so the main sections sit in a bar at the bottom */}
        <nav className="phone-nav" aria-label="Main (phone)">
          <Link to="/" aria-current={section === "worklist" ? "page" : undefined}>
            <ListChecks size={20} />
            <span>Worklist{attention > 0 ? ` · ${attention}` : ""}</span>
          </Link>
          <Link to="/patients" aria-current={section === "patients" ? "page" : undefined}>
            <Users size={20} />
            <span>Patients</span>
          </Link>
          <Link to="/registries" aria-current={section === "registries" ? "page" : undefined}>
            <BarChart3 size={20} />
            <span>Registries</span>
          </Link>
          <Link to="/governance" aria-current={section === "governance" ? "page" : undefined}>
            <ShieldCheck size={20} />
            <span>Rules</span>
          </Link>
          <button onClick={onLogout} aria-label="Sign out">
            <LogOut size={20} />
            <span>Sign out</span>
          </button>
        </nav>
        {patientMatch ? (
          <PatientPage key={patientMatch[1]} id={patientMatch[1]} tab={patientMatch[2] ?? "summary"} />
        ) : section === "patients" ? (
          <Patients />
        ) : section === "governance" ? (
          <Governance />
        ) : section === "registries" ? (
          <Registries />
        ) : (
          <Worklist />
        )}
      </div>
    </div>
  );
}

function PatientSearch() {
  const sample = useSampleMode();
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
    const t = setTimeout(() => api(withSample(`/patients?q=${encodeURIComponent(q.trim())}`, sample)).then((r) => (setRows(r), setSel(0))), 120);
    return () => clearTimeout(t);
  }, [q, sample]);
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
          placeholder={sample ? "Search sample patients" : "Search patient, MRN or file number"}
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
