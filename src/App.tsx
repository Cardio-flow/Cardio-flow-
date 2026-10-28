import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BarChart3, ListChecks, LockKeyhole, LogOut, Search, ShieldCheck, Users, Bell } from "lucide-react";
import { api, setAdminUnlock, setCsrf, setSampleMode, useSampleMode, withSample, type Session } from "./api";
import { Link, Logo, SessionCtx, ToastHost, initials, navigate, usePath } from "./ui";
import { SignIn } from "./SignIn";
import { Worklist } from "./screens/Worklist";
import { Patients } from "./screens/Patients";
const PatientPage = lazy(() => import("./screens/Patient").then(m => ({ default: m.PatientPage })));
const Registries = lazy(() => import("./screens/Registries").then(m => ({ default: m.Registries })));
const Governance = lazy(() => import("./screens/Governance").then(m => ({ default: m.Governance })));
const PatientAdmin = lazy(() => import("./screens/PatientAdmin").then(m => ({ default: m.PatientAdmin })));
import { fmtDay } from "../shared/clinical";

type Site = { name: string; mode: string; patients?: { real: number; sample: number } };

export function App() {
  const [config, setConfig] = useState<{ hosted: boolean } | null>(null);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [site, setSite] = useState<Site | null>(null);
  // the first two calls decide what to show: never a blank page while waiting or after a failure (20 Oct 2026)
  const [bootError, setBootError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setBootError(null);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 4000);
    api("/config").then(setConfig).catch((e) => setBootError((e as Error).message || "The server did not answer"));
    api<Session>("/session")
      .then((s) => (setCsrf(s.csrf), setSession(s)))
      .catch((e) => ((e as any)?.status === 401 || (e as any)?.status === 403 ? setSession(null) : setBootError((e as Error).message || "The server did not answer")));
    return () => clearTimeout(timer);
  }, [attempt]);
  const refreshSite = () => api("/site").then(setSite).catch(() => {});
  useEffect(() => {
    if (session) refreshSite();
  }, [session]);
  if (bootError || !config || session === undefined)
    return (
      <main className="boot-state" aria-busy={!bootError}>
        <Logo />
        {bootError ? (
          <>
            <h1>CardioFlow cannot reach its server</h1>
            <p>{bootError}</p>
            <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </>
        ) : (
          <p className="muted">{slow ? "Starting the server… this can take up to a minute after an update." : "Loading…"}</p>
        )}
      </main>
    );
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
        <Shell session={session} site={site} hosted={config.hosted} refreshSite={refreshSite} onLogout={async () => {
          await api("/logout", { body: {} });
          setCsrf("");
          setAdminUnlock("");
          setSampleMode(false);
          setSite(null);
          setSession(null);
          navigate("/");
        }} />
      </ToastHost>
    </SessionCtx.Provider>
  );
}

function Shell({ session, site, hosted, refreshSite, onLogout }: { session: Session; site: Site | null; hosted: boolean; refreshSite(): void; onLogout(): Promise<void> }) {
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const signOut = async () => {
    setLoggingOut(true);
    setLogoutError("");
    try { await onLogout(); } catch { setLogoutError("Sign-out failed. You are still signed in. Try again."); setLoggingOut(false); }
  };
  const path = usePath();
  const [today, setToday] = useState<string>("");
  const [attention, setAttention] = useState(0);
  const sample = useSampleMode();
  const switchPatients = (next: boolean) => {
    setSampleMode(next);
    navigate("/patients");
  };
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
  const section = path.startsWith("/administration") ? "administration" : path.startsWith("/patients") ? "patients" : path.startsWith("/governance") ? "governance" : path.startsWith("/registries") ? "registries" : "worklist";
  const patientMatch = path.match(/^\/patients\/([0-9a-f-]{36})(?:\/(\w+))?/);
  useEffect(() => {
    if (hosted && !patientMatch && sample) setSampleMode(false);
  }, [hosted, path, sample, patientMatch?.[1]]);
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

        </nav>
        <nav className="nav" aria-label="Other workspaces">
          <div className="nav-label">OTHER WORK</div>
          <Link to="/registries" aria-current={section === "registries" ? "page" : undefined}>
            <BarChart3 size={18} />
            Registries
          </Link>
          {session.role === "admin" && <Link to="/administration" aria-current={section === "administration" ? "page" : undefined}><LockKeyhole size={18} />Patient administration</Link>}
          {session.role !== "clinician" && <Link to="/governance" aria-current={section === "governance" ? "page" : undefined}>
            <ShieldCheck size={18} />
            Rule governance
          </Link>}
        </nav>
        <div className="me">
          <div className="avatar">{initials(session.name)}</div>
          <div className="who">
            <b>{session.name}</b>
            <span>{session.role}</span>
          </div>
          <button aria-label="Sign out" title="Sign out" disabled={loggingOut} onClick={signOut}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="main">
        {logoutError && <div className="error-box" role="alert">{logoutError}</div>}
        <header className="topbar">
          <PatientSearch />
          <span className="spacer" />
          {!hosted && (samples > 0 || sample) && (
            <div className="sample-switch" role="group" aria-label="Which patients">
              <button aria-pressed={!sample} onClick={() => switchPatients(false)}>Real patients</button>
              <button aria-pressed={sample} onClick={() => switchPatients(true)}>Sample patients</button>
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
            <button className="linkish" onClick={() => switchPatients(false)}>Back to real patients</button>
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
          <details className="phone-tools">
            <summary><ListChecks size={20} /><span>More</span></summary>
            <div className="phone-tools-menu" onClick={e=>{const details=e.currentTarget.closest("details");if(details)details.open=false;}} onKeyDown={e=>{if(e.key === "Escape"){e.preventDefault();const details=e.currentTarget.closest("details");if(details){details.open=false;details.querySelector("summary")?.focus();}}}}>
              <Link to="/registries"><BarChart3 size={18} />Registries</Link>
              {session.role !== "clinician" && <Link to="/governance"><ShieldCheck size={18} />Rule governance</Link>}
              {session.role === "admin" && <Link to="/administration"><LockKeyhole size={18} />Patient administration</Link>}
              <button onClick={signOut} disabled={loggingOut}><LogOut size={18} />Sign out</button>
            </div>
          </details>
        </nav>
        <Suspense fallback={<main className="page" role="status">Loading workspace…</main>}>
        {patientMatch ? (
          <PatientPage key={patientMatch[1]} id={patientMatch[1]} tab={patientMatch[2] ?? "summary"} />
        ) : section === "administration" ? (
          session.role === "admin" ? <PatientAdmin /> : <main className="page"><h1>Administrator access required</h1><p>Your account is signed in as {session.role}. Patient administration requires an administrator account and the site PIN.</p><Link className="btn secondary" to="/patients">Back to patients</Link></main>
        ) : section === "patients" ? (
          <Patients hosted={hosted} />
        ) : section === "governance" ? (
          <Governance />
        ) : section === "registries" ? (
          <Registries />
        ) : (
          <Worklist hosted={hosted} />
        )}
        </Suspense>
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
