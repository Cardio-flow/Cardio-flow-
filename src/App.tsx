import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Layers,
  FileDown,
  History,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Search,
  HeartPulse,
  ChevronDown,
  Menu,
  ShieldCheck,
  CheckCircle2,
  ClipboardList,
  Clock3,
  LogOut,
} from "lucide-react";
import { api, useData, setCsrf, date, currentDate } from "./api";
import type { Role, Session, Overview, Patient, Task } from "./types";
import { Mark, Badge, ErrorBox, Loading, SectionTitle } from "./ui";
import {
  Patients,
  NewPatient,
  PatientTable,
  PatientWorkspace,
} from "./Patients";
import { Followups, Exports, Definitions, AuditLog } from "./Workflows";
const navigation = [
  {
    key: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    roles: ["clinician", "reviewer", "analyst"],
  },
  {
    key: "patients",
    label: "Patients",
    icon: Users,
    roles: ["clinician", "reviewer"],
  },
  {
    key: "followups",
    label: "Follow-ups",
    icon: CalendarDays,
    roles: ["clinician", "reviewer"],
  },
  {
    key: "registries",
    label: "Registry library",
    icon: Layers,
    roles: ["clinician", "reviewer", "analyst", "designer"],
  },
  {
    key: "exports",
    label: "Research exports",
    icon: FileDown,
    roles: ["analyst"],
  },
  {
    key: "audit",
    label: "Audit history",
    icon: History,
    roles: ["clinician", "reviewer"],
  },
];
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [view, setView] = useState("overview"),
    [revision, setRevision] = useState(0),
    [newPatient, setNewPatient] = useState(false),
    [patientId, setPatientId] = useState(""),
    [mobile, setMobile] = useState(false);
  useEffect(() => {
    api<Session>("/session")
      .then((s) => {
        setSession(s);
        setCsrf(s.csrf);
        setView(s.role === "designer" ? "registries" : "overview");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  async function enter(role: Role = "clinician") {
    setLoading(true);
    setError("");
    try {
      const s = await api<Session>("/demo-session", { role });
      setCsrf(s.csrf);
      setSession(s);
      setPatientId("");
      setView(role === "designer" ? "registries" : "overview");
      setRevision((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  function go(key: string) {
    setView(session?.role === "designer" ? "registries" : key);
    setPatientId("");
    setMobile(false);
  }
  function openPatient(id: string) {
    setPatientId(id);
    setView("patients");
    setMobile(false);
  }
  async function logout() {
    try {
      await api("/logout", {});
      setSession(null);
      setCsrf("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading) return <Loading />;
  if (!session)
    return (
      <div className="welcome">
        <div className="welcome-art">
          <div className="welcome-brand">
            <Mark />
            cardio<span>flow</span>
          </div>
          <div>
            <span className="eyebrow">A MORE CONNECTED PICTURE</span>
            <h1>
              Every heartbeat.
              <br />
              One patient story.
            </h1>
            <p>
              The shared workspace for cardiovascular registries, clinical
              records, and continuity of care.
            </p>
            <div className="ecg">
              <HeartPulse size={120} strokeWidth={0.65} />
            </div>
          </div>
          <span className="welcome-footer">
            CARDIOVASCULAR REGISTRY PLATFORM
          </span>
        </div>
        <div className="welcome-content">
          <Badge tone="cad">Local development preview</Badge>
          <h2>Welcome to Cardio Flow</h2>
          <p>
            Explore the first CAD workflow with synthetic patients and a
            persistent local database.
          </p>
          <div className="welcome-features">
            <span>
              <CheckCircle2 size={18} />
              Shared patient identity & CAD records
            </span>
            <span>
              <CheckCircle2 size={18} />
              Versioned workflow & follow-up queue
            </span>
            <span>
              <CheckCircle2 size={18} />
              Role demonstrations & audit history
            </span>
          </div>
          <button className="primary" onClick={() => enter()}>
            Enter demo workspace
            <ArrowRight size={18} />
          </button>
          <ErrorBox message={error} />
          <div className="demo-disclosure">
            <ShieldCheck size={20} />
            <p>
              <strong>Synthetic data only.</strong> This is an engineering
              preview. Demo roles are not production authentication; clinical
              approval and deployment controls remain pending.
            </p>
          </div>
        </div>
      </div>
    );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobile ? "mobile-open" : "")}>
        <button className="brand" onClick={() => go("overview")}>
          <Mark />
          <span>
            cardio<span>flow</span>
            <small>CLINICAL WORKSPACE</small>
          </span>
        </button>
        <div className="site-switch">
          <span className="site-icon">K</span>
          <div>
            <strong>Kuwait workspace</strong>
            <small>Development environment</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {navigation
            .filter((n) => n.roles.includes(session.role))
            .map((n) => (
              <button
                key={n.key}
                className={view === n.key ? "active" : ""}
                onClick={() => go(n.key)}
              >
                <n.icon size={19} />
                {n.label}
                {n.key === "followups" ? (
                  <span className="nav-indicator" />
                ) : null}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="live-dot" />A connected cardiovascular core
            <p>One patient record across every stage of care.</p>
          </div>
          <div className="user-card">
            <div className="user-avatar">D{session.role[0].toUpperCase()}</div>
            <div>
              <strong>Demo {session.role}</strong>
              <small>Kuwait · Asia/Kuwait</small>
            </div>
            <button
              className="icon-button"
              onClick={logout}
              aria-label="Leave demo workspace"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu"
              onClick={() => setMobile((v) => !v)}
              aria-label="Toggle navigation"
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>
              {patientId
                ? "Patient record"
                : navigation.find((n) => n.key === view)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="sandbox">
              <span />
              Synthetic data
            </span>
            <label className="role-select">
              Demo role
              <select
                aria-label="Demo role"
                value={session.role}
                onChange={(e) => enter(e.target.value as Role)}
              >
                <option value="clinician">Clinician</option>
                <option value="reviewer">Reviewer</option>
                <option value="analyst">Analyst</option>
                <option value="designer">Designer</option>
              </select>
            </label>
          </div>
        </header>
        <main>
          <ErrorBox message={error} />
          {view === "overview" ? (
            <Dashboard
              role={session.role}
              revision={revision}
              onNavigate={go}
              onOpen={openPatient}
              onNew={() => setNewPatient(true)}
            />
          ) : view === "patients" ? (
            patientId ? (
              <PatientWorkspace
                id={patientId}
                role={session.role}
                onBack={() => setPatientId("")}
                onSaved={() => setRevision((v) => v + 1)}
              />
            ) : (
              <Patients
                onOpen={openPatient}
                revision={revision}
                onNew={
                  session.role === "clinician"
                    ? () => setNewPatient(true)
                    : undefined
                }
              />
            )
          ) : view === "followups" ? (
            <Followups
              role={session.role}
              revision={revision}
              onSaved={() => setRevision((v) => v + 1)}
            />
          ) : view === "registries" ? (
            <Definitions />
          ) : view === "exports" ? (
            <Exports />
          ) : (
            <AuditLog revision={revision} />
          )}
          <footer className="page-footer">
            <span>
              <HeartPulse size={14} />
              Cardio Flow
            </span>
            <span>Engineering preview · v0.1 · Synthetic data only</span>
          </footer>
        </main>
      </div>
      {newPatient ? (
        <NewPatient
          onClose={() => setNewPatient(false)}
          onCreated={(id) => {
            setNewPatient(false);
            setRevision((v) => v + 1);
            openPatient(id);
          }}
        />
      ) : null}
    </div>
  );
}
function Dashboard({
  role,
  revision,
  onNavigate,
  onOpen,
  onNew,
}: {
  role: Role;
  revision: number;
  onNavigate: (v: string) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { data: stats, error } = useData<Overview>("/overview", revision);
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">YOUR CLINICAL WORKSPACE</span>
          <h1>Care, connected.</h1>
          <p>A clear view of your registry and the work that comes next.</p>
        </div>
        <div className="page-title-actions">
          <span className="date-label">
            <CalendarDays size={16} />
            {date(currentDate())}
          </span>
          {role === "clinician" ? (
            <button className="primary" onClick={onNew}>
              <Plus size={17} />
              Register patient
            </button>
          ) : null}
        </div>
      </div>
      <ErrorBox message={error} />
      {!stats ? (
        !error ? (
          <Loading />
        ) : null
      ) : (
        <>
          <div className="metric-grid">
            {[
              {
                label: "Registered patients",
                value: stats.patients,
                sub: "Shared identities in this workspace",
                icon: Users,
                feature: true,
              },
              {
                label: "Open follow-ups",
                value: stats.open_tasks,
                sub: `${stats.overdue} overdue · ${stats.due} due or due soon`,
                icon: CalendarDays,
              },
              {
                label: "Draft episodes",
                value: stats.drafts,
                sub: "Ready for your next clinical update",
                icon: ClipboardList,
              },
              {
                label: "Awaiting review",
                value: stats.awaiting_review,
                sub: `${stats.reviewed} independently reviewed`,
                icon: ShieldCheck,
              },
            ].map((s) => (
              <div
                className={"metric " + (s.feature ? "featured" : "")}
                key={s.label}
              >
                <div>
                  <span>{s.label}</span>
                  <s.icon size={19} />
                </div>
                <strong>{s.value.toString().padStart(2, "0")}</strong>
                <small>{s.sub}</small>
              </div>
            ))}
          </div>
          <div className="dashboard-grid">
            <div>
              <div className="journey-banner">
                <div>
                  <Badge tone="light">CAD REGISTRY · FIRST RELEASE</Badge>
                  <h2>
                    One record.
                    <br />
                    The whole care journey.
                  </h2>
                  <p>
                    From index presentation to longitudinal outcomes,
                    <br className="desktop" /> keep the patient at the center.
                  </p>
                  <button onClick={() => onNavigate("registries")}>
                    Explore the registry
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="journey-visual">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="heart-node">
                    <HeartPulse size={46} strokeWidth={1.2} />
                  </div>
                  <span className="journey-tag tag-one">
                    <CheckCircle2 size={14} />
                    Shared identity
                  </span>
                  <span className="journey-tag tag-two">
                    <ActivityMini />
                    Clinical history
                  </span>
                  <span className="journey-tag tag-three">
                    <CalendarDays size={14} />
                    Follow-up
                  </span>
                </div>
              </div>
              <div className="panel presentation-panel">
                <SectionTitle
                  title="Presentation mix"
                  subtitle="All recorded episodes · current workspace"
                />
                <div className="presentation-bars">
                  {stats.presentations.map((p, i) => (
                    <div className="bar-row" key={p.label}>
                      <span>
                        <i
                          style={{
                            background: [
                              "#286253",
                              "#73a88b",
                              "#b0c8b8",
                              "#d8c99b",
                            ][i % 4],
                          }}
                        />
                        {p.label}
                      </span>
                      <div className="bar-track">
                        <div
                          style={{
                            width: stats.episodes
                              ? (p.count / stats.episodes) * 100 + "%"
                              : "0%",
                            background: [
                              "#286253",
                              "#73a88b",
                              "#b0c8b8",
                              "#d8c99b",
                            ][i % 4],
                          }}
                        />
                      </div>
                      <strong>{p.count}</strong>
                    </div>
                  ))}
                </div>
                <p className="chart-note">
                  Denominator: {stats.episodes} episodes, including drafts.
                  Descriptive counts only.
                </p>
              </div>
            </div>
            {role !== "analyst" ? (
              <Upcoming revision={revision} onNavigate={onNavigate} />
            ) : (
              <div className="panel padded">
                <FileDown size={25} />
                <h2>Research starts with traceable data.</h2>
                <p className="muted">
                  Generate a limited CAD dataset and its codebook. Your purpose
                  and dataset checksum are retained in the audit trail.
                </p>
                <button
                  className="primary"
                  onClick={() => onNavigate("exports")}
                >
                  Create an export
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
          {role !== "analyst" ? (
            <RecentPatients
              revision={revision}
              onOpen={onOpen}
              onNavigate={onNavigate}
            />
          ) : null}
        </>
      )}
    </>
  );
}
function ActivityMini() {
  return <HeartPulse size={14} />;
}
function Upcoming({
  revision,
  onNavigate,
}: {
  revision: number;
  onNavigate: (v: string) => void;
}) {
  const { data, error } = useData<Task[]>("/tasks", revision);
  const upcoming = data
    ?.filter((t) => !["satisfied", "cancelled"].includes(t.display_state))
    .slice(0, 4);
  return (
    <div className="panel upcoming">
      <SectionTitle
        title="Needs attention"
        subtitle="Follow-up milestones"
        action="View queue"
        onAction={() => onNavigate("followups")}
      />
      <ErrorBox message={error} />
      {upcoming?.length ? (
        upcoming.map((t) => (
          <button
            className="upcoming-item"
            key={t.id}
            onClick={() => onNavigate("followups")}
          >
            <div className="calendar-tile">
              <span>
                {new Date(t.due_date + "T12:00:00Z").toLocaleDateString(
                  "en-GB",
                  { month: "short" },
                )}
              </span>
              <strong>{t.due_date.slice(8, 10)}</strong>
            </div>
            <div>
              <strong>{t.name}</strong>
              <p>{t.milestone}-month CAD follow-up</p>
              <Badge>{t.display_state}</Badge>
            </div>
            <ArrowUpRight size={17} />
          </button>
        ))
      ) : (
        <p className="padded muted">No open follow-ups.</p>
      )}
      <div className="upcoming-bottom">
        <Clock3 size={17} />
        <p>
          Stay close to the next step.
          <br />
          <span>Contacts are linked to the full patient history.</span>
        </p>
      </div>
    </div>
  );
}
function RecentPatients({
  revision,
  onOpen,
  onNavigate,
}: {
  revision: number;
  onOpen: (id: string) => void;
  onNavigate: (v: string) => void;
}) {
  const { data, error } = useData<Patient[]>("/patients", revision);
  return (
    <div className="panel recent-patients">
      <SectionTitle
        title="Patient registry"
        subtitle="Shared identities across your clinical workspace"
        action="All patients"
        onAction={() => onNavigate("patients")}
      />
      <ErrorBox message={error} />
      {data ? (
        <PatientTable patients={data.slice(0, 5)} onOpen={onOpen} />
      ) : !error ? (
        <Loading />
      ) : null}
    </div>
  );
}
