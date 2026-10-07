// Builds one patient-state snapshot. Rules, the Summary, "what changed" and the
// wizards all read this, so every screen agrees on what is current.
import type { Q } from "../db/db.js";
import { DIAGNOSIS, MEDICATION } from "../../shared/catalog.js";
import { ageOn, resolveCurrent, type ObservationLike, type Resolved } from "../../shared/clinical.js";
import { today as todayFn } from "./base.js";
import { isMechanicalValve, isModerateSevereMS } from "../../shared/history.js";

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
  decision_id?: string | null;
};
export type MedState = {
  id: string;
  code: string;
  name: string;
  drugClass: string;
  purpose: string;
  tags: string[];
  indication: string;
  // not_taking: prescribed, but the patient reports not taking it (an exception, not a decision)
  status: "active" | "held" | "stopped" | "planned" | "not_taking";
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
  decision_id: string | null;
  created_at: string;
  version: number;
};
// A complication followed as one thread (migration 004): opened by a pathway, reviewed, resolved.
export type EpisodeRow = {
  id: string; wizard: string; status: "open" | "resolved"; started_at: string; resolved_at: string | null; outcome: string; note: string;
  context_id: string | null; decisions: { id: string; decided_at: string }[];
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
export type ConditionRow = { id: string; logical_id: string; code: string; display: string; status: string; onset: string | null; detail: string; recorded_at: string; attributes: Record<string, any> };
export type ProcedureRow = { id: string; kind: string; performed_at: string; attributes: Record<string, any>; summary: string; context_id: string | null };
export type StudyRow = { id: string; kind: string; performed_at: string; quality: string; findings: string[]; conclusion: string; attributes: Record<string, any> };

export type BarrierRow = { id: string; drug_class: string; category: string; detail: string; drug: string | null; cleared: boolean; recommendation_id: string | null; effective_at: string; recorded_by: string };

export type PatientState = {
  patient: { id: string; name: string; mrn: string; sex: "Male" | "Female"; birth_date: string; age: number; allergies: string; civil_id: string | null; nationality: string | null; mobile: string | null; synthetic: boolean };
  today: string;
  conditions: ConditionRow[];
  tags: Set<string>;
  observations: Obs[];
  resolved: (code: string) => Resolved<Obs>;
  meds: MedState[];
  plan: PlanRow[];
  contexts: ContextRow[];
  studies: StudyRow[];
  // PCI, CABG… (migration 005), oldest first; corrected or entered-in-error rows left out
  procedures: ProcedureRow[];
  preferences: Record<string, string>;
  // newest vital and follow-up status (null = never recorded: alive, active by default)
  status: { vital: StatusRow | null; followUp: StatusRow | null };
  deceased: boolean;
  // why a drug class is not given (newest per class, cleared ones removed)
  barriers: BarrierRow[];
  episodes: EpisodeRow[];
  // the latest completed run of each pathway (wizard id → ISO time), for rules that ask "done since the event?"
  pathwaysDone: Record<string, string>;
};
export type StatusRow = { id: string; kind: string; status: string; effective_on: string; place: string | null; cause_group: string | null; detail: string };

export async function loadState(tx: Q, patientId: string): Promise<PatientState> {
  const today = todayFn();
  // One round trip per patient: every table is aggregated to JSON in a single statement.
  // (The database may be far from the server; latency, not query cost, dominates.)
  const bundle = (
    await tx.query<any>(
      `SELECT
        (SELECT row_to_json(pt) FROM (SELECT id,name,mrn,sex,birth_date,allergies,civil_id,nationality,mobile,synthetic FROM cf.patient WHERE id=$1) pt) AS patient,
        (SELECT coalesce(json_agg(c ORDER BY c.logical_id), '[]') FROM (SELECT DISTINCT ON (logical_id) * FROM cf.condition WHERE patient_id=$1 ORDER BY logical_id, version DESC) c) AS conds,
        (SELECT coalesce(json_agg(o), '[]') FROM (SELECT DISTINCT ON (logical_id) id,logical_id,version,code,value_num,value_text,unit,effective_at,status,quality,source,study_id,context_id,method,recorded_at
            FROM cf.observation WHERE patient_id=$1 ORDER BY logical_id, version DESC) o) AS obs,
        (SELECT coalesce(json_agg(m ORDER BY m.created_at), '[]') FROM cf.medication m WHERE patient_id=$1) AS meds,
        (SELECT coalesce(json_agg(e ORDER BY e.effective_at, e.recorded_at), '[]') FROM (SELECT id,medication_id,kind,dose_value,dose_unit,frequency,route,reason,effective_at,recorded_at,decision_id FROM cf.medication_event WHERE patient_id=$1) e) AS events,
        (SELECT coalesce(json_agg(pa ORDER BY pa.due_date NULLS LAST, pa.created_at), '[]') FROM (SELECT id,category,title,reason,due_date,completes_on,status,outcome,completed_at,source_context_id,medication_id,decision_id,created_at,version FROM cf.plan_action WHERE patient_id=$1) pa) AS plan,
        (SELECT coalesce(json_agg(cc ORDER BY cc.started_at), '[]') FROM (SELECT id,kind,status,started_at,ended_at,location,service,reasons,previous_context_id,summary FROM cf.care_context WHERE patient_id=$1) cc) AS contexts,
        (SELECT coalesce(json_agg(st ORDER BY st.performed_at), '[]') FROM (SELECT id,kind,performed_at,quality,findings,conclusion,attributes FROM cf.study WHERE patient_id=$1) st) AS studies,
        (SELECT coalesce(json_agg(vp), '[]') FROM (SELECT code, observation_id FROM cf.value_preference WHERE patient_id=$1 AND active) vp) AS prefs,
        (SELECT coalesce(json_agg(se), '[]') FROM (SELECT DISTINCT ON (kind) id,kind,status,effective_on,place,cause_group,detail FROM cf.status_event WHERE patient_id=$1 ORDER BY kind, effective_on DESC, recorded_at DESC) se) AS status,
        (SELECT coalesce(json_agg(tb), '[]') FROM (SELECT DISTINCT ON (drug_class) id,drug_class,category,detail,drug,cleared,recommendation_id,effective_at,recorded_by FROM cf.treatment_barrier WHERE patient_id=$1 ORDER BY drug_class, effective_at DESC, recorded_at DESC) tb) AS barriers,
        (SELECT coalesce(json_agg(ep ORDER BY ep.started_at), '[]') FROM (SELECT e.id,e.wizard,e.status,e.started_at,e.resolved_at,e.outcome,e.note,e.context_id,
            (SELECT coalesce(json_agg(json_build_object('id', d.id, 'decided_at', d.decided_at) ORDER BY d.decided_at), '[]') FROM cf.decision d WHERE d.episode_id = e.id) AS decisions
            FROM cf.episode e WHERE e.patient_id=$1) ep) AS episodes,
        (SELECT coalesce(json_agg(pr ORDER BY pr.performed_at), '[]') FROM (SELECT p.id,p.kind,p.performed_at,p.attributes,p.summary,p.context_id FROM cf.procedure p
            WHERE p.patient_id=$1 AND p.status='final' AND NOT EXISTS (SELECT 1 FROM cf.procedure r WHERE r.replaces=p.id)) pr) AS procedures,
        (SELECT coalesce(json_object_agg(w.wizard, w.at), '{}') FROM (SELECT wizard, max(decided_at) AS at FROM cf.decision WHERE patient_id=$1 AND outcome='acted' AND wizard IS NOT NULL GROUP BY wizard) w) AS pathways`,
      [patientId],
    )
  ).rows[0];
  const p = typeof bundle.patient === "string" ? JSON.parse(bundle.patient) : bundle.patient;
  const j = (v: any) => ({ rows: (typeof v === "string" ? JSON.parse(v) : v) as any[] });
  const conds = j(bundle.conds) as { rows: ConditionRow[] };
  const obs = j(bundle.obs) as { rows: Obs[] };
  const meds = j(bundle.meds);
  const events = j(bundle.events);
  const plan = j(bundle.plan) as { rows: PlanRow[] };
  const contexts = j(bundle.contexts) as { rows: ContextRow[] };
  const studies = j(bundle.studies) as { rows: StudyRow[] };
  const prefs = j(bundle.prefs) as { rows: { code: string; observation_id: string }[] };
  const barrierRows = (j(bundle.barriers).rows as BarrierRow[]).filter((b) => !b.cleared).map((b) => ({ ...b, effective_at: new Date(b.effective_at).toISOString() }));
  const statusRows = (j(bundle.status).rows as StatusRow[]).map((r) => ({ ...r, effective_on: String(r.effective_on).slice(0, 10) }));
  const vital = statusRows.find((r) => r.kind === "vital") ?? null;
  const conditions = conds.rows.filter((c) => c.status === "active").map((c) => ({ ...c, attributes: (typeof c.attributes === "string" ? JSON.parse(c.attributes) : c.attributes) ?? {} }));
  const tags = new Set<string>([...conditions.flatMap((c) => DIAGNOSIS[c.code]?.tags ?? []), ...conditions.flatMap(detailTags)]);
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
    // a frequency change (Ahmed, 2 Oct 2026) is a "continue" event that carries the new frequency
    let freq: string | null = null;
    for (const e of evs) {
      if (e.frequency && e.kind !== "planned") freq = e.frequency;
      switch (e.kind) {
        case "start":
        case "restart":
          // the current course starts again after a stop (a hold → resume keeps it)
          if (startedAt == null || status === "stopped") startedAt = e.effective_at;
          status = "active";
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
        case "not_taking":
          status = "not_taking";
          break;
        case "resume":
          status = "active";
          break;
        case "stop":
          status = "stopped";
          break;
      }
    }
    const lastChange = [...evs].reverse().find((e) => e.kind !== "continue" || /^Frequency changed/.test(e.reason)) ?? null;
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
      frequency: freq ?? dose?.frequency ?? null,
      route: dose?.route ?? null,
      startedAt,
      lastChange,
      events: evs,
    };
  });
  return {
    patient: {
      id: p.id, name: p.name, mrn: p.mrn, sex: p.sex, birth_date: p.birth_date, age: ageOn(p.birth_date, today), allergies: p.allergies,
      civil_id: p.civil_id ?? null, nationality: p.nationality ?? null, mobile: p.mobile ?? null, synthetic: p.synthetic === true,
    },
    today,
    conditions,
    tags,
    observations: obs.rows.map(normaliseTime),
    resolved,
    meds: medStates,
    plan: plan.rows.map((r) => ({ ...normaliseTime(r), due_date: r.due_date ? String(r.due_date).slice(0, 10) : null })),
    contexts: contexts.rows.map(normaliseTime),
    studies: studies.rows.map((st) => ({ ...normaliseTime(st), attributes: (typeof st.attributes === "string" ? JSON.parse(st.attributes) : st.attributes) ?? {} })),
    preferences,
    status: { vital, followUp: statusRows.find((r) => r.kind === "follow_up") ?? null },
    deceased: vital?.status === "died",
    barriers: barrierRows,
    procedures: (j(bundle.procedures).rows as any[]).map((p) => ({ ...p, performed_at: new Date(p.performed_at).toISOString(), attributes: (typeof p.attributes === "string" ? JSON.parse(p.attributes) : p.attributes) ?? {} })),
    episodes: (j(bundle.episodes).rows as any[]).map((e) => ({
      ...e,
      started_at: new Date(e.started_at).toISOString(),
      resolved_at: e.resolved_at ? new Date(e.resolved_at).toISOString() : null,
      decisions: (typeof e.decisions === "string" ? JSON.parse(e.decisions) : e.decisions ?? []).map((d: any) => ({ id: d.id, decided_at: new Date(d.decided_at).toISOString() })),
    })),
    pathwaysDone: Object.fromEntries(Object.entries((typeof bundle.pathways === "string" ? JSON.parse(bundle.pathways) : bundle.pathways) ?? {}).map(([k, v]) => [k, new Date(v as string).toISOString()])),
  };
}

// Tags that come from a diagnosis' structured detail, not its code (read by rules).
function detailTags(c: ConditionRow): string[] {
  const out: string[] = [];
  if (isMechanicalValve(c)) out.push("mechanical-valve");
  if (isModerateSevereMS(c)) out.push("ms-significant");
  if (c.attributes?.severeHypo === "Yes") out.push("severe-hypo");
  if (c.code === "cied") {
    const t = c.attributes?.type;
    if (t === "ICD" || t === "CRT-D") out.push("icd");
    if (t === "CRT-P" || t === "CRT-D") out.push("crt");
    if (t === "Pacemaker") out.push("pacemaker");
  }
  return out;
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

// Newest study of a kind (optionally within N days), e.g. the ECG the device rule reads.
export const latestStudy = (s: PatientState, kind: string, withinDays?: number) => {
  const st = [...s.studies].filter((x) => x.kind === kind).sort((a, b) => (a.performed_at < b.performed_at ? 1 : -1))[0] ?? null;
  if (!st || withinDays == null) return st;
  return (Date.parse(s.today) - Date.parse(st.performed_at)) / 86400000 <= withinDays ? st : null;
};

// A recorded reason that currently stops suggestions for this class. Intolerance and
// contraindication last until cleared; the others last until the next visit or admission.
export function activeBarrier(s: PatientState, cls: string) {
  const b = s.barriers.find((x) => x.drug_class === cls);
  if (!b) return null;
  if (b.category === "intolerance" || b.category === "contraindication") return b;
  const reviewedSince = s.contexts.some((c) => (c.kind === "clinic_visit" || c.kind === "admission") && c.started_at > b.effective_at);
  return reviewedSince ? null : b;
}
