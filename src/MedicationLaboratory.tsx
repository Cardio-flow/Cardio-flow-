import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  History,
  Minus,
  Pill,
  Search,
  ShieldAlert,
} from "lucide-react";
import { api, currentDate, date, useData } from "./api";
import type { CareEncounter } from "./care-model";
import type { CareEntry } from "./care-model";
import type { ClinicalState, ClinicalValue } from "./clinical-foundation";
import {
  documentedContexts,
  medicationContexts,
  reviewedDosePresets,
} from "./medication-context";
import type {
  CurrentTherapy,
  LabDefinition,
  LabTrend,
  MedicationDefinition,
  TherapyEvent,
} from "./medication-laboratory";
import type { Role } from "./types";
import { Empty, ErrorBox, Loading, Modal, SectionTitle } from "./ui";

type Reaction = {
  id: string;
  medication_id: string | null;
  substance_text: string;
  reaction_type: "ALLERGY" | "INTOLERANCE" | "SIDE_EFFECT" | "UNKNOWN_REACTION";
  reaction: string;
  severity: string;
  status: string;
};

export type MedicationData = {
  current: CurrentTherapy[];
  history: TherapyEvent[];
  adverseReactions: Reaction[];
  monitoringRelations: {
    medication_id: string;
    generic_name: string;
    parameter_type: string;
    parameter_code: string;
    purpose: string;
  }[];
  titrationPlans: {
    id: string;
    therapy_id: string;
    generic_name: string;
    state: string;
    earliest_review_date: string | null;
    planned_titration_date: string | null;
    next_laboratory_date: string | null;
    limitation_type: string | null;
    limitation_reason: string;
    required_checks: string[];
  }[];
};

export type LaboratoryData = { results: unknown[]; trends: LabTrend[] };
type ClinicalIntelligence = {
  state?: ClinicalState;
  alerts: {
    id: string;
    title: string;
    detail: string;
    category: string;
    severity: string;
    recommendation_id: string;
  }[];
  tasks: {
    id: string;
    purpose: string;
    target_date: string | null;
    acceptable_window_start: string | null;
    acceptable_window_end: string | null;
    medication_therapy_id: string | null;
    rule_key: string | null;
    rule_version: number | null;
    details: Record<string, unknown>;
    current: { status: string } | null;
  }[];
  recommendations: {
    current: {
      id: string;
      rule_key: string;
      rule_version: number;
      title: string;
      recommendation: string;
      explanation: string[];
      evidence_snapshot: {
        title: string;
        version: string;
        organization: string;
      }[];
      publication_snapshot: Record<string, unknown>;
      review_snapshot: Record<string, unknown>[];
    }[];
  };
};

function clinicalValueText(value: ClinicalValue) {
  if (value.type === "quantity") return `${value.value} ${value.unit}`;
  if (value.type === "coded") return value.display;
  if (value.type === "text") return value.value;
  if (value.type === "boolean") return value.value ? "Yes" : "No";
  return "Structured value recorded";
}

function MedicationPreStartReview({
  medicationId,
  relations,
  laboratory,
  clinical,
  title = "Before starting",
}: {
  medicationId: string;
  relations: Catalog["monitoringRelations"];
  laboratory: LaboratoryData;
  clinical: ClinicalIntelligence;
  title?: string;
}) {
  const applicableRelations = relations.filter(
    (item) => item.medication_id === medicationId,
  );
  const unique = [
    ...new Map(
      applicableRelations.map((item) => [item.parameter_code, item]),
    ).values(),
  ];
  const missing: string[] = [];
  const rows = unique.map((item) => {
    const trend = laboratory.trends.find(
      (entry) => entry.test_id === item.parameter_code,
    );
    const fact = clinical.state?.concepts.find(
      (entry) => entry.concept_code === item.parameter_code,
    )?.current;
    if (!trend && !fact) missing.push(item.purpose);
    return {
      code: item.parameter_code,
      purpose: item.purpose,
      value: trend
        ? `${trend.latest.original_value} ${trend.latest.original_unit}`
        : fact
          ? clinicalValueText(fact.value)
          : "Not available",
      source: trend
        ? `${date(trend.latest.resulted_at)} · ${trend.latest.verification_status}`
        : fact
          ? `${date(fact.observed_at)} · ${fact.verification_status}`
          : "Needs clinician review",
    };
  });
  const recommendations = clinical.recommendations.current.filter((item) =>
    item.rule_key.includes(medicationId),
  );
  return (
    <div className="medication-prestart-review">
      <h4>{title}</h4>
      {rows.length ? (
        <div className="medication-prestart-list">
          {rows.map((item) => (
            <div key={item.code}>
              <span>
                <strong>{item.purpose}</strong>
                <small>{item.source}</small>
              </span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">
          No medication-specific review parameters are configured for this
          catalog entry. Assess the patient context before confirming.
        </p>
      )}
      {missing.length ? (
        <p className="clinical-warning">
          <AlertTriangle size={17} /> Missing before assessment:{" "}
          {missing.join("; ")}. The clinician may proceed after reviewing this
          limitation.
        </p>
      ) : null}
      {recommendations.map((item) => (
        <div className="clinical-warning" key={item.id}>
          <ShieldAlert size={17} />
          <span>
            <strong>{item.title}</strong>
            <small>
              {item.recommendation} · Published rule {item.rule_key} v
              {item.rule_version}
            </small>
          </span>
        </div>
      ))}
      <small className="muted">
        Values are shown for review. This panel does not interpret them as safe
        or unsafe without a published rule.
      </small>
    </div>
  );
}

type Catalog = {
  medications: MedicationDefinition[];
  groups: { group_id: string; name: string }[];
  indications: { code: string; display: string }[];
  monitoringRelations: {
    medication_id: string;
    parameter_code: string;
    purpose: string;
  }[];
  patientSafety: {
    currentMedicationIds: string[];
    adverseReactions: Reaction[];
  } | null;
};

const statusLabel = (status: string) =>
  status.toLowerCase().replaceAll("_", " ");

function localDateTimeValue(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function MedicationLaboratoryOverview({
  patientId,
  revision,
  role,
  owner,
  onAddMedication,
  onAddLab,
  onChanged,
}: {
  patientId: string;
  revision: number;
  role: Role;
  owner: string;
  onAddMedication: () => void;
  onAddLab: () => void;
  onChanged: () => void;
}) {
  const { data: medications, error: medicationError } = useData<MedicationData>(
    `/patients/${patientId}/medications`,
    revision,
  );
  const { data: laboratory, error: laboratoryError } = useData<LaboratoryData>(
    `/patients/${patientId}/laboratory`,
    revision,
  );
  const { data: clinical, error: clinicalError } =
    useData<ClinicalIntelligence>(
      `/patients/${patientId}/clinical-state`,
      revision,
    );
  const [selected, setSelected] = useState<CurrentTherapy | null>(null);
  if (!medications || !laboratory || !clinical)
    return (
      <section className="panel care-section medication-lab-overview">
        <ErrorBox
          message={medicationError || laboratoryError || clinicalError}
        />
        {!medicationError && !laboratoryError && !clinicalError ? (
          <Loading />
        ) : null}
      </section>
    );
  const openTasks = clinical.tasks.filter(
    (task) =>
      !["completed", "cancelled", "superseded"].includes(
        task.current?.status ?? "open",
      ),
  );
  return (
    <section
      id="medication-laboratory-intelligence"
      className="panel care-section medication-lab-overview"
    >
      <SectionTitle
        title="Medication & laboratory intelligence"
        subtitle="Longitudinal therapy, current results, governed safety review and exact monitoring dates."
      />
      <div className="intelligence-columns">
        <div>
          <div className="subsection-heading">
            <h3>
              <Pill size={17} /> Current medication
            </h3>
            {role === "clinician" ? (
              <button className="text-button" onClick={onAddMedication}>
                Add medication
              </button>
            ) : null}
          </div>
          {medications.current.filter((item) => item.status !== "STOPPED")
            .length ? (
            <div className="intelligence-list">
              {medications.current
                .filter((item) => item.status !== "STOPPED")
                .map((therapy) => {
                  const task = openTasks.find(
                    (item) => item.medication_therapy_id === therapy.id,
                  );
                  const plan = medications.titrationPlans.find(
                    (item) => item.therapy_id === therapy.id,
                  );
                  const hasAlert = clinical.alerts.some((alert) =>
                    clinical.recommendations.current.some(
                      (recommendation) =>
                        recommendation.id === alert.recommendation_id &&
                        recommendation.rule_key.includes(therapy.medication_id),
                    ),
                  );
                  return (
                    <button
                      key={therapy.id}
                      onClick={() => setSelected(therapy)}
                    >
                      <span>
                        <strong>{therapy.generic_name}</strong>
                        <small>
                          {therapy.dose_value !== null
                            ? `${therapy.dose_value} ${therapy.dose_unit ?? ""}`
                            : "Dose not recorded"}
                          {therapy.frequency ? ` · ${therapy.frequency}` : ""}
                        </small>
                      </span>
                      <span className="medication-state-stack">
                        {hasAlert ? (
                          <em className="issue-state">Safety review</em>
                        ) : task ? (
                          <em
                            className={
                              task.target_date &&
                              task.target_date < currentDate()
                                ? "overdue-state"
                                : "monitoring-state"
                            }
                          >
                            {task.target_date &&
                            task.target_date < currentDate()
                              ? "Monitoring overdue"
                              : "Monitoring due"}
                          </em>
                        ) : plan ? (
                          <em className="planned-state">
                            {statusLabel(plan.state)}
                          </em>
                        ) : (
                          <em className="stable-state">
                            {statusLabel(therapy.status)}
                          </em>
                        )}
                        <ArrowRight size={15} />
                      </span>
                    </button>
                  );
                })}
            </div>
          ) : (
            <Empty title="No structured current medications">
              Use Add medication to create a longitudinal medication course.
            </Empty>
          )}
        </div>
        <div>
          <div className="subsection-heading">
            <h3>
              <FlaskConical size={17} /> Recent laboratory trends
            </h3>
            {role === "clinician" ? (
              <button className="text-button" onClick={onAddLab}>
                Add result
              </button>
            ) : null}
          </div>
          {laboratory.trends.length ? (
            <div className="lab-trend-list">
              {laboratory.trends.slice(0, 6).map((trend) => (
                <div key={trend.test_id}>
                  <span>
                    <strong>{trend.display}</strong>
                    <small>{date(trend.latest.collected_at)}</small>
                  </span>
                  <span className="trend-value">
                    {trend.previous ? (
                      <small>{trend.previous.canonical_value} →</small>
                    ) : null}
                    <strong>{trend.latest.canonical_value}</strong>
                    <small>{trend.canonical_unit}</small>
                    {trend.direction === "increasing" ? (
                      <ChevronUp size={15} />
                    ) : trend.direction === "decreasing" ? (
                      <ChevronDown size={15} />
                    ) : (
                      <Minus size={15} />
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No structured laboratory results">
              Add a result with time, unit, verification and provenance.
            </Empty>
          )}
        </div>
      </div>
      {selected ? (
        <MedicationDetail
          therapy={selected}
          data={medications}
          clinical={clinical}
          laboratory={laboratory}
          editable={role === "clinician"}
          owner={owner}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function MedicationDetail({
  therapy,
  data,
  clinical,
  laboratory,
  editable,
  owner,
  onClose,
  onChanged,
}: {
  therapy: CurrentTherapy;
  data: MedicationData;
  clinical: ClinicalIntelligence;
  laboratory: LaboratoryData;
  editable: boolean;
  owner: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [updating, setUpdating] = useState<
    "dose_increased" | "held" | "stopped" | "restarted" | null
  >(null);
  const history = data.history.filter(
    (event) => event.therapy_id === therapy.id,
  );
  const monitoring = data.monitoringRelations.filter(
    (item) => item.medication_id === therapy.medication_id,
  );
  const tasks = clinical.tasks.filter(
    (item) => item.medication_therapy_id === therapy.id,
  );
  const plan = data.titrationPlans.find(
    (item) => item.therapy_id === therapy.id,
  );
  const relevantCodes = new Set(
    monitoring
      .filter((item) => item.parameter_type === "laboratory")
      .map((item) => item.parameter_code),
  );
  const trends = laboratory.trends.filter((item) =>
    relevantCodes.has(item.test_id),
  );
  const recommendations = clinical.recommendations.current.filter(
    (item) =>
      item.rule_key.includes(therapy.medication_id) ||
      tasks.some((task) => task.rule_key === item.rule_key),
  );
  return (
    <Modal title={therapy.generic_name} onClose={onClose} wide>
      <div className="medication-detail-grid">
        <section>
          <span className="eyebrow">CURRENT THERAPY</span>
          <h3>
            {therapy.dose_value !== null
              ? `${therapy.dose_value} ${therapy.dose_unit ?? ""}`
              : "Dose not recorded"}{" "}
            {therapy.frequency ?? ""}
          </h3>
          <p>
            {therapy.trade_name ? `${therapy.trade_name} · ` : ""}
            {therapy.route ?? "Route not recorded"}
          </p>
          <dl className="compact-definition-list">
            <div>
              <dt>Status</dt>
              <dd>{statusLabel(therapy.status)}</dd>
            </div>
            <div>
              <dt>Started / changed</dt>
              <dd>{date(therapy.effective_at)}</dd>
            </div>
            <div>
              <dt>Indication</dt>
              <dd>
                {therapy.indications.length
                  ? therapy.indications.join(", ")
                  : "Not recorded"}
              </dd>
            </div>
            <div>
              <dt>Prescriber</dt>
              <dd>{therapy.prescribing_clinician}</dd>
            </div>
          </dl>
          {editable ? (
            <div className="medication-quick-actions">
              <button
                className="secondary"
                onClick={() => setUpdating("dose_increased")}
              >
                Change dose
              </button>
              {therapy.status === "TEMPORARILY_HELD" ? (
                <button
                  className="secondary"
                  onClick={() => setUpdating("restarted")}
                >
                  Restart
                </button>
              ) : therapy.status === "ACTIVE" ? (
                <>
                  <button
                    className="secondary"
                    onClick={() => setUpdating("held")}
                  >
                    Hold
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setUpdating("stopped")}
                  >
                    Stop
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
        <section>
          <span className="eyebrow">MONITORING</span>
          {tasks.length ? (
            tasks.map((task) => (
              <div className="monitoring-item" key={task.id}>
                <CalendarClock size={17} />
                <span>
                  <strong>{task.purpose}</strong>
                  <small>
                    {task.target_date
                      ? `Target ${date(task.target_date)}`
                      : "Date requires clinician confirmation"}
                    {task.acceptable_window_end
                      ? ` · window ends ${date(task.acceptable_window_end)}`
                      : ""}
                  </small>
                </span>
              </div>
            ))
          ) : (
            <p className="muted">
              No monitoring task has been generated by a published rule.
            </p>
          )}
          {trends.map((trend) => (
            <p key={trend.test_id}>
              <strong>{trend.display}:</strong> {trend.latest.canonical_value}{" "}
              {trend.canonical_unit} · {date(trend.latest.collected_at)}
            </p>
          ))}
        </section>
        <section>
          <span className="eyebrow">DOSE HISTORY</span>
          <div className="dose-history">
            {history.map((event) => (
              <div key={event.id}>
                <History size={15} />
                <span>
                  <strong>{date(event.effective_at)}</strong>
                  <small>
                    {statusLabel(event.event_type)} · {event.dose_value ?? "—"}{" "}
                    {event.dose_unit ?? ""} {event.frequency ?? ""}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <span className="eyebrow">TITRATION</span>
          {plan ? (
            <div className="titration-summary">
              <strong>{statusLabel(plan.state)}</strong>
              {plan.earliest_review_date ? (
                <p>Earliest review: {date(plan.earliest_review_date)}</p>
              ) : null}
              {plan.next_laboratory_date ? (
                <p>Next laboratory review: {date(plan.next_laboratory_date)}</p>
              ) : null}
              {plan.limitation_reason ? <p>{plan.limitation_reason}</p> : null}
              <small>Dose changes always require clinician confirmation.</small>
            </div>
          ) : (
            <p className="muted">No titration plan recorded.</p>
          )}
        </section>
      </div>
      <section className="why-alert">
        <h3>
          <ShieldAlert size={17} /> Why am I seeing this?
        </h3>
        {recommendations.length ? (
          recommendations.map((item) => (
            <div key={item.id}>
              <strong>{item.title}</strong>
              <p>{item.recommendation}</p>
              <small>
                Published rule {item.rule_key} v{item.rule_version}
                {item.evidence_snapshot.length
                  ? ` · ${item.evidence_snapshot.map((evidence) => `${evidence.organization} ${evidence.version}`).join(", ")}`
                  : ""}
              </small>
            </div>
          ))
        ) : (
          <p className="muted">
            No active published medication alert. Relevance mappings alone do
            not create clinical advice.
          </p>
        )}
      </section>
      {updating ? (
        <MedicationEventEditor
          therapy={therapy}
          owner={owner}
          monitoringRelations={data.monitoringRelations}
          laboratory={laboratory}
          clinical={clinical}
          initialEventType={updating}
          onClose={() => setUpdating(null)}
          onSaved={onChanged}
        />
      ) : null}
    </Modal>
  );
}

function MedicationEventEditor({
  therapy,
  owner,
  monitoringRelations,
  laboratory,
  clinical,
  initialEventType,
  onClose,
  onSaved,
}: {
  therapy: CurrentTherapy;
  owner: string;
  monitoringRelations: MedicationData["monitoringRelations"];
  laboratory: LaboratoryData;
  clinical: ClinicalIntelligence;
  initialEventType: "dose_increased" | "held" | "stopped" | "restarted";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [eventType, setEventType] = useState<
      "dose_increased" | "dose_decreased" | "held" | "restarted" | "stopped"
    >(initialEventType),
    [dose, setDose] = useState(
      therapy.dose_value === null ? "" : String(therapy.dose_value),
    ),
    [doseUnit, setDoseUnit] = useState(therapy.dose_unit ?? "mg"),
    [frequency, setFrequency] = useState(therapy.frequency ?? "Once daily"),
    [route, setRoute] = useState(therapy.route ?? "Oral"),
    [effectiveAt, setEffectiveAt] = useState(() =>
      localDateTimeValue(
        new Date(
          Math.max(
            Date.now(),
            new Date(therapy.effective_at).getTime() + 60_000,
          ),
        ),
      ),
    ),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const status =
    eventType === "held"
      ? "TEMPORARILY_HELD"
      : eventType === "stopped"
        ? "STOPPED"
        : "ACTIVE";
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api(`/medication-therapies/${therapy.id}/events`, {
        status,
        event_type: eventType,
        dose_value: dose ? Number(dose) : null,
        dose_unit: dose ? doseUnit : null,
        frequency: frequency || null,
        route: route || null,
        effective_at: new Date(effectiveAt).toISOString(),
        indications: therapy.indications,
        prescribing_clinician: owner,
        reason,
        discontinuation_date:
          eventType === "stopped" ? effectiveAt.slice(0, 10) : null,
        target_dose_value: therapy.target_dose_value,
        target_dose_unit: therapy.target_dose_unit,
        planned_next_dose_value: therapy.planned_next_dose_value,
        planned_next_dose_unit: therapy.planned_next_dose_unit,
        planned_titration_date: therapy.planned_titration_date,
      });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const needsReason = eventType === "held" || eventType === "stopped";
  return (
    <Modal title={`Update ${therapy.generic_name}`} onClose={onClose}>
      <p className="modal-intro">
        Current dose: {therapy.dose_value ?? "not recorded"}{" "}
        {therapy.dose_unit ?? ""}
        {therapy.frequency ? ` · ${therapy.frequency}` : ""}. Confirm the change
        after reviewing the current clinical context.
      </p>
      <MedicationPreStartReview
        medicationId={therapy.medication_id}
        relations={monitoringRelations}
        laboratory={laboratory}
        clinical={clinical}
        title="Before changing"
      />
      <div className="form-grid">
        <label>
          Change
          <select
            value={eventType}
            onChange={(event) =>
              setEventType(event.target.value as typeof eventType)
            }
          >
            <option value="dose_increased">Dose increased</option>
            <option value="dose_decreased">Dose decreased</option>
            <option value="held">Temporarily held</option>
            <option value="restarted">Restarted</option>
            <option value="stopped">Stopped</option>
          </select>
        </label>
        <label>
          Effective date and time
          <input
            type="datetime-local"
            value={effectiveAt}
            onChange={(event) => setEffectiveAt(event.target.value)}
          />
        </label>
        <label>
          Dose
          <input
            type="number"
            min="0"
            step="any"
            value={dose}
            onChange={(event) => setDose(event.target.value)}
          />
        </label>
        <label>
          Dose unit
          <input
            value={doseUnit}
            onChange={(event) => setDoseUnit(event.target.value)}
          />
        </label>
        <label>
          Frequency
          <select
            value={frequency}
            onChange={(event) => setFrequency(event.target.value)}
          >
            <option>Once daily</option>
            <option>Twice daily</option>
            <option>Three times daily</option>
            <option>Weekly</option>
            <option>As required</option>
          </select>
        </label>
        <label>
          Route
          <select
            value={route}
            onChange={(event) => setRoute(event.target.value)}
          >
            <option>Oral</option>
            <option>Intravenous</option>
            <option>Subcutaneous</option>
            <option>Transdermal</option>
            <option>Inhaled</option>
          </select>
        </label>
        <label className="full-span">
          Reason {needsReason ? "(required)" : "(optional)"}
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              needsReason
                ? "Record the clinical reason"
                : "Add context only when useful"
            }
          />
        </label>
      </div>
      <ErrorBox message={error} />
      <div className="modal-actions">
        <button className="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy || !effectiveAt || !dose || (needsReason && !reason)}
        >
          {busy ? "Saving…" : "Confirm update"}
        </button>
      </div>
    </Modal>
  );
}

export function MedicationEditor({
  patientId,
  owner,
  encounters,
  activeProblems,
  comorbidities,
  onClose,
  onSaved,
}: {
  patientId: string;
  owner: string;
  encounters: CareEncounter[];
  activeProblems: CareEntry[];
  comorbidities: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, error: loadError } = useData<Catalog>(
    `/medications/catalog?patientId=${patientId}`,
  );
  const { data: laboratory, error: laboratoryError } = useData<LaboratoryData>(
    `/patients/${patientId}/laboratory`,
  );
  const { data: clinical, error: clinicalError } =
    useData<ClinicalIntelligence>(`/patients/${patientId}/clinical-state`);
  const [query, setQuery] = useState(""),
    [indicationQuery, setIndicationQuery] = useState(""),
    [group, setGroup] = useState(""),
    [scope, setScope] = useState("relevant"),
    [selectedId, setSelectedId] = useState(""),
    [indications, setIndications] = useState<string[]>([]),
    [dose, setDose] = useState(""),
    [doseUnit, setDoseUnit] = useState("mg"),
    [frequency, setFrequency] = useState(""),
    [route, setRoute] = useState(""),
    [startDate, setStartDate] = useState(currentDate()),
    [encounterId, setEncounterId] = useState(
      encounters.find((item) => item.state === "open")?.id ?? "",
    ),
    [confirmDuplicate, setConfirmDuplicate] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const patientContexts = documentedContexts(activeProblems, comorbidities);
  const visible = useMemo(
    () =>
      (data?.medications ?? [])
        .filter((item) => {
          const groupMatch =
            !group || item.groups?.some((entry) => entry.group_id === group);
          const values = [
            item.generic_name,
            item.drug_class,
            ...(item.products ?? []).map((product) => product.trade_name),
          ]
            .join(" ")
            .toLowerCase();
          const relevanceMatch =
            scope !== "relevant" ||
            !patientContexts.length ||
            medicationContexts(item, patientContexts).length > 0;
          return (
            groupMatch && relevanceMatch && values.includes(query.toLowerCase())
          );
        })
        .slice(0, 12),
    [data, group, query, scope, patientContexts.join("|")],
  );
  const selected =
    data?.medications.find((item) => item.medication_id === selectedId) ?? null;
  const matchedContexts = selected
    ? medicationContexts(selected, patientContexts)
    : [];
  const effectiveIndications =
    matchedContexts.length === 1 ? matchedContexts : indications;
  const dosePresets = selected ? reviewedDosePresets(selected) : [];
  const duplicate =
    !!selected &&
    !!data?.patientSafety?.currentMedicationIds.includes(
      selected.medication_id,
    );
  const reactions = selected
    ? (data?.patientSafety?.adverseReactions ?? []).filter(
        (reaction) =>
          reaction.medication_id === selected.medication_id ||
          reaction.substance_text.toLowerCase() ===
            selected.generic_name.toLowerCase(),
      )
    : [];
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !selected ||
      !reviewed ||
      !effectiveIndications.length ||
      !dose ||
      !frequency ||
      !route ||
      !laboratory ||
      !clinical
    )
      return;
    const unavailableChecks = [
      ...new Map(
        data!.monitoringRelations
          .filter((item) => item.medication_id === selected.medication_id)
          .map((item) => [item.parameter_code, item]),
      ).values(),
    ]
      .filter(
        (item) =>
          !laboratory.trends.some(
            (trend) => trend.test_id === item.parameter_code,
          ) &&
          !clinical.state?.concepts.some(
            (concept) =>
              concept.concept_code === item.parameter_code && concept.current,
          ),
      )
      .map((item) => item.parameter_code);
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${patientId}/medications`, {
        medication_id: selected.medication_id,
        product_id: null,
        encounter_id: encounterId || null,
        source_type: "clinician",
        confirm_existing_course: confirmDuplicate,
        event: {
          status: "ACTIVE",
          event_type: "started",
          dose_value: dose ? Number(dose) : null,
          dose_unit: dose ? doseUnit : null,
          frequency: frequency || null,
          route: route || null,
          effective_at: `${startDate}T09:00:00.000Z`,
          indications: effectiveIndications,
          prescribing_clinician: owner,
          reason:
            `${matchedContexts.length === 1 ? "Indication matched to documented active problem; clinician reviewed" : "Indication selected by clinician"}${unavailableChecks.length ? `; pre-start data unavailable: ${unavailableChecks.join(", ")}` : ""}`.slice(
              0,
              1000,
            ),
        },
      });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add medication" onClose={onClose} wide>
      <ErrorBox message={error || loadError} />
      {!data ? (
        <Loading />
      ) : (
        <form className="medication-editor" onSubmit={submit}>
          <section>
            <span className="step-number">1</span>
            <h3>Choose a clinical group and medication</h3>
            <div
              className="medication-context-bar"
              aria-label="Medication context"
            >
              <button
                type="button"
                className={scope === "relevant" ? "selected" : "secondary"}
                onClick={() => {
                  setScope("relevant");
                  setGroup("");
                }}
              >
                Most relevant
              </button>
              <button
                type="button"
                className={scope === "all" ? "selected" : "secondary"}
                onClick={() => {
                  setScope("all");
                  setGroup("");
                }}
              >
                Search all medications
              </button>
              {patientContexts.length ? (
                <small>
                  Based on documented problems:{" "}
                  {patientContexts
                    .map(
                      (item) =>
                        data.indications.find((entry) => entry.code === item)
                          ?.display ?? item,
                    )
                    .join(", ")}
                  . This is a navigation aid, not a treatment recommendation.
                </small>
              ) : (
                <small>
                  No matching structured diagnosis documented. Search all
                  medications or add a diagnosis.
                </small>
              )}
            </div>
            {scope === "relevant" && patientContexts.length ? (
              <div className="medication-group-chips">
                {data.groups
                  .filter((item) =>
                    data.medications.some(
                      (medication) =>
                        medication.groups?.some(
                          (entry) => entry.group_id === item.group_id,
                        ) &&
                        medicationContexts(medication, patientContexts).length,
                    ),
                  )
                  .map((item) => (
                    <button
                      type="button"
                      key={item.group_id}
                      className={
                        group === item.group_id ? "selected" : "secondary"
                      }
                      onClick={() =>
                        setGroup(group === item.group_id ? "" : item.group_id)
                      }
                    >
                      {item.name}
                    </button>
                  ))}
              </div>
            ) : null}
            <div className="medication-search-row">
              <label className="global-search compact">
                <Search size={16} />
                <input
                  aria-label="Search medication"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Generic or trade name"
                />
              </label>
              <select
                aria-label="Medication group"
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              >
                <option value="">All clinical groups</option>
                {data.groups.map((item) => (
                  <option key={item.group_id} value={item.group_id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="medication-results">
              {visible.map((item) => (
                <button
                  type="button"
                  className={
                    selectedId === item.medication_id ? "selected" : ""
                  }
                  key={item.medication_id}
                  onClick={() => {
                    setSelectedId(item.medication_id);
                    setIndications([]);
                    setDose("");
                    setDoseUnit("mg");
                    setRoute(item.routes?.length === 1 ? item.routes[0] : "");
                    setFrequency("");
                    setReviewed(false);
                  }}
                >
                  <span>
                    <strong>{item.generic_name}</strong>
                    <small>
                      {item.drug_class} · {item.cardiovascular_category}
                    </small>
                  </span>
                  {item.current_for_patient ? <em>Current</em> : null}
                </button>
              ))}
            </div>
          </section>
          {selected ? (
            <>
              <section>
                <span className="step-number">2</span>
                <h3>Dose and context</h3>
                {matchedContexts.length === 1 ? (
                  <p className="context-note">
                    Linked to the documented{" "}
                    {data.indications.find(
                      (item) => item.code === matchedContexts[0],
                    )?.display ?? matchedContexts[0]}{" "}
                    context. Confirm this at the safety review.
                  </p>
                ) : (
                  <p className="context-note">
                    {matchedContexts.length > 1
                      ? "More than one documented context matches. Choose the primary indication."
                      : "No matching documented diagnosis. Choose an indication before saving."}
                  </p>
                )}
                {matchedContexts.length !== 1 ? (
                  <div>
                    <label>
                      Search structured indications
                      <input
                        value={indicationQuery}
                        onChange={(event) =>
                          setIndicationQuery(event.target.value)
                        }
                        placeholder="Find a diagnosis or reason"
                      />
                    </label>
                    <div className="checkbox-chip-list">
                      {data.indications
                        .filter((item) =>
                          `${item.display} ${item.code}`
                            .toLowerCase()
                            .includes(indicationQuery.toLowerCase()),
                        )
                        .map((item) => (
                          <label key={item.code}>
                            <input
                              type="checkbox"
                              checked={indications.includes(item.code)}
                              onChange={() =>
                                setIndications((values) =>
                                  values.includes(item.code)
                                    ? values.filter(
                                        (value) => value !== item.code,
                                      )
                                    : [...values, item.code],
                                )
                              }
                            />
                            {item.display}
                          </label>
                        ))}
                    </div>
                  </div>
                ) : null}
                {dosePresets.length ? (
                  <div
                    className="medication-dose-presets"
                    aria-label="Reviewed dose options"
                  >
                    {dosePresets.map((preset) => (
                      <button
                        type="button"
                        className={
                          dose === String(preset.value) &&
                          doseUnit === preset.unit
                            ? "selected"
                            : "secondary"
                        }
                        key={`${preset.value}-${preset.unit}`}
                        onClick={() => {
                          setDose(String(preset.value));
                          setDoseUnit(preset.unit);
                        }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">
                    No independently reviewed dose presets are published for
                    this medication. Enter the clinician-selected dose.
                  </p>
                )}
                <div className="form-grid compact-form">
                  <label>
                    Dose
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={dose}
                      onChange={(event) => setDose(event.target.value)}
                    />
                  </label>
                  <label>
                    Unit
                    <input
                      value={doseUnit}
                      onChange={(event) => setDoseUnit(event.target.value)}
                    />
                  </label>
                  <label>
                    Frequency
                    <select
                      value={frequency}
                      onChange={(event) => setFrequency(event.target.value)}
                      required
                    >
                      <option value="">Choose frequency</option>
                      {selected.common_frequencies.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Route
                    <select
                      value={route}
                      onChange={(event) => setRoute(event.target.value)}
                      required
                    >
                      <option value="">Choose route</option>
                      {[
                        ...new Set([
                          ...(selected.routes?.length
                            ? selected.routes
                            : ["Oral"]),
                          "Other",
                        ]),
                      ].map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Start date
                    <input
                      type="date"
                      value={startDate}
                      max={currentDate()}
                      onChange={(event) => setStartDate(event.target.value)}
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
                      {encounters.map((encounter) => (
                        <option key={encounter.id} value={encounter.id}>
                          {encounter.kind} · {encounter.reason}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
              <section className="safety-confirm">
                <span className="step-number">3</span>
                <h3>Review safety context</h3>
                <ErrorBox message={laboratoryError || clinicalError} />
                {laboratory && clinical ? (
                  <MedicationPreStartReview
                    medicationId={selected.medication_id}
                    relations={data.monitoringRelations}
                    laboratory={laboratory}
                    clinical={clinical}
                  />
                ) : (
                  <Loading />
                )}
                {reactions.length ? (
                  <div className="clinical-warning">
                    <AlertTriangle size={18} />
                    <span>
                      <strong>Recorded reaction found</strong>
                      {reactions.map((reaction) => (
                        <small key={reaction.id}>
                          {statusLabel(reaction.reaction_type)} ·{" "}
                          {reaction.reaction} · {reaction.severity}
                        </small>
                      ))}
                    </span>
                  </div>
                ) : (
                  <div className="clinical-clear">
                    <CheckCircle2 size={18} /> No matching structured reaction
                    recorded
                  </div>
                )}
                {duplicate ? (
                  <label className="clinical-warning">
                    <input
                      type="checkbox"
                      checked={confirmDuplicate}
                      onChange={(event) =>
                        setConfirmDuplicate(event.target.checked)
                      }
                    />
                    <span>
                      <strong>Current course already exists</strong>
                      <small>
                        Prefer updating the current course. Check only if a
                        distinct concurrent course is intentional.
                      </small>
                    </span>
                  </label>
                ) : null}
                <div className="context-note">
                  <strong>Available safety architecture</strong>
                  <p>
                    Relevant monitoring parameters are mapped for this generic
                    medication. Clinical thresholds, timing and alerts run only
                    when their evidence-linked rule is independently approved
                    and published.
                  </p>
                </div>
                <label className="review-confirm">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(event) => setReviewed(event.target.checked)}
                  />
                  I reviewed the available medication, reaction and monitoring
                  data, including missing items.
                </label>
              </section>
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !reviewed ||
                    !effectiveIndications.length ||
                    !dose ||
                    !frequency ||
                    !route ||
                    !laboratory ||
                    !clinical ||
                    (duplicate && !confirmDuplicate)
                  }
                >
                  {busy ? "Saving…" : "Confirm medication"}
                </button>
              </div>
            </>
          ) : null}
        </form>
      )}
    </Modal>
  );
}

export function LaboratoryEditor({
  patientId,
  encounters,
  onClose,
  onSaved,
}: {
  patientId: string;
  encounters: CareEncounter[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data, error: loadError } = useData<{ tests: LabDefinition[] }>(
    "/laboratory/catalog",
  );
  const [testId, setTestId] = useState(""),
    [value, setValue] = useState(""),
    [unit, setUnit] = useState(""),
    [specimen, setSpecimen] = useState("Serum"),
    [collected, setCollected] = useState(`${currentDate()}T09:00`),
    [resulted, setResulted] = useState(`${currentDate()}T10:00`),
    [source, setSource] = useState("Hospital laboratory"),
    [lab, setLab] = useState(""),
    [assay, setAssay] = useState(""),
    [referenceHigh, setReferenceHigh] = useState(""),
    [verification, setVerification] = useState("verified"),
    [encounterId, setEncounterId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selected = data?.tests.find((item) => item.test_id === testId);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${patientId}/laboratory`, {
        test_id: testId,
        value: Number(value),
        unit,
        specimen: specimen || null,
        collected_at: new Date(collected).toISOString(),
        resulted_at: new Date(resulted).toISOString(),
        source_type: "laboratory",
        source_id: `manual-${crypto.randomUUID()}`,
        source_label: source,
        laboratory_name: lab || null,
        reference_high: referenceHigh ? Number(referenceHigh) : null,
        abnormal_flag: null,
        verification_status: verification,
        provenance: {
          entryMethod: "clinician_structured_entry",
          ...(testId.startsWith("hs-troponin") && assay ? { assay } : {}),
        },
        encounter_id: encounterId || null,
      });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add laboratory result" onClose={onClose} wide>
      <ErrorBox message={error || loadError} />
      {!data ? (
        <Loading />
      ) : (
        <form onSubmit={submit} className="lab-editor">
          <p className="modal-intro">
            Record the original value and unit. CardioFlow preserves both and
            stores a validated canonical value for trends and governed rules.
          </p>
          <div className="form-grid">
            <label>
              Test
              <select
                value={testId}
                onChange={(event) => {
                  const id = event.target.value;
                  setTestId(id);
                  setUnit(
                    data.tests.find((item) => item.test_id === id)
                      ?.canonical_unit ?? "",
                  );
                }}
                required
              >
                <option value="">Select test</option>
                {[...new Set(data.tests.map((item) => item.category))].map(
                  (category) => (
                    <optgroup key={category} label={category}>
                      {data.tests
                        .filter((item) => item.category === category)
                        .map((item) => (
                          <option key={item.test_id} value={item.test_id}>
                            {item.display}
                          </option>
                        ))}
                    </optgroup>
                  ),
                )}
              </select>
            </label>
            <label>
              Value
              <input
                type="number"
                step="any"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                required
              />
            </label>
            <label>
              Original unit
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                required
              >
                <option value="">Select unit</option>
                {selected?.accepted_units.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Specimen
              <select
                value={specimen}
                onChange={(event) => setSpecimen(event.target.value)}
              >
                <option value="">Not specified</option>
                {selected?.specimen_options.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              Collected
              <input
                type="datetime-local"
                value={collected}
                onChange={(event) => setCollected(event.target.value)}
                required
              />
            </label>
            <label>
              Resulted
              <input
                type="datetime-local"
                value={resulted}
                onChange={(event) => setResulted(event.target.value)}
                required
              />
            </label>
            <label>
              Source
              <input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                required
              />
            </label>
            <label>
              Laboratory
              <input
                value={lab}
                onChange={(event) => setLab(event.target.value)}
                placeholder="If known"
              />
            </label>
            {testId.startsWith("hs-troponin") ? (
              <>
                <label>
                  Assay / platform
                  <input
                    value={assay}
                    onChange={(event) => setAssay(event.target.value)}
                    placeholder="Manufacturer and assay, if known"
                  />
                </label>
                <label>
                  Assay-specific upper reference limit (ng/L)
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={referenceHigh}
                    onChange={(event) => setReferenceHigh(event.target.value)}
                    placeholder="If provided by laboratory"
                  />
                </label>
              </>
            ) : null}
            <label>
              Verification
              <select
                value={verification}
                onChange={(event) => setVerification(event.target.value)}
              >
                <option value="verified">Verified</option>
                <option value="preliminary">Preliminary</option>
                <option value="unconfirmed">Unconfirmed</option>
              </select>
            </label>
            <label>
              Care context
              <select
                value={encounterId}
                onChange={(event) => setEncounterId(event.target.value)}
              >
                <option value="">Continuing record</option>
                {encounters.map((encounter) => (
                  <option key={encounter.id} value={encounter.id}>
                    {encounter.kind} · {encounter.reason}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {testId === "creatinine" ? (
            <div className="context-note">
              <strong>Renal estimates</strong>
              <p>
                A verified adult creatinine result generates separate 2021
                CKD-EPI eGFR and Cockcroft–Gault estimates when required inputs
                exist. Each retains its equation, inputs and units; they are
                never treated as interchangeable.
              </p>
            </div>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save result"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
