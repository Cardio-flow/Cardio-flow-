import type { Express, RequestHandler } from "express";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { DB, QueryDB } from "./db.js";
import { audit } from "./db.js";
import { recordClinicalFact } from "./clinical-foundation.js";
import { loadEchoStudies } from "./echo-valve.js";
import { preferredEchoStudy } from "../src/echo-valve.js";
import {
  acsDiagnoses,
  coronaryComplications,
  coronaryEvidence,
  coronaryPlanCategories,
  coronaryStates,
  coronaryVessels,
} from "../src/coronary-model.js";

const SITE = "demo-kuwait";
const id = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max = 500) => z.string().trim().max(max).default("");
const optionalTime = dateTime.nullable().default(null);
const optionalId = id.nullable().default(null);
const num = (min: number, max: number) =>
  z.number().finite().min(min).max(max).nullable().default(null);
const json = JSON.stringify;
const parse = (value: any) =>
  typeof value === "string" ? JSON.parse(value) : value;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class CoronaryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function patient(db: QueryDB, patientId: string) {
  const row = (
    await db.query<{ id: string }>(
      "SELECT id FROM core.patient WHERE id=$1 AND site_id=$2",
      [patientId, SITE],
    )
  ).rows[0];
  if (!row) throw new CoronaryError(404, "Patient not found");
  return row;
}
async function samePatient(
  db: QueryDB,
  table: string,
  recordId: string | null,
  patientId: string,
) {
  if (!recordId) return;
  if (
    ![
      "state_event",
      "ecg",
      "acs_event",
      "angiogram",
      "lesion",
      "pci",
      "plan_event",
    ].includes(table)
  )
    throw new CoronaryError(400, "Unsupported link");
  const sql =
    table === "lesion"
      ? "SELECT a.patient_id FROM coronary.lesion l JOIN coronary.angiogram a ON a.id=l.angiogram_id WHERE l.id=$1"
      : table === "ecg"
        ? "SELECT patient_id FROM clinical.ecg WHERE id=$1"
        : `SELECT patient_id FROM coronary.${table} WHERE id=$1`;
  const row = (await db.query<{ patient_id: string }>(sql, [recordId])).rows[0];
  if (!row || row.patient_id !== patientId)
    throw new CoronaryError(400, "Linked record is not in this patient record");
}
async function sameEncounter(
  db: QueryDB,
  encounterId: string | null,
  patientId: string,
) {
  if (!encounterId) return;
  const row = (
    await db.query(
      "SELECT id FROM care.encounter WHERE id=$1 AND patient_id=$2",
      [encounterId, patientId],
    )
  ).rows[0];
  if (!row)
    throw new CoronaryError(400, "Encounter is not in this patient record");
}

async function projectCoronaryFact(
  db: QueryDB,
  patientId: string,
  conceptCode: string,
  display: string,
  recordId: string,
  observedAt: string,
  encounterId: string | null,
  value:
    | { type: "coded"; code: string; display: string }
    | { type: "json"; value: any },
  actor: string,
  replaceCurrent = false,
) {
  await db.query(
    "INSERT INTO clinical.terminology_concept(system,code,version,display,kind,created_by) VALUES('cardioflow',$1,1,$2,'coronary','system:stage5') ON CONFLICT DO NOTHING",
    [conceptCode, display],
  );
  const prior = replaceCurrent
    ? (
        await db.query<any>(
          `SELECT * FROM clinical.fact WHERE patient_id=$1 AND concept_system='cardioflow'
           AND concept_code=$2 AND lifecycle_status='active' ORDER BY recorded_at DESC LIMIT 1`,
          [patientId, conceptCode],
        )
      ).rows[0]
    : null;
  return recordClinicalFact(
    db,
    patientId,
    {
      logical_id: prior?.logical_id ?? (replaceCurrent ? undefined : recordId),
      concept_system: "cardioflow",
      concept_code: conceptCode,
      concept_version: 1,
      value,
      observed_at: observedAt,
      encounter_id: encounterId,
      source_type: "coronary_record",
      source_id: recordId,
      source_label: display,
      source_quality: "high",
      verification_status: "verified",
      lifecycle_status: "active",
      supersedes_fact_id: prior?.id ?? null,
    },
    actor,
  );
}

const stateBody = z
  .object({
    encounter_id: optionalId,
    state: z.enum(coronaryStates),
    status: z.enum(["CURRENT", "HISTORICAL", "RESOLVED", "UNCERTAIN"]),
    observed_at: dateTime,
    detail: optionalText(2000),
    supersedes_id: optionalId,
  })
  .strict();
const ecgBody = z
  .object({
    encounter_id: optionalId,
    performed_at: dateTime,
    indication: optionalText(),
    rhythm: optionalText(100),
    rate: num(0, 350),
    pr_ms: num(0, 1000),
    qrs_ms: num(0, 1000),
    qtc_ms: num(0, 1000),
    axis_degrees: num(-180, 180),
    st_changes: optionalText(1000),
    t_changes: optionalText(1000),
    pathologic_q_waves: z.boolean().nullable().default(null),
    conduction: optionalText(300),
    pacing: optionalText(300),
    ischemic_interpretation: z
      .enum([
        "ST_ELEVATION",
        "ST_DEPRESSION",
        "OTHER_ISCHEMIC",
        "NO_ACUTE_ISCHEMIA",
        "UNCERTAIN",
      ])
      .default("UNCERTAIN"),
    comparison: optionalText(1000),
    clinician_interpretation: optionalText(2000),
    attachment_reference: optionalText(500),
    source_label: z.string().trim().min(1).max(200),
    status: z.enum(["PRELIMINARY", "FINAL", "ENTERED_IN_ERROR"]),
    supersedes_id: optionalId,
  })
  .strict();
const symptoms = z
  .object({
    chest_discomfort: z.boolean().optional(),
    pressure: z.boolean().optional(),
    exertional: z.boolean().optional(),
    rest: z.boolean().optional(),
    radiation: optionalText(200),
    dyspnoea: z.boolean().optional(),
    diaphoresis: z.boolean().optional(),
    nausea: z.boolean().optional(),
    atypical: optionalText(300),
    duration_minutes: num(0, 100000),
    recurrent: z.boolean().optional(),
  })
  .strict()
  .prefault({});
const acsBody = z
  .object({
    encounter_id: optionalId,
    presented_at: dateTime,
    diagnosis: z.enum(acsDiagnoses),
    diagnosis_status: z.enum(["WORKING", "CONFIRMED", "REVISED"]),
    symptom_onset_at: optionalTime,
    first_medical_contact_at: optionalTime,
    first_ecg_at: optionalTime,
    diagnosis_at: optionalTime,
    cath_activation_at: optionalTime,
    hospital_arrival_at: optionalTime,
    wire_at: optionalTime,
    reperfusion_at: optionalTime,
    symptoms,
    hemodynamics: z
      .object({
        systolic_bp: num(0, 350),
        heart_rate: num(0, 350),
        stable: z.boolean().nullable().default(null),
        shock: z.boolean().nullable().default(null),
        hf: z.boolean().nullable().default(null),
        arrhythmia: optionalText(300),
      })
      .strict()
      .prefault({}),
    risk_context: z
      .object({
        renal: optionalText(300),
        bleeding: optionalText(300),
        risk_score_name: optionalText(100),
        risk_score_value: num(0, 1000),
        score_inputs: z.record(z.string(), z.unknown()).default({}),
        score_missing: z.array(z.string().max(100)).max(30).default([]),
        score_source: optionalText(300),
      })
      .strict()
      .prefault({}),
    clinical_interpretation: optionalText(3000),
    status: z.enum(["ACTIVE", "DISCHARGED", "CLOSED", "ENTERED_IN_ERROR"]),
    supersedes_id: optionalId,
  })
  .strict();
const lesionBody = z
  .object({
    vessel: z.enum(coronaryVessels),
    segment: optionalText(100),
    stenosis_percent: num(0, 100),
    length_mm: num(0, 200),
    culprit_status: z
      .enum([
        "CONFIRMED",
        "PROBABLE",
        "UNCERTAIN",
        "NOT_CULPRIT",
        "NONE_IDENTIFIED",
      ])
      .default("UNCERTAIN"),
    timi_flow: z.number().int().min(0).max(3).nullable().default(null),
    calcification: optionalText(100),
    bifurcation: z.boolean().nullable().default(null),
    thrombus: z.boolean().nullable().default(null),
    tortuosity: z.boolean().nullable().default(null),
    cto: z.boolean().nullable().default(null),
    ostial: z.boolean().nullable().default(null),
    restenosis: z.boolean().nullable().default(null),
    graft_lesion: z.boolean().nullable().default(null),
    comments: optionalText(1000),
  })
  .strict();
const measurement = z
  .object({
    type: z.enum(["FFR", "IFR", "RFR", "OTHER"]),
    vessel: z.enum(coronaryVessels),
    lesion_index: z.number().int().min(0).max(30).nullable().default(null),
    value: num(-10, 100),
    context: optionalText(500),
    measured_at: optionalTime,
  })
  .strict();
const imaging = z
  .object({
    type: z.enum(["IVUS", "OCT"]),
    indication: optionalText(500),
    findings: optionalText(1000),
    lesion_index: z.number().int().min(0).max(30).nullable().default(null),
  })
  .strict();
const angiogramBody = z
  .object({
    encounter_id: optionalId,
    acs_event_id: optionalId,
    performed_at: dateTime,
    indication: z.string().trim().min(1).max(1000),
    access_site: optionalText(100),
    contrast_ml: num(0, 2000),
    operator_name: optionalText(200),
    coronary_dominance: z
      .enum(["RIGHT", "LEFT", "CODOMINANT", "UNKNOWN"])
      .default("UNKNOWN"),
    anatomy_summary: optionalText(3000),
    physiology: z.array(measurement).max(30).default([]),
    intracoronary_imaging: z.array(imaging).max(30).default([]),
    complications: z.array(z.string().max(300)).max(20).default([]),
    conclusion: optionalText(3000),
    plan: optionalText(3000),
    status: z.enum(["DRAFT", "FINAL", "ENTERED_IN_ERROR"]),
    supersedes_id: optionalId,
    lesions: z.array(lesionBody).max(30).default([]),
  })
  .strict();
const stentBody = z
  .object({
    vessel: z.enum(coronaryVessels),
    lesion_id: optionalId,
    model: optionalText(200),
    manufacturer: optionalText(200),
    stent_type: z.enum(["DES", "BMS", "OTHER", "UNKNOWN"]),
    diameter_mm: num(0.1, 20),
    length_mm: num(0.1, 150),
    overlap: z.boolean().default(false),
    implanted_at: optionalTime,
  })
  .strict();
const pciBody = z
  .object({
    encounter_id: optionalId,
    acs_event_id: optionalId,
    angiogram_id: optionalId,
    target_lesion_id: optionalId,
    performed_at: dateTime,
    indication: z.string().trim().min(1).max(1000),
    target_vessel: z.enum(coronaryVessels),
    urgency: z
      .enum(["EMERGENCY", "URGENT", "ELECTIVE", "UNKNOWN"])
      .default("UNKNOWN"),
    access_site: optionalText(100),
    technique: z
      .object({
        guide: optionalText(200),
        wire: optionalText(200),
        predilatation: optionalText(300),
        lesion_preparation: optionalText(300),
        postdilatation: optionalText(300),
      })
      .strict()
      .prefault({}),
    imaging: z.array(imaging).max(30).default([]),
    physiology: z.array(measurement).max(30).default([]),
    procedural_timeline: z
      .array(
        z.object({ at: dateTime, event: z.string().min(1).max(300) }).strict(),
      )
      .max(50)
      .default([]),
    final_timi_flow: z.number().int().min(0).max(3).nullable().default(null),
    contrast_ml: num(0, 2000),
    radiation_gy: num(0, 1000),
    complications: z.array(z.string().max(300)).max(20).default([]),
    result: optionalText(3000),
    residual_disease: optionalText(1000),
    revascularization_status: z
      .enum(["COMPLETE", "INCOMPLETE", "STAGED", "UNKNOWN"])
      .default("UNKNOWN"),
    staged_plan: optionalText(1000),
    status: z.enum(["DRAFT", "FINAL", "ENTERED_IN_ERROR"]),
    supersedes_id: optionalId,
    stents: z.array(stentBody).max(20).default([]),
  })
  .strict();
const planData = z
  .object({
    indication: optionalText(500),
    purpose: optionalText(500),
    assessment: optionalText(2000),
    known: z.array(z.string().max(300)).max(30).default([]),
    missing: z.array(z.string().max(300)).max(30).default([]),
    why_it_matters: optionalText(1000),
    options: z.array(z.string().max(300)).max(20).default([]),
    next_assessment: optionalText(1000),
    evidence_note: optionalText(1000),
    aspirin_therapy_id: optionalId,
    p2y12_therapy_id: optionalId,
    anticoagulant_therapy_id: optionalId,
    combination_start: day.nullable().default(null),
    combination_end: day.nullable().default(null),
    duration_strategy: optionalText(500),
    bleeding_considerations: optionalText(1000),
    ischemic_considerations: optionalText(1000),
    deviation_reason: optionalText(1000),
    switch_reason: optionalText(500),
    complication_type: z.enum(coronaryComplications).nullable().default(null),
    severity: z
      .enum(["LOW", "MODERATE", "HIGH", "CRITICAL", "UNCERTAIN"])
      .nullable()
      .default(null),
    symptoms: optionalText(1000),
    mechanism: optionalText(500),
    rehabilitation_status: z
      .enum([
        "ELIGIBILITY_REVIEW",
        "REFERRED",
        "PLANNED",
        "PARTICIPATING",
        "COMPLETED",
        "DECLINED",
        "BARRIER",
        "UNKNOWN",
      ])
      .nullable()
      .default(null),
    start_date: day.nullable().default(null),
    barrier: optionalText(500),
    discharge_readiness: z
      .record(
        z.string(),
        z.enum(["DONE", "PENDING", "NOT_APPLICABLE", "UNKNOWN"]),
      )
      .default({}),
    lpa_unit: z.enum(["mg/dL", "nmol/L"]).nullable().default(null),
    smoking_status: z
      .enum(["current", "former", "never", "unknown"])
      .nullable()
      .default(null),
    follow_up_purpose: optionalText(500),
    responsible_team: optionalText(200),
  })
  .strict();
const planBody = z
  .object({
    encounter_id: optionalId,
    acs_event_id: optionalId,
    category: z.enum(coronaryPlanCategories),
    plan_key: z.string().trim().min(1).max(100),
    observed_at: dateTime,
    status: z.enum([
      "ACTIVE",
      "COMPLETED",
      "SUPERSEDED",
      "UNCERTAIN",
      "ENTERED_IN_ERROR",
    ]),
    data: planData.prefault({}),
    review_date: day.nullable().default(null),
    supersedes_id: optionalId,
    reason: optionalText(1000),
  })
  .strict();

async function task(
  db: QueryDB,
  input: {
    patientId: string;
    encounterId: string | null;
    purpose: string;
    date: string | null;
    sourceType: string;
    sourceId: string;
    actor: string;
    kind?: string;
  },
) {
  const taskId = randomUUID();
  await db.query(
    `INSERT INTO workflow.clinical_task(id,patient_id,encounter_id,kind,purpose,related_concept,target_date,assigned_to,source_type,source_id,details,created_by) VALUES($1,$2,$3,$4,$5,'coronary.care',$6,$7,$8,$9,'{}',$10)`,
    [
      taskId,
      input.patientId,
      input.encounterId,
      input.kind ?? "clinical_review",
      input.purpose,
      input.date,
      input.actor,
      input.sourceType,
      input.sourceId,
      input.actor,
    ],
  );
  await db.query(
    "INSERT INTO workflow.clinical_task_event(id,task_id,version,status,note,actor) VALUES($1,$2,1,'open','',$3)",
    [randomUUID(), taskId, input.actor],
  );
  return taskId;
}
async function supersedeTask(
  db: QueryDB,
  taskId: string | null,
  actor: string,
) {
  if (!taskId) return;
  const current = (
    await db.query<{ version: number; status: string }>(
      "SELECT version,status FROM workflow.clinical_task_event WHERE task_id=$1 ORDER BY version DESC LIMIT 1",
      [taskId],
    )
  ).rows[0];
  if (
    !current ||
    ["completed", "cancelled", "superseded"].includes(current.status)
  )
    return;
  await db.query(
    "INSERT INTO workflow.clinical_task_event(id,task_id,version,status,note,actor) VALUES($1,$2,$3,'superseded','New coronary information requires reassessment',$4)",
    [randomUUID(), taskId, current.version + 1, actor],
  );
}

export async function loadCoronaryRecord(db: QueryDB, patientId: string) {
  await patient(db, patientId);
  const [
    states,
    ecgs,
    acsEvents,
    angiograms,
    pcis,
    plans,
    labs,
    medications,
    hf,
    valves,
    rehab,
    tasks,
    echoes,
    legacy,
  ] = await Promise.all([
    db.query<any>(
      "SELECT * FROM coronary.state_event WHERE patient_id=$1 ORDER BY observed_at DESC,created_at DESC",
      [patientId],
    ),
    db.query<any>(
      "SELECT * FROM clinical.ecg WHERE patient_id=$1 AND NOT EXISTS(SELECT 1 FROM clinical.ecg newer WHERE newer.supersedes_id=clinical.ecg.id) ORDER BY performed_at DESC",
      [patientId],
    ),
    db.query<any>(
      "SELECT * FROM coronary.acs_event WHERE patient_id=$1 AND NOT EXISTS(SELECT 1 FROM coronary.acs_event newer WHERE newer.supersedes_id=coronary.acs_event.id) ORDER BY presented_at DESC",
      [patientId],
    ),
    db.query<any>(
      "SELECT * FROM coronary.angiogram WHERE patient_id=$1 AND NOT EXISTS(SELECT 1 FROM coronary.angiogram newer WHERE newer.supersedes_id=coronary.angiogram.id) ORDER BY performed_at DESC",
      [patientId],
    ),
    db.query<any>(
      "SELECT * FROM coronary.pci WHERE patient_id=$1 AND NOT EXISTS(SELECT 1 FROM coronary.pci newer WHERE newer.supersedes_id=coronary.pci.id) ORDER BY performed_at DESC",
      [patientId],
    ),
    db.query<any>(
      "SELECT * FROM coronary.plan_event WHERE patient_id=$1 ORDER BY observed_at DESC,created_at DESC",
      [patientId],
    ),
    db.query<any>(
      "SELECT r.*,d.display FROM laboratory.result r JOIN laboratory.test_definition d ON d.test_id=r.test_id AND d.version=r.test_version WHERE r.patient_id=$1 AND r.verification_status<>'entered_in_error' AND NOT EXISTS(SELECT 1 FROM laboratory.result newer WHERE newer.logical_id=r.logical_id AND newer.version>r.version) ORDER BY r.collected_at DESC",
      [patientId],
    ),
    db.query<any>(
      "SELECT t.*,d.generic_name FROM medication.current_therapy t JOIN medication.generic_definition d ON d.medication_id=t.medication_id AND d.version=t.medication_version WHERE t.patient_id=$1 AND t.status IN ('ACTIVE','TEMPORARILY_HELD','PLANNED') ORDER BY d.generic_name",
      [patientId],
    ),
    db.query<any>("SELECT * FROM heart_failure.profile WHERE patient_id=$1", [
      patientId,
    ]),
    db.query<any>("SELECT * FROM valve.current_state WHERE patient_id=$1", [
      patientId,
    ]),
    db.query<any>(
      "SELECT r.* FROM heart_failure.current_rehabilitation r JOIN heart_failure.profile p ON p.id=r.profile_id WHERE p.patient_id=$1",
      [patientId],
    ),
    db.query<any>(
      "SELECT t.*,e.status current_status FROM workflow.clinical_task t LEFT JOIN workflow.clinical_task_event e ON e.task_id=t.id AND e.version=(SELECT max(v.version) FROM workflow.clinical_task_event v WHERE v.task_id=t.id) WHERE t.patient_id=$1 AND t.source_type LIKE 'coronary_%' ORDER BY t.target_date NULLS LAST,t.created_at DESC",
      [patientId],
    ),
    loadEchoStudies(db, patientId),
    db.query<any>(
      "SELECT ep.*,en.crf FROM clinical.episode ep JOIN registry.enrollment en ON en.id=ep.enrollment_id WHERE en.patient_id=$1 AND en.registry_key='CAD' ORDER BY ep.admission_date DESC",
      [patientId],
    ),
  ]);
  for (const angiogram of angiograms.rows)
    angiogram.lesions = (
      await db.query(
        "SELECT * FROM coronary.lesion WHERE angiogram_id=$1 ORDER BY created_at,id",
        [angiogram.id],
      )
    ).rows;
  for (const pci of pcis.rows)
    pci.stents = (
      await db.query(
        "SELECT * FROM coronary.stent WHERE pci_id=$1 ORDER BY created_at,id",
        [pci.id],
      )
    ).rows;
  const currentPlans = plans.rows.filter(
    (p: any) =>
      ["ACTIVE", "UNCERTAIN"].includes(p.status) &&
      !plans.rows.some((n: any) => n.supersedes_id === p.id),
  );
  const currentState =
    states.rows.find(
      (s: any) =>
        s.status === "CURRENT" &&
        !states.rows.some((n: any) => n.supersedes_id === s.id),
    ) ?? null;
  const troponins = labs.rows
    .filter((r: any) => /troponin|hs.?ctn/i.test(`${r.test_id} ${r.display}`))
    .sort(
      (a: any, b: any) =>
        new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime(),
    );
  const lipids = labs.rows.filter((r: any) =>
    /ldl|non.?hdl|apob|triglyceride|lipoprotein.?a|lp\(?a\)?/i.test(
      `${r.test_id} ${r.display}`,
    ),
  );
  const latestEcho = preferredEchoStudy(echoes);
  const registryProjection: Record<
    string,
    { value: unknown; source: string; observed_at: string }
  > = {};
  const acs = acsEvents.rows[0],
    angio = angiograms.rows[0],
    pci = pcis.rows[0];
  if (acs) {
    registryProjection.presentation = {
      value: acs.diagnosis,
      source: `coronary.acs_event:${acs.id}`,
      observed_at: acs.presented_at,
    };
    registryProjection.admission_date = {
      value: new Date(acs.presented_at).toISOString().slice(0, 10),
      source: `coronary.acs_event:${acs.id}`,
      observed_at: acs.presented_at,
    };
  }
  if (angio) {
    registryProjection.access_site = {
      value: angio.access_site,
      source: `coronary.angiogram:${angio.id}`,
      observed_at: angio.performed_at,
    };
    registryProjection.angiography = {
      value: angio.conclusion,
      source: `coronary.angiogram:${angio.id}`,
      observed_at: angio.performed_at,
    };
    registryProjection.lesions = {
      value: angio.lesions.map((l: any) => ({
        vessel: l.vessel,
        segment: l.segment,
        stenosis_percent: l.stenosis_percent,
        culprit_status: l.culprit_status,
      })),
      source: `coronary.angiogram:${angio.id}`,
      observed_at: angio.performed_at,
    };
  }
  if (pci) {
    registryProjection.management = {
      value: "PCI",
      source: `coronary.pci:${pci.id}`,
      observed_at: pci.performed_at,
    };
    registryProjection.stents = {
      value: pci.stents.map((s: any) => ({
        vessel: s.vessel,
        type: s.stent_type,
        diameter_mm: s.diameter_mm,
        length_mm: s.length_mm,
      })),
      source: `coronary.pci:${pci.id}`,
      observed_at: pci.performed_at,
    };
  }
  const medicationProjection = medications.rows.filter((m: any) =>
    /aspirin|clopidogrel|ticagrelor|prasugrel|atorvastatin|rosuvastatin|ezetimibe/i.test(
      `${m.medication_id} ${m.generic_name}`,
    ),
  );
  if (medicationProjection.length)
    registryProjection.discharge_medications = {
      value: medicationProjection.map((m: any) => ({
        name: m.generic_name,
        status: m.status,
      })),
      source: "medication.current_therapy",
      observed_at: medicationProjection[0].effective_at,
    };
  const latestAntithrombotic = currentPlans.find(
    (p: any) => p.category === "ANTITHROMBOTIC",
  );
  const rehabPlan = currentPlans.find(
    (p: any) => p.category === "REHABILITATION",
  );
  const preventionPlan = currentPlans.find(
    (p: any) => p.category === "PREVENTION",
  );
  const activeACS = acsEvents.rows.find((a: any) => a.status === "ACTIVE");
  const reviewItems: string[] = [];
  if ((activeACS || pci) && !latestAntithrombotic)
    reviewItems.push("Document a dated antithrombotic review plan");
  if (latestAntithrombotic?.status === "UNCERTAIN")
    reviewItems.push(
      "Reassess the antithrombotic plan after new clinical information",
    );
  if ((activeACS || pci) && !rehabPlan && !rehab.rows[0])
    reviewItems.push("Review cardiac rehabilitation referral");
  if ((activeACS || pci) && !preventionPlan)
    reviewItems.push("Document coronary secondary prevention review");
  if (activeACS && !ecgs.rows[0])
    reviewItems.push("Review and document an ECG");
  if (activeACS && !troponins.length)
    reviewItems.push(
      "Review assay-specific serial troponin results when relevant",
    );
  if (
    pci?.staged_plan &&
    !currentPlans.some((p: any) => p.category === "REVASCULARIZATION")
  )
    reviewItems.push("Confirm the staged revascularization plan");
  if (
    valves.rows.some((v: any) => v.severity === "SEVERE") &&
    (activeACS || angio)
  )
    reviewItems.push("Coordinate coronary and severe valve procedure planning");
  if (hf.rows[0] && (activeACS || pci))
    reviewItems.push("Coordinate coronary care with the existing HF plan");
  const registrySections = {
    presentation: !!acs,
    angiography: !!angio,
    pci: !!pci,
    medications: !!medicationProjection.length,
  };
  return {
    states: states.rows,
    currentState,
    ecgs: ecgs.rows,
    acsEvents: acsEvents.rows,
    angiograms: angiograms.rows,
    pcis: pcis.rows,
    plans: plans.rows,
    currentPlans,
    troponins,
    lipids,
    medications: medications.rows,
    latestEcho,
    hfProfile: hf.rows[0] ?? null,
    valveStates: valves.rows,
    rehabilitation: rehab.rows[0] ?? null,
    tasks: tasks.rows,
    registryProjection,
    registrySections,
    reviewItems: reviewItems.slice(0, 7),
    legacyCadEpisodes: legacy.rows,
    evidence: coronaryEvidence,
  };
}

async function reassessment(
  db: QueryDB,
  patientId: string,
  encounterId: string | null,
  actor: string,
  sourceId: string,
  reason: string,
) {
  const recent = (
    await db.query<{ id: string }>(
      "SELECT id FROM workflow.clinical_task WHERE patient_id=$1 AND source_type='coronary_reassessment' AND source_id=$2 LIMIT 1",
      [patientId, sourceId],
    )
  ).rows[0];
  if (recent) return;
  await task(db, {
    patientId,
    encounterId,
    purpose: `Coronary care review: ${reason}`,
    date: null,
    sourceType: "coronary_reassessment",
    sourceId,
    actor,
  });
}

export function mountCoronary(
  app: Express,
  db: DB,
  read: RequestHandler,
  write: RequestHandler,
) {
  app.get("/api/patients/:id/coronary", read, async (req, res) =>
    res.json(await loadCoronaryRecord(db, String(req.params.id))),
  );
  app.post("/api/patients/:id/coronary/state", write, async (req, res) => {
    const input = stateBody.parse(req.body),
      patientId = String(req.params.id),
      actor = res.locals.session.actor,
      recordId = randomUUID();
    await db.transaction(async (tx) => {
      await patient(tx, patientId);
      await sameEncounter(tx, input.encounter_id, patientId);
      await samePatient(tx, "state_event", input.supersedes_id, patientId);
      const previous =
        input.status === "CURRENT" && !input.supersedes_id
          ? (
              await tx.query<{ id: string }>(
                "SELECT s.id FROM coronary.state_event s WHERE s.patient_id=$1 AND s.status='CURRENT' AND NOT EXISTS(SELECT 1 FROM coronary.state_event n WHERE n.supersedes_id=s.id) ORDER BY s.observed_at DESC,s.created_at DESC LIMIT 1",
                [patientId],
              )
            ).rows[0]
          : null;
      await tx.query(
        "INSERT INTO coronary.state_event(id,patient_id,encounter_id,state,status,observed_at,detail,source_type,source_id,supersedes_id,author) VALUES($1,$2,$3,$4,$5,$6,$7,'clinician',$8,$9,$10)",
        [
          recordId,
          patientId,
          input.encounter_id,
          input.state,
          input.status,
          input.observed_at,
          input.detail,
          recordId,
          input.supersedes_id ?? previous?.id ?? null,
          actor,
        ],
      );
      if (input.status === "CURRENT")
        await projectCoronaryFact(
          tx,
          patientId,
          "coronary.current_state",
          "Current coronary state",
          recordId,
          input.observed_at,
          input.encounter_id,
          {
            type: "coded",
            code: input.state,
            display: input.state.replaceAll("_", " "),
          },
          actor,
          true,
        );
      await audit(
        tx,
        actor,
        "Coronary state recorded",
        "coronary_state",
        recordId,
        patientId,
        { state: input.state, status: input.status },
      );
    });
    res.status(201).json({ id: recordId });
  });
  app.post("/api/patients/:id/coronary/ecg", write, async (req, res) => {
    const input = ecgBody.parse(req.body),
      patientId = String(req.params.id),
      actor = res.locals.session.actor,
      recordId = randomUUID();
    await db.transaction(async (tx) => {
      await patient(tx, patientId);
      await sameEncounter(tx, input.encounter_id, patientId);
      await samePatient(tx, "ecg", input.supersedes_id, patientId);
      await tx.query(
        `INSERT INTO clinical.ecg(id,patient_id,encounter_id,performed_at,indication,rhythm,rate,pr_ms,qrs_ms,qtc_ms,axis_degrees,st_changes,t_changes,pathologic_q_waves,conduction,pacing,ischemic_interpretation,comparison,clinician_interpretation,attachment_reference,source_label,status,supersedes_id,author) VALUES(${Array.from({ length: 24 }, (_, i) => `$${i + 1}`).join(",")})`,
        [
          recordId,
          patientId,
          input.encounter_id,
          input.performed_at,
          input.indication,
          input.rhythm,
          input.rate,
          input.pr_ms,
          input.qrs_ms,
          input.qtc_ms,
          input.axis_degrees,
          input.st_changes,
          input.t_changes,
          input.pathologic_q_waves,
          input.conduction,
          input.pacing,
          input.ischemic_interpretation,
          input.comparison,
          input.clinician_interpretation,
          input.attachment_reference,
          input.source_label,
          input.status,
          input.supersedes_id,
          actor,
        ],
      );
      await audit(
        tx,
        actor,
        "ECG recorded",
        "coronary_ecg",
        recordId,
        patientId,
        { status: input.status },
      );
      if (input.status === "FINAL") {
        await projectCoronaryFact(
          tx,
          patientId,
          "ecg.current_interpretation",
          "Current clinician ECG interpretation",
          recordId,
          input.performed_at,
          input.encounter_id,
          {
            type: "json",
            value: {
              rhythm: input.rhythm,
              rate: input.rate,
              ischemicInterpretation: input.ischemic_interpretation,
              clinicianInterpretation: input.clinician_interpretation,
              ecgId: recordId,
            },
          },
          actor,
          true,
        );
        await reassessment(
          tx,
          patientId,
          input.encounter_id,
          actor,
          recordId,
          "new ECG interpretation",
        );
      }
    });
    res.status(201).json({ id: recordId });
  });
  app.post("/api/patients/:id/coronary/acs", write, async (req, res) => {
    const input = acsBody.parse(req.body),
      patientId = String(req.params.id),
      actor = res.locals.session.actor,
      recordId = randomUUID();
    await db.transaction(async (tx) => {
      await patient(tx, patientId);
      await sameEncounter(tx, input.encounter_id, patientId);
      await samePatient(tx, "acs_event", input.supersedes_id, patientId);
      await tx.query(
        `INSERT INTO coronary.acs_event(id,patient_id,encounter_id,presented_at,diagnosis,diagnosis_status,symptom_onset_at,first_medical_contact_at,first_ecg_at,diagnosis_at,cath_activation_at,hospital_arrival_at,wire_at,reperfusion_at,symptoms,hemodynamics,risk_context,clinical_interpretation,status,supersedes_id,author) VALUES(${Array.from({ length: 21 }, (_, i) => `$${i + 1}`).join(",")})`,
        [
          recordId,
          patientId,
          input.encounter_id,
          input.presented_at,
          input.diagnosis,
          input.diagnosis_status,
          input.symptom_onset_at,
          input.first_medical_contact_at,
          input.first_ecg_at,
          input.diagnosis_at,
          input.cath_activation_at,
          input.hospital_arrival_at,
          input.wire_at,
          input.reperfusion_at,
          json(input.symptoms),
          json(input.hemodynamics),
          json(input.risk_context),
          input.clinical_interpretation,
          input.status,
          input.supersedes_id,
          actor,
        ],
      );
      const previousState = (
        await tx.query<{ id: string }>(
          "SELECT s.id FROM coronary.state_event s WHERE s.patient_id=$1 AND s.status='CURRENT' AND NOT EXISTS(SELECT 1 FROM coronary.state_event n WHERE n.supersedes_id=s.id) ORDER BY s.observed_at DESC,s.created_at DESC LIMIT 1",
          [patientId],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO coronary.state_event(id,patient_id,encounter_id,state,status,observed_at,detail,source_type,source_id,supersedes_id,author) VALUES($1,$2,$3,$4,'CURRENT',$5,$6,'acs_event',$7,$8,$9)",
        [
          randomUUID(),
          patientId,
          input.encounter_id,
          input.status === "ACTIVE" ? "CURRENT_ACS" : "POST_ACS",
          input.presented_at,
          input.diagnosis,
          "" + recordId,
          previousState?.id ?? null,
          actor,
        ],
      );
      await projectCoronaryFact(
        tx,
        patientId,
        "coronary.current_state",
        "Current coronary state",
        recordId,
        input.presented_at,
        input.encounter_id,
        {
          type: "coded",
          code: input.status === "ACTIVE" ? "CURRENT_ACS" : "POST_ACS",
          display: input.status === "ACTIVE" ? "Current ACS" : "Post ACS",
        },
        actor,
        true,
      );
      await projectCoronaryFact(
        tx,
        patientId,
        "coronary.latest_acs",
        "Latest ACS event",
        recordId,
        input.presented_at,
        input.encounter_id,
        {
          type: "json",
          value: {
            acsEventId: recordId,
            diagnosis: input.diagnosis,
            diagnosisStatus: input.diagnosis_status,
            status: input.status,
            presentedAt: input.presented_at,
          },
        },
        actor,
        true,
      );
      await audit(
        tx,
        actor,
        "ACS event recorded",
        "coronary_acs",
        recordId,
        patientId,
        { diagnosis: input.diagnosis, status: input.status },
      );
      await reassessment(
        tx,
        patientId,
        input.encounter_id,
        actor,
        recordId,
        "ACS presentation or status changed",
      );
    });
    res.status(201).json({ id: recordId });
  });
  app.post("/api/patients/:id/coronary/angiograms", write, async (req, res) => {
    const input = angiogramBody.parse(req.body),
      patientId = String(req.params.id),
      actor = res.locals.session.actor,
      recordId = randomUUID();
    await db.transaction(async (tx) => {
      await patient(tx, patientId);
      await sameEncounter(tx, input.encounter_id, patientId);
      await samePatient(tx, "acs_event", input.acs_event_id, patientId);
      await samePatient(tx, "angiogram", input.supersedes_id, patientId);
      await tx.query(
        `INSERT INTO coronary.angiogram(id,patient_id,encounter_id,acs_event_id,performed_at,indication,access_site,contrast_ml,operator_name,coronary_dominance,anatomy_summary,physiology,intracoronary_imaging,complications,conclusion,plan,status,supersedes_id,author) VALUES(${Array.from({ length: 19 }, (_, i) => `$${i + 1}`).join(",")})`,
        [
          recordId,
          patientId,
          input.encounter_id,
          input.acs_event_id,
          input.performed_at,
          input.indication,
          input.access_site,
          input.contrast_ml,
          input.operator_name,
          input.coronary_dominance,
          input.anatomy_summary,
          json(input.physiology),
          json(input.intracoronary_imaging),
          json(input.complications),
          input.conclusion,
          input.plan,
          input.status,
          input.supersedes_id,
          actor,
        ],
      );
      for (const lesion of input.lesions)
        await tx.query(
          `INSERT INTO coronary.lesion(id,angiogram_id,vessel,segment,stenosis_percent,length_mm,culprit_status,timi_flow,calcification,bifurcation,thrombus,tortuosity,cto,ostial,restenosis,graft_lesion,comments) VALUES(${Array.from({ length: 17 }, (_, i) => `$${i + 1}`).join(",")})`,
          [
            randomUUID(),
            recordId,
            lesion.vessel,
            lesion.segment,
            lesion.stenosis_percent,
            lesion.length_mm,
            lesion.culprit_status,
            lesion.timi_flow,
            lesion.calcification,
            lesion.bifurcation,
            lesion.thrombus,
            lesion.tortuosity,
            lesion.cto,
            lesion.ostial,
            lesion.restenosis,
            lesion.graft_lesion,
            lesion.comments,
          ],
        );
      await audit(
        tx,
        actor,
        "Coronary angiogram recorded",
        "coronary_angiogram",
        recordId,
        patientId,
        { lesionCount: input.lesions.length, status: input.status },
      );
      if (input.status === "FINAL") {
        await projectCoronaryFact(
          tx,
          patientId,
          "coronary.current_anatomy",
          "Current coronary anatomy",
          recordId,
          input.performed_at,
          input.encounter_id,
          {
            type: "json",
            value: {
              angiogramId: recordId,
              conclusion: input.conclusion,
              anatomySummary: input.anatomy_summary,
              lesions: input.lesions.map((l) => ({
                vessel: l.vessel,
                segment: l.segment,
                stenosisPercent: l.stenosis_percent,
                culpritStatus: l.culprit_status,
              })),
            },
          },
          actor,
          true,
        );
        await reassessment(
          tx,
          patientId,
          input.encounter_id,
          actor,
          recordId,
          "coronary anatomy documented",
        );
      }
    });
    res.status(201).json({ id: recordId });
  });
  app.post("/api/patients/:id/coronary/pcis", write, async (req, res) => {
    const input = pciBody.parse(req.body),
      patientId = String(req.params.id),
      actor = res.locals.session.actor,
      recordId = randomUUID();
    await db.transaction(async (tx) => {
      await patient(tx, patientId);
      await sameEncounter(tx, input.encounter_id, patientId);
      await samePatient(tx, "acs_event", input.acs_event_id, patientId);
      await samePatient(tx, "angiogram", input.angiogram_id, patientId);
      await samePatient(tx, "lesion", input.target_lesion_id, patientId);
      await samePatient(tx, "pci", input.supersedes_id, patientId);
      if (input.target_lesion_id && !input.angiogram_id)
        throw new CoronaryError(400, "A target lesion requires its angiogram");
      if (input.target_lesion_id) {
        const row = (
          await tx.query<{ angiogram_id: string }>(
            "SELECT angiogram_id FROM coronary.lesion WHERE id=$1",
            [input.target_lesion_id],
          )
        ).rows[0];
        if (row?.angiogram_id !== input.angiogram_id)
          throw new CoronaryError(
            400,
            "Target lesion belongs to another angiogram",
          );
      }
      await tx.query(
        `INSERT INTO coronary.pci(id,patient_id,encounter_id,acs_event_id,angiogram_id,target_lesion_id,performed_at,indication,target_vessel,urgency,access_site,technique,imaging,physiology,procedural_timeline,final_timi_flow,contrast_ml,radiation_gy,complications,result,residual_disease,revascularization_status,staged_plan,status,supersedes_id,author) VALUES(${Array.from({ length: 26 }, (_, i) => `$${i + 1}`).join(",")})`,
        [
          recordId,
          patientId,
          input.encounter_id,
          input.acs_event_id,
          input.angiogram_id,
          input.target_lesion_id,
          input.performed_at,
          input.indication,
          input.target_vessel,
          input.urgency,
          input.access_site,
          json(input.technique),
          json(input.imaging),
          json(input.physiology),
          json(input.procedural_timeline),
          input.final_timi_flow,
          input.contrast_ml,
          input.radiation_gy,
          json(input.complications),
          input.result,
          input.residual_disease,
          input.revascularization_status,
          input.staged_plan,
          input.status,
          input.supersedes_id,
          actor,
        ],
      );
      for (const stent of input.stents) {
        await samePatient(tx, "lesion", stent.lesion_id, patientId);
        if (stent.lesion_id) {
          const row = (
            await tx.query<{ angiogram_id: string }>(
              "SELECT angiogram_id FROM coronary.lesion WHERE id=$1",
              [stent.lesion_id],
            )
          ).rows[0];
          if (row?.angiogram_id !== input.angiogram_id)
            throw new CoronaryError(
              400,
              "Stent lesion belongs to another angiogram",
            );
        }
        await tx.query(
          "INSERT INTO coronary.stent(id,pci_id,lesion_id,vessel,model,manufacturer,stent_type,diameter_mm,length_mm,overlap,implanted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            randomUUID(),
            recordId,
            stent.lesion_id,
            stent.vessel,
            stent.model,
            stent.manufacturer,
            stent.stent_type,
            stent.diameter_mm,
            stent.length_mm,
            stent.overlap,
            stent.implanted_at,
          ],
        );
      }
      await audit(
        tx,
        actor,
        "PCI recorded",
        "coronary_pci",
        recordId,
        patientId,
        { stents: input.stents.length, status: input.status },
      );
      if (input.status === "FINAL") {
        await tx.query(
          "INSERT INTO coronary.state_event(id,patient_id,encounter_id,state,status,observed_at,detail,source_type,source_id,author) VALUES($1,$2,$3,'PREVIOUS_PCI','HISTORICAL',$4,$5,'pci',$6,$7)",
          [
            randomUUID(),
            patientId,
            input.encounter_id,
            input.performed_at,
            input.target_vessel,
            recordId,
            actor,
          ],
        );
        await projectCoronaryFact(
          tx,
          patientId,
          "coronary.latest_pci",
          "Latest PCI",
          recordId,
          input.performed_at,
          input.encounter_id,
          {
            type: "json",
            value: {
              pciId: recordId,
              acsEventId: input.acs_event_id,
              targetVessel: input.target_vessel,
              stents: input.stents.map((s) => ({
                vessel: s.vessel,
                type: s.stent_type,
                diameterMm: s.diameter_mm,
                lengthMm: s.length_mm,
              })),
              residualDisease: input.residual_disease,
              revascularizationStatus: input.revascularization_status,
              stagedPlan: input.staged_plan,
            },
          },
          actor,
          true,
        );
        await reassessment(
          tx,
          patientId,
          input.encounter_id,
          actor,
          recordId,
          "PCI, antithrombotic and residual disease review",
        );
        if (input.staged_plan)
          await task(tx, {
            patientId,
            encounterId: input.encounter_id,
            purpose: `Review staged revascularization: ${input.staged_plan}`,
            date: null,
            sourceType: "coronary_staged_pci",
            sourceId: recordId,
            actor,
            kind: "follow_up",
          });
      }
    });
    res.status(201).json({ id: recordId });
  });
  app.post("/api/patients/:id/coronary/plans", write, async (req, res) => {
    const input = planBody.parse(req.body),
      patientId = String(req.params.id),
      actor = res.locals.session.actor,
      recordId = randomUUID();
    await db.transaction(async (tx) => {
      await patient(tx, patientId);
      await sameEncounter(tx, input.encounter_id, patientId);
      await samePatient(tx, "acs_event", input.acs_event_id, patientId);
      await samePatient(tx, "plan_event", input.supersedes_id, patientId);
      if (input.category === "ANTITHROMBOTIC" && !input.review_date)
        throw new CoronaryError(
          400,
          "Antithrombotic plans require a dated review",
        );
      if (input.category === "COMPLICATION" && !input.data.complication_type)
        throw new CoronaryError(400, "Choose a complication type");
      if (
        input.category === "REHABILITATION" &&
        !input.data.rehabilitation_status
      )
        throw new CoronaryError(400, "Choose a rehabilitation status");
      for (const therapyId of [
        input.data.aspirin_therapy_id,
        input.data.p2y12_therapy_id,
        input.data.anticoagulant_therapy_id,
      ])
        if (therapyId) {
          const row = (
            await tx.query(
              "SELECT id FROM medication.therapy WHERE id=$1 AND patient_id=$2",
              [therapyId, patientId],
            )
          ).rows[0];
          if (!row)
            throw new CoronaryError(
              400,
              "Medication link is not in this patient record",
            );
        }
      const latest = (
        await tx.query<any>(
          "SELECT * FROM coronary.plan_event WHERE patient_id=$1 AND category=$2 AND plan_key=$3 ORDER BY created_at DESC LIMIT 1",
          [patientId, input.category, input.plan_key],
        )
      ).rows[0];
      if (latest && input.supersedes_id !== latest.id)
        throw new CoronaryError(
          409,
          "Plan changed. Reload and supersede the current version.",
        );
      if (input.supersedes_id && (!latest || latest.id !== input.supersedes_id))
        throw new CoronaryError(409, "Only the current plan can be superseded");
      const taskId =
        input.review_date && input.status === "ACTIVE"
          ? await task(tx, {
              patientId,
              encounterId: input.encounter_id,
              purpose: `${input.category.toLowerCase().replaceAll("_", " ")} review: ${input.data.purpose || input.plan_key}`,
              date: input.review_date,
              sourceType: `coronary_${input.category.toLowerCase()}`,
              sourceId: recordId,
              actor,
              kind: "follow_up",
            })
          : null;
      await tx.query(
        "INSERT INTO coronary.plan_event(id,patient_id,encounter_id,acs_event_id,category,plan_key,observed_at,status,data,review_date,task_id,supersedes_id,reason,author) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [
          recordId,
          patientId,
          input.encounter_id,
          input.acs_event_id,
          input.category,
          input.plan_key,
          input.observed_at,
          input.status,
          json(input.data),
          input.review_date,
          taskId,
          input.supersedes_id,
          input.reason,
          actor,
        ],
      );
      if (input.status !== "ENTERED_IN_ERROR")
        await projectCoronaryFact(
          tx,
          patientId,
          `coronary.plan.${input.category.toLowerCase()}`,
          `${input.category.replaceAll("_", " ")} coronary plan`,
          recordId,
          input.observed_at,
          input.encounter_id,
          {
            type: "json",
            value: {
              planId: recordId,
              category: input.category,
              key: input.plan_key,
              status: input.status,
              reviewDate: input.review_date,
              data: input.data,
              reason: input.reason,
            },
          },
          actor,
          true,
        );
      await supersedeTask(tx, latest?.task_id ?? null, actor);
      await audit(
        tx,
        actor,
        "Coronary plan recorded",
        "coronary_plan",
        recordId,
        patientId,
        { category: input.category, supersedes: input.supersedes_id },
      );
      if (input.category === "COMPLICATION") {
        await reassessment(
          tx,
          patientId,
          input.encounter_id,
          actor,
          recordId,
          `${input.data.complication_type} affects coronary care`,
        );
        if (
          [
            "MAJOR_BLEEDING",
            "ACCESS_BLEEDING",
            "RETROPERITONEAL_BLEEDING_CONCERN",
            "STENT_THROMBOSIS_CONCERN",
          ].includes(input.data.complication_type ?? "")
        ) {
          const antithrombotic = (
            await tx.query<any>(
              "SELECT * FROM coronary.plan_event p WHERE p.patient_id=$1 AND p.category='ANTITHROMBOTIC' AND p.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM coronary.plan_event n WHERE n.supersedes_id=p.id) ORDER BY p.created_at DESC LIMIT 1",
              [patientId],
            )
          ).rows[0];
          if (antithrombotic) {
            await supersedeTask(tx, antithrombotic.task_id, actor);
            const reviewId = randomUUID();
            await tx.query(
              "INSERT INTO coronary.plan_event(id,patient_id,encounter_id,acs_event_id,category,plan_key,observed_at,status,data,review_date,supersedes_id,reason,author) VALUES($1,$2,$3,$4,'ANTITHROMBOTIC',$5,$6,'UNCERTAIN',$7,NULL,$8,$9,$10)",
              [
                reviewId,
                patientId,
                input.encounter_id,
                input.acs_event_id,
                antithrombotic.plan_key,
                input.observed_at,
                json({
                  previous_plan_id: antithrombotic.id,
                  trigger_complication_id: recordId,
                  missing: [
                    "Clinician reassessment of antithrombotic strategy",
                  ],
                  next_assessment:
                    "Review the existing antithrombotic plan in light of the new complication",
                }),
                antithrombotic.id,
                `${input.data.complication_type} requires reassessment; no medication was automatically changed`,
                actor,
              ],
            );
            await projectCoronaryFact(
              tx,
              patientId,
              "coronary.plan.antithrombotic",
              "ANTITHROMBOTIC coronary plan",
              reviewId,
              input.observed_at,
              input.encounter_id,
              {
                type: "json",
                value: {
                  planId: reviewId,
                  category: "ANTITHROMBOTIC",
                  key: antithrombotic.plan_key,
                  status: "UNCERTAIN",
                  reviewDate: null,
                  data: {
                    previousPlanId: antithrombotic.id,
                    triggerComplicationId: recordId,
                  },
                  reason: `${input.data.complication_type} requires reassessment; no medication was automatically changed`,
                },
              },
              actor,
              true,
            );
            await task(tx, {
              patientId,
              encounterId: input.encounter_id,
              purpose:
                "Reassess antithrombotic plan after coronary complication",
              date: null,
              sourceType: "coronary_antithrombotic_reassessment",
              sourceId: reviewId,
              actor,
            });
          }
        }
      }
    });
    res.status(201).json({ id: recordId });
  });
  app.get("/api/patients/:id/coronary/report/:kind", read, async (req, res) => {
    const kind = String(req.params.kind);
    if (
      ![
        "acs-admission",
        "angiography",
        "pci",
        "acs-progress",
        "acs-discharge",
        "cad-follow-up",
      ].includes(kind)
    )
      throw new CoronaryError(404, "Report type not found");
    const record = await loadCoronaryRecord(db, String(req.params.id));
    const acs = record.acsEvents[0],
      angio = record.angiograms[0],
      pci = record.pcis[0];
    const lines = [
      "DRAFT — clinician review and finalization required",
      `Patient coronary record · ${kind.replaceAll("-", " ")}`,
    ];
    if (acs)
      lines.push(
        `Presentation: ${acs.presented_at} · ${acs.diagnosis} (${acs.diagnosis_status})`,
        acs.clinical_interpretation || "",
      );
    if (record.ecgs[0])
      lines.push(
        `ECG: ${record.ecgs[0].performed_at} · ${record.ecgs[0].clinician_interpretation || record.ecgs[0].ischemic_interpretation}`,
      );
    if (record.troponins.length)
      lines.push(
        `Troponin: ${record.troponins.map((r: any) => `${r.original_value} ${r.original_unit} (${r.collected_at}, ${r.test_id})`).join("; ")}`,
      );
    if (angio)
      lines.push(
        `Angiography: ${angio.performed_at} · ${angio.conclusion || angio.anatomy_summary}`,
        `Lesions: ${angio.lesions.map((l: any) => `${l.vessel} ${l.segment} ${l.stenosis_percent ?? "unquantified"}%`).join("; ")}`,
      );
    if (pci)
      lines.push(
        `PCI: ${pci.performed_at} · ${pci.target_vessel} · ${pci.result}`,
        `Stents: ${pci.stents.map((s: any) => `${s.stent_type} ${s.diameter_mm ?? "?"} × ${s.length_mm ?? "?"} mm ${s.vessel}`).join("; ")}`,
      );
    if (record.latestEcho)
      lines.push(
        `Echo: ${record.latestEcho.performed_at} · ${record.latestEcho.conclusion || "No conclusion recorded"}`,
      );
    if (record.currentPlans.length)
      lines.push(
        `Current plans: ${record.currentPlans.map((p: any) => `${p.category}: ${parse(p.data).assessment || parse(p.data).purpose || p.plan_key}${p.review_date ? ` (review ${p.review_date})` : ""}`).join("; ")}`,
      );
    res.json({
      kind,
      status: "DRAFT",
      text: lines.filter(Boolean).join("\n\n"),
      requiresClinicianFinalization: true,
    });
  });
}
