import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { api, useData, date, download } from "./api";
import { Badge, Modal, ErrorBox, Loading } from "./ui";
import { DynamicFields } from "./GuidedEditor";
import {
  registryVisible,
  cleanRegistry,
  type RegistryPackage,
  type RegistryAssessment,
} from "./registry-forms";
import type { Answer, Answers, Field } from "./guided";
import type { CareEncounter, CareEntry } from "./care-model";
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

const hasAnswer = (value: Answer | undefined) =>
  value !== undefined &&
  value !== "" &&
  (!Array.isArray(value) || value.length > 0);

function registryStats(pkg: RegistryPackage, assessment?: RegistryAssessment) {
  const context =
    assessment?.context ??
    [...new Set(pkg.fields.map((field) => field.context))][0];
  const answers = assessment?.answers ?? {};
  const visible = registryVisible(pkg, answers, context).filter(
    (field) => !field.blocked,
  );
  const required = visible.filter((field) => field.sourceRequired);
  const completed = required.filter((field) =>
    hasAnswer(answers[field.key]),
  ).length;
  const common = visible.filter(isCommonField);
  const denominator = required.length || common.length;
  const numerator = required.length
    ? completed
    : common.filter((field) => hasAnswer(answers[field.key])).length;
  return {
    percent: denominator ? Math.round((numerator / denominator) * 100) : 0,
    required: required.length,
    completed,
    missing: required.length - completed,
  };
}

function registryPrefill(
  pkg: RegistryPackage,
  context: string,
  entries: CareEntry[],
) {
  const answers: Answers = {};
  const newest = [...entries].sort((a, b) =>
    b.occurred_on.localeCompare(a.occurred_on),
  );
  const structured = (key: string) =>
    newest.find((entry) => hasAnswer(entry.structured?.[key]))?.structured?.[
      key
    ];
  const activeProblem = (text: RegExp) =>
    newest.some(
      (entry) =>
        entry.kind === "problem" &&
        entry.status !== "resolved" &&
        text.test(entry.title.toLowerCase()),
    );
  const pci = newest.find(
    (entry) =>
      entry.kind === "procedure" &&
      /\bpci\b|percutaneous coronary/i.test(entry.title) &&
      ["performed", "reviewed"].includes(entry.status),
  );
  const facts: Record<string, Answer | undefined> = {
    presentation: structured("presentation"),
    lvef: structured("lvef"),
    creatinine:
      structured("creatinine_unit") === "µmol/L"
        ? structured("creatinine")
        : undefined,
    diabetes: activeProblem(/diabet/) ? "Yes" : undefined,
    hypertension: activeProblem(/hypertension/) ? "Yes" : undefined,
    atrial_fibrillation: activeProblem(/atrial fibrillation|\baf\b/)
      ? "Yes"
      : undefined,
    pci_done: pci ? "Yes" : undefined,
    pci_date: pci?.occurred_on,
  };
  pkg.fields
    .filter((field) => field.context === context && !field.blocked)
    .forEach((field) => {
      const source = field.sourceKey.toLowerCase();
      let fact: Answer | undefined;
      if (source === "presentation_type") fact = facts.presentation;
      else if (/lvef/.test(source)) fact = facts.lvef;
      else if (/creat/.test(source) && !/ratio|clearance|crcl/.test(source))
        fact = facts.creatinine;
      else if (/diabetes|hx_dm/.test(source)) fact = facts.diabetes;
      else if (/hypertension|hx_htn/.test(source)) fact = facts.hypertension;
      else if (/atrial_fibrillation|hx_afib/.test(source))
        fact = facts.atrial_fibrillation;
      else if (/pci.*done/.test(source)) fact = facts.pci_done;
      else if (/pci.*date/.test(source)) fact = facts.pci_date;
      if (fact === undefined || !hasAnswer(fact)) return;
      if (field.options?.length && !field.options.includes(String(fact)))
        return;
      if (field.type === "multi") {
        if (Array.isArray(fact)) answers[field.key] = fact;
      } else if (field.type === "number") {
        const numeric = typeof fact === "number" ? fact : Number(fact);
        if (Number.isFinite(numeric)) answers[field.key] = numeric;
      } else {
        answers[field.key] = String(fact);
      }
    });
  return answers;
}

function isCommonField(field: RegistryPackage["fields"][number]) {
  return (
    field.sourceRequired ||
    /presentation|diagnos|symptom|medication|procedure|pci|lvef|creatinine|outcome|discharge/i.test(
      `${field.label} ${field.sourceKey}`,
    )
  );
}
export function RegistryForms({
  patient,
  encounters,
  entries = [],
  role,
}: {
  patient: Patient;
  encounters: CareEncounter[];
  entries?: CareEntry[];
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
      <span className="eyebrow">REGISTRY COMPLETION</span>
      <h2>HF, CAD & EP registries</h2>
      <p className="muted">
        Complete the remaining required information first. Existing supported
        clinical facts are offered for review when a new draft is opened.
      </p>
      <ErrorBox message={error || packageError} />
      {!packages && !packageError ? <Loading /> : null}
      <div className="registry-package-grid">
        {packages?.map((p) => {
          const latest = assessments?.find(
            (assessment) => assessment.registry_key === p.key,
          );
          const stats = registryStats(p, latest);
          return (
            <article
              key={`${p.key}-${p.version}`}
              className="registry-completion-card"
            >
              <div className="care-card-head">
                <h3>{p.key}</h3>
                <strong className="completion-value">{stats.percent}%</strong>
              </div>
              <div className="completion-track">
                <span style={{ width: `${stats.percent}%` }} />
              </div>
              <p>
                {latest
                  ? stats.required
                    ? `${stats.completed} of ${stats.required} required fields complete`
                    : `${Object.keys(latest.answers).length} clinical fields populated`
                  : "No assessment started"}
              </p>
              <small>
                {stats.missing
                  ? `${stats.missing} required items remaining`
                  : latest
                    ? stats.required
                      ? "Required fields complete"
                      : "No mandatory fields marked in this source context"
                    : "Patient identity will be reused"}
              </small>
              {role === "clinician" ? (
                <button
                  className="secondary"
                  onClick={() => setEditor({ pkg: p, original: latest })}
                >
                  {latest
                    ? `Continue ${p.key} registry`
                    : `Start ${p.key} registry`}
                </button>
              ) : null}
            </article>
          );
        })}
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
                    {pkg ? `${registryStats(pkg, a).percent}% complete · ` : ""}
                    draft v{a.version} · {date(a.updated_at)}
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
          entries={entries}
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
  entries,
  pkg,
  original,
  readOnly,
  onClose,
  onSaved,
}: {
  patient: Patient;
  encounters: CareEncounter[];
  entries: CareEntry[];
  pkg: RegistryPackage;
  original?: RegistryAssessment;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const contexts = [...new Set(pkg.fields.map((f) => f.context))];
  const initialContext = original?.context ?? contexts[0];
  const mappedPrefill = registryPrefill(pkg, initialContext, entries);
  const initialPrefill = original
    ? { ...mappedPrefill, ...original.answers }
    : mappedPrefill;
  const [context, setContext] = useState(initialContext),
    [encounter, setEncounter] = useState(original?.encounter_id ?? ""),
    [answers, setAnswers] = useState<Answers>(initialPrefill),
    [section, setSection] = useState(""),
    [search, setSearch] = useState(""),
    [mode, setMode] = useState<"required" | "common" | "advanced">("required"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const visible = registryVisible(pkg, answers, context).filter(
      (f) => !f.blocked,
    ),
    missingRequired = visible.filter(
      (f) => f.sourceRequired && !hasAnswer(answers[f.key]),
    ),
    modeFields =
      mode === "required"
        ? missingRequired
        : mode === "common"
          ? visible.filter(isCommonField)
          : visible.filter((field) => !isCommonField(field)),
    sections = [...new Set(modeFields.map((f) => f.section))];
  const selected = sections.includes(section) ? section : sections[0];
  const displayed = (search ? visible : modeFields).filter((f) =>
    search
      ? `${f.label} ${f.group} ${f.section} ${f.sourceKey}`
          .toLowerCase()
          .includes(search.toLowerCase())
      : mode === "required" || f.section === selected,
  );
  const groups = [
    ...new Set(displayed.map((f) => `${f.section} / ${f.group || "Fields"}`)),
  ];
  const required = visible.filter((f) => f.sourceRequired);
  const requiredDone = required.filter((f) => hasAnswer(answers[f.key])).length;
  const completionBase = required.length
    ? required
    : visible.filter(isCommonField);
  const completionDone = completionBase.filter((f) =>
    hasAnswer(answers[f.key]),
  ).length;
  const percent = completionBase.length
    ? Math.round((completionDone / completionBase.length) * 100)
    : 0;
  const prefilled = Object.keys(mappedPrefill).filter(
    (key) =>
      hasAnswer(mappedPrefill[key]) && !hasAnswer(original?.answers?.[key]),
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
                setAnswers(registryPrefill(pkg, e.target.value, entries));
                setSearch("");
                setMode("required");
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
          <strong>{percent}% complete</strong>
          <span>
            {required.length
              ? `${requiredDone} of ${required.length} required fields complete`
              : `${completionDone} of ${completionBase.length} common clinical fields populated`}
          </span>
          {required.length ? (
            <span>{missingRequired.length} required items remaining</span>
          ) : (
            <span>No mandatory fields are marked in this source context</span>
          )}
          {prefilled ? (
            <span>
              {prefilled} {original ? "new " : ""}fields prefilled from the
              clinical record for review
            </span>
          ) : null}
        </div>
        <div
          className="registry-priority-switch"
          aria-label="Registry field priority"
        >
          <button
            type="button"
            className={mode === "required" ? "active" : ""}
            onClick={() => {
              setMode("required");
              setSection("");
              setSearch("");
            }}
          >
            Missing required <Badge>{missingRequired.length}</Badge>
          </button>
          <button
            type="button"
            className={mode === "common" ? "active" : ""}
            onClick={() => {
              setMode("common");
              setSection("");
              setSearch("");
            }}
          >
            Common clinical fields
          </button>
          <button
            type="button"
            className={mode === "advanced" ? "active" : ""}
            onClick={() => {
              setMode("advanced");
              setSection("");
              setSearch("");
            }}
          >
            Advanced registry fields
          </button>
        </div>
        <label>
          Find a registry field
          <input
            placeholder="Search symptoms, medications, procedures…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div
          className={`registry-layout ${mode === "required" ? "required-only" : ""}`}
        >
          {mode !== "required" ? (
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
          ) : null}
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
            {!displayed.length ? (
              <div className="registry-complete-state">
                <CheckCircle2 size={20} />
                <strong>
                  {mode === "required"
                    ? required.length
                      ? "All currently applicable required fields are complete"
                      : "This source context has no mandatory fields; continue with common clinical fields"
                    : "No matching applicable fields"}
                </strong>
              </div>
            ) : null}
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
