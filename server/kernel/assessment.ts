import type { Q } from "../db/db.js";
import { ApiError, nowIso, uuid, type Actor } from "./base.js";
import { loadState, type Obs, type PatientState } from "./state.js";
import { localDay } from "../../shared/clinical.js";
import {
  ASSESSMENT_CODES,
  assessmentValue,
  setAssessmentValue,
  type AssessmentAnswers,
  type AssessmentCode,
} from "../../shared/assessment-entry.js";
import { recordObservations, type ObsInput } from "./clinical.js";

function currentMeasurements(s: PatientState) {
  return Object.fromEntries(
    ASSESSMENT_CODES.map((code) => {
      const o = s.resolved(code).current;
      return [
        code,
        o?.status === "final" && localDay(o.effective_at) === s.today
          ? o
          : null,
      ];
    }),
  ) as Record<AssessmentCode, Obs | null>;
}
const valueOf = (o: Obs | null | undefined) =>
  o?.value_num != null ? String(o.value_num) : (o?.value_text ?? "");

// A confirmed field is not a new reading. Genuine pending edits retain their original
// observation baseline so newer readings require an explicit clinician choice.
export async function assessmentDraftView(
  tx: Q,
  patientId: string,
  contextId: string,
  row?: { answers: any; updated_at: Date | string },
) {
  const s = await loadState(tx, patientId),
    current = currentMeasurements(s);
  const latestAnswers: AssessmentAnswers = {
    vit: {},
    hfa: {},
    nyha: "",
    cong: "",
    baseline: {},
    baselineValues: {},
  };
  for (const code of ASSESSMENT_CODES) {
    setAssessmentValue(latestAnswers, code, valueOf(current[code]));
    latestAnswers.baseline![code] = current[code]?.id ?? null;
    latestAnswers.baselineValues![code] = valueOf(current[code]);
  }
  const answers: AssessmentAnswers = structuredClone(latestAnswers);
  const changed: AssessmentCode[] = [];
  const old = row?.answers as AssessmentAnswers | undefined;
  if (old)
    for (const code of ASSESSMENT_CODES) {
      const pending = assessmentValue(old, code);
      if (pending === undefined) continue;
      const originalId = old.baseline?.[code];
      const original = originalId
        ? s.observations.find((o) => o.id === originalId)
        : null;
      const confirmed = s.observations.some(
        (o) =>
          o.code === code &&
          o.context_id === contextId &&
          o.status === "final" &&
          valueOf(o) === pending &&
          new Date(o.recorded_at) >= new Date(row!.updated_at),
      );
      const untouched =
        originalId !== undefined &&
        pending === (old.baselineValues?.[code] ?? valueOf(original));
      if (confirmed || untouched || pending === valueOf(current[code]))
        continue;
      setAssessmentValue(answers, code, pending);
      answers.baseline![code] = originalId ?? null;
      answers.baselineValues![code] =
        old.baselineValues?.[code] ?? valueOf(original);
      const stale =
        originalId !== undefined
          ? originalId !== (current[code]?.id ?? null)
          : !!current[code] &&
            new Date(current[code]!.recorded_at) > new Date(row!.updated_at);
      const oldDay =
        localDay(new Date(row!.updated_at).toISOString()) !== s.today;
      if (stale || oldDay) changed.push(code);
      else answers.baseline![code] = current[code]?.id ?? null;
    }
  return {
    answers,
    latestAnswers,
    recordChanged: changed.length > 0,
    changedFields: changed,
  };
}

export async function confirmAssessment(
  tx: Q,
  actor: Actor,
  patientId: string,
  contextId: string,
  input: {
    items: ObsInput[];
    baseline: Partial<Record<AssessmentCode, string | null>>;
    draftVersion: number;
  },
) {
  await tx.query(`SELECT id FROM cf.patient WHERE id=$1 FOR UPDATE`, [
    patientId,
  ]);
  const ctx = (
    await tx.query(
      `SELECT status,kind FROM cf.care_context WHERE id=$1 AND patient_id=$2 AND removed_at IS NULL`,
      [contextId, patientId],
    )
  ).rows[0];
  if (!ctx || ctx.kind !== "clinic_visit" || ctx.status !== "open")
    throw new ApiError(409, "This visit is not open");
  const key = `entry:${actor.id}:assessment:${contextId}`;
  const draft = (
    await tx.query(
      `SELECT version FROM cf.wizard_draft WHERE patient_id=$1 AND wizard=$2 AND status='draft' ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [patientId, key],
    )
  ).rows[0];
  if (Number(draft?.version ?? 0) !== input.draftVersion)
    throw new ApiError(
      409,
      "This entry draft changed in another window. Review the saved draft before continuing.",
    );
  const current = currentMeasurements(await loadState(tx, patientId));
  for (const item of input.items) {
    const code = item.code as AssessmentCode;
    if (!ASSESSMENT_CODES.includes(code))
      throw new ApiError(
        400,
        "Only assessment measurements can be confirmed here",
      );
    if (
      !(code in input.baseline) ||
      input.baseline[code] !== (current[code]?.id ?? null)
    )
      throw new ApiError(
        409,
        "New readings are available. Review the latest measurements before saving this assessment.",
      );
  }
  const fresh = input.items.filter(
    (item) =>
      valueOf(current[item.code as AssessmentCode]) !==
      (item.value != null ? String(item.value) : (item.text ?? "")),
  );
  const r = fresh.length
    ? await recordObservations(tx, actor, patientId, {
        items: fresh,
        effectiveAt: nowIso(),
        contextId,
      })
    : { changed: [], ids: [] };
  // Retain a versioned, empty pending draft with the latest confirmed measurements.
  const { latestAnswers } = await assessmentDraftView(tx, patientId, contextId);
  if (draft)
    await tx.query(
      `UPDATE cf.wizard_draft SET answers=$2,version=version+1,updated_by=$3,updated_at=now() WHERE patient_id=$1 AND wizard=$4 AND status='draft'`,
      [patientId, JSON.stringify(latestAnswers), actor.id, key],
    );
  else
    await tx.query(
      `INSERT INTO cf.wizard_draft(id,patient_id,wizard,answers,status,updated_by) VALUES($5,$1,$2,$3,'draft',$4)`,
      [patientId, key, JSON.stringify(latestAnswers), actor.id, uuid()],
    );
  return { ...r, draftVersion: input.draftVersion + 1, answers: latestAnswers };
}
