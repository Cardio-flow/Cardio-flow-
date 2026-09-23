// Write operations on the kernel. Each returns the list of "inputs" it changed so the
// engine only re-runs rules that read them.
import type { Q } from "../db/db.js";
import { DIAGNOSIS, MEASURES, MEDICATION, doseLabel, formatNumber } from "../../shared/catalog.js";
import { addDays, ageOn, egfrCkdEpi2021, fmtDay, isoDay } from "../../shared/clinical.js";
import { ApiError, audit, journeyEvent, nowIso, patientInSite, uuid, type Actor } from "./base.js";

export type Changed = string[];

// ---------- patients & conditions ----------
export async function createPatient(
  tx: Q,
  actor: Actor,
  input: { name: string; mrn: string; sex: "Male" | "Female"; birthDate: string; allergies?: string; conditions?: string[] },
) {
  const exists = (await tx.query("SELECT 1 FROM cf.patient WHERE site_id=$1 AND mrn=$2", [actor.siteId, input.mrn])).rows[0];
  if (exists) throw new ApiError(409, "A patient with this MRN already exists");
  const id = uuid();
  await tx.query(
    "INSERT INTO cf.patient(id,site_id,mrn,name,sex,birth_date,allergies,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, actor.siteId, input.mrn, input.name, input.sex, input.birthDate, input.allergies || "Not recorded", actor.id],
  );
  for (const code of input.conditions ?? []) await addCondition(tx, actor, id, { code });
  await audit(tx, actor, "create", "patient", id, id);
  return id;
}

export async function addCondition(tx: Q, actor: Actor, patientId: string, input: { code: string; onset?: string | null; detail?: string; contextId?: string | null }) {
  const def = DIAGNOSIS[input.code];
  if (!def) throw new ApiError(400, "Unknown diagnosis");
  const dup = (
    await tx.query(
      `SELECT 1 FROM (SELECT DISTINCT ON (logical_id) code,status FROM cf.condition WHERE patient_id=$1 ORDER BY logical_id, version DESC) c WHERE code=$2 AND status='active'`,
      [patientId, input.code],
    )
  ).rows[0];
  if (dup) return { id: null, changed: [] as Changed };
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.condition(id,logical_id,version,patient_id,code,display,status,onset,detail,context_id,recorded_by) VALUES($1,$1,1,$2,$3,$4,'active',$5,$6,$7,$8)`,
    [id, patientId, input.code, def.display, input.onset ?? null, input.detail ?? "", input.contextId ?? null, actor.id],
  );
  return { id, changed: ["conditions"] as Changed };
}

export async function setConditionStatus(tx: Q, actor: Actor, patientId: string, logicalId: string, status: "resolved" | "entered_in_error" | "active") {
  const cur = (await tx.query(`SELECT * FROM cf.condition WHERE logical_id=$1 AND patient_id=$2 ORDER BY version DESC LIMIT 1`, [logicalId, patientId])).rows[0];
  if (!cur) throw new ApiError(404, "Diagnosis not found");
  await tx.query(
    `INSERT INTO cf.condition(id,logical_id,version,patient_id,code,display,status,onset,detail,context_id,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [uuid(), logicalId, cur.version + 1, patientId, cur.code, cur.display, status, cur.onset, cur.detail, cur.context_id, actor.id],
  );
  if (status === "resolved")
    await journeyEvent(tx, actor, { patientId, occurredAt: nowIso(), kind: "condition-resolved", category: "complication", title: `Resolved · ${cur.display}` });
  return ["conditions"] as Changed;
}

// ---------- observations ----------
export type ObsInput = { code: string; value?: number | null; unit?: string | null; text?: string | null };

export async function recordObservations(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: {
    effectiveAt: string;
    items: ObsInput[];
    contextId?: string | null;
    quality?: "standard" | "formal" | "limited" | "bedside";
    studyId?: string | null;
    source?: string;
    silentEvent?: boolean;
    status?: "final" | "preliminary";
  },
) {
  const patient = await patientInSite(tx, actor, patientId);
  const ids: string[] = [];
  const saved: { code: string; value: number | null; text: string | null; id: string }[] = [];
  for (const item of input.items) {
    const def = MEASURES[item.code];
    const isText = item.text != null && item.value == null;
    if (!def && !isText) throw new ApiError(400, `Unknown measurement: ${item.code}`);
    if (def?.derived) throw new ApiError(400, `${def.display} is calculated automatically`);
    let value = item.value ?? null;
    let unit = def?.unit ?? null;
    if (value != null && def && item.unit && item.unit !== def.unit) {
      const factor = def.convert?.[item.unit];
      if (!factor) throw new ApiError(400, `${def.display} cannot be entered in ${item.unit}`);
      value = value * factor;
    }
    if (value != null && !(Number.isFinite(value) && value >= 0 && value < 1e6)) throw new ApiError(400, `${def?.display ?? item.code}: value out of range`);
    const id = uuid();
    await tx.query(
      `INSERT INTO cf.observation(id,logical_id,version,patient_id,code,value_num,value_text,unit,original_value,original_unit,effective_at,status,quality,source,study_id,context_id,recorded_by)
       VALUES($1,$1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id, patientId, item.code, value, item.text ?? null, unit, item.value ?? null, item.unit ?? def?.unit ?? null, input.effectiveAt,
        input.status ?? "final", input.quality ?? "standard", input.source ?? "clinician entry", input.studyId ?? null, input.contextId ?? null, actor.id,
      ],
    );
    ids.push(id);
    saved.push({ code: item.code, value, text: item.text ?? null, id });
    if (item.code === "creatinine" && value != null) {
      const egfr = egfrCkdEpi2021(value, ageOn(patient.birth_date, input.effectiveAt), patient.sex);
      if (egfr != null) {
        const eid = uuid();
        await tx.query(
          `INSERT INTO cf.observation(id,logical_id,version,patient_id,code,value_num,unit,effective_at,status,quality,source,method,derived_from,context_id,recorded_by)
           VALUES($1,$1,1,$2,'egfr',$3,'mL/min/1.73m²',$4,$5,'standard','calculated','CKD-EPI 2021 creatinine (race-free)',$6,$7,$8)`,
          [eid, patientId, egfr, input.effectiveAt, input.status ?? "final", [id], input.contextId ?? null, actor.id],
        );
        saved.push({ code: "egfr", value: egfr, text: null, id: eid });
      }
    }
  }
  const labs = saved.filter((s) => MEASURES[s.code] && MEASURES[s.code].category !== "Vitals" && MEASURES[s.code].category !== "Echo");
  if (labs.length && !input.silentEvent) {
    const title =
      "Labs · " +
      labs
        .filter((l) => l.code !== "egfr")
        .slice(0, 4)
        .map((l) => `${MEASURES[l.code].short} ${formatNumber(l.value!, MEASURES[l.code].decimals)}`)
        .join(" · ");
    await journeyEvent(tx, actor, { patientId, occurredAt: input.effectiveAt, kind: "labs", category: "investigation", title, refType: "observation", refId: labs[0].id, contextId: input.contextId });
  }
  const completed = await completeMatching(tx, actor, patientId, { type: "lab", codes: saved.map((s) => s.code), at: input.effectiveAt, ref: ids[0] });
  await audit(tx, actor, "record", "observation", ids.join(","), patientId, { codes: saved.map((s) => s.code) });
  const changed = [...new Set(saved.map((s) => s.code))];
  if (completed.length) changed.push("plan");
  return { ids, saved, completed, changed };
}

export async function correctObservation(tx: Q, actor: Actor, patientId: string, observationId: string, input: { value?: number; enteredInError?: boolean }) {
  const cur = (await tx.query(`SELECT * FROM cf.observation WHERE id=$1 AND patient_id=$2`, [observationId, patientId])).rows[0];
  if (!cur) throw new ApiError(404, "Result not found");
  const latest = (await tx.query(`SELECT max(version) v FROM cf.observation WHERE logical_id=$1`, [cur.logical_id])).rows[0].v;
  await tx.query(
    `INSERT INTO cf.observation(id,logical_id,version,patient_id,code,value_num,value_text,unit,original_value,original_unit,effective_at,status,quality,source,method,derived_from,study_id,context_id,recorded_by)
     SELECT $1,logical_id,$2,patient_id,code,$3,value_text,unit,original_value,original_unit,effective_at,$4,quality,source,method,derived_from,study_id,context_id,$5 FROM cf.observation WHERE id=$6`,
    [uuid(), Number(latest) + 1, input.value ?? cur.value_num, input.enteredInError ? "entered_in_error" : cur.status, actor.id, observationId],
  );
  await audit(tx, actor, input.enteredInError ? "entered-in-error" : "correct", "observation", observationId, patientId);
  return [cur.code] as Changed;
}

export async function preferValue(tx: Q, actor: Actor, patientId: string, code: string, observationId: string | null, reason: string) {
  await tx.query(`UPDATE cf.value_preference SET active=false WHERE patient_id=$1 AND code=$2 AND active`, [patientId, code]);
  if (observationId)
    await tx.query(`INSERT INTO cf.value_preference(id,patient_id,code,observation_id,reason,chosen_by) VALUES($1,$2,$3,$4,$5,$6)`, [
      uuid(), patientId, code, observationId, reason, actor.id,
    ]);
  await audit(tx, actor, "prefer-value", "observation", observationId ?? "cleared", patientId, { code, reason });
  return [code] as Changed;
}

// ---------- studies ----------
export async function recordEcho(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: { date: string; quality: "formal" | "limited" | "bedside"; lvef: number; findings: string[]; conclusion?: string; contextId?: string | null },
) {
  await patientInSite(tx, actor, patientId);
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.study(id,patient_id,kind,performed_at,quality,findings,conclusion,context_id,recorded_by) VALUES($1,$2,'echo',$3,$4,$5,$6,$7,$8)`,
    [id, patientId, input.date, input.quality, input.findings, input.conclusion ?? "", input.contextId ?? null, actor.id],
  );
  await recordObservations(tx, actor, patientId, {
    effectiveAt: input.date,
    items: [{ code: "lvef", value: input.lvef }],
    quality: input.quality,
    studyId: id,
    contextId: input.contextId,
    source: `Echo (${input.quality})`,
    silentEvent: true,
  });
  await journeyEvent(tx, actor, {
    patientId,
    occurredAt: input.date,
    kind: "echo",
    category: "investigation",
    title: `Echo · LVEF ${Math.round(input.lvef)}%`,
    detail: [input.quality === "formal" ? "Formal TTE" : input.quality === "limited" ? "Limited study" : "Bedside study", ...input.findings].join(" · "),
    refType: "study",
    refId: id,
    contextId: input.contextId,
  });
  const completed = await completeMatching(tx, actor, patientId, { type: "study", kind: "echo", at: input.date, ref: id });
  return { id, changed: ["lvef", ...(completed.length ? ["plan"] : [])] as Changed, completed };
}

// ---------- medications ----------
export async function startMedication(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: {
    code: string;
    doseValue: number | null;
    frequency: string;
    route: string;
    indication: string;
    reason?: string;
    effectiveAt: string;
    contextId?: string | null;
    decisionId?: string | null;
    planned?: boolean;
  },
) {
  const def = MEDICATION[input.code];
  if (!def) throw new ApiError(400, "Unknown medication");
  const existing = (
    await tx.query(`SELECT id FROM cf.medication WHERE patient_id=$1 AND drug=$2 ORDER BY created_at DESC LIMIT 1`, [patientId, input.code])
  ).rows[0];
  let medicationId = existing?.id as string | undefined;
  if (medicationId) {
    const last = (await tx.query(`SELECT kind FROM cf.medication_event WHERE medication_id=$1 ORDER BY effective_at DESC, recorded_at DESC LIMIT 1`, [medicationId])).rows[0];
    if (last && last.kind !== "stop") throw new ApiError(409, `${def.name} is already on the medication list. Change its dose instead.`);
  } else {
    medicationId = uuid();
    await tx.query(`INSERT INTO cf.medication(id,patient_id,drug,indication) VALUES($1,$2,$3,$4)`, [medicationId, patientId, input.code, input.indication]);
  }
  const eventId = uuid();
  const kind = input.planned ? "planned" : existing ? "restart" : "start";
  await tx.query(
    `INSERT INTO cf.medication_event(id,medication_id,patient_id,kind,dose_value,dose_unit,frequency,route,reason,effective_at,context_id,decision_id,recorded_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [eventId, medicationId, patientId, kind, input.doseValue, def.unit, input.frequency, input.route, input.reason ?? "", input.effectiveAt, input.contextId ?? null, input.decisionId ?? null, actor.id],
  );
  await journeyEvent(tx, actor, {
    patientId,
    occurredAt: input.effectiveAt,
    kind: "medication-start",
    category: "medication",
    title: `${def.name} ${kind === "restart" ? "restarted" : "started"}`,
    detail: `${doseLabel(def, input.doseValue)} ${input.frequency} ${input.route}`.trim() + (input.reason ? ` · ${input.reason}` : ""),
    refType: "medication",
    refId: medicationId,
    contextId: input.contextId,
  });
  await audit(tx, actor, "start", "medication", medicationId, patientId, { code: input.code, dose: input.doseValue });
  return { medicationId, changed: ["meds"] as Changed };
}

export async function medicationEvent(
  tx: Q,
  actor: Actor,
  patientId: string,
  medicationId: string,
  input: { kind: "increase" | "decrease" | "hold" | "restart" | "stop" | "continue"; doseValue?: number | null; frequency?: string | null; reason?: string; effectiveAt: string; contextId?: string | null; decisionId?: string | null },
) {
  const med = (await tx.query(`SELECT * FROM cf.medication WHERE id=$1 AND patient_id=$2`, [medicationId, patientId])).rows[0];
  if (!med) throw new ApiError(404, "Medication not found");
  const def = MEDICATION[med.drug];
  const last = (
    await tx.query(`SELECT * FROM cf.medication_event WHERE medication_id=$1 AND kind IN ('start','restart','increase','decrease') ORDER BY effective_at DESC, recorded_at DESC LIMIT 1`, [medicationId])
  ).rows[0];
  const lastAny = (await tx.query(`SELECT kind FROM cf.medication_event WHERE medication_id=$1 ORDER BY effective_at DESC, recorded_at DESC LIMIT 1`, [medicationId])).rows[0];
  if (lastAny?.kind === "stop" && input.kind !== "restart") throw new ApiError(409, `${def?.name} has been stopped`);
  if ((input.kind === "increase" || input.kind === "decrease") && input.doseValue == null) throw new ApiError(400, "Choose the new dose");
  const dose = input.kind === "increase" || input.kind === "decrease" || input.kind === "restart" ? input.doseValue ?? last?.dose_value ?? null : null;
  await tx.query(
    `INSERT INTO cf.medication_event(id,medication_id,patient_id,kind,dose_value,dose_unit,frequency,route,reason,effective_at,context_id,decision_id,recorded_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      uuid(), medicationId, patientId, input.kind, dose, last?.dose_unit ?? def?.unit ?? null, input.frequency ?? last?.frequency ?? null, last?.route ?? null,
      input.reason ?? "", input.effectiveAt, input.contextId ?? null, input.decisionId ?? null, actor.id,
    ],
  );
  if (input.kind !== "continue") {
    const verb = { increase: "increased", decrease: "reduced", hold: "held", restart: "restarted", stop: "stopped" }[input.kind];
    await journeyEvent(tx, actor, {
      patientId,
      occurredAt: input.effectiveAt,
      kind: "medication-" + input.kind,
      category: "medication",
      title: `${def?.name ?? med.drug} ${verb}`,
      detail:
        (dose != null && last ? `${doseLabel(def, last.dose_value)} → ${doseLabel(def, dose)}` : dose != null ? doseLabel(def, dose) : "") +
        (input.reason ? ` · ${input.reason}` : ""),
      refType: "medication",
      refId: medicationId,
      contextId: input.contextId,
    });
  }
  await audit(tx, actor, input.kind, "medication", medicationId, patientId, { dose });
  return ["meds"] as Changed;
}

// ---------- plan ----------
export type PlanInput = {
  category: string;
  title: string;
  reason?: string;
  dueDate: string | null;
  completesOn?: Record<string, unknown>;
  contextId?: string | null;
  decisionId?: string | null;
  medicationId?: string | null;
  createdAt?: string;
};

export async function addPlanAction(tx: Q, actor: Actor, patientId: string, input: PlanInput) {
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.plan_action(id,patient_id,category,title,reason,due_date,completes_on,status,source_context_id,decision_id,medication_id,created_by,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'planned',$8,$9,$10,$11,$12)`,
    [id, patientId, input.category, input.title, input.reason ?? "", input.dueDate, JSON.stringify(input.completesOn ?? { type: "manual" }), input.contextId ?? null, input.decisionId ?? null, input.medicationId ?? null, actor.id, input.createdAt ?? nowIso()],
  );
  await audit(tx, actor, "plan", "plan_action", id, patientId, { title: input.title, due: input.dueDate });
  return { id, changed: ["plan"] as Changed };
}

export async function updatePlanAction(
  tx: Q,
  actor: Actor,
  patientId: string,
  planId: string,
  input: { action: "complete" | "defer" | "cancel" | "reschedule"; outcome?: string; dueDate?: string; version: number },
) {
  const cur = (await tx.query(`SELECT * FROM cf.plan_action WHERE id=$1 AND patient_id=$2`, [planId, patientId])).rows[0];
  if (!cur) throw new ApiError(404, "Plan action not found");
  if (cur.version !== input.version) throw new ApiError(409, "This plan item was changed by someone else. Reload and try again.");
  if (cur.status !== "planned") throw new ApiError(409, "This plan item is already closed");
  const at = nowIso();
  if (input.action === "complete") {
    await tx.query(`UPDATE cf.plan_action SET status='completed', outcome=$2, completed_at=$3, updated_at=now(), version=version+1 WHERE id=$1`, [planId, input.outcome ?? "", at]);
    await journeyEvent(tx, actor, { patientId, occurredAt: at, kind: "task-complete", category: "plan", title: `Completed · ${cur.title}`, detail: input.outcome ?? "", refType: "plan_action", refId: planId });
  } else if (input.action === "reschedule" || input.action === "defer") {
    if (!input.dueDate) throw new ApiError(400, "Choose the new date");
    await tx.query(`UPDATE cf.plan_action SET due_date=$2, outcome=$3, updated_at=now(), version=version+1 WHERE id=$1`, [planId, input.dueDate, input.outcome ?? cur.outcome]);
  } else {
    await tx.query(`UPDATE cf.plan_action SET status='cancelled', outcome=$2, updated_at=now(), version=version+1 WHERE id=$1`, [planId, input.outcome ?? ""]);
  }
  await audit(tx, actor, input.action, "plan_action", planId, patientId, input);
  return ["plan"] as Changed;
}

// A result, visit or study closes the plan actions waiting for it.
export async function completeMatching(
  tx: Q,
  actor: Actor,
  patientId: string,
  trigger: { type: "lab"; codes: string[]; at: string; ref: string } | { type: "visit"; at: string; ref: string } | { type: "study"; kind: string; at: string; ref: string },
) {
  const open = (
    await tx.query(`SELECT id,title,due_date,completes_on,created_at FROM cf.plan_action WHERE patient_id=$1 AND status='planned'`, [patientId])
  ).rows as { id: string; title: string; due_date: string | null; completes_on: any; created_at: string }[];
  const day = isoDay(new Date(trigger.at));
  const done: { id: string; title: string }[] = [];
  // one result closes the earliest waiting action of each kind (a visit closes all that are due)
  open.sort((x, y) => String(x.due_date ?? "9999").localeCompare(String(y.due_date ?? "9999")));
  const used = new Set<string>();
  for (const a of open) {
    const c = a.completes_on ?? {};
    if (c.type !== trigger.type) continue;
    if (new Date(trigger.at) < new Date(a.created_at) && trigger.type !== "visit") continue;
    const windowDays = trigger.type === "lab" ? 7 : trigger.type === "visit" ? 7 : 30;
    if (a.due_date && day < addDays(String(a.due_date).slice(0, 10), -windowDays)) continue;
    if (trigger.type === "lab" && !(c.codes ?? []).every((code: string) => trigger.codes.includes(code))) continue;
    if (trigger.type === "study" && c.kind !== trigger.kind) continue;
    const signature = JSON.stringify(c);
    if (trigger.type !== "visit" && used.has(signature)) continue;
    used.add(signature);
    await tx.query(`UPDATE cf.plan_action SET status='completed', completed_at=$2, completed_by_ref=$3, outcome=$4, updated_at=now(), version=version+1 WHERE id=$1`, [
      a.id, trigger.at, trigger.ref, "Completed automatically when the result was recorded",
    ]);
    await journeyEvent(tx, actor, { patientId, occurredAt: trigger.at, kind: "task-complete", category: "plan", title: `Completed · ${a.title}`, detail: "Closed by the new result", refType: "plan_action", refId: a.id });
    done.push({ id: a.id, title: a.title });
  }
  return done;
}

// ---------- care contexts ----------
export async function startAdmission(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: { startedAt: string; location: string; reasons: string[]; confirmations?: { kind: "condition" | "medication"; id: string; answer: "unchanged" | "changed" | "unknown" | "not-assessed" }[] },
) {
  await patientInSite(tx, actor, patientId);
  const open = (await tx.query(`SELECT 1 FROM cf.care_context WHERE patient_id=$1 AND kind='admission' AND status='open'`, [patientId])).rows[0];
  if (open) throw new ApiError(409, "This patient already has an open admission");
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.care_context(id,patient_id,kind,status,started_at,location,service,reasons,summary,created_by) VALUES($1,$2,'admission','open',$3,$4,'Cardiology',$5,$6,$7)`,
    [id, patientId, input.startedAt, input.location, input.reasons, JSON.stringify({ confirmations: input.confirmations ?? [] }), actor.id],
  );
  await journeyEvent(tx, actor, {
    patientId, occurredAt: input.startedAt, kind: "admission", category: "visit",
    title: `Admitted · ${input.reasons.join(", ") || "cardiology"}`, detail: input.location, refType: "care_context", refId: id, contextId: id,
  });
  await audit(tx, actor, "admit", "care_context", id, patientId);
  return { id, changed: ["contexts"] as Changed };
}

export async function discharge(
  tx: Q,
  actor: Actor,
  patientId: string,
  contextId: string,
  input: { endedAt: string; status: string; plan: PlanInput[]; note?: string },
) {
  const ctx = (await tx.query(`SELECT * FROM cf.care_context WHERE id=$1 AND patient_id=$2`, [contextId, patientId])).rows[0];
  if (!ctx || ctx.kind !== "admission") throw new ApiError(404, "Admission not found");
  if (ctx.status !== "open") throw new ApiError(409, "This admission is already closed");
  await tx.query(`UPDATE cf.care_context SET status='closed', ended_at=$2, summary=summary || $3 WHERE id=$1`, [
    contextId, input.endedAt, JSON.stringify({ dischargeStatus: input.status, note: input.note ?? "" }),
  ]);
  for (const p of input.plan) await addPlanAction(tx, actor, patientId, { ...p, contextId, createdAt: input.endedAt });
  await journeyEvent(tx, actor, {
    patientId, occurredAt: input.endedAt, kind: "discharge", category: "visit",
    title: `Discharged · ${input.plan.length} plan action${input.plan.length === 1 ? "" : "s"} created`,
    detail: input.status, refType: "care_context", refId: contextId, contextId,
  });
  await audit(tx, actor, "discharge", "care_context", contextId, patientId);
  return ["contexts", "plan"] as Changed;
}

export async function startVisit(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: { startedAt: string; reasons: string[]; service: string; location?: string },
) {
  await patientInSite(tx, actor, patientId);
  const prev = (
    await tx.query(`SELECT id FROM cf.care_context WHERE patient_id=$1 AND status='closed' ORDER BY coalesce(ended_at,started_at) DESC LIMIT 1`, [patientId])
  ).rows[0];
  const open = (await tx.query(`SELECT id FROM cf.care_context WHERE patient_id=$1 AND kind='clinic_visit' AND status='open'`, [patientId])).rows[0];
  if (open) return { id: open.id as string, changed: [] as Changed, completed: [] };
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.care_context(id,patient_id,kind,status,started_at,location,service,reasons,previous_context_id,created_by) VALUES($1,$2,'clinic_visit','open',$3,$4,$5,$6,$7,$8)`,
    [id, patientId, input.startedAt, input.location ?? "OPD", input.service, input.reasons, prev?.id ?? null, actor.id],
  );
  const completed = await completeMatching(tx, actor, patientId, { type: "visit", at: input.startedAt, ref: id });
  await journeyEvent(tx, actor, {
    patientId, occurredAt: input.startedAt, kind: "clinic-visit", category: "visit",
    title: `${input.service} visit`, detail: input.reasons.join(" · "), refType: "care_context", refId: id, contextId: id,
  });
  await audit(tx, actor, "start-visit", "care_context", id, patientId);
  return { id, changed: ["contexts", ...(completed.length ? ["plan"] : [])] as Changed, completed };
}

export async function closeVisit(tx: Q, actor: Actor, patientId: string, contextId: string, input: { note?: string }) {
  const ctx = (await tx.query(`SELECT * FROM cf.care_context WHERE id=$1 AND patient_id=$2`, [contextId, patientId])).rows[0];
  if (!ctx || ctx.status !== "open") throw new ApiError(409, "Visit is not open");
  await tx.query(`UPDATE cf.care_context SET status='closed', ended_at=$2, summary=summary || $3 WHERE id=$1`, [contextId, nowIso(), JSON.stringify({ note: input.note ?? "" })]);
  await audit(tx, actor, "close-visit", "care_context", contextId, patientId);
  return ["contexts"] as Changed;
}

export const planDate = (base: string, days: number) => addDays(base, days);
export const niceDay = fmtDay;
