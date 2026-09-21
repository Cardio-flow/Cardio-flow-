import { useState, type FormEvent } from "react";
import { api, useData, date, download } from "./api";
import { Badge, Modal, ErrorBox, Loading } from "./ui";
import { DynamicFields } from "./GuidedEditor";
import {
  registryVisible,
  cleanRegistry,
  type RegistryPackage,
  type RegistryAssessment,
} from "./registry-forms";
import type { Answers, Field } from "./guided";
import type { CareEncounter } from "./care-model";
import type { Patient, Role } from "./types";
const contextName = (s: string) =>
  ({
    "patient document / index admission": "Index admission",
    "patient document / index admission medication":
      "Index admission · medication detail",
    "visits subcollection": "Follow-up visit",
    "visits subcollection medication": "Follow-up · medication detail",
    "Extra_Admissions JSON array": "Additional admission",
    index: "Index assessment",
    followups: "Follow-up assessment",
    lesions: "Lesion assessment",
    "fixed follow-up block": "Scheduled follow-up",
  })[s] ?? s;
export function RegistryForms({
  patient,
  encounters,
  role,
}: {
  patient: Patient;
  encounters: CareEncounter[];
  role: Role;
}) {
  const [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<{
      pkg: RegistryPackage;
      original?: RegistryAssessment;
    } | null>(null),
    [history, setHistory] = useState<RegistryAssessment | null>(null);
  const { data: packages, error: packageError } =
    useData<RegistryPackage[]>("/registry-forms");
  const { data: assessments, error } = useData<RegistryAssessment[]>(
    `/patients/${patient.id}/registry-forms`,
    revision,
  );
  return (
    <section className="panel care-section">
      <span className="eyebrow">RECOVERED SPECIALIST FORMS</span>
      <h2>HF, CAD & EP assessments</h2>
      <p className="muted">
        Source-derived drafts with reusable patient identity, branching fields
        and revision history. These supplement the finalized CAD workflow;
        specialist validation and full workflow parity remain in progress.
      </p>
      <ErrorBox message={error || packageError} />
      {!packages && !packageError ? <Loading /> : null}
      <div className="registry-package-grid">
        {packages?.map((p) => (
          <article key={`${p.key}-${p.version}`}>
            <div className="care-card-head">
              <h3>{p.key}</h3>
              <Badge>Source draft · v{p.version}</Badge>
            </div>
            <p>
              {p.fields.filter((f) => !f.blocked).length} editable source fields
              across {new Set(p.fields.map((f) => f.context)).size} contexts
            </p>
            <small>
              {p.fields.filter((f) => f.blocked).length} legacy controls await
              review. Identity is shared with this patient.
            </small>
            {role === "clinician" ? (
              <button
                className="secondary"
                onClick={() => setEditor({ pkg: p })}
              >
                New {p.key} assessment
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {assessments?.length ? (
        <div className="registry-assessment-list">
          {assessments.map((a) => {
            const pkg = packages?.find(
              (p) =>
                p.key === a.registry_key && p.version === a.package_version,
            );
            return (
              <article key={a.id}>
                <div>
                  <strong>
                    {a.registry_key} · {contextName(a.context)}
                  </strong>
                  <p>
                    {Object.keys(a.answers).length} answers · draft v{a.version}{" "}
                    · {date(a.updated_at)}
                  </p>
                </div>
                <div className="care-actions">
                  {pkg ? (
                    <button
                      className="secondary"
                      onClick={() => setEditor({ pkg, original: a })}
                    >
                      {role === "clinician" ? "Open draft" : "View draft"}
                    </button>
                  ) : null}
                  <button className="text-button" onClick={() => setHistory(a)}>
                    Revision history
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      const rows = [
                        [
                          "Registry",
                          "Assessment",
                          "Version",
                          "Field",
                          "Label",
                          "Value",
                        ],
                        ...Object.entries(a.answers).map(([k, v]) => [
                          a.registry_key,
                          a.id,
                          String(a.version),
                          k,
                          pkg?.fields.find((f) => f.key === k)?.label ?? k,
                          Array.isArray(v) ? v.join("; ") : String(v),
                        ]),
                      ];
                      download(
                        rows
                          .map((row) =>
                            row
                              .map(
                                (v) =>
                                  '"' +
                                  (/^[=+\-@\t\r]/.test(v) ? "'" : "") +
                                  v.replaceAll('"', '""') +
                                  '"',
                              )
                              .join(","),
                          )
                          .join("\n"),
                        `${a.registry_key}-draft-${a.id}.csv`,
                      );
                    }}
                  >
                    Export draft
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="muted">
          Choose a registry and assessment context to begin. Creating a draft
          does not finalize or certify a registry submission.
        </p>
      )}
      {editor ? (
        <RegistryEditor
          key={editor.original?.id ?? editor.pkg.key}
          patient={patient}
          encounters={encounters}
          pkg={editor.pkg}
          original={editor.original}
          readOnly={role !== "clinician"}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setRevision((v) => v + 1);
          }}
        />
      ) : null}
      {history ? (
        <RegistryHistory
          patient={patient.id}
          assessment={history}
          onClose={() => setHistory(null)}
        />
      ) : null}
    </section>
  );
}
function RegistryEditor({
  patient,
  encounters,
  pkg,
  original,
  readOnly,
  onClose,
  onSaved,
}: {
  patient: Patient;
  encounters: CareEncounter[];
  pkg: RegistryPackage;
  original?: RegistryAssessment;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const contexts = [...new Set(pkg.fields.map((f) => f.context))];
  const [context, setContext] = useState(original?.context ?? contexts[0]),
    [encounter, setEncounter] = useState(original?.encounter_id ?? ""),
    [answers, setAnswers] = useState<Answers>(original?.answers ?? {}),
    [section, setSection] = useState(""),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const visible = registryVisible(pkg, answers, context),
    sections = [...new Set(visible.map((f) => f.section))];
  const selected = sections.includes(section) ? section : sections[0];
  const displayed = visible.filter((f) =>
    search
      ? `${f.label} ${f.group} ${f.section} ${f.sourceKey}`
          .toLowerCase()
          .includes(search.toLowerCase())
      : f.section === selected,
  );
  const groups = [
    ...new Set(displayed.map((f) => `${f.section} / ${f.group || "Fields"}`)),
  ];
  const unanswered = visible.filter(
    (f) =>
      f.sourceRequired &&
      (answers[f.key] === undefined || answers[f.key] === ""),
  ).length;
  function change(key: string, value: Answers[string]) {
    setAnswers((old) => cleanRegistry(pkg, { ...old, [key]: value }, context));
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        `/patients/${patient.id}/registry-forms${original ? `/${original.id}` : ""}`,
        {
          registry_key: pkg.key,
          package_version: pkg.version,
          context,
          encounter_id: encounter || null,
          answers: cleanRegistry(pkg, answers, context),
          ...(original ? { version: original.version } : {}),
        },
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
    <Modal wide title={`${pkg.key} registry · source draft`} onClose={onClose}>
      <p className="modal-intro">
        {patient.name} · {patient.mrn} · {patient.sex} · born{" "}
        {date(patient.birth_date)}. Patient identity is reused from the shared
        record.
      </p>
      <form onSubmit={save}>
        <ErrorBox message={error} />
        <div className="form-grid">
          <label>
            Assessment context
            <select
              disabled={!!original || readOnly}
              value={context}
              onChange={(e) => {
                setContext(e.target.value);
                setSection("");
                setAnswers({});
                setSearch("");
              }}
            >
              {contexts.map((c) => (
                <option key={c} value={c}>
                  {contextName(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Linked encounter
            <select
              disabled={!!original || readOnly}
              value={encounter}
              onChange={(e) => setEncounter(e.target.value)}
            >
              <option value="">Continuing record</option>
              {encounters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.kind} · {date(c.started_on)} · {c.reason}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="registry-progress">
          <strong>
            {Object.keys(cleanRegistry(pkg, answers, context)).length} recorded
          </strong>
          <span>{visible.length} currently applicable fields</span>
          <span>{unanswered} source-required fields unanswered</span>
        </div>
        <label>
          Find a registry field
          <input
            placeholder="Search symptoms, medications, procedures…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="registry-layout">
          <nav aria-label="Registry sections">
            {sections.map((s) => (
              <button
                type="button"
                className={!search && s === selected ? "selected" : ""}
                key={s}
                onClick={() => {
                  setSection(s);
                  setSearch("");
                }}
              >
                {s}
                <small>
                  {
                    visible.filter(
                      (f) => f.section === s && answers[f.key] !== undefined,
                    ).length
                  }
                  /{visible.filter((f) => f.section === s).length}
                </small>
              </button>
            ))}
          </nav>
          <div className="registry-fields">
            <fieldset disabled={readOnly} className="registry-inputs">
              {groups.map((group) => (
                <section key={group}>
                  <h3>{group}</h3>
                  {displayed
                    .filter(
                      (f) => `${f.section} / ${f.group || "Fields"}` === group,
                    )
                    .map((f) => (
                      <div className="registry-source-field" key={f.key}>
                        {["date", "datetime-local", "time"].includes(f.type) ? (
                          <label htmlFor={f.key}>
                            {f.label}
                            <input
                              id={f.key}
                              type={f.type}
                              value={String(answers[f.key] ?? "")}
                              onChange={(e) => change(f.key, e.target.value)}
                            />
                          </label>
                        ) : (
                          <DynamicFields
                            prefix="registry"
                            fields={[
                              {
                                key: f.key,
                                label: f.label,
                                type: f.type as Field["type"],
                                options: f.options,
                                unit: f.unit,
                              },
                            ]}
                            answers={answers}
                            onChange={change}
                          />
                        )}
                        <small>
                          {f.key}
                          {f.sourceRequired
                            ? " · required in original form"
                            : ""}
                        </small>
                      </div>
                    ))}
                </section>
              ))}
            </fieldset>
            {!displayed.length ? <p>No matching applicable fields.</p> : null}
          </div>
        </div>
        <details className="guided-notes">
          <summary>Source coverage & inactive controls</summary>
          <p>
            Recovered from {pkg.sourceSnapshot}. Original calculated rules,
            image uploads and unresolved controls are not activated by this
            draft.
          </p>
          {pkg.fields
            .filter((f) => f.context === context && f.blocked)
            .map((f) => (
              <p key={f.key}>
                <strong>{f.label}</strong> — {f.blocked}
              </p>
            ))}
        </details>
        <div className="modal-actions">
          <span className="muted">
            Partial drafts are allowed; unknown answers stay blank.
          </span>
          {!readOnly ? (
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save registry draft"}
            </button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
function RegistryHistory({
  patient,
  assessment,
  onClose,
}: {
  patient: string;
  assessment: RegistryAssessment;
  onClose: () => void;
}) {
  const { data, error } = useData<
    {
      version: number;
      actor: string;
      created_at: string;
      payload: RegistryAssessment;
    }[]
  >(`/patients/${patient}/registry-forms/${assessment.id}/history`);
  return (
    <Modal wide title="Registry revision history" onClose={onClose}>
      <ErrorBox message={error} />
      {data?.map((r) => (
        <details className="guided-notes" key={r.version}>
          <summary>
            Version {r.version} ·{" "}
            {new Date(r.created_at).toLocaleString("en-GB")} · {r.actor}
          </summary>
          <p>{Object.keys(r.payload.answers).length} recorded answers</p>
          <pre className="registry-history-json">
            {JSON.stringify(r.payload.answers, null, 2)}
          </pre>
        </details>
      ))}
    </Modal>
  );
}
