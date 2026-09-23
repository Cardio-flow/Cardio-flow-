import { useState, type FormEvent } from "react";
import { api, currentDate, date } from "./api";
import { ErrorBox, Modal } from "./ui";

export type ClinicalTask = {
  id: string;
  kind:
    | "clinical_review"
    | "laboratory"
    | "follow_up"
    | "reassessment"
    | "administrative";
  purpose: string;
  target_date: string | null;
  assigned_to: string;
  current: { status: string; version: number; note: string } | null;
};

function noteItems(items: string[], limit: number) {
  if (!items.length) return "none shown";
  const shown = items
    .slice(0, limit)
    .map((item) =>
      item.length > 100 ? `${item.slice(0, 90)}… (see chart)` : item,
    );
  return `${shown.join("; ")}${items.length > limit ? `; ${items.length - limit} more in the chart` : ""}`;
}

export function PlanNote({
  patientId,
  encounterId,
  owner,
  problems,
  medications,
  results,
  actions,
  onClose,
  onSaved,
}: {
  patientId: string;
  encounterId: string | null;
  owner: string;
  problems: string[];
  medications: string[];
  results: string[];
  actions: Array<{ purpose: string; target_date: string | null }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const datedActions = actions.map(
    (item) =>
      `${item.purpose}${item.target_date ? ` (due ${date(item.target_date)})` : ""}`,
  );
  const initial = [
    "Clinical plan review",
    `Selected active problems: ${noteItems(problems, 8)}.`,
    `Selected current structured medications: ${noteItems(medications, 12)}.`,
    `Selected recent structured results: ${noteItems(results, 8)}.`,
    `Selected continuing actions: ${noteItems(datedActions, 12)}.`,
  ].join("\n");
  const [narrative, setNarrative] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/patients/${patientId}/care/entries`, {
        kind: "decision",
        family: "General",
        title: "Clinical plan note",
        status: "completed",
        occurred_on: currentDate(),
        encounter_id: encounterId,
        owner,
        due_date: null,
        assessment: narrative.trim(),
        action: "Clinician reviewed and documented the current plan.",
        response: "Dated actions remain in the longitudinal care plan.",
        details: {},
      });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Draft clinical plan note" onClose={onClose} wide>
      <p className="modal-intro">
        This is a snapshot of the current record and open plan. Review and edit
        it before saving; source records and dated actions remain separate.
      </p>
      <ErrorBox message={error} />
      <form className="plan-action-form" onSubmit={submit}>
        <label>
          Editable plan note
          <textarea
            value={narrative}
            onChange={(event) => setNarrative(event.target.value)}
            minLength={10}
            maxLength={6000}
            rows={12}
            required
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save reviewed note"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const taskKinds: Record<ClinicalTask["kind"], string> = {
  clinical_review: "Clinical review",
  laboratory: "Investigation / lab",
  follow_up: "Follow-up",
  reassessment: "Reassessment",
  administrative: "Care coordination",
};

export function PlanAction({
  patientId,
  encounterId,
  owner,
  task,
  onClose,
  onSaved,
}: {
  patientId: string;
  encounterId: string | null;
  owner: string;
  task?: ClinicalTask;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = useState<ClinicalTask["kind"]>("clinical_review");
  const [purpose, setPurpose] = useState("");
  const [targetDate, setTargetDate] = useState(currentDate());
  const [assignedTo, setAssignedTo] = useState(owner);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (task) {
        await api(`/clinical-tasks/${task.id}/events`, {
          status: "completed",
          note: outcome.trim(),
          version: task.current?.version ?? 1,
        });
      } else {
        await api(`/patients/${patientId}/clinical-tasks`, {
          encounter_id: encounterId,
          kind,
          purpose: purpose.trim(),
          related_concept: null,
          target_date: targetDate,
          assigned_to: assignedTo.trim(),
        });
      }
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={task ? "Complete planned action" : "Plan next action"}
      onClose={onClose}
    >
      <ErrorBox message={error} />
      <form onSubmit={submit} className="plan-action-form">
        {task ? (
          <>
            <p>
              <strong>{task.purpose}</strong>
            </p>
            <p>
              Due{" "}
              {task.target_date ? date(task.target_date) : "date not recorded"}{" "}
              · {task.assigned_to}
            </p>
            <label>
              Outcome / action taken
              <textarea
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
                required
                minLength={2}
                rows={4}
              />
            </label>
          </>
        ) : (
          <>
            <p className="modal-intro">
              A dated action appears in the patient plan and worklist and
              continues across visits.
            </p>
            <div className="form-grid">
              <label>
                Action type
                <select
                  value={kind}
                  onChange={(event) =>
                    setKind(event.target.value as ClinicalTask["kind"])
                  }
                >
                  {Object.entries(taskKinds).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Due date
                <input
                  type="date"
                  value={targetDate}
                  onChange={(event) => setTargetDate(event.target.value)}
                  required
                />
              </label>
              <label className="span-2">
                What needs to happen?
                <input
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                  placeholder="e.g. Review renal profile"
                  minLength={2}
                  maxLength={500}
                  required
                />
              </label>
              <label className="span-2">
                Responsible clinician / team
                <input
                  value={assignedTo}
                  onChange={(event) => setAssignedTo(event.target.value)}
                  minLength={2}
                  maxLength={300}
                  required
                />
              </label>
            </div>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : task ? "Complete action" : "Add to plan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export type PublishedAlert = {
  id: string;
  title: string;
  detail: string;
  severity: string;
  action: { action: string } | null;
};

export function AlertAction({
  alert,
  onClose,
  onSaved,
}: {
  alert: PublishedAlert;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [action, setAction] = useState<"act" | "snooze" | "dismiss">("act");
  const [reason, setReason] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/clinical-alerts/${alert.id}/actions`, {
        action,
        reason: reason.trim(),
        snoozed_until:
          action === "snooze" ? new Date(dateTime).toISOString() : null,
      });
      onSaved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Review clinical alert" onClose={onClose}>
      <div className="clinical-warning">
        <strong>{alert.title}</strong>
        <p>{alert.detail}</p>
      </div>
      <ErrorBox message={error} />
      <form onSubmit={submit} className="plan-action-form">
        <label>
          Action
          <select
            value={action}
            onChange={(event) => setAction(event.target.value as typeof action)}
          >
            <option value="act">Action taken</option>
            <option value="snooze">Review later</option>
            <option value="dismiss">Dismiss with reason</option>
          </select>
        </label>
        {action === "snooze" ? (
          <label>
            Review date and time
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(event) => setDateTime(event.target.value)}
              required
            />
          </label>
        ) : null}
        <label>
          Reason / action taken
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            minLength={2}
            rows={3}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save alert action"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
