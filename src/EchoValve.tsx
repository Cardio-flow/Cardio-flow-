import { useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileHeart,
  GitCompareArrows,
  HeartHandshake,
  HeartPulse,
  Plus,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { api, date, useData } from "./api";
import type { CareEncounter } from "./care-model";
import {
  displayEchoCode,
  echoIndications,
  echoStudyTypes,
  measurementCatalog,
  valveLesions,
  valveNames,
  valveSeverities,
  type EchoStudy,
} from "./echo-valve";
import type { Role } from "./types";
import { Badge, Empty, ErrorBox, Loading, Modal, SectionTitle } from "./ui";

type EchoValveData = {
  studies: EchoStudy[];
  latestStudy: EchoStudy | null;
  preferredStudy: EchoStudy | null;
  previousStudy: EchoStudy | null;
  comparison: {
    code: string;
    label: string;
    previous: number | string;
    current: number | string;
    unit: string;
    intervalDays: number;
    source: string;
    quality: string;
  }[];
  valveStates: {
    id: string;
    valve_name: string;
    lesion_type: string;
    severity: string;
    mechanism: string;
    observed_at: string;
    quality: string;
  }[];
  pathways: any[];
  heartTeam: any[];
  prostheses: any[];
  prostheticComparisons: {
    prosthesis_id: string;
    position: string;
    baselineStudy: EchoStudy;
    currentStudy: EchoStudy;
    changes: EchoValveData["comparison"];
  }[];
  procedures: any[];
  surveillance: any[];
  tasks: any[];
};

const isoNow = () => new Date().toISOString().slice(0, 16);
const metric = (study: EchoStudy | null, code: string) =>
  study?.measurements.find((item) => item.parameter_code === code) ?? null;

export function EchoValveDashboard({
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
  const { data, error } = useData<EchoValveData>(
    `/patients/${patientId}/echo-valve`,
    revision,
  );
  const [action, setAction] = useState<
    | "echo"
    | "pathway"
    | "surveillance"
    | "heart-team"
    | "prosthesis"
    | "procedure"
    | null
  >(null);
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  const preferred = data.preferredStudy,
    lvef = metric(preferred, "lvef"),
    openChecks =
      preferred?.quality_checks.filter(
        (item) => item.severity !== "OPTIONAL_COMPLETENESS",
      ) ?? [],
    activeSurveillance = data.surveillance.filter(
      (item) => item.current_status === "ACTIVE",
    );
  return (
    <>
      <section className="panel care-section echo-valve-dashboard">
        <SectionTitle
          title="Echo & valve intelligence"
          subtitle="One structured imaging record shared with heart failure and valve care."
          action={
            role === "clinician" ? (
              <button className="primary" onClick={() => setAction("echo")}>
                <Plus size={16} /> Add Echo
              </button>
            ) : undefined
          }
        />
        {!preferred ? (
          <Empty title="No structured Echo study">
            Add a complete or focused study to begin longitudinal imaging and
            valve assessment.
          </Empty>
        ) : (
          <>
            <div className="echo-status-strip">
              <div>
                <span>Current preferred study</span>
                <strong>{preferred.source_label}</strong>
                <small>
                  {date(preferred.performed_at)} ·{" "}
                  {displayEchoCode(preferred.study_type)}
                </small>
              </div>
              <div>
                <span>LVEF</span>
                <strong>
                  {lvef?.value_number ?? "—"}
                  {lvef ? "%" : ""}
                </strong>
                <small>{lvef?.method || "Not recorded"}</small>
              </div>
              <div>
                <span>Study quality</span>
                <strong>{displayEchoCode(preferred.study_quality)}</strong>
                <small>
                  {preferred.formality === "FORMAL"
                    ? "Formal study"
                    : "Bedside / limited"}
                </small>
              </div>
              <div>
                <span>Longitudinal change</span>
                <strong>{data.comparison.length}</strong>
                <small>
                  {data.previousStudy
                    ? `Compared with ${date(data.previousStudy.performed_at)}`
                    : "No prior study"}
                </small>
              </div>
            </div>
            {openChecks.length ? (
              <div className="echo-quality-alerts">
                {openChecks.map((item) => (
                  <p key={item.code}>
                    <AlertTriangle size={15} /> {item.message}
                  </p>
                ))}
              </div>
            ) : (
              <p className="echo-quality-clear">
                <CheckCircle2 size={16} /> No important report-quality issues
                detected.
              </p>
            )}
            <div className="echo-valve-columns">
              <div>
                <h3>Current valve state</h3>
                {data.valveStates.length ? (
                  data.valveStates.map((state) => (
                    <article className="valve-state-row" key={state.id}>
                      <span>
                        <strong>{displayEchoCode(state.valve_name)}</strong>
                        <small>
                          {displayEchoCode(state.lesion_type)}
                          {state.mechanism ? ` · ${state.mechanism}` : ""}
                        </small>
                      </span>
                      <Badge
                        tone={
                          state.severity === "SEVERE" ? "overdue" : "active"
                        }
                      >
                        {displayEchoCode(state.severity)}
                      </Badge>
                    </article>
                  ))
                ) : (
                  <p className="muted">No finalized structured valve lesion.</p>
                )}
              </div>
              <div>
                <h3>Change from relevant prior study</h3>
                {data.comparison.length ? (
                  data.comparison.slice(0, 6).map((change) => (
                    <article className="echo-change-row" key={change.code}>
                      <strong>{change.label}</strong>
                      <span>
                        {change.previous}
                        {change.unit} <ArrowRight size={13} /> {change.current}
                        {change.unit}
                      </span>
                    </article>
                  ))
                ) : (
                  <p className="muted">
                    No structured interval change available.
                  </p>
                )}
              </div>
            </div>
            {preferred.conclusion ? (
              <div className="echo-conclusion">
                <span>Clinician conclusion</span>
                <p>{preferred.conclusion}</p>
              </div>
            ) : null}
            {data.prostheticComparisons?.map((comparison) => (
              <div className="echo-conclusion" key={comparison.prosthesis_id}>
                <span>
                  {displayEchoCode(comparison.position)} prosthesis · baseline
                  comparison
                </span>
                <p>
                  Baseline {date(comparison.baselineStudy.performed_at)} →
                  current {date(comparison.currentStudy.performed_at)}.{" "}
                  {comparison.changes.length} structured prosthetic/valve
                  changes require clinician review; no mechanism is diagnosed
                  automatically.
                </p>
              </div>
            ))}
          </>
        )}
        {role === "clinician" ? (
          <div className="echo-actions">
            <button className="secondary" onClick={() => setAction("pathway")}>
              <GitCompareArrows size={15} /> Valve assessment
            </button>
            <button
              className="secondary"
              onClick={() => setAction("surveillance")}
            >
              <CalendarClock size={15} /> Surveillance
            </button>
            <button
              className="secondary"
              onClick={() => setAction("heart-team")}
            >
              <HeartHandshake size={15} /> Heart Team
            </button>
            <button
              className="secondary"
              onClick={() => setAction("prosthesis")}
            >
              <ShieldCheck size={15} /> Prosthesis
            </button>
            <button
              className="secondary"
              onClick={() => setAction("procedure")}
            >
              <Stethoscope size={15} /> Valve procedure
            </button>
          </div>
        ) : null}
        {activeSurveillance.length ? (
          <div className="surveillance-list">
            <h3>Active surveillance</h3>
            {activeSurveillance.map((plan) => (
              <p key={plan.id}>
                <CalendarClock size={15} />
                <strong>
                  {displayEchoCode(plan.valve_name)}{" "}
                  {displayEchoCode(plan.lesion_type)}
                </strong>
                <span>
                  Echo {plan.echo_date ? date(plan.echo_date) : "not scheduled"}{" "}
                  · Review{" "}
                  {plan.clinical_review_date
                    ? date(plan.clinical_review_date)
                    : "not scheduled"}
                </span>
              </p>
            ))}
          </div>
        ) : null}
      </section>
      {action === "echo" ? (
        <EchoStudyEditor
          patientId={patientId}
          encounters={encounters}
          studies={data.studies}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null);
            onChanged();
          }}
        />
      ) : null}
      {action && action !== "echo" ? (
        <ValveActionEditor
          action={action}
          patientId={patientId}
          encounters={encounters}
          studies={data.studies}
          pathways={data.pathways}
          prostheses={data.prostheses}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

type DraftMeasurement = {
  code: string;
  value: string;
  method: string;
  context: string;
};
type DraftValveFinding = {
  id: string;
  valve_name: string;
  lesion_type: string;
  clinician_severity: string;
  mechanism: string;
  discordant: boolean;
};
export function EchoStudyEditor({
  patientId,
  encounters,
  studies,
  onClose,
  onSaved,
}: {
  patientId: string;
  encounters: CareEncounter[];
  studies: EchoStudy[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [studyType, setStudyType] = useState("COMPLETE_TTE"),
    [formality, setFormality] = useState("FORMAL"),
    [performedAt, setPerformedAt] = useState(isoNow()),
    [encounterId, setEncounterId] = useState(
      encounters.find((item) => item.state === "open")?.id ?? "",
    ),
    [status, setStatus] = useState("DRAFT"),
    [quality, setQuality] = useState("GOOD"),
    [qualityReasons, setQualityReasons] = useState<string[]>([]),
    [indications, setIndications] = useState<string[]>([]),
    [section, setSection] = useState("LV"),
    [measurements, setMeasurements] = useState<DraftMeasurement[]>([
      { code: "lvef", value: "", method: "Simpson biplane", context: "" },
    ]),
    [valveName, setValveName] = useState("AORTIC"),
    [lesion, setLesion] = useState("NONE"),
    [severity, setSeverity] = useState("NONE"),
    [mechanism, setMechanism] = useState(""),
    [discordant, setDiscordant] = useState(false),
    [supporting, setSupporting] = useState<string[]>([]),
    [additionalValves, setAdditionalValves] = useState<DraftValveFinding[]>([]),
    [lvFindings, setLvFindings] = useState(""),
    [wallMotion, setWallMotion] = useState(""),
    [rvFunction, setRvFunction] = useState(""),
    [atria, setAtria] = useState(""),
    [diastolic, setDiastolic] = useState(""),
    [pulmonary, setPulmonary] = useState(""),
    [aorta, setAorta] = useState(""),
    [ivc, setIvc] = useState(""),
    [pericardium, setPericardium] = useState(""),
    [massesShunts, setMassesShunts] = useState(""),
    [prostheticDevices, setProstheticDevices] = useState(""),
    [comparisonId, setComparisonId] = useState(studies[0]?.study_id ?? ""),
    [comparison, setComparison] = useState(""),
    [interpretation, setInterpretation] = useState(""),
    [conclusion, setConclusion] = useState(""),
    [overrideReason, setOverrideReason] = useState(""),
    [location, setLocation] = useState(""),
    [reporter, setReporter] = useState("Cardiology team"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const available = measurementCatalog.filter((item) => item[2] === section);
  function addMetric(code: string) {
    if (!measurements.some((item) => item.code === code))
      setMeasurements((items) => [
        ...items,
        { code, value: "", method: "", context: "" },
      ]);
  }
  function updateMetric(
    code: string,
    field: keyof DraftMeasurement,
    value: string,
  ) {
    setMeasurements((items) =>
      items.map((item) =>
        item.code === code ? { ...item, [field]: value } : item,
      ),
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const mapped = measurements
        .filter((item) => item.value !== "")
        .map((item, index) => {
          const definition = measurementCatalog.find(
            (entry) => entry[0] === item.code,
          )!;
          return {
            section: definition[2],
            parameter_code: item.code,
            label: definition[1],
            value_number: Number(item.value),
            value_text: null,
            unit: definition[3],
            method: item.method,
            context: item.context,
            sequence: index,
          };
        });
      await api(`/patients/${patientId}/echo-studies`, {
        encounter_id: encounterId || null,
        study_type: studyType,
        formality,
        performed_at: new Date(performedAt).toISOString(),
        location,
        comparison_study_id: comparisonId || null,
        status,
        indication: indications,
        priority: "ROUTINE",
        study_quality: quality,
        quality_reasons: qualityReasons,
        rhythm_context: "",
        heart_rate: null,
        blood_pressure: "",
        contrast_used: studyType === "CONTRAST_ECHO",
        structured_findings: {
          lvFindings,
          wallMotion,
          rvFunction,
          atrialFindings: atria,
          diastolicContext: diastolic,
          pulmonaryPressureContext: pulmonary,
          aortaContext: aorta,
          ivcContext: ivc,
          pericardialContext: pericardium,
          massesShunts,
          prostheticDevices,
        },
        interpretation,
        comparison_summary: comparison,
        conclusion,
        clinician_override_reason: overrideReason,
        reporting_cardiologist: reporter,
        amendment_reason: "",
        source_label: `${displayEchoCode(studyType)} · ${performedAt.slice(0, 10)}`,
        measurements: mapped,
        valve_findings: [
          ...(lesion === "NONE"
            ? []
            : [
                {
                  valve_name: valveName,
                  lesion_type: lesion,
                  mechanism,
                  clinician_severity: severity,
                  calculated_assessment: null,
                  discordant,
                  supporting_parameters: supporting,
                  morphology: "",
                  narrative: "",
                  override_reason: "",
                },
              ]),
          ...additionalValves
            .filter((item) => item.lesion_type !== "NONE")
            .map((item) => ({
              valve_name: item.valve_name,
              lesion_type: item.lesion_type,
              mechanism: item.mechanism,
              clinician_severity: item.clinician_severity,
              calculated_assessment: null,
              discordant: item.discordant,
              supporting_parameters: mapped.map(
                (measurement) => measurement.parameter_code,
              ),
              morphology: "",
              narrative: "",
              override_reason: "",
            })),
        ],
      });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const sections = [...new Set(measurementCatalog.map((item) => item[2]))];
  return (
    <Modal title="Add structured Echo study" onClose={onClose} wide>
      <form className="echo-editor" onSubmit={submit}>
        <ErrorBox message={error} />
        <section className="guided-section">
          <h3>Study context</h3>
          <div className="form-grid four">
            <label>
              Study type
              <select
                value={studyType}
                onChange={(e) => setStudyType(e.target.value)}
              >
                {echoStudyTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Formality
              <select
                value={formality}
                onChange={(e) => setFormality(e.target.value)}
              >
                <option value="FORMAL">Formal</option>
                <option value="BEDSIDE_LIMITED">Bedside / limited</option>
              </select>
            </label>
            <label>
              Date and time
              <input
                type="datetime-local"
                required
                value={performedAt}
                onChange={(e) => setPerformedAt(e.target.value)}
              />
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="DRAFT">Draft</option>
                <option value="PRELIMINARY">Preliminary</option>
                <option value="FINAL">Final</option>
              </select>
            </label>
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
              Location
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
            <label>
              Quality
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
              >
                <option value="GOOD">Good</option>
                <option value="ADEQUATE">Adequate</option>
                <option value="TECHNICALLY_LIMITED">Technically limited</option>
                <option value="VERY_LIMITED">Very limited</option>
              </select>
            </label>
            <label>
              Reporting cardiologist
              <input
                required
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
              />
            </label>
          </div>
          <div className="choice-cloud">
            <span>Indication</span>
            {echoIndications.map((item) => (
              <button
                type="button"
                className={indications.includes(item) ? "selected" : ""}
                key={item}
                onClick={() =>
                  setIndications((values) =>
                    values.includes(item)
                      ? values.filter((value) => value !== item)
                      : [...values, item],
                  )
                }
              >
                {item}
              </button>
            ))}
          </div>
          {quality.includes("LIMITED") ? (
            <div className="choice-cloud">
              <span>Reason study is limited</span>
              {[
                "Poor acoustic window",
                "Body habitus",
                "Tachycardia",
                "Arrhythmia",
                "Ventilation",
                "Patient cooperation",
                "Other",
              ].map((item) => (
                <button
                  type="button"
                  className={qualityReasons.includes(item) ? "selected" : ""}
                  key={item}
                  onClick={() =>
                    setQualityReasons((values) =>
                      values.includes(item)
                        ? values.filter((value) => value !== item)
                        : [...values, item],
                    )
                  }
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
        </section>
        <section className="guided-section">
          <div className="echo-section-head">
            <div>
              <h3>Measurements</h3>
              <p>Add only measurements relevant to this study.</p>
            </div>
            <select
              aria-label="Measurement section"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              {sections.map((item) => (
                <option key={item}>{displayEchoCode(item)}</option>
              ))}
            </select>
            <select
              aria-label="Add measurement"
              value=""
              onChange={(e) => addMetric(e.target.value)}
            >
              <option value="">+ Add measurement</option>
              {available.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="echo-measurements">
            {measurements.map((item) => {
              const definition = measurementCatalog.find(
                (entry) => entry[0] === item.code,
              )!;
              return (
                <article key={item.code}>
                  <strong>{definition[1]}</strong>
                  <label>
                    Value
                    <div className="unit-input">
                      <input
                        type="number"
                        step="any"
                        value={item.value}
                        onChange={(e) =>
                          updateMetric(item.code, "value", e.target.value)
                        }
                      />
                      <span>{definition[3]}</span>
                    </div>
                  </label>
                  <label>
                    Method
                    <input
                      value={item.method}
                      onChange={(e) =>
                        updateMetric(item.code, "method", e.target.value)
                      }
                      placeholder="Method / view"
                    />
                  </label>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setMeasurements((values) =>
                        values.filter((value) => value.code !== item.code),
                      )
                    }
                  >
                    Remove
                  </button>
                </article>
              );
            })}
          </div>
        </section>
        <section className="guided-section">
          <h3>Integrated findings</h3>
          <div className="form-grid">
            <label>
              LV size/function and geometry
              <textarea
                value={lvFindings}
                onChange={(e) => setLvFindings(e.target.value)}
              />
            </label>
            <label>
              Regional wall motion
              <textarea
                value={wallMotion}
                onChange={(e) => setWallMotion(e.target.value)}
                placeholder="Normal, hypokinetic, akinetic, dyskinetic or aneurysmal by segment/territory"
              />
            </label>
            <label>
              RV size/function
              <textarea
                value={rvFunction}
                onChange={(e) => setRvFunction(e.target.value)}
              />
            </label>
            <label>
              LA / RA findings
              <textarea
                value={atria}
                onChange={(e) => setAtria(e.target.value)}
              />
            </label>
            <label>
              Diastolic function
              <textarea
                value={diastolic}
                onChange={(e) => setDiastolic(e.target.value)}
              />
            </label>
            <label>
              Pulmonary pressure / hemodynamics
              <textarea
                value={pulmonary}
                onChange={(e) => setPulmonary(e.target.value)}
              />
            </label>
            <label>
              Aorta
              <textarea
                value={aorta}
                onChange={(e) => setAorta(e.target.value)}
              />
            </label>
            <label>
              IVC / estimated RA pressure context
              <textarea value={ivc} onChange={(e) => setIvc(e.target.value)} />
            </label>
            <label>
              Pericardium
              <textarea
                value={pericardium}
                onChange={(e) => setPericardium(e.target.value)}
              />
            </label>
            <label>
              Intracardiac masses / shunts
              <textarea
                value={massesShunts}
                onChange={(e) => setMassesShunts(e.target.value)}
              />
            </label>
            <label>
              Prosthetic valves / devices
              <textarea
                value={prostheticDevices}
                onChange={(e) => setProstheticDevices(e.target.value)}
              />
            </label>
          </div>
        </section>
        <section className="guided-section">
          <h3>Valve finding</h3>
          <div className="form-grid four">
            <label>
              Valve
              <select
                value={valveName}
                onChange={(e) => setValveName(e.target.value)}
              >
                {valveNames.map((item) => (
                  <option key={item} value={item}>
                    {displayEchoCode(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lesion
              <select
                value={lesion}
                onChange={(e) => setLesion(e.target.value)}
              >
                {valveLesions.map((item) => (
                  <option key={item} value={item}>
                    {displayEchoCode(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Clinician severity
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                {valveSeverities.map((item) => (
                  <option key={item} value={item}>
                    {displayEchoCode(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mechanism
              <input
                value={mechanism}
                onChange={(e) => setMechanism(e.target.value)}
              />
            </label>
          </div>
          {lesion !== "NONE" ? (
            <>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={discordant}
                  onChange={(e) => setDiscordant(e.target.checked)}
                />{" "}
                Discordant data / requires confirmation
              </label>
              <div className="choice-cloud">
                <span>Supporting measurements</span>
                {measurements
                  .filter((item) => item.value !== "")
                  .map((item) => (
                    <button
                      type="button"
                      key={item.code}
                      className={
                        supporting.includes(item.code) ? "selected" : ""
                      }
                      onClick={() =>
                        setSupporting((values) =>
                          values.includes(item.code)
                            ? values.filter((value) => value !== item.code)
                            : [...values, item.code],
                        )
                      }
                    >
                      {
                        measurementCatalog.find(
                          (entry) => entry[0] === item.code,
                        )?.[1]
                      }
                    </button>
                  ))}
              </div>
            </>
          ) : null}
          {additionalValves.map((finding, index) => (
            <div className="additional-valve" key={finding.id}>
              <strong>Additional valve finding {index + 1}</strong>
              <div className="form-grid four">
                <label>
                  Valve
                  <select
                    value={finding.valve_name}
                    onChange={(e) =>
                      setAdditionalValves((items) =>
                        items.map((item) =>
                          item.id === finding.id
                            ? { ...item, valve_name: e.target.value }
                            : item,
                        ),
                      )
                    }
                  >
                    {valveNames.map((item) => (
                      <option key={item} value={item}>
                        {displayEchoCode(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Lesion
                  <select
                    value={finding.lesion_type}
                    onChange={(e) =>
                      setAdditionalValves((items) =>
                        items.map((item) =>
                          item.id === finding.id
                            ? { ...item, lesion_type: e.target.value }
                            : item,
                        ),
                      )
                    }
                  >
                    {valveLesions.map((item) => (
                      <option key={item} value={item}>
                        {displayEchoCode(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Severity
                  <select
                    value={finding.clinician_severity}
                    onChange={(e) =>
                      setAdditionalValves((items) =>
                        items.map((item) =>
                          item.id === finding.id
                            ? { ...item, clinician_severity: e.target.value }
                            : item,
                        ),
                      )
                    }
                  >
                    {valveSeverities.map((item) => (
                      <option key={item} value={item}>
                        {displayEchoCode(item)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mechanism
                  <input
                    value={finding.mechanism}
                    onChange={(e) =>
                      setAdditionalValves((items) =>
                        items.map((item) =>
                          item.id === finding.id
                            ? { ...item, mechanism: e.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
              </div>
              <div className="additional-valve-actions">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={finding.discordant}
                    onChange={(e) =>
                      setAdditionalValves((items) =>
                        items.map((item) =>
                          item.id === finding.id
                            ? { ...item, discordant: e.target.checked }
                            : item,
                        ),
                      )
                    }
                  />
                  Discordant / requires confirmation
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setAdditionalValves((items) =>
                      items.filter((item) => item.id !== finding.id),
                    )
                  }
                >
                  Remove finding
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="secondary add-valve-finding"
            onClick={() =>
              setAdditionalValves((items) => [
                ...items,
                {
                  id: crypto.randomUUID(),
                  valve_name: "MITRAL",
                  lesion_type: "REGURGITATION",
                  clinician_severity: "INDETERMINATE",
                  mechanism: "",
                  discordant: false,
                },
              ])
            }
          >
            <Plus size={15} /> Add another valve finding
          </button>
        </section>
        <section className="guided-section">
          <h3>Comparison and conclusion</h3>
          <div className="form-grid">
            <label>
              Comparison study
              <select
                value={comparisonId}
                onChange={(e) => setComparisonId(e.target.value)}
              >
                <option value="">No comparison</option>
                {studies.map((item) => (
                  <option key={item.study_id} value={item.study_id}>
                    {date(item.performed_at)} · {item.source_label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Comparison summary
              <textarea
                value={comparison}
                onChange={(e) => setComparison(e.target.value)}
              />
            </label>
            <label>
              Interpretation
              <textarea
                value={interpretation}
                onChange={(e) => setInterpretation(e.target.value)}
              />
            </label>
            <label>
              Clinician conclusion
              <textarea
                required={status === "FINAL"}
                value={conclusion}
                onChange={(e) => setConclusion(e.target.value)}
                placeholder="Required before finalization"
              />
            </label>
            <label className="span-2">
              Clinician override reason (when choosing a competing measurement)
              <textarea
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
              />
            </label>
          </div>
        </section>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? "Saving…"
              : status === "FINAL"
                ? "Finalize Echo"
                : "Save study"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ValveActionEditor({
  action,
  patientId,
  encounters,
  studies,
  pathways,
  prostheses,
  onClose,
  onSaved,
}: {
  action:
    "pathway" | "surveillance" | "heart-team" | "prosthesis" | "procedure";
  patientId: string;
  encounters: CareEncounter[];
  studies: EchoStudy[];
  pathways: any[];
  prostheses: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [encounter, setEncounter] = useState(
      encounters.find((item) => item.state === "open")?.id ?? "",
    ),
    [study, setStudy] = useState(studies[0]?.study_id ?? ""),
    [valve, setValve] = useState("AORTIC"),
    [lesion, setLesion] = useState("STENOSIS"),
    [state, setState] = useState(
      "Cannot determine until missing information is reviewed",
    ),
    [known, setKnown] = useState(""),
    [missing, setMissing] = useState(""),
    [rationale, setRationale] = useState(""),
    [next, setNext] = useState(""),
    [echoDate, setEchoDate] = useState(""),
    [clinicDate, setClinicDate] = useState(""),
    [status, setStatus] = useState("CONSIDER"),
    [plannedDate, setPlannedDate] = useState(""),
    [procedureType, setProcedureType] = useState("TAVI"),
    [prosthesisType, setProsthesisType] = useState("TRANSCATHETER"),
    [procedureDate, setProcedureDate] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lines = (value: string) =>
    value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (action === "pathway")
        await api(`/patients/${patientId}/valve/pathways`, {
          encounter_id: encounter || null,
          pathway_type:
            valve === "MULTIPLE"
              ? "MULTIPLE_VALVE_DISEASE"
              : valve === "AORTIC" && lesion === "STENOSIS"
                ? "SEVERE_AS"
                : valve === "AORTIC"
                  ? "SEVERE_AR"
                  : valve === "MITRAL" && lesion === "STENOSIS"
                    ? "MITRAL_STENOSIS"
                    : valve === "MITRAL"
                      ? "PRIMARY_MR"
                      : "TRICUSPID_REGURGITATION",
          source_study_id: study || null,
          state,
          known_data: lines(known),
          missing_data: lines(missing),
          why_it_matters: rationale,
          next_decision: next,
          strategy_factors: [],
          evidence_note:
            "Candidate Stage 4 pathway; clinical thresholds remain in CLINICAL_REVIEW.",
          observed_at: new Date().toISOString(),
        });
      if (action === "surveillance")
        await api(`/patients/${patientId}/valve/surveillance`, {
          encounter_id: encounter || null,
          valve_name: valve,
          lesion_type: lesion,
          source_study_id: study || null,
          echo_date: echoDate || null,
          clinical_review_date: clinicDate || null,
          acceptable_start: null,
          acceptable_end: null,
          early_review_triggers: lines(missing),
          rationale,
        });
      if (action === "heart-team")
        await api(`/patients/${patientId}/valve/heart-team`, {
          encounter_id: encounter || null,
          source_pathway_id: pathways[0]?.id ?? null,
          status,
          decision: next,
          rationale,
          planned_date: plannedDate || null,
          observed_at: new Date().toISOString(),
        });
      if (action === "prosthesis")
        await api(`/patients/${patientId}/valve/prostheses`, {
          position: valve === "MULTIPLE" ? "AORTIC" : valve,
          prosthesis_type: prosthesisType,
          manufacturer: "",
          model: "",
          size_label: "",
          implanted_on: procedureDate || null,
          implantation_route:
            prosthesisType === "TRANSCATHETER" ? "TRANSCATHETER" : "SURGICAL",
          baseline_echo_id: study || null,
          antithrombotic_context: rationale,
        });
      if (action === "procedure")
        await api(`/patients/${patientId}/valve/procedures`, {
          encounter_id: encounter || null,
          procedure_type: procedureType,
          procedure_date: procedureDate,
          indication: rationale,
          prosthesis_id: prostheses[0]?.id ?? null,
          operator_team: "",
          complications: lines(missing),
          result: next,
          conduction_context: known,
          follow_up_plan: {},
        });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title =
    action === "pathway"
      ? "Valve intervention assessment"
      : action === "surveillance"
        ? "Set valve surveillance"
        : action === "heart-team"
          ? "Heart Team workflow"
          : action === "prosthesis"
            ? "Record prosthetic valve"
            : "Record valve intervention";
  return (
    <Modal title={title} onClose={onClose} wide>
      <form onSubmit={submit} className="valve-action-editor">
        <ErrorBox message={error} />
        <div className="form-grid four">
          <label>
            Care context
            <select
              value={encounter}
              onChange={(e) => setEncounter(e.target.value)}
            >
              <option value="">Continuing record</option>
              {encounters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.kind} · {item.reason}
                </option>
              ))}
            </select>
          </label>
          {action !== "heart-team" ? (
            <>
              <label>
                Valve
                <select
                  value={valve}
                  onChange={(e) => setValve(e.target.value)}
                >
                  {valveNames.map((item) => (
                    <option key={item} value={item}>
                      {displayEchoCode(item)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Lesion
                <select
                  value={lesion}
                  onChange={(e) => setLesion(e.target.value)}
                >
                  {valveLesions
                    .filter((item) => !["NONE", "POST_REPAIR"].includes(item))
                    .map((item) => (
                      <option key={item} value={item}>
                        {displayEchoCode(item)}
                      </option>
                    ))}
                </select>
              </label>
            </>
          ) : null}
          {["pathway", "surveillance", "prosthesis"].includes(action) ? (
            <label>
              Source / baseline Echo
              <select value={study} onChange={(e) => setStudy(e.target.value)}>
                <option value="">Not linked</option>
                {studies.map((item) => (
                  <option key={item.study_id} value={item.study_id}>
                    {date(item.performed_at)} · {item.source_label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {action === "pathway" ? (
          <div className="know-need-grid">
            <label>
              <strong>What we know</strong>
              <textarea
                value={known}
                onChange={(e) => setKnown(e.target.value)}
                placeholder="One item per line"
              />
            </label>
            <label>
              <strong>What is missing</strong>
              <textarea
                value={missing}
                onChange={(e) => setMissing(e.target.value)}
                placeholder="Missing is different from No"
              />
            </label>
            <label>
              <strong>Why it matters</strong>
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </label>
            <label>
              <strong>Next decision</strong>
              <textarea
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <label className="span-2">
              Current clinician assessment
              <input
                required
                value={state}
                onChange={(e) => setState(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        {action === "surveillance" ? (
          <>
            <div className="form-grid">
              <label>
                Exact repeat Echo date
                <input
                  type="date"
                  value={echoDate}
                  onChange={(e) => setEchoDate(e.target.value)}
                />
              </label>
              <label>
                Exact clinical review date
                <input
                  type="date"
                  value={clinicDate}
                  onChange={(e) => setClinicDate(e.target.value)}
                />
              </label>
              <label>
                Rationale
                <textarea
                  required
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                />
              </label>
              <label>
                Earlier-review triggers
                <textarea
                  value={missing}
                  onChange={(e) => setMissing(e.target.value)}
                  placeholder="One trigger per line"
                />
              </label>
            </div>
          </>
        ) : null}
        {action === "heart-team" ? (
          <div className="form-grid">
            <label>
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {[
                  "NOT_CURRENTLY_REQUIRED",
                  "CONSIDER",
                  "REFERRAL_REQUESTED",
                  "REVIEWED",
                  "DECISION_DOCUMENTED",
                  "PROCEDURE_PLANNED",
                ].map((item) => (
                  <option key={item} value={item}>
                    {displayEchoCode(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Planned date
              <input
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
              />
            </label>
            <label>
              Rationale
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </label>
            <label>
              Decision / next step
              <textarea
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        {action === "prosthesis" ? (
          <div className="form-grid">
            <label>
              Type
              <select
                value={prosthesisType}
                onChange={(e) => setProsthesisType(e.target.value)}
              >
                {[
                  "MECHANICAL",
                  "BIOPROSTHETIC",
                  "TRANSCATHETER",
                  "REPAIR",
                  "OTHER",
                  "UNKNOWN",
                ].map((item) => (
                  <option key={item} value={item}>
                    {displayEchoCode(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Implant date
              <input
                type="date"
                value={procedureDate}
                onChange={(e) => setProcedureDate(e.target.value)}
              />
            </label>
            <label className="span-2">
              Antithrombotic context
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        {action === "procedure" ? (
          <div className="form-grid">
            <label>
              Procedure
              <select
                value={procedureType}
                onChange={(e) => setProcedureType(e.target.value)}
              >
                {[
                  "TAVI",
                  "SAVR",
                  "MITRAL_REPAIR",
                  "MITRAL_REPLACEMENT",
                  "TEER",
                  "BALLOON_MITRAL_COMMISSUROTOMY",
                  "TRICUSPID_REPAIR",
                  "TRICUSPID_REPLACEMENT",
                  "TRANSCATHETER_TRICUSPID_INTERVENTION",
                  "OTHER_STRUCTURAL",
                ].map((item) => (
                  <option key={item} value={item}>
                    {displayEchoCode(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input
                required
                type="date"
                value={procedureDate}
                onChange={(e) => setProcedureDate(e.target.value)}
              />
            </label>
            <label>
              Indication
              <textarea
                required
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </label>
            <label>
              Result / follow-up
              <textarea
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <label>
              Conduction context
              <textarea
                value={known}
                onChange={(e) => setKnown(e.target.value)}
              />
            </label>
            <label>
              Complications
              <textarea
                value={missing}
                onChange={(e) => setMissing(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        <div className="clinical-safety-note">
          <ShieldCheck size={17} />
          <span>
            Stage 4 clinical rules remain in Clinical Review. This form records
            clinician-confirmed data and plans; it does not autonomously select
            an intervention.
          </span>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EchoValveClinicalRecord({
  patientId,
  revision,
}: {
  patientId: string;
  revision: number;
}) {
  const { data } = useData<EchoValveData>(
    `/patients/${patientId}/echo-valve`,
    revision,
  );
  if (!data?.studies.length && !data?.pathways.length) return null;
  return (
    <section className="panel care-section">
      <SectionTitle
        title="Echo & valve record"
        subtitle="Finalized imaging, longitudinal valve state, pathways and provenance."
      />
      <div className="record-list">
        {data.studies.map((study) => (
          <details className="echo-record" key={study.study_id}>
            <summary>
              <span>
                <FileHeart size={17} />
                <strong>{study.source_label}</strong>
                <small>
                  {date(study.performed_at)} · {displayEchoCode(study.status)} ·{" "}
                  {study.reporting_cardiologist}
                </small>
              </span>
              <Badge>{displayEchoCode(study.study_quality)}</Badge>
            </summary>
            <div className="echo-record-body">
              <p>{study.conclusion || "No conclusion recorded."}</p>
              <div className="metric-grid">
                {study.measurements.slice(0, 8).map((item) => (
                  <div key={item.id ?? item.parameter_code}>
                    <span>{item.label}</span>
                    <strong>
                      {item.value_number ?? item.value_text} {item.unit}
                    </strong>
                    <small>{item.method}</small>
                  </div>
                ))}
              </div>
              <p className="muted">
                Revision {study.version} · source {study.study_id}
              </p>
            </div>
          </details>
        ))}
        {data.pathways.map((item) => (
          <article className="care-card" key={item.id}>
            <div>
              <strong>{displayEchoCode(item.pathway_type)}</strong>
              <p>{item.state}</p>
              <small>
                {date(item.observed_at)} · {item.author}
              </small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function EchoValveTimeline({
  patientId,
  revision,
}: {
  patientId: string;
  revision: number;
}) {
  const { data } = useData<EchoValveData>(
    `/patients/${patientId}/echo-valve`,
    revision,
  );
  const events = useMemo(
    () =>
      data
        ? [
            ...data.studies.map((item) => ({
              id: `echo-${item.study_id}`,
              when: item.performed_at,
              title: item.source_label,
              type: "Echo",
              detail: item.conclusion || displayEchoCode(item.status),
            })),
            ...data.procedures.map((item) => ({
              id: `procedure-${item.id}`,
              when: item.procedure_date,
              title: displayEchoCode(item.procedure_type),
              type: "Valve intervention",
              detail: item.result || item.indication,
            })),
            ...data.heartTeam.map((item) => ({
              id: `team-${item.id}`,
              when: item.observed_at,
              title: `Heart Team · ${displayEchoCode(item.status)}`,
              type: "Decision",
              detail: item.decision || item.rationale,
            })),
          ].sort(
            (a, b) => new Date(b.when).getTime() - new Date(a.when).getTime(),
          )
        : [],
    [data],
  );
  if (!events.length) return null;
  return (
    <section className="panel care-section">
      <SectionTitle
        title="Echo & valve journey"
        subtitle="Automatically assembled from structured imaging and valve care."
      />
      <div className="echo-timeline">
        {events.map((item) => (
          <article key={item.id}>
            <span className="timeline-dot">
              <Activity size={14} />
            </span>
            <time>{date(item.when)}</time>
            <div>
              <small>{item.type}</small>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
