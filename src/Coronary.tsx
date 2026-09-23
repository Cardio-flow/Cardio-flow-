import { useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  HeartPulse,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { api, date, useData } from "./api";
import type { CareEncounter } from "./care-model";
import type { Role } from "./types";
import { Badge, Empty, ErrorBox, Loading, Modal, SectionTitle } from "./ui";
import {
  acsDiagnoses,
  coronaryComplications,
  coronaryPlanCategories,
  coronaryStates,
  coronaryVessels,
  prettyCoronary,
  type CoronaryRecord,
} from "./coronary-model";

type Mode = "state" | "ecg" | "acs" | "angiography" | "pci" | "plan";
const modes: { key: Mode; label: string }[] = [
  { key: "state", label: "Coronary state" },
  { key: "ecg", label: "ECG" },
  { key: "acs", label: "ACS presentation" },
  { key: "angiography", label: "Angiography" },
  { key: "pci", label: "PCI" },
  { key: "plan", label: "Care plan / review" },
];
const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const iso = (value: string) => new Date(value).toISOString();
const valueOrNull = (value: string) => (value.trim() ? value.trim() : null);
const decimal = (value: string) => (value.trim() === "" ? null : Number(value));
const lines = (value: string) =>
  value
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
const recordTime = (value: unknown) =>
  value ? date(String(value)) : "Not recorded";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="coronary-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Option({ values }: { values: readonly string[] }) {
  return (
    <>
      {values.map((v) => (
        <option value={v} key={v}>
          {prettyCoronary(v)}
        </option>
      ))}
    </>
  );
}

export function CoronaryDashboard({
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
  const { data, error } = useData<CoronaryRecord>(
    `/patients/${patientId}/coronary`,
    revision,
  );
  const [mode, setMode] = useState<Mode | null>(null);
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  const acs = data.acsEvents[0],
    pci = data.pcis[0],
    angio = data.angiograms[0];
  const dapt = data.currentPlans.find((p) => p.category === "ANTITHROMBOTIC");
  const rehab = data.currentPlans.find((p) => p.category === "REHABILITATION");
  const next = data.tasks.find(
    (t) => t.current_status === "open" && t.target_date,
  );
  const ldl = data.lipids.find((l) => /ldl/i.test(`${l.test_id} ${l.display}`));
  return (
    <>
      <section className="panel care-section coronary-dashboard">
        <SectionTitle
          title="Coronary disease"
          subtitle="Presentation, procedures and prevention in the same longitudinal record."
          action={
            role === "clinician" ? (
              <button className="secondary" onClick={() => setMode("acs")}>
                <Plus size={16} /> Record coronary care
              </button>
            ) : undefined
          }
        />
        {!data.states.length && !acs && !pci && !angio ? (
          <Empty title="No structured coronary history">
            Record a suspected or established coronary state when clinically
            relevant.
          </Empty>
        ) : (
          <>
            <div className="coronary-summary-grid">
              <div>
                <span>Current state</span>
                <strong>
                  {data.currentState
                    ? prettyCoronary(data.currentState.state)
                    : "Not classified"}
                </strong>
                <small>
                  {data.currentState?.detail ||
                    "Historical states remain available"}
                </small>
              </div>
              <div>
                <span>ACS</span>
                <strong>{acs ? prettyCoronary(acs.diagnosis) : "—"}</strong>
                <small>{recordTime(acs?.presented_at)}</small>
              </div>
              <div>
                <span>Coronary anatomy</span>
                <strong>
                  {angio ? `${angio.lesions?.length || 0} lesion(s)` : "—"}
                </strong>
                <small>{angio?.conclusion || "No structured angiogram"}</small>
              </div>
              <div>
                <span>PCI / stents</span>
                <strong>
                  {pci
                    ? `${prettyCoronary(pci.target_vessel)} · ${pci.stents?.length || 0} stent(s)`
                    : "—"}
                </strong>
                <small>{recordTime(pci?.performed_at)}</small>
              </div>
              <div>
                <span>Antithrombotic plan</span>
                <strong>{dapt ? "Documented" : "Review needed"}</strong>
                <small>
                  {dapt?.review_date
                    ? `Review ${date(dapt.review_date)}`
                    : "No current dated plan"}
                </small>
              </div>
              <div>
                <span>LDL-C</span>
                <strong>
                  {ldl ? `${ldl.original_value} ${ldl.original_unit}` : "—"}
                </strong>
                <small>
                  {ldl ? recordTime(ldl.collected_at) : "No structured result"}
                </small>
              </div>
              <div>
                <span>Cardiac rehabilitation</span>
                <strong>
                  {rehab
                    ? prettyCoronary(
                        String(
                          rehab.data?.rehabilitation_status || rehab.status,
                        ),
                      )
                    : data.rehabilitation
                      ? "Recorded in HF care"
                      : "Review needed"}
                </strong>
                <small>
                  {rehab?.review_date
                    ? `Review ${date(rehab.review_date)}`
                    : ""}
                </small>
              </div>
              <div>
                <span>Next coronary review</span>
                <strong>
                  {next?.target_date ? date(next.target_date) : "—"}
                </strong>
                <small>{next?.purpose || "No dated task"}</small>
              </div>
            </div>
            {data.reviewItems.length ? (
              <div className="coronary-review-list">
                <h3>Needs clinical review</h3>
                {data.reviewItems.map((item) => (
                  <p key={item}>
                    <ShieldAlert size={15} />
                    {item}
                  </p>
                ))}
              </div>
            ) : (
              <p className="echo-quality-clear">
                <CheckCircle2 size={16} /> No documentation gaps identified by
                the current coronary workflow.
              </p>
            )}
            <div className="coronary-context-row">
              {data.latestEcho ? (
                <span>
                  Latest Echo: {recordTime(data.latestEcho.performed_at)}
                </span>
              ) : null}
              {data.hfProfile ? (
                <span>Existing HF record connected</span>
              ) : null}
              {data.valveStates.some((v) => v.severity === "SEVERE") ? (
                <span>Severe valve finding needs joint procedure review</span>
              ) : null}
              {data.troponins.length ? (
                <span>
                  {data.troponins.length} serial troponin result(s) from
                  laboratory
                </span>
              ) : null}
            </div>
          </>
        )}
        {role === "clinician" ? (
          <div className="coronary-actions">
            {modes.map((item) => (
              <button
                key={item.key}
                className="text-button"
                onClick={() => setMode(item.key)}
              >
                {item.label}
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
        ) : null}
      </section>
      {mode ? (
        <CoronaryEditor
          mode={mode}
          patientId={patientId}
          encounters={encounters}
          record={data}
          onClose={() => setMode(null)}
          onSaved={() => {
            setMode(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

export function CoronaryClinicalRecord({
  patientId,
  revision,
}: {
  patientId: string;
  revision: number;
}) {
  const { data, error } = useData<CoronaryRecord>(
    `/patients/${patientId}/coronary`,
    revision,
  );
  const [report, setReport] = useState<string>("");
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  const count =
    data.ecgs.length +
    data.acsEvents.length +
    data.angiograms.length +
    data.pcis.length +
    data.plans.length;
  return (
    <section className="panel care-section coronary-record">
      <SectionTitle
        title="Coronary clinical record"
        subtitle="Structured entries retain author, encounter, timestamp and source history."
      />
      {!count ? (
        <p className="muted">No coronary entries yet.</p>
      ) : (
        <div className="coronary-record-grid">
          {data.acsEvents.map((e) => (
            <article key={e.id}>
              <Badge tone="cad">ACS</Badge>
              <strong>{prettyCoronary(e.diagnosis)}</strong>
              <small>
                {recordTime(e.presented_at)} · {e.author} · {e.diagnosis_status}
              </small>
              <p>{e.clinical_interpretation}</p>
            </article>
          ))}
          {data.ecgs.map((e) => (
            <article key={e.id}>
              <Badge tone="active">ECG</Badge>
              <strong>
                {e.clinician_interpretation ||
                  prettyCoronary(e.ischemic_interpretation)}
              </strong>
              <small>
                {recordTime(e.performed_at)} · {e.author} · {e.status}
              </small>
              <p>{e.st_changes}</p>
            </article>
          ))}
          {data.angiograms.map((a) => (
            <article key={a.id}>
              <Badge tone="cad">Angiography</Badge>
              <strong>
                {a.conclusion ||
                  a.anatomy_summary ||
                  "Coronary anatomy documented"}
              </strong>
              <small>
                {recordTime(a.performed_at)} · {a.author} · {a.status}
              </small>
              <p>
                {a.lesions
                  ?.map(
                    (l: any) =>
                      `${l.vessel} ${l.segment} ${l.stenosis_percent ?? "?"}% (${prettyCoronary(l.culprit_status)})`,
                  )
                  .join(" · ")}
              </p>
            </article>
          ))}
          {data.pcis.map((p) => (
            <article key={p.id}>
              <Badge tone="cad">PCI</Badge>
              <strong>
                {p.target_vessel} · {p.result || "Procedure documented"}
              </strong>
              <small>
                {recordTime(p.performed_at)} · {p.author} · {p.status}
              </small>
              <p>
                {p.stents
                  ?.map(
                    (s: any) =>
                      `${s.stent_type} ${s.diameter_mm || "?"} × ${s.length_mm || "?"} mm`,
                  )
                  .join(" · ")}
              </p>
            </article>
          ))}
          {data.plans.map((p) => (
            <article key={p.id}>
              <Badge tone={p.status === "ACTIVE" ? "active" : "overdue"}>
                {prettyCoronary(p.category)}
              </Badge>
              <strong>
                {p.data?.purpose ||
                  p.data?.assessment ||
                  prettyCoronary(p.plan_key)}
              </strong>
              <small>
                {recordTime(p.observed_at)} · {p.author} · {p.status}
              </small>
              <p>
                {p.reason}
                {p.review_date ? ` · Review ${date(p.review_date)}` : ""}
              </p>
            </article>
          ))}
        </div>
      )}
      <div className="coronary-report-actions">
        <span>Editable clinician drafts</span>
        {[
          "acs-admission",
          "angiography",
          "pci",
          "acs-progress",
          "acs-discharge",
          "cad-follow-up",
        ].map((kind) => (
          <button
            className="text-button"
            key={kind}
            onClick={async () => {
              const r = await api<{ text: string }>(
                `/patients/${patientId}/coronary/report/${kind}`,
              );
              setReport(r.text);
            }}
          >
            {prettyCoronary(kind.replaceAll("-", "_"))}
          </button>
        ))}
      </div>
      {report ? (
        <div className="coronary-report">
          <h3>Draft report</h3>
          <textarea
            aria-label="Coronary report draft"
            rows={16}
            defaultValue={report}
            key={report}
          />
          <p className="muted">
            Review and finalize through your clinical documentation process.
            Missing findings are left blank.
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function CoronaryTimeline({
  patientId,
  revision,
}: {
  patientId: string;
  revision: number;
}) {
  const { data, error } = useData<CoronaryRecord>(
    `/patients/${patientId}/coronary`,
    revision,
  );
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  const events = [
    ...data.acsEvents.map((e) => ({
      id: e.id,
      at: e.presented_at,
      label: `${prettyCoronary(e.diagnosis)} presentation`,
      detail: e.clinical_interpretation,
    })),
    ...data.ecgs.map((e) => ({
      id: e.id,
      at: e.performed_at,
      label: "ECG",
      detail: e.clinician_interpretation || e.st_changes,
    })),
    ...data.angiograms.map((a) => ({
      id: a.id,
      at: a.performed_at,
      label: "Coronary angiography",
      detail: a.conclusion,
    })),
    ...data.pcis.map((p) => ({
      id: p.id,
      at: p.performed_at,
      label: `PCI ${p.target_vessel}`,
      detail: p.result,
    })),
    ...data.plans.map((p) => ({
      id: p.id,
      at: p.observed_at,
      label: prettyCoronary(p.category),
      detail: p.data?.purpose || p.data?.assessment || p.reason,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  if (!events.length) return null;
  return (
    <section className="panel care-section coronary-timeline">
      <SectionTitle
        title="Coronary journey"
        subtitle="Generated from the clinical record; no manual timeline entry."
      />
      <div className="coronary-events">
        {events.map((e) => (
          <article key={e.id}>
            <time>{recordTime(e.at)}</time>
            <div>
              <strong>{e.label}</strong>
              {e.detail ? <p>{e.detail}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CoronaryRegistryProjection({
  patientId,
  revision,
}: {
  patientId: string;
  revision: number;
}) {
  const { data, error } = useData<CoronaryRecord>(
    `/patients/${patientId}/coronary`,
    revision,
  );
  if (!data) return error ? <ErrorBox message={error} /> : <Loading />;
  const sections = Object.entries(data.registrySections);
  const completed = sections.filter(([, done]) => done).length;
  return (
    <section className="panel care-section coronary-registry">
      <SectionTitle
        title="CAD registry clinical data"
        subtitle="Current structured care data is available with provenance; legacy CAD episodes remain readable."
      />
      <div className="registry-status-row">
        <Badge tone="cad">
          {Math.round((completed / sections.length) * 100)}% clinical sections
          populated
        </Badge>
        <span>Presentation · Angiography · PCI · Medication record</span>
      </div>
      <div className="coronary-registry-sections">
        {sections.map(([name, done]) => (
          <span key={name}>
            {done ? "✓" : "○"} {prettyCoronary(name)}
          </span>
        ))}
      </div>
      {Object.entries(data.registryProjection).length ? (
        <details>
          <summary>View populated values and source records</summary>
          <div className="coronary-provenance">
            {Object.entries(data.registryProjection).map(([key, entry]) => (
              <div key={key}>
                <strong>{prettyCoronary(key)}</strong>
                <span>
                  {typeof entry.value === "object"
                    ? JSON.stringify(entry.value)
                    : String(entry.value)}
                </span>
                <small>
                  {entry.source} · {recordTime(entry.observed_at)}
                </small>
              </div>
            ))}
          </div>
        </details>
      ) : (
        <p className="muted">
          Clinical CAD documentation will populate this view automatically.
        </p>
      )}
    </section>
  );
}

export function CoronaryEditor({
  mode,
  patientId,
  encounters,
  record,
  onClose,
  onSaved,
}: {
  mode: Mode;
  patientId: string;
  encounters: CareEncounter[];
  record: CoronaryRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<Mode>(mode),
    [at, setAt] = useState(localNow()),
    [encounter, setEncounter] = useState(""),
    [form, setForm] = useState<Record<string, string>>({}),
    [lesions, setLesions] = useState<Array<Record<string, string>>>([
      { vessel: "LAD" },
    ]),
    [stents, setStents] = useState<Array<Record<string, string>>>([
      { vessel: "LAD", stent_type: "DES" },
    ]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const get = (key: string) => form[key] ?? "";
  const put = (key: string, value: string) =>
    setForm((old) => ({ ...old, [key]: value }));
  const text = (key: string, label: string, placeholder = "") => (
    <Field label={label}>
      <input
        value={get(key)}
        placeholder={placeholder}
        onChange={(e) => put(key, e.target.value)}
      />
    </Field>
  );
  const area = (key: string, label: string, placeholder = "") => (
    <Field label={label}>
      <textarea
        value={get(key)}
        rows={2}
        placeholder={placeholder}
        onChange={(e) => put(key, e.target.value)}
      />
    </Field>
  );
  const select = (
    key: string,
    label: string,
    values: readonly string[],
    initial?: string,
  ) => (
    <Field label={label}>
      <select
        value={get(key) || initial || values[0]}
        onChange={(e) => put(key, e.target.value)}
      >
        <Option values={values} />
      </select>
    </Field>
  );
  const number = (key: string, label: string, unit = "") => (
    <Field label={`${label}${unit ? ` (${unit})` : ""}`}>
      <input
        type="number"
        step="any"
        value={get(key)}
        onChange={(e) => put(key, e.target.value)}
      />
    </Field>
  );
  const datetime = (key: string, label: string) => (
    <Field label={label}>
      <input
        type="datetime-local"
        value={get(key)}
        onChange={(e) => put(key, e.target.value)}
      />
    </Field>
  );
  const dateInput = (key: string, label: string) => (
    <Field label={label}>
      <input
        type="date"
        value={get(key)}
        onChange={(e) => put(key, e.target.value)}
      />
    </Field>
  );
  const therapySelect = (key: string, label: string, pattern: RegExp) => (
    <Field label={label}>
      <select value={get(key)} onChange={(e) => put(key, e.target.value)}>
        <option value="">Not linked</option>
        {record.medications
          .filter((m) => pattern.test(`${m.medication_id} ${m.generic_name}`))
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.generic_name} · {m.status}
            </option>
          ))}
      </select>
    </Field>
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const base = { encounter_id: valueOrNull(encounter) };
      let path = "",
        body: Record<string, unknown> = {};
      if (kind === "state") {
        path = "state";
        body = {
          ...base,
          state: get("state") || "SUSPECTED_CAD",
          status: get("status") || "CURRENT",
          observed_at: iso(at),
          detail: get("detail"),
        };
      } else if (kind === "ecg") {
        path = "ecg";
        body = {
          ...base,
          performed_at: iso(at),
          indication: get("indication"),
          rhythm: get("rhythm") || "UNKNOWN",
          rate: decimal(get("rate")),
          pr_ms: decimal(get("pr")),
          qrs_ms: decimal(get("qrs")),
          qtc_ms: decimal(get("qtc")),
          axis_degrees: decimal(get("axis")),
          st_changes: get("st"),
          t_changes: get("t"),
          conduction: get("conduction"),
          pacing: get("pacing"),
          ischemic_interpretation: get("ischemia") || "UNCERTAIN",
          comparison: get("comparison"),
          clinician_interpretation: get("interpretation"),
          source_label: get("source") || "Clinician-entered 12-lead ECG",
          status: get("record_status") || "FINAL",
        };
      } else if (kind === "acs") {
        path = "acs";
        body = {
          ...base,
          presented_at: iso(at),
          diagnosis: get("diagnosis") || "POSSIBLE_ACS",
          diagnosis_status: get("diagnosis_status") || "WORKING",
          symptom_onset_at: get("onset") ? iso(get("onset")) : null,
          first_medical_contact_at: get("contact") ? iso(get("contact")) : null,
          first_ecg_at: get("first_ecg") ? iso(get("first_ecg")) : null,
          diagnosis_at: get("diagnosis_at") ? iso(get("diagnosis_at")) : null,
          cath_activation_at: get("cath_activation")
            ? iso(get("cath_activation"))
            : null,
          hospital_arrival_at: get("arrival") ? iso(get("arrival")) : null,
          wire_at: get("wire") ? iso(get("wire")) : null,
          reperfusion_at: get("reperfusion") ? iso(get("reperfusion")) : null,
          symptoms: {
            chest_discomfort: get("chest") === "yes",
            pressure: get("pressure") === "yes",
            exertional: get("exertional") === "yes",
            rest: get("rest") === "yes",
            radiation: get("radiation"),
            dyspnoea: get("dyspnoea") === "yes",
            diaphoresis: get("diaphoresis") === "yes",
            nausea: get("nausea") === "yes",
            atypical: get("atypical"),
            duration_minutes: decimal(get("duration")),
            recurrent: get("recurrent") === "yes",
          },
          hemodynamics: {
            systolic_bp: decimal(get("sbp")),
            heart_rate: decimal(get("hr")),
            stable:
              get("stable") === "yes"
                ? true
                : get("stable") === "no"
                  ? false
                  : null,
            shock:
              get("shock") === "yes"
                ? true
                : get("shock") === "no"
                  ? false
                  : null,
            hf: get("hf") === "yes" ? true : get("hf") === "no" ? false : null,
            arrhythmia: get("arrhythmia"),
          },
          risk_context: {
            renal: get("renal"),
            bleeding: get("bleeding"),
            risk_score_name: get("risk_score"),
            risk_score_value: decimal(get("risk_value")),
            score_source: get("risk_source"),
          },
          clinical_interpretation: get("interpretation"),
          status: get("acs_status") || "ACTIVE",
        };
      } else if (kind === "angiography") {
        path = "angiograms";
        body = {
          ...base,
          acs_event_id: valueOrNull(get("acs_id")),
          performed_at: iso(at),
          indication: get("indication"),
          access_site: get("access"),
          contrast_ml: decimal(get("contrast")),
          operator_name: get("operator"),
          coronary_dominance: get("dominance") || "UNKNOWN",
          anatomy_summary: get("anatomy"),
          physiology: get("physiology")
            ? [
                {
                  type: get("physiology_type") || "FFR",
                  vessel: get("physiology_vessel") || "LAD",
                  value: decimal(get("physiology")),
                  context: get("physiology_context"),
                },
              ]
            : [],
          intracoronary_imaging: get("imaging")
            ? [
                {
                  type: get("imaging_type") || "IVUS",
                  indication: get("imaging_indication"),
                  findings: get("imaging"),
                },
              ]
            : [],
          complications: lines(get("complications")),
          conclusion: get("conclusion"),
          plan: get("plan"),
          status: get("record_status") || "FINAL",
          lesions: lesions
            .filter((l) => l.vessel)
            .map((l) => ({
              vessel: l.vessel,
              segment: l.segment || "",
              stenosis_percent: decimal(l.stenosis || ""),
              culprit_status: l.culprit || "UNCERTAIN",
              timi_flow: decimal(l.timi || ""),
            })),
        };
      } else if (kind === "pci") {
        path = "pcis";
        body = {
          ...base,
          acs_event_id: valueOrNull(get("acs_id")),
          angiogram_id: valueOrNull(get("angio_id")),
          target_lesion_id: valueOrNull(get("lesion_id")),
          performed_at: iso(at),
          indication: get("indication"),
          target_vessel: get("target") || "LAD",
          urgency: get("urgency") || "UNKNOWN",
          access_site: get("access"),
          technique: {
            guide: get("guide"),
            wire: get("wire_technique"),
            predilatation: get("predilatation"),
            lesion_preparation: get("preparation"),
            postdilatation: get("postdilatation"),
          },
          final_timi_flow: decimal(get("final_timi")),
          contrast_ml: decimal(get("contrast")),
          radiation_gy: decimal(get("radiation")),
          complications: lines(get("complications")),
          result: get("result"),
          residual_disease: get("residual"),
          revascularization_status: get("revasc_status") || "UNKNOWN",
          staged_plan: get("staged"),
          status: get("record_status") || "FINAL",
          stents: stents
            .filter((s) => s.vessel)
            .map((s) => ({
              vessel: s.vessel,
              lesion_id: valueOrNull(s.lesion_id || ""),
              stent_type: s.stent_type || "DES",
              manufacturer: s.manufacturer || "",
              model: s.model || "",
              diameter_mm: decimal(s.diameter || ""),
              length_mm: decimal(s.length || ""),
              overlap: s.overlap === "yes",
              implanted_at: s.implanted_at ? iso(s.implanted_at) : null,
            })),
        };
      } else {
        path = "plans";
        body = {
          ...base,
          acs_event_id: valueOrNull(get("acs_id")),
          category: get("category") || "FOLLOW_UP",
          plan_key:
            get("plan_key") || `${get("category") || "FOLLOW_UP"}_review`,
          observed_at: iso(at),
          status: get("plan_status") || "ACTIVE",
          review_date: valueOrNull(get("review_date")),
          supersedes_id: valueOrNull(get("supersedes_id")),
          reason: get("reason"),
          data: {
            indication: get("indication"),
            purpose: get("purpose"),
            assessment: get("assessment"),
            known: lines(get("known")),
            missing: lines(get("missing")),
            why_it_matters: get("why"),
            options: lines(get("options")),
            next_assessment: get("next"),
            evidence_note: get("evidence"),
            aspirin_therapy_id: valueOrNull(get("aspirin")),
            p2y12_therapy_id: valueOrNull(get("p2y12")),
            anticoagulant_therapy_id: valueOrNull(get("oac")),
            combination_start: valueOrNull(get("combination_start")),
            combination_end: valueOrNull(get("combination_end")),
            duration_strategy: get("duration_strategy"),
            bleeding_considerations: get("bleeding"),
            ischemic_considerations: get("ischemic"),
            deviation_reason: get("deviation"),
            switch_reason: get("switch"),
            complication_type: valueOrNull(get("complication")),
            severity: valueOrNull(get("severity")),
            symptoms: get("symptoms"),
            mechanism: get("mechanism"),
            rehabilitation_status: valueOrNull(get("rehab_status")),
            start_date: valueOrNull(get("start_date")),
            barrier: get("barrier"),
            lpa_unit: valueOrNull(get("lpa_unit")),
            smoking_status: valueOrNull(get("smoking")),
            follow_up_purpose: get("followup"),
            responsible_team: get("team"),
          },
        };
      }
      await api(`/patients/${patientId}/coronary/${path}`, body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const category = get("category") || "FOLLOW_UP";
  return (
    <Modal title="Record coronary care" onClose={onClose} wide>
      <form className="coronary-editor" onSubmit={submit}>
        <p className="muted">
          Record observed facts and clinician decisions. Clinical treatment
          thresholds and durations remain under independent review.
        </p>
        <div className="coronary-editor-tabs">
          {modes.map((m) => (
            <button
              type="button"
              key={m.key}
              className={kind === m.key ? "active" : ""}
              onClick={() => {
                setKind(m.key);
                setError("");
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="form-grid four">
          <Field label="Observed / performed at">
            <input
              type="datetime-local"
              required
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </Field>
          <Field label="Care encounter">
            <select
              value={encounter}
              onChange={(e) => setEncounter(e.target.value)}
            >
              <option value="">Longitudinal record</option>
              {encounters.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.kind} · {date(e.started_on)} · {e.reason}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {kind === "state" ? (
          <div className="form-grid">
            {select("state", "Coronary state", coronaryStates, "SUSPECTED_CAD")}
            {select(
              "status",
              "Status",
              ["CURRENT", "HISTORICAL", "RESOLVED", "UNCERTAIN"],
              "CURRENT",
            )}
            {area("detail", "Clinical detail / historical context")}
          </div>
        ) : null}
        {kind === "ecg" ? (
          <>
            <h3>Reusable ECG record</h3>
            <div className="form-grid four">
              {text("indication", "Indication")}
              {text("rhythm", "Rhythm")}
              {number("rate", "Heart rate", "bpm")}
              {number("pr", "PR", "ms")}
              {number("qrs", "QRS", "ms")}
              {number("qtc", "QTc", "ms")}
              {number("axis", "Axis", "degrees")}
              {select("ischemia", "Ischemic interpretation", [
                "UNCERTAIN",
                "ST_ELEVATION",
                "ST_DEPRESSION",
                "OTHER_ISCHEMIC",
                "NO_ACUTE_ISCHEMIA",
              ])}
            </div>
            <div className="form-grid">
              {text("st", "ST changes")}
              {text("t", "T-wave changes")}
              {text("conduction", "Conduction / pacing")}
              {text("comparison", "Comparison")}
              {area("interpretation", "Clinician interpretation")}
              {text("source", "Source label", "12-lead ECG")}
            </div>
          </>
        ) : null}
        {kind === "acs" ? (
          <>
            <h3>ACS event</h3>
            <div className="form-grid four">
              {select(
                "diagnosis",
                "Working diagnosis",
                acsDiagnoses,
                "POSSIBLE_ACS",
              )}
              {select("diagnosis_status", "Diagnostic status", [
                "WORKING",
                "CONFIRMED",
                "REVISED",
              ])}
              {select("acs_status", "Care status", [
                "ACTIVE",
                "DISCHARGED",
                "CLOSED",
                "ENTERED_IN_ERROR",
              ])}
              {select("chest", "Chest discomfort", ["unknown", "yes", "no"])}
              {select("pressure", "Pressure", ["unknown", "yes", "no"])}
              {select("rest", "At rest", ["unknown", "yes", "no"])}
              {select("exertional", "Exertional", ["unknown", "yes", "no"])}
              {select("dyspnoea", "Dyspnoea", ["unknown", "yes", "no"])}
              {number("duration", "Symptom duration", "min")}
              {datetime("onset", "Symptom onset")}
              {datetime("contact", "First medical contact")}
              {datetime("first_ecg", "First ECG")}
              {datetime("diagnosis_at", "Diagnosis time")}
              {datetime("cath_activation", "Cath lab activation")}
              {datetime("arrival", "Hospital arrival")}
              {datetime("wire", "Wire/device time")}
              {datetime("reperfusion", "Reperfusion time")}
              {number("sbp", "Systolic BP", "mmHg")}
              {number("hr", "Heart rate", "bpm")}
              {select("stable", "Hemodynamically stable", [
                "unknown",
                "yes",
                "no",
              ])}
              {select("shock", "Shock", ["unknown", "yes", "no"])}
              {select("hf", "HF signs", ["unknown", "yes", "no"])}
            </div>
            <div className="form-grid">
              {text("radiation", "Radiation")}
              {text("atypical", "Other symptoms")}
              {text("arrhythmia", "Arrhythmia")}
              {text("renal", "Renal context")}
              {text("bleeding", "Bleeding context")}
              {area("interpretation", "Clinician assessment")}
            </div>
            <p className="muted">
              Troponins are read from the shared Laboratory record. Add serial
              results there, including assay and unit.
            </p>
            {record.troponins.map((t: any) => (
              <p className="coronary-inline-result" key={t.id}>
                {t.display}: {t.original_value} {t.original_unit} ·{" "}
                {recordTime(t.collected_at)}{" "}
                {t.reference_high
                  ? `· assay upper reference ${t.reference_high} ${t.original_unit}`
                  : ""}
              </p>
            ))}
          </>
        ) : null}
        {kind === "angiography" ? (
          <>
            <h3>Coronary angiography</h3>
            <div className="form-grid four">
              {select("acs_id", "Related ACS", [
                "",
                ...record.acsEvents.map((a) => a.id),
              ])}
              {text("indication", "Indication")}
              {text("access", "Access site")}
              {number("contrast", "Contrast", "mL")}
              {text("operator", "Operator")}
              {select("dominance", "Dominance", [
                "UNKNOWN",
                "RIGHT",
                "LEFT",
                "CODOMINANT",
              ])}
              {select("record_status", "Report status", [
                "FINAL",
                "DRAFT",
                "ENTERED_IN_ERROR",
              ])}
            </div>
            <div className="form-grid">
              {area("anatomy", "Anatomy summary")}
              {area("conclusion", "Conclusion")}
              {area("plan", "Clinician plan")}
            </div>
            <h4>Lesions</h4>
            {lesions.map((lesion, i) => (
              <div className="form-grid four coronary-child-row" key={i}>
                <Field label="Vessel">
                  <select
                    value={lesion.vessel || "LAD"}
                    onChange={(e) =>
                      setLesions((old) =>
                        old.map((x, n) =>
                          n === i ? { ...x, vessel: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <Option values={coronaryVessels} />
                  </select>
                </Field>
                {["segment", "stenosis", "timi"].map((k) => (
                  <Field
                    key={k}
                    label={
                      k === "stenosis"
                        ? "Stenosis %"
                        : k === "timi"
                          ? "TIMI flow"
                          : prettyCoronary(k)
                    }
                  >
                    <input
                      type={k === "segment" ? "text" : "number"}
                      value={lesion[k] || ""}
                      onChange={(e) =>
                        setLesions((old) =>
                          old.map((x, n) =>
                            n === i ? { ...x, [k]: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
                <Field label="Culprit status">
                  <select
                    value={lesion.culprit || "UNCERTAIN"}
                    onChange={(e) =>
                      setLesions((old) =>
                        old.map((x, n) =>
                          n === i ? { ...x, culprit: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <Option
                      values={[
                        "UNCERTAIN",
                        "CONFIRMED",
                        "PROBABLE",
                        "NOT_CULPRIT",
                        "NONE_IDENTIFIED",
                      ]}
                    />
                  </select>
                </Field>
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() => setLesions((old) => [...old, { vessel: "LAD" }])}
            >
              Add another lesion
            </button>
            <details>
              <summary>Physiology, imaging and complications</summary>
              <div className="form-grid four">
                {select("physiology_type", "Physiology type", [
                  "FFR",
                  "IFR",
                  "RFR",
                  "OTHER",
                ])}
                {select(
                  "physiology_vessel",
                  "Physiology vessel",
                  coronaryVessels,
                )}
                {number("physiology", "Physiology value")}
                {text("physiology_context", "Physiology context")}
                {select("imaging_type", "Imaging", ["IVUS", "OCT"])}
                {text("imaging_indication", "Imaging indication")}
                {text("imaging", "Imaging findings")}
                {area("complications", "Complications (one per line)")}
              </div>
            </details>
          </>
        ) : null}
        {kind === "pci" ? (
          <>
            <h3>PCI procedure</h3>
            <div className="form-grid four">
              {select("acs_id", "Related ACS", [
                "",
                ...record.acsEvents.map((a) => a.id),
              ])}
              {select("angio_id", "Related angiogram", [
                "",
                ...record.angiograms.map((a) => a.id),
              ])}
              {select("lesion_id", "Target lesion", [
                "",
                ...(
                  record.angiograms.find((a) => a.id === get("angio_id"))
                    ?.lesions || []
                ).map((l: any) => l.id),
              ])}
              {text("indication", "Indication")}
              {select("target", "Target vessel", coronaryVessels)}
              {select("urgency", "Urgency", [
                "UNKNOWN",
                "EMERGENCY",
                "URGENT",
                "ELECTIVE",
              ])}
              {text("access", "Access site")}
              {number("final_timi", "Final TIMI flow")}
              {number("contrast", "Contrast", "mL")}
              {number("radiation", "Radiation", "Gy")}
              {select("revasc_status", "Revascularization status", [
                "UNKNOWN",
                "COMPLETE",
                "INCOMPLETE",
                "STAGED",
              ])}
              {select("record_status", "Report status", [
                "FINAL",
                "DRAFT",
                "ENTERED_IN_ERROR",
              ])}
            </div>
            <div className="form-grid">
              {area("result", "Final result")}
              {area("residual", "Residual disease")}
              {area("staged", "Staged procedure / CABG review plan")}
            </div>
            <h4>Stents</h4>
            {stents.map((stent, i) => (
              <div className="form-grid four coronary-child-row" key={i}>
                <Field label="Vessel">
                  <select
                    value={stent.vessel || "LAD"}
                    onChange={(e) =>
                      setStents((old) =>
                        old.map((x, n) =>
                          n === i ? { ...x, vessel: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <Option values={coronaryVessels} />
                  </select>
                </Field>
                <Field label="Type">
                  <select
                    value={stent.stent_type || "DES"}
                    onChange={(e) =>
                      setStents((old) =>
                        old.map((x, n) =>
                          n === i ? { ...x, stent_type: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <Option values={["DES", "BMS", "OTHER", "UNKNOWN"]} />
                  </select>
                </Field>
                {["diameter", "length", "model", "manufacturer"].map((k) => (
                  <Field
                    key={k}
                    label={`${prettyCoronary(k)}${["diameter", "length"].includes(k) ? " (mm)" : ""}`}
                  >
                    <input
                      type={
                        ["diameter", "length"].includes(k) ? "number" : "text"
                      }
                      step="any"
                      value={stent[k] || ""}
                      onChange={(e) =>
                        setStents((old) =>
                          old.map((x, n) =>
                            n === i ? { ...x, [k]: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
              </div>
            ))}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setStents((old) => [
                  ...old,
                  { vessel: get("target") || "LAD", stent_type: "DES" },
                ])
              }
            >
              Add another stent
            </button>
            <details>
              <summary>Technique and complications</summary>
              <div className="form-grid">
                {text("guide", "Guiding catheter")}
                {text("wire_technique", "Wire")}
                {text("predilatation", "Predilatation")}
                {text("preparation", "Lesion preparation")}
                {text("postdilatation", "Postdilatation")}
                {area("complications", "Complications (one per line)")}
              </div>
            </details>
          </>
        ) : null}
        {kind === "plan" ? (
          <>
            <h3>Coronary plan / pathway</h3>
            <div className="form-grid four">
              {select("category", "Type", coronaryPlanCategories, "FOLLOW_UP")}
              {text("plan_key", "Plan key", "e.g. post-PCI antithrombotics")}
              {select("plan_status", "Status", [
                "ACTIVE",
                "COMPLETED",
                "UNCERTAIN",
                "ENTERED_IN_ERROR",
              ])}
              {dateInput("review_date", "Exact review date")}
              {select("acs_id", "Related ACS", [
                "",
                ...record.acsEvents.map((a) => a.id),
              ])}
              {text("purpose", "Purpose")}
              {text("team", "Responsible clinician / team")}
            </div>
            <div className="form-grid">
              {area("assessment", "Clinician assessment")}
              {area("known", "What we know (one per line)")}
              {area("missing", "What is missing (one per line)")}
              {area("options", "Options for review (one per line)")}
              {area("next", "Next assessment")}
            </div>
            {category === "ANTITHROMBOTIC" ? (
              <>
                <h4>Combined antithrombotic record</h4>
                <div className="form-grid four">
                  {therapySelect("aspirin", "Aspirin therapy", /aspirin/i)}
                  {therapySelect(
                    "p2y12",
                    "P2Y12 therapy",
                    /clopidogrel|ticagrelor|prasugrel/i,
                  )}
                  {therapySelect(
                    "oac",
                    "Oral anticoagulant therapy",
                    /apixaban|rivaroxaban|dabigatran|edoxaban|warfarin/i,
                  )}
                  {dateInput("combination_start", "Combination start")}
                  {dateInput("combination_end", "Planned combination end")}
                  {text("duration_strategy", "Clinician duration strategy")}
                </div>
                <div className="form-grid">
                  {area("bleeding", "Bleeding considerations")}
                  {area("ischemic", "Ischemic considerations")}
                  {area("deviation", "Reason for deviation / switch")}
                </div>
              </>
            ) : null}
            {category === "COMPLICATION" ? (
              <>
                <div className="form-grid four">
                  {select(
                    "complication",
                    "Complication type",
                    coronaryComplications,
                  )}
                  {select("severity", "Clinician severity", [
                    "UNCERTAIN",
                    "LOW",
                    "MODERATE",
                    "HIGH",
                    "CRITICAL",
                  ])}
                  {text("symptoms", "Symptoms")}
                  {text("mechanism", "Suspected mechanism")}
                </div>
                <p className="muted">
                  A bleeding or stent-thrombosis concern creates an
                  antithrombotic reassessment. Medications are never stopped
                  automatically.
                </p>
              </>
            ) : null}
            {category === "REHABILITATION" ? (
              <div className="form-grid four">
                {select("rehab_status", "Rehabilitation status", [
                  "ELIGIBILITY_REVIEW",
                  "REFERRED",
                  "PLANNED",
                  "PARTICIPATING",
                  "COMPLETED",
                  "DECLINED",
                  "BARRIER",
                  "UNKNOWN",
                ])}
                {dateInput("start_date", "Planned start")}
                {text("barrier", "Barriers")}
              </div>
            ) : null}
            {category === "PREVENTION" ? (
              <div className="form-grid four">
                {select("smoking", "Smoking status", [
                  "unknown",
                  "current",
                  "former",
                  "never",
                ])}
                {select("lpa_unit", "Lp(a) unit if measured", [
                  "",
                  "mg/dL",
                  "nmol/L",
                ])}
              </div>
            ) : null}
            {category === "ANOCA_INOCA" ? (
              <div className="form-grid">
                {text(
                  "mechanism",
                  "Mechanism considered",
                  "Microvascular, vasospastic or uncertain",
                )}
              </div>
            ) : null}
            {category === "CCS" ? (
              <div className="form-grid">
                {text("symptoms", "Angina pattern / change")}
                {text("evidence", "Previous testing and its quality")}
              </div>
            ) : null}
            {record.plans.some((p) => p.category === category) ? (
              <Field label="Supersede current plan">
                <select
                  value={get("supersedes_id")}
                  onChange={(e) => {
                    put("supersedes_id", e.target.value);
                    const selected = record.plans.find(
                      (p) => p.id === e.target.value,
                    );
                    if (selected) put("plan_key", selected.plan_key);
                  }}
                >
                  <option value="">New distinct plan</option>
                  {record.plans
                    .filter(
                      (p) =>
                        p.category === category &&
                        !record.plans.some((n) => n.supersedes_id === p.id),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.plan_key} · {p.status}
                      </option>
                    ))}
                </select>
              </Field>
            ) : null}
          </>
        ) : null}
        <ErrorBox message={error} />
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save to patient record"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
