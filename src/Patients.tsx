import { useState, type FormEvent } from "react";
import {
  Search,
  Plus,
  ArrowRight,
  ArrowLeft,
  Save,
  LockKeyhole,
  Check,
  Trash2,
  Stethoscope,
  Activity,
  CalendarDays,
} from "lucide-react";
import { api, useData, date, currentDate } from "./api";
import type { Patient, Episode, Role, Lesion } from "./types";
import { Badge, ErrorBox, Loading, Empty, Modal, SectionTitle } from "./ui";
export function PatientTable({
  patients,
  onOpen,
}: {
  patients: Patient[];
  onOpen: (id: string) => void;
}) {
  return patients.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Patient</th>
            <th>Registry ID</th>
            <th>Registry</th>
            <th>Birth date</th>
            <th>Sex</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => (
            <tr key={p.id}>
              <td>
                <button className="patient-link" onClick={() => onOpen(p.id)}>
                  <span className="avatar">
                    {p.name
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.mrn}</small>
                  </span>
                </button>
              </td>
              <td className="mono">CF-CAD-{String(p.crf).padStart(4, "0")}</td>
              <td>
                <Badge tone="cad">CAD</Badge>
              </td>
              <td>{date(p.birth_date)}</td>
              <td>{p.sex}</td>
              <td>
                <button
                  className="icon-button"
                  aria-label={"Open " + p.name}
                  onClick={() => onOpen(p.id)}
                >
                  <ArrowRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No matching patients">
      Try a different name or synthetic MRN.
    </Empty>
  );
}
export function NewPatient({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const result = await api<{ id: string }>("/patients", data);
      onCreated(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Register a patient" onClose={onClose}>
      <p className="modal-intro">
        Create one shared identity and enroll in the CAD sandbox registry.
      </p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="span-2">
            Patient display name
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              placeholder="e.g. Mariam Sample"
            />
          </label>
          <label>
            Synthetic MRN
            <input
              name="mrn"
              required
              pattern="SYN-[A-Z0-9-]{3,30}"
              placeholder="SYN-0100"
            />
            <small>Unique MRN beginning SYN-</small>
          </label>
          <label>
            Birth date
            <input
              name="birth_date"
              type="date"
              min="1900-01-01"
              max={currentDate()}
              required
            />
          </label>
          <label>
            Sex
            <select name="sex" aria-label="Sex" required>
              <option value="">Select…</option>
              <option>Female</option>
              <option>Male</option>
              <option>Unknown</option>
            </select>
          </label>
          <label>
            Registry
            <input value="CAD · sandbox version 1" readOnly />
          </label>
        </div>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Registering…" : "Register & enroll"}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Patients({
  onOpen,
  onNew,
  revision,
}: {
  onOpen: (id: string) => void;
  onNew?: () => void;
  revision: number;
}) {
  const [search, setSearch] = useState("");
  const { data, error } = useData<Patient[]>("/patients", revision);
  const filtered = data?.filter((p) =>
    (p.name + " " + p.mrn).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">LONGITUDINAL CARE</span>
          <h1>Patients</h1>
          <p>One identity. Every encounter. A connected clinical history.</p>
        </div>
        {onNew ? (
          <button className="primary" onClick={onNew}>
            <Plus size={18} />
            Register patient
          </button>
        ) : null}
      </div>
      <div className="panel">
        <div className="table-toolbar">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Search patients"
              placeholder="Search by name or MRN…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="muted">{filtered?.length ?? 0} patients · CAD</span>
        </div>
        <ErrorBox message={error} />
        {filtered ? (
          <PatientTable patients={filtered} onOpen={onOpen} />
        ) : !error ? (
          <Loading />
        ) : null}
      </div>
    </>
  );
}
export function PatientWorkspace({
  id,
  role,
  onBack,
  onSaved,
}: {
  id: string;
  role: Role;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [revision, setRevision] = useState(0),
    [selected, setSelected] = useState(""),
    [creating, setCreating] = useState(false),
    [error, setError] = useState("");
  const { data: p, error: loadError } = useData<Patient>(
    "/patients/" + id,
    revision,
  );
  const episodeId = selected || p?.episodes?.[0]?.id;
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const admission_date = new FormData(e.currentTarget).get("admission_date");
    try {
      const ep = await api<Episode>(`/patients/${id}/episodes`, {
        admission_date,
      });
      setSelected(ep.id);
      setCreating(false);
      setRevision((v) => v + 1);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <button className="text-button back" onClick={onBack}>
        <ArrowLeft size={16} />
        All patients
      </button>
      <ErrorBox message={loadError} />
      {!p ? (
        !loadError ? (
          <Loading />
        ) : null
      ) : (
        <>
          <div className="patient-heading">
            <div className="avatar large">
              {p.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </div>
            <div>
              <span className="eyebrow">SHARED PATIENT RECORD</span>
              <h1>{p.name}</h1>
              <p>
                {p.mrn}
                <span>•</span>
                {p.sex}
                <span>•</span>Born {date(p.birth_date)}
              </p>
            </div>
            <Badge tone="cad">CAD enrolled</Badge>
          </div>
          <div className="patient-strip">
            <span>
              Registry ID{" "}
              <strong>CF-CAD-{String(p.crf).padStart(4, "0")}</strong>
            </span>
            <span>
              Site <strong>Kuwait · demo site</strong>
            </span>
            <span>
              Protocol <strong>CAD sandbox v1</strong>
            </span>
          </div>
          <div className="episode-toolbar">
            <div>
              <Stethoscope size={19} />
              <select
                aria-label="Select episode"
                value={episodeId || ""}
                onChange={(e) => setSelected(e.target.value)}
              >
                {p.episodes?.length ? (
                  p.episodes.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      Index episode · {date(ep.admission_date)} · {ep.state}
                    </option>
                  ))
                ) : (
                  <option>No episodes yet</option>
                )}
              </select>
            </div>
            {role === "clinician" ? (
              <button className="secondary" onClick={() => setCreating(true)}>
                <Plus size={16} />
                New episode
              </button>
            ) : null}
          </div>
          {episodeId ? (
            <EpisodeEditor
              key={episodeId}
              id={episodeId}
              role={role}
              onSaved={() => {
                setRevision((v) => v + 1);
                onSaved();
              }}
            />
          ) : (
            <div className="panel">
              <Empty title="Start this patient's clinical history">
                Create an index episode to record presentation, angiography, and
                discharge.
              </Empty>
            </div>
          )}
        </>
      )}
      {creating ? (
        <Modal title="Create index episode" onClose={() => setCreating(false)}>
          <form onSubmit={create}>
            <label>
              Index admission date
              <input
                name="admission_date"
                type="date"
                defaultValue={currentDate()}
                min={p?.birth_date}
                max={currentDate()}
                required
              />
            </label>
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="primary">
                Create draft
                <Plus size={16} />
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
function EpisodeEditor({
  id,
  role,
  onSaved,
}: {
  id: string;
  role: Role;
  onSaved: () => void;
}) {
  const { data, error } = useData<Episode>("/episodes/" + id);
  return data ? (
    <EpisodeForm key={data.id} original={data} role={role} onSaved={onSaved} />
  ) : (
    <>
      <ErrorBox message={error} />
      {!error ? <Loading /> : null}
    </>
  );
}
function EpisodeForm({
  original,
  role,
  onSaved,
}: {
  original: Episode;
  role: Role;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(original),
    [tab, setTab] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false),
    [confirm, setConfirm] = useState(false);
  const locked = form.state !== "draft" || role !== "clinician";
  const complete = [
    form.presentation,
    form.admission_date,
    form.access_site,
    form.management,
    form.discharge_date,
    form.discharge_status,
  ].filter(Boolean).length;
  function update(key: string, value: unknown) {
    setForm((v) => ({ ...v, [key]: value }));
    setDirty(true);
    setNotice("");
  }
  function lesion(index: number, patch: Partial<Lesion>) {
    update(
      "lesions",
      form.lesions.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }
  async function action(kind: "save" | "finalize" | "review") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let result: Episode;
      if (kind === "save") {
        const {
          version,
          admission_date,
          discharge_date,
          presentation,
          access_site,
          management,
          discharge_status,
        } = form;
        result = await api<Episode>(
          "/episodes/" + form.id,
          {
            version,
            admission_date,
            discharge_date,
            presentation,
            access_site,
            management,
            discharge_status,
            lesions: form.lesions.map((l) => ({
              vessel: l.vessel,
              segment: l.segment,
              stenosis: Number(l.stenosis),
              treatment: l.treatment,
              stents: l.stents.map((s) => ({
                diameter: Number(s.diameter),
                length: Number(s.length),
                type: s.type,
              })),
            })),
          },
          "PUT",
        );
        setDirty(false);
      } else
        result = await api<Episode>(`/episodes/${form.id}/${kind}`, {
          version: form.version,
        });
      setForm(result);
      setConfirm(false);
      setNotice(
        kind === "save"
          ? "Draft saved to the server."
          : kind === "review"
            ? "Independent review recorded."
            : "Record finalized. The snapshot is locked and eligible follow-ups are scheduled.",
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const select = (key: keyof Episode, label: string, options: string[]) => (
    <label>
      {label}
      <select
        disabled={locked}
        aria-label={label}
        value={String(form[key] || "")}
        onChange={(e) => update(key, e.target.value || null)}
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <div className="record-layout">
        <div className="panel editor">
          <div className="record-title">
            <div>
              <span className="eyebrow">CAD INDEX ASSESSMENT</span>
              <h2>Clinical record</h2>
            </div>
            <Badge>{form.state}</Badge>
          </div>
          <div className="tabs" role="tablist" aria-label="Clinical sections">
            {["Presentation", "Angiography & PCI", "Discharge"].map((t, i) => (
              <button
                id={"tab-" + i}
                aria-controls={"section-" + i}
                role="tab"
                aria-selected={tab === i}
                key={t}
                className={tab === i ? "active" : ""}
                onClick={() => setTab(i)}
              >
                <span>{i + 1}</span>
                {t}
              </button>
            ))}
          </div>
          <div
            className="editor-body"
            role="tabpanel"
            id={"section-" + tab}
            aria-labelledby={"tab-" + tab}
          >
            {tab === 0 ? (
              <>
                <div className="section-label">
                  <Activity size={20} />
                  <div>
                    <h3>Index presentation</h3>
                    <p>
                      The admission anchors this episode’s follow-up protocol.
                    </p>
                  </div>
                </div>
                <div className="form-grid">
                  <label>
                    Index admission date
                    <input
                      disabled={locked}
                      type="date"
                      max={currentDate()}
                      value={form.admission_date}
                      onChange={(e) => update("admission_date", e.target.value)}
                    />
                  </label>
                  {select("presentation", "Presentation type", [
                    "STEMI",
                    "NSTEMI",
                    "Unstable angina",
                    "Chronic coronary syndrome",
                  ])}
                </div>
                <div className="info-block">
                  <Stethoscope size={20} />
                  <p>
                    Shared patient details are linked to this episode.
                    Specialist findings stay attached to the CAD record.
                  </p>
                </div>
              </>
            ) : tab === 1 ? (
              <>
                <div className="form-grid">
                  {select("access_site", "Access site", [
                    "Radial",
                    "Femoral",
                    "Other",
                    "Not performed",
                  ])}
                  {select("management", "Management strategy", [
                    "Medical therapy",
                    "PCI",
                    "CABG referral",
                  ])}
                </div>
                <SectionTitle
                  title="Coronary lesions"
                  subtitle="Record each lesion separately, with its associated intervention."
                />
                {form.lesions.map((l, i) => (
                  <div className="lesion-card" key={i}>
                    <div className="lesion-title">
                      <strong>Lesion {String(i + 1).padStart(2, "0")}</strong>
                      {!locked ? (
                        <button
                          className="icon-button danger"
                          aria-label={"Remove lesion " + (i + 1)}
                          onClick={() =>
                            update(
                              "lesions",
                              form.lesions.filter((_, j) => j !== i),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                    <div className="form-grid four">
                      <label>
                        Vessel
                        <select
                          disabled={locked}
                          aria-label="Vessel"
                          value={l.vessel}
                          onChange={(e) =>
                            lesion(i, { vessel: e.target.value })
                          }
                        >
                          <option value="">Select…</option>
                          {["LM", "LAD", "LCx", "RCA", "Graft"].map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Segment
                        <select
                          disabled={locked}
                          aria-label="Segment"
                          value={l.segment}
                          onChange={(e) =>
                            lesion(i, { segment: e.target.value })
                          }
                        >
                          <option value="">Select…</option>
                          {["Proximal", "Mid", "Distal", "Other"].map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Stenosis (%)
                        <input
                          disabled={locked}
                          type="number"
                          min="0"
                          max="100"
                          value={Number.isNaN(l.stenosis) ? "" : l.stenosis}
                          onChange={(e) =>
                            lesion(i, { stenosis: e.target.valueAsNumber })
                          }
                        />
                      </label>
                      <label>
                        Treatment
                        <select
                          disabled={locked}
                          aria-label="Treatment"
                          value={l.treatment}
                          onChange={(e) =>
                            lesion(i, {
                              treatment: e.target.value,
                              stents: e.target.value === "PCI" ? l.stents : [],
                            })
                          }
                        >
                          <option value="">Select…</option>
                          {["Medical therapy", "PCI", "CABG referral"].map(
                            (o) => (
                              <option key={o}>{o}</option>
                            ),
                          )}
                        </select>
                      </label>
                    </div>
                    {l.stents.map((s, j) => (
                      <div className="stent-row" key={j}>
                        <span>Stent {j + 1}</span>
                        <label>
                          Diameter (mm)
                          <input
                            disabled={locked}
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="20"
                            value={Number.isNaN(s.diameter) ? "" : s.diameter}
                            onChange={(e) =>
                              lesion(i, {
                                stents: l.stents.map((v, k) =>
                                  k === j
                                    ? { ...v, diameter: e.target.valueAsNumber }
                                    : v,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Length (mm)
                          <input
                            disabled={locked}
                            type="number"
                            min="1"
                            max="200"
                            value={Number.isNaN(s.length) ? "" : s.length}
                            onChange={(e) =>
                              lesion(i, {
                                stents: l.stents.map((v, k) =>
                                  k === j
                                    ? { ...v, length: e.target.valueAsNumber }
                                    : v,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Type
                          <select
                            disabled={locked}
                            aria-label="Type"
                            value={s.type}
                            onChange={(e) =>
                              lesion(i, {
                                stents: l.stents.map((v, k) =>
                                  k === j ? { ...v, type: e.target.value } : v,
                                ),
                              })
                            }
                          >
                            <option value="">Select…</option>
                            {["DES", "BMS", "Other"].map((o) => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        </label>
                        {!locked ? (
                          <button
                            className="icon-button"
                            aria-label={`Remove stent ${j + 1} from lesion ${i + 1}`}
                            onClick={() =>
                              lesion(i, {
                                stents: l.stents.filter((_, k) => k !== j),
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                    {l.treatment === "PCI" && !locked ? (
                      <button
                        className="text-button"
                        onClick={() =>
                          lesion(i, {
                            stents: [
                              ...l.stents,
                              {
                                diameter: Number.NaN,
                                length: Number.NaN,
                                type: "",
                              },
                            ],
                          })
                        }
                      >
                        <Plus size={15} />
                        Add stent
                      </button>
                    ) : null}
                  </div>
                ))}
                {!form.lesions.length ? (
                  <p className="muted">No lesions recorded.</p>
                ) : null}
                {!locked ? (
                  <button
                    className="secondary"
                    onClick={() =>
                      update("lesions", [
                        ...form.lesions,
                        {
                          vessel: "",
                          segment: "",
                          stenosis: Number.NaN,
                          treatment: "",
                          stents: [],
                        },
                      ])
                    }
                  >
                    <Plus size={16} />
                    Add lesion
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <div className="section-label">
                  <CalendarDays size={20} />
                  <div>
                    <h3>Discharge & continuity</h3>
                    <p>Complete disposition before finalizing this episode.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <label>
                    Discharge date
                    <input
                      disabled={locked}
                      type="date"
                      min={form.admission_date}
                      max={currentDate()}
                      value={form.discharge_date || ""}
                      onChange={(e) =>
                        update("discharge_date", e.target.value || null)
                      }
                    />
                  </label>
                  {select("discharge_status", "Discharge status", [
                    "Alive",
                    "Died in hospital",
                    "Transferred",
                  ])}
                </div>
                <div className="protocol-preview">
                  <span className="eyebrow">FOLLOW-UP PROTOCOL · DEMO V1</span>
                  <div>
                    {[1, 3, 6, 12].map((m) => (
                      <span key={m}>
                        <CalendarDays size={18} />
                        <strong>
                          {m} month{m > 1 ? "s" : ""}
                        </strong>
                      </span>
                    ))}
                  </div>
                  <p>
                    Calendar months from index admission. Demo contact window: 7
                    days early to 14 days late. No tasks are generated after an
                    in-hospital death.
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="editor-footer">
            <span>
              {dirty ? "Unsaved changes" : `Saved version ${form.version}`}
            </span>
            <div>
              {tab > 0 ? (
                <button
                  className="secondary"
                  onClick={() => setTab((v) => v - 1)}
                >
                  Back
                </button>
              ) : null}
              {tab < 2 ? (
                <button
                  className="secondary"
                  onClick={() => setTab((v) => v + 1)}
                >
                  Next section
                  <ArrowRight size={15} />
                </button>
              ) : null}
              {!locked ? (
                <button
                  disabled={busy}
                  className="primary"
                  onClick={() => action("save")}
                >
                  <Save size={16} />
                  {busy ? "Saving…" : "Save draft"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <aside className="record-aside">
          <div className="panel">
            <SectionTitle title="Record readiness" />
            <div className="readiness">
              <strong>
                {Math.round((complete / 6) * 100)}
                <small>%</small>
              </strong>
              <span>
                required fields
                <br />
                completed
              </span>
            </div>
            <div className="progress">
              <span style={{ width: (complete / 6) * 100 + "%" }} />
            </div>
            {[
              "Patient identity linked",
              "CAD enrollment active",
              `Form version ${form.form_version} retained`,
            ].map((t) => (
              <div className="check-line" key={t}>
                <Check size={15} />
                {t}
              </div>
            ))}
            <div className="divider" />
            <p className="muted">
              Finalization validates the saved record and preserves an immutable
              snapshot.
            </p>
            {role === "clinician" && form.state === "draft" ? (
              <button
                className="primary full"
                disabled={busy || dirty}
                title={dirty ? "Save your changes first" : undefined}
                onClick={() => setConfirm(true)}
              >
                <LockKeyhole size={15} />
                Finalize record
              </button>
            ) : role === "reviewer" && form.state === "final" ? (
              <button
                className="primary full"
                disabled={busy}
                onClick={() => action("review")}
              >
                <Check size={16} />
                Approve review
              </button>
            ) : (
              <div className="locked-note">
                <LockKeyhole size={16} />
                {form.state === "reviewed"
                  ? "Independently reviewed"
                  : form.state === "final"
                    ? "Awaiting independent review"
                    : "Read-only role"}
              </div>
            )}
            {dirty ? <small>Save changes before finalizing.</small> : null}
          </div>
          <div className="note-card">
            <span className="eyebrow">A CONNECTED RECORD</span>
            <p>
              Every saved change carries its author, time, and version in the
              audit trail.
            </p>
          </div>
        </aside>
      </div>
      <ErrorBox message={error} />
      {notice ? (
        <div role="status" className="success">
          <Check size={17} />
          {notice}
        </div>
      ) : null}
      {confirm ? (
        <Modal title="Finalize this record?" onClose={() => setConfirm(false)}>
          <p>
            The server will validate the saved assessment, lock a versioned
            snapshot, and schedule eligible follow-ups. This release does not
            yet support amendments.
          </p>
          <ErrorBox message={error} />
          <div className="modal-footer">
            <button className="secondary" onClick={() => setConfirm(false)}>
              Keep draft
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => action("finalize")}
            >
              {busy ? "Finalizing…" : "Finalize record"}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
