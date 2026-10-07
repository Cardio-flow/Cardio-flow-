// Correcting medical data (migration 008). History is append-only: nothing is changed or deleted; a correction
// row (or, for results and procedures, their own versioning) says an entry was wrong. Reads leave it out, the
// rules re-run, and the original stays in the database for the audit.
import type { Q } from "../db/db.js";
import { ApiError, audit, journeyEvent, nowIso, patientInSite, uuid, type Actor } from "./base.js";
import { LIVE_EVENT, LIVE_MED, correctObservation, type Changed } from "./clinical.js";
import { MEDICATION } from "../../shared/catalog.js";

export const CORRECTION_REASONS = ["Wrong patient", "Wrong entry", "Duplicate entry", "Never happened"] as const;
const KIND_LABEL: Record<string, string> = { start: "Start", restart: "Restart", increase: "Increase", decrease: "Reduction", hold: "Hold", stop: "Stop", continue: "Change", not_taking: "Not taking", resume: "Taken again", planned: "Planned start" };
const why = (r?: string) => (r ?? "").trim().slice(0, 300) || "Entered in error";

async function mark(tx: Q, actor: Actor, patientId: string, entity: "study" | "medication" | "medication_event", entityId: string, reason: string, replacedBy: string | null = null) {
  const done = (await tx.query(`SELECT 1 FROM cf.correction WHERE entity=$1 AND entity_id=$2`, [entity, entityId])).rows[0];
  if (done) throw new ApiError(409, "This entry was already corrected");
  await tx.query(
    `INSERT INTO cf.correction(id,patient_id,entity,entity_id,reason,replaced_by,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [uuid(), patientId, entity, entityId, reason, replacedBy, actor.id],
  );
}

// A study (echo, ECG, Holter, cath…) entered in error: the study and the values measured in it go.
export async function voidStudy(tx: Q, actor: Actor, patientId: string, studyId: string, reason?: string) {
  await patientInSite(tx, actor, patientId);
  const st = (await tx.query(`SELECT kind FROM cf.study WHERE id=$1 AND patient_id=$2`, [studyId, patientId])).rows[0] as any;
  if (!st) throw new ApiError(404, "Study not found");
  await mark(tx, actor, patientId, "study", studyId, why(reason));
  const obs = (await tx.query(
    `SELECT DISTINCT ON (logical_id) id, status, code FROM cf.observation WHERE patient_id=$1 AND study_id=$2 ORDER BY logical_id, version DESC`,
    [patientId, studyId],
  )).rows as any[];
  const changed = new Set<string>(["studies"]);
  for (const o of obs.filter((o) => o.status !== "entered_in_error")) for (const c of await correctObservation(tx, actor, patientId, o.id, { enteredInError: true })) changed.add(c);
  await audit(tx, actor, "entered-in-error", "study", studyId, patientId, { kind: st.kind, reason: why(reason) });
  return [...changed] as Changed;
}

// A medicine that should not be on the list at all (wrong drug, wrong patient): the whole line goes,
// with its own dated medication steps (as when stopped).
export async function voidMedication(tx: Q, actor: Actor, patientId: string, medicationId: string, reason?: string) {
  await patientInSite(tx, actor, patientId);
  const med = (await tx.query(`SELECT drug FROM cf.medication m WHERE id=$1 AND patient_id=$2 AND ${LIVE_MED}`, [medicationId, patientId])).rows[0] as any;
  if (!med) throw new ApiError(404, "Medication not found");
  await mark(tx, actor, patientId, "medication", medicationId, why(reason));
  const name = MEDICATION[med.drug]?.name ?? med.drug;
  const gone = (await tx.query(
    `UPDATE cf.plan_action SET status='cancelled', outcome=$3, updated_at=now(), version=version+1
     WHERE patient_id=$1 AND medication_id=$2 AND status='planned' RETURNING id`,
    [patientId, medicationId, `${name} entered in error`],
  )).rows;
  await audit(tx, actor, "entered-in-error", "medication", medicationId, patientId, { drug: med.drug, reason: why(reason) });
  return (gone.length ? ["meds", "plan"] : ["meds"]) as Changed;
}

async function lastEvent(tx: Q, medicationId: string) {
  return (await tx.query(
    `SELECT * FROM cf.medication_event me WHERE medication_id=$1 AND ${LIVE_EVENT} ORDER BY effective_at DESC, recorded_at DESC LIMIT 1`,
    [medicationId],
  )).rows[0] as any;
}

// The last change recorded by mistake (a wrong increase, hold or stop): it is taken back, and the medicine
// returns to where it was. The first entry cannot be undone this way (remove the medicine instead).
export async function undoLastMedicationChange(tx: Q, actor: Actor, patientId: string, medicationId: string, reason?: string) {
  await patientInSite(tx, actor, patientId);
  const med = (await tx.query(`SELECT drug FROM cf.medication m WHERE id=$1 AND patient_id=$2 AND ${LIVE_MED}`, [medicationId, patientId])).rows[0] as any;
  if (!med) throw new ApiError(404, "Medication not found");
  const n = Number((await tx.query(`SELECT count(*) n FROM cf.medication_event me WHERE medication_id=$1 AND ${LIVE_EVENT}`, [medicationId])).rows[0].n);
  if (n <= 1) throw new ApiError(409, "This is the first entry: remove the medicine if it was entered in error, or correct its dose and date");
  const last = await lastEvent(tx, medicationId);
  await mark(tx, actor, patientId, "medication_event", last.id, why(reason));
  await audit(tx, actor, "undo-change", "medication", medicationId, patientId, { kind: last.kind, reason: why(reason) });
  await journeyEvent(tx, actor, {
    patientId, occurredAt: nowIso(), kind: "correction", category: "medication",
    title: `${MEDICATION[med.drug]?.name ?? med.drug}: last change taken back`, detail: `${KIND_LABEL[last.kind] ?? last.kind} of ${new Date(last.effective_at).toISOString().slice(0, 10)} · ${why(reason)}`,
    refType: "medication", refId: medicationId,
  });
  return ["meds"] as Changed;
}

// The last entry with a wrong dose, frequency or date: replaced by a corrected copy (same kind of change).
export async function correctMedicationEntry(
  tx: Q, actor: Actor, patientId: string, medicationId: string,
  input: { doseValue?: number | null; frequency?: string | null; effectiveAt?: string; reason?: string },
) {
  await patientInSite(tx, actor, patientId);
  const med = (await tx.query(`SELECT drug FROM cf.medication m WHERE id=$1 AND patient_id=$2 AND ${LIVE_MED}`, [medicationId, patientId])).rows[0] as any;
  if (!med) throw new ApiError(404, "Medication not found");
  const last = await lastEvent(tx, medicationId);
  if (!last) throw new ApiError(404, "Nothing to correct");
  const def = MEDICATION[med.drug];
  const hasDose = last.dose_value != null;
  const dose = hasDose && input.doseValue != null ? input.doseValue : last.dose_value;
  if (hasDose && input.doseValue != null && def?.doses?.length && !def.doses.includes(input.doseValue))
    throw new ApiError(400, `${def.name}: choose a listed dose`);
  const at = input.effectiveAt ?? new Date(last.effective_at).toISOString();
  if (Date.parse(at) > Date.now() + 5 * 60_000) throw new ApiError(400, "The date cannot be in the future");
  const prev = (await tx.query(
    `SELECT effective_at FROM cf.medication_event me WHERE medication_id=$1 AND ${LIVE_EVENT} AND id<>$2 ORDER BY effective_at DESC, recorded_at DESC LIMIT 1`,
    [medicationId, last.id],
  )).rows[0] as any;
  if (prev && Date.parse(at) < Date.parse(new Date(prev.effective_at).toISOString())) throw new ApiError(400, "The date cannot be before the previous change");
  const freq = input.frequency ?? last.frequency;
  if (dose === last.dose_value && freq === last.frequency && Date.parse(at) === Date.parse(new Date(last.effective_at).toISOString()))
    throw new ApiError(400, "Nothing changed");
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.medication_event(id,medication_id,patient_id,kind,dose_value,dose_unit,frequency,route,reason,effective_at,context_id,decision_id,recorded_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, medicationId, patientId, last.kind, dose, last.dose_unit, freq, last.route, last.reason, at, last.context_id, last.decision_id, actor.id],
  );
  await mark(tx, actor, patientId, "medication_event", last.id, why(input.reason) === "Entered in error" ? "Corrected" : why(input.reason), id);
  await journeyEvent(tx, actor, {
    patientId, occurredAt: nowIso(), kind: "correction", category: "medication",
    title: `${def?.name ?? med.drug}: entry corrected`, detail: `${KIND_LABEL[last.kind] ?? last.kind} entry corrected${input.reason?.trim() ? ` · ${input.reason.trim()}` : ""}`,
    refType: "medication", refId: medicationId,
  });
  await audit(tx, actor, "correct", "medication", medicationId, patientId, {
    before: { dose: last.dose_value, frequency: last.frequency, at: new Date(last.effective_at).toISOString() },
    after: { dose, frequency: freq, at },
  });
  return ["meds"] as Changed;
}

// A procedure entered in error: a row that replaces it as entered in error (migration 005's own mechanism).
export async function voidProcedure(tx: Q, actor: Actor, patientId: string, procedureId: string, reason?: string) {
  await patientInSite(tx, actor, patientId);
  const p = (await tx.query(
    `SELECT * FROM cf.procedure p WHERE id=$1 AND patient_id=$2 AND status='final' AND NOT EXISTS (SELECT 1 FROM cf.procedure r WHERE r.replaces=p.id)`,
    [procedureId, patientId],
  )).rows[0] as any;
  if (!p) throw new ApiError(404, "Procedure not found");
  await tx.query(
    `INSERT INTO cf.procedure(id,patient_id,kind,performed_at,attributes,summary,replaces,status,context_id,recorded_by) VALUES($1,$2,$3,$4,'{}',$5,$6,'entered_in_error',$7,$8)`,
    [uuid(), patientId, p.kind, p.performed_at, `Entered in error · ${why(reason)}`, procedureId, p.context_id, actor.id],
  );
  await audit(tx, actor, "entered-in-error", "procedure", procedureId, patientId, { kind: p.kind, reason: why(reason) });
  return null; // every rule runs again (antithrombotic durations, device and valve rules read procedures)
}

// ids hidden from the journey because their entry was corrected away
export async function correctedRefs(tx: Q, patientId: string) {
  const rows = (await tx.query(
    `SELECT entity_id::text id FROM cf.correction WHERE patient_id=$1 AND entity IN ('study','medication')
     UNION SELECT replaces::text FROM cf.procedure WHERE patient_id=$1 AND replaces IS NOT NULL`,
    [patientId],
  )).rows as { id: string }[];
  return new Set(rows.map((r) => r.id));
}
