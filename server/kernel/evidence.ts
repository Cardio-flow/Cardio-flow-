import { createHash } from "node:crypto";
import type { PatientState } from "./state.js";
import type { Q } from "../db/db.js";
import { ApiError } from "./base.js";

// Recorded facts and dated plans, not decisions or mutable drafts. Joined previews use the
// original record's key because their projected new row IDs do not exist until confirmation.
export function evidenceKey(s: PatientState) {
  const sort = <T extends { id: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256")
    .update(
      JSON.stringify({
        day: s.today,
        patient: s.patient,
        preferences: Object.fromEntries(
          Object.entries(s.preferences).sort(([a], [b]) => a.localeCompare(b)),
        ),
        status: s.status,
        barriers: sort(s.barriers),
        observations: sort(s.observations),
        conditions: sort(s.conditions),
        meds: sort(s.meds),
        studies: sort(s.studies),
        procedures: sort(s.procedures),
        contexts: sort(s.contexts),
        plans: sort(s.plan),
      }),
    )
    .digest("hex");
}

export function checkEvidence(s: PatientState, expected?: string) {
  if (expected && expected !== evidenceKey(s))
    throw new ApiError(
      409,
      "The patient record changed. Reopen the review to check the latest results and medicines before confirming.",
    );
}

export async function checkRecommendation(
  tx: Q,
  patientId: string,
  wizard: string,
  id?: string | null,
) {
  if (!id) return;
  const row = (
    await tx.query(
      `SELECT action,status FROM cf.recommendation WHERE id=$1 AND patient_id=$2`,
      [id, patientId],
    )
  ).rows[0];
  if (!row)
    throw new ApiError(
      404,
      "This recommendation does not belong to this patient or no longer exists.",
    );
  const action =
    typeof row.action === "string" ? JSON.parse(row.action) : row.action;
  if (action?.type !== "wizard" || action.wizard !== wizard)
    throw new ApiError(
      400,
      "This recommendation belongs to a different pathway.",
    );
  if (row.status !== "active")
    throw new ApiError(
      409,
      "This recommendation is no longer active. Reopen the patient's current review.",
    );
}
