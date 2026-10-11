import { useState } from "react";
import { PencilLine, Trash2 } from "lucide-react";
import { api } from "../api";
import { DateInput, Drawer, MultiChoice, SingleChoice } from "../ui";
import { localDay } from "../../shared/clinical";
import {
  ADMISSION_REASONS,
  ADMISSION_ROUTES,
  DISCHARGE_DESTINATION,
  IN_HOSPITAL_EVENTS,
  SYMPTOMS,
} from "../../shared/encounters";
const VISIT_REASONS = [
  "Heart failure",
  "Post-discharge",
  "Medication titration",
  "Post-ACS",
  "Post-PCI",
  "Valve",
  "Arrhythmia",
  "Device",
  "Chest pain",
  "Routine cardiology",
  "Other",
];
const options = (a: string[]) => a.map((value) => ({ value, label: value }));
const time = (at: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuwait",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
export function ContextEdit({
  patientId,
  context: c,
  remove = false,
  onClose,
  onDone,
}: {
  patientId: string;
  context: any;
  remove?: boolean;
  onClose(): void;
  onDone(m?: string, r?: any): void;
}) {
  const admission = c.kind === "admission";
  const label = admission ? "admission" : "visit";
  const [v, setV] = useState<any>({
    start: localDay(c.startedAt),
    startTime: time(c.startedAt),
    end: c.endedAt ? localDay(c.endedAt) : "",
    endTime: c.endedAt ? time(c.endedAt) : "",
    location: c.location ?? "",
    service: c.service ?? "Cardiology",
    reasons: c.reasons,
    symptoms: c.summary.symptoms ?? [],
    narrative: c.summary.narrative ?? "",
    note: c.summary.note ?? "",
    route: c.summary.route ?? "",
    hfRelated: c.summary.hfRelated,
    dischargeStatus: c.summary.dischargeStatus ?? "",
    destination: c.summary.destination ?? "",
    events: c.summary.events ?? [],
    handover: c.summary.handover ?? "",
  });
  const set = (k: string, x: any) => setV((old: any) => ({ ...old, [k]: x }));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const valid =
    reason &&
    (remove ||
      (v.start &&
        v.startTime &&
        v.location.trim() &&
        v.service.trim() &&
        v.reasons.length &&
        (c.status !== "closed" || (v.end && v.endTime))));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const body = remove
        ? { version: c.version, reason }
        : {
            version: c.version,
            reason,
            startedAt: new Date(
              `${v.start}T${v.startTime}:00+03:00`,
            ).toISOString(),
            endedAt: v.end
              ? new Date(`${v.end}T${v.endTime}:00+03:00`).toISOString()
              : null,
            location: v.location,
            service: v.service,
            reasons: v.reasons,
            symptoms: v.symptoms,
            narrative: v.narrative,
            note: v.note,
            ...(admission
              ? {
                  route: v.route || null,
                  hfRelated: v.hfRelated ?? null,
                  dischargeStatus: v.dischargeStatus,
                  destination: v.destination || null,
                  events: v.events,
                  handover: v.handover,
                }
              : {}),
          };
      onDone(
        `${admission ? "Admission" : "Visit"} ${remove ? "removed" : "updated"}`,
        await api(
          `/patients/${patientId}/contexts/${c.id}/${remove ? "remove" : "edit"}`,
          { body },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const field = (key: string, title: string, multi = false) => (
    <label className="q">
      <span className="label">{title}</span>
      {multi ? (
        <textarea
          aria-label={title}
          className="input"
          rows={3}
          value={v[key]}
          onChange={(e) => set(key, e.target.value)}
        />
      ) : (
        <input
          aria-label={title}
          className="input"
          value={v[key]}
          onChange={(e) => set(key, e.target.value)}
        />
      )}
    </label>
  );
  return (
    <Drawer
      title={`${remove ? "Delete" : "Edit"} ${label}`}
      subtitle={`${c.service ?? "Cardiology"} · dates and documentation`}
      icon={remove ? <Trash2 size={22} /> : <PencilLine size={22} />}
      onClose={onClose}
      footer={
        <>
          <span className="note">
            {busy ? "Saving…" : "Changes are kept in the audit history"}
          </span>
          <button
            className={`btn ${remove ? "danger" : "primary"}`}
            disabled={!valid || busy}
            onClick={save}
          >
            {remove ? `Delete ${label}` : "Save changes"}
          </button>
        </>
      }
    >
      <div className="drawer-body">
        {remove ? (
          <div className="infobox">
            This {label} leaves the active history. Linked labs, medicines,
            procedures and patient status remain. Pending plans created here are
            cancelled; follow-ups completed only by this visit reopen. The
            original and reason stay in the audit history.
          </div>
        ) : (
          <>
            <div className="row wrap">
              <label className="q grow">
                <span className="label">Start date</span>
                <DateInput
                  aria-label="Start date"
                  value={v.start}
                  onChange={(e) => set("start", e.target.value)}
                />
              </label>
              <label className="q">
                <span className="label">Start time (Kuwait)</span>
                <input
                  type="time"
                  className="input"
                  value={v.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                />
              </label>
            </div>
            {c.status === "closed" && (
              <div className="row wrap">
                <label className="q grow">
                  <span className="label">End date</span>
                  <DateInput
                    aria-label="End date"
                    value={v.end}
                    onChange={(e) => set("end", e.target.value)}
                  />
                </label>
                <label className="q">
                  <span className="label">End time (Kuwait)</span>
                  <input
                    type="time"
                    className="input"
                    value={v.endTime}
                    onChange={(e) => set("endTime", e.target.value)}
                  />
                </label>
              </div>
            )}
            {field(
              "location",
              admission ? "Ward / location" : "Clinic location",
            )}
            {field("service", "Service")}
            <div className="q">
              <div className="label">Reasons</div>
              <MultiChoice
                options={options([
                  ...new Set([
                    ...(admission ? ADMISSION_REASONS : VISIT_REASONS),
                    ...c.reasons,
                  ]),
                ])}
                value={v.reasons}
                onChange={(x) => set("reasons", x)}
              />
            </div>
            <div className="q">
              <div className="label">Symptoms</div>
              <MultiChoice
                options={options(SYMPTOMS)}
                value={v.symptoms}
                onChange={(x) => set("symptoms", x)}
              />
            </div>
            {admission && (
              <>
                <div className="q">
                  <div className="label">Admission route</div>
                  <SingleChoice
                    label="Admission route"
                    options={options(ADMISSION_ROUTES)}
                    value={v.route}
                    onChange={(x) => set("route", x)}
                  />
                </div>
                <label className="row">
                  <input
                    type="checkbox"
                    checked={!!v.hfRelated}
                    onChange={(e) => set("hfRelated", e.target.checked)}
                  />
                  HF-related admission
                </label>
              </>
            )}
            {field("narrative", "Clinical narrative", true)}
            {c.status === "closed" && (
              <>
                {admission && (
                  <>
                    {field("dischargeStatus", "Condition at discharge")}
                    <div className="q">
                      <div className="label">Destination</div>
                      <SingleChoice
                        label="Destination"
                        options={options(DISCHARGE_DESTINATION)}
                        value={v.destination}
                        onChange={(x) => set("destination", x)}
                      />
                    </div>
                    <div className="q">
                      <div className="label">Admission events</div>
                      <MultiChoice
                        options={options(IN_HOSPITAL_EVENTS)}
                        value={v.events}
                        onChange={(x) => set("events", x)}
                      />
                    </div>
                    {field("handover", "Handover", true)}
                  </>
                )}
                {field(
                  "note",
                  admission ? "Discharge summary" : "Clinic note",
                  true,
                )}
              </>
            )}
            <div className="help">
              Correcting encounter dates does not move recorded labs, medicines
              or procedures to a different date.
            </div>
          </>
        )}
        <div className="q">
          <div className="label">
            {remove ? "Reason for removal" : "Reason for correction"}
          </div>
          <SingleChoice
            label={remove ? "Reason for removal" : "Reason for correction"}
            options={options(
              remove
                ? [
                    "Wrong entry",
                    "Duplicate entry",
                    "Never happened",
                    "Wrong patient",
                  ]
                : ["Wrong date", "Wrong details", "Wrong note"],
            )}
            value={reason}
            onChange={setReason}
          />
        </div>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
      </div>
    </Drawer>
  );
}
