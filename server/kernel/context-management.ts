import type { Q } from "../db/db.js";
import {
  ApiError,
  audit,
  journeyEvent,
  nowIso,
  patientInSite,
  today,
  uuid,
  type Actor,
} from "./base.js";
import { LIVE_EVENT, LIVE_MED, completeMatching, type Changed } from "./clinical.js";
import { reopenCompletedBy } from "./corrections.js";
import { daysBetween, localDay } from "../../shared/clinical.js";
import { isHfAdmission, readmissionBand } from "../../shared/encounters.js";
import type { PastAdmissionAnswers } from "../../shared/admission-history.js";
import { checkEntryDraftVersion } from "./visit-drafts.js";

async function validatePastPeriod(
  tx: Q,
  patient: any,
  patientId: string,
  startedOn: string,
  endedOn: string,
  enteredLocation: string,
  ignoreId: string | null = null,
) {
  if (endedOn < startedOn)
    throw new ApiError(400, "Discharge date cannot be before admission date");
  if (startedOn > today() || endedOn > today())
    throw new ApiError(400, "Past admission dates cannot be in the future");
  if (
    !patient.birth_date_estimated &&
    startedOn < localDay(new Date(patient.birth_date).toISOString())
  )
    throw new ApiError(
      400,
      "Admission date cannot be before the patient's date of birth",
    );
  const death = (
    await tx.query(
      `SELECT status,effective_on::text AS day FROM cf.status_event WHERE patient_id=$1 AND kind='vital' ORDER BY effective_on DESC,recorded_at DESC LIMIT 1`,
      [patientId],
    )
  ).rows[0];
  if (death?.status === "died" && endedOn > death.day)
    throw new ApiError(
      400,
      "This admission cannot end after the recorded date of death",
    );
  const rows = (
    await tx.query(
      `SELECT id,started_at,ended_at,location FROM cf.care_context WHERE patient_id=$1 AND kind='admission' AND removed_at IS NULL AND ($2::uuid IS NULL OR id<>$2)`,
      [patientId, ignoreId],
    )
  ).rows;
  const location = enteredLocation.trim() || "Not recorded";
  for (const c of rows) {
    const start = localDay(new Date(c.started_at).toISOString()),
      end = c.ended_at ? localDay(new Date(c.ended_at).toISOString()) : today();
    if (
      start === startedOn &&
      end === endedOn &&
      (!enteredLocation.trim() || (c.location ?? "Not recorded").toLowerCase() === location.toLowerCase())
    )
      throw new ApiError(
        409,
        "An admission on these dates already exists. Edit that admission instead.",
        "admission_duplicate",
        { contextId: c.id },
      );
    // inclusive dates; a readmission on the day of a discharge (or a discharge on the day the next stay
    // started) is allowed, a stay inside another one is not
    const touching = startedOn === end || (endedOn === start && startedOn < start);
    if (start <= endedOn && end >= startedOn && !touching)
      throw new ApiError(
        409,
        "These dates overlap an existing admission. Review that admission before saving.",
        "admission_overlap",
        { contextId: c.id },
      );
  }
}

// A closed historical encounter is added directly. It does not run the live
// admission/discharge commands or turn reported medicines/labs into current facts.
export async function recordPastAdmission(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: PastAdmissionAnswers & { draftVersion: number },
) {
  await tx.query(`SELECT id FROM cf.patient WHERE id=$1 FOR UPDATE`, [
    patientId,
  ]);
  const patient = await patientInSite(tx, actor, patientId);
  await checkEntryDraftVersion(
    tx,
    actor,
    patientId,
    "past-admission",
    input.draftVersion,
  );
  await validatePastPeriod(
    tx,
    patient,
    patientId,
    input.startedOn,
    input.endedOn,
    input.location,
  );
  const location = input.location.trim() || null;
  const id = uuid(),
    startedAt = new Date(`${input.startedOn}T00:00:00+03:00`).toISOString(),
    endedAt = new Date(`${input.endedOn}T00:00:00+03:00`).toISOString();
  const summary = {
    historical: true,
    dateOnly: true,
    source: input.source,
    narrative: input.narrative,
    note: input.note,
    events: input.events.filter((e) => e !== "None"),
    dischargeStatus: input.dischargeStatus,
    destination: input.destination || null,
    reportedLabs: input.reportedLabs,
    reportedMedications: input.reportedMedications,
    hfRelated: isHfAdmission({ reasons: input.reasons }),
    los: daysBetween(input.startedOn, input.endedOn),
  };
  await tx.query(
    `INSERT INTO cf.care_context(id,patient_id,kind,status,started_at,ended_at,location,service,reasons,summary,created_by) VALUES($1,$2,'admission','closed',$3,$4,$5,'Hospital admission',$6,$7,$8)`,
    [
      id,
      patientId,
      startedAt,
      endedAt,
      location,
      input.reasons,
      JSON.stringify(summary),
      actor.id,
    ],
  );
  await refreshAdmissions(tx, patientId);
  await journeyEvent(tx, actor, {
    patientId,
    contextId: id,
    occurredAt: startedAt,
    kind: "admission",
    category: "visit",
    title: `Past admission · ${input.reasons.join(", ")}`,
    detail: [location, `Source: ${input.source}`, input.narrative]
      .filter(Boolean)
      .join(" · "),
    refType: "care_context",
    refId: id,
  });
  await journeyEvent(tx, actor, {
    patientId,
    contextId: id,
    occurredAt: endedAt,
    kind: "discharge",
    category: "visit",
    title: "Past admission ended",
    detail: [
      input.dischargeStatus,
      input.destination,
      input.events.filter((e) => e !== "None").join(", "),
    ]
      .filter(Boolean)
      .join(" · "),
    refType: "care_context",
    refId: id,
  });
  await audit(
    tx,
    actor,
    "record-past-admission",
    "care_context",
    id,
    patientId,
    {
      source: input.source,
      startedOn: input.startedOn,
      endedOn: input.endedOn,
      dateOnly: true,
    },
  );
  await tx.query(
    `UPDATE cf.wizard_draft SET status='completed',updated_at=now() WHERE patient_id=$1 AND wizard=$2 AND status='draft'`,
    [patientId, `entry:${actor.id}:past-admission`],
  );
  return { id, changed: ["contexts"] as Changed };
}

async function context(
  tx: Q,
  actor: Actor,
  patientId: string,
  id: string,
  version: number,
) {
  await patientInSite(tx, actor, patientId);
  const c = (
    await tx.query(
      `SELECT * FROM cf.care_context WHERE id=$1 AND patient_id=$2 AND removed_at IS NULL FOR UPDATE`,
      [id, patientId],
    )
  ).rows[0] as any;
  if (!c || !["admission", "clinic_visit"].includes(c.kind))
    throw new ApiError(404, "Visit or admission not found");
  if (c.version !== version)
    throw new ApiError(
      409,
      "This visit or admission changed. Reopen it before saving.",
    );
  return c;
}

// Date/reason corrections also recompute subsequent readmission relationships.
async function refreshAdmissions(tx: Q, patientId: string) {
  const rows = (
    await tx.query(
      `SELECT * FROM cf.care_context WHERE patient_id=$1 AND kind='admission' AND removed_at IS NULL ORDER BY started_at`,
      [patientId],
    )
  ).rows as any[];
  for (const c of rows) {
    const prev = rows
      .filter(
        (p) =>
          p.id !== c.id &&
          p.status === "closed" &&
          p.ended_at &&
          new Date(p.ended_at) <= new Date(c.started_at),
      )
      .sort((a, b) => +new Date(b.ended_at) - +new Date(a.ended_at))[0];
    const days = prev
      ? daysBetween(
          new Date(prev.ended_at).toISOString(),
          new Date(c.started_at).toISOString(),
        )
      : null;
    const readmission = prev
      ? {
          days,
          band: readmissionBand(days!),
          previousId: prev.id,
          previousDischarge: new Date(prev.ended_at).toISOString(),
          previousHfRelated: isHfAdmission(prev),
          hfReadmission: isHfAdmission(prev) && isHfAdmission(c),
        }
      : null;
    await tx.query(
      `UPDATE cf.care_context SET previous_context_id=$2, summary=summary || $3 WHERE id=$1`,
      [
        c.id,
        prev?.id ?? null,
        JSON.stringify({
          readmission,
          ...(c.ended_at
            ? {
                los: daysBetween(
                  new Date(c.started_at).toISOString(),
                  new Date(c.ended_at).toISOString(),
                ),
              }
            : {}),
        }),
      ],
    );
  }
}

export type ContextEdit = {
  version: number;
  reason: string;
  startedAt: string;
  endedAt?: string | null;
  location: string;
  service: string;
  reasons: string[];
  symptoms: string[];
  narrative: string;
  note: string;
  route?: string | null;
  hfRelated?: boolean | null;
  dischargeStatus?: string;
  destination?: string | null;
  events?: string[];
  handover?: string;
  source?: string;
  reportedLabs?: string;
  reportedMedications?: string;
};
export async function editContext(
  tx: Q,
  actor: Actor,
  patientId: string,
  id: string,
  input: ContextEdit,
) {
  const c = await context(tx, actor, patientId, id, input.version);
  if (!input.reason.trim())
    throw new ApiError(400, "Give a reason for the correction");
  if (
    localDay(input.startedAt) > today() ||
    (input.endedAt && localDay(input.endedAt) > today())
  )
    throw new ApiError(
      400,
      "Visit and admission dates cannot be in the future",
    );
  if (c.status === "closed" && !input.endedAt)
    throw new ApiError(400, "A closed visit or admission needs its end date");
  if (c.status === "open" && input.endedAt)
    throw new ApiError(
      400,
      "Finish the visit or discharge the admission before setting an end date",
    );
  if (input.endedAt && new Date(input.endedAt) < new Date(input.startedAt))
    throw new ApiError(400, "End date cannot be before the start date");
  if (c.kind === "clinic_visit" && !input.location.trim()) throw new ApiError(400, "Clinic location is required");
  const location = c.kind === "admission" && !input.location.trim() ? c.location : input.location;
  if(c.summary.historical && input.endedAt) await validatePastPeriod(tx,await patientInSite(tx,actor,patientId),patientId,localDay(input.startedAt),localDay(input.endedAt),location ?? "",id);
  const summary = {
    ...c.summary,
    symptoms: input.symptoms,
    narrative: input.narrative,
    note: input.note,
    ...(c.summary.historical ? {source:input.source ?? c.summary.source,reportedLabs:input.reportedLabs ?? c.summary.reportedLabs,reportedMedications:input.reportedMedications ?? c.summary.reportedMedications} : {}),
    ...(c.kind === "admission"
      ? {
          route: input.route ?? null,
          hfRelated:
            input.hfRelated ?? isHfAdmission({ reasons: input.reasons }),
          ...(c.status === "closed"
            ? {
                dischargeStatus: input.dischargeStatus ?? "",
                destination:
                  c.summary.outcome === "died"
                    ? null
                    : (input.destination ?? null),
                events: input.events ?? [],
                handover: input.handover ?? "",
              }
            : {}),
        }
      : {}),
  };
  await tx.query(
    `UPDATE cf.care_context SET started_at=$2,ended_at=$3,location=$4,service=$5,reasons=$6,summary=$7,version=version+1 WHERE id=$1`,
    [
      id,
      input.startedAt,
      input.endedAt ?? null,
      location,
      input.service,
      input.reasons,
      JSON.stringify(summary),
    ],
  );
  if (
    c.kind === "clinic_visit" &&
    +new Date(c.started_at) !== +new Date(input.startedAt)
  ) {
    // the visit still exists (only its date changed): its own bookings stay with it
    await reopenCompletedBy(tx, patientId, [id]);
    await completeMatching(tx, actor, patientId, {
      type: "visit",
      at: input.startedAt,
      ref: id,
    });
  }
  await refreshAdmissions(tx, patientId);
  await audit(tx, actor, "correct-context", "care_context", id, patientId, {
    reason: input.reason,
    before: c,
    after: input,
  });
  await journeyEvent(tx, actor, {
    patientId,
    occurredAt: nowIso(),
    kind: "correction",
    category: "visit",
    title: `${c.kind === "admission" ? "Admission" : "Clinic visit"} corrected`,
    detail: input.reason,
    contextId: id,
  });
  return { changed: ["contexts", "plan"] as Changed };
}

export async function removeContext(
  tx: Q,
  actor: Actor,
  patientId: string,
  id: string,
  input: { version: number; reason: string },
) {
  const c = await context(tx, actor, patientId, id, input.version);
  if (!input.reason.trim())
    throw new ApiError(400, "Give a reason for removal");
  await tx.query(
    `UPDATE cf.care_context SET removed_at=now(),removed_by=$2,removed_reason=$3,version=version+1 WHERE id=$1`,
    [id, actor.id, input.reason],
  );
  await reopenCompletedBy(tx, patientId, [id]);
  // A shared study booking also belongs to its other live encounter. Keep it open
  // when one originating visit is removed, while retaining the historical links.
  const shared = (await tx.query(`UPDATE cf.plan_action p SET source_context_id=(
    SELECT c.id FROM unnest(p.context_refs) AS ref(id) JOIN cf.care_context c ON c.id=ref.id
    WHERE c.patient_id=$1 AND c.id<>$2 AND c.removed_at IS NULL ORDER BY c.started_at,c.id LIMIT 1),
    version=p.version+1,updated_at=now()
    WHERE p.patient_id=$1 AND p.source_context_id=$2 AND p.status='planned' AND EXISTS(
      SELECT 1 FROM unnest(p.context_refs) AS ref(id) JOIN cf.care_context c ON c.id=ref.id
      WHERE c.patient_id=$1 AND c.id<>$2 AND c.removed_at IS NULL) RETURNING p.id,p.source_context_id`,[patientId,id])).rows;
  for (const row of shared) await audit(tx,actor,"retain-shared-booking","plan_action",row.id,patientId,{removedContext:id,remainingContext:row.source_context_id});
  await tx.query(
    // monitoring that belongs to a medicine still being taken outlives the visit it was booked in
    `UPDATE cf.plan_action pa SET status='cancelled',outcome='Originating visit or admission removed',updated_at=now(),version=version+1
     WHERE patient_id=$1 AND source_context_id=$2 AND status='planned'
       AND NOT (pa.medication_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM cf.medication m WHERE m.id=pa.medication_id AND ${LIVE_MED}
           AND coalesce((SELECT me.kind FROM cf.medication_event me WHERE me.medication_id=m.id AND ${LIVE_EVENT} ORDER BY me.effective_at DESC, me.recorded_at DESC LIMIT 1), 'start') <> 'stop'))`,
    [patientId, id],
  );
  await refreshAdmissions(tx, patientId);
  await audit(tx, actor, "remove-context", "care_context", id, patientId, {
    reason: input.reason,
    before: c,
  });
  return { changed: ["contexts", "plan"] as Changed };
}
