import { useState, type FormEvent } from "react";
import { Search, Check, Plus, ChevronRight } from "lucide-react";
import {
  templates,
  templateByKey,
  visibleFields,
  cleanAnswers,
  type Template,
  type Answers,
  type Field,
} from "./guided";
import {
  careKinds,
  stateLabel,
  needsReview,
  type CareKind,
  type CareEntry,
  type CareEncounter,
} from "./care-model";
import {
  rcriPreview,
  apixabanPreview,
  reusableFacts,
  rcriSource,
  apixabanSource,
} from "./clinical-review";
import { api, currentDate, date } from "./api";
import { Modal, ErrorBox, Badge } from "./ui";
import type { Patient } from "./types";

export function DynamicFields({
  fields,
  answers,
  onChange,
  prefix,
}: {
  fields: Field[];
  answers: Answers;
  onChange: (key: string, value: Answers[string]) => void;
  prefix: string;
}) {
  return (
    <div className="form-grid guided-fields">
      {fields.map((f) =>
        f.type === "multi" ? (
          <fieldset className="span-2 choice-group" key={f.key}>
            <legend>{f.label}</legend>
            <div className="choice-chips">
              {f.options?.map((option) => {
                const selected =
                  Array.isArray(answers[f.key]) &&
                  (answers[f.key] as string[]).includes(option);
                return (
                  <button
                    type="button"
                    key={option}
                    aria-pressed={selected}
                    className={
                      selected ? "choice-chip selected" : "choice-chip"
                    }
                    onClick={() => {
                      const old = Array.isArray(answers[f.key])
                        ? (answers[f.key] as string[])
                        : [];
                      onChange(
                        f.key,
                        selected
                          ? old.filter((v) => v !== option)
                          : [...old, option],
                      );
                    }}
                  >
                    {selected ? <Check size={14} /> : <Plus size={14} />}{" "}
                    {option}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : (
          <label key={f.key} htmlFor={`${prefix}-${f.key}`}>
            {f.label}
            {f.unit ? ` (${f.unit})` : ""}
            {f.type === "choice" ? (
              <select
                id={`${prefix}-${f.key}`}
                value={String(answers[f.key] ?? "")}
                onChange={(e) => onChange(f.key, e.target.value)}
                required={f.required}
              >
                <option value="">Select / not recorded</option>
                {f.options?.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                id={`${prefix}-${f.key}`}
                type={f.type === "number" ? "number" : "text"}
                step="any"
                min={f.min}
                max={f.max}
                required={f.required}
                maxLength={2000}
                value={String(answers[f.key] ?? "")}
                onChange={(e) =>
                  onChange(
                    f.key,
                    f.type === "number" && e.target.value !== ""
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
              />
            )}
          </label>
        ),
      )}
    </div>
  );
}
type Draft = {
  answers: Answers;
  status: string;
  note: string;
  action_note: string;
  response_note: string;
};
const newDraft = (kind: CareKind): Draft => ({
  answers: {},
  status: careKinds[kind].states[0],
  note: "",
  action_note: "",
  response_note: "",
});
export function ClinicalPreview({
  template,
  answers,
  patient,
  on,
}: {
  template: Template;
  answers: Answers;
  patient: Patient;
  on: string;
}) {
  const surgery = template.key === "procedure.noncardiac_surgery",
    med = template.key === "medication.apixaban";
  if (!surgery && !med) return null;
  const result = surgery
    ? rcriPreview(answers, patient.birth_date, on)
    : apixabanPreview(answers, patient.birth_date, on);
  return (
    <aside className="clinical-preview">
      <div className="care-card-head">
        <strong>{result.title}</strong>
        <Badge>Draft · synthetic use</Badge>
      </div>
      <p>
        {surgery
          ? "An explainable point count, not surgical clearance or an absolute event probability."
          : "A limited US-label reference, not a prescription. Other drugs and indications require their own reviewed rules."}
      </p>
      {result.reasons.length ? (
        <>
          <strong>Complete the review to see the reference</strong>
          <ul>
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="reference-value">
            {result.points !== undefined
              ? `${result.points} / 6 points`
              : result.reference}
          </div>
          <p>
            {result.factors?.length
              ? result.factors.join(" · ")
              : "None of the listed criteria are present."}
          </p>
        </>
      )}
      <a
        href={surgery ? rcriSource : apixabanSource}
        target="_blank"
        rel="noreferrer"
      >
        {surgery
          ? "Original RCRI publication (1999)"
          : "Full prescribing information (revision 8/2025)"}
      </a>
      <small>
        Implementation preview · clinical approval pending. No medication or
        care plan is changed by this calculation.
      </small>
    </aside>
  );
}
export function GuidedEditor({
  patient,
  encounters,
  entries,
  original,
  kind,
  owner,
  onClose,
  onSaved,
  onCustom,
}: {
  patient: Patient;
  encounters: CareEncounter[];
  entries: CareEntry[];
  original?: CareEntry;
  kind: CareKind;
  owner: string;
  onClose: () => void;
  onSaved: () => void;
  onCustom: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(
      original?.template_key ? [original.template_key] : [],
    ),
    [search, setSearch] = useState(""),
    [step, setStep] = useState(original ? 1 : 0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    original?.template_key
      ? {
          [original.template_key]: {
            answers: Object.fromEntries(
              Object.entries(original.structured ?? {}).filter(
                ([k]) => !k.startsWith("_"),
              ),
            ),
            status: original.status,
            note: String(original.structured?._note ?? ""),
            action_note: String(original.structured?._action ?? ""),
            response_note: String(original.structured?._response ?? ""),
          },
        }
      : {},
  );
  const [encounterId, setEncounterId] = useState(original?.encounter_id ?? ""),
    [eventDate, setEventDate] = useState(
      original?.occurred_on ?? currentDate(),
    ),
    [responsible, setResponsible] = useState(original?.owner ?? owner),
    [reviewDate, setReviewDate] = useState(original?.due_date ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const chosen = selected.map((k) => templateByKey.get(k)!).filter(Boolean);
  const reviewRequired = chosen.some(
    (t) =>
      needsReview({
        kind: t.kind,
        status: drafts[t.key]?.status ?? careKinds[t.kind].states[0],
        due_date: reviewDate || null,
      }) ||
      (t.kind === "medication" && drafts[t.key]?.status === "held"),
  );
  function change(t: Template, key: string, value: Answers[string]) {
    setDrafts((old) => {
      const d = old[t.key] ?? newDraft(t.kind);
      const answers = cleanAnswers(t, { ...d.answers, [key]: value });
      if (
        key !== "inputs_confirmed" &&
        answers.inputs_confirmed === "Confirmed"
      )
        answers.inputs_confirmed = "Not yet confirmed";
      return { ...old, [t.key]: { ...d, answers } };
    });
  }
  function invalidateContext() {
    setDrafts((old) =>
      Object.fromEntries(
        Object.entries(old).map(([key, d]) => {
          const fields = templateByKey.get(key)?.fields ?? [];
          return [
            key,
            {
              ...d,
              answers: {
                ...d.answers,
                ...(fields.some((f) => f.key === "inputs_confirmed")
                  ? { inputs_confirmed: "Not yet confirmed" }
                  : {}),
                ...(fields.some((f) => f.key === "lab_current")
                  ? { lab_current: "Not yet reviewed" }
                  : {}),
              },
            },
          ];
        }),
      ),
    );
  }
  function draftChange(key: string, part: Partial<Draft>) {
    setDrafts((old) => ({ ...old, [key]: { ...old[key], ...part } }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = chosen.map((t) => ({
        template_key: t.key,
        ...drafts[t.key],
        answers: cleanAnswers(t, drafts[t.key].answers),
        encounter_id: encounterId || null,
        occurred_on: eventDate,
        owner: responsible,
        due_date: reviewDate || null,
        ...(original ? { version: original.version } : {}),
      }));
      await api(
        original
          ? `/care/guided/${original.id}`
          : `/patients/${patient.id}/care/guided`,
        original ? payload[0] : { entries: payload },
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
      <div className="guided-progress">
        <span className={step === 0 ? "current" : ""}>
          1 · Choose {kind === "problem" ? "problems" : "forms"}
        </span>
        <ChevronRight size={16} />
        <span className={step === 1 ? "current" : ""}>
          2 · Details & review
        </span>
      </div>
      <ErrorBox message={error} />
      {step === 0 ? (
        <>
          <p className="modal-intro">
            Select all that apply. Each selection opens its own questions. Save
            them together in this patient's continuing record.
          </p>
          <label className="template-search">
            <Search size={17} />
            <input
              autoFocus
              aria-label="Search guided forms"
              placeholder="Search by condition, procedure or drug…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="template-grid">
            {templates
              .filter(
                (t) =>
                  t.kind === kind &&
                  `${t.label} ${t.family} ${t.key}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((t) => {
                const checked = selected.includes(t.key);
                return (
                  <button
                    type="button"
                    key={t.key}
                    aria-pressed={checked}
                    className={`template-option ${checked ? "selected" : ""}`}
                    onClick={() => {
                      setSelected((old) =>
                        checked
                          ? old.filter((k) => k !== t.key)
                          : [...old, t.key],
                      );
                      if (!drafts[t.key])
                        setDrafts((old) => ({
                          ...old,
                          [t.key]: newDraft(kind),
                        }));
                    }}
                  >
                    <span className="template-check">
                      {checked ? <Check size={17} /> : <Plus size={17} />}
                    </span>
                    <span>
                      <strong>{t.label}</strong>
                      <small>
                        {t.family} · {t.fields.length} available questions
                      </small>
                    </span>
                  </button>
                );
              })}
          </div>
          <div className="modal-actions">
            <button className="text-button" onClick={onCustom}>
              Custom free-text record
            </button>
            <button
              className="primary"
              disabled={!selected.length || selected.length > 20}
              onClick={() => setStep(1)}
            >
              Continue with {selected.length}{" "}
              {selected.length === 1 ? "selection" : "selections"}
              <ChevronRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <section className="guided-context">
            <h3>Shared context</h3>
            <div className="form-grid">
              <label>
                Event date
                <input
                  type="date"
                  required
                  min={patient.birth_date}
                  max={currentDate()}
                  value={eventDate}
                  disabled={!!original}
                  onChange={(e) => {
                    setEventDate(e.target.value);
                    invalidateContext();
                  }}
                />
              </label>
              <label>
                Origin encounter
                <select
                  value={encounterId}
                  disabled={!!original}
                  onChange={(e) => {
                    setEncounterId(e.target.value);
                    invalidateContext();
                    const c = encounters.find((c) => c.id === e.target.value);
                    if (c) {
                      setResponsible(c.owner);
                      setEventDate(c.started_on);
                    }
                  }}
                >
                  <option value="">Continuing plan</option>
                  {encounters.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.kind} · {date(c.started_on)} · {c.reason}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Responsible clinician / team
                <input
                  required
                  minLength={2}
                  maxLength={300}
                  value={responsible}
                  onChange={(e) => setResponsible(e.target.value)}
                />
              </label>
              <label>
                Review date {reviewRequired ? "· required" : "· optional"}
                <input
                  type="date"
                  required={reviewRequired}
                  value={reviewDate}
                  onChange={(e) => setReviewDate(e.target.value)}
                />
              </label>
            </div>
          </section>
          {chosen.map((t) => {
            const d = drafts[t.key],
              facts = reusableFacts(
                entries.filter((e) => e.id !== original?.id),
                t.key,
              );
            return (
              <section className="guided-section" key={t.key}>
                <div className="guided-section-title">
                  <div>
                    <Badge tone="cad">{t.family}</Badge>
                    <h3>{t.label}</h3>
                  </div>
                  <label>
                    Status
                    <select
                      aria-label={`${t.label} status`}
                      value={d.status}
                      onChange={(e) =>
                        draftChange(t.key, { status: e.target.value })
                      }
                    >
                      {careKinds[t.kind].states.map((s) => (
                        <option value={s} key={s}>
                          {stateLabel(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {facts.length ? (
                  <details className="reuse-facts">
                    <summary>
                      Reuse {facts.length} recorded facts · review dates before
                      using
                    </summary>
                    {facts.map((f) => (
                      <p key={f.key}>
                        <strong>
                          {f.label}: {f.value}
                        </strong>
                        <small>
                          {f.source.title} · {date(f.source.occurred_on)} · v
                          {f.source.version} · {f.source.owner}
                        </small>
                      </p>
                    ))}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        const answers = cleanAnswers(t, {
                          ...d.answers,
                          ...Object.fromEntries(
                            facts.map((f) => [f.key, f.value]),
                          ),
                        });
                        answers.inputs_confirmed = "Not yet confirmed";
                        answers.lab_current = "Not yet reviewed";
                        draftChange(t.key, {
                          answers,
                          note: [
                            d.note,
                            ...facts.map(
                              (f) =>
                                `Reused ${f.label} from ${f.source.title}, ${f.source.occurred_on}, v${f.source.version} (${f.source.id}); current relevance requires confirmation.`,
                            ),
                          ]
                            .join("\n")
                            .slice(0, 2000),
                        });
                      }}
                    >
                      Copy facts for review
                    </button>
                  </details>
                ) : null}
                <DynamicFields
                  prefix={t.key}
                  fields={visibleFields(t, d.answers)}
                  answers={d.answers}
                  onChange={(k, v) => change(t, k, v)}
                />
                {t.kind === "complication" ? (
                  <p className="guided-hint">
                    These are documentation choices for the treating team.
                    Selecting an action does not order treatment.
                  </p>
                ) : null}
                <ClinicalPreview
                  template={t}
                  answers={d.answers}
                  patient={patient}
                  on={eventDate}
                />
                {t.source && t.key !== "medication.apixaban" ? (
                  <p>
                    <a href={t.source} target="_blank" rel="noreferrer">
                      {t.sourceLabel}
                    </a>
                  </p>
                ) : null}
                <details
                  className="guided-notes"
                  open={[
                    "completed",
                    "reviewed",
                    "cancelled",
                    "deferred",
                    "discontinued",
                    "excluded",
                  ].includes(d.status)}
                >
                  <summary>Additional notes / closing the loop</summary>
                  <div className="form-grid">
                    <label className="span-2">
                      Additional context
                      <textarea
                        maxLength={2000}
                        value={d.note}
                        onChange={(e) =>
                          draftChange(t.key, { note: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Decision / action taken
                      <textarea
                        maxLength={2000}
                        value={d.action_note}
                        onChange={(e) =>
                          draftChange(t.key, { action_note: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Response / follow-up plan
                      <textarea
                        maxLength={2000}
                        value={d.response_note}
                        onChange={(e) =>
                          draftChange(t.key, { response_note: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </details>
              </section>
            );
          })}
          <div className="modal-actions">
            {!original ? (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setStep(0)}
              >
                Change selections
              </button>
            ) : null}
            <button className="primary" disabled={busy}>
              {busy
                ? "Saving…"
                : original
                  ? "Save guided review"
                  : `Save ${chosen.length} guided ${chosen.length === 1 ? "record" : "records"}`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
