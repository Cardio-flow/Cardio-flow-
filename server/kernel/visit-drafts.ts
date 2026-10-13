import type { Q } from "../db/db.js";
import { ApiError, uuid, type Actor } from "./base.js";
import {assessmentDraftView} from "./assessment.js";
const keyFor = (contextId: string) => `visit:${contextId}`;
export async function checkEntryDraftVersion(tx: Q, actor: Actor, patientId: string, scope: string, expected?: number) {
  await tx.query(`SELECT id FROM cf.patient WHERE id=$1 FOR UPDATE`, [patientId]);
  const row = (await tx.query(`SELECT version FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`, [patientId, `entry:${actor.id}:${scope}`])).rows[0];
  if ((row && expected === undefined) || (expected !== undefined && Number(row?.version ?? 0) !== expected))
    throw new ApiError(409, "This entry draft changed in another window. Review the saved draft before continuing.", "entry_draft_changed");
}
export async function checkContextDraftVersion(tx: Q, patientId: string, contextId: string, kind: "visit" | "discharge", expected?: number) {
  // Same patient lock as autosave: a save cannot race between validation and close.
  await tx.query(`SELECT id FROM cf.patient WHERE id=$1 FOR UPDATE`, [patientId]);
  const row = (await tx.query(`SELECT version FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`, [patientId, `${kind}:${contextId}`])).rows[0];
  if ((row && expected === undefined) || (expected !== undefined && Number(row?.version ?? 0) !== expected))
    throw new ApiError(409, `This ${kind === "visit" ? "visit note" : "discharge draft"} changed in another window. Load the latest draft and review it before finishing.`, kind === "visit" ? "visit_draft_changed" : "discharge_draft_changed");
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
      `SELECT status,summary FROM cf.care_context WHERE id=$1 AND patient_id=$2 AND removed_at IS NULL AND kind='clinic_visit'`,
      [contextId, patientId],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "This visit is no longer available", "visit_unavailable", {contextId});
  if (row.status !== "open")
    throw new ApiError(409, "This visit was finished in another window. Your local edits have not been added to it.", "visit_closed", {contextId});
  return row;
}
export async function getVisitDraft(
  tx: Q,
  patientId: string,
  contextId: string,
) {
  const context = await visit(tx, patientId, contextId);
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
        originalNarrative: context.summary?.narrative ?? "",
      }
    : { version: 0, note: "", narrative: context.summary?.narrative ?? "", originalNarrative: context.summary?.narrative ?? "", generatedNote: "", evidenceKey: "" };
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
      "visit_draft_changed",
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

// Unconfirmed form entries share the draft store, scoped to the clinician and patient.
// They never enter observations, decisions or the rule engine.
export async function entryDraft(tx: Q, actor: Actor, patientId: string, scope: string, input?: {version: number; answers: Record<string, unknown>; clear?: boolean}) {
  if (!/^(admission-entry|assessment:[a-f0-9-]{36})$/.test(scope)) throw new ApiError(400, "Unknown entry draft");
  await tx.query(`SELECT id FROM cf.patient WHERE id=$1 FOR UPDATE`, [patientId]);
  if (scope.startsWith("assessment:")) await visit(tx, patientId, scope.slice(11));
  const wizard = `entry:${actor.id}:${scope}`;
  const row = (await tx.query(`SELECT id,answers,version,updated_at FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`, [patientId, wizard])).rows[0];
  if (!input) {
    if(scope.startsWith("assessment:")) return {...await assessmentDraftView(tx,patientId,scope.slice(11),row),version:Number(row?.version ?? 0)};
    return row ? {answers:row.answers,version:Number(row.version)} : {version:0};
  }
  if (Number(row?.version ?? 0) !== input.version) throw new ApiError(409, "This entry draft changed in another window. Reopen it before continuing.", "entry_draft_changed");
  if (input.clear) { if (row) await tx.query(`UPDATE cf.wizard_draft SET status='completed',updated_at=now() WHERE id=$1`, [row.id]); return {version: 0}; }
  if (row) await tx.query(`UPDATE cf.wizard_draft SET answers=$2,version=version+1,updated_at=now(),updated_by=$3 WHERE id=$1`, [row.id, JSON.stringify(input.answers), actor.id]);
  else await tx.query(`INSERT INTO cf.wizard_draft(id,patient_id,wizard,answers,status,updated_by) VALUES($1,$2,$3,$4,'draft',$5)`, [uuid(), patientId, wizard, JSON.stringify(input.answers), actor.id]);
  return {version: input.version + 1};
}
