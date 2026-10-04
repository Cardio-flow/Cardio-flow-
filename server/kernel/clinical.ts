// Write operations on the kernel. Each returns the list of "inputs" it changed so the
// engine only re-runs rules that read them.
import type { Q } from "../db/db.js";
import { BARRIER_CATEGORIES, BARRIER_LABEL, DIAGNOSIS, MEASURES, MEDICATION, classLabel, doseLabel, formatNumber } from "../../shared/catalog.js";
import { addDays, ageOn, daysBetween, egfrCkdEpi2021, fmtDay, isoDay } from "../../shared/clinical.js";
import { ApiError, audit, journeyEvent, nowIso, patientInSite, today, uuid, type Actor } from "./base.js";
import { HISTORY_ITEM, MULTIPLE_ALLOWED, cleanAttributes, historyCode } from "../../shared/history.js";
import { STUDY, cleanStudy, studySummary } from "../../shared/studies.js";
import { PROCEDURE_LABEL, cleanProcedure, procedureSummary, type ProcedureKind } from "../../shared/procedures.js";
import { CAUSE_GROUPS, FOLLOW_UP_STATUS, HF_REASONS, isHfAdmission, readmissionBand } from "../../shared/encounters.js";

export type Changed = string[];

// ---------- patients & conditions ----------
export type Identity = { civilId?: string | null; nationality?: string | null; mobile?: string | null };

async function civilIdFree(tx: Q, siteId: string, civilId: string | null | undefined, exceptPatient?: string) {
  if (!civilId) return;
  const other = (await tx.query(`SELECT name, mrn FROM cf.patient WHERE site_id=$1 AND civil_id=$2 AND id IS DISTINCT FROM $3`, [siteId, civilId, exceptPatient ?? null])).rows[0];
  if (other) throw new ApiError(409, `This civil ID is already registered to ${other.name} (MRN ${other.mrn})`);
}

export async function createPatient(
  tx: Q,
  actor: Actor,
  input: { name: string; mrn: string; sex: "Male" | "Female"; birthDate: string; allergies?: string; conditions?: string[] } & Identity,
) {
  const exists = (await tx.query("SELECT 1 FROM cf.patient WHERE site_id=$1 AND mrn=$2", [actor.siteId, input.mrn])).rows[0];
  if (exists) throw new ApiError(409, "A patient with this MRN already exists");
  await civilIdFree(tx, actor.siteId, input.civilId);
  const id = uuid();
  await tx.query(
    "INSERT INTO cf.patient(id,site_id,mrn,name,sex,birth_date,allergies,created_by,civil_id,nationality,mobile) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [id, actor.siteId, input.mrn, input.name, input.sex, input.birthDate, input.allergies || "Not recorded", actor.id, input.civilId || null, input.nationality || null, input.mobile || null],
  );
  for (const code of input.conditions ?? []) await addCondition(tx, actor, id, { code });
  await audit(tx, actor, "create", "patient", id, id);
  return id;
}

// Registration details are not clinical history: they are updated in place, and the audit
// keeps the previous values.
export async function updateIdentity(tx: Q, actor: Actor, patientId: string, input: Identity & { allergies?: string }) {
  const before = await patientInSite(tx, actor, patientId);
  await civilIdFree(tx, actor.siteId, input.civilId, patientId);
  const next = {
    civil_id: input.civilId === undefined ? before.civil_id : input.civilId || null,
    nationality: input.nationality === undefined ? before.nationality : input.nationality || null,
    mobile: input.mobile === undefined ? before.mobile : input.mobile || null,
    allergies: input.allergies === undefined ? before.allergies : input.allergies.trim() || "Not recorded",
  };
  await tx.query(`UPDATE cf.patient SET civil_id=$2, nationality=$3, mobile=$4, allergies=$5 WHERE id=$1`, [patientId, next.civil_id, next.nationality, next.mobile, next.allergies]);
  const changedFields = (Object.keys(next) as (keyof typeof next)[]).filter((k) => (before as any)[k] !== next[k]);
  await audit(tx, actor, "update-identity", "patient", patientId, patientId, { fields: changedFields, before: Object.fromEntries(changedFields.map((k) => [k, (before as any)[k]])) });
  return [] as Changed;
}

type ConditionInput = { code: string; onset?: string | null; onsetYear?: number | null; detail?: string; contextId?: string | null; attributes?: Record<string, unknown> | null };

function onsetParts(input: { onset?: string | null; onsetYear?: number | null; attributes?: Record<string, unknown> | null }, code: string) {
  let attributes: Record<string, unknown>;
  try {
    attributes = cleanAttributes(code, input.attributes ?? {});
  } catch (e) {
    throw new ApiError(400, `${DIAGNOSIS[code]?.display ?? code}: ${(e as Error).message}`);
  }
  const onset = input.onset ?? null;
  if (onset && onset > today()) throw new ApiError(400, "A past diagnosis cannot start in the future");
  delete attributes.onsetYear;
  if (!onset && input.onsetYear != null) {
    if (!Number.isInteger(input.onsetYear) || input.onsetYear < 1900 || input.onsetYear > Number(today().slice(0, 4))) throw new ApiError(400, "Year must be a past 4-digit year");
    attributes.onsetYear = input.onsetYear;
  }
  return { onset, attributes };
}

export async function addCondition(tx: Q, actor: Actor, patientId: string, input: ConditionInput) {
  const def = DIAGNOSIS[input.code];
  if (!def) throw new ApiError(400, "Unknown diagnosis");
  const { onset, attributes } = onsetParts(input, input.code);
  if (!MULTIPLE_ALLOWED.has(input.code)) {
    const dup = (
      await tx.query(
        `SELECT 1 FROM (SELECT DISTINCT ON (logical_id) code,status FROM cf.condition WHERE patient_id=$1 ORDER BY logical_id, version DESC) c WHERE code=$2 AND status='active'`,
        [patientId, input.code],
      )
    ).rows[0];
    if (dup) return { id: null, changed: [] as Changed };
  }
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.condition(id,logical_id,version,patient_id,code,display,status,onset,detail,context_id,recorded_by,attributes) VALUES($1,$1,1,$2,$3,$4,'active',$5,$6,$7,$8,$9)`,
    [id, patientId, input.code, def.display, onset, input.detail ?? "", input.contextId ?? null, actor.id, JSON.stringify(attributes)],
  );
  return { id, changed: ["conditions"] as Changed };
}

async function latestCondition(tx: Q, patientId: string, logicalId: string) {
  const cur = (await tx.query(`SELECT * FROM cf.condition WHERE logical_id=$1 AND patient_id=$2 ORDER BY version DESC LIMIT 1`, [logicalId, patientId])).rows[0];
  if (!cur) throw new ApiError(404, "Diagnosis not found");
  return cur;
}
async function newConditionVersion(tx: Q, actor: Actor, cur: any, change: { status?: string; onset?: string | null; attributes?: Record<string, unknown> }) {
  await tx.query(
    `INSERT INTO cf.condition(id,logical_id,version,patient_id,code,display,status,onset,detail,context_id,recorded_by,attributes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      uuid(), cur.logical_id, cur.version + 1, cur.patient_id, cur.code, cur.display, change.status ?? cur.status,
      change.onset === undefined ? cur.onset : change.onset, cur.detail, cur.context_id, actor.id, JSON.stringify(change.attributes ?? cur.attributes ?? {}),
    ],
  );
}

export async function setConditionStatus(tx: Q, actor: Actor, patientId: string, logicalId: string, status: "resolved" | "entered_in_error" | "active") {
  const cur = await latestCondition(tx, patientId, logicalId);
  await newConditionVersion(tx, actor, cur, { status });
  if (status === "resolved")
    await journeyEvent(tx, actor, { patientId, occurredAt: nowIso(), kind: "condition-resolved", category: "complication", title: `Resolved · ${cur.display}` });
  return ["conditions"] as Changed;
}

// Detail or date of an existing diagnosis: a new version, history kept.
export async function updateCondition(tx: Q, actor: Actor, patientId: string, logicalId: string, input: { onset?: string | null; onsetYear?: number | null; attributes?: Record<string, unknown> | null }) {
  const cur = await latestCondition(tx, patientId, logicalId);
  if (cur.status !== "active") throw new ApiError(409, "Only an active diagnosis can be updated");
  const { onset, attributes } = onsetParts(input, cur.code);
  await newConditionVersion(tx, actor, cur, { onset, attributes });
  return ["conditions"] as Changed;
}

// ---------- structured history ----------
export type HistoryAnswer = { item: string; answer: string; packYears?: number | null; quitYear?: number | null; resolveAs?: "resolved" | "entered_in_error" | null };

export async function recordHistory(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: {
    effectiveAt: string;
    answers?: HistoryAnswer[];
    add?: ConditionInput[];
    update?: { logicalId: string; onset?: string | null; onsetYear?: number | null; attributes?: Record<string, unknown> | null }[];
    contextId?: string | null;
  },
) {
  await patientInSite(tx, actor, patientId);
  const active = (
    await tx.query(
      `SELECT * FROM (SELECT DISTINCT ON (logical_id) * FROM cf.condition WHERE patient_id=$1 ORDER BY logical_id, version DESC) c WHERE status='active'`,
      [patientId],
    )
  ).rows as any[];
  const obs = async (code: string, text: string | null, num: number | null, unit: string | null = null) =>
    tx.query(
      `INSERT INTO cf.observation(id,logical_id,version,patient_id,code,value_num,value_text,unit,effective_at,status,quality,source,context_id,recorded_by)
       VALUES($1,$1,1,$2,$3,$4,$5,$6,$7,'final','standard','history',$8,$9)`,
      [uuid(), patientId, code, num, text, unit, input.effectiveAt, input.contextId ?? null, actor.id],
    );
  const summary: string[] = [];
  const addCodes = new Set((input.add ?? []).map((a) => a.code));
  for (const a of input.answers ?? []) {
    const item = HISTORY_ITEM[a.item];
    if (!item) throw new ApiError(400, `Unknown history item: ${a.item}`);
    if (item.conditions) {
      if (!["no", "unknown", "not-assessed"].includes(a.answer))
        throw new ApiError(400, `${item.label}: record "yes" by adding the diagnosis`);
      if (item.conditions.some((c) => addCodes.has(c))) throw new ApiError(400, `${item.label}: cannot add a diagnosis and answer "${a.answer}" together`);
      const present = active.filter((c) => item.conditions!.includes(c.code));
      if (present.length) {
        if (a.answer !== "no" || !a.resolveAs)
          throw new ApiError(409, `${item.label}: ${present.map((c) => c.display).join(", ")} is on the diagnosis list. Mark it resolved or entered in error first.`);
        for (const c of present) await setConditionStatus(tx, actor, patientId, c.logical_id, a.resolveAs);
      }
      await obs(historyCode(item.key), a.answer, null);
    } else {
      const opt = item.options!.find((o) => o.value === a.answer);
      if (!opt) throw new ApiError(400, `${item.label}: choose from the list`);
      await obs(historyCode(item.key), a.answer, null);
      for (const d of item.details ?? []) {
        const v = (a as any)[d.key];
        if (v == null || !d.when.includes(a.answer)) continue;
        if (!(Number.isFinite(v) && v >= d.min && v <= d.max)) throw new ApiError(400, `${d.label}: value out of range`);
        await obs(`${historyCode(item.key)}.${d.key}`, null, v, d.unit ?? null);
      }
      // the old "Current smoker" diagnosis is reconciled with the dated smoking status
      if (item.key === "smoking" && a.answer !== "current")
        for (const c of active.filter((c) => c.code === "smoker")) await setConditionStatus(tx, actor, patientId, c.logical_id, "resolved");
    }
    summary.push(`${item.label}: ${a.answer}`);
  }
  for (const c of input.add ?? []) {
    await addCondition(tx, actor, patientId, { ...c, contextId: input.contextId });
    summary.push(`+ ${DIAGNOSIS[c.code]?.display ?? c.code}`);
  }
  for (const u of input.update ?? []) await updateCondition(tx, actor, patientId, u.logicalId, u);
  await audit(tx, actor, "record-history", "patient", patientId, patientId, { summary, updated: (input.update ?? []).length });
  return { changed: ["conditions", "history"] as Changed };
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
    if (value != null && def?.max != null && value > def.max) throw new ApiError(400, `${def.display}: ${value} is above the maximum ${def.max}`);
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
  const labs = saved.filter((s) => MEASURES[s.code] && !["Vitals", "Echo", "HF"].includes(MEASURES[s.code].category));
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

// Any non-Echo study, from its template. Numeric findings that rules read become
// dated observations linked to the study.
export async function recordStudy(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: { kind: string; date: string; findings: Record<string, unknown>; conclusion?: string; contextId?: string | null },
) {
  await patientInSite(tx, actor, patientId);
  const def = STUDY[input.kind];
  if (!def) throw new ApiError(400, "Unknown study type");
  if (input.date > nowIso() && isoDay(new Date(input.date)) > today()) throw new ApiError(400, "A study cannot be dated in the future");
  let attributes: Record<string, any>;
  try {
    attributes = cleanStudy(input.kind, input.findings);
  } catch (e) {
    throw new ApiError(400, `${def.short}: ${(e as Error).message}`);
  }
  if (!Object.keys(attributes).length) throw new ApiError(400, `${def.short}: record at least one finding`);
  const summary = studySummary(input.kind, attributes);
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.study(id,patient_id,kind,performed_at,quality,findings,conclusion,context_id,recorded_by,attributes) VALUES($1,$2,$3,$4,'formal',$5,$6,$7,$8,$9)`,
    [id, patientId, input.kind, input.date, summary ? [summary] : [], input.conclusion ?? "", input.contextId ?? null, actor.id, JSON.stringify(attributes)],
  );
  const items = def.fields
    .filter((f): f is Extract<typeof f, { type: "number" }> => f.type === "number" && !!f.obs && attributes[f.key] != null)
    .map((f) => ({ code: f.obs!, value: Number(attributes[f.key]) }));
  const changed: Changed = ["studies"];
  if (items.length) {
    const r = await recordObservations(tx, actor, patientId, {
      effectiveAt: input.date, items, quality: "formal", studyId: id, contextId: input.contextId, source: def.short, silentEvent: true,
    });
    changed.push(...r.changed);
  }
  await journeyEvent(tx, actor, {
    patientId, occurredAt: input.date, kind: input.kind, category: "investigation",
    title: `${def.short} · ${summary || "recorded"}`.slice(0, 200), detail: input.conclusion ?? "", refType: "study", refId: id, contextId: input.contextId,
  });
  const completed = await completeMatching(tx, actor, patientId, { type: "study", kind: input.kind, at: input.date, ref: id });
  if (completed.length) changed.push("plan");
  await audit(tx, actor, "record", "study", id, patientId, { kind: input.kind });
  return { id, changed: [...new Set(changed)], completed };
}

// ---------- procedures (PCI, CABG) ----------
export async function recordProcedure(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: { kind: ProcedureKind; date: string; details: Record<string, unknown>; contextId?: string | null },
) {
  await patientInSite(tx, actor, patientId);
  if (!PROCEDURE_LABEL[input.kind]) throw new ApiError(400, "Unknown procedure");
  if (isoDay(new Date(input.date)) > today()) throw new ApiError(400, "A procedure cannot be dated in the future");
  let attributes: Record<string, any>;
  try {
    attributes = cleanProcedure(input.kind, input.details);
  } catch (e) {
    throw new ApiError(400, `${PROCEDURE_LABEL[input.kind]}: ${(e as Error).message}`);
  }
  const summary = procedureSummary(input.kind, attributes);
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.procedure(id,patient_id,kind,performed_at,attributes,summary,context_id,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, patientId, input.kind, input.date, JSON.stringify(attributes), summary, input.contextId ?? null, actor.id],
  );
  // the problem list carries the procedure as past coronary history (keeps every coronary rule in step)
  const day = isoDay(new Date(input.date));
  const changed: Changed = ["procedures", "conditions"];
  if (input.kind === "pci")
    await addCondition(tx, actor, patientId, { code: "prior-pci", onset: day, contextId: input.contextId, attributes: { vessels: attributes.vessels } });
  else await addCondition(tx, actor, patientId, { code: "prior-cabg", onset: day, contextId: input.contextId, attributes: { grafts: (attributes.grafts as string[]).map((g) => (g === "LIMA to LAD" ? "LIMA" : g === "Other arterial graft" ? "Other arterial" : "Vein grafts")) } });
  await journeyEvent(tx, actor, {
    patientId, occurredAt: input.date, kind: input.kind, category: "procedure",
    title: `${PROCEDURE_LABEL[input.kind]} · ${summary}`.slice(0, 200), detail: "", refType: "procedure", refId: id, contextId: input.contextId,
  });
  await audit(tx, actor, "record", "procedure", id, patientId, { kind: input.kind });
  return { id, changed };
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
  input: { kind: "increase" | "decrease" | "hold" | "restart" | "stop" | "continue" | "not_taking" | "resume"; doseValue?: number | null; frequency?: string | null; reason?: string; effectiveAt: string; contextId?: string | null; decisionId?: string | null },
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
  // exceptions reported by the patient: only against the current state
  if (input.kind === "not_taking" && !["start", "restart", "increase", "decrease", "continue", "resume"].includes(lastAny?.kind)) throw new ApiError(409, `${def?.name} is not currently being taken as prescribed`);
  if (input.kind === "resume" && lastAny?.kind !== "not_taking") throw new ApiError(409, `${def?.name} is not marked as not taken`);
  if (input.kind === "not_taking" && !input.reason?.trim()) throw new ApiError(400, "Give the reason the patient is not taking it");
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
    const verb = { increase: "increased", decrease: "reduced", hold: "held", restart: "restarted", stop: "stopped", not_taking: "not being taken (patient report)", resume: "taken again" }[input.kind];
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

// ---------- treatment barriers: why a drug class is not given ----------
export async function recordBarrier(
  tx: Q, actor: Actor, patientId: string,
  input: { drugClass: string; category: string; detail?: string; drug?: string | null; recommendationId?: string | null; effectiveAt?: string },
) {
  if (!BARRIER_CATEGORIES.some((c) => c.value === input.category)) throw new ApiError(400, "Choose a reason");
  if (input.category === "other" && !input.detail?.trim()) throw new ApiError(400, "Add a short note");
  const at = input.effectiveAt ?? nowIso();
  await tx.query(
    `INSERT INTO cf.treatment_barrier(id,patient_id,drug_class,category,detail,drug,recommendation_id,effective_at,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [uuid(), patientId, input.drugClass, input.category, input.detail?.trim() ?? "", input.drug ?? null, input.recommendationId ?? null, at, actor.id],
  );
  await journeyEvent(tx, actor, {
    patientId, occurredAt: at, kind: "treatment-barrier", category: "medication",
    title: `${classLabel(input.drugClass)}: not given`,
    detail: `${BARRIER_LABEL[input.category]}${input.detail?.trim() ? ` · ${input.detail.trim()}` : ""}`,
    refType: "barrier",
  });
  await audit(tx, actor, "barrier", "treatment_barrier", input.drugClass, patientId, { category: input.category });
  return null as Changed | null; // every rule re-runs
}

export async function clearBarrier(tx: Q, actor: Actor, patientId: string, drugClass: string) {
  const cur = (await tx.query(`SELECT * FROM cf.treatment_barrier WHERE patient_id=$1 AND drug_class=$2 ORDER BY effective_at DESC, recorded_at DESC LIMIT 1`, [patientId, drugClass])).rows[0];
  if (!cur || cur.cleared) throw new ApiError(404, "No recorded reason for this drug class");
  await tx.query(
    `INSERT INTO cf.treatment_barrier(id,patient_id,drug_class,category,detail,drug,cleared,effective_at,recorded_by) VALUES($1,$2,$3,$4,'',$5,true,$6,$7)`,
    [uuid(), patientId, drugClass, cur.category, cur.drug, nowIso(), actor.id],
  );
  await journeyEvent(tx, actor, { patientId, occurredAt: nowIso(), kind: "treatment-barrier", category: "medication", title: `${classLabel(drugClass)}: reason removed`, detail: "Suggestions for this class can return", refType: "barrier" });
  await audit(tx, actor, "barrier-clear", "treatment_barrier", drugClass, patientId, {});
  return null as Changed | null;
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
    // how early a result may count: never more than half the planned interval (max 7 days; 30 for Echo)
    const interval = a.due_date ? Math.max(0, daysBetween(new Date(a.created_at).toISOString(), String(a.due_date).slice(0, 10))) : 0;
    const windowDays = trigger.type === "study" ? 30 : Math.min(7, Math.floor(interval / 2));
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
export type AdmissionInput = {
  startedAt: string;
  location: string;
  reasons: string[];
  route?: string | null;
  symptoms?: string[];
  hfRelated?: boolean | null;
  confirmations?: { kind: "condition" | "medication"; id: string; answer: "unchanged" | "changed" | "unknown" | "not-assessed" }[];
};

export async function startAdmission(tx: Q, actor: Actor, patientId: string, input: AdmissionInput) {
  await patientInSite(tx, actor, patientId);
  await notDeceased(tx, patientId);
  const open = (await tx.query(`SELECT 1 FROM cf.care_context WHERE patient_id=$1 AND kind='admission' AND status='open'`, [patientId])).rows[0];
  if (open) throw new ApiError(409, "This patient already has an open admission");
  const prev = (
    await tx.query(
      `SELECT id, ended_at, reasons, summary FROM cf.care_context WHERE patient_id=$1 AND kind='admission' AND status='closed' AND ended_at <= $2 ORDER BY ended_at DESC LIMIT 1`,
      [patientId, input.startedAt],
    )
  ).rows[0] as any;
  const hfRelated = input.hfRelated ?? input.reasons.some((r) => HF_REASONS.includes(r));
  let readmission = null;
  if (prev?.ended_at) {
    const prevSummary = typeof prev.summary === "string" ? JSON.parse(prev.summary) : prev.summary ?? {};
    const days = daysBetween(new Date(prev.ended_at).toISOString(), input.startedAt);
    const previousHfRelated = isHfAdmission({ reasons: prev.reasons ?? [], summary: prevSummary });
    readmission = { days, band: readmissionBand(days), previousId: prev.id, previousDischarge: new Date(prev.ended_at).toISOString(), previousHfRelated, hfReadmission: hfRelated && previousHfRelated };
  }
  const id = uuid();
  const summary = { confirmations: input.confirmations ?? [], route: input.route ?? null, symptoms: input.symptoms ?? [], hfRelated, readmission };
  await tx.query(
    `INSERT INTO cf.care_context(id,patient_id,kind,status,started_at,location,service,reasons,previous_context_id,summary,created_by) VALUES($1,$2,'admission','open',$3,$4,'Cardiology',$5,$6,$7,$8)`,
    [id, patientId, input.startedAt, input.location, input.reasons, prev?.id ?? null, JSON.stringify(summary), actor.id],
  );
  await journeyEvent(tx, actor, {
    patientId, occurredAt: input.startedAt, kind: "admission", category: "visit",
    title: `Admitted · ${input.reasons.join(", ") || "cardiology"}${readmission ? ` · readmission ${readmission.days} d after discharge` : ""}`,
    detail: [input.location, input.route, (input.symptoms ?? []).join(", ")].filter(Boolean).join(" · "), refType: "care_context", refId: id, contextId: id,
  });
  await audit(tx, actor, "admit", "care_context", id, patientId);
  return { id, changed: ["contexts"] as Changed };
}

export type DischargeInput = {
  endedAt: string;
  outcome?: "alive" | "died";
  status: string; // condition at discharge
  destination?: string | null;
  events?: string[];
  causeGroup?: string | null;
  dischargeWeight?: number | null;
  plan: PlanInput[];
  note?: string;
};

export async function discharge(tx: Q, actor: Actor, patientId: string, contextId: string, input: DischargeInput) {
  const ctx = (await tx.query(`SELECT * FROM cf.care_context WHERE id=$1 AND patient_id=$2`, [contextId, patientId])).rows[0];
  if (!ctx || ctx.kind !== "admission") throw new ApiError(404, "Admission not found");
  if (ctx.status !== "open") throw new ApiError(409, "This admission is already closed");
  if (new Date(input.endedAt) < new Date(ctx.started_at)) throw new ApiError(400, "Discharge cannot be before admission");
  const died = input.outcome === "died";
  if (died && input.plan.length) throw new ApiError(400, "No follow-up plan for a patient who died in hospital");
  if (died && !input.causeGroup) throw new ApiError(400, "Cause of death group is required");
  const events = (input.events ?? []).filter((e) => e !== "None");
  const los = daysBetween(new Date(ctx.started_at).toISOString(), input.endedAt);
  await tx.query(`UPDATE cf.care_context SET status='closed', ended_at=$2, summary=summary || $3 WHERE id=$1`, [
    contextId, input.endedAt,
    JSON.stringify({ outcome: died ? "died" : "alive", dischargeStatus: input.status, destination: died ? null : input.destination ?? null, events, los, note: input.note ?? "" }),
  ]);
  const changed: Changed = ["contexts", "plan"];
  if (input.dischargeWeight != null && !died) {
    const r = await recordObservations(tx, actor, patientId, { effectiveAt: input.endedAt, items: [{ code: "weight", value: input.dischargeWeight }], contextId, source: "discharge weight", silentEvent: true });
    changed.push(...r.changed);
  }
  for (const p of input.plan) await addPlanAction(tx, actor, patientId, { ...p, contextId, createdAt: input.endedAt });
  await journeyEvent(tx, actor, {
    patientId, occurredAt: input.endedAt, kind: "discharge", category: "visit",
    title: died ? `Died in hospital · day ${los}` : `Discharged · day ${los} · ${input.plan.length} plan action${input.plan.length === 1 ? "" : "s"} created`,
    detail: [input.status, input.destination, events.length ? "Events: " + events.join(", ") : null].filter(Boolean).join(" · "), refType: "care_context", refId: contextId, contextId,
  });
  if (died)
    await recordStatus(tx, actor, patientId, { kind: "vital", status: "died", effectiveOn: isoDay(new Date(input.endedAt)), place: "in_hospital", causeGroup: input.causeGroup, contextId });
  await audit(tx, actor, "discharge", "care_context", contextId, patientId, { outcome: died ? "died" : "alive", los });
  return changed;
}

// ---------- vital and follow-up status ----------
export type StatusInput = {
  kind: "vital" | "follow_up";
  status: string;
  effectiveOn: string;
  place?: "in_hospital" | "out_of_hospital" | "unknown" | null;
  causeGroup?: string | null;
  detail?: string;
  contextId?: string | null;
};
async function notDeceased(tx: Q, patientId: string) {
  const v = (await tx.query(`SELECT status FROM cf.status_event WHERE patient_id=$1 AND kind='vital' ORDER BY effective_on DESC, recorded_at DESC LIMIT 1`, [patientId])).rows[0];
  if (v?.status === "died") throw new ApiError(409, "This patient is recorded as deceased");
}

export async function recordStatus(tx: Q, actor: Actor, patientId: string, input: StatusInput) {
  await patientInSite(tx, actor, patientId);
  const vitalOk = input.kind === "vital" && ["alive", "died"].includes(input.status);
  const fuOk = input.kind === "follow_up" && FOLLOW_UP_STATUS.some((f) => f.value === input.status);
  if (!vitalOk && !fuOk) throw new ApiError(400, "Status does not match its kind");
  if (input.effectiveOn > today()) throw new ApiError(400, "Status date cannot be in the future");
  const died = input.kind === "vital" && input.status === "died";
  if (died && !input.causeGroup) throw new ApiError(400, "Cause of death group is required");
  if (died && !CAUSE_GROUPS.some((c) => c.value === input.causeGroup)) throw new ApiError(400, "Unknown cause group");
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.status_event(id,patient_id,kind,status,effective_on,place,cause_group,detail,context_id,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, patientId, input.kind, input.status, input.effectiveOn, died ? input.place ?? "unknown" : null, died ? input.causeGroup : null, input.detail ?? "", input.contextId ?? null, actor.id],
  );
  if (died) {
    // a deceased patient leaves every reminder list: open plan actions are closed with the reason
    await tx.query(
      `UPDATE cf.plan_action SET status='cancelled', outcome='Patient deceased', updated_at=now(), version=version+1 WHERE patient_id=$1 AND status='planned'`,
      [patientId],
    );
    if (!input.contextId)
      await journeyEvent(tx, actor, {
        patientId, occurredAt: new Date(`${input.effectiveOn}T12:00:00+03:00`).toISOString(), kind: "death", category: "visit",
        title: `Died${input.place === "in_hospital" ? " in hospital" : input.place === "out_of_hospital" ? " out of hospital" : ""} · ${CAUSE_GROUPS.find((c) => c.value === input.causeGroup)?.label}`,
        detail: input.detail ?? "", refType: "status_event", refId: id,
      });
  } else if (input.kind === "follow_up") {
    await journeyEvent(tx, actor, {
      patientId, occurredAt: new Date(`${input.effectiveOn}T12:00:00+03:00`).toISOString(), kind: "follow-up-status", category: "plan",
      title: `Follow-up: ${FOLLOW_UP_STATUS.find((f) => f.value === input.status)?.label}`, detail: input.detail ?? "", refType: "status_event", refId: id,
    });
  }
  await audit(tx, actor, "record-status", "status_event", id, patientId, { kind: input.kind, status: input.status });
  return { id };
}

export async function startVisit(
  tx: Q,
  actor: Actor,
  patientId: string,
  input: { startedAt: string; reasons: string[]; service: string; location?: string; symptoms?: string[] },
) {
  await patientInSite(tx, actor, patientId);
  await notDeceased(tx, patientId);
  const prev = (
    await tx.query(`SELECT id FROM cf.care_context WHERE patient_id=$1 AND status='closed' ORDER BY coalesce(ended_at,started_at) DESC LIMIT 1`, [patientId])
  ).rows[0];
  const open = (await tx.query(`SELECT id FROM cf.care_context WHERE patient_id=$1 AND kind='clinic_visit' AND status='open'`, [patientId])).rows[0];
  if (open) return { id: open.id as string, changed: [] as Changed, completed: [] };
  const id = uuid();
  await tx.query(
    `INSERT INTO cf.care_context(id,patient_id,kind,status,started_at,location,service,reasons,previous_context_id,summary,created_by) VALUES($1,$2,'clinic_visit','open',$3,$4,$5,$6,$7,$8,$9)`,
    [id, patientId, input.startedAt, input.location ?? "OPD", input.service, input.reasons, prev?.id ?? null, JSON.stringify({ symptoms: input.symptoms ?? [] }), actor.id],
  );
  const completed = await completeMatching(tx, actor, patientId, { type: "visit", at: input.startedAt, ref: id });
  await journeyEvent(tx, actor, {
    patientId, occurredAt: input.startedAt, kind: "clinic-visit", category: "visit",
    title: `${input.service} visit`, detail: [...input.reasons, ...(input.symptoms?.length ? ["Symptoms: " + input.symptoms.join(", ")] : [])].join(" · "), refType: "care_context", refId: id, contextId: id,
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
