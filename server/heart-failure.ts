import type { Express, RequestHandler } from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB, QueryDB } from "./db.js";
import { audit } from "./db.js";
import {
  FoundationError,
  loadClinicalState,
  recordClinicalFact,
} from "./clinical-foundation.js";
import {
  hfDocumentationGaps,
  resolveHfPhenotypeState,
  type HfEcho,
  type HfReview,
} from "../src/heart-failure.js";
import { createSharedEchoStudy, loadEchoStudies } from "./echo-valve.js";
import type { EchoStudy } from "../src/echo-valve.js";

const SITE = "demo-kuwait";
const VERIFIED_ON = "2026-09-22";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.stringify(value);

const evidenceSources = [
  {
    key: "esc-cvd-ckd",
    version: "2026-ehag098",
    title:
      "2026 ESC Guidelines for the management of cardiovascular disease and chronic kidney disease",
    organization: "ESC/ERA",
    year: 2026,
    date: "2026-08-28",
    url: "https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/cvd-chronic-kidney-disease/",
    topic: "heart_failure_cardiorenal",
  },
  {
    key: "esc-cardiac-rehabilitation",
    version: "2026-ehag099",
    title: "2026 ESC Guidelines on cardiac rehabilitation",
    organization: "ESC/ESPRM/WONCA",
    year: 2026,
    date: "2026-08-28",
    url: "https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/cardiac-rehabilitation/",
    topic: "heart_failure_rehabilitation",
  },
  {
    key: "universal-definition-hf",
    version: "2026-ehag500",
    title: "Second Universal Definition of Heart Failure",
    organization: "AHA/ACC/ESC/WHF",
    year: 2026,
    date: "2026-06-29",
    url: "https://academic.oup.com/eurheartj/article/47/32/4357/8719720",
    topic: "heart_failure_definition",
  },
] as const;

type Candidate = {
  key: string;
  category: string;
  title: string;
  purpose: string;
  requiredData: string[];
  evidence: string[];
  tests: string[];
  ruleType: string;
};

const candidates: Candidate[] = [
  {
    key: "hf.phenotype-2026",
    category: "HF diagnosis/classification",
    title: "2026 HF phenotype classification",
    purpose:
      "Classify the current HF phenotype from the clinically preferred LVEF while preserving historical phenotype.",
    requiredData: ["preferred LVEF", "imaging quality", "HF diagnosis context"],
    evidence: ["esc-hf"],
    tests: [
      "new reduced EF",
      "preserved EF",
      "new Echo requiring reassessment",
    ],
    ruleType: "diagnosis_support",
  },
  {
    key: "hf.chronic-treatment-review",
    category: "Pharmacologic therapy",
    title: "HF treatment opportunity review",
    purpose:
      "Assess current phenotype, therapy, exclusions, intolerance and safety data without autonomously prescribing.",
    requiredData: [
      "phenotype",
      "medications",
      "BP",
      "HR",
      "renal function",
      "potassium",
    ],
    evidence: ["esc-hf"],
    tests: [
      "incomplete treatment",
      "documented intolerance",
      "temporarily unsafe",
    ],
    ruleType: "treatment_opportunity",
  },
  {
    key: "hf.titration-readiness",
    category: "Medication titration",
    title: "HF medication titration readiness",
    purpose:
      "Use the shared titration engine to distinguish ready, waiting and currently limited states.",
    requiredData: [
      "current dose",
      "BP",
      "HR",
      "potassium",
      "renal function",
      "recent changes",
    ],
    evidence: ["esc-hf"],
    tests: [
      "ready",
      "waiting for monitoring",
      "limited by BP",
      "limited by HR",
      "limited by laboratory issue",
    ],
    ruleType: "dose_titration",
  },
  {
    key: "hf.hyperkalaemia-review",
    category: "Renal/K safety",
    title: "HF hyperkalaemia review",
    purpose:
      "Evaluate potassium value, trend, sample context, renal function and relevant therapies.",
    requiredData: [
      "potassium",
      "trend",
      "renal function",
      "medications",
      "sample quality",
    ],
    evidence: ["esc-hf", "esc-cvd-ckd"],
    tests: [
      "normal",
      "increasing",
      "abnormal",
      "new result supersedes prior assessment",
    ],
    ruleType: "complication_pathway",
  },
  {
    key: "hf.worsening-renal-function",
    category: "Renal/K safety",
    title: "HF worsening renal function review",
    purpose:
      "Assess renal change in the context of congestion, perfusion, therapies, illness and nephrotoxins.",
    requiredData: [
      "creatinine/eGFR trend",
      "congestion",
      "BP",
      "medications",
      "acute illness",
    ],
    evidence: ["esc-hf", "esc-cvd-ckd"],
    tests: [
      "stable",
      "deteriorating while congested",
      "improving",
      "avoid blanket therapy withdrawal",
    ],
    ruleType: "complication_pathway",
  },
  {
    key: "hf.hypotension-review",
    category: "Monitoring",
    title: "HF hypotension review",
    purpose:
      "Differentiate asymptomatic low BP from symptomatic hypotension using volume status and recent changes.",
    requiredData: ["BP", "symptoms", "volume status", "HR", "medications"],
    evidence: ["esc-hf"],
    tests: ["acceptable BP", "asymptomatic low BP", "symptomatic hypotension"],
    ruleType: "complication_pathway",
  },
  {
    key: "hf.bradycardia-review",
    category: "Monitoring",
    title: "HF bradycardia review",
    purpose:
      "Review HR with symptoms, rhythm, conduction, rate-slowing medication and device context.",
    requiredData: [
      "HR",
      "symptoms",
      "rhythm",
      "conduction",
      "medications",
      "device status",
    ],
    evidence: ["esc-hf"],
    tests: [
      "acceptable HR",
      "asymptomatic bradycardia",
      "symptomatic bradycardia",
    ],
    ruleType: "complication_pathway",
  },
  {
    key: "hf.congestion-review",
    category: "Congestion",
    title: "HF congestion state and diuretic response",
    purpose:
      "Combine symptoms, findings, weight, renal/electrolyte data and diuretic history for clinician review.",
    requiredData: [
      "symptoms",
      "weight trend",
      "oedema/JVP/lung findings",
      "renal function",
      "diuretic course",
    ],
    evidence: ["esc-hf"],
    tests: [
      "no evident congestion",
      "possible",
      "clinically congested",
      "worsening response",
    ],
    ruleType: "complication_pathway",
  },
  {
    key: "hf.iron-deficiency-review",
    category: "Iron deficiency",
    title: "HF iron deficiency and anaemia review",
    purpose:
      "Interpret haemoglobin, ferritin and transferrin saturation with renal and bleeding context.",
    requiredData: [
      "haemoglobin",
      "ferritin",
      "transferrin saturation",
      "renal function",
      "bleeding context",
    ],
    evidence: ["esc-hf", "esc-cvd-ckd"],
    tests: [
      "complete normal profile",
      "discordant indices",
      "anaemia with missing iron data",
    ],
    ruleType: "investigation_follow_up",
  },
  {
    key: "hf.icd-assessment",
    category: "Device assessment",
    title: "HF ICD assessment and reassessment timing",
    purpose:
      "Assess candidacy and required waiting/reassessment context without recommending implantation automatically.",
    requiredData: [
      "current/previous LVEF",
      "aetiology",
      "NYHA",
      "therapy duration",
      "MI/revascularization timing",
      "VT/VF",
      "life expectancy",
    ],
    evidence: ["esc-hf"],
    tests: [
      "new low EF",
      "missing therapy duration",
      "improved EF invalidates prior assessment",
    ],
    ruleType: "device_consideration",
  },
  {
    key: "hf.crt-assessment",
    category: "Device assessment",
    title: "HF CRT assessment",
    purpose:
      "Assess LVEF, symptoms, rhythm, QRS, morphology, pacing and therapy context.",
    requiredData: [
      "LVEF",
      "NYHA",
      "rhythm",
      "QRS duration",
      "QRS morphology",
      "pacing burden",
    ],
    evidence: ["esc-hf"],
    tests: [
      "potential assessment",
      "criteria not met",
      "missing ECG/device information",
    ],
    ruleType: "device_consideration",
  },
  {
    key: "hf.post-discharge-follow-up",
    category: "Follow-up",
    title: "HF post-discharge follow-up schedule",
    purpose:
      "Generate exact dates for laboratory, clinical, titration and imaging reassessment after approved intervals are selected.",
    requiredData: [
      "discharge date",
      "medication changes",
      "laboratory status",
      "clinical severity",
      "planned imaging",
    ],
    evidence: ["esc-hf"],
    tests: [
      "recent admission",
      "multiple changes",
      "combined compatible monitoring tasks",
    ],
    ruleType: "follow_up_timing",
  },
  {
    key: "hf.discharge-readiness",
    category: "Discharge",
    title: "HF discharge readiness review",
    purpose:
      "Highlight unresolved stability, reconciliation, monitoring, education, rehabilitation and follow-up items.",
    requiredData: [
      "stability",
      "congestion",
      "renal/electrolytes",
      "medications",
      "follow-up",
      "education",
      "rehabilitation",
    ],
    evidence: ["esc-hf", "esc-cardiac-rehabilitation"],
    tests: ["ready", "monitoring date missing", "titration plan incomplete"],
    ruleType: "follow_up_timing",
  },
  {
    key: "hf.rehabilitation-assessment",
    category: "Rehabilitation",
    title: "HF rehabilitation eligibility review",
    purpose:
      "Prompt structured eligibility and referral review while retaining contraindications and limitations.",
    requiredData: [
      "clinical stability",
      "functional status",
      "limitations",
      "referral status",
    ],
    evidence: ["esc-hf", "esc-cardiac-rehabilitation"],
    tests: [
      "stable eligible patient",
      "decompensated patient",
      "documented limitation",
    ],
    ruleType: "referral_consideration",
  },
  {
    key: "hf.advanced-referral",
    category: "Advanced HF",
    title: "Possible advanced HF specialist assessment",
    purpose:
      "Recognize a reviewed constellation of advanced-HF signals and support specialist escalation.",
    requiredData: [
      "admissions",
      "symptoms",
      "BP",
      "organ function",
      "diuretic course",
      "ventricular function",
      "arrhythmia",
    ],
    evidence: ["esc-hf"],
    tests: [
      "repeated admissions with severe symptoms",
      "single isolated feature",
      "missing referral context",
    ],
    ruleType: "referral_consideration",
  },
];

const concepts = [
  ["heart_failure.status", "Heart failure clinical status", "diagnosis"],
  ["heart_failure.presentation", "Heart failure presentation", "diagnosis"],
  ["heart_failure.nyha", "NYHA functional class", "observation"],
  ["heart_failure.phenotype", "Clinician-confirmed HF phenotype", "diagnosis"],
  ["heart_failure.congestion", "Clinician-assessed congestion", "observation"],
  ["heart_failure.lvef", "Left ventricular ejection fraction", "investigation"],
  [
    "heart_failure.echo_observation",
    "Cardiac imaging observation",
    "investigation",
  ],
  ["heart_failure.pathway", "HF pathway assessment", "assessment"],
] as const;

const pathwaySeeds = [
  ["hf.diagnostic", "HF diagnostic pathway"],
  ["hf.congestion", "Congestion and diuretic response"],
  ["hf.decompensated", "Decompensated HF pathway"],
  ["hf.renal", "Worsening renal function pathway"],
  ["hf.hyperkalaemia", "Hyperkalaemia pathway"],
  ["hf.hypotension", "Hypotension pathway"],
  ["hf.bradycardia", "Bradycardia pathway"],
  ["hf.iron", "Iron deficiency and anaemia pathway"],
  ["hf.device", "HF device assessment"],
  ["hf.discharge", "HF discharge review"],
] as const;

export async function initializeHeartFailure(db: DB) {
  for (const [code, display, kind] of concepts)
    await db.query(
      "INSERT INTO clinical.terminology_concept(system,code,version,display,kind,created_by) VALUES('cardioflow',$1,1,$2,$3,'system:stage3') ON CONFLICT DO NOTHING",
      [code, display, kind],
    );
  for (const source of evidenceSources) {
    await db.query(
      `INSERT INTO decision_support.evidence_source
       (key,version,title,organization,publication_year,locator,reviewed_at,status,metadata,created_by,
        topic,source_kind,publication_date,authoritative_url,last_verified_at,next_review_date,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,'approved',$8,'system:stage3',$9,'guideline',$10,$6,$7,'2027-08-28',$11)
       ON CONFLICT DO NOTHING`,
      [
        source.key,
        source.version,
        source.title,
        source.organization,
        source.year,
        source.url,
        VERIFIED_ON,
        json({
          catalogueOnly: true,
          clinicalGuidance: true,
          copyright:
            "metadata-and-citation-only; formal software-use licence required",
        }),
        source.topic,
        source.date,
        "Evidence catalogue metadata only. Exact clinical logic requires licensed source review and independent clinical approval.",
      ],
    );
    if (
      !(
        await db.query(
          "SELECT id FROM decision_support.evidence_status_event WHERE evidence_key=$1 AND evidence_version=$2 LIMIT 1",
          [source.key, source.version],
        )
      ).rows[0]
    )
      await db.query(
        "INSERT INTO decision_support.evidence_status_event(id,evidence_key,evidence_version,status,reason,actor) VALUES($1,$2,$3,'current','Verified against the official publisher for catalogue metadata only','system:stage3')",
        [randomUUID(), source.key, source.version],
      );
  }
  for (const [key, title] of pathwaySeeds) {
    const definition = {
      key,
      version: 1,
      title,
      start: "known",
      nodes: [
        { id: "known", type: "action", title: "What we know", next: "missing" },
        {
          id: "missing",
          type: "action",
          title: "What is missing",
          next: "review",
        },
        {
          id: "review",
          type: "terminal",
          title: "Clinician assessment and documented plan",
          why: "This pathway structures review and does not encode unpublished treatment advice.",
        },
      ],
    };
    await db.query(
      "INSERT INTO decision_support.pathway_definition(key,version,title,status,definition,checksum,created_by) VALUES($1,1,$2,'active',$3,$4,'system:stage3') ON CONFLICT DO NOTHING",
      [key, title, json(definition), hash(json(definition))],
    );
  }
  for (const candidate of candidates) await ensureCandidate(db, candidate);
}

async function ensureCandidate(db: QueryDB, candidate: Candidate) {
  if (
    (
      await db.query(
        "SELECT key FROM decision_support.rule_definition WHERE key=$1 AND version=1",
        [candidate.key],
      )
    ).rows[0]
  )
    return;
  const evidence = candidate.evidence.map((key) => ({
    key,
    version:
      key === "esc-hf"
        ? "2026"
        : key === "esc-cvd-ckd"
          ? "2026-ehag098"
          : "2026-ehag099",
  }));
  const rule = {
    key: candidate.key,
    version: 1,
    status: "draft",
    topic: "heart_failure",
    priority: 3,
    trigger: {
      kind: "fact",
      conceptCode: "governance.hf_rule_licensed_and_reviewed",
      operator: "equals",
      value: candidate.key,
    },
    output: {
      title: candidate.title,
      recommendation:
        "Candidate logic is blocked pending licensed evidence extraction and independent clinical review.",
    },
    evidence,
    reviewContract: {
      category: candidate.category,
      purpose: candidate.purpose,
      requiredData: candidate.requiredData,
      plannedTests: candidate.tests,
      publicationBlockers: [
        "Formal ESC software-use licence or approved implementation permission",
        "Exact trigger, thresholds, exclusions, class and evidence level extracted by an authorized reviewer",
        "Representative automated rule tests",
        "Independent maker-checker approval",
      ],
    },
  };
  const serialized = json(rule);
  await db.query(
    `INSERT INTO decision_support.rule_definition
     (key,version,topic,status,priority,definition,checksum,created_by,site_id,title,clinical_domain,subdomain,
      rule_type,patient_population,required_data,optional_supporting_data,exclusion_criteria,contraindications,
      caution_conditions,urgency,recommendation_category,follow_up_implications,author,changelog,review_due_date,
      test_status,fixture)
     VALUES($1,1,'heart_failure','draft',3,$2,$3,'system:stage3-author',$4,$5,'heart_failure',$6,$7,'{}',$8,
      '[]','[]','[]','[]','routine','clinical_review','{}','system:stage3-author',$9,'2027-08-28','not_run',false)`,
    [
      candidate.key,
      serialized,
      hash(serialized),
      SITE,
      candidate.title,
      candidate.category,
      candidate.ruleType,
      json(candidate.requiredData),
      "Initial Stage 3 candidate; deliberately non-executable pending licensed evidence extraction and independent clinical review.",
    ],
  );
  for (const reference of evidence)
    await db.query(
      "INSERT INTO decision_support.rule_evidence(rule_key,rule_version,evidence_key,evidence_version,relationship,added_by) VALUES($1,1,$2,$3,'primary','system:stage3-author')",
      [candidate.key, reference.key, reference.version],
    );
  await db.query(
    "INSERT INTO decision_support.rule_lifecycle_event(id,rule_key,rule_version,site_id,state,comment,actor) VALUES($1,$2,1,$3,'DRAFT','Initial non-executable candidate authored for Stage 3 review','system:stage3-author')",
    [randomUUID(), candidate.key, SITE],
  );
  await db.query(
    "INSERT INTO decision_support.rule_lifecycle_event(id,rule_key,rule_version,site_id,state,comment,actor) VALUES($1,$2,1,$3,'CLINICAL_REVIEW','Blocked pending licensed evidence extraction, completed tests and independent clinical review','system:stage3-author')",
    [randomUUID(), candidate.key, SITE],
  );
}

async function patient(db: QueryDB, id: string) {
  const row = (
    await db.query<any>(
      "SELECT * FROM core.patient WHERE id=$1 AND site_id=$2",
      [z.string().uuid().parse(id), SITE],
    )
  ).rows[0];
  if (!row) throw new FoundationError(404, "Patient not found");
  return row;
}

async function ensureEncounter(
  db: QueryDB,
  encounterId: string | null,
  patientId: string,
) {
  if (!encounterId) return null;
  const row = (
    await db.query(
      "SELECT id FROM care.encounter WHERE id=$1 AND patient_id=$2",
      [encounterId, patientId],
    )
  ).rows[0];
  if (!row)
    throw new FoundationError(422, "Encounter does not belong to this patient");
  return encounterId;
}

async function ensureProfile(db: QueryDB, patientId: string, actor: string) {
  const current = (
    await db.query<any>(
      "SELECT * FROM heart_failure.profile WHERE patient_id=$1",
      [patientId],
    )
  ).rows[0];
  if (current) return current;
  return (
    await db.query<any>(
      "INSERT INTO heart_failure.profile(id,patient_id,created_by) VALUES($1,$2,$3) RETURNING *",
      [randomUUID(), patientId, actor],
    )
  ).rows[0];
}

function parsed<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function projectProfileFact(
  db: DB,
  patientId: string,
  profileId: string,
  conceptCode: string,
  value:
    | { type: "coded"; code: string; display: string }
    | { type: "json"; value: any },
  observedAt: string,
  encounterId: string | null,
  sourceLabel: string,
  actor: string,
) {
  const prior = (
    await db.query<any>(
      `SELECT * FROM clinical.fact WHERE patient_id=$1 AND source_type='heart_failure_profile'
       AND source_id=$2 AND concept_code=$3 ORDER BY version DESC LIMIT 1`,
      [patientId, profileId, conceptCode],
    )
  ).rows[0];
  return recordClinicalFact(
    db,
    patientId,
    {
      logical_id: prior?.logical_id,
      concept_system: "cardioflow",
      concept_code: conceptCode,
      concept_version: 1,
      value,
      observed_at: observedAt,
      encounter_id: encounterId,
      source_type: "heart_failure_profile",
      source_id: profileId,
      source_label: sourceLabel,
      source_quality: "high",
      verification_status: "verified",
      lifecycle_status: "active",
      supersedes_fact_id: prior?.id ?? null,
    },
    actor,
  );
}

async function createTask(
  db: QueryDB,
  patientId: string,
  encounterId: string | null,
  sourceType: string,
  sourceId: string,
  kind: "clinical_review" | "laboratory" | "follow_up" | "reassessment",
  purpose: string,
  targetDate: string,
  actor: string,
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO workflow.clinical_task
     (id,patient_id,encounter_id,kind,purpose,target_date,assigned_to,source_type,source_id,details,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$7)`,
    [
      id,
      patientId,
      encounterId,
      kind,
      purpose,
      targetDate,
      actor,
      sourceType,
      sourceId,
      json({ heartFailure: true, clinicianSelectedDate: true }),
    ],
  );
  await db.query(
    "INSERT INTO workflow.clinical_task_event(id,task_id,version,status,note,actor) VALUES($1,$2,1,'open','Clinician-confirmed HF care date',$3)",
    [randomUUID(), id, actor],
  );
  return id;
}

async function supersedeSourceTasks(
  db: QueryDB,
  patientId: string,
  sourceType: string,
  actor: string,
) {
  const tasks = (
    await db.query<any>(
      `SELECT t.id,COALESCE(max(e.version),0)::int version
       FROM workflow.clinical_task t
       LEFT JOIN workflow.clinical_task_event e ON e.task_id=t.id
       WHERE t.patient_id=$1 AND t.source_type=$2
       GROUP BY t.id`,
      [patientId, sourceType],
    )
  ).rows;
  for (const task of tasks) {
    const latest = (
      await db.query<any>(
        "SELECT status FROM workflow.clinical_task_event WHERE task_id=$1 ORDER BY version DESC LIMIT 1",
        [task.id],
      )
    ).rows[0];
    if (
      latest &&
      !["completed", "cancelled", "superseded"].includes(latest.status)
    )
      await db.query(
        "INSERT INTO workflow.clinical_task_event(id,task_id,version,status,note,actor) VALUES($1,$2,$3,'superseded','Replaced by a newer clinician-confirmed HF assessment',$4)",
        [randomUUID(), task.id, Number(task.version) + 1, actor],
      );
  }
}

export async function loadHeartFailureState(db: QueryDB, patientId: string) {
  const person = await patient(db, patientId);
  const profile =
    (
      await db.query<any>(
        "SELECT * FROM heart_failure.profile WHERE patient_id=$1",
        [patientId],
      )
    ).rows[0] ?? null;
  const clinical = await loadClinicalState(db, patientId);
  const [medicationRows, labRows, taskRows, careRows, encounterRows] =
    await Promise.all([
      db.query<any>(
        `SELECT ct.*,d.generic_name,g.group_id,g.name group_name
       FROM medication.current_therapy ct
       JOIN medication.generic_definition d ON d.medication_id=ct.medication_id AND d.version=ct.medication_version
       LEFT JOIN medication.group_member gm ON gm.medication_id=ct.medication_id AND gm.medication_version=ct.medication_version
       LEFT JOIN medication.clinical_group g ON g.group_id=gm.group_id AND g.version=gm.group_version
       WHERE ct.patient_id=$1 AND ct.status IN ('ACTIVE','TEMPORARILY_HELD','PLANNED')
       ORDER BY d.generic_name,g.name`,
        [patientId],
      ),
      db.query<any>(
        `SELECT DISTINCT ON (r.test_id) r.*,d.display
       FROM laboratory.result r JOIN laboratory.test_definition d ON d.test_id=r.test_id AND d.version=r.test_version
       WHERE r.patient_id=$1 AND r.verification_status<>'entered_in_error'
       ORDER BY r.test_id,r.collected_at DESC,r.recorded_at DESC`,
        [patientId],
      ),
      db.query<any>(
        `SELECT t.*,e.status current_status FROM workflow.clinical_task t
       LEFT JOIN workflow.clinical_task_event e ON e.task_id=t.id
        AND e.version=(SELECT max(v.version) FROM workflow.clinical_task_event v WHERE v.task_id=t.id)
       WHERE t.patient_id=$1 ORDER BY t.target_date NULLS LAST,t.created_at DESC`,
        [patientId],
      ),
      db.query<any>(
        "SELECT * FROM care.entry WHERE patient_id=$1 AND family='HF' ORDER BY occurred_on DESC,updated_at DESC",
        [patientId],
      ),
      db.query<any>(
        "SELECT * FROM care.encounter WHERE patient_id=$1 ORDER BY started_on DESC,created_at DESC",
        [patientId],
      ),
    ]);
  if (!profile)
    return {
      patient: person,
      profile: null,
      currentReview: null,
      phenotype: resolveHfPhenotypeState(null, null),
      preferredEcho: null,
      echoes: [],
      reviews: [],
      pathways: [],
      devices: [],
      dischargeReviews: [],
      rehabilitation: null,
      medications: medicationRows.rows,
      labs: labRows.rows,
      tasks: taskRows.rows,
      clinical,
      gaps: [],
      integratedPlan: taskRows.rows.filter(
        (task) =>
          !["completed", "cancelled", "superseded"].includes(
            task.current_status,
          ),
      ),
      timeline: [],
      diagnosticPathway: {
        known: [],
        missing: ["A structured HF review has not been started."],
        why: "The HF module reuses existing patient data and begins after a clinician records an HF review.",
        suggestedNextAssessment: "Start a structured HF review.",
      },
      careEntries: careRows.rows,
      encounters: encounterRows.rows,
    };
  const [
    reviewsResult,
    sharedEchoes,
    pathwaysResult,
    devicesResult,
    dischargeResult,
    rehabResult,
  ] = await Promise.all([
    db.query<any>(
      "SELECT * FROM heart_failure.review_event WHERE profile_id=$1 ORDER BY observed_at DESC,version DESC",
      [profile.id],
    ),
    loadEchoStudies(db, patientId),
    db.query<any>(
      "SELECT * FROM heart_failure.pathway_assessment WHERE profile_id=$1 ORDER BY observed_at DESC,created_at DESC",
      [profile.id],
    ),
    db.query<any>(
      "SELECT * FROM heart_failure.device_assessment WHERE profile_id=$1 ORDER BY observed_at DESC,created_at DESC",
      [profile.id],
    ),
    db.query<any>(
      "SELECT * FROM heart_failure.discharge_review WHERE profile_id=$1 ORDER BY observed_at DESC,created_at DESC",
      [profile.id],
    ),
    db.query<any>(
      "SELECT * FROM heart_failure.rehabilitation_assessment WHERE profile_id=$1 ORDER BY observed_at DESC,created_at DESC",
      [profile.id],
    ),
  ]);
  const reviews = reviewsResult.rows.map(parseReview),
    echoes = sharedEchoes.map(sharedEchoForHeartFailure),
    currentReview = reviews[0] ?? null,
    preferredLvef = clinical.concepts.find(
      (item) => item.concept_code === "echo.lvef",
    )?.current,
    preferredEcho =
      echoes.find((echo) => echo.id === preferredLvef?.source_id) ??
      echoes[0] ??
      null,
    phenotype = resolveHfPhenotypeState(currentReview, preferredEcho),
    rehabilitation = rehabResult.rows[0] ?? null,
    labIds = new Set(labRows.rows.map((row) => row.test_id)),
    gaps = hfDocumentationGaps({
      review: currentReview,
      preferredEcho,
      labIds,
      rehabilitationStatus: rehabilitation?.status ?? null,
    });
  const medicationMap = new Map<string, any>();
  for (const row of medicationRows.rows) {
    const item = medicationMap.get(row.id) ?? { ...row, groups: [] };
    if (row.group_id)
      item.groups.push({ group_id: row.group_id, name: row.group_name });
    medicationMap.set(row.id, item);
  }
  const timeline = [
    ...reviews.map((review) => ({
      id: review.id,
      type: "HF review",
      date: review.observed_at,
      title: `${review.presentation} · ${review.status}`,
      detail: review.nyha_class
        ? `NYHA ${review.nyha_class}`
        : "Functional class not recorded",
    })),
    ...echoes.map((echo) => ({
      id: echo.id,
      type: "Cardiac imaging",
      date: echo.observed_at,
      title: echo.source_label,
      detail: echo.lvef === null ? "LVEF not recorded" : `LVEF ${echo.lvef}%`,
    })),
    ...pathwaysResult.rows.map((item) => ({
      id: item.id,
      type: "HF pathway",
      date: item.observed_at,
      title: item.pathway_type.replaceAll("_", " "),
      detail: item.state,
    })),
    ...devicesResult.rows.map((item) => ({
      id: item.id,
      type: "Device review",
      date: item.observed_at,
      title: `${item.device_type} assessment`,
      detail: item.assessment_status.replaceAll("_", " "),
    })),
    ...dischargeResult.rows.map((item) => ({
      id: item.id,
      type: "HF discharge",
      date: item.observed_at,
      title: "HF discharge review",
      detail: item.clinical_stability.replaceAll("_", " "),
    })),
    ...rehabResult.rows.map((item) => ({
      id: item.id,
      type: "Rehabilitation",
      date: item.observed_at,
      title: "Cardiac rehabilitation",
      detail: item.status.replaceAll("_", " "),
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const known = [
    currentReview
      ? `HF status: ${currentReview.status.replaceAll("_", " ")}`
      : null,
    currentReview?.symptoms.length
      ? `${currentReview.symptoms.length} current symptom entries`
      : null,
    preferredEcho?.lvef !== null && preferredEcho
      ? `Preferred LVEF: ${preferredEcho.lvef}%`
      : null,
    labIds.has("bnp") || labIds.has("nt-probnp")
      ? "Natriuretic peptide result available"
      : null,
    phenotype.value ? `Recorded phenotype: ${phenotype.value}` : null,
  ].filter(Boolean);
  const missing = [
    !currentReview ? "Structured HF review" : null,
    !preferredEcho ? "Preferred cardiac imaging evidence" : null,
    !labIds.has("bnp") && !labIds.has("nt-probnp")
      ? "Natriuretic peptide context"
      : null,
    phenotype.status !== "CONFIRMED" ? "Current phenotype confirmation" : null,
    !currentReview?.etiologies.length ? "Aetiology assessment" : null,
  ].filter(Boolean);
  return {
    patient: person,
    profile,
    currentReview,
    phenotype,
    preferredEcho,
    echoes,
    reviews,
    pathways: pathwaysResult.rows.map(parsePathway),
    devices: devicesResult.rows.map(parseDevice),
    dischargeReviews: dischargeResult.rows.map(parseDischarge),
    rehabilitation: rehabilitation ? parseRehab(rehabilitation) : null,
    medications: [...medicationMap.values()],
    labs: labRows.rows,
    tasks: taskRows.rows,
    clinical,
    gaps,
    integratedPlan: taskRows.rows.filter(
      (task) =>
        !["completed", "cancelled", "superseded"].includes(task.current_status),
    ),
    timeline,
    diagnosticPathway: {
      known,
      missing,
      why: "HF diagnosis and classification require symptoms/signs plus objective evidence interpreted in clinical context.",
      suggestedNextAssessment: missing.length
        ? "Review the missing information and document the clinician assessment."
        : "Core diagnostic context is recorded; review current state and longitudinal change.",
    },
    careEntries: careRows.rows,
    encounters: encounterRows.rows,
  };
}

function parseReview(row: any): HfReview {
  return {
    ...row,
    symptoms: parsed(row.symptoms ?? []),
    etiologies: parsed(row.etiologies ?? []),
    physical_findings: parsed(row.physical_findings ?? {}),
    therapy_decisions: parsed(row.therapy_decisions ?? []),
  };
}
function parseEcho(row: any): HfEcho {
  return {
    ...row,
    lvef: row.lvef === null ? null : Number(row.lvef),
    valve_summary: parsed(row.valve_summary ?? []),
  };
}
function sharedEchoForHeartFailure(study: EchoStudy): HfEcho {
  const lvef = study.measurements.find(
      (item) => item.parameter_code === "lvef",
    ),
    findings = study.structured_findings as Record<string, unknown>,
    legacyValveSummary = Array.isArray(findings.legacyValveSummary)
      ? findings.legacyValveSummary.map(String)
      : [],
    valveSummary = study.valve_findings.length
      ? study.valve_findings.map(
          (item) =>
            `${item.valve_name} ${item.lesion_type}: ${item.clinician_severity}`,
        )
      : legacyValveSummary;
  return {
    id: study.study_id,
    study_type:
      study.study_type === "COMPLETE_TTE"
        ? "FORMAL_TTE"
        : study.study_type === "BEDSIDE_FOCUSED"
          ? "LIMITED_TTE"
          : study.study_type,
    study_quality:
      study.study_quality === "ADEQUATE"
        ? "FAIR"
        : ["TECHNICALLY_LIMITED", "VERY_LIMITED"].includes(study.study_quality)
          ? "POOR"
          : study.study_quality,
    observed_at: study.performed_at,
    lvef:
      lvef?.value_number === null || lvef?.value_number === undefined
        ? null
        : Number(lvef.value_number),
    lvef_fact_id: lvef?.fact_id ?? null,
    rv_function:
      typeof findings.rvFunction === "string" ? findings.rvFunction : null,
    valve_summary: valveSummary,
    pulmonary_pressure_context:
      typeof findings.pulmonaryPressureContext === "string"
        ? findings.pulmonaryPressureContext
        : "",
    diastolic_context:
      typeof findings.diastolicContext === "string"
        ? findings.diastolicContext
        : "",
    pericardial_context:
      typeof findings.pericardialContext === "string"
        ? findings.pericardialContext
        : "",
    structural_context:
      typeof findings.structuralContext === "string"
        ? findings.structuralContext
        : study.interpretation,
    source_label: study.source_label,
    verification_status: ["FINAL", "AMENDED"].includes(study.status)
      ? "verified"
      : "preliminary",
    author: study.reporting_cardiologist,
  };
}
const parsePathway = (row: any) => ({
  ...row,
  patient_data: parsed(row.patient_data ?? {}),
  missing_information: parsed(row.missing_information ?? []),
  considerations: parsed(row.considerations ?? []),
  medication_implications: parsed(row.medication_implications ?? []),
  monitoring_plan: parsed(row.monitoring_plan ?? {}),
});
const parseDevice = (row: any) => ({
  ...row,
  input_snapshot: parsed(row.input_snapshot ?? {}),
  missing_information: parsed(row.missing_information ?? []),
});
const parseDischarge = (row: any) => ({
  ...row,
  outstanding_items: parsed(row.outstanding_items ?? []),
});
const parseRehab = (row: any) => ({ ...row });

const reviewSchema = z
  .object({
    encounter_id: z.string().uuid().nullable().default(null),
    status: z.enum([
      "AT_RISK",
      "PRE_HF",
      "CURRENT_SYMPTOMATIC",
      "PREVIOUS_STABLE",
      "DECOMPENSATED",
      "ADVANCED",
    ]),
    presentation: z.enum([
      "NEWLY_DIAGNOSED",
      "CHRONIC_STABLE",
      "ACUTE_DECOMPENSATION",
      "POST_DISCHARGE",
      "WORSENING_OUTPATIENT",
      "RECURRENT_ADMISSION",
      "ADVANCED_ASSESSMENT",
    ]),
    symptoms: z
      .array(
        z
          .object({
            symptom: z.string().min(1).max(100),
            severity: z.enum(["mild", "moderate", "severe", "not_recorded"]),
            change: z.enum([
              "new",
              "worse",
              "unchanged",
              "improved",
              "not_recorded",
            ]),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    symptoms_reviewed_unchanged: z.boolean().default(false),
    nyha_class: z
      .enum(["I", "II", "III", "IV", "NOT_ASSESSED"])
      .nullable()
      .default(null),
    etiologies: z.array(z.string().max(120)).max(12).default([]),
    physical_findings: z.record(z.string(), z.string().max(300)).default({}),
    clinician_congestion: z
      .enum([
        "NO_EVIDENT_CONGESTION",
        "POSSIBLE_CONGESTION",
        "CLINICALLY_CONGESTED",
        "SEVERE_OR_WORSENING",
        "NOT_ASSESSED",
      ])
      .nullable()
      .default(null),
    clinician_phenotype: z
      .enum(["HFrEF", "HFpEF", "UNCLASSIFIED"])
      .nullable()
      .default(null),
    phenotype_source_echo_id: z.string().uuid().nullable().default(null),
    therapy_decisions: z
      .array(
        z
          .object({
            group: z.string().max(120),
            status: z.enum(["ACTIVE", "NOT_PRESCRIBED", "LIMITED", "DECLINED"]),
            reason: z.string().max(600),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    narrative: z.string().max(4000).default(""),
    observed_at: z.string().datetime(),
  })
  .strict();

const echoSchema = z
  .object({
    encounter_id: z.string().uuid().nullable().default(null),
    study_type: z.enum(["FORMAL_TTE", "LIMITED_TTE", "TEE", "CMR", "OTHER"]),
    study_quality: z.enum(["GOOD", "FAIR", "POOR", "NOT_RECORDED"]),
    observed_at: z.string().datetime(),
    lvef: z.number().min(0).max(100).nullable().default(null),
    rv_function: z
      .enum([
        "NORMAL",
        "MILDLY_REDUCED",
        "MODERATELY_REDUCED",
        "SEVERELY_REDUCED",
        "NOT_REPORTED",
      ])
      .nullable()
      .default(null),
    valve_summary: z.array(z.string().max(300)).max(10).default([]),
    pulmonary_pressure_context: z.string().max(1000).default(""),
    diastolic_context: z.string().max(1000).default(""),
    pericardial_context: z.string().max(1000).default(""),
    structural_context: z.string().max(1000).default(""),
    source_label: z.string().min(2).max(300),
    verification_status: z.enum(["preliminary", "verified"]),
  })
  .strict();

const pathwaySchema = z
  .object({
    encounter_id: z.string().uuid().nullable().default(null),
    pathway_type: z.enum([
      "DIAGNOSTIC",
      "CONGESTION",
      "DECOMPENSATED_HF",
      "WORSENING_RENAL_FUNCTION",
      "HYPERKALAEMIA",
      "HYPOTENSION",
      "BRADYCARDIA",
      "HYPONATRAEMIA",
      "IRON_OR_ANAEMIA",
      "DIURETIC_RESPONSE",
      "ADVANCED_HF",
    ]),
    state: z.string().min(2).max(200),
    severity: z.enum(["NOT_ASSESSED", "LOW", "MODERATE", "HIGH", "CRITICAL"]),
    patient_data: z.record(z.string(), z.string().max(500)).default({}),
    missing_information: z.array(z.string().max(300)).max(20).default([]),
    considerations: z.array(z.string().max(500)).max(20).default([]),
    medication_implications: z.array(z.string().max(500)).max(20).default([]),
    monitoring_plan: z.record(z.string(), z.string().max(500)).default({}),
    escalation: z.string().max(1000).default(""),
    evidence_note: z.string().max(1000).default(""),
    observed_at: z.string().datetime(),
  })
  .strict();

export function mountHeartFailure(
  app: Express,
  db: DB,
  read: RequestHandler,
  write: RequestHandler,
) {
  app.get("/api/patients/:id/heart-failure", read, async (req, res) => {
    res.json(await loadHeartFailureState(db, String(req.params.id)));
  });

  app.post(
    "/api/patients/:id/heart-failure/reviews",
    write,
    async (req, res) => {
      const person = await patient(db, String(req.params.id)),
        input = reviewSchema.parse(req.body),
        actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
      await ensureEncounter(db, input.encounter_id, person.id);
      const profile = await ensureProfile(db, person.id, actor);
      if (
        input.phenotype_source_echo_id &&
        !(
          await db.query(
            "SELECT id FROM imaging.echo_study WHERE id=$1 AND patient_id=$2",
            [input.phenotype_source_echo_id, person.id],
          )
        ).rows[0]
      )
        throw new FoundationError(
          422,
          "Phenotype imaging source does not belong to this HF record",
        );
      const version = (
        await db.query<{ version: number }>(
          "SELECT COALESCE(max(version),0)::int+1 version FROM heart_failure.review_event WHERE profile_id=$1",
          [profile.id],
        )
      ).rows[0].version;
      const row = (
        await db.query<any>(
          `INSERT INTO heart_failure.review_event
      (id,profile_id,version,encounter_id,status,presentation,symptoms,symptoms_reviewed_unchanged,nyha_class,etiologies,physical_findings,clinician_congestion,clinician_phenotype,phenotype_source_echo_id,therapy_decisions,narrative,observed_at,author)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
          [
            randomUUID(),
            profile.id,
            version,
            input.encounter_id,
            input.status,
            input.presentation,
            json(input.symptoms),
            input.symptoms_reviewed_unchanged,
            input.nyha_class,
            json(input.etiologies),
            json(input.physical_findings),
            input.clinician_congestion,
            input.clinician_phenotype,
            input.phenotype_source_echo_id,
            json(input.therapy_decisions),
            input.narrative,
            input.observed_at,
            actor,
          ],
        )
      ).rows[0];
      await projectProfileFact(
        db,
        person.id,
        profile.id,
        "heart_failure.status",
        {
          type: "coded",
          code: input.status,
          display: input.status.replaceAll("_", " "),
        },
        input.observed_at,
        input.encounter_id,
        "HF clinical review",
        actor,
      );
      await projectProfileFact(
        db,
        person.id,
        profile.id,
        "heart_failure.presentation",
        {
          type: "coded",
          code: input.presentation,
          display: input.presentation.replaceAll("_", " "),
        },
        input.observed_at,
        input.encounter_id,
        "HF clinical review",
        actor,
      );
      if (input.nyha_class)
        await projectProfileFact(
          db,
          person.id,
          profile.id,
          "heart_failure.nyha",
          {
            type: "coded",
            code: input.nyha_class,
            display: `NYHA ${input.nyha_class}`,
          },
          input.observed_at,
          input.encounter_id,
          "HF functional status",
          actor,
        );
      if (input.clinician_phenotype)
        await projectProfileFact(
          db,
          person.id,
          profile.id,
          "heart_failure.phenotype",
          {
            type: "coded",
            code: input.clinician_phenotype,
            display: input.clinician_phenotype,
          },
          input.observed_at,
          input.encounter_id,
          "Clinician-confirmed HF phenotype",
          actor,
        );
      if (input.clinician_congestion)
        await projectProfileFact(
          db,
          person.id,
          profile.id,
          "heart_failure.congestion",
          {
            type: "coded",
            code: input.clinician_congestion,
            display: input.clinician_congestion.replaceAll("_", " "),
          },
          input.observed_at,
          input.encounter_id,
          "HF clinical review",
          actor,
        );
      await audit(
        db,
        actor,
        "HF review recorded",
        "heart_failure_review",
        row.id,
        person.id,
        { version },
      );
      res.status(201).json(parseReview(row));
    },
  );

  app.post(
    "/api/patients/:id/heart-failure/echoes",
    write,
    async (req, res) => {
      const person = await patient(db, String(req.params.id)),
        input = echoSchema.parse(req.body),
        actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
      await ensureEncounter(db, input.encounter_id, person.id);
      await ensureProfile(db, person.id, actor);
      const study = await createSharedEchoStudy(
        db,
        person.id,
        {
          encounter_id: input.encounter_id,
          study_type:
            input.study_type === "FORMAL_TTE"
              ? "COMPLETE_TTE"
              : input.study_type === "CMR"
                ? "OTHER"
                : input.study_type,
          formality:
            input.study_type === "FORMAL_TTE" ? "FORMAL" : "BEDSIDE_LIMITED",
          performed_at: input.observed_at,
          location: "",
          comparison_study_id: null,
          status:
            input.verification_status === "verified" ? "FINAL" : "PRELIMINARY",
          indication: ["Heart failure"],
          priority: "ROUTINE",
          study_quality:
            input.study_quality === "FAIR"
              ? "ADEQUATE"
              : input.study_quality === "POOR"
                ? "TECHNICALLY_LIMITED"
                : input.study_quality === "NOT_RECORDED"
                  ? "ADEQUATE"
                  : input.study_quality,
          quality_reasons: [],
          rhythm_context: "",
          heart_rate: null,
          blood_pressure: "",
          contrast_used: false,
          structured_findings: {
            rvFunction: input.rv_function,
            pulmonaryPressureContext: input.pulmonary_pressure_context,
            diastolicContext: input.diastolic_context,
            pericardialContext: input.pericardial_context,
            structuralContext: input.structural_context,
            legacyValveSummary: input.valve_summary,
          },
          interpretation: input.structural_context,
          comparison_summary: "",
          conclusion:
            input.structural_context ||
            (input.verification_status === "verified"
              ? "Clinician-verified HF cardiac imaging assessment"
              : ""),
          clinician_override_reason: "",
          reporting_cardiologist: actor,
          amendment_reason: "",
          source_label: input.source_label,
          measurements:
            input.lvef === null
              ? []
              : [
                  {
                    section: "LV",
                    parameter_code: "lvef",
                    label: "LVEF",
                    value_number: input.lvef,
                    value_text: null,
                    unit: "%",
                    method: "HF quick entry",
                    context: "",
                    sequence: 0,
                  },
                ],
          valve_findings: [],
        },
        actor,
      );
      res.status(201).json(sharedEchoForHeartFailure(study));
    },
  );

  app.post(
    "/api/patients/:id/heart-failure/pathways",
    write,
    async (req, res) => {
      const person = await patient(db, String(req.params.id)),
        input = pathwaySchema.parse(req.body),
        actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
      await ensureEncounter(db, input.encounter_id, person.id);
      const profile = await ensureProfile(db, person.id, actor),
        id = randomUUID();
      const row = (
        await db.query<any>(
          `INSERT INTO heart_failure.pathway_assessment
      (id,profile_id,encounter_id,pathway_type,state,severity,patient_data,missing_information,considerations,medication_implications,monitoring_plan,escalation,evidence_note,observed_at,author)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [
            id,
            profile.id,
            input.encounter_id,
            input.pathway_type,
            input.state,
            input.severity,
            json(input.patient_data),
            json(input.missing_information),
            json(input.considerations),
            json(input.medication_implications),
            json(input.monitoring_plan),
            input.escalation,
            input.evidence_note,
            input.observed_at,
            actor,
          ],
        )
      ).rows[0];
      await recordClinicalFact(
        db,
        person.id,
        {
          concept_system: "cardioflow",
          concept_code: "heart_failure.pathway",
          concept_version: 1,
          value: {
            type: "json",
            value: {
              pathwayType: input.pathway_type,
              state: input.state,
              severity: input.severity,
              patientData: input.patient_data,
            },
          },
          observed_at: input.observed_at,
          encounter_id: input.encounter_id,
          source_type: "heart_failure_pathway",
          source_id: id,
          source_label: `${input.pathway_type.replaceAll("_", " ")} assessment`,
          source_quality: "high",
          verification_status: "verified",
          lifecycle_status: "active",
        },
        actor,
      );
      await audit(
        db,
        actor,
        "HF pathway assessment recorded",
        "heart_failure_pathway",
        id,
        person.id,
        { pathwayType: input.pathway_type },
      );
      res.status(201).json(parsePathway(row));
    },
  );

  app.post(
    "/api/patients/:id/heart-failure/device-assessments",
    write,
    async (req, res) => {
      const person = await patient(db, String(req.params.id)),
        input = z
          .object({
            encounter_id: z.string().uuid().nullable().default(null),
            device_type: z.enum(["ICD", "CRT"]),
            assessment_status: z.enum([
              "POTENTIAL_ASSESSMENT",
              "CRITERIA_NOT_MET",
              "CANNOT_ASSESS",
              "REASSESSMENT_PLANNED",
              "EXISTING_DEVICE",
              "NOT_APPROPRIATE_AFTER_REVIEW",
            ]),
            input_snapshot: z
              .record(z.string(), z.string().max(500))
              .default({}),
            missing_information: z.array(z.string().max(300)).default([]),
            rationale: z.string().min(2).max(2000),
            reassessment_date: z.string().date().nullable().default(null),
            observed_at: z.string().datetime(),
          })
          .strict()
          .parse(req.body),
        actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
      await ensureEncounter(db, input.encounter_id, person.id);
      const profile = await ensureProfile(db, person.id, actor),
        id = randomUUID(),
        sourceType = `heart_failure_device_${input.device_type.toLowerCase()}`;
      await supersedeSourceTasks(db, person.id, sourceType, actor);
      const taskId = input.reassessment_date
        ? await createTask(
            db,
            person.id,
            input.encounter_id,
            sourceType,
            id,
            "reassessment",
            `${input.device_type} eligibility reassessment`,
            input.reassessment_date,
            actor,
          )
        : null;
      const row = (
        await db.query<any>(
          `INSERT INTO heart_failure.device_assessment
      (id,profile_id,encounter_id,device_type,assessment_status,input_snapshot,missing_information,rationale,reassessment_date,task_id,observed_at,author)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            id,
            profile.id,
            input.encounter_id,
            input.device_type,
            input.assessment_status,
            json(input.input_snapshot),
            json(input.missing_information),
            input.rationale,
            input.reassessment_date,
            taskId,
            input.observed_at,
            actor,
          ],
        )
      ).rows[0];
      await audit(
        db,
        actor,
        "HF device assessment recorded",
        "heart_failure_device",
        id,
        person.id,
        { deviceType: input.device_type, taskId },
      );
      res.status(201).json(parseDevice(row));
    },
  );

  app.post(
    "/api/patients/:id/heart-failure/discharge-reviews",
    write,
    async (req, res) => {
      const person = await patient(db, String(req.params.id)),
        input = z
          .object({
            encounter_id: z.string().uuid().nullable().default(null),
            clinical_stability: z.enum([
              "CONFIRMED",
              "NOT_CONFIRMED",
              "NOT_ASSESSED",
            ]),
            congestion_reviewed: z.boolean(),
            medication_reconciliation: z.boolean(),
            renal_electrolytes_reviewed: z.boolean(),
            titration_plan_reviewed: z.boolean(),
            education_reviewed: z.boolean(),
            rehabilitation_reviewed: z.boolean(),
            outstanding_items: z.array(z.string().max(500)).default([]),
            laboratory_date: z.string().date().nullable().default(null),
            clinic_date: z.string().date().nullable().default(null),
            echo_date: z.string().date().nullable().default(null),
            device_reassessment_date: z
              .string()
              .date()
              .nullable()
              .default(null),
            note: z.string().max(2000).default(""),
            observed_at: z.string().datetime(),
          })
          .strict()
          .parse(req.body),
        actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
      await ensureEncounter(db, input.encounter_id, person.id);
      const profile = await ensureProfile(db, person.id, actor),
        id = randomUUID();
      await supersedeSourceTasks(
        db,
        person.id,
        "heart_failure_discharge",
        actor,
      );
      const taskSpecs: [
        string | null,
        "laboratory" | "follow_up" | "reassessment",
        string,
      ][] = [
        [
          input.laboratory_date,
          "laboratory",
          "Post-discharge renal and electrolyte review",
        ],
        [
          input.clinic_date,
          "follow_up",
          "Heart failure post-discharge clinical review",
        ],
        [input.echo_date, "reassessment", "Repeat cardiac imaging review"],
        [
          input.device_reassessment_date,
          "reassessment",
          "HF device eligibility reassessment",
        ],
      ];
      for (const [target, kind, purpose] of taskSpecs)
        if (target)
          await createTask(
            db,
            person.id,
            input.encounter_id,
            "heart_failure_discharge",
            id,
            kind,
            purpose,
            target,
            actor,
          );
      const row = (
        await db.query<any>(
          `INSERT INTO heart_failure.discharge_review
      (id,profile_id,encounter_id,clinical_stability,congestion_reviewed,medication_reconciliation,renal_electrolytes_reviewed,titration_plan_reviewed,education_reviewed,rehabilitation_reviewed,outstanding_items,laboratory_date,clinic_date,echo_date,device_reassessment_date,note,observed_at,author)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
          [
            id,
            profile.id,
            input.encounter_id,
            input.clinical_stability,
            input.congestion_reviewed,
            input.medication_reconciliation,
            input.renal_electrolytes_reviewed,
            input.titration_plan_reviewed,
            input.education_reviewed,
            input.rehabilitation_reviewed,
            json(input.outstanding_items),
            input.laboratory_date,
            input.clinic_date,
            input.echo_date,
            input.device_reassessment_date,
            input.note,
            input.observed_at,
            actor,
          ],
        )
      ).rows[0];
      await audit(
        db,
        actor,
        "HF discharge review recorded",
        "heart_failure_discharge",
        id,
        person.id,
        { taskCount: taskSpecs.filter(([date]) => !!date).length },
      );
      res.status(201).json(parseDischarge(row));
    },
  );

  app.post(
    "/api/patients/:id/heart-failure/rehabilitation",
    write,
    async (req, res) => {
      const person = await patient(db, String(req.params.id)),
        input = z
          .object({
            encounter_id: z.string().uuid().nullable().default(null),
            status: z.enum([
              "NOT_ASSESSED",
              "ELIGIBILITY_REVIEWED",
              "REFERRED",
              "PLANNED",
              "STARTED",
              "COMPLETED",
              "DEFERRED",
              "NOT_APPROPRIATE",
            ]),
            limitation: z.string().max(1000).default(""),
            referral_date: z.string().date().nullable().default(null),
            planned_start_date: z.string().date().nullable().default(null),
            exercise_context: z.string().max(1000).default(""),
            note: z.string().max(2000).default(""),
            observed_at: z.string().datetime(),
          })
          .strict()
          .parse(req.body),
        actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
      await ensureEncounter(db, input.encounter_id, person.id);
      const profile = await ensureProfile(db, person.id, actor),
        id = randomUUID();
      const row = (
        await db.query<any>(
          `INSERT INTO heart_failure.rehabilitation_assessment
      (id,profile_id,encounter_id,status,limitation,referral_date,planned_start_date,exercise_context,note,observed_at,author)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            id,
            profile.id,
            input.encounter_id,
            input.status,
            input.limitation,
            input.referral_date,
            input.planned_start_date,
            input.exercise_context,
            input.note,
            input.observed_at,
            actor,
          ],
        )
      ).rows[0];
      await audit(
        db,
        actor,
        "HF rehabilitation assessment recorded",
        "heart_failure_rehabilitation",
        id,
        person.id,
        { status: input.status },
      );
      res.status(201).json(parseRehab(row));
    },
  );

  app.get(
    "/api/patients/:id/heart-failure/note-draft",
    read,
    async (req, res) => {
      const state: any = await loadHeartFailureState(db, String(req.params.id)),
        review = state.currentReview,
        echo = state.preferredEcho;
      const lines = [
        "HF CLINIC NOTE — DRAFT FOR CLINICIAN REVIEW",
        `Reason for review: ${review ? review.presentation.replaceAll("_", " ") : "Not recorded"}`,
        `Current symptoms: ${review?.symptoms_reviewed_unchanged ? "Reviewed — unchanged" : review?.symptoms.map((item: any) => `${item.symptom} (${item.change})`).join(", ") || "Not recorded"}`,
        `Functional status: ${review?.nyha_class ? `NYHA ${review.nyha_class}` : "Not assessed"}`,
        `Current HF phenotype: ${state.phenotype.value ?? "Not confirmed"}${state.phenotype.status === "REASSESSMENT_REQUIRED" ? " — reassessment required" : ""}`,
        `Latest preferred imaging: ${echo ? `${echo.source_label}, ${echo.lvef ?? "LVEF not recorded"}${echo.lvef === null ? "" : "%"}, ${echo.observed_at.slice(0, 10)}` : "Not recorded"}`,
        `Current therapy: ${state.medications.map((item: any) => `${item.generic_name} ${item.dose_value ?? ""} ${item.dose_unit ?? ""}`).join("; ") || "No structured therapy recorded"}`,
        `Clinical issues: ${state.gaps.map((item: any) => item.label).join("; ") || "No documentation gaps shown"}`,
        `Plan and follow-up: ${state.integratedPlan.map((item: any) => `${item.purpose}${item.target_date ? ` (${item.target_date})` : ""}`).join("; ") || "Clinician plan required"}`,
        "This draft is generated from structured data and requires clinician editing and approval.",
      ];
      res.json({
        draft: lines.join("\n\n"),
        generatedAt: new Date().toISOString(),
        requiresApproval: true,
      });
    },
  );

  app.get("/api/heart-failure/review-pack", read, async (_req, res) => {
    const rows = (
      await db.query<any>(
        `SELECT r.key,r.version,r.title,r.rule_type,r.recommendation_class,r.evidence_level,r.definition,r.lifecycle_state,r.test_status,
      COALESCE(json_agg(json_build_object('key',e.evidence_key,'version',e.evidence_version,'relationship',e.relationship)) FILTER (WHERE e.evidence_key IS NOT NULL),'[]') evidence
      FROM decision_support.rule_current_state r LEFT JOIN decision_support.rule_evidence e ON e.rule_key=r.key AND e.rule_version=r.version
      WHERE r.site_id=$1 AND r.key LIKE 'hf.%' GROUP BY r.key,r.version,r.title,r.rule_type,r.recommendation_class,r.evidence_level,r.definition,r.lifecycle_state,r.test_status ORDER BY r.key`,
        [SITE],
      )
    ).rows;
    res.json(
      rows.map((row) => ({
        ...row,
        definition: parsed(row.definition),
        evidence: parsed(row.evidence),
      })),
    );
  });
}
