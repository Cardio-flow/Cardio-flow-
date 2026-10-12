import type { Q } from "../db/db.js";
import { audit, type Actor } from "./base.js";
import type { PlanInput } from "./clinical.js";
import {
  needsExplicitReview,
  studyBookingKey,
} from "../../shared/plan-evidence.js";

export async function reuseBooking(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: PlanInput,
) {
  const rows = (
    await tx.query(
      `SELECT * FROM cf.plan_action WHERE patient_id=$1 AND status='planned' AND due_date IS NOT DISTINCT FROM $2::date ORDER BY created_at,id FOR UPDATE`,
      [patientId, input.dueDate],
    )
  ).rows;
  const key =
    input.category === "investigation" && !input.medicationId
      ? studyBookingKey(input.completesOn ?? {})
      : null;
  const same = rows.find(
    (row) =>
      row.title.toLowerCase() === input.title.toLowerCase() ||
      (key &&
        row.category === "investigation" &&
        !row.medication_id &&
        studyBookingKey(row.completes_on) === key),
  );
  if (!same) return null;
  const indications = [
    ...new Set([same.title, ...(same.indications ?? []), input.title]),
  ];
  const decisions = [
    ...new Set(
      [
        same.decision_id,
        ...(same.decision_refs ?? []),
        input.decisionId,
      ].filter(Boolean),
    ),
  ];
  const contexts = [
    ...new Set(
      [
        same.source_context_id,
        ...(same.context_refs ?? []),
        input.contextId,
      ].filter(Boolean),
    ),
  ];
  const changed =
    JSON.stringify(indications) !== JSON.stringify(same.indications ?? []) ||
    JSON.stringify(decisions) !== JSON.stringify(same.decision_refs ?? []) ||
    JSON.stringify(contexts) !== JSON.stringify(same.context_refs ?? []);
  if (changed) {
    await tx.query(
      `UPDATE cf.plan_action SET indications=$2,decision_refs=$3,context_refs=$4,version=version+1,updated_at=now() WHERE id=$1`,
      [same.id, indications, decisions, contexts],
    );
    await audit(tx, actor, "reuse-booking", "plan_action", same.id, patientId, {
      indications,
      decisionId: input.decisionId ?? null,
    });
  }
  return { id: same.id as string, changed: changed ? ["plan"] : [] };
}

// Existing erroneous automatic specialist completions return to review. Duplicate
// study bookings are cancelled with an explicit merge trail; original rows stay.
export async function reconcileExistingPlans(tx: Q, actor: Actor) {
  const patients = (
    await tx.query(
      `SELECT DISTINCT patient_id FROM cf.plan_action p JOIN cf.patient pt ON pt.id=p.patient_id WHERE pt.site_id=$1 AND pt.removed_at IS NULL AND
    ((p.status='completed' AND p.completes_on->>'type'='visit' AND p.reviewed_at IS NULL AND p.completed_by_ref IS NOT NULL)
      OR (p.status='planned' AND p.category='investigation' AND p.medication_id IS NULL AND p.completes_on->>'type'='study'))`,
      [actor.siteId],
    )
  ).rows;
  for (const { patient_id: patientId } of patients) {
    const rows = (
      await tx.query(
        `SELECT * FROM cf.plan_action WHERE patient_id=$1 ORDER BY created_at,id FOR UPDATE`,
        [patientId],
      )
    ).rows;
    for (const row of rows)
      if (
        row.status === "completed" &&
        row.reviewed_at == null &&
        row.completed_by_ref &&
        needsExplicitReview(row.title, row.completes_on)
      ) {
        const visit = (
          await tx.query(
            `SELECT id FROM cf.care_context WHERE id::text=$1 AND patient_id=$2 AND kind='clinic_visit'`,
            [row.completed_by_ref, patientId],
          )
        ).rows[0];
        if (!visit) continue;
        await tx.query(
          `UPDATE cf.plan_action SET status='planned',progress='planned',completed_at=NULL,completed_by_ref=NULL,completion_refs='{}',outcome='',version=version+1,updated_at=now() WHERE id=$1`,
          [row.id],
        );
        await audit(
          tx,
          actor,
          "specialist-review-required",
          "plan_action",
          row.id,
          patientId,
          { previousCompletion: row.completed_by_ref, title: row.title },
        );
      }
    const seen = new Map<string, any>();
    for (const row of rows) {
      if (
        row.status !== "planned" ||
        row.category !== "investigation" ||
        row.medication_id ||
        !row.due_date
      )
        continue;
      const criterion = studyBookingKey(row.completes_on);
      if (!criterion) continue;
      const key = `${row.due_date}:${criterion}`,
        first = seen.get(key);
      if (!first) {
        seen.set(key, row);
        continue;
      }
      for (const title of [row.title, ...(row.indications ?? [])])
        await reuseBooking(tx, actor, patientId, {
          category: row.category,
          title,
          dueDate: row.due_date,
          completesOn: row.completes_on,
          decisionId: row.decision_id,
          contextId: row.source_context_id,
        });
      // Preserve links accumulated by an earlier reuse, as well as this row's primary links.
      await tx.query(
        `UPDATE cf.plan_action SET decision_refs=ARRAY(SELECT DISTINCT unnest(decision_refs || $2::uuid[])), context_refs=ARRAY(SELECT DISTINCT unnest(context_refs || $3::uuid[])) WHERE id=$1`,
        [first.id, row.decision_refs ?? [], row.context_refs ?? []],
      );
      await tx.query(
        `UPDATE cf.plan_action SET status='cancelled',outcome=$2,version=version+1,updated_at=now() WHERE id=$1`,
        [
          row.id,
          `Merged with booking ${first.id}; all indications and decision links retained`,
        ],
      );
      await audit(
        tx,
        actor,
        "merge-booking",
        "plan_action",
        row.id,
        patientId,
        { bookingId: first.id },
      );
    }
  }
}
