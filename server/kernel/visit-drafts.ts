import type { Q } from "../db/db.js";
import { ApiError, uuid, type Actor } from "./base.js";
const keyFor = (contextId: string) => `visit:${contextId}`;
export async function checkContextDraftVersion(tx: Q, patientId: string, contextId: string, kind: "visit" | "discharge", expected?: number) {
  // Same patient lock as autosave: a save cannot race between validation and close.
  await tx.query(`SELECT id FROM cf.patient WHERE id=$1 FOR UPDATE`, [patientId]);
  const row = (await tx.query(`SELECT version FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`, [patientId, `${kind}:${contextId}`])).rows[0];
  if ((row && expected === undefined) || (expected !== undefined && Number(row?.version ?? 0) !== expected))
    throw new ApiError(409, `This ${kind === "visit" ? "visit note" : "discharge draft"} changed in another window. Load the latest draft and review it before finishing.`);
}
export async function getDischargeDraft(tx: Q, patientId: string, contextId: string) {
  await admission(tx, patientId, contextId);
  const row = (await tx.query(`SELECT answers,version FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1`, [patientId, `discharge:${contextId}`])).rows[0];
  return row ? { ...row.answers, version: Number(row.version) } : { version: 0 };
}
async function admission(tx: Q, patientId: string, contextId: string) {
  const row = (await tx.query(`SELECT status FROM cf.care_context WHERE id=$1 AND patient_id=$2 AND removed_at IS NULL AND kind='admission'`, [contextId, patientId])).rows[0];
  if (!row) throw new ApiError(404, "Admission not found");
  if (row.status !== "open") throw new ApiError(409, "This admission is already closed");
}
export async function saveDischargeDraft(tx: Q, actor: Actor, patientId: string, contextId: string, input: {version: number; [key: string]: unknown}) {
  await checkContextDraftVersion(tx, patientId, contextId, "discharge", input.version);
  await admission(tx, patientId, contextId);
  const {version, ...answers} = input;
  const key = `discharge:${contextId}`;
  const current = (await tx.query(`SELECT id FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1`, [patientId, key])).rows[0];
  if (current) await tx.query(`UPDATE cf.wizard_draft SET answers=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1`, [current.id, JSON.stringify(answers), actor.id]);
  else await tx.query(`INSERT INTO cf.wizard_draft(id,patient_id,wizard,answers,status,updated_by) VALUES($1,$2,$3,$4,'draft',$5)`, [uuid(), patientId, key, JSON.stringify(answers), actor.id]);
  return {version: version + 1};
}
async function visit(tx: Q, patientId: string, contextId: string) {
  const row = (
    await tx.query(
      `SELECT status FROM cf.care_context WHERE id=$1 AND patient_id=$2 AND removed_at IS NULL AND kind='clinic_visit'`,
      [contextId, patientId],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "Visit not found");
  if (row.status !== "open")
    throw new ApiError(409, "This visit is already closed");
}
export async function getVisitDraft(
  tx: Q,
  patientId: string,
  contextId: string,
) {
  await visit(tx, patientId, contextId);
  const row = (
    await tx.query(
      `SELECT answers,version,updated_at FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1`,
      [patientId, keyFor(contextId)],
    )
  ).rows[0];
  return row
    ? {
        ...row.answers,
        version: Number(row.version),
        updatedAt: row.updated_at,
      }
    : { version: 0 };
}
export async function saveVisitDraft(
  tx: Q,
  actor: Actor,
  patientId: string,
  contextId: string,
  input: {
    version: number;
    note: string;
    narrative: string;
    generatedNote: string;
    evidenceKey: string;
  },
) {
  await tx.query(`SELECT id FROM cf.patient WHERE id=$1 FOR UPDATE`, [
    patientId,
  ]);
  await visit(tx, patientId, contextId);
  const current = (
    await tx.query(
      `SELECT id,version FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [patientId, keyFor(contextId)],
    )
  ).rows[0];
  if (Number(current?.version ?? 0) !== input.version)
    throw new ApiError(
      409,
      "This visit draft changed in another window. Reopen it before replacing that draft.",
    );
  const { version, ...answers } = input;
  if (current)
    await tx.query(
      `UPDATE cf.wizard_draft SET answers=$2,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1`,
      [current.id, JSON.stringify(answers), actor.id],
    );
  else
    await tx.query(
      `INSERT INTO cf.wizard_draft(id,patient_id,wizard,answers,status,updated_by) VALUES($1,$2,$3,$4,'draft',$5)`,
      [uuid(), patientId, keyFor(contextId), JSON.stringify(answers), actor.id],
    );
  return { version: version + 1 };
}
