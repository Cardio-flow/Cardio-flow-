import { useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  HeartPulse,
  History,
  Plus,
  Stethoscope,
} from "lucide-react";
import { api, date, useData } from "./api";
import type { CareEncounter } from "./care-model";
import {
  displayHfCode,
  hfEtiologies,
  hfPathways,
  hfPresentations,
  hfStatuses,
  hfSymptoms,
  type HfEcho,
  type HfPhenotypeState,
  type HfReview,
} from "./heart-failure";
import type { Role } from "./types";
import { Empty, ErrorBox, Loading, Modal, SectionTitle } from "./ui";
import { HfComplicationWizard, HfJourneyWizard } from "./HfJourneyWizard";
import { HfDischargeWizard } from "./HfDischargeWizard";

type HfTask = {
  id: string;
  purpose: string;
  target_date: string | null;
  current_status: string;
};
type HfPathway = {
  id: string;
  pathway_type: string;
  state: string;
  severity: string;
  missing_information: string[];
  considerations: string[];
  escalation: string;
  observed_at: string;
  author: string;
};
type HfState = {
  profile: { id: string } | null;
  currentReview: HfReview | null;
  phenotype: HfPhenotypeState;
  preferredEcho: HfEcho | null;
  echoes: HfEcho[];
  reviews: HfReview[];
  pathways: HfPathway[];
  devices: Array<Record<string, any>>;
  dischargeReviews: Array<Record<string, any>>;
  rehabilitation: Record<string, any> | null;
  medications: Array<Record<string, any>>;
  labs: Array<Record<string, any>>;
  tasks: HfTask[];
  gaps: { key: string; label: string; kind: "missing" | "review" }[];
  integratedPlan: HfTask[];
  timeline: {
    id: string;
    type: string;
    date: string;
    title: string;
    detail: string;
  }[];
  diagnosticPathway: {
    known: string[];
    missing: string[];
    why: string;
    suggestedNextAssessment: string;
  };
};

type Action =
  | "review"
  | "echo"
  | "pathway"
  | "device"
  | "discharge"
  | "rehabilitation"
  | "note";

const nowLocal = () => {
  const value = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return value.toISOString().slice(0, 16);
};
const toIso = (value: string) => new Date(value).toISOString();
const activeTask = (task: HfTask) =>
  !["completed", "cancelled", "superseded"].includes(task.current_status);

export function HeartFailureDashboard({
  patientId,
  revision,
  role,
  encounters,
  onChanged,
}: {
  patientId: string;
  revision: number;
  role: Role;
  encounters: CareEncounter[];
  onChanged: () => void;
}) {
  const { data, error } = useData<HfState>(
    `/patients/${patientId}/heart-failure`,
    revision,
  );
  const [action, setAction] = useState<Action | null>(null);
  const [initialComplication, setInitialComplication] = useState("");
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  const review = data.currentReview;
  const echo = data.preferredEcho;
  const openTasks = data.integratedPlan.filter(activeTask).slice(0, 4);
  const coreLabs = data.labs.filter((item) =>
    [
      "creatinine",
      "egfr-ckd-epi-2021",
      "potassium",
      "nt-probnp",
      "bnp",
    ].includes(item.test_id),
  );
  const done = (complication?: string) => {
    setInitialComplication(complication ?? "");
    setAction(complication ? "pathway" : null);
    onChanged();
  };
  return (
    <section
      className="panel care-section hf-module"
      aria-label="Heart failure"
    >
      <SectionTitle
        title="Heart Failure"
        subtitle="Current clinical state, evidence, therapy context and next actions"
        action={
          role === "clinician" ? (
            <button
              className="primary small"
              onClick={() => setAction("review")}
            >
              <Plus size={15} /> Update HF
            </button>
          ) : null
        }
      />
      {!data.profile ? (
        <div className="hf-empty-start">
          <Empty title="No structured HF review yet">
            Existing medications, laboratory results and encounters are
            retained. Start a review to connect them to the HF clinical record.
          </Empty>
          {role === "clinician" ? (
            <button className="primary" onClick={() => setAction("review")}>
              Start HF review
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="hf-status-strip">
            <div>
              <span>Phenotype</span>
              <strong>{data.phenotype.value ?? "Not confirmed"}</strong>
              <small
                className={
                  data.phenotype.status === "REASSESSMENT_REQUIRED"
                    ? "attention"
                    : ""
                }
              >
                {displayHfCode(data.phenotype.status)}
              </small>
            </div>
            <div>
              <span>Clinical status</span>
              <strong>{displayHfCode(review?.status)}</strong>
              <small>{displayHfCode(review?.presentation)}</small>
            </div>
            <div>
              <span>Preferred LVEF</span>
              <strong>
                {echo?.lvef === null || !echo
                  ? "Not recorded"
                  : `${echo.lvef}%`}
              </strong>
              <small>
                {echo
                  ? `${date(echo.observed_at)} · ${echo.source_label}`
                  : "No imaging source"}
              </small>
            </div>
            <div>
              <span>Function / congestion</span>
              <strong>
                {review?.nyha_class
                  ? `NYHA ${review.nyha_class}`
                  : "Not assessed"}
              </strong>
              <small>{displayHfCode(review?.clinician_congestion)}</small>
            </div>
          </div>
          {data.phenotype.status === "REASSESSMENT_REQUIRED" ? (
            <div className="hf-reassessment" role="alert">
              <AlertTriangle size={18} />
              <div>
                <strong>Phenotype reassessment required</strong>
                <span>{data.phenotype.reason}</span>
              </div>
              {role === "clinician" ? (
                <button
                  className="secondary small"
                  onClick={() => setAction("review")}
                >
                  Review now
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="hf-dashboard-grid">
            <div className="hf-compact-card">
              <h3>
                <AlertTriangle size={17} /> Needs attention
              </h3>
              {data.gaps.length ? (
                <ul>
                  {data.gaps.slice(0, 5).map((gap) => (
                    <li key={gap.key}>{gap.label}</li>
                  ))}
                </ul>
              ) : (
                <p className="hf-clear">
                  <CheckCircle2 size={16} /> Core HF documentation is complete.
                </p>
              )}
            </div>
            <div className="hf-compact-card">
              <h3>
                <Activity size={17} /> Current evidence
              </h3>
              <dl className="hf-key-values">
                {coreLabs.slice(0, 5).map((item) => (
                  <div key={item.id}>
                    <dt>{item.display}</dt>
                    <dd>
                      {item.value} {item.unit}
                    </dd>
                  </div>
                ))}
                {!coreLabs.length ? (
                  <p className="muted">
                    No current HF-related laboratory results.
                  </p>
                ) : null}
              </dl>
            </div>
            <div className="hf-compact-card">
              <h3>
                <HeartPulse size={17} /> Current therapy
              </h3>
              {data.medications.length ? (
                <ul>
                  {data.medications.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      {item.generic_name}
                      {item.dose_value
                        ? ` · ${item.dose_value} ${item.dose_unit}`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  No active structured medication therapy.
                </p>
              )}
            </div>
            <div className="hf-compact-card">
              <h3>
                <CalendarClock size={17} /> Next actions
              </h3>
              {openTasks.length ? (
                <ul>
                  {openTasks.map((task) => (
                    <li key={task.id}>
                      {task.purpose}
                      {task.target_date ? (
                        <small>{date(task.target_date)}</small>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No open HF care tasks.</p>
              )}
            </div>
          </div>
        </>
      )}
      {role === "clinician" ? (
        <div className="hf-action-row">
          <button onClick={() => setAction("echo")}>
            <Stethoscope size={16} /> Add cardiac imaging
          </button>
          <button onClick={() => setAction("pathway")}>
            <ClipboardCheck size={16} /> Assess clinical issue
          </button>
          <button onClick={() => setAction("discharge")}>
            <CalendarClock size={16} /> Discharge plan
          </button>
          <button onClick={() => setAction("device")}>
            <HeartPulse size={16} /> Device review
          </button>
          <button onClick={() => setAction("rehabilitation")}>
            <Activity size={16} /> Rehabilitation
          </button>
          <button onClick={() => setAction("note")}>
            <FileText size={16} /> Draft note
          </button>
        </div>
      ) : null}
      {action === "review" ? (
        <HfJourneyWizard
          patientId={patientId}
          data={data}
          encounters={encounters}
          onClose={() => setAction(null)}
          onSaved={done}
        />
      ) : null}
      {action === "pathway" ? (
        <HfComplicationWizard
          patientId={patientId}
          data={data}
          encounters={encounters}
          initialType={initialComplication}
          onClose={() => setAction(null)}
          onSaved={() => done()}
        />
      ) : null}
      {action === "discharge" ? (
        <HfDischargeWizard
          patientId={patientId}
          data={data}
          encounters={encounters}
          onClose={() => setAction(null)}
          onSaved={() => done()}
        />
      ) : null}
      {action &&
      action !== "review" &&
      action !== "pathway" &&
      action !== "discharge" &&
      action !== "note" ? (
        <HfActionModal
          action={action}
          patientId={patientId}
          data={data}
          encounters={encounters}
          onClose={() => setAction(null)}
          onSaved={done}
        />
      ) : null}
      {action === "note" ? (
        <HfNote patientId={patientId} onClose={() => setAction(null)} />
      ) : null}
    </section>
  );
}

function HfActionModal({
  action,
  patientId,
  data,
  encounters,
  onClose,
  onSaved,
}: {
  action: Exclude<Action, "note">;
  patientId: string;
  data: HfState;
  encounters: CareEncounter[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [observedAt, setObservedAt] = useState(nowLocal());
  const [encounterId, setEncounterId] = useState(
    encounters.find((item) => item.state === "open")?.id ?? "",
  );
  const [status, setStatus] = useState(
    data.currentReview?.status ?? "CURRENT_SYMPTOMATIC",
  );
  const [presentation, setPresentation] = useState(
    data.currentReview?.presentation ?? "CHRONIC_STABLE",
  );
  const [nyha, setNyha] = useState(
    data.currentReview?.nyha_class ?? "NOT_ASSESSED",
  );
  const [congestion, setCongestion] = useState(
    data.currentReview?.clinician_congestion ?? "NOT_ASSESSED",
  );
  const [phenotype, setPhenotype] = useState(
    data.currentReview?.clinician_phenotype ?? "UNCLASSIFIED",
  );
  const [etiologies, setEtiologies] = useState<string[]>(
    data.currentReview?.etiologies ?? [],
  );
  const [symptoms, setSymptoms] = useState<string[]>(
    data.currentReview?.symptoms.map((item) => item.symptom) ?? [],
  );
  const [narrative, setNarrative] = useState("");
  const [lvef, setLvef] = useState(data.preferredEcho?.lvef?.toString() ?? "");
  const [source, setSource] = useState("Formal echocardiogram");
  const [quality, setQuality] = useState("GOOD");
  const [rv, setRv] = useState("NOT_REPORTED");
  const [pathway, setPathway] = useState("DIAGNOSTIC");
  const [pathwayState, setPathwayState] = useState("");
  const [severity, setSeverity] = useState("NOT_ASSESSED");
  const [missing, setMissing] = useState("");
  const [considerations, setConsiderations] = useState("");
  const [deviceType, setDeviceType] = useState("ICD");
  const [deviceStatus, setDeviceStatus] = useState("CANNOT_ASSESS");
  const [reassessmentDate, setReassessmentDate] = useState("");
  const [rationale, setRationale] = useState("");
  const [stability, setStability] = useState("NOT_ASSESSED");
  const [labDate, setLabDate] = useState("");
  const [clinicDate, setClinicDate] = useState("");
  const [echoDate, setEchoDate] = useState("");
  const [checks, setChecks] = useState<string[]>([]);
  const [rehabStatus, setRehabStatus] = useState("NOT_ASSESSED");
  const [referralDate, setReferralDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const common = {
    encounter_id: encounterId || null,
    observed_at: toIso(observedAt),
  };
  const split = (value: string) =>
    value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (action === "review")
        await api(`/patients/${patientId}/heart-failure/reviews`, {
          ...common,
          status,
          presentation,
          symptoms: symptoms.map((symptom) => ({
            symptom,
            severity: "not_recorded",
            change: "not_recorded",
          })),
          symptoms_reviewed_unchanged: !symptoms.length,
          nyha_class: nyha,
          etiologies,
          physical_findings: {},
          clinician_congestion: congestion,
          clinician_phenotype: phenotype,
          phenotype_source_echo_id: data.preferredEcho?.id ?? null,
          therapy_decisions: [],
          narrative,
        });
      if (action === "echo")
        await api(`/patients/${patientId}/heart-failure/echoes`, {
          ...common,
          study_type: "FORMAL_TTE",
          study_quality: quality,
          lvef: lvef === "" ? null : Number(lvef),
          rv_function: rv,
          valve_summary: [],
          pulmonary_pressure_context: "",
          diastolic_context: "",
          pericardial_context: "",
          structural_context: narrative,
          source_label: source,
          verification_status: "verified",
        });
      if (action === "pathway")
        await api(`/patients/${patientId}/heart-failure/pathways`, {
          ...common,
          pathway_type: pathway,
          state: pathwayState,
          severity,
          patient_data: {},
          missing_information: split(missing),
          considerations: split(considerations),
          medication_implications: [],
          monitoring_plan: {},
          escalation: narrative,
          evidence_note: "",
        });
      if (action === "device")
        await api(`/patients/${patientId}/heart-failure/device-assessments`, {
          ...common,
          device_type: deviceType,
          assessment_status: deviceStatus,
          input_snapshot: {},
          missing_information: split(missing),
          rationale,
          reassessment_date: reassessmentDate || null,
        });
      if (action === "discharge")
        await api(`/patients/${patientId}/heart-failure/discharge-reviews`, {
          ...common,
          clinical_stability: stability,
          congestion_reviewed: checks.includes("congestion"),
          medication_reconciliation: checks.includes("medications"),
          renal_electrolytes_reviewed: checks.includes("renal"),
          titration_plan_reviewed: checks.includes("titration"),
          education_reviewed: checks.includes("education"),
          rehabilitation_reviewed: checks.includes("rehab"),
          outstanding_items: split(missing),
          laboratory_date: labDate || null,
          clinic_date: clinicDate || null,
          echo_date: echoDate || null,
          device_reassessment_date: reassessmentDate || null,
          note: narrative,
        });
      if (action === "rehabilitation")
        await api(`/patients/${patientId}/heart-failure/rehabilitation`, {
          ...common,
          status: rehabStatus,
          limitation: missing,
          referral_date: referralDate || null,
          planned_start_date: startDate || null,
          exercise_context: considerations,
          note: narrative,
        });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const titles: Record<Exclude<Action, "note">, string> = {
    review: "Structured heart failure review",
    echo: "Add cardiac imaging",
    pathway: "Assess an HF clinical issue",
    device: "Device assessment",
    discharge: "HF discharge and follow-up plan",
    rehabilitation: "Cardiac rehabilitation",
  };
  return (
    <Modal title={titles[action]} onClose={onClose} wide>
      <form className="stack hf-editor" onSubmit={submit}>
        <ErrorBox message={error} />
        <div className="form-grid compact">
          <label>
            Care context
            <select
              value={encounterId}
              onChange={(e) => setEncounterId(e.target.value)}
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
              onChange={(e) => setObservedAt(e.target.value)}
            />
          </label>
        </div>
        {action === "review" ? (
          <>
            <div className="form-grid">
              <label>
                Clinical status
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                >
                  {hfStatuses.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Presentation
                <select
                  value={presentation}
                  onChange={(e) => setPresentation(e.target.value as any)}
                >
                  {hfPresentations.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Functional class
                <select
                  value={nyha ?? "NOT_ASSESSED"}
                  onChange={(e) => setNyha(e.target.value as any)}
                >
                  {["NOT_ASSESSED", "I", "II", "III", "IV"].map((value) => (
                    <option key={value} value={value}>
                      {value === "NOT_ASSESSED"
                        ? "Not assessed"
                        : `NYHA ${value}`}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Congestion
                <select
                  value={congestion ?? "NOT_ASSESSED"}
                  onChange={(e) => setCongestion(e.target.value)}
                >
                  {[
                    "NOT_ASSESSED",
                    "NO_EVIDENT_CONGESTION",
                    "POSSIBLE_CONGESTION",
                    "CLINICALLY_CONGESTED",
                    "SEVERE_OR_WORSENING",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {displayHfCode(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Clinician-confirmed phenotype
                <select
                  value={phenotype ?? "UNCLASSIFIED"}
                  onChange={(e) => setPhenotype(e.target.value as any)}
                >
                  <option>UNCLASSIFIED</option>
                  <option>HFrEF</option>
                  <option>HFpEF</option>
                </select>
                <small>
                  Confirm using the preferred imaging result and the complete
                  clinical context.
                </small>
              </label>
              <label>
                Preferred imaging source
                <input
                  readOnly
                  value={
                    data.preferredEcho
                      ? `${data.preferredEcho.source_label} · ${data.preferredEcho.lvef ?? "LVEF not recorded"}${data.preferredEcho.lvef === null ? "" : "%"}`
                      : "No preferred imaging"
                  }
                />
              </label>
            </div>
            <fieldset>
              <legend>Current symptoms</legend>
              <div className="choice-grid">
                {hfSymptoms.map((item) => (
                  <label key={item}>
                    <input
                      type="checkbox"
                      checked={symptoms.includes(item)}
                      onChange={() =>
                        setSymptoms((current) =>
                          current.includes(item)
                            ? current.filter((value) => value !== item)
                            : [...current, item],
                        )
                      }
                    />{" "}
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Aetiology / mechanism</legend>
              <div className="choice-grid">
                {hfEtiologies.map((item) => (
                  <label key={item}>
                    <input
                      type="checkbox"
                      checked={etiologies.includes(item)}
                      onChange={() =>
                        setEtiologies((current) =>
                          current.includes(item)
                            ? current.filter((value) => value !== item)
                            : [...current, item],
                        )
                      }
                    />{" "}
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Clinical narrative
              <textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
              />
            </label>
          </>
        ) : null}
        {action === "echo" ? (
          <>
            <div className="form-grid">
              <label>
                Source / report label
                <input
                  required
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <label>
                LVEF (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={lvef}
                  onChange={(e) => setLvef(e.target.value)}
                />
              </label>
              <label>
                Study quality
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                >
                  <option>GOOD</option>
                  <option>FAIR</option>
                  <option>POOR</option>
                  <option>NOT_RECORDED</option>
                </select>
              </label>
              <label>
                RV function
                <select value={rv} onChange={(e) => setRv(e.target.value)}>
                  <option>NORMAL</option>
                  <option>MILDLY_REDUCED</option>
                  <option>MODERATELY_REDUCED</option>
                  <option>SEVERELY_REDUCED</option>
                  <option>NOT_REPORTED</option>
                </select>
              </label>
            </div>
            <label>
              Structural context
              <textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                placeholder="Key structural findings from the source report"
              />
            </label>
          </>
        ) : null}
        {action === "pathway" ? (
          <>
            <div className="form-grid">
              <label>
                Clinical pathway
                <select
                  value={pathway}
                  onChange={(e) => setPathway(e.target.value)}
                >
                  {hfPathways.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Clinician-assessed severity
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                >
                  <option>NOT_ASSESSED</option>
                  <option>LOW</option>
                  <option>MODERATE</option>
                  <option>HIGH</option>
                  <option>CRITICAL</option>
                </select>
              </label>
            </div>
            <label>
              Current state
              <input
                required
                value={pathwayState}
                onChange={(e) => setPathwayState(e.target.value)}
                placeholder="What is happening now?"
              />
            </label>
            <label>
              Missing information (one item per line)
              <textarea
                value={missing}
                onChange={(e) => setMissing(e.target.value)}
              />
            </label>
            <label>
              Clinical considerations (one item per line)
              <textarea
                value={considerations}
                onChange={(e) => setConsiderations(e.target.value)}
              />
            </label>
            <label>
              Escalation / plan
              <textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
              />
            </label>
          </>
        ) : null}
        {action === "device" ? (
          <>
            <div className="form-grid">
              <label>
                Device
                <select
                  value={deviceType}
                  onChange={(e) => setDeviceType(e.target.value)}
                >
                  <option>ICD</option>
                  <option>CRT</option>
                </select>
              </label>
              <label>
                Assessment status
                <select
                  value={deviceStatus}
                  onChange={(e) => setDeviceStatus(e.target.value)}
                >
                  {[
                    "POTENTIAL_ASSESSMENT",
                    "CRITERIA_NOT_MET",
                    "CANNOT_ASSESS",
                    "REASSESSMENT_PLANNED",
                    "EXISTING_DEVICE",
                    "NOT_APPROPRIATE_AFTER_REVIEW",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {displayHfCode(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Exact reassessment date
                <input
                  type="date"
                  value={reassessmentDate}
                  onChange={(e) => setReassessmentDate(e.target.value)}
                />
              </label>
            </div>
            <label>
              Missing information (one item per line)
              <textarea
                value={missing}
                onChange={(e) => setMissing(e.target.value)}
              />
            </label>
            <label>
              Clinician rationale
              <textarea
                required
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </label>
          </>
        ) : null}
        {action === "discharge" ? (
          <>
            <label>
              Clinical stability
              <select
                value={stability}
                onChange={(e) => setStability(e.target.value)}
              >
                <option>NOT_ASSESSED</option>
                <option>CONFIRMED</option>
                <option>NOT_CONFIRMED</option>
              </select>
            </label>
            <fieldset>
              <legend>Reviewed before discharge</legend>
              <div className="choice-grid">
                {[
                  ["congestion", "Congestion"],
                  ["medications", "Medication reconciliation"],
                  ["renal", "Renal function and electrolytes"],
                  ["titration", "Titration plan"],
                  ["education", "Patient education"],
                  ["rehab", "Rehabilitation"],
                ].map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={checks.includes(value)}
                      onChange={() =>
                        setChecks((current) =>
                          current.includes(value)
                            ? current.filter((item) => item !== value)
                            : [...current, value],
                        )
                      }
                    />{" "}
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="form-grid">
              <label>
                Laboratory review date
                <input
                  type="date"
                  value={labDate}
                  onChange={(e) => setLabDate(e.target.value)}
                />
              </label>
              <label>
                HF clinic date
                <input
                  type="date"
                  value={clinicDate}
                  onChange={(e) => setClinicDate(e.target.value)}
                />
              </label>
              <label>
                Repeat imaging date
                <input
                  type="date"
                  value={echoDate}
                  onChange={(e) => setEchoDate(e.target.value)}
                />
              </label>
              <label>
                Device reassessment date
                <input
                  type="date"
                  value={reassessmentDate}
                  onChange={(e) => setReassessmentDate(e.target.value)}
                />
              </label>
            </div>
            <label>
              Outstanding items (one per line)
              <textarea
                value={missing}
                onChange={(e) => setMissing(e.target.value)}
              />
            </label>
            <label>
              Discharge note
              <textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
              />
            </label>
          </>
        ) : null}
        {action === "rehabilitation" ? (
          <>
            <div className="form-grid">
              <label>
                Status
                <select
                  value={rehabStatus}
                  onChange={(e) => setRehabStatus(e.target.value)}
                >
                  {[
                    "NOT_ASSESSED",
                    "ELIGIBILITY_REVIEWED",
                    "REFERRED",
                    "PLANNED",
                    "STARTED",
                    "COMPLETED",
                    "DEFERRED",
                    "NOT_APPROPRIATE",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {displayHfCode(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Referral date
                <input
                  type="date"
                  value={referralDate}
                  onChange={(e) => setReferralDate(e.target.value)}
                />
              </label>
              <label>
                Planned start date
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>
            </div>
            <label>
              Limitation / contraindication
              <textarea
                value={missing}
                onChange={(e) => setMissing(e.target.value)}
              />
            </label>
            <label>
              Exercise and functional context
              <textarea
                value={considerations}
                onChange={(e) => setConsiderations(e.target.value)}
              />
            </label>
            <label>
              Note
              <textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
              />
            </label>
          </>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save to longitudinal record"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function HfNote({
  patientId,
  onClose,
}: {
  patientId: string;
  onClose: () => void;
}) {
  const { data, error } = useData<{ draft: string; requiresApproval: boolean }>(
    `/patients/${patientId}/heart-failure/note-draft`,
  );
  return (
    <Modal title="HF clinic note draft" onClose={onClose} wide>
      <ErrorBox message={error} />
      {data ? (
        <>
          <div className="hf-draft-label">
            <AlertTriangle size={16} /> Requires clinician review and approval
          </div>
          <textarea
            className="hf-note-draft"
            defaultValue={data.draft}
            aria-label="HF clinic note draft"
          />
          <div className="modal-actions">
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <Loading />
      )}
    </Modal>
  );
}

export function HeartFailureClinicalRecord({
  patientId,
  revision,
}: {
  patientId: string;
  revision: number;
}) {
  const { data, error } = useData<HfState>(
    `/patients/${patientId}/heart-failure`,
    revision,
  );
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;
  if (!data.profile) return null;
  const records = [
    ...data.reviews.map((item) => ({
      id: item.id,
      type: "HF review",
      title: `${displayHfCode(item.presentation)} · ${displayHfCode(item.status)}`,
      detail: item.narrative || `NYHA ${item.nyha_class ?? "not assessed"}`,
      date: item.observed_at,
      author: item.author,
    })),
    ...data.echoes.map((item) => ({
      id: item.id,
      type: "Cardiac imaging",
      title: item.source_label,
      detail: item.lvef === null ? "LVEF not recorded" : `LVEF ${item.lvef}%`,
      date: item.observed_at,
      author: item.author,
    })),
    ...data.pathways.map((item) => ({
      id: item.id,
      type: "HF pathway",
      title: displayHfCode(item.pathway_type),
      detail: item.state,
      date: item.observed_at,
      author: item.author,
    })),
  ].sort((a, b) => +new Date(b.date) - +new Date(a.date));
  return (
    <section className="panel care-section hf-record">
      <SectionTitle
        title="Heart failure record"
        subtitle="Structured, time-aware HF observations with source and authorship"
      />
      <div className="hf-record-list">
        {records.map((item) => (
          <article key={item.id}>
            <span>{item.type}</span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
              <small>
                {date(item.date)} · {item.author}
              </small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function HeartFailureTimeline({
  patientId,
  revision,
}: {
  patientId: string;
  revision: number;
}) {
  const { data, error } = useData<HfState>(
    `/patients/${patientId}/heart-failure`,
    revision,
  );
  if (error) return <ErrorBox message={error} />;
  if (!data?.timeline.length) return null;
  return (
    <section className="panel care-section hf-timeline">
      <SectionTitle
        title="Heart failure journey"
        subtitle="Built automatically from the structured clinical record"
      />
      <div className="hf-timeline-list">
        {data.timeline.map((item) => (
          <article key={`${item.type}-${item.id}`}>
            <span>
              <History size={16} />
            </span>
            <div>
              <small>
                {date(item.date)} · {item.type}
              </small>
              <strong>{displayHfCode(item.title)}</strong>
              <p>{displayHfCode(item.detail)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
