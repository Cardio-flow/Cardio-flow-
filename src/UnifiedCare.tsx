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
import type {
  ClinicalFact,
  ClinicalPreference,
  ClinicalState,
  ClinicalValue,
} from "./clinical-foundation";
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
import {
  MedicationEditor,
  MedicationLaboratoryOverview,
  type LaboratoryData,
  type MedicationData,
} from "./MedicationLaboratory";
import { QuickLabs } from "./QuickLabs";
import {
  HeartFailureClinicalRecord,
  HeartFailureDashboard,
  HeartFailureTimeline,
} from "./HeartFailure";
import {
  EchoStudyEditor,
  EchoValveClinicalRecord,
  EchoValveDashboard,
  EchoValveTimeline,
} from "./EchoValve";
import type { EchoStudy } from "./echo-valve";
import {
  CoronaryDashboard,
  CoronaryClinicalRecord,
  CoronaryTimeline,
  CoronaryRegistryProjection,
  CoronaryEditor,
} from "./Coronary";
import type { CoronaryRecord } from "./coronary-model";
import { prettyCoronary } from "./coronary-model";
import {
  displayHfCode,
  type HfReview,
  type HfPhenotypeState,
} from "./heart-failure";
import {
  AlertAction,
  PlanAction,
  PlanNote,
  type ClinicalTask,
  type PublishedAlert,
} from "./PlanAction";

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
type BoardClinicalTask = {
  id: string;
  patient_id: string;
  name: string;
  mrn: string;
  sex?: string;
  birth_date?: string;
  purpose: string;
  target_date: string | null;
  current_status: string;
  kind: string;
  medication_therapy_id: string | null;
};
type BoardData = {
  entries: BoardEntry[];
  encounters: BoardEncounter[];
  clinicalTasks: BoardClinicalTask[];
};
type ClinicalFoundationData = {
  state: ClinicalState;
  currentPreferences: ClinicalPreference[];
  tasks: ClinicalTask[];
  alerts: PublishedAlert[];
};
type HfSummaryState = {
  profile: { id: string } | null;
  currentReview: HfReview | null;
  phenotype: HfPhenotypeState;
  preferredEcho: { lvef: number | null; observed_at: string } | null;
  timeline?: Array<{
    id: string;
    type: string;
    date: string;
    title: string;
    detail: string;
  }>;
};

type ProjectedJourneyEvent = {
  id: string;
  date: string;
  title: string;
  subtitle: string;
  detail: string;
  destination:
    "Medications" | "Investigations" | "Current Visit" | "Plan & Follow-up";
  focus?: "hf" | "echo" | "coronary";
};

const patientTabs = [
  "Summary",
  "Journey",
  "Current Visit",
  "Medications",
  "Investigations",
  "Plan & Follow-up",
  "Registries",
];
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
    clinicalTasks: BoardClinicalTask[];
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
        clinicalTasks: [],
      });
    return grouped.get(id)!;
  }
  data?.entries.forEach((entry) =>
    getPatient(entry.patient_id, entry).entries.push(entry),
  );
  data?.encounters.forEach((encounter) =>
    getPatient(encounter.patient_id, encounter).encounters.push(encounter),
  );
  data?.clinicalTasks?.forEach((task) =>
    getPatient(task.patient_id, task).clinicalTasks.push(task),
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
        ...item.clinicalTasks.map((task) => task.target_date),
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
        ...item.clinicalTasks.map((task) => task.purpose),
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
      ...item.clinicalTasks.map((task) => task.target_date),
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
                    ...(data.clinicalTasks ?? []).map(
                      (task) => task.target_date,
                    ),
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
    clinicalTasks: BoardClinicalTask[];
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
  const overdueClinicalTask = item.clinicalTasks.find(
    (task) => task.target_date && task.target_date < today,
  );
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
    ...item.clinicalTasks
      .filter((task) => task.target_date)
      .map((task) => ({ date: task.target_date!, title: task.purpose })),
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
        <strong
          className={
            overdueEntry || overdueTask || overdueClinicalTask
              ? "danger-text"
              : ""
          }
        >
          {overdueEntry?.title ??
            (overdueClinicalTask
              ? `Monitoring overdue · ${overdueClinicalTask.purpose}`
              : overdueTask
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

function clinicalValueText(value: ClinicalValue) {
  if (value.type === "quantity") return `${value.value} ${value.unit}`;
  if (value.type === "coded") return value.display;
  if (value.type === "boolean") return value.value ? "Yes" : "No";
  if (value.type === "text") return value.value;
  return "Structured clinical record";
}

function clinicalConceptLabel(code: string) {
  return code
    .replace(/^investigation\./, "")
    .replace(/^care\./, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function latestAssertions(facts: ClinicalFact[]) {
  const latest = new Map<string, ClinicalFact>();
  for (const fact of facts) {
    const prior = latest.get(fact.logical_id);
    if (!prior || fact.version > prior.version)
      latest.set(fact.logical_id, fact);
  }
  return [...latest.values()].filter(
    (fact) =>
      fact.verification_status === "verified" &&
      fact.lifecycle_status === "active",
  );
}

function CurrentDecisionValues({
  patientId,
  data,
  editable,
  onChanged,
}: {
  patientId: string;
  data: ClinicalFoundationData;
  editable: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{
      conceptSystem: string;
      conceptCode: string;
      factId: string | null;
      action: "select" | "release";
    } | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const preferences = new Map(
    data.currentPreferences.map((preference) => [
      `${preference.concept_system}|${preference.concept_code}`,
      preference,
    ]),
  );
  const concepts = data.state.concepts.filter((concept) => {
    const candidates = latestAssertions(concept.history);
    return (
      candidates.length > 1 ||
      concept.pending.length > 0 ||
      preferences.get(`${concept.concept_system}|${concept.concept_code}`)
        ?.action === "select"
    );
  });
  if (!concepts.length) return null;
  async function save() {
    if (!editing || reason.trim().length < 2) {
      setError("Document why this value should guide current decisions.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${patientId}/clinical-preferences`, {
        concept_system: editing.conceptSystem,
        concept_code: editing.conceptCode,
        fact_id: editing.factId,
        action: editing.action,
        reason: reason.trim(),
      });
      setEditing(null);
      setReason("");
      onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel care-section current-values">
      <SectionTitle
        title="Current decision values"
        subtitle="Verified competing values remain in history. A documented clinician selection changes only which value guides current decisions."
      />
      <ErrorBox message={error} />
      <div className="current-value-list">
        {concepts.map((concept) => {
          const key = `${concept.concept_system}|${concept.concept_code}`,
            preference = preferences.get(key),
            override = preference?.action === "select",
            candidates = latestAssertions(concept.history);
          return (
            <details key={key} className="current-value-card">
              <summary>
                <span>
                  <strong>{clinicalConceptLabel(concept.concept_code)}</strong>
                  <small>
                    Current:{" "}
                    {concept.current
                      ? clinicalValueText(concept.current.value)
                      : "No verified current value"}
                  </small>
                </span>
                {override ? (
                  <Badge tone="warning">Clinician selected</Badge>
                ) : null}
              </summary>
              {override ? (
                <div className="preference-note">
                  <strong>Clinician override is active</strong>
                  <p>{preference.reason}</p>
                  <small>
                    Selected by {preference.actor} ·{" "}
                    {new Date(preference.created_at).toLocaleString()}
                  </small>
                </div>
              ) : null}
              <div className="candidate-values">
                {candidates.map((fact) => (
                  <div
                    key={fact.id}
                    className={
                      fact.id === concept.current?.id ? "selected" : ""
                    }
                  >
                    <span>
                      <strong>{clinicalValueText(fact.value)}</strong>
                      <small>
                        {fact.source_label} ·{" "}
                        {new Date(fact.observed_at).toLocaleDateString()} ·{" "}
                        {fact.source_quality} quality
                      </small>
                    </span>
                    {fact.id === concept.current?.id ? (
                      <Badge tone="active">Current</Badge>
                    ) : editable ? (
                      <button
                        className="secondary small"
                        onClick={() => {
                          setEditing({
                            conceptSystem: concept.concept_system,
                            conceptCode: concept.concept_code,
                            factId: fact.id,
                            action: "select",
                          });
                          setReason("");
                        }}
                      >
                        Use as current value
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {override && editable ? (
                <button
                  className="text-button"
                  onClick={() => {
                    setEditing({
                      conceptSystem: concept.concept_system,
                      conceptCode: concept.concept_code,
                      factId: null,
                      action: "release",
                    });
                    setReason("");
                  }}
                >
                  Return to automatic current-value resolution
                </button>
              ) : null}
              {editing?.conceptCode === concept.concept_code ? (
                <div className="preference-editor">
                  <label>
                    Clinical reason
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Document why this value should guide current decisions"
                      maxLength={1000}
                    />
                  </label>
                  <div>
                    <button
                      className="secondary"
                      onClick={() => setEditing(null)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    <button className="primary" onClick={save} disabled={busy}>
                      {busy ? "Saving…" : "Confirm current value"}
                    </button>
                  </div>
                </div>
              ) : null}
            </details>
          );
        })}
      </div>
    </section>
  );
}

type AddChoice = {
  label: string;
  description: string;
  kind: CareKind;
  custom?: boolean;
  smart?: "medication" | "laboratory" | "echo" | "coronary";
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
    label: "Echo study",
    description: "Structured TTE, valve findings and longitudinal comparison",
    kind: "investigation",
    smart: "echo",
  },
  {
    label: "Coronary care",
    description: "ECG, ACS, angiography, PCI and longitudinal plan",
    kind: "procedure",
    smart: "coronary",
  },
  {
    label: "Medication",
    description: "Start or change a structured medication course",
    kind: "medication",
    smart: "medication",
  },
  {
    label: "Medication Record",
    description: "Use the existing guided medication assessment",
    kind: "medication",
  },
  {
    label: "Laboratory result",
    description: "Add a structured, unit-normalized result",
    kind: "investigation",
    smart: "laboratory",
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
    [smartEditor, setSmartEditor] = useState<
      "medication" | "laboratory" | "echo" | "coronary" | null
    >(null),
    [newEncounter, setNewEncounter] = useState(false),
    [closing, setClosing] = useState<CareEncounter | null>(null),
    [history, setHistory] = useState<CareEntry | null>(null),
    [registry, setRegistry] = useState(false),
    [followup, setFollowup] = useState<Task | null>(null),
    [planTask, setPlanTask] = useState<ClinicalTask | "new" | null>(null),
    [planNote, setPlanNote] = useState(false),
    [publishedAlert, setPublishedAlert] = useState<PublishedAlert | null>(null),
    [clinicalFocus, setClinicalFocus] = useState<
      "hf" | "echo" | "coronary" | null
    >(null),
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
  const { data: clinicalFoundation } = useData<ClinicalFoundationData>(
    `/patients/${id}/clinical-state`,
    revision,
  );
  const { data: medicationIntelligence } = useData<MedicationData>(
    `/patients/${id}/medications`,
    revision,
  );
  const { data: laboratoryIntelligence } = useData<LaboratoryData>(
    `/patients/${id}/laboratory`,
    revision,
  );
  const { data: echoValveIntelligence } = useData<{
    studies: EchoStudy[];
    procedures?: Array<{
      id: string;
      procedure_date: string;
      procedure_type: string;
      result: string;
    }>;
    heartTeam?: Array<{
      id: string;
      observed_at: string;
      status: string;
      decision: string;
      rationale: string;
    }>;
  }>(`/patients/${id}/echo-valve`, revision);
  const { data: coronaryIntelligence } = useData<CoronaryRecord>(
    `/patients/${id}/coronary`,
    revision,
  );
  const { data: hfSummary } = useData<HfSummaryState>(
    `/patients/${id}/heart-failure`,
    revision,
  );

  function saved() {
    setEditor(null);
    setSmartEditor(null);
    setCustomEditor(false);
    setEditorLabel("");
    setAddMenu(false);
    setNewEncounter(false);
    setClosing(null);
    setFollowup(null);
    setPlanTask(null);
    setPlanNote(false);
    setPublishedAlert(null);
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
  const clinicalTasks = (clinicalFoundation?.tasks ?? []).filter(
    (task) =>
      !["completed", "cancelled", "superseded"].includes(
        task.current?.status ?? "open",
      ),
  );
  const activeAlerts = (clinicalFoundation?.alerts ?? []).filter(
    (alert) => !["act", "dismiss"].includes(alert.action?.action ?? ""),
  );
  const pending = entries.filter(needsReview);
  const activeProblems = entries.filter(
    (entry) => entry.kind === "problem" && entry.status !== "resolved",
  );
  const specialtyProblems: {
    title: string;
    detail: string;
    focus: "hf" | "coronary";
  }[] = [];
  if (hfSummary?.profile && hfSummary.currentReview)
    specialtyProblems.push({
      title:
        hfSummary.phenotype.value &&
        hfSummary.phenotype.value !== "UNCLASSIFIED"
          ? hfSummary.phenotype.value
          : "Heart failure review",
      detail: `${displayHfCode(hfSummary.currentReview.presentation)}${hfSummary.currentReview.nyha_class && hfSummary.currentReview.nyha_class !== "NOT_ASSESSED" ? ` · NYHA ${hfSummary.currentReview.nyha_class}` : ""}${hfSummary.preferredEcho?.lvef != null ? ` · EF ${hfSummary.preferredEcho.lvef}%` : ""}`,
      focus: "hf",
    });
  if (
    coronaryIntelligence?.currentState &&
    coronaryIntelligence.currentState.state !== "NO_ESTABLISHED_CAD"
  )
    specialtyProblems.push({
      title: prettyCoronary(coronaryIntelligence.currentState.state),
      detail: coronaryIntelligence.acsEvents[0]?.diagnosis
        ? `Latest ACS: ${prettyCoronary(coronaryIntelligence.acsEvents[0].diagnosis)}`
        : "Coronary care",
      focus: "coronary",
    });
  const visibleCareProblems = activeProblems.filter(
    (entry) =>
      !specialtyProblems.some(
        (item) =>
          (item.focus === "hf" && entry.family === "HF") ||
          (item.focus === "coronary" && entry.family === "CAD"),
      ),
  );
  const specialtyChanges = [
    ...(hfSummary?.currentReview
      ? [
          {
            id: `hf-${hfSummary.currentReview.id}`,
            title: "Heart failure review",
            when: hfSummary.currentReview.observed_at,
            focus: "hf" as const,
          },
        ]
      : []),
    ...(coronaryIntelligence?.acsEvents[0]
      ? [
          {
            id: `acs-${coronaryIntelligence.acsEvents[0].id}`,
            title: `${prettyCoronary(coronaryIntelligence.acsEvents[0].diagnosis)} presentation`,
            when: coronaryIntelligence.acsEvents[0].presented_at,
            focus: "coronary" as const,
          },
        ]
      : []),
    ...(echoValveIntelligence?.studies[0]
      ? [
          {
            id: `echo-${echoValveIntelligence.studies[0].study_id}`,
            title: "Cardiac imaging",
            when: echoValveIntelligence.studies[0].performed_at,
            focus: "echo" as const,
          },
        ]
      : []),
  ].filter((item) => !!item.when);
  const activeMedications = entries.filter(
    (entry) =>
      entry.kind === "medication" &&
      !["discontinued", "cancelled"].includes(entry.status),
  );
  const results = entries.filter((entry) => entry.kind === "investigation");
  const currentEncounter = encounters.find(
    (encounter) => encounter.state === "open",
  );
  const previousPlanTasks = (clinicalFoundation?.tasks ?? [])
    .filter(
      (task) =>
        (!currentEncounter || task.encounter_id !== currentEncounter.id) &&
        !["cancelled", "superseded"].includes(task.current?.status ?? "open"),
    )
    .slice(0, 6);
  const projectedJourney: ProjectedJourneyEvent[] = [
    ...(medicationIntelligence?.history ?? []).map((item) => ({
      id: `medication-${item.id}`,
      date: item.effective_at,
      title: item.generic_name,
      subtitle: `Medication · ${item.event_type.replaceAll("_", " ")}`,
      detail: `${item.dose_value != null ? `${item.dose_value} ${item.dose_unit ?? ""}` : "Dose not recorded"}${item.frequency ? ` · ${item.frequency}` : ""}`,
      destination: "Medications" as const,
    })),
    ...(laboratoryIntelligence?.trends ?? []).flatMap((trend) =>
      trend.results.map((item) => ({
        id: `laboratory-${item.id}`,
        date: item.resulted_at,
        title: `${trend.display} ${item.original_value} ${item.original_unit}`,
        subtitle: "Laboratory result",
        detail: `${item.verification_status} · ${item.source_label}`,
        destination: "Investigations" as const,
      })),
    ),
    ...(hfSummary?.timeline ?? [])
      .filter((item) => item.type !== "Cardiac imaging")
      .map((item) => ({
        id: `hf-${item.type}-${item.id}`,
        date: item.date,
        title: displayHfCode(item.title),
        subtitle: item.type,
        detail: displayHfCode(item.detail),
        destination: "Current Visit" as const,
        focus: "hf" as const,
      })),
    ...(echoValveIntelligence?.studies ?? []).map((item) => ({
      id: `echo-${item.study_id}`,
      date: item.performed_at,
      title: item.source_label,
      subtitle: "Echo",
      detail: item.conclusion || item.interpretation || item.status,
      destination: "Current Visit" as const,
      focus: "echo" as const,
    })),
    ...(echoValveIntelligence?.procedures ?? []).map((item) => ({
      id: `valve-procedure-${item.id}`,
      date: item.procedure_date,
      title: item.procedure_type.replaceAll("_", " "),
      subtitle: "Valve intervention",
      detail: item.result || "Procedure documented",
      destination: "Current Visit" as const,
      focus: "echo" as const,
    })),
    ...(echoValveIntelligence?.heartTeam ?? []).map((item) => ({
      id: `heart-team-${item.id}`,
      date: item.observed_at,
      title: `Heart Team · ${item.status.replaceAll("_", " ")}`,
      subtitle: "Clinical decision",
      detail: item.decision || item.rationale || "Heart Team review documented",
      destination: "Current Visit" as const,
      focus: "echo" as const,
    })),
    ...(coronaryIntelligence?.acsEvents ?? []).map((item) => ({
      id: `acs-${item.id}`,
      date: item.presented_at,
      title: `${prettyCoronary(item.diagnosis)} presentation`,
      subtitle: "Coronary event",
      detail: item.clinical_interpretation || "Presentation documented",
      destination: "Current Visit" as const,
      focus: "coronary" as const,
    })),
    ...(coronaryIntelligence?.ecgs ?? []).map((item) => ({
      id: `ecg-${item.id}`,
      date: item.performed_at,
      title: "ECG",
      subtitle: "Coronary investigation",
      detail:
        item.clinician_interpretation || item.st_changes || "ECG documented",
      destination: "Current Visit" as const,
      focus: "coronary" as const,
    })),
    ...(coronaryIntelligence?.angiograms ?? []).map((item) => ({
      id: `angiogram-${item.id}`,
      date: item.performed_at,
      title: "Coronary angiography",
      subtitle: "Coronary investigation",
      detail: item.conclusion || "Angiography documented",
      destination: "Current Visit" as const,
      focus: "coronary" as const,
    })),
    ...(coronaryIntelligence?.pcis ?? []).map((item) => ({
      id: `pci-${item.id}`,
      date: item.performed_at,
      title: `PCI ${item.target_vessel ?? ""}`.trim(),
      subtitle: "Coronary procedure",
      detail: item.result || "PCI documented",
      destination: "Current Visit" as const,
      focus: "coronary" as const,
    })),
    ...(clinicalFoundation?.tasks ?? [])
      .filter(
        (task) =>
          task.current?.status === "completed" && task.current.created_at,
      )
      .map((task) => ({
        id: `completed-task-${task.id}`,
        date: task.current!.created_at!,
        title: `${task.purpose} completed`,
        subtitle: "Completed plan action",
        detail: `${task.current?.note ?? "Completed"}${task.details?.plan?.reason ? ` · Reason: ${task.details.plan.reason}` : ""}`,
        destination: "Plan & Follow-up" as const,
      })),
  ].filter((item) => !!item.date);
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
    ...clinicalTasks
      .filter((task) => task.target_date)
      .map((task) => ({ date: task.target_date!, label: task.purpose })),
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
                : (specialtyProblems[0]?.title ??
                  activeProblems[0]?.title ??
                  "Longitudinal cardiology record")}
            </strong>
          </div>
        </div>
        {role === "clinician" ? (
          <div className="patient-primary-actions">
            <button className="secondary" onClick={() => setNewEncounter(true)}>
              <CalendarDays size={16} /> New visit / admission
            </button>
            <button className="secondary" onClick={() => setAddMenu(true)}>
              <Plus size={17} /> More actions
            </button>
          </div>
        ) : null}
      </header>
      <div className="patient-status-line">
        <span>
          {visibleCareProblems.length + specialtyProblems.length} active
          problems
        </span>
        <span>
          {pending.length + tasks.length + clinicalTasks.length} outstanding
          actions
        </span>
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
          <>
            <PatientSummary
              activeProblems={visibleCareProblems}
              specialtyProblems={specialtyProblems}
              results={results}
              medications={activeMedications}
              structuredMedications={medicationIntelligence?.current ?? []}
              structuredLabs={laboratoryIntelligence?.trends ?? []}
              pending={pending}
              tasks={tasks}
              clinicalTasks={clinicalTasks}
              publishedAlerts={activeAlerts}
              alerts={alerts}
              nextEvent={nextEvent}
              role={role}
              onEdit={edit}
              onTask={setFollowup}
              onClinicalTask={setPlanTask}
              onAlert={setPublishedAlert}
              onRecord={() => setTab("Clinical Record")}
              onSpecialty={(focus) => {
                setClinicalFocus(focus);
                setTab("Current Visit");
              }}
              onJourney={() => setTab("Journey")}
              onInvestigations={() => setTab("Investigations")}
              onMedications={() => setTab("Medications")}
              recentEntries={entries}
              specialtyChanges={specialtyChanges}
            />
            <div
              className="journey-quick-actions"
              aria-label="Quick clinical actions"
            >
              {role === "clinician" ? (
                <>
                  <button
                    className="primary"
                    onClick={() => setSmartEditor("laboratory")}
                  >
                    <FlaskConical size={17} /> Add labs
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setSmartEditor("medication")}
                  >
                    <Pill size={17} /> Add medication
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setEditor("problem")}
                  >
                    <HeartPulse size={17} /> Add diagnosis
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setTab("Current Visit")}
                  >
                    <Stethoscope size={17} /> Review visit
                  </button>
                </>
              ) : null}
            </div>
          </>
        ) : tab === "Journey" ? (
          <>
            <div className="journey-page-intro">
              <div>
                <span className="eyebrow">ONE PATIENT, CONTINUOUS CARE</span>
                <h2>Patient journey</h2>
                <p>
                  Visits, admissions, procedures and continuing care in one
                  sequence.
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => setTab("Clinical Record")}
              >
                View full clinical record
              </button>
            </div>
            <PatientTimeline
              entries={entries}
              encounters={encounters}
              projectedEvents={projectedJourney}
              role={role}
              onEdit={edit}
              onHistory={setHistory}
              onCloseEncounter={setClosing}
              onOpenContext={(event) => {
                setTab(event.destination);
                if (event.focus) setClinicalFocus(event.focus);
              }}
            />
            <details className="journey-specialty-history">
              <summary>Specialty event details</summary>
              <CoronaryTimeline patientId={id} revision={revision} />
              <EchoValveTimeline patientId={id} revision={revision} />
              <HeartFailureTimeline patientId={id} revision={revision} />
            </details>
          </>
        ) : tab === "Current Visit" ? (
          <>
            <section className="panel care-section visit-context">
              <SectionTitle
                title={
                  currentEncounter
                    ? `${currentEncounter.kind} · ${currentEncounter.reason}`
                    : "Continuing care"
                }
                subtitle={
                  currentEncounter
                    ? `${date(currentEncounter.started_on)} · ${currentEncounter.owner}`
                    : "Open a visit when documenting a new OPD assessment or admission."
                }
              />
              <p className="muted">
                Outstanding plan items and historical results remain available
                throughout this visit.
              </p>
              <div className="journey-quick-actions">
                {role === "clinician" ? (
                  <button
                    className="primary"
                    onClick={() => setNewEncounter(true)}
                  >
                    <Plus size={16} /> Start visit / admission
                  </button>
                ) : null}
                <button
                  className="secondary"
                  onClick={() => setTab("Plan & Follow-up")}
                >
                  Review previous plan
                </button>
                <button
                  className="secondary"
                  onClick={() => setTab("Investigations")}
                >
                  Review results
                </button>
              </div>
              {currentEncounter
                ? entries
                    .filter(
                      (entry) => entry.encounter_id === currentEncounter.id,
                    )
                    .slice(0, 6)
                    .map((entry) => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        encounter={currentEncounter}
                        onEdit={
                          role === "clinician" ? () => edit(entry) : undefined
                        }
                        onHistory={() => setHistory(entry)}
                      />
                    ))
                : null}
            </section>
            <section className="panel care-section visit-previous-plan">
              <SectionTitle
                title="From previous plan"
                subtitle="Actions carried forward from earlier care, with their reason and outcome."
              />
              {previousPlanTasks.map((task) => {
                const status = task.current?.status ?? "open";
                const timing =
                  status === "completed"
                    ? "Completed"
                    : task.target_date && task.target_date < currentDate()
                      ? "Overdue"
                      : task.target_date === currentDate()
                        ? "Due today"
                        : "Pending";
                return (
                  <button
                    key={task.id}
                    className="plan-followup-row"
                    onClick={() => {
                      if (role === "clinician" && status !== "completed")
                        setPlanTask(task);
                      else setTab("Plan & Follow-up");
                    }}
                  >
                    <CalendarDays size={17} />
                    <span>
                      <strong>{task.purpose}</strong>
                      <small>
                        {timing}
                        {task.target_date ? ` · ${date(task.target_date)}` : ""}
                      </small>
                      {task.details?.plan?.reason ? (
                        <small>Why: {task.details.plan.reason}</small>
                      ) : null}
                      {status === "completed" && task.current?.note ? (
                        <small>Outcome: {task.current.note}</small>
                      ) : null}
                    </span>
                    <ArrowRight size={16} />
                  </button>
                );
              })}
              {!previousPlanTasks.length ? (
                <p className="muted">No prior plan actions recorded.</p>
              ) : null}
            </section>
            <section className="panel care-section visit-review-picker">
              <SectionTitle
                title="Focused clinical review"
                subtitle="Open the review relevant to the current clinical question."
              />
              <div className="review-choice-row">
                <button
                  className={clinicalFocus === "hf" ? "selected" : "secondary"}
                  onClick={() => setClinicalFocus("hf")}
                >
                  Heart failure
                </button>
                <button
                  className={
                    clinicalFocus === "coronary" ? "selected" : "secondary"
                  }
                  onClick={() => setClinicalFocus("coronary")}
                >
                  Coronary care
                </button>
                <button
                  className={
                    clinicalFocus === "echo" ? "selected" : "secondary"
                  }
                  onClick={() => setClinicalFocus("echo")}
                >
                  Echo & valve
                </button>
              </div>
            </section>
            {clinicalFocus === "hf" ? (
              <HeartFailureDashboard
                patientId={id}
                revision={revision}
                role={role}
                encounters={encounters}
                onChanged={saved}
              />
            ) : null}
            {clinicalFocus === "echo" ? (
              <EchoValveDashboard
                patientId={id}
                revision={revision}
                role={role}
                encounters={encounters}
                onChanged={saved}
              />
            ) : null}
            {clinicalFocus === "coronary" ? (
              <CoronaryDashboard
                patientId={id}
                revision={revision}
                role={role}
                encounters={encounters}
                onChanged={saved}
              />
            ) : null}
          </>
        ) : tab === "Medications" ? (
          <>
            <div className="journey-page-intro">
              <div>
                <span className="eyebrow">CURRENT TREATMENT</span>
                <h2>Medications</h2>
                <p>Current therapies, changes and monitoring in one place.</p>
              </div>
              {role === "clinician" ? (
                <button
                  className="primary"
                  onClick={() => setSmartEditor("medication")}
                >
                  <Plus size={16} /> Add medication
                </button>
              ) : null}
            </div>
            <MedicationLaboratoryOverview
              patientId={id}
              revision={revision}
              role={role}
              owner={owner}
              onAddMedication={() => setSmartEditor("medication")}
              onAddLab={() => setSmartEditor("laboratory")}
              onChanged={saved}
            />
          </>
        ) : tab === "Investigations" ? (
          <>
            <div className="journey-page-intro">
              <div>
                <span className="eyebrow">RESULTS & IMAGING</span>
                <h2>Investigations</h2>
                <p>
                  Recent values and trends with their original source and date.
                </p>
              </div>
              {role === "clinician" ? (
                <button
                  className="primary"
                  onClick={() => setSmartEditor("laboratory")}
                >
                  <Plus size={16} /> Add labs
                </button>
              ) : null}
            </div>
            <section className="panel care-section investigation-list">
              {laboratoryIntelligence?.trends.length ? (
                laboratoryIntelligence.trends.map((trend) => (
                  <article key={trend.test_id}>
                    <div>
                      <strong>{trend.display}</strong>
                      <small>
                        {date(trend.latest.collected_at)} ·{" "}
                        {trend.latest.verification_status} ·{" "}
                        {trend.latest.source_label}
                      </small>
                    </div>
                    <div>
                      <strong>
                        {trend.latest.original_value}{" "}
                        {trend.latest.original_unit}
                      </strong>
                      <small>
                        {trend.previous
                          ? `Previous ${trend.previous.original_value} ${trend.previous.original_unit}`
                          : "First recorded result"}
                      </small>
                    </div>
                  </article>
                ))
              ) : (
                <Empty title="No structured laboratory results yet" />
              )}
            </section>
            <EchoValveClinicalRecord patientId={id} revision={revision} />
          </>
        ) : tab === "Plan & Follow-up" ? (
          <>
            <div className="journey-page-intro">
              <div>
                <span className="eyebrow">CONTINUITY OF CARE</span>
                <h2>Plan & follow-up</h2>
                <p>
                  These open actions continue across discharge and future
                  visits.
                </p>
              </div>
              {role === "clinician" ? (
                <div className="journey-intro-actions">
                  <button
                    className="secondary"
                    onClick={() => setPlanNote(true)}
                    disabled={
                      !clinicalFoundation ||
                      !medicationIntelligence ||
                      !laboratoryIntelligence
                    }
                    title="Available when current clinical data has loaded"
                  >
                    Draft plan note
                  </button>
                  <button
                    className="primary"
                    onClick={() => setPlanTask("new")}
                  >
                    <Plus size={16} /> Plan next action
                  </button>
                </div>
              ) : null}
            </div>
            <section className="panel care-section plan-workspace">
              {!pending.length && !clinicalTasks.length && !tasks.length ? (
                <Empty title="No open plan items" />
              ) : null}
              {clinicalTasks.map((task) => (
                <button
                  key={task.id}
                  className="plan-followup-row"
                  onClick={() =>
                    role === "clinician" ? setPlanTask(task) : undefined
                  }
                >
                  <CalendarDays size={17} />
                  <span>
                    <strong>{task.purpose}</strong>
                    <small>
                      Due{" "}
                      {task.target_date
                        ? date(task.target_date)
                        : "date not set"}{" "}
                      · {task.assigned_to}
                    </small>
                    {task.details?.plan?.reason ? (
                      <small>Reason: {task.details.plan.reason}</small>
                    ) : null}
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
              {pending.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  encounter={encounters.find(
                    (item) => item.id === entry.encounter_id,
                  )}
                  onEdit={role === "clinician" ? () => edit(entry) : undefined}
                  onHistory={() => setHistory(entry)}
                />
              ))}
              {tasks.map((task) => (
                <button
                  key={task.id}
                  className="plan-followup-row"
                  onClick={() => setFollowup(task)}
                >
                  <CalendarDays size={17} />
                  <span>
                    {task.milestone}-month CAD follow-up · {date(task.due_date)}
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </section>
            {clinicalFoundation ? (
              <CurrentDecisionValues
                patientId={id}
                data={clinicalFoundation}
                editable={role === "clinician"}
                onChanged={() => setRevision((value) => value + 1)}
              />
            ) : null}
          </>
        ) : tab === "Clinical Record" ? (
          <>
            <CoronaryClinicalRecord patientId={id} revision={revision} />
            <EchoValveClinicalRecord patientId={id} revision={revision} />
            <HeartFailureClinicalRecord patientId={id} revision={revision} />
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
                  Care context
                  <select
                    value={encounterFilter}
                    onChange={(event) => setEncounterFilter(event.target.value)}
                  >
                    <option value="all">All care contexts</option>
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
                  Use the relevant patient action to document clinical
                  information once.
                </Empty>
              )}
            </section>
          </>
        ) : (
          <>
            <CoronaryRegistryProjection patientId={id} revision={revision} />
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
                title="Legacy CAD episode history"
                subtitle="Existing versioned episodes remain readable. Record new coronary care in Current Visit and review its registry draft below."
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
                <div className="registry-status-row">
                  <p className="muted">
                    No legacy CAD episode. New coronary care can populate the
                    registry draft below without one.
                  </p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={enroll}
                  >
                    Start CAD episode workflow
                  </button>
                </div>
              ) : (
                <p className="muted">
                  No legacy CAD episode. The connected clinical record can
                  populate the CAD registry draft without starting a duplicate
                  episode workflow.
                </p>
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
                  if (choice.smart) setSmartEditor(choice.smart);
                  else setEditor(choice.kind);
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
      {smartEditor === "medication" ? (
        <MedicationEditor
          patientId={id}
          owner={owner}
          encounters={encounters}
          activeProblems={activeProblems}
          comorbidities={person.major_comorbidities ?? []}
          onClose={() => setSmartEditor(null)}
          onSaved={saved}
        />
      ) : smartEditor === "laboratory" ? (
        <QuickLabs
          patientId={id}
          encounters={encounters}
          onClose={() => setSmartEditor(null)}
          onSaved={saved}
          onPartialSaved={() => {
            setRevision((value) => value + 1);
            onSaved();
          }}
        />
      ) : smartEditor === "echo" ? (
        <EchoStudyEditor
          patientId={id}
          encounters={encounters}
          studies={echoValveIntelligence?.studies ?? []}
          onClose={() => setSmartEditor(null)}
          onSaved={saved}
        />
      ) : smartEditor === "coronary" && coronaryIntelligence ? (
        <CoronaryEditor
          mode="state"
          patientId={id}
          encounters={encounters}
          record={coronaryIntelligence}
          onClose={() => setSmartEditor(null)}
          onSaved={saved}
        />
      ) : null}
      {newEncounter ? (
        <EncounterEditor
          patient={person}
          encounters={encounters}
          pending={pending}
          pendingTasks={clinicalTasks}
          clinicalContext={{
            problems: [
              ...specialtyProblems.map((item) => item.title),
              ...activeProblems.map((item) => item.title),
            ].slice(0, 6),
            medications: (medicationIntelligence?.current ?? [])
              .filter((item) => item.status === "ACTIVE")
              .slice(0, 6)
              .map((item) => item.generic_name),
            results: (laboratoryIntelligence?.trends ?? [])
              .slice(0, 6)
              .map(
                (item) =>
                  `${item.display} ${item.latest.original_value} ${item.latest.original_unit}`,
              ),
            imaging: echoValveIntelligence?.studies?.length
              ? `${echoValveIntelligence.studies[0].source_label} · ${date(echoValveIntelligence.studies[0].performed_at)}`
              : null,
          }}
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
      {planTask ? (
        <PlanAction
          patientId={id}
          encounterId={currentEncounter?.id ?? null}
          owner={currentEncounter?.owner ?? owner}
          problems={[
            ...specialtyProblems.map((item) => item.title),
            ...visibleCareProblems.map((item) => item.title),
          ]}
          medications={(medicationIntelligence?.current ?? [])
            .filter((item) => item.status === "ACTIVE")
            .map((item) => item.generic_name)}
          task={planTask === "new" ? undefined : planTask}
          onClose={() => setPlanTask(null)}
          onSaved={saved}
        />
      ) : null}
      {planNote ? (
        <PlanNote
          patientId={id}
          encounterId={currentEncounter?.id ?? null}
          owner={currentEncounter?.owner ?? owner}
          problems={[
            ...specialtyProblems.map((item) => item.title),
            ...visibleCareProblems.map((item) => item.title),
          ].slice(0, 12)}
          medications={(medicationIntelligence?.current ?? [])
            .filter((item) => item.status === "ACTIVE")
            .map((item) =>
              `${item.generic_name}${item.dose_value != null ? ` ${item.dose_value} ${item.dose_unit ?? ""}` : ""}${item.frequency ? ` ${item.frequency}` : ""}`.trim(),
            )
            .slice(0, 16)}
          results={(laboratoryIntelligence?.trends ?? [])
            .slice(0, 12)
            .map(
              (item) =>
                `${item.display} ${item.latest.original_value} ${item.latest.original_unit} (${date(item.latest.resulted_at)}; ${item.latest.verification_status})`,
            )}
          actions={[
            ...clinicalTasks.map((item) => ({
              purpose: item.purpose,
              target_date: item.target_date,
              reason: item.details?.plan?.reason,
            })),
            ...pending.map((item) => ({
              purpose: item.title,
              target_date: item.due_date,
            })),
            ...tasks.map((item) => ({
              purpose: `${item.milestone}-month CAD follow-up`,
              target_date: item.due_date,
            })),
          ].slice(0, 20)}
          onClose={() => setPlanNote(false)}
          onSaved={saved}
        />
      ) : null}
      {publishedAlert ? (
        <AlertAction
          alert={publishedAlert}
          onClose={() => setPublishedAlert(null)}
          onSaved={saved}
        />
      ) : null}
    </>
  );
}

function PatientSummary({
  activeProblems,
  specialtyProblems,
  results,
  medications,
  structuredMedications,
  structuredLabs,
  pending,
  tasks,
  clinicalTasks,
  publishedAlerts,
  alerts,
  nextEvent,
  role,
  onEdit,
  onTask,
  onClinicalTask,
  onAlert,
  onRecord,
  onSpecialty,
  onJourney,
  onInvestigations,
  onMedications,
  recentEntries,
  specialtyChanges,
}: {
  activeProblems: CareEntry[];
  specialtyProblems: {
    title: string;
    detail: string;
    focus: "hf" | "coronary";
  }[];
  results: CareEntry[];
  medications: CareEntry[];
  structuredMedications: import("./medication-laboratory").CurrentTherapy[];
  structuredLabs: import("./medication-laboratory").LabTrend[];
  pending: CareEntry[];
  tasks: Task[];
  clinicalTasks: ClinicalTask[];
  publishedAlerts: PublishedAlert[];
  alerts: ReturnType<typeof documentationAlerts>;
  nextEvent?: { date: string; label: string };
  role: Role;
  onEdit: (entry: CareEntry) => void;
  onTask: (task: Task) => void;
  onClinicalTask: (task: ClinicalTask) => void;
  onAlert: (alert: PublishedAlert) => void;
  onRecord: () => void;
  onSpecialty: (focus: "hf" | "coronary" | "echo") => void;
  onJourney: () => void;
  onInvestigations: () => void;
  onMedications: () => void;
  recentEntries: CareEntry[];
  specialtyChanges: {
    id: string;
    title: string;
    when: string;
    focus: "hf" | "coronary" | "echo";
  }[];
}) {
  const openEntry = (entry: CareEntry) =>
    role === "clinician" ? onEdit(entry) : onRecord();
  const overdue = pending.filter(
    (entry) => entry.due_date && entry.due_date < currentDate(),
  );
  const attention = [
    ...publishedAlerts.map((alert) => ({
      id: alert.id,
      title: alert.title,
      detail: alert.detail,
      publishedAlert: alert,
    })),
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
    ...clinicalTasks
      .filter((task) => task.target_date && task.target_date <= currentDate())
      .map((task) => ({
        id: task.id,
        title: task.purpose,
        detail:
          task.target_date! < currentDate()
            ? "Planned action overdue"
            : "Planned action due today",
        clinicalTask: task,
      })),
  ];
  const whatChanged = [
    ...specialtyChanges.map((event) => ({
      id: event.id,
      label: event.title,
      detail: `Clinical review · ${date(event.when)}`,
      when: event.when,
      action: () => onSpecialty(event.focus),
    })),
    ...recentEntries.map((entry) => ({
      id: `care-${entry.id}`,
      label: entry.title,
      detail: `${careKinds[entry.kind].label} · ${date(entry.occurred_on)}`,
      when: entry.updated_at || entry.occurred_on,
      action: () => openEntry(entry),
    })),
    ...structuredLabs.map((trend) => ({
      id: `lab-${trend.latest.id}`,
      label: `${trend.display} ${trend.latest.original_value} ${trend.latest.original_unit}`,
      detail: `Result · ${date(trend.latest.collected_at)}`,
      when: trend.latest.collected_at,
      action: onInvestigations,
    })),
    ...structuredMedications.map((therapy) => ({
      id: `med-${therapy.id}`,
      label: `${therapy.generic_name} · ${stateLabel(therapy.event_type)}`,
      detail: `Treatment · ${date(therapy.effective_at)}`,
      when: therapy.effective_at,
      action: onMedications,
    })),
  ]
    .sort((a, b) => b.when.localeCompare(a.when))
    .slice(0, 4);
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
                    : "publishedAlert" in item && item.publishedAlert
                      ? role === "clinician"
                        ? onAlert(item.publishedAlert)
                        : onRecord()
                      : "clinicalTask" in item && item.clinicalTask
                        ? role === "clinician"
                          ? onClinicalTask(item.clinicalTask)
                          : onRecord()
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
      <section className="panel summary-changes" aria-label="What changed">
        <div className="summary-section-title">
          <span>
            <History size={18} />
          </span>
          <h2>What Changed</h2>
          <button className="text-button" onClick={onJourney}>
            View journey
          </button>
        </div>
        {whatChanged.length ? (
          <div className="summary-list">
            {whatChanged.map((event) => (
              <button key={event.id} onClick={event.action}>
                <span>
                  <strong>{event.label}</strong>
                  <small>{event.detail}</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">No recent clinical changes documented.</p>
        )}
      </section>
      <div className="summary-grid">
        <SummarySection
          icon={<HeartPulse size={18} />}
          title="Active Problems"
          empty="No active problems documented."
        >
          {specialtyProblems.map((problem) => (
            <button
              key={problem.focus}
              onClick={() => onSpecialty(problem.focus)}
            >
              <span>
                <strong>{problem.title}</strong>
                <small>{problem.detail}</small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
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
          action={structuredLabs.length ? "Details" : "View all"}
          onAction={onInvestigations}
        >
          {structuredLabs.length
            ? structuredLabs.slice(0, 5).map((trend) => (
                <button key={trend.test_id} onClick={onInvestigations}>
                  <span>
                    <strong>{trend.display}</strong>
                    <small>
                      {trend.latest.canonical_value} {trend.canonical_unit} ·{" "}
                      {date(trend.latest.collected_at)}
                    </small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))
            : results.slice(0, 5).map((entry) => (
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
          action={structuredMedications.length ? "Details" : "View all"}
          onAction={onMedications}
        >
          {structuredMedications.length
            ? structuredMedications
                .filter((therapy) => therapy.status !== "STOPPED")
                .slice(0, 6)
                .map((therapy) => (
                  <button key={therapy.id} onClick={onMedications}>
                    <span>
                      <strong>{therapy.generic_name}</strong>
                      <small>
                        {therapy.dose_value !== null
                          ? `${therapy.dose_value} ${therapy.dose_unit ?? ""}`
                          : stateLabel(therapy.status)}
                        {therapy.frequency ? ` · ${therapy.frequency}` : ""}
                      </small>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                ))
            : medications.slice(0, 6).map((entry) => (
                <button key={entry.id} onClick={() => openEntry(entry)}>
                  <span>
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.details.dose || stateLabel(entry.status)}
                    </small>
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
          {clinicalTasks.slice(0, 3).map((task) => (
            <button
              key={task.id}
              onClick={() =>
                role === "clinician" ? onClinicalTask(task) : onRecord()
              }
            >
              <span className="plan-number">A</span>
              <span>
                <strong>{task.purpose}</strong>
                <small>
                  Due{" "}
                  {task.target_date ? date(task.target_date) : "date not set"} ·{" "}
                  {task.assigned_to}
                </small>
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
  projectedEvents,
  role,
  onEdit,
  onHistory,
  onCloseEncounter,
  onOpenContext,
}: {
  entries: CareEntry[];
  encounters: CareEncounter[];
  projectedEvents: ProjectedJourneyEvent[];
  role: Role;
  onEdit: (entry: CareEntry) => void;
  onHistory: (entry: CareEntry) => void;
  onCloseEncounter: (encounter: CareEncounter) => void;
  onOpenContext: (event: ProjectedJourneyEvent) => void;
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
    ...projectedEvents.map((event) => ({
      id: event.id,
      date: event.date,
      type: "projected" as const,
      event,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="panel care-section patient-timeline">
      <SectionTitle
        title="Longitudinal clinical journey"
        subtitle="Generated automatically from visits, admissions and documented clinical events."
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
                      : event.type === "entry"
                        ? event.entry.title
                        : event.event.title}
                  </strong>
                  <small>
                    {event.type === "encounter"
                      ? `${event.encounter.kind} · ${event.encounter.owner}`
                      : event.type === "entry"
                        ? `${careKinds[event.entry.kind].label} · ${event.entry.owner}`
                        : event.event.subtitle}
                  </small>
                </span>
                <Badge>
                  {event.type === "encounter"
                    ? event.encounter.state
                    : event.type === "entry"
                      ? stateLabel(event.entry.status)
                      : "Recorded"}
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
                ) : event.type === "entry" ? (
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
                ) : (
                  <div className="projected-journey-detail">
                    <p>{event.event.detail}</p>
                    <button
                      className="text-button"
                      onClick={() => onOpenContext(event.event)}
                    >
                      Open {event.event.destination.toLowerCase()} details
                    </button>
                  </div>
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
