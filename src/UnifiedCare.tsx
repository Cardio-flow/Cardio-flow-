import { Children, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  Pill,
  Plus,
  Search,
  Stethoscope,
} from "lucide-react";
import { api, currentDate, date, useData } from "./api";
import {
  careKinds,
  finished,
  needsReview,
  stateLabel,
  type CareEncounter,
  type CareEntry,
  type CareKind,
} from "./care-model";
import { ageOn, documentationAlerts } from "./clinical-review";
import type { Patient, Role, Task } from "./types";
import { Badge, Empty, ErrorBox, Loading, Modal, SectionTitle } from "./ui";
import {
  CloseEncounter,
  EncounterCard,
  EncounterEditor,
  EntryCard,
  EntryEditor,
  EntryHistory,
  downloadReport,
  type CareData,
} from "./Care";
import { GuidedEditor } from "./GuidedEditor";
import { RegistryForms } from "./RegistryForms";
import { PatientWorkspace } from "./Patients";
import { FollowupContact } from "./Workflows";

type BoardEntry = CareEntry & {
  name: string;
  mrn: string;
  sex?: string;
  birth_date?: string;
};
type BoardEncounter = CareEncounter & {
  name: string;
  mrn: string;
  sex?: string;
  birth_date?: string;
};
type BoardData = { entries: BoardEntry[]; encounters: BoardEncounter[] };

const patientTabs = ["Summary", "Clinical Record", "Timeline", "Registries"];
const worklistFilters = [
  "All",
  "Inpatients",
  "OPD",
  "Due today",
  "Overdue",
  "Registry follow-up",
];

function isOpenTask(task: Task) {
  return !["satisfied", "cancelled"].includes(task.display_state);
}

function entryDueText(entry: CareEntry) {
  if (!entry.due_date) return "No review date recorded";
  if (finished.includes(entry.status))
    return `Reviewed ${date(entry.due_date)}`;
  return `${entry.due_date < currentDate() ? "Overdue" : "Due"} ${date(entry.due_date)}`;
}

export function Worklist({
  role,
  revision,
  onOpen,
  onNew,
  initialFilter = "All",
}: {
  role: Role;
  revision: number;
  onOpen: (id: string) => void;
  onNew: () => void;
  initialFilter?: string;
}) {
  const { data, error } = useData<BoardData>("/care/board", revision);
  const { data: tasks, error: taskError } = useData<Task[]>("/tasks", revision);
  const [filter, setFilter] = useState(
      worklistFilters.includes(initialFilter) ? initialFilter : "All",
    ),
    [search, setSearch] = useState("");
  const today = currentDate();
  type PatientWork = {
    id: string;
    name: string;
    mrn: string;
    sex?: string;
    birth_date?: string;
    entries: BoardEntry[];
    encounters: BoardEncounter[];
    tasks: Task[];
  };
  const grouped = new Map<string, PatientWork>();
  function getPatient(
    id: string,
    source: { name: string; mrn: string; sex?: string; birth_date?: string },
  ) {
    if (!grouped.has(id))
      grouped.set(id, {
        id,
        name: source.name,
        mrn: source.mrn,
        sex: source.sex,
        birth_date: source.birth_date,
        entries: [],
        encounters: [],
        tasks: [],
      });
    return grouped.get(id)!;
  }
  data?.entries.forEach((entry) =>
    getPatient(entry.patient_id, entry).entries.push(entry),
  );
  data?.encounters.forEach((encounter) =>
    getPatient(encounter.patient_id, encounter).encounters.push(encounter),
  );
  tasks
    ?.filter(isOpenTask)
    .forEach((task) => getPatient(task.patient_id, task).tasks.push(task));

  const work = [...grouped.values()]
    .filter((item) => {
      const open = item.encounters.filter(
        (encounter) => encounter.state === "open",
      );
      const dates = [
        ...item.entries.map((entry) => entry.due_date),
        ...item.tasks.map((task) => task.due_date),
      ].filter(Boolean) as string[];
      if (filter === "Inpatients")
        return open.some((encounter) => encounter.kind === "Admission");
      if (filter === "OPD")
        return open.some((encounter) => encounter.kind === "OPD");
      if (filter === "Due today") return dates.includes(today);
      if (filter === "Overdue") return dates.some((value) => value < today);
      if (filter === "Registry follow-up") return item.tasks.length > 0;
      return true;
    })
    .filter((item) =>
      [
        item.name,
        item.mrn,
        ...item.entries.map((entry) => `${entry.title} ${entry.owner}`),
        ...item.encounters.map(
          (encounter) => `${encounter.reason} ${encounter.owner}`,
        ),
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .sort((a, b) => priority(a, today) - priority(b, today));

  function priority(item: PatientWork, day: string) {
    const dates = [
      ...item.entries.map((entry) => entry.due_date),
      ...item.tasks.map((task) => task.due_date),
    ].filter(Boolean) as string[];
    if (dates.some((value) => value < day)) return 0;
    if (dates.some((value) => value === day)) return 1;
    if (
      item.encounters.some(
        (encounter) =>
          encounter.kind === "Admission" && encounter.state === "open",
      )
    )
      return 2;
    return 3;
  }

  return (
    <>
      <div className="page-title worklist-title">
        <div>
          <span className="eyebrow">CLINICAL PRIORITIES</span>
          <h1>My Worklist</h1>
          <p>Who needs attention now, why, and what should happen next.</p>
        </div>
        {role === "clinician" ? (
          <button className="primary" onClick={onNew}>
            <Plus size={17} /> Register patient
          </button>
        ) : null}
      </div>
      <ErrorBox message={error || taskError} />
      {!data ? (
        !error ? (
          <Loading />
        ) : null
      ) : (
        <>
          <div className="worklist-summary" aria-label="Worklist summary">
            <span>
              <HeartPulse size={16} />
              <strong>
                {
                  data.encounters.filter(
                    (encounter) =>
                      encounter.kind === "Admission" &&
                      encounter.state === "open",
                  ).length
                }
              </strong>{" "}
              inpatients
            </span>
            <span>
              <CalendarDays size={16} />
              <strong>
                {
                  data.encounters.filter(
                    (encounter) =>
                      encounter.kind === "OPD" && encounter.state === "open",
                  ).length
                }
              </strong>{" "}
              OPD
            </span>
            <span className="attention">
              <AlertTriangle size={16} />
              <strong>
                {
                  [
                    ...data.entries.map((entry) => entry.due_date),
                    ...(tasks ?? [])
                      .filter(isOpenTask)
                      .map((task) => task.due_date),
                  ].filter((value) => value && value < today).length
                }
              </strong>{" "}
              overdue
            </span>
          </div>
          <section className="panel care-section worklist-panel">
            <div className="worklist-toolbar">
              <div className="segmented" aria-label="Worklist filters">
                {worklistFilters.map((item) => (
                  <button
                    key={item}
                    className={filter === item ? "active" : ""}
                    onClick={() => setFilter(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <label className="global-search compact">
                <Search size={17} />
                <input
                  aria-label="Search worklist"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Patient, MRN, reason, or action…"
                />
              </label>
            </div>
            <p className="worklist-count">
              {work.length} patients in this view
            </p>
            {work.length ? (
              <div className="worklist-rows">
                {work.map((item) => (
                  <WorklistRow
                    key={item.id}
                    item={item}
                    today={today}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            ) : (
              <Empty title="No patients match this view">
                Change the filter or open Patients to find a longitudinal
                record.
              </Empty>
            )}
          </section>
        </>
      )}
    </>
  );
}

function WorklistRow({
  item,
  today,
  onOpen,
}: {
  item: {
    id: string;
    name: string;
    mrn: string;
    sex?: string;
    birth_date?: string;
    entries: BoardEntry[];
    encounters: BoardEncounter[];
    tasks: Task[];
  };
  today: string;
  onOpen: (id: string) => void;
}) {
  const open = item.encounters
    .filter((encounter) => encounter.state === "open")
    .sort((a, b) => b.started_on.localeCompare(a.started_on));
  const context =
    open.find((encounter) => encounter.kind === "Admission") ??
    open[0] ??
    item.encounters[0];
  const activeProblem = item.entries.find(
    (entry) => entry.kind === "problem" && entry.status !== "resolved",
  );
  const overdueEntry = item.entries.find(
    (entry) => entry.due_date && entry.due_date < today,
  );
  const overdueTask = item.tasks.find((task) => task.due_date < today);
  const outstanding =
    overdueEntry ?? item.entries.find(needsReview) ?? item.entries[0];
  const next = [
    ...item.entries
      .filter((entry) => entry.due_date)
      .map((entry) => ({ date: entry.due_date!, title: entry.title })),
    ...item.tasks.map((task) => ({
      date: task.due_date,
      title: `${task.milestone}-month CAD follow-up`,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))[0];
  const admissionDay =
    context?.kind === "Admission" && context.state === "open"
      ? Math.max(
          1,
          Math.floor(
            (Date.parse(today) - Date.parse(context.started_on)) / 86400000,
          ) + 1,
        )
      : null;
  return (
    <button className="patient-work-row" onClick={() => onOpen(item.id)}>
      <span className="work-patient">
        <strong>{item.name}</strong>
        <small>
          {item.mrn}
          {item.birth_date ? ` · ${ageOn(item.birth_date, today)}` : ""}
          {item.sex ? ` ${item.sex.slice(0, 1)}` : ""}
        </small>
      </span>
      <span className="work-context">
        <small>Current context</small>
        <strong>
          {context
            ? `${context.reason}${admissionDay ? ` · Day ${admissionDay}` : ""}`
            : (activeProblem?.title ?? "Continuing cardiology care")}
        </strong>
        <em>
          {context
            ? `${context.kind} · ${context.owner}`
            : (activeProblem?.family ?? "Longitudinal record")}
        </em>
      </span>
      <span className="work-attention">
        <small>Needs attention</small>
        <strong className={overdueEntry || overdueTask ? "danger-text" : ""}>
          {overdueEntry?.title ??
            (overdueTask
              ? `${overdueTask.milestone}-month registry follow-up overdue`
              : (outstanding?.title ?? "Review current plan"))}
        </strong>
        <em>
          {activeProblem
            ? `Major problem · ${activeProblem.title}`
            : "Problem list not documented"}
        </em>
      </span>
      <span className="work-next">
        <small>Next</small>
        <strong>{next?.title ?? "No event scheduled"}</strong>
        <em>{next ? date(next.date) : "Open record"}</em>
      </span>
      <ArrowRight size={18} />
    </button>
  );
}

type AddChoice = {
  label: string;
  description: string;
  kind: CareKind;
  custom?: boolean;
};

const addChoices: AddChoice[] = [
  {
    label: "Problem / diagnosis",
    description: "Add or update an active problem",
    kind: "problem",
  },
  {
    label: "Investigation / result",
    description: "Order, result or review an investigation",
    kind: "investigation",
  },
  {
    label: "Medication",
    description: "Record a prescription, hold or change",
    kind: "medication",
  },
  {
    label: "Procedure",
    description: "Plan or document a procedure",
    kind: "procedure",
  },
  {
    label: "Clinical decision",
    description: "Record a decision and next action",
    kind: "decision",
  },
  {
    label: "Complication",
    description: "Recognize, manage and reassess",
    kind: "complication",
  },
  {
    label: "Clinical note",
    description: "Add a dated free-text clinical note",
    kind: "decision",
    custom: true,
  },
  {
    label: "Follow-up",
    description: "Set purpose, owner and review date",
    kind: "decision",
  },
  {
    label: "Care plan item",
    description: "Add a continuing actionable plan",
    kind: "decision",
    custom: true,
  },
];

export function UnifiedPatientWorkspace({
  owner,
  id,
  role,
  onBack,
  onSaved,
}: {
  owner: string;
  id: string;
  role: Role;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState("Summary"),
    [revision, setRevision] = useState(0),
    [addMenu, setAddMenu] = useState(false),
    [customEditor, setCustomEditor] = useState(false),
    [editorLabel, setEditorLabel] = useState(""),
    [editor, setEditor] = useState<CareKind | CareEntry | null>(null),
    [newEncounter, setNewEncounter] = useState(false),
    [closing, setClosing] = useState<CareEncounter | null>(null),
    [history, setHistory] = useState<CareEntry | null>(null),
    [registry, setRegistry] = useState(false),
    [followup, setFollowup] = useState<Task | null>(null),
    [recordFilter, setRecordFilter] = useState("All"),
    [encounterFilter, setEncounterFilter] = useState("all"),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { data, error: loadError } = useData<CareData>(
    `/patients/${id}/care`,
    revision,
  );
  const { data: patient } = useData<Patient>(`/patients/${id}`, revision);
  const { data: allTasks } = useData<Task[]>("/tasks", revision);

  function saved() {
    setEditor(null);
    setCustomEditor(false);
    setEditorLabel("");
    setAddMenu(false);
    setNewEncounter(false);
    setClosing(null);
    setFollowup(null);
    setRevision((value) => value + 1);
    onSaved();
  }
  async function enroll() {
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${id}/enroll`, { registry: "CAD" });
      saved();
      setRegistry(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(entry: CareEntry) {
    setEditorLabel("");
    setCustomEditor(!entry.template_key);
    setEditor(entry);
  }
  if (!data)
    return (
      <>
        <ErrorBox message={loadError} />
        {!loadError ? <Loading /> : null}
      </>
    );

  const { patient: person, entries, encounters } = data;
  const tasks = (allTasks ?? []).filter(
    (task) => task.patient_id === id && isOpenTask(task),
  );
  const pending = entries.filter(needsReview);
  const activeProblems = entries.filter(
    (entry) => entry.kind === "problem" && entry.status !== "resolved",
  );
  const activeMedications = entries.filter(
    (entry) =>
      entry.kind === "medication" &&
      !["discontinued", "cancelled"].includes(entry.status),
  );
  const results = entries.filter((entry) => entry.kind === "investigation");
  const currentEncounter = encounters.find(
    (encounter) => encounter.state === "open",
  );
  const currentContext = currentEncounter ?? encounters[0];
  const alerts = documentationAlerts(entries, currentDate());
  const nextEvent = [
    ...pending
      .filter((entry) => entry.due_date)
      .map((entry) => ({ date: entry.due_date!, label: entry.title })),
    ...tasks.map((task) => ({
      date: task.due_date,
      label: `${task.milestone}-month CAD follow-up`,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))[0];

  const recordFilters = [
    "All",
    "Problems",
    "Investigations",
    "Medications",
    "Procedures",
    "Decisions",
    "Notes",
  ];
  const recordKind: Record<string, CareKind | undefined> = {
    Problems: "problem",
    Investigations: "investigation",
    Medications: "medication",
    Procedures: "procedure",
    Decisions: "decision",
  };
  const filteredEntries = entries.filter((entry) => {
    if (
      encounterFilter !== "all" &&
      (encounterFilter === "longitudinal"
        ? entry.encounter_id !== null
        : entry.encounter_id !== encounterFilter)
    )
      return false;
    if (recordFilter === "All") return true;
    if (recordFilter === "Notes")
      return (
        entry.kind === "decision" && entry.title.toLowerCase().includes("note")
      );
    if (recordFilter === "Decisions")
      return (
        entry.kind === "decision" && !entry.title.toLowerCase().includes("note")
      );
    return entry.kind === recordKind[recordFilter];
  });

  return (
    <>
      <button className="text-button back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to patients
      </button>
      <header className="patient-command-header">
        <div className="patient-identity">
          <div className="avatar large">
            {person.name
              .split(" ")
              .slice(0, 2)
              .map((part) => part[0])
              .join("")}
          </div>
          <div>
            <h1>{person.name}</h1>
            <p>
              MRN {person.mrn} · {ageOn(person.birth_date, currentDate())}{" "}
              {person.sex.slice(0, 1)}
            </p>
            <strong className="current-context">
              {currentContext
                ? `${currentContext.reason} · ${currentContext.kind}${currentContext.state === "open" ? " · current" : ""}`
                : (activeProblems[0]?.title ??
                  "Longitudinal cardiology record")}
            </strong>
          </div>
        </div>
        {role === "clinician" ? (
          <div className="patient-primary-actions">
            <button className="secondary" onClick={() => setNewEncounter(true)}>
              <CalendarDays size={16} /> Encounter
            </button>
            <button className="primary" onClick={() => setAddMenu(true)}>
              <Plus size={17} /> Add / Update
            </button>
          </div>
        ) : null}
      </header>
      <div className="patient-status-line">
        <span>{activeProblems.length} active problems</span>
        <span>{pending.length + tasks.length} outstanding actions</span>
        {currentEncounter && role === "clinician" ? (
          <button
            className="text-button"
            onClick={() => setClosing(currentEncounter)}
          >
            {currentEncounter.kind === "Admission"
              ? "Discharge / handover"
              : "Close visit / handover"}
          </button>
        ) : null}
      </div>
      <div
        className="care-tabs patient-tabs"
        role="tablist"
        aria-label="Patient workspace"
      >
        {patientTabs.map((item) => (
          <button
            role="tab"
            key={item}
            aria-selected={tab === item}
            onClick={() => {
              setTab(item);
              setRegistry(false);
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <ErrorBox message={error || loadError} />
      {notice ? (
        <div className="success" role="status">
          <CheckCircle2 size={18} /> {notice}
        </div>
      ) : null}
      <div role="tabpanel" aria-label={tab}>
        {tab === "Summary" ? (
          <PatientSummary
            activeProblems={activeProblems}
            results={results}
            medications={activeMedications}
            pending={pending}
            tasks={tasks}
            alerts={alerts}
            nextEvent={nextEvent}
            role={role}
            onEdit={edit}
            onTask={setFollowup}
            onRecord={() => setTab("Clinical Record")}
          />
        ) : tab === "Clinical Record" ? (
          <section className="panel care-section clinical-record">
            <div className="record-toolbar">
              <div className="segmented" aria-label="Clinical record filters">
                {recordFilters.map((item) => (
                  <button
                    key={item}
                    className={recordFilter === item ? "active" : ""}
                    onClick={() => setRecordFilter(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <label>
                Encounter
                <select
                  value={encounterFilter}
                  onChange={(event) => setEncounterFilter(event.target.value)}
                >
                  <option value="all">All encounters</option>
                  <option value="longitudinal">Continuing record only</option>
                  {encounters.map((encounter) => (
                    <option key={encounter.id} value={encounter.id}>
                      {encounter.kind} · {date(encounter.started_on)} ·{" "}
                      {encounter.reason}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {filteredEntries.length ? (
              <div className="record-list">
                {filteredEntries.map((entry) => (
                  <EntryCard
                    key={entry.id}
                    entry={entry}
                    encounter={encounters.find(
                      (encounter) => encounter.id === entry.encounter_id,
                    )}
                    onEdit={
                      role === "clinician" ? () => edit(entry) : undefined
                    }
                    onHistory={() => setHistory(entry)}
                  />
                ))}
              </div>
            ) : (
              <Empty title="No records in this view">
                Use Add / Update to document clinical information once.
              </Empty>
            )}
          </section>
        ) : tab === "Timeline" ? (
          <PatientTimeline
            entries={entries}
            encounters={encounters}
            role={role}
            onEdit={edit}
            onHistory={setHistory}
            onCloseEncounter={setClosing}
          />
        ) : (
          <>
            <section className="panel care-section registry-intro">
              <div>
                <span className="eyebrow">STRUCTURED OUTPUT OF CARE</span>
                <h2>Registries</h2>
                <p className="muted">
                  Clinical information already in the record is reused where a
                  supported mapping exists. Review provenance before saving.
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => downloadReport(data)}
              >
                <Download size={16} /> Patient report
              </button>
            </section>
            <section className="panel care-section legacy-registry-summary">
              <SectionTitle
                title="CAD registry"
                subtitle="The existing versioned CAD episode remains available inside this patient workspace."
              />
              {patient?.enrollment_id ? (
                <div className="registry-status-row">
                  <Badge tone="cad">Enrolled</Badge>
                  <span>
                    Presentation, angiography, PCI, discharge and follow-up
                  </span>
                  <button
                    className="secondary"
                    onClick={() => setRegistry((value) => !value)}
                  >
                    {registry ? "Close CAD episode" : "Open CAD episode"}
                  </button>
                </div>
              ) : role === "clinician" ? (
                <button className="primary" disabled={busy} onClick={enroll}>
                  Start CAD episode workflow
                </button>
              ) : (
                <p className="muted">No CAD registry enrollment.</p>
              )}
            </section>
            <RegistryForms
              patient={person}
              encounters={encounters}
              entries={entries}
              role={role}
            />
            {registry && patient?.enrollment_id ? (
              <div className="embedded-registry-shell">
                <PatientWorkspace
                  id={id}
                  role={role}
                  onBack={() => setRegistry(false)}
                  onSaved={saved}
                  embedded
                />
              </div>
            ) : null}
          </>
        )}
      </div>

      {addMenu ? (
        <Modal
          title="Add or update the patient record"
          onClose={() => setAddMenu(false)}
        >
          <p className="modal-intro">
            Choose what changed. It will appear in the summary, clinical record
            and timeline.
          </p>
          <div className="add-update-grid">
            {addChoices.map((choice) => (
              <button
                key={choice.label}
                onClick={() => {
                  if (tab === "Clinical Record") {
                    setRecordFilter(
                      choice.label === "Clinical note"
                        ? "Notes"
                        : choice.kind === "problem"
                          ? "Problems"
                          : choice.kind === "investigation"
                            ? "Investigations"
                            : choice.kind === "medication"
                              ? "Medications"
                              : choice.kind === "procedure"
                                ? "Procedures"
                                : "Decisions",
                    );
                  }
                  setCustomEditor(!!choice.custom);
                  setEditorLabel(choice.custom ? choice.label : "");
                  setEditor(choice.kind);
                  setAddMenu(false);
                }}
              >
                <span>
                  {choice.kind === "medication" ? <Pill size={18} /> : null}
                  {choice.kind === "investigation" ? (
                    <FlaskConical size={18} />
                  ) : null}
                  {choice.kind === "procedure" ? (
                    <Stethoscope size={18} />
                  ) : null}
                  {choice.kind === "problem" ? <HeartPulse size={18} /> : null}
                  {choice.kind === "decision" ? (
                    <ClipboardList size={18} />
                  ) : null}
                  {choice.kind === "complication" ? (
                    <AlertTriangle size={18} />
                  ) : null}
                </span>
                <strong>{choice.label}</strong>
                <small>{choice.description}</small>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
      {editor &&
      !customEditor &&
      (typeof editor === "string" || editor.template_key) ? (
        <GuidedEditor
          key={typeof editor === "string" ? editor : editor.id}
          patient={person}
          encounters={encounters}
          entries={entries}
          owner={owner}
          original={typeof editor === "string" ? undefined : editor}
          kind={typeof editor === "string" ? editor : editor.kind}
          onClose={() => setEditor(null)}
          onSaved={saved}
          onCustom={() => {
            setEditorLabel("");
            setCustomEditor(true);
          }}
        />
      ) : editor ? (
        <EntryEditor
          key={typeof editor === "string" ? editor : editor.id}
          patient={person}
          encounters={encounters}
          original={typeof editor === "string" ? undefined : editor}
          kind={typeof editor === "string" ? editor : editor.kind}
          defaultTitle={editorLabel}
          dialogLabel={editorLabel ? editorLabel.toLowerCase() : undefined}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      ) : null}
      {newEncounter ? (
        <EncounterEditor
          patient={person}
          encounters={encounters}
          onClose={() => setNewEncounter(false)}
          onSaved={saved}
        />
      ) : null}
      {closing ? (
        <CloseEncounter
          patientId={id}
          encounter={closing}
          pending={pending}
          onClose={() => setClosing(null)}
          onSaved={saved}
        />
      ) : null}
      {history ? (
        <EntryHistory entry={history} onClose={() => setHistory(null)} />
      ) : null}
      {followup ? (
        <FollowupContact
          task={followup}
          onClose={() => setFollowup(null)}
          onDone={(message) => {
            setNotice(message);
            saved();
          }}
        />
      ) : null}
    </>
  );
}

function PatientSummary({
  activeProblems,
  results,
  medications,
  pending,
  tasks,
  alerts,
  nextEvent,
  role,
  onEdit,
  onTask,
  onRecord,
}: {
  activeProblems: CareEntry[];
  results: CareEntry[];
  medications: CareEntry[];
  pending: CareEntry[];
  tasks: Task[];
  alerts: ReturnType<typeof documentationAlerts>;
  nextEvent?: { date: string; label: string };
  role: Role;
  onEdit: (entry: CareEntry) => void;
  onTask: (task: Task) => void;
  onRecord: () => void;
}) {
  const openEntry = (entry: CareEntry) =>
    role === "clinician" ? onEdit(entry) : onRecord();
  const overdue = pending.filter(
    (entry) => entry.due_date && entry.due_date < currentDate(),
  );
  const attention = [
    ...overdue.map((entry) => ({
      id: entry.id,
      title: entry.title,
      detail: entryDueText(entry),
      entry,
    })),
    ...alerts
      .filter((alert) => !overdue.some((entry) => entry.id === alert.entry.id))
      .map((alert) => ({
        id: alert.id,
        title: alert.title,
        detail: alert.detail,
        entry: alert.entry,
      })),
    ...tasks
      .filter((task) => task.due_date <= currentDate())
      .map((task) => ({
        id: task.id,
        title: `${task.milestone}-month CAD follow-up`,
        detail:
          task.due_date < currentDate()
            ? "Registry follow-up overdue"
            : "Registry follow-up due today",
        task,
      })),
  ];
  return (
    <>
      <section className="needs-attention" aria-label="Needs attention">
        <div className="attention-heading">
          <AlertTriangle size={19} />
          <div>
            <h2>Needs Attention</h2>
            <p>Only open items requiring a clinical or documentation action.</p>
          </div>
        </div>
        {attention.length ? (
          <div className="attention-list">
            {attention.slice(0, 5).map((item) => (
              <button
                key={item.id}
                onClick={() =>
                  "entry" in item && item.entry
                    ? openEntry(item.entry)
                    : "task" in item && item.task
                      ? role === "clinician"
                        ? onTask(item.task)
                        : onRecord()
                      : undefined
                }
              >
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <div className="attention-clear">
            <CheckCircle2 size={18} /> No urgent review items recorded
          </div>
        )}
      </section>
      <div className="summary-grid">
        <SummarySection
          icon={<HeartPulse size={18} />}
          title="Active Problems"
          empty="No active problems documented."
        >
          {activeProblems.slice(0, 5).map((entry) => (
            <button key={entry.id} onClick={() => openEntry(entry)}>
              <span>
                <strong>{entry.title}</strong>
                <small>
                  {entry.family} · {stateLabel(entry.status)}
                </small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
        </SummarySection>
        <SummarySection
          icon={<FlaskConical size={18} />}
          title="Important Recent Results"
          empty="No recent results documented."
          action="View all"
          onAction={onRecord}
        >
          {results.slice(0, 5).map((entry) => (
            <button key={entry.id} onClick={() => openEntry(entry)}>
              <span>
                <strong>{entry.title}</strong>
                <small>
                  {entry.details.value
                    ? `${entry.details.value}${entry.details.unit ? ` ${entry.details.unit}` : ""}`
                    : stateLabel(entry.status)}{" "}
                  · {date(entry.occurred_on)}
                </small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
        </SummarySection>
        <SummarySection
          icon={<Pill size={18} />}
          title="Current Medications"
          empty="No current medications documented."
          action="View all"
          onAction={onRecord}
        >
          {medications.slice(0, 6).map((entry) => (
            <button key={entry.id} onClick={() => openEntry(entry)}>
              <span>
                <strong>{entry.title}</strong>
                <small>{entry.details.dose || stateLabel(entry.status)}</small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
        </SummarySection>
        <SummarySection
          icon={<ClipboardList size={18} />}
          title="Current Plan"
          empty="No outstanding plan items recorded."
        >
          {pending.slice(0, 5).map((entry, index) => (
            <button key={entry.id} onClick={() => openEntry(entry)}>
              <span className="plan-number">{index + 1}</span>
              <span>
                <strong>{entry.title}</strong>
                <small>
                  {entryDueText(entry)} · {entry.owner}
                </small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
          {tasks.slice(0, 2).map((task) => (
            <button
              key={task.id}
              onClick={() => (role === "clinician" ? onTask(task) : onRecord())}
            >
              <span className="plan-number">F</span>
              <span>
                <strong>{task.milestone}-month CAD follow-up</strong>
                <small>Due {date(task.due_date)} · registry milestone</small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
        </SummarySection>
      </div>
      <section className="next-event-card">
        <CalendarDays size={20} />
        <div>
          <span>Next event</span>
          <strong>{nextEvent?.label ?? "No next event scheduled"}</strong>
          <small>
            {nextEvent
              ? date(nextEvent.date)
              : "Add a follow-up or care plan item"}
          </small>
        </div>
      </section>
      {role !== "clinician" ? (
        <p className="footnote">
          Review mode preserves authorship, provenance and version history.
        </p>
      ) : null}
    </>
  );
}

function SummarySection({
  icon,
  title,
  empty,
  action,
  onAction,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  const count = Children.count(children);
  return (
    <section className="panel summary-section">
      <div className="summary-section-title">
        <span>{icon}</span>
        <h2>{title}</h2>
        {action && onAction ? (
          <button className="text-button" onClick={onAction}>
            {action}
          </button>
        ) : null}
      </div>
      <div className="summary-list">
        {count ? children : <p className="muted">{empty}</p>}
      </div>
    </section>
  );
}

function PatientTimeline({
  entries,
  encounters,
  role,
  onEdit,
  onHistory,
  onCloseEncounter,
}: {
  entries: CareEntry[];
  encounters: CareEncounter[];
  role: Role;
  onEdit: (entry: CareEntry) => void;
  onHistory: (entry: CareEntry) => void;
  onCloseEncounter: (encounter: CareEncounter) => void;
}) {
  const events = [
    ...encounters.map((encounter) => ({
      id: `encounter-${encounter.id}`,
      date: encounter.started_on,
      type: "encounter" as const,
      encounter,
    })),
    ...entries.map((entry) => ({
      id: `entry-${entry.id}`,
      date: entry.occurred_on,
      type: "entry" as const,
      entry,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="panel care-section patient-timeline">
      <SectionTitle
        title="Longitudinal clinical journey"
        subtitle="Generated automatically from encounters and documented clinical events."
      />
      {events.length ? (
        <div className="timeline-list">
          {events.map((event) => (
            <details key={event.id} className="timeline-item">
              <summary>
                <span className="timeline-dot" />
                <time>{date(event.date)}</time>
                <span>
                  <strong>
                    {event.type === "encounter"
                      ? event.encounter.reason
                      : event.entry.title}
                  </strong>
                  <small>
                    {event.type === "encounter"
                      ? `${event.encounter.kind} · ${event.encounter.owner}`
                      : `${careKinds[event.entry.kind].label} · ${event.entry.owner}`}
                  </small>
                </span>
                <Badge>
                  {event.type === "encounter"
                    ? event.encounter.state
                    : stateLabel(event.entry.status)}
                </Badge>
              </summary>
              <div className="timeline-details">
                {event.type === "encounter" ? (
                  <EncounterCard
                    encounter={event.encounter}
                    linked={encounters.find(
                      (encounter) =>
                        encounter.id === event.encounter.linked_encounter_id,
                    )}
                    onClose={
                      role === "clinician" && event.encounter.state === "open"
                        ? () => onCloseEncounter(event.encounter)
                        : undefined
                    }
                  />
                ) : (
                  <EntryCard
                    entry={event.entry}
                    encounter={encounters.find(
                      (encounter) => encounter.id === event.entry.encounter_id,
                    )}
                    onEdit={
                      role === "clinician"
                        ? () => onEdit(event.entry)
                        : undefined
                    }
                    onHistory={() => onHistory(event.entry)}
                  />
                )}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <Empty title="No clinical journey recorded" />
      )}
    </section>
  );
}
