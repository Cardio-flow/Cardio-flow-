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
  compareEchoStudies,
  echoIndications,
  echoStudyTypes,
  measurementCatalog,
  preferredEchoStudy,
  valveLesions,
  valveNames,
  valveSeverities,
  type EchoStudy,
} from "../src/echo-valve.js";

const SITE = "demo-kuwait";
const VERIFIED_ON = "2026-09-22";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: T | string): T =>
  typeof value === "string" ? JSON.parse(value) : value;

const evidenceSources = [
  {
    key: "ase-echo-reporting",
    version: "2025",
    title:
      "Guidelines for the Standardization of Adult Echocardiography Reporting",
    organization: "ASE",
    year: 2025,
    date: "2025-09-03",
    url: "https://www.asecho.org/guideline/guidelines-for-the-standardization-of-adult-echocardiography-reporting/",
    topic: "echo_reporting",
  },
  {
    key: "ase-diastolic",
    version: "2025",
    title:
      "Recommendations for the Evaluation of Left Ventricular Diastolic Function by Echocardiography and for HFpEF Diagnosis",
    organization: "ASE",
    year: 2025,
    date: "2025-07-03",
    url: "https://www.asecho.org/guideline/left-ventricular-diastolic-function-by-echo/",
    topic: "diastolic_function",
  },
  {
    key: "ase-right-heart",
    version: "2025",
    title:
      "Guidelines for the Echocardiographic Assessment of the Right Heart in Adults and Special Considerations in Pulmonary Hypertension",
    organization: "ASE",
    year: 2025,
    date: "2025-03-03",
    url: "https://www.asecho.org/guideline/right-heart-in-adults-pulmonary-hypertension/",
    topic: "right_heart",
  },
  {
    key: "ase-prosthetic-valve",
    version: "2024",
    title:
      "Guidelines for the Evaluation of Prosthetic Valve Function With Cardiovascular Imaging",
    organization: "ASE",
    year: 2024,
    date: "2024-01-03",
    url: "https://www.asecho.org/guideline/evaluation-of-prosthetic-valve-function/",
    topic: "prosthetic_valve",
  },
  {
    key: "ase-eacvi-chambers",
    version: "2015",
    title:
      "Recommendations for Cardiac Chamber Quantification by Echocardiography in Adults",
    organization: "ASE/EACVI",
    year: 2015,
    date: "2015-01-01",
    url: "https://www.asecho.org/guideline/cardiac-chamber-quantification-by-echo-in-adults/",
    topic: "chamber_quantification",
  },
  {
    key: "ase-native-regurgitation",
    version: "2017",
    title:
      "Recommendations for Noninvasive Evaluation of Native Valvular Regurgitation",
    organization: "ASE/SCMR",
    year: 2017,
    date: "2017-04-01",
    url: "https://www.asecho.org/guideline/native-valvular-regurgitation-by-echo/",
    topic: "native_valve_regurgitation",
  },
] as const;

type Candidate = {
  key: string;
  title: string;
  category: string;
  question: string;
  inputs: string[];
  evidence: [string, string][];
  tests: string[];
  ruleType: string;
};
const echoCandidates: Candidate[] = [
  {
    key: "echo.measurement-quality",
    title: "Echo measurement quality and method interpretation",
    category: "Measurement interpretation",
    question: "Which source is appropriate for current decision use?",
    inputs: ["study type", "formality", "quality", "method", "provenance"],
    evidence: [["ase-echo-reporting", "2025"]],
    tests: [
      "formal good-quality study",
      "new bedside limited study",
      "clinician override",
    ],
    ruleType: "investigation_follow_up",
  },
  {
    key: "echo.lv-chamber-classification",
    title: "LV chamber size and systolic function classification",
    category: "Chamber classification",
    question: "How should quantitative LV data be interpreted?",
    inputs: ["LV dimensions/volumes", "indexing", "LVEF method", "quality"],
    evidence: [
      ["ase-eacvi-chambers", "2015"],
      ["ase-echo-reporting", "2025"],
    ],
    tests: ["complete quantitative study", "missing BSA", "visual estimate"],
    ruleType: "diagnosis_support",
  },
  {
    key: "echo.rv-integrated-assessment",
    title: "Integrated RV size and function assessment",
    category: "Chamber classification",
    question: "What integrated RV state is supported?",
    inputs: [
      "RV dimensions",
      "FAC",
      "TAPSE",
      "S prime",
      "strain",
      "3D EF",
      "quality",
    ],
    evidence: [["ase-right-heart", "2025"]],
    tests: ["concordant normal", "discordant metrics", "limited study"],
    ruleType: "diagnosis_support",
  },
  {
    key: "echo.diastolic-function",
    title: "Diastolic function and filling-pressure assessment",
    category: "Diastolic function",
    question: "Can diastolic state be classified transparently?",
    inputs: [
      "mitral inflow",
      "e prime",
      "E/e prime",
      "TR velocity",
      "LA volume",
      "rhythm",
      "special population",
    ],
    evidence: [["ase-diastolic", "2025"]],
    tests: [
      "normal",
      "abnormal",
      "indeterminate",
      "unable to assess",
      "AF context",
    ],
    ruleType: "diagnosis_support",
  },
  {
    key: "echo.pulmonary-pressure",
    title: "Pulmonary-pressure probability review",
    category: "Pulmonary pressure",
    question:
      "What Echo probability/context is supported without diagnosing PH from one value?",
    inputs: [
      "TR velocity",
      "RA pressure",
      "RVSP/PASP",
      "RV/PA/IVC signs",
      "quality",
    ],
    evidence: [["ase-right-heart", "2025"]],
    tests: [
      "complete supporting signs",
      "single estimate only",
      "unmeasurable TR",
    ],
    ruleType: "diagnosis_support",
  },
  {
    key: "echo.aortic-dimension",
    title: "Aortic dimension interpretation and comparison",
    category: "Aorta",
    question:
      "Does aortic size require reviewed classification or surveillance?",
    inputs: ["level", "method", "diameter", "indexing", "prior study"],
    evidence: [["ase-echo-reporting", "2025"]],
    tests: ["stable", "changed value", "different method", "missing body size"],
    ruleType: "investigation_follow_up",
  },
  {
    key: "echo.change-lvef",
    title: "Clinically meaningful LV function change",
    category: "Significant change",
    question: "Does repeat imaging require HF/device reassessment?",
    inputs: ["current/prior LVEF", "method", "quality", "interval"],
    evidence: [["ase-echo-reporting", "2025"]],
    tests: [
      "decline",
      "improvement",
      "method mismatch",
      "poor-quality new study",
    ],
    ruleType: "investigation_follow_up",
  },
  {
    key: "echo.change-valve",
    title: "Clinically meaningful valve change",
    category: "Significant change",
    question: "Has a valve lesion changed enough to reassess its pathway?",
    inputs: [
      "current/prior integrated severity",
      "measurements",
      "quality",
      "interval",
    ],
    evidence: [
      ["ase-echo-reporting", "2025"],
      ["esc-eacts-vhd", "2025"],
    ],
    tests: ["progression", "improvement", "discordant values"],
    ruleType: "investigation_follow_up",
  },
  {
    key: "echo.prosthetic-change",
    title: "Prosthetic valve change from baseline",
    category: "Prosthetic assessment",
    question: "Does a prosthetic study require review or multimodal imaging?",
    inputs: [
      "prosthesis type/size",
      "baseline",
      "current/prior gradients",
      "regurgitation",
      "morphology",
    ],
    evidence: [["ase-prosthetic-valve", "2024"]],
    tests: [
      "stable baseline",
      "increased gradient",
      "new regurgitation",
      "no automatic thrombosis diagnosis",
    ],
    ruleType: "complication_pathway",
  },
  {
    key: "echo.internal-consistency",
    title: "Echo internal-consistency review",
    category: "Quality checks",
    question:
      "Are reported interpretation and supporting data internally coherent?",
    inputs: [
      "measurements",
      "reported severity",
      "methods",
      "units",
      "quality",
    ],
    evidence: [["ase-echo-reporting", "2025"]],
    tests: [
      "discordant AS",
      "unsupported severe MR",
      "impossible unit",
      "optional missing data",
    ],
    ruleType: "investigation_follow_up",
  },
];
const valveCandidates: Candidate[] = [
  {
    key: "valve.as-severity",
    title: "Multiparametric aortic stenosis severity",
    category: "AS",
    question: "What AS severity is supported by integrated data?",
    inputs: [
      "morphology",
      "Vmax",
      "mean gradient",
      "AVA/index",
      "DVI",
      "flow",
      "LVEF",
      "BP",
      "quality",
    ],
    evidence: [["esc-eacts-vhd", "2025"]],
    tests: ["concordant", "discordant", "low-flow", "measurement uncertainty"],
    ruleType: "diagnosis_support",
  },
  {
    key: "valve.as-discordant",
    title: "Discordant aortic stenosis evaluation",
    category: "AS",
    question: "Which additional evaluation is needed for discordant grading?",
    inputs: [
      "AVA",
      "gradient",
      "flow",
      "LVEF",
      "BP",
      "Doppler/LVOT quality",
      "CT/stress context",
    ],
    evidence: [["esc-eacts-vhd", "2025"]],
    tests: ["AVA-gradient discordance", "low flow", "technical limitation"],
    ruleType: "complication_pathway",
  },
  {
    key: "valve.as-intervention",
    title: "Aortic stenosis intervention assessment",
    category: "Intervention timing",
    question:
      "Is an intervention assessment supported and what remains missing?",
    inputs: [
      "confirmed severity",
      "symptoms",
      "LVEF",
      "exercise test",
      "risk markers",
      "age",
      "comorbidity",
      "anatomy",
      "preference",
    ],
    evidence: [["esc-eacts-vhd", "2025"]],
    tests: [
      "symptomatic severe",
      "asymptomatic with missing markers",
      "uncertain symptoms",
      "TAVI/SAVR factors",
    ],
    ruleType: "procedural_intervention_consideration",
  },
  {
    key: "valve.ar-severity-intervention",
    title: "Aortic regurgitation severity and intervention assessment",
    category: "AR",
    question:
      "Do integrated AR and LV/aortic consequences require intervention review?",
    inputs: [
      "multiparametric AR",
      "symptoms",
      "LV size/volumes",
      "LVEF",
      "aorta",
    ],
    evidence: [
      ["esc-eacts-vhd", "2025"],
      ["ase-native-regurgitation", "2017"],
    ],
    tests: ["severe with LV change", "asymptomatic", "discordant parameters"],
    ruleType: "procedural_intervention_consideration",
  },
  {
    key: "valve.primary-mr",
    title: "Primary MR severity and intervention assessment",
    category: "Primary MR",
    question:
      "Do mechanism, integrated severity and consequences require intervention review?",
    inputs: [
      "mechanism",
      "multiparametric MR",
      "symptoms",
      "LV/LA",
      "pulmonary pressure",
      "AF",
    ],
    evidence: [
      ["esc-eacts-vhd", "2025"],
      ["ase-native-regurgitation", "2017"],
    ],
    tests: [
      "severe symptomatic",
      "progressive LV change",
      "missing symptom state",
    ],
    ruleType: "procedural_intervention_consideration",
  },
  {
    key: "valve.secondary-mr",
    title: "Secondary MR integrated HF/intervention assessment",
    category: "Secondary MR",
    question:
      "Should secondary MR be reviewed after consuming HF optimization context?",
    inputs: [
      "MR severity",
      "HF phenotype/symptoms",
      "LVEF/LV size",
      "medication optimization",
      "CRT",
      "CAD",
      "RV/pulmonary context",
    ],
    evidence: [
      ["esc-eacts-vhd", "2025"],
      ["esc-hf", "2026"],
    ],
    tests: [
      "HFrEF context reused",
      "optimization missing",
      "CRT context reused",
    ],
    ruleType: "procedural_intervention_consideration",
  },
  {
    key: "valve.mitral-stenosis",
    title: "Mitral stenosis assessment",
    category: "MS",
    question:
      "What MS severity/intervention pathway is supported in rhythm and rate context?",
    inputs: [
      "morphology",
      "area",
      "gradient",
      "heart rate",
      "rhythm",
      "pulmonary pressure",
      "symptoms",
      "anatomy",
    ],
    evidence: [["esc-eacts-vhd", "2025"]],
    tests: ["rate contextualized", "missing rate", "anatomic suitability"],
    ruleType: "procedural_intervention_consideration",
  },
  {
    key: "valve.tricuspid-regurgitation",
    title: "Tricuspid regurgitation integrated assessment",
    category: "TR",
    question:
      "What TR state and intervention/surveillance review is supported?",
    inputs: [
      "mechanism",
      "severity",
      "RV/RA",
      "annulus",
      "hepatic flow",
      "pulmonary pressure",
      "right-HF symptoms",
      "leads",
      "left-sided disease",
    ],
    evidence: [
      ["esc-eacts-vhd", "2025"],
      ["ase-right-heart", "2025"],
    ],
    tests: [
      "severe TR with RV dysfunction",
      "device-related",
      "left-sided intervention context",
    ],
    ruleType: "procedural_intervention_consideration",
  },
  {
    key: "valve.multiple-disease",
    title: "Multiple valve disease integrated state",
    category: "Multiple valve disease",
    question: "How do dominant and secondary lesions interact?",
    inputs: [
      "all lesions",
      "hemodynamic interaction",
      "ventricular response",
      "symptoms",
      "uncertainty",
    ],
    evidence: [["esc-eacts-vhd", "2025"]],
    tests: ["severe AS plus MR", "mixed lesions", "uncertain dominant lesion"],
    ruleType: "complication_pathway",
  },
  {
    key: "valve.surveillance",
    title: "Valve surveillance interval and early triggers",
    category: "Surveillance",
    question: "When should clinical and Echo reassessment occur?",
    inputs: [
      "lesion/severity",
      "quality",
      "symptoms",
      "ventricular response",
      "progression",
      "special situations",
    ],
    evidence: [["esc-eacts-vhd", "2025"]],
    tests: [
      "accepted exact dates",
      "new symptoms supersede",
      "new severe Echo supersedes",
    ],
    ruleType: "follow_up_timing",
  },
  {
    key: "valve.heart-team",
    title: "Heart Team referral review",
    category: "Heart Team",
    question:
      "Does complexity or potential intervention warrant Heart Team workflow?",
    inputs: [
      "lesion",
      "intervention assessment",
      "risk",
      "anatomy",
      "comorbidity",
      "frailty",
      "patient preference",
    ],
    evidence: [["esc-eacts-vhd", "2025"]],
    tests: ["consider", "requested", "reviewed", "decision documented"],
    ruleType: "referral_consideration",
  },
  {
    key: "valve.prosthetic-surveillance",
    title: "Prosthetic valve and post-intervention surveillance",
    category: "Prosthetic surveillance",
    question: "What review is required relative to post-implant baseline?",
    inputs: [
      "prosthesis",
      "baseline Echo",
      "current/prior function",
      "regurgitation",
      "symptoms",
      "multimodal context",
    ],
    evidence: [
      ["esc-eacts-vhd", "2025"],
      ["ase-prosthetic-valve", "2024"],
    ],
    tests: [
      "stable",
      "gradient change",
      "paravalvular leak",
      "additional imaging",
      "no automatic mechanism diagnosis",
    ],
    ruleType: "follow_up_timing",
  },
  {
    key: "valve.procedure-strategy",
    title: "Valve procedural-strategy factors",
    category: "Procedure strategy",
    question:
      "Which patient/anatomic factors require Heart Team consideration?",
    inputs: [
      "age",
      "life expectancy",
      "anatomy",
      "access",
      "prior surgery",
      "CAD",
      "comorbidity",
      "frailty",
      "preference",
      "expertise",
    ],
    evidence: [["esc-eacts-vhd", "2025"]],
    tests: [
      "TAVI/SAVR factors",
      "repair/replacement factors",
      "no age-only output",
    ],
    ruleType: "procedural_intervention_consideration",
  },
];

const pathwaySeeds = [
  "severe-as",
  "discordant-as",
  "low-flow-low-gradient-as",
  "severe-ar",
  "primary-mr",
  "secondary-mr",
  "mitral-stenosis",
  "tricuspid-regurgitation",
  "multiple-valve-disease",
  "prosthetic-review",
  "post-intervention",
];

const measurementSchema = z
  .object({
    section: z.string().min(1).max(80),
    parameter_code: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string().min(1).max(160),
    value_number: z.number().finite().nullable(),
    value_text: z.string().max(500).nullable(),
    unit: z.string().max(30).default(""),
    method: z.string().max(120).default(""),
    context: z.string().max(120).default(""),
    sequence: z.number().int().min(0).default(0),
  })
  .strict()
  .refine(
    (v) => (v.value_number === null) !== (v.value_text === null),
    "Provide either a numeric or text value",
  );
const findingSchema = z
  .object({
    valve_name: z.enum(valveNames),
    lesion_type: z.enum(valveLesions),
    mechanism: z.string().max(500).default(""),
    clinician_severity: z.enum(valveSeverities),
    calculated_assessment: z.string().max(200).nullable().default(null),
    discordant: z.boolean().default(false),
    supporting_parameters: z.array(z.string().max(100)).max(30).default([]),
    morphology: z.string().max(1000).default(""),
    narrative: z.string().max(2000).default(""),
    override_reason: z.string().max(1000).default(""),
  })
  .strict();
const revisionBody = z
  .object({
    status: z.enum([
      "DRAFT",
      "PRELIMINARY",
      "FINAL",
      "AMENDED",
      "ENTERED_IN_ERROR",
    ]),
    indication: z.array(z.enum(echoIndications)).max(12),
    priority: z.enum(["ROUTINE", "URGENT", "CRITICAL"]).default("ROUTINE"),
    study_quality: z.enum([
      "GOOD",
      "ADEQUATE",
      "TECHNICALLY_LIMITED",
      "VERY_LIMITED",
    ]),
    quality_reasons: z.array(z.string().max(160)).max(10).default([]),
    rhythm_context: z.string().max(300).default(""),
    heart_rate: z.number().positive().max(350).nullable().default(null),
    blood_pressure: z.string().max(60).default(""),
    contrast_used: z.boolean().default(false),
    structured_findings: z.record(z.string(), z.any()).default({}),
    interpretation: z.string().max(10000).default(""),
    comparison_summary: z.string().max(5000).default(""),
    conclusion: z.string().max(10000).default(""),
    clinician_override_reason: z.string().max(2000).default(""),
    reporting_cardiologist: z.string().min(2).max(200),
    amendment_reason: z.string().max(1000).default(""),
    source_label: z.string().min(2).max(300),
    measurements: z.array(measurementSchema).max(200).default([]),
    valve_findings: z.array(findingSchema).max(20).default([]),
  })
  .strict();
const studySchema = revisionBody
  .extend({
    encounter_id: z.string().uuid().nullable().default(null),
    study_type: z.enum(
      echoStudyTypes.map(([value]) => value) as [any, ...any[]],
    ),
    formality: z.enum(["FORMAL", "BEDSIDE_LIMITED"]),
    performed_at: z.string().datetime(),
    location: z.string().max(300).default(""),
    comparison_study_id: z.string().uuid().nullable().default(null),
  })
  .strict();
export type EchoStudyInput = z.infer<typeof studySchema>;

async function ensurePatient(db: QueryDB, id: string) {
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
  id: string | null,
  patientId: string,
) {
  if (!id) return;
  if (
    !(
      await db.query(
        "SELECT id FROM care.encounter WHERE id=$1 AND patient_id=$2",
        [id, patientId],
      )
    ).rows[0]
  )
    throw new FoundationError(422, "Encounter does not belong to this patient");
}
function sourceQuality(input: { study_quality: string; formality: string }) {
  if (input.formality === "FORMAL" && input.study_quality === "GOOD")
    return "high" as const;
  if (input.formality === "FORMAL" && input.study_quality === "ADEQUATE")
    return "moderate" as const;
  return "low" as const;
}
function qualityChecks(input: z.infer<typeof revisionBody>) {
  const checks: {
    severity: "ERROR" | "IMPORTANT_REVIEW" | "OPTIONAL_COMPLETENESS";
    code: string;
    message: string;
    detail?: unknown;
  }[] = [];
  if (["FINAL", "AMENDED"].includes(input.status) && !input.conclusion.trim())
    checks.push({
      severity: "ERROR",
      code: "final_conclusion_missing",
      message:
        "A final or amended study requires a clinician-reviewed conclusion.",
    });
  if (!input.indication.length)
    checks.push({
      severity: "IMPORTANT_REVIEW",
      code: "indication_missing",
      message: "Study indication has not been recorded.",
    });
  const codes = new Set(input.measurements.map((item) => item.parameter_code));
  for (const finding of input.valve_findings) {
    if (
      finding.clinician_severity === "SEVERE" &&
      !finding.supporting_parameters.length
    )
      checks.push({
        severity: "IMPORTANT_REVIEW",
        code: `unsupported_severe_${finding.valve_name}_${finding.lesion_type}`,
        message: `${finding.valve_name} ${finding.lesion_type} is reported severe without linked supporting parameters.`,
      });
    if (
      finding.discordant ||
      finding.clinician_severity === "DISCORDANT_REQUIRES_CONFIRMATION"
    )
      checks.push({
        severity: "IMPORTANT_REVIEW",
        code: `discordant_${finding.valve_name}_${finding.lesion_type}`,
        message: `${finding.valve_name} findings are discordant and require clinician review.`,
      });
    if (
      finding.valve_name === "AORTIC" &&
      finding.lesion_type === "STENOSIS" &&
      finding.clinician_severity === "SEVERE" &&
      !["av_vmax", "av_mean_gradient", "ava"].some((code) => codes.has(code))
    )
      checks.push({
        severity: "IMPORTANT_REVIEW",
        code: "as_key_data_missing",
        message:
          "Severe AS interpretation has no key quantitative parameter recorded.",
      });
  }
  if (!codes.has("lvef"))
    checks.push({
      severity: "OPTIONAL_COMPLETENESS",
      code: "lvef_not_recorded",
      message: "LVEF is not recorded for this study.",
    });
  if (!Object.keys(input.structured_findings).length)
    checks.push({
      severity: "OPTIONAL_COMPLETENESS",
      code: "structured_sections_empty",
      message: "No structured chamber or non-valve findings are recorded.",
    });
  return checks;
}

async function appendTask(
  db: QueryDB,
  patientId: string,
  encounterId: string | null,
  kind: "clinical_review" | "reassessment" | "follow_up",
  purpose: string,
  date: string | null,
  sourceType: string,
  sourceId: string,
  actor: string,
) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO workflow.clinical_task(id,patient_id,encounter_id,kind,purpose,target_date,assigned_to,source_type,source_id,details,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$7)`,
    [
      id,
      patientId,
      encounterId,
      kind,
      purpose,
      date,
      actor,
      sourceType,
      sourceId,
      json({ echoValve: true, clinicianSelectedDate: !!date }),
    ],
  );
  await db.query(
    "INSERT INTO workflow.clinical_task_event(id,task_id,version,status,note,actor) VALUES($1,$2,1,'open','Created from structured Echo/valve workflow',$3)",
    [randomUUID(), id, actor],
  );
  return id;
}
async function supersedeTasks(
  db: QueryDB,
  patientId: string,
  sourceType: string,
  actor: string,
) {
  const rows = (
    await db.query<any>(
      `SELECT t.id,COALESCE(max(e.version),0)::int version FROM workflow.clinical_task t LEFT JOIN workflow.clinical_task_event e ON e.task_id=t.id WHERE t.patient_id=$1 AND t.source_type=$2 GROUP BY t.id`,
      [patientId, sourceType],
    )
  ).rows;
  for (const row of rows) {
    const latest = (
      await db.query<any>(
        "SELECT status FROM workflow.clinical_task_event WHERE task_id=$1 ORDER BY version DESC LIMIT 1",
        [row.id],
      )
    ).rows[0];
    if (
      latest &&
      !["completed", "cancelled", "superseded"].includes(latest.status)
    )
      await db.query(
        "INSERT INTO workflow.clinical_task_event(id,task_id,version,status,note,actor) VALUES($1,$2,$3,'superseded','New Echo or plan requires reassessment',$4)",
        [randomUUID(), row.id, Number(row.version) + 1, actor],
      );
  }
}

async function supersedeSurveillancePlans(
  db: QueryDB,
  patientId: string,
  valveName: string,
  lesionType: string,
  actor: string,
) {
  const rows = (
    await db.query<any>(
      `SELECT p.id,COALESCE(max(e.version),0)::int version
       FROM valve.surveillance_plan p
       LEFT JOIN valve.surveillance_status_event e ON e.plan_id=p.id
       WHERE p.patient_id=$1 AND p.valve_name=$2 AND p.lesion_type=$3
       GROUP BY p.id`,
      [patientId, valveName, lesionType],
    )
  ).rows;
  for (const row of rows) {
    const latest = (
      await db.query<any>(
        "SELECT status FROM valve.surveillance_status_event WHERE plan_id=$1 ORDER BY version DESC LIMIT 1",
        [row.id],
      )
    ).rows[0];
    if (latest?.status === "ACTIVE")
      await db.query(
        "INSERT INTO valve.surveillance_status_event(id,plan_id,version,status,reason,actor) VALUES($1,$2,$3,'SUPERSEDED','New finalized Echo requires a new surveillance decision',$4)",
        [randomUUID(), row.id, Number(row.version) + 1, actor],
      );
  }
}

async function insertRevision(
  db: DB,
  patientId: string,
  studyId: string,
  input: z.infer<typeof revisionBody>,
  actor: string,
  performedAt: string,
  formality: string,
  encounterId: string | null,
) {
  const version = (
    await db.query<{ version: number }>(
      "SELECT COALESCE(max(version),0)::int+1 version FROM imaging.echo_revision WHERE study_id=$1",
      [studyId],
    )
  ).rows[0].version;
  if (
    version > 1 &&
    input.status !== "AMENDED" &&
    input.status !== "ENTERED_IN_ERROR"
  )
    throw new FoundationError(
      422,
      "A later Echo revision must be an amendment or entered-in-error record",
    );
  const revisionId = randomUUID();
  await db.query(
    `INSERT INTO imaging.echo_revision(id,study_id,version,status,indication,priority,study_quality,quality_reasons,rhythm_context,heart_rate,blood_pressure,contrast_used,structured_findings,interpretation,comparison_summary,conclusion,clinician_override_reason,reporting_cardiologist,amendment_reason,source_label) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      revisionId,
      studyId,
      version,
      input.status,
      json(input.indication),
      input.priority,
      input.study_quality,
      json(input.quality_reasons),
      input.rhythm_context,
      input.heart_rate,
      input.blood_pressure,
      input.contrast_used,
      json(input.structured_findings),
      input.interpretation,
      input.comparison_summary,
      input.conclusion,
      input.clinician_override_reason,
      input.reporting_cardiologist,
      input.amendment_reason,
      input.source_label,
    ],
  );
  const final = ["FINAL", "AMENDED"].includes(input.status);
  if (final) await supersedeTasks(db, patientId, "echo_valve_review", actor);
  for (let index = 0; index < input.measurements.length; index++) {
    const measurement = input.measurements[index],
      id = randomUUID();
    let factId: string | null = null;
    if (final) {
      const conceptCode = `echo.${measurement.parameter_code}`;
      await db.query(
        "INSERT INTO clinical.terminology_concept(system,code,version,display,kind,created_by) VALUES('cardioflow',$1,1,$2,'investigation','system:stage4') ON CONFLICT DO NOTHING",
        [conceptCode, measurement.label],
      );
      const prior = (
        await db.query<any>(
          "SELECT * FROM clinical.fact WHERE patient_id=$1 AND source_type='echo_measurement' AND source_id=$2 AND concept_code=$3 ORDER BY version DESC LIMIT 1",
          [patientId, studyId, conceptCode],
        )
      ).rows[0];
      const fact = await recordClinicalFact(
        db,
        patientId,
        {
          logical_id: prior?.logical_id,
          concept_system: "cardioflow",
          concept_code: conceptCode,
          concept_version: 1,
          value: {
            type: "json",
            value: {
              value: measurement.value_number ?? measurement.value_text,
              unit: measurement.unit,
              method: measurement.method,
              context: measurement.context,
              studyId,
              revisionId,
            },
          },
          observed_at: performedAt,
          encounter_id: encounterId,
          source_type: "echo_measurement",
          source_id: studyId,
          source_label: input.source_label,
          source_quality: sourceQuality({
            study_quality: input.study_quality,
            formality,
          }),
          verification_status: "verified",
          lifecycle_status: "active",
          supersedes_fact_id: prior?.id ?? null,
        },
        actor,
      );
      factId = fact.id;
    }
    await db.query(
      `INSERT INTO imaging.echo_measurement(id,revision_id,section,parameter_code,label,value_number,value_text,unit,method,context,sequence,fact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        revisionId,
        measurement.section,
        measurement.parameter_code,
        measurement.label,
        measurement.value_number,
        measurement.value_text,
        measurement.unit,
        measurement.method,
        measurement.context,
        measurement.sequence ?? index,
        factId,
      ],
    );
  }
  for (const finding of input.valve_findings) {
    const id = randomUUID();
    let stateFactId: string | null = null;
    if (final) {
      const conceptCode = `valve.${finding.valve_name.toLowerCase()}.${finding.lesion_type.toLowerCase()}.severity`;
      await db.query(
        "INSERT INTO clinical.terminology_concept(system,code,version,display,kind,created_by) VALUES('cardioflow',$1,1,$2,'diagnosis','system:stage4') ON CONFLICT DO NOTHING",
        [conceptCode, `${finding.valve_name} ${finding.lesion_type} severity`],
      );
      const prior = (
        await db.query<any>(
          "SELECT * FROM clinical.fact WHERE patient_id=$1 AND source_type='echo_valve_finding' AND source_id=$2 AND concept_code=$3 ORDER BY version DESC LIMIT 1",
          [patientId, studyId, conceptCode],
        )
      ).rows[0];
      const fact = await recordClinicalFact(
        db,
        patientId,
        {
          logical_id: prior?.logical_id,
          concept_system: "cardioflow",
          concept_code: conceptCode,
          concept_version: 1,
          value: {
            type: "coded",
            code: finding.clinician_severity,
            display: finding.clinician_severity.replaceAll("_", " "),
          },
          observed_at: performedAt,
          encounter_id: encounterId,
          source_type: "echo_valve_finding",
          source_id: studyId,
          source_label: input.source_label,
          source_quality: sourceQuality({
            study_quality: input.study_quality,
            formality,
          }),
          verification_status: "verified",
          lifecycle_status: "active",
          supersedes_fact_id: prior?.id ?? null,
        },
        actor,
      );
      stateFactId = fact.id;
      const sourceType = `valve_surveillance_${finding.valve_name}_${finding.lesion_type}`;
      await supersedeTasks(db, patientId, sourceType, actor);
      await supersedeSurveillancePlans(
        db,
        patientId,
        finding.valve_name,
        finding.lesion_type,
        actor,
      );
      if (
        ["SEVERE", "DISCORDANT_REQUIRES_CONFIRMATION"].includes(
          finding.clinician_severity,
        ) ||
        finding.discordant
      )
        await appendTask(
          db,
          patientId,
          encounterId,
          "clinical_review",
          `${finding.valve_name} ${finding.lesion_type} assessment after finalized Echo`,
          performedAt.slice(0, 10),
          "echo_valve_review",
          studyId,
          actor,
        );
    }
    await db.query(
      `INSERT INTO imaging.valve_finding(id,revision_id,valve_name,lesion_type,mechanism,clinician_severity,calculated_assessment,discordant,supporting_parameters,morphology,narrative,override_reason,state_fact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        revisionId,
        finding.valve_name,
        finding.lesion_type,
        finding.mechanism,
        finding.clinician_severity,
        finding.calculated_assessment,
        finding.discordant,
        json(finding.supporting_parameters),
        finding.morphology,
        finding.narrative,
        finding.override_reason,
        stateFactId,
      ],
    );
    if (final)
      await db.query(
        `INSERT INTO valve.state_event(id,patient_id,valve_name,lesion_type,severity,mechanism,source_study_id,source_finding_id,quality,observed_at,author) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          randomUUID(),
          patientId,
          finding.valve_name,
          finding.lesion_type,
          finding.clinician_severity,
          finding.mechanism,
          studyId,
          id,
          input.study_quality,
          performedAt,
          actor,
        ],
      );
  }
  const checks = qualityChecks(input);
  for (const check of checks)
    await db.query(
      "INSERT INTO imaging.quality_check(id,revision_id,severity,code,message,detail) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        revisionId,
        check.severity,
        check.code,
        check.message,
        json(check.detail ?? {}),
      ],
    );
  if (
    final &&
    input.measurements.some((item) => item.parameter_code === "lvef")
  ) {
    await supersedeTasks(db, patientId, "heart_failure_echo_review", actor);
    const hf = (
      await db.query<any>(
        "SELECT r.phenotype_source_echo_id FROM heart_failure.profile p JOIN heart_failure.current_review r ON r.profile_id=p.id WHERE p.patient_id=$1",
        [patientId],
      )
    ).rows[0];
    if (hf?.phenotype_source_echo_id !== studyId)
      await appendTask(
        db,
        patientId,
        encounterId,
        "clinical_review",
        "Review HF phenotype after new cardiac imaging",
        performedAt.slice(0, 10),
        "heart_failure_echo_review",
        studyId,
        actor,
      );
  }
  return revisionId;
}

export async function createSharedEchoStudy(
  db: DB,
  patientId: string,
  raw: unknown,
  actor: string,
  legacy?: { type: string; id: string },
) {
  const input = studySchema.parse(raw);
  await ensurePatient(db, patientId);
  await ensureEncounter(db, input.encounter_id, patientId);
  if (
    input.comparison_study_id &&
    !(
      await db.query(
        "SELECT id FROM imaging.echo_study WHERE id=$1 AND patient_id=$2",
        [input.comparison_study_id, patientId],
      )
    ).rows[0]
  )
    throw new FoundationError(
      422,
      "Comparison study does not belong to this patient",
    );
  const id = legacy?.id ?? randomUUID();
  await db.query(
    `INSERT INTO imaging.echo_study(id,patient_id,encounter_id,study_type,formality,performed_at,location,comparison_study_id,legacy_source_type,legacy_source_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      patientId,
      input.encounter_id,
      input.study_type,
      input.formality,
      input.performed_at,
      input.location,
      input.comparison_study_id,
      legacy?.type ?? null,
      legacy?.id ?? null,
      actor,
    ],
  );
  const revisionId = await insertRevision(
    db,
    patientId,
    id,
    input,
    actor,
    input.performed_at,
    input.formality,
    input.encounter_id,
  );
  await audit(db, actor, "Echo study recorded", "echo_study", id, patientId, {
    revisionId,
    status: input.status,
    studyType: input.study_type,
  });
  return loadEchoStudy(db, id);
}

async function loadEchoStudy(db: QueryDB, id: string): Promise<EchoStudy> {
  const row = (
    await db.query<any>(
      "SELECT * FROM imaging.current_echo_revision WHERE study_id=$1",
      [id],
    )
  ).rows[0];
  if (!row) throw new FoundationError(404, "Echo study not found");
  const [measurements, findings, checks] = await Promise.all([
    db.query<any>(
      "SELECT * FROM imaging.echo_measurement WHERE revision_id=$1 ORDER BY section,sequence,parameter_code",
      [row.revision_id],
    ),
    db.query<any>(
      "SELECT * FROM imaging.valve_finding WHERE revision_id=$1 ORDER BY valve_name,lesion_type",
      [row.revision_id],
    ),
    db.query<any>(
      "SELECT severity,code,message FROM imaging.quality_check WHERE revision_id=$1 ORDER BY CASE severity WHEN 'ERROR' THEN 1 WHEN 'IMPORTANT_REVIEW' THEN 2 ELSE 3 END,code",
      [row.revision_id],
    ),
  ]);
  return {
    ...row,
    performed_at: new Date(row.performed_at).toISOString(),
    revision_created_at: new Date(row.revision_created_at).toISOString(),
    indication: parse(row.indication ?? []),
    quality_reasons: parse(row.quality_reasons ?? []),
    structured_findings: parse(row.structured_findings ?? {}),
    measurements: measurements.rows,
    valve_findings: findings.rows.map((item) => ({
      ...item,
      supporting_parameters: parse(item.supporting_parameters ?? []),
    })),
    quality_checks: checks.rows,
  } as EchoStudy;
}
export async function loadEchoStudies(db: QueryDB, patientId: string) {
  const ids = (
    await db.query<{ study_id: string }>(
      "SELECT study_id FROM imaging.current_echo_revision WHERE patient_id=$1 ORDER BY performed_at DESC",
      [patientId],
    )
  ).rows;
  return Promise.all(ids.map((row) => loadEchoStudy(db, row.study_id)));
}

async function seedCandidate(
  db: QueryDB,
  candidate: Candidate,
  domain: "echo" | "valve",
) {
  if (
    (
      await db.query(
        "SELECT key FROM decision_support.rule_definition WHERE key=$1 AND version=1",
        [candidate.key],
      )
    ).rows[0]
  )
    return;
  const rule = {
    key: candidate.key,
    version: 1,
    status: "draft",
    topic: domain,
    priority: 3,
    trigger: {
      kind: "fact",
      conceptCode: "governance.stage4_rule_licensed_tested_reviewed",
      operator: "equals",
      value: candidate.key,
    },
    output: {
      title: candidate.title,
      recommendation:
        "Candidate logic is blocked pending licensed evidence extraction, boundary tests and independent clinical review.",
    },
    evidence: candidate.evidence.map(([key, version]) => ({ key, version })),
    reviewContract: {
      clinicalQuestion: candidate.question,
      inputs: candidate.inputs,
      plannedTests: candidate.tests,
      publicationBlockers: [
        "Software-use permission where required",
        "Exact independently authored logic and exclusions",
        "Passing boundary and contradiction tests",
        "Independent maker-checker approval",
      ],
    },
  };
  const serialized = json(rule);
  await db.query(
    `INSERT INTO decision_support.rule_definition(key,version,topic,status,priority,definition,checksum,created_by,site_id,title,clinical_domain,subdomain,rule_type,patient_population,required_data,optional_supporting_data,exclusion_criteria,contraindications,caution_conditions,urgency,recommendation_category,follow_up_implications,author,changelog,review_due_date,test_status,fixture) VALUES($1,1,$2,'draft',3,$3,$4,'system:stage4-author',$5,$6,$2,$7,$8,'{}',$9,'[]','[]','[]','[]','routine','clinical_review','{}','system:stage4-author',$10,'2027-09-22','not_run',false)`,
    [
      candidate.key,
      domain,
      serialized,
      hash(serialized),
      SITE,
      candidate.title,
      candidate.category,
      candidate.ruleType,
      json(candidate.inputs),
      "Initial non-executable Stage 4 candidate",
    ],
  );
  for (const [key, version] of candidate.evidence)
    await db.query(
      "INSERT INTO decision_support.rule_evidence(rule_key,rule_version,evidence_key,evidence_version,relationship,added_by) VALUES($1,1,$2,$3,'primary','system:stage4-author')",
      [candidate.key, key, version],
    );
  await db.query(
    "INSERT INTO decision_support.rule_lifecycle_event(id,rule_key,rule_version,site_id,state,comment,actor) VALUES($1,$2,1,$3,'DRAFT','Initial non-executable Stage 4 candidate','system:stage4-author')",
    [randomUUID(), candidate.key, SITE],
  );
  await db.query(
    "INSERT INTO decision_support.rule_lifecycle_event(id,rule_key,rule_version,site_id,state,comment,actor) VALUES($1,$2,1,$3,'CLINICAL_REVIEW','Blocked pending licensed evidence extraction, tests and independent review','system:stage4-author')",
    [randomUUID(), candidate.key, SITE],
  );
}

export async function initializeEchoValve(db: DB) {
  for (const source of evidenceSources) {
    await db.query(
      `INSERT INTO decision_support.evidence_source(key,version,title,organization,publication_year,locator,reviewed_at,status,metadata,created_by,topic,source_kind,publication_date,authoritative_url,last_verified_at,next_review_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,'approved',$8,'system:stage4',$9,'guideline',$10,$6,$7,'2027-09-22',$11) ON CONFLICT DO NOTHING`,
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
            "metadata-and-citation-only; software-use permission required where applicable",
        }),
        source.topic,
        source.date,
        "Catalogue metadata only. Exact clinical logic requires authorized source use and independent review.",
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
        "INSERT INTO decision_support.evidence_status_event(id,evidence_key,evidence_version,status,reason,actor) VALUES($1,$2,$3,'current','Verified against official publisher metadata','system:stage4')",
        [randomUUID(), source.key, source.version],
      );
  }
  for (const item of measurementCatalog)
    await db.query(
      "INSERT INTO clinical.terminology_concept(system,code,version,display,kind,created_by) VALUES('cardioflow',$1,1,$2,'investigation','system:stage4') ON CONFLICT DO NOTHING",
      [`echo.${item[0]}`, item[1]],
    );
  for (const key of pathwaySeeds) {
    const title = key
        .replaceAll("-", " ")
        .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
      definition = {
        key: `valve.${key}`,
        version: 1,
        title,
        start: "known",
        nodes: [
          {
            id: "known",
            type: "action",
            title: "What we know",
            next: "missing",
          },
          {
            id: "missing",
            type: "action",
            title: "What is missing and why it matters",
            next: "decision",
          },
          {
            id: "decision",
            type: "terminal",
            title: "Clinician decision and next action",
            why: "Structured review only; unpublished clinical thresholds cannot execute.",
          },
        ],
      };
    await db.query(
      "INSERT INTO decision_support.pathway_definition(key,version,title,status,definition,checksum,created_by) VALUES($1,1,$2,'active',$3,$4,'system:stage4') ON CONFLICT DO NOTHING",
      [`valve.${key}`, title, json(definition), hash(json(definition))],
    );
  }
  for (const candidate of echoCandidates)
    await seedCandidate(db, candidate, "echo");
  for (const candidate of valveCandidates)
    await seedCandidate(db, candidate, "valve");
  const legacy = (
    await db.query<any>(
      `SELECT e.*,p.patient_id FROM heart_failure.echo_observation e JOIN heart_failure.profile p ON p.id=e.profile_id WHERE NOT EXISTS (SELECT 1 FROM imaging.echo_study s WHERE s.legacy_source_type='heart_failure.echo_observation' AND s.legacy_source_id=e.id)`,
    )
  ).rows;
  for (const row of legacy)
    await createSharedEchoStudy(
      db,
      row.patient_id,
      {
        encounter_id: row.encounter_id,
        study_type:
          row.study_type === "FORMAL_TTE"
            ? "COMPLETE_TTE"
            : row.study_type === "LIMITED_TTE"
              ? "LIMITED_TTE"
              : ["TEE", "OTHER"].includes(row.study_type)
                ? row.study_type
                : "OTHER",
        formality:
          row.study_type === "FORMAL_TTE" ? "FORMAL" : "BEDSIDE_LIMITED",
        performed_at: new Date(row.observed_at).toISOString(),
        location: "",
        comparison_study_id: null,
        status: "FINAL",
        indication: ["Heart failure"],
        priority: "ROUTINE",
        study_quality:
          row.study_quality === "FAIR"
            ? "ADEQUATE"
            : row.study_quality === "POOR"
              ? "TECHNICALLY_LIMITED"
              : row.study_quality === "NOT_RECORDED"
                ? "ADEQUATE"
                : row.study_quality,
        quality_reasons: [],
        rhythm_context: "",
        heart_rate: null,
        blood_pressure: "",
        contrast_used: false,
        structured_findings: {
          rvFunction: row.rv_function,
          pulmonaryPressureContext: row.pulmonary_pressure_context,
          diastolicContext: row.diastolic_context,
          pericardialContext: row.pericardial_context,
          structuralContext: row.structural_context,
          legacyValveSummary: parse(row.valve_summary ?? []),
        },
        interpretation: row.structural_context ?? "",
        comparison_summary: "",
        conclusion:
          row.structural_context || "Legacy finalized HF imaging record",
        clinician_override_reason: "",
        reporting_cardiologist: row.author,
        amendment_reason: "",
        source_label: row.source_label,
        measurements:
          row.lvef === null
            ? []
            : [
                {
                  section: "LV",
                  parameter_code: "lvef",
                  label: "LVEF",
                  value_number: Number(row.lvef),
                  value_text: null,
                  unit: "%",
                  method: "Legacy HF imaging record",
                  context: "",
                  sequence: 0,
                },
              ],
        valve_findings: [],
      },
      row.author,
      { type: "heart_failure.echo_observation", id: row.id },
    );
}

export async function loadEchoValveState(db: QueryDB, patientId: string) {
  await ensurePatient(db, patientId);
  const studies = await loadEchoStudies(db, patientId),
    clinical = await loadClinicalState(db, patientId),
    preferredSource = clinical.concepts.find(
      (item) => item.concept_code === "echo.lvef",
    )?.current?.source_id,
    preferred =
      studies.find((item) => item.study_id === preferredSource) ??
      preferredEchoStudy(studies);
  const previous = preferred
    ? (studies
        .filter(
          (item) =>
            item.study_id !== preferred.study_id &&
            ["FINAL", "AMENDED"].includes(item.status),
        )
        .sort(
          (a, b) =>
            new Date(b.performed_at).getTime() -
            new Date(a.performed_at).getTime(),
        )[0] ?? null)
    : null;
  const [
    states,
    pathways,
    heartTeam,
    prostheses,
    procedures,
    surveillance,
    tasks,
  ] = await Promise.all([
    db.query<any>(
      "SELECT * FROM valve.current_state WHERE patient_id=$1 ORDER BY valve_name,lesion_type",
      [patientId],
    ),
    db.query<any>(
      "SELECT * FROM valve.pathway_assessment WHERE patient_id=$1 ORDER BY observed_at DESC",
      [patientId],
    ),
    db.query<any>(
      "SELECT * FROM valve.heart_team_event WHERE patient_id=$1 ORDER BY observed_at DESC",
      [patientId],
    ),
    db.query<any>(
      "SELECT * FROM valve.prosthesis WHERE patient_id=$1 ORDER BY implanted_on DESC NULLS LAST",
      [patientId],
    ),
    db.query<any>(
      "SELECT * FROM valve.procedure_record WHERE patient_id=$1 ORDER BY procedure_date DESC",
      [patientId],
    ),
    db.query<any>(
      `SELECT p.*,e.status current_status,e.reason status_reason FROM valve.surveillance_plan p LEFT JOIN valve.surveillance_status_event e ON e.plan_id=p.id AND e.version=(SELECT max(v.version) FROM valve.surveillance_status_event v WHERE v.plan_id=p.id) WHERE p.patient_id=$1 ORDER BY p.created_at DESC`,
      [patientId],
    ),
    db.query<any>(
      `SELECT t.*,e.status current_status FROM workflow.clinical_task t LEFT JOIN workflow.clinical_task_event e ON e.task_id=t.id AND e.version=(SELECT max(v.version) FROM workflow.clinical_task_event v WHERE v.task_id=t.id) WHERE t.patient_id=$1 AND (t.source_type LIKE 'valve_%' OR t.source_type='echo_valve_review') ORDER BY t.target_date NULLS LAST,t.created_at DESC`,
      [patientId],
    ),
  ]);
  return {
    studies,
    latestStudy:
      studies.sort(
        (a, b) =>
          new Date(b.performed_at).getTime() -
          new Date(a.performed_at).getTime(),
      )[0] ?? null,
    preferredStudy: preferred,
    previousStudy: previous,
    comparison: preferred ? compareEchoStudies(preferred, previous) : [],
    currentValues: clinical.concepts.filter(
      (item) =>
        item.concept_code.startsWith("echo.") ||
        item.concept_code.startsWith("valve."),
    ),
    valveStates: states.rows,
    pathways: pathways.rows.map((item) => ({
      ...item,
      known_data: parse(item.known_data),
      missing_data: parse(item.missing_data),
      strategy_factors: parse(item.strategy_factors),
    })),
    heartTeam: heartTeam.rows,
    prostheses: prostheses.rows,
    procedures: procedures.rows.map((item) => ({
      ...item,
      complications: parse(item.complications),
      follow_up_plan: parse(item.follow_up_plan),
    })),
    surveillance: surveillance.rows.map((item) => ({
      ...item,
      early_review_triggers: parse(item.early_review_triggers),
    })),
    tasks: tasks.rows,
    clinical,
  };
}

const pathwayInput = z
  .object({
    encounter_id: z.string().uuid().nullable().default(null),
    pathway_type: z.enum([
      "SEVERE_AS",
      "DISCORDANT_AS",
      "LOW_FLOW_LOW_GRADIENT_AS",
      "SEVERE_AR",
      "PRIMARY_MR",
      "SECONDARY_MR",
      "MITRAL_STENOSIS",
      "TRICUSPID_REGURGITATION",
      "MULTIPLE_VALVE_DISEASE",
      "PROSTHETIC_REVIEW",
      "POST_INTERVENTION",
    ]),
    source_study_id: z.string().uuid().nullable().default(null),
    state: z.string().min(2).max(300),
    known_data: z.array(z.string().max(500)).max(30).default([]),
    missing_data: z.array(z.string().max(500)).max(30).default([]),
    why_it_matters: z.string().max(2000).default(""),
    next_decision: z.string().max(2000).default(""),
    strategy_factors: z.array(z.string().max(500)).max(30).default([]),
    evidence_note: z.string().max(1000).default(""),
    observed_at: z.string().datetime(),
  })
  .strict();

export function mountEchoValve(
  app: Express,
  db: DB,
  read: RequestHandler,
  write: RequestHandler,
) {
  app.get("/api/patients/:id/echo-valve", read, async (req, res) =>
    res.json(await loadEchoValveState(db, String(req.params.id))),
  );
  app.get("/api/echo-studies/:id", read, async (req, res) =>
    res.json(await loadEchoStudy(db, String(req.params.id))),
  );
  app.post("/api/patients/:id/echo-studies", write, async (req, res) => {
    const actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
    res
      .status(201)
      .json(
        await createSharedEchoStudy(db, String(req.params.id), req.body, actor),
      );
  });
  app.post("/api/echo-studies/:id/revisions", write, async (req, res) => {
    const study = (
      await db.query<any>("SELECT * FROM imaging.echo_study WHERE id=$1", [
        z.string().uuid().parse(String(req.params.id)),
      ])
    ).rows[0];
    if (!study) throw new FoundationError(404, "Echo study not found");
    const body = revisionBody.parse(req.body),
      actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
    const revisionId = await insertRevision(
      db,
      study.patient_id,
      study.id,
      body,
      actor,
      new Date(study.performed_at).toISOString(),
      study.formality,
      study.encounter_id,
    );
    await audit(
      db,
      actor,
      "Echo study amended",
      "echo_revision",
      revisionId,
      study.patient_id,
      { studyId: study.id },
    );
    res.status(201).json(await loadEchoStudy(db, study.id));
  });
  app.get("/api/echo-studies/:id/report-draft", read, async (req, res) => {
    const study = await loadEchoStudy(db, String(req.params.id));
    const groups = new Map<string, string[]>();
    for (const item of study.measurements)
      groups.set(item.section, [
        ...(groups.get(item.section) ?? []),
        `${item.label}: ${item.value_number ?? item.value_text}${item.unit ? ` ${item.unit}` : ""}${item.method ? ` (${item.method})` : ""}`,
      ]);
    const lines = [
      "ECHOCARDIOGRAPHY REPORT — DRAFT FOR CARDIOLOGIST REVIEW",
      `Study: ${study.source_label}`,
      `Date: ${study.performed_at.slice(0, 10)}`,
      `Indication: ${study.indication.join(", ") || "Not recorded"}`,
      `Quality: ${study.study_quality}${study.quality_reasons.length ? ` — ${study.quality_reasons.join(", ")}` : ""}`,
      ...[...groups].flatMap(([section, values]) => [
        `\n${section}`,
        ...values,
      ]),
      ...study.valve_findings.flatMap((item) => [
        `\n${item.valve_name} VALVE`,
        `${item.lesion_type}: ${item.clinician_severity}${item.mechanism ? `; ${item.mechanism}` : ""}`,
      ]),
      "\nCOMPARISON",
      study.comparison_summary || "No comparison statement recorded.",
      "\nCONCLUSION",
      study.conclusion || "Cardiologist conclusion required.",
      "\nThis draft is generated from structured data and requires cardiologist editing and final approval.",
    ];
    res.json({ draft: lines.join("\n"), requiresApproval: true });
  });
  app.post("/api/patients/:id/valve/pathways", write, async (req, res) => {
    const person = await ensurePatient(db, String(req.params.id)),
      input = pathwayInput.parse(req.body),
      actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
    await ensureEncounter(db, input.encounter_id, person.id);
    if (
      input.source_study_id &&
      !(
        await db.query(
          "SELECT id FROM imaging.echo_study WHERE id=$1 AND patient_id=$2",
          [input.source_study_id, person.id],
        )
      ).rows[0]
    )
      throw new FoundationError(422, "Source study does not belong to patient");
    const id = randomUUID();
    const row = (
      await db.query<any>(
        `INSERT INTO valve.pathway_assessment(id,patient_id,encounter_id,pathway_type,source_study_id,state,known_data,missing_data,why_it_matters,next_decision,strategy_factors,evidence_note,observed_at,author) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          id,
          person.id,
          input.encounter_id,
          input.pathway_type,
          input.source_study_id,
          input.state,
          json(input.known_data),
          json(input.missing_data),
          input.why_it_matters,
          input.next_decision,
          json(input.strategy_factors),
          input.evidence_note,
          input.observed_at,
          actor,
        ],
      )
    ).rows[0];
    await audit(
      db,
      actor,
      "Valve pathway assessment recorded",
      "valve_pathway",
      id,
      person.id,
      { pathwayType: input.pathway_type },
    );
    res.status(201).json(row);
  });
  app.post("/api/patients/:id/valve/heart-team", write, async (req, res) => {
    const person = await ensurePatient(db, String(req.params.id)),
      input = z
        .object({
          encounter_id: z.string().uuid().nullable().default(null),
          source_pathway_id: z.string().uuid().nullable().default(null),
          status: z.enum([
            "NOT_CURRENTLY_REQUIRED",
            "CONSIDER",
            "REFERRAL_REQUESTED",
            "REVIEWED",
            "DECISION_DOCUMENTED",
            "PROCEDURE_PLANNED",
          ]),
          decision: z.string().max(2000).default(""),
          rationale: z.string().max(2000).default(""),
          planned_date: z.string().date().nullable().default(null),
          observed_at: z.string().datetime(),
        })
        .strict()
        .parse(req.body),
      actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
    await ensureEncounter(db, input.encounter_id, person.id);
    const id = randomUUID();
    const row = (
      await db.query<any>(
        `INSERT INTO valve.heart_team_event(id,patient_id,encounter_id,source_pathway_id,status,decision,rationale,planned_date,observed_at,author) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          id,
          person.id,
          input.encounter_id,
          input.source_pathway_id,
          input.status,
          input.decision,
          input.rationale,
          input.planned_date,
          input.observed_at,
          actor,
        ],
      )
    ).rows[0];
    if (input.planned_date)
      await appendTask(
        db,
        person.id,
        input.encounter_id,
        "follow_up",
        "Heart Team review",
        input.planned_date,
        "valve_heart_team",
        id,
        actor,
      );
    res.status(201).json(row);
  });
  app.post("/api/patients/:id/valve/surveillance", write, async (req, res) => {
    const person = await ensurePatient(db, String(req.params.id)),
      input = z
        .object({
          encounter_id: z.string().uuid().nullable().default(null),
          valve_name: z.enum(valveNames),
          lesion_type: z.enum(valveLesions),
          source_study_id: z.string().uuid().nullable().default(null),
          echo_date: z.string().date().nullable().default(null),
          clinical_review_date: z.string().date().nullable().default(null),
          acceptable_start: z.string().date().nullable().default(null),
          acceptable_end: z.string().date().nullable().default(null),
          early_review_triggers: z
            .array(z.string().max(300))
            .max(20)
            .default([]),
          rationale: z.string().min(2).max(2000),
        })
        .strict()
        .parse(req.body),
      actor = res.locals.session.email ?? `demo:${res.locals.session.role}`,
      sourceType = `valve_surveillance_${input.valve_name}_${input.lesion_type}`;
    await ensureEncounter(db, input.encounter_id, person.id);
    await supersedeTasks(db, person.id, sourceType, actor);
    const prior = (
      await db.query<any>(
        `SELECT p.id FROM valve.surveillance_plan p LEFT JOIN valve.surveillance_status_event e ON e.plan_id=p.id AND e.version=(SELECT max(v.version) FROM valve.surveillance_status_event v WHERE v.plan_id=p.id) WHERE p.patient_id=$1 AND p.valve_name=$2 AND p.lesion_type=$3 AND COALESCE(e.status,p.status)='ACTIVE' ORDER BY p.created_at DESC LIMIT 1`,
        [person.id, input.valve_name, input.lesion_type],
      )
    ).rows[0];
    if (prior)
      await db.query(
        "INSERT INTO valve.surveillance_status_event(id,plan_id,version,status,reason,actor) VALUES($1,$2,2,'SUPERSEDED','Replaced by newer clinician-confirmed surveillance plan',$3)",
        [randomUUID(), prior.id, actor],
      );
    const id = randomUUID(),
      echoTask = input.echo_date
        ? await appendTask(
            db,
            person.id,
            input.encounter_id,
            "reassessment",
            `Repeat Echo — ${input.valve_name} ${input.lesion_type}`,
            input.echo_date,
            sourceType,
            id,
            actor,
          )
        : null,
      clinicTask = input.clinical_review_date
        ? await appendTask(
            db,
            person.id,
            input.encounter_id,
            "follow_up",
            `Valve clinical review — ${input.valve_name} ${input.lesion_type}`,
            input.clinical_review_date,
            sourceType,
            id,
            actor,
          )
        : null;
    const row = (
      await db.query<any>(
        `INSERT INTO valve.surveillance_plan(id,patient_id,encounter_id,valve_name,lesion_type,source_study_id,echo_date,clinical_review_date,acceptable_start,acceptable_end,early_review_triggers,rationale,echo_task_id,clinical_task_id,supersedes_plan_id,author) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
          id,
          person.id,
          input.encounter_id,
          input.valve_name,
          input.lesion_type,
          input.source_study_id,
          input.echo_date,
          input.clinical_review_date,
          input.acceptable_start,
          input.acceptable_end,
          json(input.early_review_triggers),
          input.rationale,
          echoTask,
          clinicTask,
          prior?.id ?? null,
          actor,
        ],
      )
    ).rows[0];
    await db.query(
      "INSERT INTO valve.surveillance_status_event(id,plan_id,version,status,reason,actor) VALUES($1,$2,1,'ACTIVE','Clinician-confirmed surveillance dates',$3)",
      [randomUUID(), id, actor],
    );
    res.status(201).json(row);
  });
  app.post("/api/patients/:id/valve/prostheses", write, async (req, res) => {
    const person = await ensurePatient(db, String(req.params.id)),
      input = z
        .object({
          position: z.enum(["AORTIC", "MITRAL", "TRICUSPID", "PULMONARY"]),
          prosthesis_type: z.enum([
            "MECHANICAL",
            "BIOPROSTHETIC",
            "TRANSCATHETER",
            "REPAIR",
            "OTHER",
            "UNKNOWN",
          ]),
          manufacturer: z.string().max(200).default(""),
          model: z.string().max(200).default(""),
          size_label: z.string().max(100).default(""),
          implanted_on: z.string().date().nullable().default(null),
          implantation_route: z.enum([
            "SURGICAL",
            "TRANSCATHETER",
            "REPAIR",
            "UNKNOWN",
          ]),
          baseline_echo_id: z.string().uuid().nullable().default(null),
          antithrombotic_context: z.string().max(1000).default(""),
        })
        .strict()
        .parse(req.body),
      actor = res.locals.session.email ?? `demo:${res.locals.session.role}`,
      id = randomUUID();
    const row = (
      await db.query<any>(
        `INSERT INTO valve.prosthesis(id,patient_id,position,prosthesis_type,manufacturer,model,size_label,implanted_on,implantation_route,baseline_echo_id,antithrombotic_context,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          id,
          person.id,
          input.position,
          input.prosthesis_type,
          input.manufacturer,
          input.model,
          input.size_label,
          input.implanted_on,
          input.implantation_route,
          input.baseline_echo_id,
          input.antithrombotic_context,
          actor,
        ],
      )
    ).rows[0];
    res.status(201).json(row);
  });
  app.post("/api/patients/:id/valve/procedures", write, async (req, res) => {
    const person = await ensurePatient(db, String(req.params.id)),
      input = z
        .object({
          encounter_id: z.string().uuid().nullable().default(null),
          procedure_type: z.enum([
            "TAVI",
            "SAVR",
            "MITRAL_REPAIR",
            "MITRAL_REPLACEMENT",
            "TEER",
            "BALLOON_MITRAL_COMMISSUROTOMY",
            "TRICUSPID_REPAIR",
            "TRICUSPID_REPLACEMENT",
            "TRANSCATHETER_TRICUSPID_INTERVENTION",
            "OTHER_STRUCTURAL",
          ]),
          procedure_date: z.string().date(),
          indication: z.string().min(2).max(2000),
          prosthesis_id: z.string().uuid().nullable().default(null),
          operator_team: z.string().max(500).default(""),
          complications: z.array(z.string().max(500)).default([]),
          result: z.string().max(2000).default(""),
          conduction_context: z.string().max(1000).default(""),
          follow_up_plan: z.record(z.string(), z.string().max(500)).default({}),
        })
        .strict()
        .parse(req.body),
      actor = res.locals.session.email ?? `demo:${res.locals.session.role}`;
    await ensureEncounter(db, input.encounter_id, person.id);
    const id = randomUUID(),
      row = (
        await db.query<any>(
          `INSERT INTO valve.procedure_record(id,patient_id,encounter_id,procedure_type,procedure_date,indication,prosthesis_id,operator_team,complications,result,conduction_context,follow_up_plan,author) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [
            id,
            person.id,
            input.encounter_id,
            input.procedure_type,
            input.procedure_date,
            input.indication,
            input.prosthesis_id,
            input.operator_team,
            json(input.complications),
            input.result,
            input.conduction_context,
            json(input.follow_up_plan),
            actor,
          ],
        )
      ).rows[0];
    res.status(201).json(row);
  });
  app.get("/api/echo-valve/review-pack", read, async (req, res) => {
    const domain = String(req.query.domain ?? "");
    if (!["echo", "valve"].includes(domain))
      throw new FoundationError(422, "domain must be echo or valve");
    const rows = (
      await db.query<any>(
        `SELECT r.key,r.version,r.title,r.subdomain category,r.rule_type,r.definition,r.lifecycle_state,r.test_status,r.recommendation_class,r.evidence_level,COALESCE(json_agg(json_build_object('key',e.evidence_key,'version',e.evidence_version)) FILTER (WHERE e.evidence_key IS NOT NULL),'[]') evidence FROM decision_support.rule_current_state r LEFT JOIN decision_support.rule_evidence e ON e.rule_key=r.key AND e.rule_version=r.version WHERE r.site_id=$1 AND r.clinical_domain=$2 GROUP BY r.key,r.version,r.title,r.subdomain,r.rule_type,r.definition,r.lifecycle_state,r.test_status,r.recommendation_class,r.evidence_level ORDER BY r.key`,
        [SITE, domain],
      )
    ).rows;
    res.json(
      rows.map((row) => ({
        ...row,
        definition: parse(row.definition),
        evidence: parse(row.evidence),
      })),
    );
  });
}

export { echoCandidates, valveCandidates };
