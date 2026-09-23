import { useState, type FormEvent, type MouseEvent } from "react";
import { api, date } from "./api";
import type { CareEncounter } from "./care-model";
import type { HfReview } from "./heart-failure";
import { ErrorBox, Modal } from "./ui";

type DischargeContext = {
  currentReview: HfReview | null;
  labs: Array<Record<string, any>>;
  medications: Array<Record<string, any>>;
  integratedPlan: Array<{
    id: string;
    purpose: string;
    target_date: string | null;
    current_status: string;
  }>;
};

const reviewItems = [
  ["congestion", "Congestion reviewed"],
  ["medications", "Medicines reconciled"],
  ["renal", "Renal function and electrolytes reviewed"],
  ["titration", "Titration plan reviewed"],
  ["education", "Patient education reviewed"],
  ["rehab", "Rehabilitation reviewed"],
] as const;

export function HfDischargeWizard({
  patientId,
  data,
  encounters,
  onClose,
  onSaved,
}: {
  patientId: string;
  data: DischargeContext;
  encounters: CareEncounter[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(0);
  const [encounterId, setEncounterId] = useState(
    encounters.find(
      (item) => item.state === "open" && item.kind === "Admission",
    )?.id ??
      encounters.find((item) => item.state === "open")?.id ??
      "",
  );
  const [stability, setStability] = useState("NOT_ASSESSED");
  const [checks, setChecks] = useState<string[]>([]);
  const [labDate, setLabDate] = useState("");
  const [clinicDate, setClinicDate] = useState("");
  const [echoDate, setEchoDate] = useState("");
  const [deviceDate, setDeviceDate] = useState("");
  const [outstanding, setOutstanding] = useState("");
  const [note, setNote] = useState("");
  const [closeAdmission, setCloseAdmission] = useState(false);
  const [savedReview, setSavedReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const encounter = encounters.find((item) => item.id === encounterId);
  const openTasks = data.integratedPlan.filter(
    (item) =>
      !["completed", "cancelled", "superseded"].includes(item.current_status),
  );
  const summary = [
    `Heart failure discharge review. Clinical stability: ${stability.replaceAll("_", " ").toLowerCase()}.`,
    data.currentReview
      ? `Latest HF state: ${data.currentReview.clinician_phenotype ?? "unclassified"}, ${data.currentReview.presentation.replaceAll("_", " ").toLowerCase()}, NYHA ${data.currentReview.nyha_class ?? "not assessed"}.`
      : "No structured HF review recorded.",
    data.medications.length
      ? `Current medicines reviewed in record: ${data.medications
          .slice(0, 6)
          .map((item) => item.generic_name)
          .join(", ")}${data.medications.length > 6 ? ", and others" : ""}.`
      : "No active structured medicines recorded.",
    checks.length
      ? `Reviewed: ${reviewItems
          .filter(([key]) => checks.includes(key))
          .map(([, label]) => label.toLowerCase())
          .join(", ")}.`
      : "No checklist items confirmed.",
    labDate ? `Renal and electrolyte review ${labDate}.` : "",
    clinicDate ? `HF clinic ${clinicDate}.` : "",
    echoDate ? `Cardiac imaging review ${echoDate}.` : "",
    deviceDate ? `Device reassessment ${deviceDate}.` : "",
    outstanding.trim() ? `Outstanding: ${outstanding.trim()}.` : "",
    note.trim(),
  ]
    .filter(Boolean)
    .join(" ");
  const steps = ["Patient state", "Review", "Schedule", "Confirm"];

  async function save(event: FormEvent | MouseEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!savedReview) {
        await api(`/patients/${patientId}/heart-failure/discharge-reviews`, {
          encounter_id: encounterId || null,
          clinical_stability: stability,
          congestion_reviewed: checks.includes("congestion"),
          medication_reconciliation: checks.includes("medications"),
          renal_electrolytes_reviewed: checks.includes("renal"),
          titration_plan_reviewed: checks.includes("titration"),
          education_reviewed: checks.includes("education"),
          rehabilitation_reviewed: checks.includes("rehab"),
          outstanding_items: outstanding
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          laboratory_date: labDate || null,
          clinic_date: clinicDate || null,
          echo_date: echoDate || null,
          device_reassessment_date: deviceDate || null,
          note: summary,
          observed_at: new Date().toISOString(),
        });
        setSavedReview(true);
      }
      if (
        closeAdmission &&
        encounter?.kind === "Admission" &&
        encounter.state === "open"
      ) {
        await api(
          `/patients/${patientId}/care/encounters/${encounter.id}/close`,
          {
            version: encounter.version,
            closed_on: new Date().toLocaleDateString("en-CA", {
              timeZone: "Asia/Kuwait",
            }),
            summary,
          },
        );
      }
      onSaved();
    } catch (caught) {
      setError(
        `${(caught as Error).message}${savedReview ? " The discharge review and its follow-up tasks were saved; the admission is still open. Retry closure after refreshing the encounter." : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="HF discharge and follow-up" onClose={onClose} wide>
      <form className="hf-journey-wizard" onSubmit={save}>
        <nav className="wizard-progress" aria-label="Discharge steps">
          {steps.map((label, index) => (
            <button
              type="button"
              key={label}
              className={step === index ? "active" : ""}
              onClick={() => setStep(index)}
              disabled={busy || savedReview}
            >
              {index + 1}. {label}
            </button>
          ))}
        </nav>
        <ErrorBox message={error} />
        {step === 0 && (
          <section className="wizard-pane">
            <h3>Review the current patient state</h3>
            <label>
              Admission / visit context
              <select
                value={encounterId}
                onChange={(event) => setEncounterId(event.target.value)}
              >
                <option value="">Continuing record</option>
                {encounters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.kind} · {item.reason} · {date(item.started_on)}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Latest HF review:{" "}
              {data.currentReview
                ? `${data.currentReview.clinician_phenotype ?? "Phenotype not confirmed"} · ${data.currentReview.presentation.replaceAll("_", " ").toLowerCase()} · NYHA ${data.currentReview.nyha_class ?? "not assessed"}`
                : "No structured HF review recorded"}
            </p>
            <div className="wizard-columns">
              <div>
                <h4>Current medicines</h4>
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
                <h4>Recent results and open plan</h4>
                {data.labs.slice(0, 5).map((item) => (
                  <p key={item.id}>
                    {item.display}: {item.value} {item.unit}
                  </p>
                ))}
                {openTasks.slice(0, 5).map((item) => (
                  <p key={item.id}>
                    ○ {item.purpose}
                    {item.target_date ? ` · ${date(item.target_date)}` : ""}
                  </p>
                ))}
              </div>
            </div>
            <p>
              Review source records before confirming stability or
              reconciliation.
            </p>
          </section>
        )}
        {step === 1 && (
          <section className="wizard-pane">
            <h3>Discharge readiness</h3>
            <div className="wizard-choices">
              {["CONFIRMED", "NOT_CONFIRMED", "NOT_ASSESSED"].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={stability === value ? "selected" : ""}
                  onClick={() => {
                    setStability(value);
                    if (value !== "CONFIRMED") setCloseAdmission(false);
                  }}
                >
                  {value === "CONFIRMED"
                    ? "Clinically stable"
                    : value === "NOT_CONFIRMED"
                      ? "Not yet stable"
                      : "Not assessed"}
                </button>
              ))}
            </div>
            <p>Confirm only the areas actually reviewed.</p>
            <div className="wizard-choices">
              {reviewItems.map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className={checks.includes(key) ? "selected" : ""}
                  onClick={() =>
                    setChecks((current) =>
                      current.includes(key)
                        ? current.filter((item) => item !== key)
                        : [...current, key],
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}
        {step === 2 && (
          <section className="wizard-pane">
            <h3>Follow-up from discharge</h3>
            <p>
              Each chosen date creates a continuing task visible in the next
              visit and worklist.
            </p>
            <div className="form-grid compact">
              <label>
                Renal and electrolyte review{" "}
                <input
                  type="date"
                  value={labDate}
                  onChange={(event) => setLabDate(event.target.value)}
                />
              </label>
              <label>
                HF clinic{" "}
                <input
                  type="date"
                  value={clinicDate}
                  onChange={(event) => setClinicDate(event.target.value)}
                />
              </label>
              <label>
                Cardiac imaging review{" "}
                <input
                  type="date"
                  value={echoDate}
                  onChange={(event) => setEchoDate(event.target.value)}
                />
              </label>
              <label>
                Device reassessment{" "}
                <input
                  type="date"
                  value={deviceDate}
                  onChange={(event) => setDeviceDate(event.target.value)}
                />
              </label>
            </div>
            <label>
              Other unresolved items (one per line)
              <textarea
                value={outstanding}
                onChange={(event) => setOutstanding(event.target.value)}
                rows={3}
                maxLength={500}
              />
            </label>
          </section>
        )}
        {step === 3 && (
          <section className="wizard-pane">
            <h3>Confirm discharge review</h3>
            <div className="wizard-generated-note">{summary}</div>
            <label>
              Additional context{" "}
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={500}
              />
            </label>
            {encounter?.kind === "Admission" && encounter.state === "open" && (
              <label className="wizard-close-choice">
                <input
                  type="checkbox"
                  checked={closeAdmission}
                  disabled={stability !== "CONFIRMED"}
                  onChange={(event) => setCloseAdmission(event.target.checked)}
                />{" "}
                Close this admission after saving the discharge review
              </label>
            )}
            {encounter?.kind === "Admission" && stability !== "CONFIRMED" && (
              <p>
                Confirm clinical stability before closing the admission. The
                review and continuing plan can still be saved.
              </p>
            )}
            <p>
              Open actions remain in the longitudinal patient record after
              discharge.
            </p>
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
              onClick={() => setStep(step + 1)}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={save}
            >
              {busy ? "Saving…" : "Save discharge plan"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
