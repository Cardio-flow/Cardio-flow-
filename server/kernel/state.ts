// Builds one patient-state snapshot. Rules, the Summary, "what changed" and the
// wizards all read this, so every screen agrees on what is current.
import type { Q } from "../db/db.js";
import { DIAGNOSIS, MEDICATION } from "../../shared/catalog.js";
import { ageOn, resolveCurrent, type ObservationLike, type Resolved } from "../../shared/clinical.js";
import { today as todayFn } from "./base.js";

export type Obs = ObservationLike & { logical_id: string; version: number; study_id: string | null; context_id: string | null; method: string | null; recorded_at: string };
export type MedEvent = {
  id: string;
  kind: string;
  dose_value: number | null;
  dose_unit: string | null;
  frequency: string | null;
  route: string | null;
  reason: string;
  effective_at: string;
};
export type MedState = {
  id: string;
  code: string;
  name: string;
  drugClass: string;
  purpose: string;
  tags: string[];
  indication: string;
  status: "active" | "held" | "stopped" | "planned";
  doseValue: number | null;
  doseUnit: string | null;
  frequency: string | null;
  route: string | null;
  startedAt: string | null;
  lastChange: MedEvent | null;
  events: MedEvent[];
};
export type PlanRow = {
  id: string;
  category: string;
  title: string;
  reason: string;
  due_date: string | null;
  completes_on: { type: string; codes?: string[]; kind?: string };
  status: string;
  outcome: string;
  completed_at: string | null;
  source_context_id: string | null;
  medication_id: string | null;
  created_at: string;
  version: number;
};
export type ContextRow = {
  id: string;
  kind: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  location: string | null;
  service: string | null;
  reasons: string[];
  previous_context_id: string | null;
  summary: Record<string, unknown>;
};
export type ConditionRow = { id: string; logical_id: string; code: string; display: string; status: string; onset: string | null; detail: string; recorded_at: string };
export type StudyRow = { id: string; kind: string; performed_at: string; quality: string; findings: string[]; conclusion: string };

export type PatientState = {
  patient: { id: string; name: string; mrn: string; sex: "Male" | "Female"; birth_date: string; age: number; allergies: string };
  today: string;
  conditions: ConditionRow[];
  tags: Set<string>;
  observations: Obs[];
  resolved: (code: string) => Resolved<Obs>;
  meds: MedState[];
  plan: PlanRow[];
  contexts: ContextRow[];
  studies: StudyRow[];
  preferences: Record<string, string>;
};

export async function loadState(tx: Q, patientId: string): Promise<PatientState> {
  const p = (await tx.query("SELECT * FROM cf.patient WHERE id=$1", [patientId])).rows[0];
  const today = todayFn();
  const [conds, obs, meds, events, plan, contexts, studies, prefs] = await Promise.all([
    tx.query<ConditionRow>(
      `SELECT DISTINCT ON (logical_id) * FROM cf.condition WHERE patient_id=$1 ORDER BY logical_id, version DESC`,
      [patientId],
    ),
    tx.query<Obs>(
      `SELECT DISTINCT ON (logical_id) id,logical_id,version,code,value_num,value_text,unit,effective_at,status,quality,source,study_id,context_id,method,recorded_at
       FROM cf.observation WHERE patient_id=$1 ORDER BY logical_id, version DESC`,
      [patientId],
    ),
    tx.query(`SELECT * FROM cf.medication WHERE patient_id=$1 ORDER BY created_at`, [patientId]),
    tx.query(
      `SELECT id,medication_id,kind,dose_value,dose_unit,frequency,route,reason,effective_at FROM cf.medication_event WHERE patient_id=$1 ORDER BY effective_at, recorded_at`,
      [patientId],
    ),
    tx.query<PlanRow>(
      `SELECT id,category,title,reason,due_date,completes_on,status,outcome,completed_at,source_context_id,medication_id,created_at,version
       FROM cf.plan_action WHERE patient_id=$1 ORDER BY due_date NULLS LAST, created_at`,
      [patientId],
    ),
    tx.query<ContextRow>(
      `SELECT id,kind,status,started_at,ended_at,location,service,reasons,previous_context_id,summary FROM cf.care_context WHERE patient_id=$1 ORDER BY started_at`,
      [patientId],
    ),
    tx.query<StudyRow>(`SELECT id,kind,performed_at,quality,findings,conclusion FROM cf.study WHERE patient_id=$1 ORDER BY performed_at`, [patientId]),
    tx.query<{ code: string; observation_id: string }>(`SELECT code, observation_id FROM cf.value_preference WHERE patient_id=$1 AND active`, [patientId]),
  ]);
  const conditions = conds.rows.filter((c) => c.status === "active");
  const tags = new Set<string>(conditions.flatMap((c) => DIAGNOSIS[c.code]?.tags ?? []));
  const preferences = Object.fromEntries(prefs.rows.map((r) => [r.code, r.observation_id]));
  const cache = new Map<string, Resolved<Obs>>();
  const resolved = (code: string) => {
    if (!cache.has(code))
      cache.set(code, resolveCurrent(obs.rows.filter((o) => o.code === code).map(normaliseTime), preferences[code] ?? null));
    return cache.get(code)!;
  };
  const medStates: MedState[] = meds.rows.map((m: any) => {
    const evs = events.rows.filter((e: any) => e.medication_id === m.id).map(normaliseTime) as MedEvent[];
    const def = MEDICATION[m.drug];
    let status: MedState["status"] = "planned";
    let dose: MedEvent | null = null;
    let startedAt: string | null = null;
    for (const e of evs) {
      switch (e.kind) {
        case "start":
        case "restart":
          status = "active";
          startedAt ??= e.effective_at;
          if (e.dose_value != null) dose = e;
          break;
        case "increase":
        case "decrease":
          status = "active";
          dose = e;
          break;
        case "hold":
          status = "held";
          break;
        case "stop":
          status = "stopped";
          break;
      }
    }
    const lastChange = [...evs].reverse().find((e) => e.kind !== "continue") ?? null;
    return {
      id: m.id,
      code: m.drug,
      name: def?.name ?? m.drug,
      drugClass: def?.drugClass ?? "",
      purpose: def?.purpose ?? "Other",
      tags: def?.tags ?? [],
      indication: m.indication,
      status,
      doseValue: dose?.dose_value ?? null,
      doseUnit: dose?.dose_unit ?? def?.unit ?? null,
      frequency: dose?.frequency ?? null,
      route: dose?.route ?? null,
      startedAt,
      lastChange,
      events: evs,
    };
  });
  return {
    patient: { id: p.id, name: p.name, mrn: p.mrn, sex: p.sex, birth_date: p.birth_date, age: ageOn(p.birth_date, today), allergies: p.allergies },
    today,
    conditions,
    tags,
    observations: obs.rows.map(normaliseTime),
    resolved,
    meds: medStates,
    plan: plan.rows.map((r) => ({ ...r, due_date: r.due_date?.slice(0, 10) ?? null })),
    contexts: contexts.rows.map(normaliseTime),
    studies: studies.rows.map(normaliseTime),
    preferences,
  };
}

// PGlite and node-postgres return timestamps slightly differently; make them ISO.
function normaliseTime<T extends Record<string, any>>(row: T): T {
  const out: any = { ...row };
  for (const k of ["effective_at", "started_at", "ended_at", "performed_at", "recorded_at", "completed_at", "created_at"])
    if (out[k] != null) out[k] = new Date(out[k]).toISOString();
  return out;
}

export const activeMeds = (s: PatientState) => s.meds.filter((m) => m.status === "active" || m.status === "held");
export const medsWithTag = (s: PatientState, tag: string) => s.meds.filter((m) => m.status === "active" && m.tags.includes(tag));
export const series = (s: PatientState, code: string) => s.resolved(code).history;
export const latestDischarge = (s: PatientState) =>
  [...s.contexts].reverse().find((c) => c.kind === "admission" && c.status === "closed") ?? null;
export const openContext = (s: PatientState) => [...s.contexts].reverse().find((c) => c.status === "open") ?? null;
