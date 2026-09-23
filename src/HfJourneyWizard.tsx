import { useState, type FormEvent, type MouseEvent } from "react";
import { api, currentDate, date } from "./api";
import type { CareEncounter } from "./care-model";
import {
  displayHfCode,
  hfEtiologies,
  hfPathways,
  hfSymptoms,
  type HfEcho,
  type HfReview,
} from "./heart-failure";
import { ErrorBox, Modal } from "./ui";

type Context = {
  currentReview: HfReview | null;
  preferredEcho: HfEcho | null;
  labs: Array<Record<string, any>>;
  medications: Array<Record<string, any>>;
};

type PlannedAction = {
  kind: "clinical_review" | "laboratory" | "follow_up" | "reassessment";
  purpose: string;
  targetDate: string;
};

const courseOptions = [
  ["stable", "Stable", "CURRENT_SYMPTOMATIC", "CHRONIC_STABLE"],
  ["improved", "Improved", "CURRENT_SYMPTOMATIC", "CHRONIC_STABLE"],
  ["worsening", "Worsening", "CURRENT_SYMPTOMATIC", "WORSENING_OUTPATIENT"],
  ["post-discharge", "Post-discharge", "CURRENT_SYMPTOMATIC", "POST_DISCHARGE"],
  ["acute", "Acute decompensation", "DECOMPENSATED", "ACUTE_DECOMPENSATION"],
] as const;

const complicationLabels = [
  ["HYPERKALAEMIA", "Hyperkalaemia"],
  ["WORSENING_RENAL_FUNCTION", "Renal deterioration"],
  ["HYPOTENSION", "Hypotension"],
  ["BRADYCARDIA", "Bradycardia"],
  ["CONGESTION", "Congestion"],
  ["DIURETIC_RESPONSE", "Diuretic resistance"],
  ["HYPONATRAEMIA", "Hyponatraemia"],
  ["IRON_OR_ANAEMIA", "Iron deficiency / anaemia"],
  ["DECOMPENSATED_HF", "Recurrent admission"],
  ["ADVANCED_HF", "Advanced HF concern"],
] as const;

const toggle = (values: string[], value: string) =>
  values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];

const localTime = () => {
  const value = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return value.toISOString().slice(0, 16);
};

export function HfJourneyWizard({
  patientId,
  data,
  encounters,
  onClose,
  onSaved,
}: {
  patientId: string;
  data: Context;
  encounters: CareEncounter[];
  onClose: () => void;
  onSaved: (complication?: string) => void;
}) {
  const current = data.currentReview;
  const [step, setStep] = useState(0);
  const [course, setCourse] = useState(
    courseOptions.find((item) => item[3] === current?.presentation)?.[0] ?? "",
  );
  const [symptoms, setSymptoms] = useState<string[]>(
    current?.symptoms.map((item) => item.symptom) ?? [],
  );
  const [nyha, setNyha] = useState(current?.nyha_class ?? "NOT_ASSESSED");
  const [congestion, setCongestion] = useState(
    current?.clinician_congestion ?? "NOT_ASSESSED",
  );
  const [phenotype, setPhenotype] = useState(
    current?.clinician_phenotype ?? "UNCLASSIFIED",
  );
  const [etiologies, setEtiologies] = useState<string[]>(
    current?.etiologies ?? [],
  );
  const [complication, setComplication] = useState("");
  const [treatmentReview, setTreatmentReview] = useState("");
  const [actions, setActions] = useState<PlannedAction[]>([]);
  const [note, setNote] = useState("");
  const [editedNarrative, setEditedNarrative] = useState<string | null>(null);
  const [encounterId, setEncounterId] = useState(
    encounters.find((item) => item.state === "open")?.id ?? "",
  );
  const [observedAt, setObservedAt] = useState(localTime());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedReview, setSavedReview] = useState(false);
  const [savedActions, setSavedActions] = useState(0);
  const selectedCourse =
    courseOptions.find((item) => item[0] === course) ?? courseOptions[0];
  const generatedNote = [
    `HF review: ${selectedCourse[1]}.`,
    nyha === "NOT_ASSESSED" ? "NYHA not assessed." : `NYHA ${nyha}.`,
    `${displayHfCode(congestion)}.`,
    symptoms.length
      ? `Symptoms: ${symptoms.join(", ")}.`
      : "Symptoms reviewed; none selected.",
    treatmentReview === "reviewed" ? "Current medicines reviewed." : "",
    treatmentReview === "changes"
      ? "Medication changes require separate clinical review."
      : "",
    complication
      ? `Clinical issue to assess: ${complicationLabels.find((item) => item[0] === complication)?.[1]}.`
      : "",
    actions.length
      ? `Plan: ${actions.map((item) => `${item.purpose} (${item.targetDate})`).join("; ")}.`
      : "",
    note.trim(),
  ]
    .filter(Boolean)
    .join(" ");

  async function save(event: FormEvent | MouseEvent) {
    event.preventDefault();
    if (!course) {
      setError(
        "Select the patient's current HF clinical course before saving.",
      );
      setStep(0);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!savedReview) {
        await api(`/patients/${patientId}/heart-failure/reviews`, {
          encounter_id: encounterId || null,
          status:
            course === "stable" && current?.status === "PREVIOUS_STABLE"
              ? "PREVIOUS_STABLE"
              : selectedCourse[2],
          presentation: selectedCourse[3],
          symptoms: symptoms.map((symptom) => ({
            symptom,
            severity: "not_recorded",
            change: "not_recorded",
          })),
          symptoms_reviewed_unchanged: symptoms.length === 0,
          nyha_class: nyha,
          etiologies,
          physical_findings: {},
          clinician_congestion: congestion,
          clinician_phenotype: phenotype,
          phenotype_source_echo_id: data.preferredEcho?.id ?? null,
          therapy_decisions: [],
          narrative: editedNarrative ?? generatedNote,
          observed_at: new Date(observedAt).toISOString(),
        });
        setSavedReview(true);
      }
      for (let index = savedActions; index < actions.length; index++) {
        await api(`/patients/${patientId}/clinical-tasks`, {
          encounter_id: encounterId || null,
          kind: actions[index].kind,
          purpose: actions[index].purpose,
          related_concept: "heart_failure",
          target_date: actions[index].targetDate,
          assigned_to: "Cardiology team",
        });
        setSavedActions(index + 1);
      }
      onSaved(complication || undefined);
    } catch (caught) {
      setError(
        `${(caught as Error).message}${savedReview ? " The HF review was saved; retry to finish any remaining actions." : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    "Status",
    "Symptoms",
    "Clinical state",
    "Treatment",
    "Complications",
    "Plan",
    "Review",
  ];
  return (
    <Modal title="Heart failure review" onClose={onClose} wide>
      <form className="hf-journey-wizard" onSubmit={save}>
        <nav className="wizard-progress" aria-label="Review steps">
          {steps.map((label, index) => (
            <button
              type="button"
              key={label}
              className={index === step ? "active" : ""}
              onClick={() => setStep(index)}
              disabled={busy || savedReview || (!course && index > 0)}
            >
              {index + 1}. {label}
            </button>
          ))}
        </nav>
        <ErrorBox message={error} />
        {step === 0 && (
          <section className="wizard-pane">
            <h3>How is the patient today?</h3>
            <div className="wizard-choices">
              {courseOptions.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={course === value ? "selected" : ""}
                  onClick={() => setCourse(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}
        {step === 1 && (
          <section className="wizard-pane">
            <h3>Current symptoms</h3>
            <p>
              Select what is present. An empty selection records that symptoms
              were reviewed.
            </p>
            <div className="wizard-choices">
              {hfSymptoms.map((symptom) => (
                <button
                  type="button"
                  key={symptom}
                  className={symptoms.includes(symptom) ? "selected" : ""}
                  onClick={() =>
                    setSymptoms((current) => toggle(current, symptom))
                  }
                >
                  {symptom}
                </button>
              ))}
            </div>
          </section>
        )}
        {step === 2 && (
          <section className="wizard-pane">
            <h3>Functional state and context</h3>
            <div className="wizard-columns">
              <div>
                <strong>Functional class</strong>
                <div className="wizard-choices">
                  {["I", "II", "III", "IV", "NOT_ASSESSED"].map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={nyha === value ? "selected" : ""}
                      onClick={() => setNyha(value as typeof nyha)}
                    >
                      {value === "NOT_ASSESSED"
                        ? "Not assessed"
                        : `NYHA ${value}`}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <strong>Congestion</strong>
                <div className="wizard-choices">
                  {[
                    "NO_EVIDENT_CONGESTION",
                    "POSSIBLE_CONGESTION",
                    "CLINICALLY_CONGESTED",
                    "SEVERE_OR_WORSENING",
                    "NOT_ASSESSED",
                  ].map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={congestion === value ? "selected" : ""}
                      onClick={() => setCongestion(value)}
                    >
                      {displayHfCode(value)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <details className="wizard-details">
              <summary>Phenotype and aetiology</summary>
              <p>
                Confirm phenotype from the imaging source and clinical context.
              </p>
              <div className="wizard-choices">
                {["HFrEF", "HFpEF", "UNCLASSIFIED"].map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={phenotype === value ? "selected" : ""}
                    onClick={() => setPhenotype(value as typeof phenotype)}
                  >
                    {value === "UNCLASSIFIED" ? "Unclassified" : value}
                  </button>
                ))}
              </div>
              <p>
                Preferred imaging:{" "}
                {data.preferredEcho
                  ? `${data.preferredEcho.source_label} · EF ${data.preferredEcho.lvef ?? "not recorded"}%`
                  : "None recorded"}
              </p>
              <div className="wizard-choices">
                {hfEtiologies.map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={etiologies.includes(value) ? "selected" : ""}
                    onClick={() =>
                      setEtiologies((current) => toggle(current, value))
                    }
                  >
                    {value}
                  </button>
                ))}
              </div>
            </details>
          </section>
        )}
        {step === 3 && (
          <section className="wizard-pane">
            <h3>Current treatment</h3>
            <p>
              Review the active medication record. Any start, hold, stop or dose
              change is documented through the medication workflow with its
              safety checks.
            </p>
            <div className="wizard-columns">
              <div>
                <h4>Active medicines</h4>
                {data.medications.length ? (
                  data.medications.map((item) => (
                    <p key={item.id}>
                      {item.generic_name}
                      {item.dose_value
                        ? ` · ${item.dose_value} ${item.dose_unit}`
                        : ""}
                    </p>
                  ))
                ) : (
                  <p>No active structured medicines recorded.</p>
                )}
              </div>
              <div>
                <h4>Recent monitoring</h4>
                {data.labs.slice(0, 6).map((item) => (
                  <p key={item.id}>
                    {item.display}: {item.value} {item.unit}
                  </p>
                ))}
                {!data.labs.length && <p>No structured results recorded.</p>}
              </div>
            </div>
            <div className="wizard-choices">
              <button
                type="button"
                className={treatmentReview === "reviewed" ? "selected" : ""}
                onClick={() => setTreatmentReview("reviewed")}
              >
                Current medicines reviewed
              </button>
              <button
                type="button"
                className={treatmentReview === "changes" ? "selected" : ""}
                onClick={() => setTreatmentReview("changes")}
              >
                Medication review needed
              </button>
              <button
                type="button"
                className={!treatmentReview ? "selected" : ""}
                onClick={() => setTreatmentReview("")}
              >
                Not yet reviewed
              </button>
            </div>
          </section>
        )}
        {step === 4 && (
          <section className="wizard-pane">
            <h3>Complications requiring review</h3>
            <p>
              Select an issue to open a focused assessment. No treatment is
              suggested without a published rule.
            </p>
            <div className="wizard-choices">
              <button
                type="button"
                className={!complication ? "selected" : ""}
                onClick={() => setComplication("")}
              >
                None selected
              </button>
              {complicationLabels.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={complication === value ? "selected" : ""}
                  onClick={() => setComplication(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {complication && (
              <p className="wizard-context">
                The focused{" "}
                {
                  complicationLabels.find(
                    (item) => item[0] === complication,
                  )?.[1]
                }{" "}
                review will open after this HF review. It shows current results
                and medicines before a clinician records an assessment.
              </p>
            )}
          </section>
        )}
        {step === 5 && (
          <section className="wizard-pane">
            <h3>Plan and follow-up</h3>
            <p>
              Choose dated actions. They will appear in the patient plan and
              worklist.
            </p>
            {actions.map((item, index) => (
              <div className="wizard-plan-row" key={index}>
                <select
                  aria-label={`Action type ${index + 1}`}
                  value={item.kind}
                  onChange={(event) =>
                    setActions((current) =>
                      current.map((row, position) =>
                        position === index
                          ? {
                              ...row,
                              kind: event.target.value as PlannedAction["kind"],
                            }
                          : row,
                      ),
                    )
                  }
                >
                  <option value="clinical_review">Clinical review</option>
                  <option value="laboratory">Investigation / lab</option>
                  <option value="follow_up">Follow-up</option>
                  <option value="reassessment">Reassessment</option>
                </select>
                <input
                  aria-label={`Action ${index + 1}`}
                  placeholder="What needs to happen?"
                  value={item.purpose}
                  required
                  minLength={2}
                  maxLength={300}
                  onChange={(event) =>
                    setActions((current) =>
                      current.map((row, position) =>
                        position === index
                          ? { ...row, purpose: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Due date ${index + 1}`}
                  type="date"
                  required
                  value={item.targetDate}
                  onChange={(event) =>
                    setActions((current) =>
                      current.map((row, position) =>
                        position === index
                          ? { ...row, targetDate: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove action ${index + 1}`}
                  onClick={() =>
                    setActions((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={actions.length >= 5}
              onClick={() =>
                setActions((current) => [
                  ...current,
                  { kind: "follow_up", purpose: "", targetDate: currentDate() },
                ])
              }
            >
              + Add planned action
            </button>
            <label className="wizard-comment">
              Additional clinical context
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={1000}
              />
            </label>
          </section>
        )}
        {step === 6 && (
          <section className="wizard-pane">
            <h3>Review before saving</h3>
            <label>
              Review note
              <textarea
                className="wizard-generated-note"
                value={editedNarrative ?? generatedNote}
                onChange={(event) => setEditedNarrative(event.target.value)}
                rows={5}
                maxLength={4000}
              />
            </label>
            <p>
              Edit the generated note if needed. Every saved review keeps its
              author, date and encounter.
            </p>
            <div className="form-grid compact">
              <label>
                Care context
                <select
                  value={encounterId}
                  onChange={(event) => setEncounterId(event.target.value)}
                >
                  <option value="">Continuing record</option>
                  {encounters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.kind} · {item.reason}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Clinical date and time
                <input
                  type="datetime-local"
                  required
                  value={observedAt}
                  onChange={(event) => setObservedAt(event.target.value)}
                />
              </label>
            </div>
            {actions.length ? (
              <p>
                {actions.length} dated action{actions.length === 1 ? "" : "s"}{" "}
                will be added.
              </p>
            ) : (
              <p>No follow-up action selected.</p>
            )}
          </section>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => (step ? setStep(step - 1) : onClose())}
            disabled={busy || savedReview}
          >
            {step ? "Back" : "Cancel"}
          </button>
          {step < steps.length - 1 ? (
            <button
              type="button"
              className="primary"
              disabled={step === 0 && !course}
              onClick={() => setStep(step + 1)}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={save}
              className="primary"
              disabled={
                busy ||
                actions.some(
                  (item) => item.purpose.trim().length < 2 || !item.targetDate,
                )
              }
            >
              {busy ? "Saving…" : "Save HF review and plan"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

export function HfComplicationWizard({
  patientId,
  data,
  encounters,
  initialType,
  onClose,
  onSaved,
}: {
  patientId: string;
  data: Context;
  encounters: CareEncounter[];
  initialType?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(0);
  const [pathway, setPathway] = useState(initialType || "");
  const [severity, setSeverity] = useState("NOT_ASSESSED");
  const [state, setState] = useState("");
  const [contributors, setContributors] = useState<string[]>([]);
  const [assessment, setAssessment] = useState("");
  const [monitoring, setMonitoring] = useState("");
  const [encounterId, setEncounterId] = useState(
    encounters.find((item) => item.state === "open")?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const relevantLabs = data.labs
    .filter((item) =>
      [
        "potassium",
        "creatinine",
        "egfr-ckd-epi-2021",
        "sodium",
        "hemoglobin",
        "ferritin",
      ].includes(item.test_id),
    )
    .slice(0, 8);
  const steps = ["Patient data", "Assessment", "Contributors", "Plan"];
  async function save(event: FormEvent | MouseEvent) {
    event.preventDefault();
    if (!pathway) {
      setError("Choose the clinical issue before saving.");
      setStep(0);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${patientId}/heart-failure/pathways`, {
        encounter_id: encounterId || null,
        pathway_type: pathway,
        state: state.trim(),
        severity,
        patient_data: Object.fromEntries(
          relevantLabs.map((item) => [
            item.test_id,
            `${item.value} ${item.unit} · ${date(item.observed_at)}`,
          ]),
        ),
        missing_information: [],
        considerations: contributors,
        medication_implications: [],
        monitoring_plan: monitoring.trim()
          ? { clinician_plan: monitoring.trim() }
          : {},
        escalation: assessment.trim(),
        evidence_note:
          "Clinician assessment; no automated treatment recommendation applied.",
        observed_at: new Date().toISOString(),
      });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="HF complication review" onClose={onClose} wide>
      <form className="hf-journey-wizard" onSubmit={save}>
        <nav className="wizard-progress" aria-label="Complication review steps">
          {steps.map((label, index) => (
            <button
              type="button"
              key={label}
              className={index === step ? "active" : ""}
              disabled={!pathway && index > 0}
              onClick={() => setStep(index)}
            >
              {index + 1}. {label}
            </button>
          ))}
        </nav>
        <ErrorBox message={error} />
        {step === 0 && (
          <section className="wizard-pane">
            <h3>Current clinical data</h3>
            <label>
              Issue
              <select
                value={pathway}
                onChange={(event) => setPathway(event.target.value)}
              >
                <option value="">Choose clinical issue</option>
                {hfPathways.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="wizard-columns">
              <div>
                <h4>Recent results</h4>
                {relevantLabs.length ? (
                  relevantLabs.map((item) => (
                    <p key={item.id}>
                      {item.display}:{" "}
                      <strong>
                        {item.value} {item.unit}
                      </strong>{" "}
                      · {date(item.observed_at)}
                    </p>
                  ))
                ) : (
                  <p>No relevant structured results recorded.</p>
                )}
              </div>
              <div>
                <h4>Current medicines</h4>
                {data.medications.length ? (
                  data.medications.map((item) => (
                    <p key={item.id}>
                      {item.generic_name}{" "}
                      {item.dose_value
                        ? `· ${item.dose_value} ${item.dose_unit}`
                        : ""}
                    </p>
                  ))
                ) : (
                  <p>No active structured medicines recorded.</p>
                )}
              </div>
            </div>
            <p>
              Check the source and timing of these values before making a
              clinical decision.
            </p>
          </section>
        )}
        {step === 1 && (
          <section className="wizard-pane">
            <h3>Clinician assessment</h3>
            <div className="wizard-choices">
              {["NOT_ASSESSED", "LOW", "MODERATE", "HIGH", "CRITICAL"].map(
                (value) => (
                  <button
                    type="button"
                    key={value}
                    className={severity === value ? "selected" : ""}
                    onClick={() => setSeverity(value)}
                  >
                    {displayHfCode(value)}
                  </button>
                ),
              )}
            </div>
            <label>
              Current state
              <input
                value={state}
                onChange={(event) => setState(event.target.value)}
                minLength={2}
                maxLength={200}
                placeholder="Clinician-confirmed assessment"
                required
              />
            </label>
            <label>
              Care context
              <select
                value={encounterId}
                onChange={(event) => setEncounterId(event.target.value)}
              >
                <option value="">Continuing record</option>
                {encounters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.kind} · {item.reason}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}
        {step === 2 && (
          <section className="wizard-pane">
            <h3>Potential contributors to review</h3>
            <p>
              These are documentation prompts, not diagnoses or treatment
              instructions.
            </p>
            <div className="wizard-choices">
              {[
                "Recent medication change",
                "Renal function",
                "Volume status",
                "Diet / intake",
                "Intercurrent illness",
                "Other cause under review",
              ].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={contributors.includes(value) ? "selected" : ""}
                  onClick={() =>
                    setContributors((current) => toggle(current, value))
                  }
                >
                  {value}
                </button>
              ))}
            </div>
          </section>
        )}
        {step === 3 && (
          <section className="wizard-pane">
            <h3>Management and monitoring</h3>
            <p>
              No management choice is generated here: no disease-specific rule
              has been published. Record the clinician's decision and monitoring
              plan.
            </p>
            <label>
              Clinician decision / escalation
              <textarea
                value={assessment}
                onChange={(event) => setAssessment(event.target.value)}
                rows={3}
                maxLength={1000}
              />
            </label>
            <label>
              Monitoring plan
              <textarea
                value={monitoring}
                onChange={(event) => setMonitoring(event.target.value)}
                rows={3}
                maxLength={500}
              />
            </label>
          </section>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => (step ? setStep(step - 1) : onClose())}
          >
            {step ? "Back" : "Cancel"}
          </button>
          {step < steps.length - 1 ? (
            <button
              type="button"
              className="primary"
              disabled={step === 0 && !pathway}
              onClick={() => setStep(step + 1)}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={save}
              className="primary"
              disabled={busy || state.trim().length < 2}
            >
              {busy ? "Saving…" : "Save complication review"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
