import type { Q } from "../db/db.js";
import {
  ApiError,
  audit,
  journeyEvent,
  nowIso,
  patientInSite,
  today,
  type Actor,
} from "./base.js";
import { completeMatching, type Changed } from "./clinical.js";
import { reopenCompletedBy } from "./corrections.js";
import { daysBetween, localDay } from "../../shared/clinical.js";
import { isHfAdmission, readmissionBand } from "../../shared/encounters.js";

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
  const summary = {
    ...c.summary,
    symptoms: input.symptoms,
    narrative: input.narrative,
    note: input.note,
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
      input.location,
      input.service,
      input.reasons,
      JSON.stringify(summary),
    ],
  );
  if (
    c.kind === "clinic_visit" &&
    +new Date(c.started_at) !== +new Date(input.startedAt)
  ) {
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
  await tx.query(
    `UPDATE cf.plan_action SET status='cancelled',outcome='Originating visit or admission removed',updated_at=now(),version=version+1 WHERE patient_id=$1 AND source_context_id=$2 AND status='planned'`,
    [patientId, id],
  );
  await refreshAdmissions(tx, patientId);
  await audit(tx, actor, "remove-context", "care_context", id, patientId, {
    reason: input.reason,
    before: c,
  });
  return { changed: ["contexts", "plan"] as Changed };
}
