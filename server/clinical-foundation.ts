import type { Express, RequestHandler } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB, QueryDB } from "./db.js";
import { careKinds, type CareEntry } from "../src/care-model.js";
import { catalogVersion, templates } from "../src/guided.js";
import {
  evaluateRules,
  resolveClinicalState,
  resolvePathway,
  type ClinicalFact,
  type ClinicalPreference,
  type ClinicalRule,
  type ClinicalState,
  type ClinicalValue,
  type PathwayDefinition,
  type StructuredFieldDefinition,
  type UnitDefinition,
} from "../src/clinical-foundation.js";

export const clinicalEngineVersion = "clinical-governance.1";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class FoundationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const units: UnitDefinition[] = [
  {
    code: "%",
    symbol: "%",
    dimension: "ratio",
    canonicalCode: "%",
    factor: 1,
    offset: 0,
    version: 1,
  },
  {
    code: "kg",
    symbol: "kg",
    dimension: "mass",
    canonicalCode: "kg",
    factor: 1,
    offset: 0,
    version: 1,
  },
  {
    code: "mmHg",
    symbol: "mmHg",
    dimension: "pressure",
    canonicalCode: "mmHg",
    factor: 1,
    offset: 0,
    version: 1,
  },
  {
    code: "bpm",
    symbol: "bpm",
    dimension: "rate",
    canonicalCode: "bpm",
    factor: 1,
    offset: 0,
    version: 1,
  },
  {
    code: "mmol/L",
    symbol: "mmol/L",
    dimension: "molar_concentration",
    canonicalCode: "mmol/L",
    factor: 1,
    offset: 0,
    version: 1,
  },
  {
    code: "mg/dL",
    symbol: "mg/dL",
    dimension: "creatinine_concentration",
    canonicalCode: "mg/dL",
    factor: 1,
    offset: 0,
    version: 1,
  },
  {
    code: "µmol/L",
    symbol: "µmol/L",
    dimension: "creatinine_concentration",
    canonicalCode: "mg/dL",
    factor: 1 / 88.4,
    offset: 0,
    version: 1,
  },
  {
    code: "g/dL",
    symbol: "g/dL",
    dimension: "mass_concentration",
    canonicalCode: "g/dL",
    factor: 1,
    offset: 0,
    version: 1,
  },
  {
    code: "g/L",
    symbol: "g/L",
    dimension: "mass_concentration",
    canonicalCode: "g/dL",
    factor: 0.1,
    offset: 0,
    version: 1,
  },
  {
    code: "ng/L",
    symbol: "ng/L",
    dimension: "mass_concentration_nano",
    canonicalCode: "ng/L",
    factor: 1,
    offset: 0,
    version: 1,
  },
  {
    code: "ng/mL",
    symbol: "ng/mL",
    dimension: "mass_concentration_nano",
    canonicalCode: "ng/L",
    factor: 1000,
    offset: 0,
    version: 1,
  },
  {
    code: "mL/min",
    symbol: "mL/min",
    dimension: "clearance",
    canonicalCode: "mL/min",
    factor: 1,
    offset: 0,
    version: 1,
  },
];

function structuredPackage() {
  return {
    key: "care-guided-fields",
    version: catalogVersion,
    templates: templates.map((template) => ({
      key: template.key,
      conceptCode: template.key,
      kind: template.kind,
      family: template.family,
      label: template.label,
      fields: template.fields.map((field): StructuredFieldDefinition => ({
        key: field.key,
        label: field.label,
        valueType: field.type,
        conceptCode:
          template.kind === "investigation" && field.key === "value"
            ? template.key
            : undefined,
        options: field.options,
        units: field.unit ? [field.unit] : undefined,
        searchable:
          (field.type === "choice" || field.type === "multi") &&
          (field.options?.length ?? 0) > 5,
        priority: field.required ? "required" : "recommended",
        conditions: field.when
          ? [
              {
                key: field.when.key,
                operator: "one_of",
                value: field.when.values,
              },
            ]
          : undefined,
      })),
    })),
  };
}

export async function initializeClinicalFoundation(db: DB) {
  const concepts = [
    ...Object.entries(careKinds).map(([key, value]) => ({
      code: `care.${key}`,
      display: value.label,
      kind: key,
    })),
    ...templates.map((template) => ({
      code: template.key,
      display: template.label,
      kind: template.kind,
    })),
  ];
  for (const concept of new Map(
    concepts.map((item) => [item.code, item]),
  ).values())
    await db.query(
      "INSERT INTO clinical.terminology_concept(system,code,version,display,kind,created_by) VALUES('cardioflow',$1,1,$2,$3,'system:foundation') ON CONFLICT DO NOTHING",
      [concept.code, concept.display, concept.kind],
    );
  for (const unit of units)
    await db.query(
      "INSERT INTO clinical.unit_definition(code,version,symbol,dimension,canonical_code,factor,conversion_offset,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'system:foundation') ON CONFLICT DO NOTHING",
      [
        unit.code,
        unit.version,
        unit.symbol,
        unit.dimension,
        unit.canonicalCode,
        unit.factor,
        unit.offset,
      ],
    );
  const fields = structuredPackage(),
    serialized = JSON.stringify(fields),
    checksum = digest(serialized);
  await db.query(
    "INSERT INTO clinical.field_package(key,version,definition,checksum,created_by) VALUES($1,1,$2,$3,'system:foundation') ON CONFLICT DO NOTHING",
    [fields.key, serialized, checksum],
  );
  const stored = (
    await db.query<{ checksum: string }>(
      "SELECT checksum FROM clinical.field_package WHERE key=$1 AND version=1",
      [fields.key],
    )
  ).rows[0];
  if (stored?.checksum !== checksum)
    throw new Error("Clinical field package changed; publish a new version");
  await db.query(
    `INSERT INTO decision_support.evidence_source
      (key,version,title,organization,reviewed_at,status,metadata,created_by)
      VALUES('cardioflow-foundation','1','CardioFlow clinical foundation engineering contract','CardioFlow',CURRENT_DATE,'approved',$1,'system:foundation')
      ON CONFLICT DO NOTHING`,
    [JSON.stringify({ clinicalGuidance: false, purpose: "architecture" })],
  );
}

function parseFact(row: any): ClinicalFact {
  return {
    ...row,
    version: Number(row.version),
    concept_version: Number(row.concept_version),
    value: row.value as ClinicalValue,
    observed_at: new Date(row.observed_at).toISOString(),
    effective_start: new Date(row.effective_start).toISOString(),
    effective_end: row.effective_end
      ? new Date(row.effective_end).toISOString()
      : null,
    recorded_at: new Date(row.recorded_at).toISOString(),
  };
}

function parsePreference(row: any): ClinicalPreference {
  return { ...row, created_at: new Date(row.created_at).toISOString() };
}

export async function loadClinicalState(
  db: QueryDB,
  patientId: string,
  asOf = new Date().toISOString(),
) {
  const [facts, preferences] = await Promise.all([
    db.query("SELECT * FROM clinical.fact WHERE patient_id=$1", [patientId]),
    db.query(
      "SELECT * FROM clinical.current_preference WHERE patient_id=$1 ORDER BY event_sequence",
      [patientId],
    ),
  ]);
  return resolveClinicalState(
    facts.rows.map(parseFact),
    preferences.rows.map(parsePreference),
    asOf,
  );
}

export type FactInput = {
  logical_id?: string;
  concept_system: string;
  concept_code: string;
  concept_version: number;
  value: ClinicalValue;
  observed_at: string;
  effective_start?: string;
  effective_end?: string | null;
  encounter_id?: string | null;
  source_type: string;
  source_id: string;
  source_label: string;
  source_quality: "unknown" | "low" | "moderate" | "high";
  verification_status:
    "unconfirmed" | "preliminary" | "verified" | "entered_in_error";
  lifecycle_status: "active" | "resolved" | "retracted";
  supersedes_fact_id?: string | null;
};

async function appendFact(
  tx: QueryDB,
  patientId: string,
  input: FactInput,
  actor: string,
) {
  const concept = (
    await tx.query(
      "SELECT code FROM clinical.terminology_concept WHERE system=$1 AND code=$2 AND version=$3 AND status='active'",
      [input.concept_system, input.concept_code, input.concept_version],
    )
  ).rows[0];
  if (!concept)
    throw new FoundationError(422, "Unknown or inactive clinical concept");
  if (input.value.type === "quantity") {
    const unit = (
      await tx.query(
        "SELECT code FROM clinical.unit_definition WHERE code=$1 AND status='active' ORDER BY version DESC LIMIT 1",
        [input.value.unit],
      )
    ).rows[0];
    if (!unit)
      throw new FoundationError(422, "Unknown or inactive clinical unit");
  }
  let logicalId = input.logical_id ?? randomUUID(),
    version = 1,
    supersedes = input.supersedes_fact_id ?? null;
  if (supersedes) {
    const previous = (
      await tx.query<any>(
        "SELECT * FROM clinical.fact WHERE id=$1 AND patient_id=$2",
        [supersedes, patientId],
      )
    ).rows[0];
    if (!previous)
      throw new FoundationError(404, "Superseded clinical fact not found");
    if (
      previous.concept_system !== input.concept_system ||
      previous.concept_code !== input.concept_code
    )
      throw new FoundationError(422, "A correction must retain its concept");
    logicalId = previous.logical_id;
    version = Number(previous.version) + 1;
  }
  const id = randomUUID(),
    fact = (
      await tx.query<any>(
        `INSERT INTO clinical.fact
        (id,logical_id,version,patient_id,encounter_id,concept_system,concept_code,concept_version,value,observed_at,effective_start,effective_end,source_type,source_id,source_label,source_quality,verification_status,lifecycle_status,author,supersedes_fact_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
        [
          id,
          logicalId,
          version,
          patientId,
          input.encounter_id ?? null,
          input.concept_system,
          input.concept_code,
          input.concept_version,
          JSON.stringify(input.value),
          input.observed_at,
          input.effective_start ?? input.observed_at,
          input.effective_end ?? null,
          input.source_type,
          input.source_id,
          input.source_label,
          input.source_quality,
          input.verification_status,
          input.lifecycle_status,
          actor,
          supersedes,
        ],
      )
    ).rows[0];
  const event = (
    await tx.query<any>(
      "INSERT INTO clinical.event(id,patient_id,fact_id,event_type,payload,actor) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        randomUUID(),
        patientId,
        id,
        supersedes ? "fact.corrected" : "fact.recorded",
        JSON.stringify({
          concept: `${input.concept_system}|${input.concept_code}`,
          logicalId,
          version,
        }),
        actor,
      ],
    )
  ).rows[0];
  return { fact: parseFact(fact), event };
}

async function latestRecommendations(tx: QueryDB, patientId: string) {
  const rows = (
    await tx.query<any>(
      "SELECT * FROM decision_support.recommendation WHERE patient_id=$1 ORDER BY generation_sequence",
      [patientId],
    )
  ).rows;
  const latest = new Map<string, any>();
  for (const row of rows) latest.set(row.rule_key, row);
  return latest;
}

async function supersedeRecommendationTasks(
  tx: QueryDB,
  recommendationId: string,
  actor: string,
) {
  const tasks = (
    await tx.query<any>(
      "SELECT * FROM workflow.clinical_task WHERE source_type='recommendation' AND source_id=$1",
      [recommendationId],
    )
  ).rows;
  for (const task of tasks) {
    const latest = (
      await tx.query<any>(
        "SELECT * FROM workflow.clinical_task_event WHERE task_id=$1 ORDER BY version DESC LIMIT 1",
        [task.id],
      )
    ).rows[0];
    if (
      latest &&
      !["completed", "cancelled", "superseded"].includes(latest.status)
    )
      await tx.query(
        "INSERT INTO workflow.clinical_task_event(id,task_id,version,status,note,actor) VALUES($1,$2,$3,'superseded','Underlying recommendation changed',$4)",
        [randomUUID(), task.id, Number(latest.version) + 1, actor],
      );
  }
}

function addDays(instantValue: string, days: number) {
  const date = new Date(instantValue);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function recalculatePatient(
  tx: QueryDB,
  patientId: string,
  triggerEvent: any,
  actor: string,
) {
  const state = await loadClinicalState(
      tx,
      patientId,
      triggerEvent.occurred_at,
    ),
    ruleRows = (
      await tx.query<any>(
        `SELECT r.* FROM decision_support.rule_current_state r
         WHERE r.site_id='demo-kuwait' AND r.lifecycle_state='PUBLISHED'
           AND r.version=(
             SELECT max(current.version) FROM decision_support.rule_current_state current
             WHERE current.site_id=r.site_id AND current.key=r.key AND current.lifecycle_state='PUBLISHED'
           )
         ORDER BY r.priority,r.key,r.version`,
      )
    ).rows,
    rules = ruleRows.map((row) => row.definition as ClinicalRule),
    evaluations = evaluateRules(rules, state),
    previous = await latestRecommendations(tx, patientId),
    inserted: string[] = [],
    publishedKeys = new Set(rules.map((rule) => rule.key));
  for (const evaluation of evaluations) {
    const old = previous.get(evaluation.rule.key),
      status =
        evaluation.status === "inactive"
          ? old &&
            ["active", "needs_data", "excluded", "suppressed"].includes(
              old.status,
            )
            ? "resolved"
            : null
          : evaluation.status;
    if (!status) continue;
    const fingerprint = digest(
      JSON.stringify({
        engine: clinicalEngineVersion,
        rule: [evaluation.rule.key, evaluation.rule.version],
        status,
        facts: [...evaluation.factIds].sort(),
        missing: [...evaluation.missingConcepts].sort(),
        output: evaluation.rule.output,
      }),
    );
    if (old?.input_fingerprint === fingerprint) continue;
    if (old) await supersedeRecommendationTasks(tx, old.id, actor);
    const governed = ruleRows.find(
        (row) =>
          row.key === evaluation.rule.key &&
          Number(row.version) === evaluation.rule.version,
      ),
      reviewSnapshot = governed
        ? (
            await tx.query<any>(
              "SELECT * FROM decision_support.rule_review WHERE rule_key=$1 AND rule_version=$2 ORDER BY event_sequence",
              [governed.key, governed.version],
            )
          ).rows
        : [],
      recommendationId = randomUUID(),
      recommendation = (
        await tx.query<any>(
          `INSERT INTO decision_support.recommendation
          (id,patient_id,rule_key,rule_version,status,title,recommendation,explanation,missing_concepts,input_fact_ids,evidence_snapshot,input_fingerprint,valid_from,valid_until,trigger_event_id,supersedes_recommendation_id,rule_snapshot,publication_snapshot,review_snapshot)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
          [
            recommendationId,
            patientId,
            evaluation.rule.key,
            evaluation.rule.version,
            status,
            evaluation.rule.output.title,
            evaluation.rule.output.recommendation,
            JSON.stringify(evaluation.explanation),
            JSON.stringify(evaluation.missingConcepts),
            JSON.stringify(evaluation.factIds),
            JSON.stringify(evaluation.rule.evidence),
            fingerprint,
            triggerEvent.occurred_at,
            status === "resolved" ? triggerEvent.occurred_at : null,
            triggerEvent.id,
            old?.id ?? null,
            JSON.stringify(governed?.definition ?? evaluation.rule),
            JSON.stringify(
              governed
                ? {
                    eventId: governed.lifecycle_event_id,
                    state: governed.lifecycle_state,
                    actor: governed.lifecycle_actor,
                    at: governed.lifecycle_changed_at,
                  }
                : {},
            ),
            JSON.stringify(reviewSnapshot),
          ],
        )
      ).rows[0];
    inserted.push(recommendation.id);
    if (status === "active" && evaluation.rule.output.alert)
      await tx.query(
        `INSERT INTO decision_support.alert
        (id,patient_id,recommendation_id,fingerprint,category,severity,title,detail)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          patientId,
          recommendation.id,
          fingerprint,
          evaluation.rule.output.alert.category,
          evaluation.rule.output.alert.severity,
          evaluation.rule.output.title,
          evaluation.rule.output.recommendation,
        ],
      );
    if (status === "active")
      for (const proposed of evaluation.rule.output.tasks ?? []) {
        const taskId = randomUUID(),
          targetDate =
            proposed.dueInDays === undefined
              ? null
              : addDays(triggerEvent.occurred_at, proposed.dueInDays),
          therapy = proposed.medicationId
            ? (
                await tx.query<any>(
                  `SELECT id FROM medication.current_therapy
                   WHERE patient_id=$1 AND medication_id=$2
                     AND status IN ('ACTIVE','TEMPORARILY_HELD','PLANNED')
                   ORDER BY effective_at DESC LIMIT 1`,
                  [patientId, proposed.medicationId],
                )
              ).rows[0]
            : null;
        await tx.query(
          `INSERT INTO workflow.clinical_task
          (id,patient_id,kind,purpose,related_concept,target_date,assigned_to,source_type,source_id,details,created_by,
           medication_therapy_id,acceptable_window_start,acceptable_window_end,rule_key,rule_version)
          VALUES($1,$2,$3,$4,$5,$6,'Clinical team','recommendation',$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            taskId,
            patientId,
            proposed.kind,
            proposed.purpose,
            proposed.relatedConcept ?? null,
            targetDate,
            recommendation.id,
            JSON.stringify({
              rule: evaluation.rule.key,
              medicationId: proposed.medicationId ?? null,
              evidence: evaluation.rule.evidence,
            }),
            actor,
            therapy?.id ?? null,
            targetDate && proposed.acceptableWindowBeforeDays !== undefined
              ? addDays(
                  `${targetDate}T00:00:00.000Z`,
                  -proposed.acceptableWindowBeforeDays,
                )
              : null,
            targetDate && proposed.acceptableWindowAfterDays !== undefined
              ? addDays(
                  `${targetDate}T00:00:00.000Z`,
                  proposed.acceptableWindowAfterDays,
                )
              : null,
            evaluation.rule.key,
            evaluation.rule.version,
          ],
        );
        await tx.query(
          "INSERT INTO workflow.clinical_task_event(id,task_id,version,status,actor) VALUES($1,$2,1,'open',$3)",
          [randomUUID(), taskId, actor],
        );
      }
    const titration = evaluation.rule.output.titration;
    if (status === "active" && titration) {
      const therapy = (
        await tx.query<any>(
          `SELECT * FROM medication.current_therapy
           WHERE patient_id=$1 AND medication_id=$2
             AND status IN ('ACTIVE','TEMPORARILY_HELD','PLANNED')
           ORDER BY effective_at DESC LIMIT 1`,
          [patientId, titration.medicationId],
        )
      ).rows[0];
      if (therapy) {
        const planId = randomUUID();
        await tx.query(
          "INSERT INTO medication.titration_plan(id,patient_id,therapy_id,created_by) VALUES($1,$2,$3,$4)",
          [planId, patientId, therapy.id, actor],
        );
        await tx.query(
          `INSERT INTO medication.titration_event
           (id,plan_id,version,state,current_dose,required_checks,earliest_review_date,planned_titration_date,
            next_laboratory_date,limitation_type,limitation_reason,clinician_confirmed,note,actor)
           VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,false,$11,$12)`,
          [
            randomUUID(),
            planId,
            titration.state,
            JSON.stringify({
              value: therapy.dose_value,
              unit: therapy.dose_unit,
            }),
            JSON.stringify(titration.requiredChecks ?? []),
            titration.earliestReviewInDays === undefined
              ? null
              : addDays(
                  triggerEvent.occurred_at,
                  titration.earliestReviewInDays,
                ),
            titration.plannedTitrationInDays === undefined
              ? null
              : addDays(
                  triggerEvent.occurred_at,
                  titration.plannedTitrationInDays,
                ),
            titration.nextLaboratoryInDays === undefined
              ? null
              : addDays(
                  triggerEvent.occurred_at,
                  titration.nextLaboratoryInDays,
                ),
            titration.limitationType ?? null,
            titration.limitationReason ?? "",
            `Generated for clinician review by published rule ${evaluation.rule.key} v${evaluation.rule.version}; no dose was changed.`,
            actor,
          ],
        );
      }
    }
  }
  for (const [key, old] of previous) {
    if (
      publishedKeys.has(key) ||
      !["active", "needs_data", "excluded", "suppressed"].includes(old.status)
    )
      continue;
    await supersedeRecommendationTasks(tx, old.id, actor);
    const fingerprint = digest(
      JSON.stringify({
        engine: clinicalEngineVersion,
        rule: [old.rule_key, old.rule_version],
        status: "resolved",
        reason: "rule_not_published",
        trigger: triggerEvent.id,
      }),
    );
    const resolved = (
      await tx.query<any>(
        `INSERT INTO decision_support.recommendation
         (id,patient_id,rule_key,rule_version,status,title,recommendation,explanation,missing_concepts,input_fact_ids,evidence_snapshot,input_fingerprint,valid_from,valid_until,trigger_event_id,supersedes_recommendation_id,rule_snapshot,publication_snapshot,review_snapshot)
         VALUES($1,$2,$3,$4,'resolved',$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [
          randomUUID(),
          patientId,
          old.rule_key,
          old.rule_version,
          old.title,
          old.recommendation,
          JSON.stringify([
            "Recommendation resolved because its rule is no longer published.",
          ]),
          JSON.stringify(old.missing_concepts ?? []),
          JSON.stringify(old.input_fact_ids ?? []),
          JSON.stringify(old.evidence_snapshot ?? []),
          fingerprint,
          triggerEvent.occurred_at,
          triggerEvent.id,
          old.id,
          JSON.stringify(old.rule_snapshot ?? {}),
          JSON.stringify({
            state: "not_published",
            at: triggerEvent.occurred_at,
          }),
          JSON.stringify(old.review_snapshot ?? []),
        ],
      )
    ).rows[0];
    inserted.push(resolved.id);
  }
  await tx.query(
    "INSERT INTO decision_support.recalculation_run(id,patient_id,trigger_event_id,engine_version,result) VALUES($1,$2,$3,$4,$5)",
    [
      randomUUID(),
      patientId,
      triggerEvent.id,
      clinicalEngineVersion,
      JSON.stringify({ evaluated: rules.length, inserted }),
    ],
  );
  return { state, evaluated: rules.length, inserted };
}

export async function recordClinicalFact(
  tx: QueryDB,
  patientId: string,
  input: FactInput,
  actor: string,
) {
  const result = await appendFact(tx, patientId, input, actor);
  await recalculatePatient(tx, patientId, result.event, actor);
  return result.fact;
}

function careValue(entry: CareEntry): ClinicalValue {
  const answers = entry.structured ?? {};
  if (
    entry.kind === "investigation" &&
    typeof answers.value === "number" &&
    typeof answers.unit === "string"
  )
    return { type: "quantity", value: answers.value, unit: answers.unit };
  if (
    entry.template_key === "investigation.ecg" &&
    typeof answers.rhythm === "string"
  )
    return { type: "coded", code: answers.rhythm, display: answers.rhythm };
  return {
    type: "json",
    value: JSON.parse(
      JSON.stringify({
        title: entry.title,
        status: entry.status,
        details: entry.details,
        structured: answers,
      }),
    ),
  };
}

export async function projectCareEntry(
  tx: QueryDB,
  entry: CareEntry,
  actor: string,
) {
  const conceptCode = entry.template_key ?? `care.${entry.kind}`,
    previous = (
      await tx.query<any>(
        `SELECT * FROM clinical.fact
         WHERE patient_id=$1 AND source_type='care_entry' AND source_id=$2 AND concept_code=$3
         ORDER BY version DESC LIMIT 1`,
        [entry.patient_id, entry.id, conceptCode],
      )
    ).rows[0],
    answers = entry.structured ?? {},
    verification =
      entry.kind === "investigation"
        ? entry.status === "reviewed"
          ? "verified"
          : entry.status === "resulted"
            ? "preliminary"
            : "unconfirmed"
        : entry.kind === "problem"
          ? answers.certainty === "Confirmed"
            ? "verified"
            : "preliminary"
          : "verified",
    lifecycle = ["resolved", "cancelled", "discontinued", "excluded"].includes(
      entry.status,
    )
      ? "resolved"
      : "active";
  if (previous && Number(previous.version) >= Number(entry.version))
    return parseFact(previous);
  return recordClinicalFact(
    tx,
    entry.patient_id,
    {
      logical_id: previous?.logical_id ?? entry.id,
      concept_system: "cardioflow",
      concept_code: conceptCode,
      concept_version: 1,
      value: careValue(entry),
      observed_at: `${entry.occurred_on}T12:00:00.000Z`,
      encounter_id: entry.encounter_id,
      source_type: "care_entry",
      source_id: entry.id,
      source_label: entry.title,
      source_quality: "unknown",
      verification_status: verification,
      lifecycle_status: lifecycle,
      supersedes_fact_id: previous?.id ?? null,
    },
    actor,
  );
}

export async function synchronizeCareFacts(db: DB) {
  const entries = (
    await db.query<CareEntry>("SELECT * FROM care.entry ORDER BY updated_at,id")
  ).rows;
  for (const entry of entries)
    await db.transaction(async (tx) => {
      await projectCareEntry(tx, entry, "system:clinical-projection");
    });
}

async function ensurePatient(db: QueryDB, id: string) {
  const patient = (
    await db.query<any>(
      "SELECT * FROM core.patient WHERE id=$1 AND site_id='demo-kuwait'",
      [z.string().uuid().parse(id)],
    )
  ).rows[0];
  if (!patient) throw new FoundationError(404, "Patient not found");
  return patient;
}

const clinicalValueSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("quantity"),
      value: z.number().finite(),
      unit: z.string().min(1).max(40),
    })
    .strict(),
  z
    .object({
      type: z.literal("coded"),
      code: z.string().min(1).max(200),
      display: z.string().min(1).max(300),
      system: z.string().max(200).optional(),
    })
    .strict(),
  z.object({ type: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("text"), value: z.string().max(6000) }).strict(),
  z.object({ type: z.literal("json"), value: z.json() }).strict(),
]);

const factSchema = z
  .object({
    concept_system: z.string().min(1).max(100).default("cardioflow"),
    concept_code: z.string().min(1).max(200),
    concept_version: z.number().int().positive().default(1),
    value: clinicalValueSchema,
    observed_at: z.string().datetime(),
    effective_start: z.string().datetime().optional(),
    effective_end: z.string().datetime().nullable().optional(),
    encounter_id: z.string().uuid().nullable().optional(),
    source_type: z.string().min(1).max(100),
    source_id: z.string().min(1).max(300),
    source_label: z.string().min(1).max(300),
    source_quality: z.enum(["unknown", "low", "moderate", "high"]),
    verification_status: z.enum([
      "unconfirmed",
      "preliminary",
      "verified",
      "entered_in_error",
    ]),
    lifecycle_status: z.enum(["active", "resolved", "retracted"]),
    supersedes_fact_id: z.string().uuid().nullable().optional(),
  })
  .strict();

async function patientFoundation(
  db: QueryDB,
  patientId: string,
  asOf = new Date().toISOString(),
) {
  const state = await loadClinicalState(db, patientId, asOf),
    [
      recommendations,
      alerts,
      actions,
      tasks,
      taskEvents,
      events,
      runs,
      preferenceRows,
    ] = await Promise.all([
      db.query<any>(
        "SELECT * FROM decision_support.recommendation WHERE patient_id=$1 ORDER BY generation_sequence",
        [patientId],
      ),
      db.query<any>(
        "SELECT * FROM decision_support.alert WHERE patient_id=$1 ORDER BY created_at",
        [patientId],
      ),
      db.query<any>(
        "SELECT aa.* FROM decision_support.alert_action aa JOIN decision_support.alert a ON a.id=aa.alert_id WHERE a.patient_id=$1 ORDER BY aa.created_at",
        [patientId],
      ),
      db.query<any>(
        "SELECT * FROM workflow.clinical_task WHERE patient_id=$1 ORDER BY target_date NULLS LAST,created_at",
        [patientId],
      ),
      db.query<any>(
        "SELECT te.* FROM workflow.clinical_task_event te JOIN workflow.clinical_task t ON t.id=te.task_id WHERE t.patient_id=$1 ORDER BY te.created_at",
        [patientId],
      ),
      db.query<any>(
        "SELECT * FROM clinical.event WHERE patient_id=$1 ORDER BY occurred_at DESC LIMIT 100",
        [patientId],
      ),
      db.query<any>(
        "SELECT * FROM decision_support.recalculation_run WHERE patient_id=$1 ORDER BY completed_at DESC LIMIT 100",
        [patientId],
      ),
      db.query<any>(
        "SELECT * FROM clinical.current_preference WHERE patient_id=$1 ORDER BY event_sequence",
        [patientId],
      ),
    ]);
  const currentRecommendations = new Map<string, any>();
  for (const row of recommendations.rows)
    currentRecommendations.set(row.rule_key, row);
  const latestAlertAction = new Map<string, any>();
  for (const row of actions.rows) latestAlertAction.set(row.alert_id, row);
  const activeRecommendationIds = new Set(
    [...currentRecommendations.values()]
      .filter((row) => row.status === "active")
      .map((row) => row.id),
  );
  const latestTaskEvent = new Map<string, any>();
  for (const row of taskEvents.rows) latestTaskEvent.set(row.task_id, row);
  const latestPreferences = new Map<string, any>();
  for (const row of preferenceRows.rows)
    latestPreferences.set(`${row.concept_system}|${row.concept_code}`, row);
  return {
    engineVersion: clinicalEngineVersion,
    state,
    recommendations: {
      current: [...currentRecommendations.values()],
      history: recommendations.rows,
    },
    alerts: alerts.rows
      .filter((row) => activeRecommendationIds.has(row.recommendation_id))
      .map((row) => ({
        ...row,
        action: latestAlertAction.get(row.id) ?? null,
      })),
    tasks: tasks.rows.map((row) => ({
      ...row,
      current: latestTaskEvent.get(row.id) ?? null,
    })),
    events: events.rows,
    recalculations: runs.rows,
    currentPreferences: [...latestPreferences.values()],
  };
}

export function mountClinicalFoundation(
  app: Express,
  db: DB,
  read: RequestHandler,
  write: RequestHandler,
) {
  app.get("/api/clinical/catalog", read, async (_req, res) => {
    const [concepts, unitRows, fields, evidence] = await Promise.all([
      db.query(
        "SELECT * FROM clinical.terminology_concept ORDER BY kind,display",
      ),
      db.query(
        "SELECT * FROM clinical.unit_definition ORDER BY dimension,code",
      ),
      db.query(
        "SELECT * FROM clinical.field_package ORDER BY key,version DESC",
      ),
      db.query(
        "SELECT * FROM decision_support.evidence_source ORDER BY key,version",
      ),
    ]);
    res.json({
      engineVersion: clinicalEngineVersion,
      concepts: concepts.rows,
      units: unitRows.rows,
      fieldPackages: fields.rows,
      evidence: evidence.rows,
    });
  });
  app.get("/api/patients/:id/clinical-state", read, async (req, res) => {
    const patient = await ensurePatient(db, String(req.params.id));
    const asOf = z
      .string()
      .datetime()
      .parse(req.query.asOf ?? new Date().toISOString());
    res.json(await patientFoundation(db, patient.id, asOf));
  });
  app.post("/api/patients/:id/clinical-facts", write, async (req, res) => {
    const input = factSchema.parse(req.body),
      result = await db.transaction(async (tx) => {
        const patient = await ensurePatient(tx, String(req.params.id));
        return recordClinicalFact(
          tx,
          patient.id,
          input,
          res.locals.session.actor,
        );
      });
    res.status(201).json(result);
  });
  app.post(
    "/api/patients/:id/clinical-preferences",
    write,
    async (req, res) => {
      const input = z
          .object({
            concept_system: z.string().min(1).max(100),
            concept_code: z.string().min(1).max(200),
            fact_id: z.string().uuid().nullable(),
            action: z.enum(["select", "release"]),
            reason: z.string().trim().min(2).max(1000),
          })
          .strict()
          .parse(req.body),
        result = await db.transaction(async (tx) => {
          const patient = await ensurePatient(tx, String(req.params.id));
          let competingFactIds: string[] = [];
          if (input.action === "select") {
            const facts = (
              await tx.query<any>(
                `SELECT * FROM clinical.fact
                 WHERE patient_id=$1 AND concept_system=$2 AND concept_code=$3
                   AND verification_status='verified' AND lifecycle_status='active'
                   AND NOT EXISTS (
                     SELECT 1 FROM clinical.fact newer
                     WHERE newer.logical_id=clinical.fact.logical_id
                       AND newer.version>clinical.fact.version
                   )
                 ORDER BY observed_at DESC,recorded_at DESC`,
                [patient.id, input.concept_system, input.concept_code],
              )
            ).rows;
            const fact = facts.find(
              (candidate) => candidate.id === input.fact_id,
            );
            if (!fact)
              throw new FoundationError(
                422,
                "Preferred fact must be a verified active value for this patient and concept",
              );
            competingFactIds = facts
              .filter((candidate) => candidate.id !== input.fact_id)
              .map((candidate) => candidate.id);
          }
          const preference = (
            await tx.query<any>(
              `INSERT INTO clinical.current_preference
            (id,patient_id,concept_system,concept_code,fact_id,action,reason,actor,competing_fact_ids)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
              [
                randomUUID(),
                patient.id,
                input.concept_system,
                input.concept_code,
                input.fact_id,
                input.action,
                input.reason,
                res.locals.session.actor,
                JSON.stringify(competingFactIds),
              ],
            )
          ).rows[0];
          const event = (
            await tx.query<any>(
              "INSERT INTO clinical.event(id,patient_id,event_type,payload,actor) VALUES($1,$2,'current_preference.changed',$3,$4) RETURNING *",
              [
                randomUUID(),
                patient.id,
                JSON.stringify(input),
                res.locals.session.actor,
              ],
            )
          ).rows[0];
          await recalculatePatient(
            tx,
            patient.id,
            event,
            res.locals.session.actor,
          );
          return preference;
        });
      res.status(201).json(result);
    },
  );
  app.post("/api/clinical-alerts/:id/actions", write, async (req, res) => {
    const input = z
        .object({
          action: z.enum(["acknowledge", "act", "snooze", "dismiss"]),
          reason: z.string().trim().max(1000).default(""),
          snoozed_until: z.string().datetime().nullable().default(null),
        })
        .strict()
        .parse(req.body),
      alert = (
        await db.query<any>(
          "SELECT a.* FROM decision_support.alert a JOIN core.patient p ON p.id=a.patient_id WHERE a.id=$1 AND p.site_id='demo-kuwait'",
          [z.string().uuid().parse(req.params.id)],
        )
      ).rows[0];
    if (!alert) throw new FoundationError(404, "Alert not found");
    if (input.action === "snooze" && !input.snoozed_until)
      throw new FoundationError(422, "A snoozed alert needs a review time");
    if (["dismiss", "act"].includes(input.action) && !input.reason)
      throw new FoundationError(422, "Document the reason or action taken");
    const action = (
      await db.query<any>(
        "INSERT INTO decision_support.alert_action(id,alert_id,action,reason,snoozed_until,actor) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          randomUUID(),
          alert.id,
          input.action,
          input.reason,
          input.snoozed_until,
          res.locals.session.actor,
        ],
      )
    ).rows[0];
    res.status(201).json(action);
  });
  app.post("/api/patients/:id/clinical-tasks", write, async (req, res) => {
    const input = z
        .object({
          encounter_id: z.string().uuid().nullable().default(null),
          kind: z.enum([
            "clinical_review",
            "laboratory",
            "follow_up",
            "reassessment",
            "administrative",
          ]),
          purpose: z.string().trim().min(2).max(500),
          related_concept: z.string().max(200).nullable().default(null),
          target_date: z.string().date().nullable().default(null),
          assigned_to: z.string().trim().min(2).max(300),
        })
        .strict()
        .parse(req.body),
      task = await db.transaction(async (tx) => {
        const patient = await ensurePatient(tx, String(req.params.id)),
          id = randomUUID(),
          row = (
            await tx.query<any>(
              `INSERT INTO workflow.clinical_task
              (id,patient_id,encounter_id,kind,purpose,related_concept,target_date,assigned_to,source_type,source_id,created_by)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,'clinician',$9,$10) RETURNING *`,
              [
                id,
                patient.id,
                input.encounter_id,
                input.kind,
                input.purpose,
                input.related_concept,
                input.target_date,
                input.assigned_to,
                id,
                res.locals.session.actor,
              ],
            )
          ).rows[0];
        await tx.query(
          "INSERT INTO workflow.clinical_task_event(id,task_id,version,status,actor) VALUES($1,$2,1,'open',$3)",
          [randomUUID(), id, res.locals.session.actor],
        );
        return row;
      });
    res.status(201).json(task);
  });
  app.post("/api/clinical-tasks/:id/events", write, async (req, res) => {
    const input = z
        .object({
          status: z.enum([
            "open",
            "in_progress",
            "completed",
            "cancelled",
            "snoozed",
          ]),
          note: z.string().trim().max(2000).default(""),
          version: z.number().int().positive(),
        })
        .strict()
        .parse(req.body),
      taskId = z.string().uuid().parse(req.params.id),
      latest = (
        await db.query<any>(
          "SELECT e.* FROM workflow.clinical_task_event e JOIN workflow.clinical_task t ON t.id=e.task_id JOIN core.patient p ON p.id=t.patient_id WHERE e.task_id=$1 AND p.site_id='demo-kuwait' ORDER BY e.version DESC LIMIT 1",
          [taskId],
        )
      ).rows[0];
    if (!latest) throw new FoundationError(404, "Task not found");
    if (Number(latest.version) !== input.version)
      throw new FoundationError(409, "Task changed. Reload before saving.");
    if (["completed", "cancelled", "superseded"].includes(latest.status))
      throw new FoundationError(422, "A closed task cannot be reopened");
    if (["completed", "cancelled"].includes(input.status) && !input.note)
      throw new FoundationError(422, "Document the task outcome");
    const event = (
      await db.query<any>(
        "INSERT INTO workflow.clinical_task_event(id,task_id,version,status,note,actor) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          randomUUID(),
          taskId,
          input.version + 1,
          input.status,
          input.note,
          res.locals.session.actor,
        ],
      )
    ).rows[0];
    res.status(201).json(event);
  });
  app.get("/api/clinical/pathways", read, async (_req, res) =>
    res.json(
      (
        await db.query(
          "SELECT key,version,title,status,definition FROM decision_support.pathway_definition ORDER BY title,version DESC",
        )
      ).rows,
    ),
  );
  app.post("/api/patients/:id/pathways/:key/start", write, async (req, res) => {
    const input = z
        .object({ encounter_id: z.string().uuid().nullable().default(null) })
        .strict()
        .parse(req.body),
      result = await db.transaction(async (tx) => {
        const patient = await ensurePatient(tx, String(req.params.id)),
          definition = (
            await tx.query<any>(
              "SELECT * FROM decision_support.pathway_definition WHERE key=$1 AND status='active' ORDER BY version DESC LIMIT 1",
              [String(req.params.key)],
            )
          ).rows[0];
        if (!definition)
          throw new FoundationError(404, "Active pathway not found");
        return (
          await tx.query<any>(
            `INSERT INTO decision_support.pathway_session
            (id,patient_id,pathway_key,pathway_version,encounter_id,started_by)
            VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
            [
              randomUUID(),
              patient.id,
              definition.key,
              definition.version,
              input.encounter_id,
              res.locals.session.actor,
            ],
          )
        ).rows[0];
      });
    res.status(201).json(result);
  });
  app.get("/api/pathway-sessions/:id", read, async (req, res) => {
    const session = (
      await db.query<any>(
        "SELECT s.* FROM decision_support.pathway_session s JOIN core.patient p ON p.id=s.patient_id WHERE s.id=$1 AND p.site_id='demo-kuwait'",
        [z.string().uuid().parse(req.params.id)],
      )
    ).rows[0];
    if (!session) throw new FoundationError(404, "Pathway session not found");
    const [definition, responses, state] = await Promise.all([
      db.query<any>(
        "SELECT definition FROM decision_support.pathway_definition WHERE key=$1 AND version=$2",
        [session.pathway_key, session.pathway_version],
      ),
      db.query<any>(
        "SELECT * FROM decision_support.pathway_response WHERE session_id=$1 ORDER BY created_at",
        [session.id],
      ),
      loadClinicalState(db, session.patient_id),
    ]);
    const answerMap = Object.fromEntries(
      responses.rows.map((row) => [
        row.node_id,
        typeof row.response === "string" ? row.response : row.response.value,
      ]),
    );
    res.json({
      session,
      responses: responses.rows,
      resolution: resolvePathway(
        definition.rows[0].definition as PathwayDefinition,
        state,
        answerMap,
      ),
    });
  });
  app.post("/api/pathway-sessions/:id/responses", write, async (req, res) => {
    const input = z
        .object({
          node_id: z.string().min(1).max(200),
          response: z.string().min(1).max(500),
        })
        .strict()
        .parse(req.body),
      sessionId = z.string().uuid().parse(req.params.id),
      session = (
        await db.query<any>(
          "SELECT s.* FROM decision_support.pathway_session s JOIN core.patient p ON p.id=s.patient_id WHERE s.id=$1 AND p.site_id='demo-kuwait'",
          [sessionId],
        )
      ).rows[0];
    if (!session) throw new FoundationError(404, "Pathway session not found");
    const row = (
      await db.query<any>(
        "INSERT INTO decision_support.pathway_response(id,session_id,node_id,response,actor) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          randomUUID(),
          sessionId,
          input.node_id,
          JSON.stringify({ value: input.response }),
          res.locals.session.actor,
        ],
      )
    ).rows[0];
    res.status(201).json(row);
  });
}

export async function installRule(
  db: QueryDB,
  rule: ClinicalRule,
  actor: string,
) {
  if (rule.status === "active" && !rule.key.startsWith("test."))
    throw new FoundationError(
      403,
      "Active rules must use the governed maker-checker publication workflow",
    );
  if (rule.status === "active" && !rule.evidence.length)
    throw new FoundationError(
      422,
      "An active clinical rule requires versioned evidence",
    );
  for (const evidence of rule.evidence) {
    const approved = (
      await db.query(
        "SELECT key FROM decision_support.evidence_source WHERE key=$1 AND version=$2 AND status='approved'",
        [evidence.key, evidence.version],
      )
    ).rows[0];
    if (rule.status === "active" && !approved)
      throw new FoundationError(
        422,
        `Evidence is not approved: ${evidence.key} ${evidence.version}`,
      );
  }
  const serialized = JSON.stringify(rule),
    checksum = digest(serialized);
  await db.query(
    `INSERT INTO decision_support.rule_definition
    (key,version,topic,status,priority,definition,checksum,reviewed_at,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,$8)`,
    [
      rule.key,
      rule.version,
      rule.topic,
      rule.status,
      rule.priority,
      serialized,
      checksum,
      actor,
    ],
  );
  for (const evidence of rule.evidence)
    await db.query(
      `INSERT INTO decision_support.rule_evidence
       (rule_key,rule_version,evidence_key,evidence_version,relationship,added_by)
       VALUES($1,$2,$3,$4,'primary',$5) ON CONFLICT DO NOTHING`,
      [rule.key, rule.version, evidence.key, evidence.version, actor],
    );
  await db.query(
    `INSERT INTO decision_support.rule_lifecycle_event
     (id,rule_key,rule_version,site_id,state,comment,actor)
     VALUES($1,$2,$3,'demo-kuwait',$4,'Synthetic test helper; never seeded in production',$5)`,
    [
      randomUUID(),
      rule.key,
      rule.version,
      rule.status === "active" ? "PUBLISHED" : "DRAFT",
      actor,
    ],
  );
}

export async function installPathway(
  db: QueryDB,
  pathway: PathwayDefinition,
  actor: string,
) {
  const ids = new Set(pathway.nodes.map((node) => node.id));
  if (ids.size !== pathway.nodes.length || !ids.has(pathway.start))
    throw new FoundationError(
      422,
      "Pathway node IDs and start node are invalid",
    );
  for (const node of pathway.nodes) {
    const targets = [
      node.next,
      ...(node.choices ?? []).map((choice) => choice.next),
    ].filter((target): target is string => !!target);
    if (targets.some((target) => !ids.has(target)))
      throw new FoundationError(
        422,
        `Pathway node ${node.id} has an unknown target`,
      );
    for (const evidence of node.evidence ?? []) {
      const approved = (
        await db.query(
          "SELECT key FROM decision_support.evidence_source WHERE key=$1 AND version=$2 AND status='approved'",
          [evidence.key, evidence.version],
        )
      ).rows[0];
      if (pathway.status === "active" && !approved)
        throw new FoundationError(
          422,
          `Pathway evidence is not approved: ${evidence.key} ${evidence.version}`,
        );
    }
  }
  const serialized = JSON.stringify(pathway);
  await db.query(
    `INSERT INTO decision_support.pathway_definition
    (key,version,title,status,definition,checksum,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      pathway.key,
      pathway.version,
      pathway.title,
      pathway.status,
      serialized,
      digest(serialized),
      actor,
    ],
  );
}
