import { randomUUID } from "node:crypto";
import type { Q } from "../db/db.js";
import { isoDay } from "../../shared/clinical.js";

export const uuid = () => randomUUID();

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Actor = { id: string; name: string; role: "clinician" | "reviewer" | "admin"; siteId: string };

export async function audit(tx: Q, actor: Actor, action: string, entity: string, entityId: string, patientId: string | null, detail: unknown = {}) {
  await tx.query("INSERT INTO cf.audit(id,actor,action,entity,entity_id,patient_id,detail) VALUES($1,$2,$3,$4,$5,$6,$7)", [
    uuid(), actor.id, action, entity, entityId, patientId, JSON.stringify(detail),
  ]);
}

export type EventInput = {
  patientId: string;
  occurredAt: string;
  kind: string;
  category: "visit" | "investigation" | "medication" | "procedure" | "complication" | "plan";
  title: string;
  detail?: string;
  refType?: string;
  refId?: string;
  contextId?: string | null;
};

export async function journeyEvent(tx: Q, actor: Actor, e: EventInput) {
  await tx.query(
    `INSERT INTO cf.clinical_event(id,patient_id,occurred_at,kind,category,title,detail,ref_type,ref_id,context_id,recorded_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [uuid(), e.patientId, e.occurredAt, e.kind, e.category, e.title, e.detail ?? "", e.refType ?? null, e.refId ?? null, e.contextId ?? null, actor.id],
  );
}

export async function patientInSite(tx: Q, actor: Actor, patientId: string) {
  const row = (await tx.query("SELECT * FROM cf.patient WHERE id=$1 AND site_id=$2", [patientId, actor.siteId])).rows[0];
  if (!row) throw new ApiError(404, "Patient not found");
  return row as PatientRow;
}

export type PatientRow = {
  id: string;
  site_id: string;
  mrn: string;
  name: string;
  sex: "Male" | "Female";
  birth_date: string;
  allergies: string;
  created_at: string;
};

// "Now" can be pinned for demos/tests so synthetic journeys stay coherent.
export function nowIso() {
  const pinned = process.env.CARDIO_TODAY;
  if (!pinned) return new Date().toISOString();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuwait", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date());
  return new Date(`${pinned}T${time}+03:00`).toISOString();
}
export function today() {
  return process.env.CARDIO_TODAY || isoDay();
}
