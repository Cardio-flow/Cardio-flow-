import { useState, type FormEvent } from "react";
import {
  CalendarDays,
  ArrowRight,
  Download,
  Check,
  FileSpreadsheet,
  ShieldCheck,
  Layers,
  LockKeyhole,
  GitBranch,
  ChevronRight,
} from "lucide-react";
import { api, useData, date, currentDate, download } from "./api";
import type { Task, Role, Audit } from "./types";
import { Badge, ErrorBox, Loading, Empty, Modal, SectionTitle } from "./ui";
export function Followups({
  role,
  revision,
  onSaved,
}: {
  role: Role;
  revision: number;
  onSaved: () => void;
}) {
  const { data, error } = useData<Task[]>("/tasks", revision);
  const [filter, setFilter] = useState("Open"),
    [selected, setSelected] = useState<Task | null>(null),
    [notice, setNotice] = useState("");
  const filtered = data?.filter((t) =>
    filter === "All" || filter === "Open"
      ? !["satisfied", "cancelled"].includes(t.display_state) ||
        filter === "All"
      : t.display_state === filter.toLowerCase(),
  );
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">CONTINUITY OF CARE</span>
          <h1>Follow-up queue</h1>
          <p>
            Every milestone connected to its patient, episode, and protocol.
          </p>
        </div>
        <span className="date-label">
          <CalendarDays size={16} />
          {date(currentDate())}
        </span>
      </div>
      {notice ? (
        <div className="success" role="status">
          <Check size={17} />
          {notice}
        </div>
      ) : null}
      <div className="panel">
        <div className="table-toolbar">
          <div className="segmented">
            {["Open", "Overdue", "Satisfied", "All"].map((f) => (
              <button
                className={filter === f ? "active" : ""}
                key={f}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="muted">{filtered?.length ?? 0} milestones</span>
        </div>
        <ErrorBox message={error} />
        {!data && !error ? (
          <Loading />
        ) : filtered?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Milestone</th>
                  <th>Target date</th>
                  <th>Contact window</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.name}</strong>
                      <small>{t.mrn}</small>
                    </td>
                    <td>
                      <span className="milestone-icon">
                        <CalendarDays size={15} />
                        {t.milestone}-month CAD
                      </span>
                    </td>
                    <td>{date(t.due_date)}</td>
                    <td className="muted">
                      {date(t.window_start)} – {date(t.window_end)}
                    </td>
                    <td>
                      <Badge>{t.display_state}</Badge>
                    </td>
                    <td>
                      {role === "clinician" && t.state === "scheduled" ? (
                        <button
                          className="text-button"
                          onClick={() => setSelected(t)}
                        >
                          Record contact
                          <ArrowRight size={15} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !error ? (
          <Empty title="You're up to date">
            There are no follow-ups in this view.
          </Empty>
        ) : null}
      </div>
      <p className="footnote">
        Dates use Asia/Kuwait and calendar-month arithmetic. Protocol cad.demo.1
        uses demonstration windows pending local approval.
      </p>
      {selected ? (
        <FollowupContact
          task={selected}
          onClose={() => setSelected(null)}
          onDone={(message) => {
            setSelected(null);
            setNotice(message);
            onSaved();
          }}
        />
      ) : null}
    </>
  );
}
export function FollowupContact({
  task,
  onClose,
  onDone,
}: {
  task: Task;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await api<{ message: string }>(
        `/tasks/${task.id}/contact`,
        {
          ...Object.fromEntries(new FormData(e.currentTarget)),
          version: task.version,
        },
      );
      onDone(response.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Record follow-up contact" onClose={onClose}>
      <div className="contact-summary">
        <strong>{task.name}</strong>
        <Badge tone="cad">{task.milestone}-month CAD</Badge>
        <p>
          Contact window: {date(task.window_start)} – {date(task.window_end)}
        </p>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            Contact date
            <input
              name="contact_date"
              type="date"
              defaultValue={currentDate()}
              max={currentDate()}
              required
            />
          </label>
          <label>
            Contact type
            <select aria-label="Contact type" name="contact_type">
              <option>Clinic</option>
              <option>Telephone</option>
            </select>
          </label>
          <label>
            Vital status
            <select aria-label="Vital status" name="vital_status" required>
              <option value="">Select…</option>
              <option>Alive</option>
              <option>Deceased</option>
              <option>Unknown</option>
            </select>
          </label>
          <label>
            Rehospitalized since index?
            <select
              aria-label="Rehospitalized since index?"
              name="rehospitalized"
              required
            >
              <option value="">Select…</option>
              <option>Yes</option>
              <option>No</option>
              <option>Unknown</option>
            </select>
          </label>
          <label className="span-2">
            Contact notes
            <textarea
              name="notes"
              maxLength={2000}
              rows={3}
              placeholder="Record the contact context…"
            />
          </label>
        </div>
        <p className="muted">
          Contacts outside the window remain in history. Unknown outcomes leave
          the milestone open. A recorded death cancels remaining open tasks.
        </p>
        <ErrorBox message={error} />
        <div className="modal-footer">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save contact"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Exports() {
  const [purpose, setPurpose] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<{
      content: string;
      codebook: string;
      checksum: string;
      row_count: number;
      filename: string;
    } | null>(null);
  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(await api("/exports", { purpose }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">GOVERNED DATA</span>
          <h1>Research exports</h1>
          <p>
            Reproducible datasets with a documented purpose and audit trail.
          </p>
        </div>
        <Badge tone="cad">Analyst workspace</Badge>
      </div>
      <div className="export-layout">
        <div className="panel padded">
          <div className="feature-icon">
            <FileSpreadsheet size={25} />
          </div>
          <h2>CAD episode dataset</h2>
          <p className="muted">
            One row per finalized or reviewed episode. Direct patient names,
            MRNs, and birth dates are excluded.
          </p>
          <div className="export-spec">
            <span>
              Definition<strong>cad.episodes.demo.1</strong>
            </span>
            <span>
              Format<strong>CSV + codebook</strong>
            </span>
            <span>
              Population<strong>Final & reviewed episodes</strong>
            </span>
            <span>
              Linkage<strong>Registry ID + episode UUID</strong>
            </span>
          </div>
          <form onSubmit={generate}>
            <label>
              Purpose of export
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                required
                minLength={10}
                maxLength={500}
                rows={3}
                placeholder="Describe the analysis or quality review…"
              />
            </label>
            <ErrorBox message={error} />
            <button className="primary" disabled={busy}>
              {busy ? "Generating…" : "Generate dataset"}
              <ArrowRight size={16} />
            </button>
          </form>
        </div>
        <div>
          <div className="note-card">
            <ShieldCheck size={25} />
            <h3>Accountable by design</h3>
            <p>
              Each export stores the requester, purpose, definition version, row
              count, and SHA-256 checksum with the generated content.
            </p>
            <p>
              Linkage identifiers are retained. This is a limited synthetic
              dataset, not an anonymization service.
            </p>
          </div>
          {result ? (
            <div className="panel padded export-result" role="status">
              <Badge tone="satisfied">Export ready</Badge>
              <h2>{result.row_count} episodes</h2>
              <button
                className="primary full"
                onClick={() => download(result.content, result.filename)}
              >
                <Download size={16} />
                Download CSV
              </button>
              <button
                className="secondary full"
                onClick={() =>
                  download(result.codebook, "cardio-flow-codebook.csv")
                }
              >
                <Download size={16} />
                Download codebook
              </button>
              <small>SHA-256</small>
              <code>{result.checksum}</code>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
export function Definitions({ embedded = false }: { embedded?: boolean } = {}) {
  const { data, error } = useData<{
    definitions: {
      sections: {
        key: string;
        name: string;
        fields: { key: string; label: string; required: boolean }[];
      }[];
    }[];
    checksum: string;
  }>("/definitions");
  return (
    <>
      {!embedded ? (
        <div className="page-title">
          <div>
            <span className="eyebrow">REGISTRY GOVERNANCE</span>
            <h1>Registry library</h1>
            <p>A common cardiovascular core, with space for each specialty.</p>
          </div>
          <Badge tone="draft">Clinical approval pending</Badge>
        </div>
      ) : null}
      <div className="registry-grid">
        {[
          {
            key: "CAD",
            name: "Coronary artery disease",
            state: "Sandbox available",
            text: "Presentation, angiography, lesions, PCI, discharge, and outcomes.",
            icon: GitBranch,
          },
          {
            key: "HF",
            name: "Heart failure",
            state: "Planned",
            text: "Longitudinal assessment, medication exposure, and care pathways.",
            icon: Layers,
          },
          {
            key: "EP",
            name: "Electrophysiology",
            state: "Planned",
            text: "Arrhythmia, ablation, devices, and rhythm follow-up.",
            icon: ActivityIcon,
          },
          {
            key: "SH",
            name: "Structural heart",
            state: "Planned",
            text: "Heart-team assessment, interventions, implants, and imaging.",
            icon: ShieldCheck,
          },
        ].map((r) => (
          <div
            className={"registry-card " + (r.key === "CAD" ? "current" : "")}
            key={r.key}
          >
            <div className="registry-card-top">
              <div className="feature-icon">
                <r.icon size={24} />
              </div>
              <Badge tone={r.key === "CAD" ? "cad" : "scheduled"}>
                {r.state}
              </Badge>
            </div>
            <span className="eyebrow">{r.key} REGISTRY</span>
            <h2>{r.name}</h2>
            <p>{r.text}</p>
            <div className="registry-card-bottom">
              {r.key === "CAD"
                ? "Template v1 · synthetic data"
                : "Shared core · specialist screens planned"}
              <ChevronRight size={16} />
            </div>
          </div>
        ))}
      </div>
      <div className="panel padded">
        <SectionTitle
          title="CAD template specification"
          subtitle="Read-only metadata used by this demonstration. Publication and site extensions are planned."
        />
        <ErrorBox message={error} />
        {data ? (
          <>
            <div className="definition-layers">
              <span>
                <LockKeyhole size={16} />
                Cardiovascular core
              </span>
              <ChevronRight size={16} />
              <span>CAD module template</span>
              <ChevronRight size={16} />
              <span className="muted">Site extensions · planned</span>
            </div>
            <div className="definition-sections">
              {data.definitions[0].sections.map((s) => (
                <div key={s.key}>
                  <h3>{s.name}</h3>
                  {s.fields.map((f) => (
                    <p key={f.key}>
                      {f.label}
                      <Badge tone="scheduled">Required</Badge>
                    </p>
                  ))}
                </div>
              ))}
            </div>
            <div className="checksum">
              <span>Definition SHA-256</span>
              <code>{data.checksum}</code>
            </div>
          </>
        ) : !error ? (
          <Loading />
        ) : null}
      </div>
    </>
  );
}
function ActivityIcon({ size }: { size?: number }) {
  return <GitBranch size={size} style={{ transform: "rotate(90deg)" }} />;
}
export function AuditLog({ revision }: { revision: number }) {
  const { data, error } = useData<Audit[]>("/audit", revision);
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">TRACEABILITY</span>
          <h1>Audit history</h1>
          <p>Recorded actions, preserved versions, and accountable changes.</p>
        </div>
        <Badge tone="cad">
          <LockKeyhole size={12} />
          Append-only
        </Badge>
      </div>
      <div className="panel">
        <SectionTitle
          title="Activity log"
          subtitle="Most recent 200 events · Asia/Kuwait"
        />
        <ErrorBox message={error} />
        {data ? (
          <div className="audit-list">
            {data.map((a) => (
              <details key={a.id}>
                <summary>
                  <span className="audit-dot">
                    <Check size={14} />
                  </span>
                  <span>
                    <strong>{a.action}</strong>
                    <small>
                      {a.entity_type} · {a.actor.replace("demo:", "Demo ")}
                    </small>
                  </span>
                  <time>
                    {new Date(a.created_at).toLocaleString("en-GB", {
                      timeZone: "Asia/Kuwait",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <ChevronRight size={16} />
                </summary>
                <pre>
                  {JSON.stringify(
                    { entity_id: a.entity_id, ...a.detail },
                    null,
                    2,
                  )}
                </pre>
              </details>
            ))}
          </div>
        ) : !error ? (
          <Loading />
        ) : null}
      </div>
    </>
  );
}
