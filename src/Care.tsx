import { RegistryForms } from "./RegistryForms";
import { GuidedEditor } from "./GuidedEditor";
import { documentationAlerts } from "./clinical-review";
import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  CalendarDays,
  ClipboardList,
  HeartPulse,
  Download,
  History,
} from "lucide-react";
import { api, useData, date, currentDate } from "./api";
import { Badge, Empty, ErrorBox, Loading, Modal, SectionTitle } from "./ui";
import type { Patient, Role } from "./types";
import { PatientWorkspace } from "./Patients";
import {
  careKinds,
  families,
  finished,
  needsReview,
  stateLabel,
  type CareKind,
  type CareEntry,
  type CareEncounter,
} from "./care-model";

type CareData = {
  patient: Patient;
  entries: CareEntry[];
  encounters: CareEncounter[];
};
type BoardData = {
  entries: (CareEntry & { name: string; mrn: string })[];
  encounters: CareEncounter[];
};
const tabs = [
  "Overview",
  "Care plan",
  "Journey",
  "Results & medications",
  "Procedures",
  "Registries & reports",
];
function dueText(e: CareEntry) {
  if (e.due_date && finished.includes(e.status))
    return `Recorded review date · ${date(e.due_date)}`;
  return e.due_date
    ? `${e.due_date < currentDate() ? "Review overdue · " : "Review "}${date(e.due_date)}`
    : "No review date recorded";
}

export function CareBoard({
  view,
  role,
  revision,
  onOpen,
  onNew,
}: {
  view: string;
  role: Role;
  revision: number;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const { data, error } = useData<BoardData>("/care/board", revision);
  const [search, setSearch] = useState("");
  const title =
    view === "admissions" ? "Admissions" : view === "opd" ? "OPD" : "Today";
  const entries =
    data?.entries.filter((e) =>
      (e.title + e.name + e.owner).toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const encounters =
    data?.encounters.filter(
      (e) =>
        e.kind === (view === "opd" ? "OPD" : "Admission") &&
        (e.name + e.reason + e.owner)
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">CONTINUITY OF CARE</span>
          <h1>{title}</h1>
          <p>
            {title === "Today"
              ? "What needs a decision, who owns it, and what happens next."
              : "Open the same patient record across every encounter."}
          </p>
        </div>
        {role === "clinician" ? (
          <button className="primary" onClick={onNew}>
            <Plus size={17} />
            Register patient
          </button>
        ) : null}
      </div>
      <ErrorBox message={error} />
      {!data ? (
        !error ? (
          <Loading />
        ) : null
      ) : (
        <>
          <div className="care-metrics">
            <div>
              <HeartPulse />
              <strong>
                {
                  data.encounters.filter(
                    (e) => e.kind === "Admission" && e.state === "open",
                  ).length
                }
              </strong>
              <span>Active admissions</span>
            </div>
            <div>
              <CalendarDays />
              <strong>
                {
                  data.encounters.filter(
                    (e) => e.kind === "OPD" && e.state === "open",
                  ).length
                }
              </strong>
              <span>Open OPD visits</span>
            </div>
            <div>
              <ClipboardList />
              <strong>{data.entries.length}</strong>
              <span>Outstanding reviews</span>
            </div>
            <div>
              <History />
              <strong>
                {
                  data.entries.filter(
                    (e) => e.due_date && e.due_date < currentDate(),
                  ).length
                }
              </strong>
              <span>Review overdue / undocumented</span>
            </div>
          </div>
          <section className="panel care-section">
            <SectionTitle
              title={
                title === "Today"
                  ? "Continuing care worklist"
                  : `${title} encounters`
              }
              subtitle={
                title === "Today"
                  ? "Based on documented plans. An overdue item does not establish that care was missed."
                  : "Closed encounters retain their handover and ongoing patient plan."
              }
            />
            <label className="care-search">
              Search {title.toLowerCase()}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Patient, reason, or responsible clinician…"
              />
            </label>
            {title === "Today" ? (
              entries.length ? (
                entries.map((e) => (
                  <button
                    className="care-work-row"
                    key={e.id}
                    onClick={() => onOpen(e.patient_id)}
                  >
                    <span>
                      <strong>{e.title}</strong>
                      <small>
                        {e.name} · {e.mrn} · {careKinds[e.kind].label}
                      </small>
                    </span>
                    <span>
                      <Badge>{stateLabel(e.status)}</Badge>
                      <small>
                        {e.owner} · {dueText(e)}
                      </small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ))
              ) : (
                <Empty title="No outstanding reviews recorded">
                  Open a patient to record a decision, investigation, or
                  continuing plan.
                </Empty>
              )
            ) : encounters.length ? (
              encounters.map((e) => (
                <button
                  className="care-work-row"
                  key={e.id}
                  onClick={() => onOpen(e.patient_id)}
                >
                  <span>
                    <strong>{e.name}</strong>
                    <small>
                      {e.reason} · {e.mrn}
                    </small>
                  </span>
                  <span>
                    <Badge>{e.state}</Badge>
                    <small>
                      {date(e.started_on)} · {e.owner}
                    </small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))
            ) : (
              <Empty title={`No ${title} encounters recorded`}>
                Open a patient from Patients and choose Start encounter.
              </Empty>
            )}
          </section>
        </>
      )}
    </>
  );
}

export function CareWorkspace({
  owner,
  id,
  role,
  onBack,
  onSaved,
}: {
  id: string;
  owner: string;
  role: Role;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState("Overview"),
    [revision, setRevision] = useState(0);
  const [customEditor, setCustomEditor] = useState(false);
  const [editor, setEditor] = useState<CareKind | CareEntry | null>(null),
    [newEncounter, setNewEncounter] = useState(false),
    [closing, setClosing] = useState<CareEncounter | null>(null),
    [history, setHistory] = useState<CareEntry | null>(null);
  const [registry, setRegistry] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { data, error: loadError } = useData<CareData>(
    `/patients/${id}/care`,
    revision,
  );
  const { data: patient } = useData<Patient>(`/patients/${id}`, revision);
  function saved() {
    setEditor(null);
    setCustomEditor(false);
    setNewEncounter(false);
    setClosing(null);
    setRevision((v) => v + 1);
    onSaved();
  }
  async function enroll() {
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${id}/enroll`, { registry: "CAD" });
      saved();
      setRegistry(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <>
        <ErrorBox message={loadError} />
        {!loadError ? <Loading /> : null}
      </>
    );
  const { patient: p, entries, encounters } = data;
  const pending = entries.filter(needsReview);
  const active = entries.filter(
    (e) => e.kind === "problem" && e.status !== "resolved",
  );
  const groups: CareKind[] =
    tab === "Care plan"
      ? ["problem", "decision", "complication"]
      : tab === "Results & medications"
        ? ["investigation", "medication"]
        : ["procedure"];
  function addButton(kind: CareKind) {
    return role === "clinician" ? (
      <button
        className="secondary"
        key={kind}
        onClick={() => {
          setCustomEditor(false);
          setEditor(kind);
        }}
      >
        <Plus size={15} />
        {careKinds[kind].label}
      </button>
    ) : null;
  }
  function cards(list: CareEntry[]) {
    return list.length ? (
      <div className="care-cards">
        {list.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            encounter={encounters.find((c) => c.id === e.encounter_id)}
            onEdit={
              role === "clinician"
                ? () => {
                    setCustomEditor(!e.template_key);
                    setEditor(e);
                  }
                : undefined
            }
            onHistory={() => setHistory(e)}
          />
        ))}
      </div>
    ) : (
      <Empty title="No records in this section">
        Document a dated clinical event or plan using the actions above.
      </Empty>
    );
  }
  return (
    <>
      <button className="text-button back" onClick={onBack}>
        <ArrowLeft size={16} />
        All patients
      </button>
      <div className="patient-heading">
        <div className="avatar large">
          {p.name
            .split(" ")
            .slice(0, 2)
            .map((n) => n[0])
            .join("")}
        </div>
        <div>
          <span className="eyebrow">ONE CONTINUOUS PATIENT RECORD</span>
          <h1>{p.name}</h1>
          <p>
            {p.mrn} · {p.sex} · Born {date(p.birth_date)}
          </p>
        </div>
        {role === "clinician" ? (
          <button className="primary" onClick={() => setNewEncounter(true)}>
            <Plus size={17} />
            Start encounter
          </button>
        ) : null}
      </div>
      <div className="patient-strip">
        <span>
          {encounters.filter((e) => e.state === "open").length} open encounters
        </span>
        <span>{pending.length} outstanding reviews</span>
        <span>
          {patient?.enrollment_id
            ? "CAD registry selected"
            : "Care record · registry enrollment optional"}
        </span>
      </div>
      <div className="care-tabs" role="tablist" aria-label="Patient workspace">
        {tabs.map((t) => (
          <button
            role="tab"
            key={t}
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setRegistry(false);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <ErrorBox message={error || loadError} />
      {documentationAlerts(entries, currentDate()).length ? (
        <details className="patient-alerts">
          <summary>
            {documentationAlerts(entries, currentDate()).length} review
            reminders
          </summary>
          <div className="alert-grid">
            {documentationAlerts(entries, currentDate()).map((a) => (
              <div key={a.id}>
                <strong>{a.title}</strong>
                <p>{a.detail}</p>
                {role === "clinician" ? (
                  <button
                    className="text-button"
                    onClick={() => {
                      setCustomEditor(!a.entry.template_key);
                      setEditor(a.entry);
                    }}
                  >
                    Open review
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <small>
            Documentation and follow-up reminders; not real-time physiological
            monitoring.
          </small>
        </details>
      ) : null}
      <div role="tabpanel" aria-label={tab}>
        {tab === "Overview" ? (
          <>
            <div className="care-overview">
              <section className="panel care-section">
                <SectionTitle
                  title="Current clinical situation"
                  subtitle="Clinician-documented problems; suspected conditions remain provisional."
                />
                {active.length ? (
                  <div className="problem-list">
                    {active.map((e) => (
                      <div key={e.id}>
                        <Badge tone="cad">{e.family}</Badge>
                        <strong>{e.title}</strong>
                        <Badge>{e.status}</Badge>
                        <p>
                          {e.assessment ||
                            e.details.evidence ||
                            "Assessment not yet documented"}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No active problems documented.</p>
                )}
                <div className="care-actions">{addButton("problem")}</div>
              </section>
              <section className="panel care-section">
                <SectionTitle
                  title="Next steps"
                  subtitle="The continuing plan stays with this patient after discharge."
                />
                {pending.slice(0, 4).map((e) => (
                  <button
                    className="next-step"
                    key={e.id}
                    onClick={() =>
                      setTab(
                        e.kind === "investigation" || e.kind === "medication"
                          ? "Results & medications"
                          : e.kind === "procedure"
                            ? "Procedures"
                            : "Care plan",
                      )
                    }
                  >
                    <strong>{e.title}</strong>
                    <small>
                      {e.owner} · {dueText(e)}
                    </small>
                  </button>
                ))}
                {!pending.length ? (
                  <p className="muted">No outstanding actions recorded.</p>
                ) : null}
                <div className="care-actions">{addButton("decision")}</div>
              </section>
            </div>
            <section className="panel care-section">
              <SectionTitle
                title="Recent encounters"
                action="View journey"
                onAction={() => setTab("Journey")}
              />
              {encounters.slice(0, 3).map((e) => (
                <EncounterCard
                  key={e.id}
                  encounter={e}
                  linked={encounters.find(
                    (c) => c.id === e.linked_encounter_id,
                  )}
                  onClose={
                    role === "clinician" && e.state === "open"
                      ? () => setClosing(e)
                      : undefined
                  }
                />
              ))}
              {!encounters.length ? (
                <Empty title="Start the patient's journey">
                  Care can begin in OPD or an admission; registry-only
                  documentation is also available.
                </Empty>
              ) : null}
            </section>
          </>
        ) : tab === "Journey" ? (
          <section className="panel care-section">
            <SectionTitle
              title="Connected encounters"
              subtitle="Links are selected by the clinician. Every event retains its origin and date."
            />
            {encounters.map((e) => (
              <div key={e.id} className="journey-block">
                <EncounterCard
                  encounter={e}
                  linked={encounters.find(
                    (c) => c.id === e.linked_encounter_id,
                  )}
                  onClose={
                    role === "clinician" && e.state === "open"
                      ? () => setClosing(e)
                      : undefined
                  }
                />
                {entries
                  .filter((item) => item.encounter_id === e.id)
                  .map((item) => (
                    <div className="journey-event" key={item.id}>
                      <span>{date(item.occurred_on)}</span>
                      <strong>{item.title}</strong>
                      <Badge>{stateLabel(item.status)}</Badge>
                    </div>
                  ))}
              </div>
            ))}
            {entries.some((e) => !e.encounter_id) ? (
              <>
                <h3>Longitudinal records</h3>
                {cards(entries.filter((e) => !e.encounter_id))}
              </>
            ) : null}
            {!encounters.length && !entries.length ? (
              <Empty title="No events recorded" />
            ) : null}
          </section>
        ) : tab === "Registries & reports" ? (
          <>
            <section className="panel care-section">
              <SectionTitle
                title="Patient report"
                subtitle="Review the recorded plan, history, and outstanding actions before sharing."
              />
              <button
                className="secondary"
                onClick={() => downloadReport(data)}
              >
                <Download size={17} />
                Download patient report
              </button>
              <p className="muted">
                Downloads a printable HTML report. Open it and use Print → Save
                as PDF.
              </p>
            </section>
            <section className="panel care-section">
              <SectionTitle
                title="Selected registry assessments"
                subtitle="Clinical care and procedure records remain available without enrollment."
              />
              {patient?.enrollment_id ? (
                <>
                  <Badge tone="cad">CAD · enrolled</Badge>
                  <p>
                    Open the versioned CAD assessment, lesions, stents,
                    discharge and registry follow-up.
                  </p>
                  <button
                    className="secondary"
                    onClick={() => setRegistry((v) => !v)}
                  >
                    {registry ? "Close CAD assessment" : "Open CAD assessment"}
                  </button>
                </>
              ) : (
                <>
                  <p>No registry selected for this patient.</p>
                  {role === "clinician" ? (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={enroll}
                    >
                      Enroll in CAD registry
                    </button>
                  ) : null}
                </>
              )}
              <p className="muted">
                Source-derived HF, CAD and EP drafts are available below.
                Structural Heart and custom registry publication remain under
                implementation.
              </p>
            </section>
            <RegistryForms patient={p} encounters={encounters} role={role} />
            {registry && patient?.enrollment_id ? (
              <PatientWorkspace
                key={revision}
                id={id}
                role={role}
                onBack={() => setRegistry(false)}
                onSaved={onSaved}
                embedded
              />
            ) : null}
          </>
        ) : (
          <>
            <div className="care-actions">{groups.map(addButton)}</div>
            {groups.map((kind) => (
              <section className="panel care-section" key={kind}>
                <SectionTitle
                  title={careKinds[kind].label}
                  subtitle={
                    kind === "procedure"
                      ? "Clinical and technical documentation independent of registry participation."
                      : kind === "investigation"
                        ? "Ordering → collection → result → interpretation → action and reassessment."
                        : kind === "complication"
                          ? "Recognition → assessment → management → response → recovery."
                          : undefined
                  }
                />
                {cards(entries.filter((e) => e.kind === kind))}
              </section>
            ))}
          </>
        )}
      </div>
      {editor &&
      !customEditor &&
      (typeof editor === "string" || editor.template_key) ? (
        <GuidedEditor
          key={typeof editor === "string" ? editor : editor.id}
          patient={p}
          encounters={encounters}
          entries={entries}
          owner={owner}
          original={typeof editor === "string" ? undefined : editor}
          kind={typeof editor === "string" ? editor : editor.kind}
          onClose={() => setEditor(null)}
          onSaved={saved}
          onCustom={() => setCustomEditor(true)}
        />
      ) : editor ? (
        <EntryEditor
          key={typeof editor === "string" ? editor : editor.id}
          patient={p}
          encounters={encounters}
          original={typeof editor === "string" ? undefined : editor}
          kind={typeof editor === "string" ? editor : editor.kind}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      ) : null}
      {newEncounter ? (
        <EncounterEditor
          patient={p}
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
    </>
  );
}
function EntryCard({
  entry: e,
  encounter,
  onEdit,
  onHistory,
}: {
  entry: CareEntry;
  encounter?: CareEncounter;
  onEdit?: () => void;
  onHistory: () => void;
}) {
  return (
    <article className="care-card">
      <div className="care-card-head">
        <Badge tone="cad">{e.family}</Badge>
        <Badge>{stateLabel(e.status)}</Badge>
      </div>
      <h3>{e.title}</h3>
      <p className="care-provenance">
        {date(e.occurred_on)} ·{" "}
        {encounter
          ? `${encounter.kind} ${date(encounter.started_on)}`
          : "Continuing plan"}
      </p>
      {e.structured?._reference ? (
        <details className="clinical-preview">
          <summary>Saved reference assessment · draft</summary>
          <SavedReference value={String(e.structured._reference)} />
        </details>
      ) : null}
      {e.assessment ? (
        <p>
          <strong>Assessment</strong> {e.assessment}
        </p>
      ) : null}
      {e.action ? (
        <p>
          <strong>Decision / action</strong> {e.action}
        </p>
      ) : null}
      {e.response ? (
        <p>
          <strong>Response / next plan</strong> {e.response}
        </p>
      ) : null}
      {Object.entries(e.details).some(([, v]) => v) ? (
        <details>
          <summary>Clinical details</summary>
          <dl>
            {Object.entries(e.details)
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>
                    {(careKinds[e.kind].fields as Record<string, string>)[k]}
                  </dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </details>
      ) : null}
      <div className="care-owner">
        <span>
          Responsible: <strong>{e.owner}</strong>
        </span>
        {e.due_date ? <span>{dueText(e)}</span> : null}
      </div>
      <small className="muted">
        Updated {new Date(e.updated_at).toLocaleString("en-GB")} · v{e.version}
      </small>
      <div className="care-actions">
        {onEdit ? (
          <button className="secondary" onClick={onEdit}>
            Review / update
          </button>
        ) : null}
        <button className="text-button" onClick={onHistory}>
          <History size={14} />
          History
        </button>
      </div>
    </article>
  );
}
function EncounterCard({
  encounter: e,
  linked,
  onClose,
}: {
  encounter: CareEncounter;
  linked?: CareEncounter;
  onClose?: () => void;
}) {
  return (
    <article className="encounter-card">
      <div>
        <Badge tone="cad">{e.kind}</Badge> <Badge>{e.state}</Badge>
        <h3>{e.reason}</h3>
        <p>
          {date(e.started_on)}
          {e.closed_on ? ` → ${date(e.closed_on)}` : " · ongoing"} · {e.owner}
        </p>
        {linked ? (
          <small>
            Connected to {linked.kind} on {date(linked.started_on)} —{" "}
            {linked.reason}
          </small>
        ) : null}
        {e.summary ? (
          <p className="handover">
            <strong>Handover</strong> {e.summary}
          </p>
        ) : null}
      </div>
      {onClose ? (
        <button className="secondary" onClick={onClose}>
          {e.kind === "Admission"
            ? "Discharge / handover"
            : "Close visit / handover"}
        </button>
      ) : null}
    </article>
  );
}
function EntryEditor({
  patient,
  encounters,
  original,
  kind,
  onClose,
  onSaved,
}: {
  patient: Patient;
  encounters: CareEncounter[];
  original?: CareEntry;
  kind: CareKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(
      original?.status ?? careKinds[kind].states[0],
    );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<
      string,
      string
    >;
    const details = Object.fromEntries(
      Object.keys(careKinds[kind].fields).map((k) => [
        k,
        f[`detail_${k}`] || "",
      ]),
    );
    const body = {
      kind,
      family: f.family,
      title: f.title,
      status,
      occurred_on: original?.occurred_on ?? f.occurred_on,
      encounter_id: original?.encounter_id ?? (f.encounter_id || null),
      owner: f.owner,
      due_date: f.due_date || null,
      assessment: f.assessment,
      action: f.action,
      response: f.response,
      details,
      ...(original ? { version: original.version } : {}),
    };
    try {
      await api(
        original
          ? `/care/entries/${original.id}`
          : `/patients/${patient.id}/care/entries`,
        body,
        original ? "PUT" : "POST",
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={`${original ? "Review" : "Add"} ${careKinds[kind].label.toLowerCase()}`}
      onClose={onClose}
    >
      <p className="modal-intro">
        Record the clinician's assessment and plan. Previous versions are
        retained; no treatment is chosen automatically.
      </p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="span-2">
            Title
            <input
              name="title"
              required
              minLength={2}
              maxLength={300}
              defaultValue={original?.title}
            />
          </label>
          <label>
            Clinical family
            <select name="family" defaultValue={original?.family ?? "General"}>
              {families.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {careKinds[kind].states.map((s) => (
                <option value={s} key={s}>
                  {stateLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Event date
            <input
              name="occurred_on"
              type="date"
              required
              min={patient.birth_date}
              max={currentDate()}
              defaultValue={original?.occurred_on ?? currentDate()}
              readOnly={!!original}
            />
          </label>
          <label>
            Origin encounter
            <select
              name="encounter_id"
              defaultValue={original?.encounter_id ?? ""}
              disabled={!!original}
            >
              <option value="">Continuing plan / no encounter</option>
              {encounters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kind} · {date(c.started_on)} · {c.reason}
                </option>
              ))}
            </select>
          </label>
          <label>
            Responsible clinician / team
            <input
              name="owner"
              required
              minLength={2}
              maxLength={300}
              defaultValue={original?.owner}
            />
          </label>
          <label>
            Review date
            <input
              name="due_date"
              type="date"
              defaultValue={original?.due_date ?? ""}
              required={
                needsReview({ kind, status, due_date: null }) ||
                (kind === "medication" && status === "held")
              }
            />
          </label>
          <label className="span-2">
            Assessment
            <textarea
              name="assessment"
              maxLength={6000}
              defaultValue={original?.assessment}
              rows={3}
            />
          </label>
          {Object.entries(careKinds[kind].fields).map(([key, label]) => (
            <label key={key} className="span-2">
              {label}
              <textarea
                name={`detail_${key}`}
                maxLength={6000}
                rows={2}
                defaultValue={original?.details[key]}
              />
            </label>
          ))}
          <label className="span-2">
            Decision / action and reason
            <textarea
              name="action"
              maxLength={6000}
              rows={3}
              defaultValue={original?.action}
            />
          </label>
          <label className="span-2">
            Response / next plan
            <textarea
              name="response"
              maxLength={6000}
              rows={3}
              defaultValue={original?.response}
            />
          </label>
        </div>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save care record"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function EncounterEditor({
  patient,
  encounters,
  onClose,
  onSaved,
}: {
  patient: Patient;
  encounters: CareEncounter[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(`/patients/${patient.id}/care/encounters`, {
        ...f,
        linked_encounter_id: f.linked_encounter_id || null,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Start encounter" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Care setting
            <select name="kind">
              <option>OPD</option>
              <option>Admission</option>
            </select>
          </label>
          <label>
            Start date
            <input
              type="date"
              name="started_on"
              required
              min={patient.birth_date}
              max={currentDate()}
              defaultValue={currentDate()}
            />
          </label>
          <label className="span-2">
            Reason for encounter
            <input name="reason" required minLength={2} maxLength={300} />
          </label>
          <label className="span-2">
            Responsible clinician / team
            <input name="owner" required minLength={2} maxLength={300} />
          </label>
          <label className="span-2">
            Connect to previous encounter
            <select name="linked_encounter_id">
              <option value="">No connection selected</option>
              {encounters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kind} · {date(c.started_on)} · {c.reason}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button className="primary" disabled={busy}>
            Open encounter
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CloseEncounter({
  patientId,
  encounter,
  pending,
  onClose,
  onSaved,
}: {
  patientId: string;
  encounter: CareEncounter;
  pending: CareEntry[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        `/patients/${patientId}/care/encounters/${encounter.id}/close`,
        {
          ...Object.fromEntries(new FormData(e.currentTarget)),
          version: encounter.version,
        },
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title="Close encounter and hand over" onClose={onClose}>
      <p>
        {pending.length} outstanding patient reviews will remain active after
        this encounter closes.
      </p>
      <ul className="handover-list">
        {pending.map((e) => (
          <li key={e.id}>
            <strong>{e.title}</strong> — {e.owner} · {dueText(e)}
          </li>
        ))}
      </ul>
      <form onSubmit={submit}>
        <label>
          Closure date
          <input
            name="closed_on"
            type="date"
            required
            min={encounter.started_on}
            max={currentDate()}
            defaultValue={currentDate()}
          />
        </label>
        <label>
          Handover summary
          <textarea
            name="summary"
            required
            minLength={10}
            maxLength={6000}
            rows={5}
            placeholder="Document the transition, continuing plan, and follow-up responsibilities."
          />
        </label>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button className="primary" disabled={busy}>
            Close encounter; retain care plan
          </button>
        </div>
      </form>
    </Modal>
  );
}
function EntryHistory({
  entry,
  onClose,
}: {
  entry: CareEntry;
  onClose: () => void;
}) {
  const { data, error } = useData<
    { version: number; actor: string; created_at: string; payload: CareEntry }[]
  >(`/care/entries/${entry.id}/history`);
  return (
    <Modal wide title={`History · ${entry.title}`} onClose={onClose}>
      <ErrorBox message={error} />
      {data ? (
        data.map((h) => (
          <div className="history-item" key={h.version}>
            <strong>
              Version {h.version} · {stateLabel(h.payload.status)}
            </strong>
            <p>
              {new Date(h.created_at).toLocaleString("en-GB")} · {h.actor}
            </p>
            <p>Assessment: {h.payload.assessment || "Not recorded"}</p>
            <p>Action: {h.payload.action || "Not recorded"}</p>
            <p>Response: {h.payload.response || "Not recorded"}</p>
            <p>
              Owner: {h.payload.owner} · Review:{" "}
              {h.payload.due_date ? date(h.payload.due_date) : "Not recorded"}
            </p>
            <details>
              <summary>Full saved record</summary>
              <pre>{JSON.stringify(h.payload, null, 2)}</pre>
            </details>
          </div>
        ))
      ) : !error ? (
        <Loading />
      ) : null}
    </Modal>
  );
}
function downloadReport(data: CareData) {
  const escape = (s: unknown) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const { patient: p, entries, encounters } = data;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Cardio Flow · Patient report</title><style>body{font:15px/1.6 system-ui;max-width:850px;margin:36px auto;color:#183c34;padding:20px}h1,h2{line-height:1.2}article{border-top:1px solid #bbc8c3;padding:18px 0;break-inside:avoid}p{white-space:pre-wrap}small{color:#51675f}@media print{body{margin:0}}</style><h1>Cardio Flow · Patient report</h1><p>Synthetic data · Clinician-entered record · Generated ${escape(new Date().toISOString())}</p><h2>${escape(p.name)}</h2><p>${escape(p.mrn)} · ${escape(p.sex)} · Born ${escape(p.birth_date)}</p><h2>Outstanding actions</h2>${
    entries
      .filter(needsReview)
      .map(
        (e) =>
          `<article><b>${escape(e.title)}</b><p>${escape(e.owner)} · Review ${escape(e.due_date)} · ${escape(stateLabel(e.status))}</p><p>${escape(e.action)}</p></article>`,
      )
      .join("") || "<p>None recorded.</p>"
  }<h2>Journey and handovers</h2>${encounters.map((e) => `<article><b>${escape(e.kind)} · ${escape(e.started_on)} · ${escape(e.state)}</b><p>${escape(e.reason)} · ${escape(e.owner)}</p><p>${escape(e.summary)}</p></article>`).join("")}<h2>Dated clinical records</h2>${entries
    .map(
      (e) =>
        `<article><h3>${escape(e.title)}</h3><small>${escape(e.kind)} · ${escape(e.family)} · ${escape(e.status)} · Event ${escape(e.occurred_on)} · Version ${e.version}</small><p>Assessment: ${escape(e.assessment)}</p>${Object.entries(
          e.details,
        )
          .filter(([, v]) => v)
          .map(
            ([k, v]) =>
              `<p>${escape((careKinds[e.kind].fields as Record<string, string>)[k])}: ${escape(v)}</p>`,
          )
          .join(
            "",
          )}<p>Action: ${escape(e.action)}</p><p>Response: ${escape(e.response)}</p><p>Owner: ${escape(e.owner)} · Review: ${escape(e.due_date || "Not recorded")}</p><small>Origin encounter: ${escape(e.encounter_id || "Continuing plan")} · Updated ${escape(e.updated_at)}</small></article>`,
    )
    .join(
      "",
    )}<p>Report scope: continuous-care documentation. Separate CAD registry assessments are not included in this report.</p></html>`;
  const url = URL.createObjectURL(
    new Blob([html], { type: "text/html;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `cardio-flow-${p.mrn}-report.html`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SavedReference({ value }: { value: string }) {
  try {
    const r = JSON.parse(value);
    return (
      <>
        <p>
          <strong>{r.title}</strong> · {r.assessedOn}
        </p>
        <p>
          {r.points !== undefined
            ? `${r.points} / 6 points`
            : r.reference || "Incomplete — no result"}
        </p>
        {r.reasons?.length ? (
          <ul>
            {r.reasons.map((s: string) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : (
          <p>{r.factors?.join(" · ") || "No listed criteria present"}</p>
        )}
        <small>
          {r.ruleVersion} · synthetic preview; clinical approval pending
        </small>
      </>
    );
  } catch {
    return <p>Reference unavailable.</p>;
  }
}
