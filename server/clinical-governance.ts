import type {
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB, QueryDB } from "./db.js";
import { FoundationError, recalculatePatient } from "./clinical-foundation.js";
import { today } from "./domain.js";
import type {
  ClinicalRule,
  RuleCondition,
} from "../src/clinical-foundation.js";

const SITE = "demo-kuwait";
const IMPLEMENTATION_DATE = "2026-09-22";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export type Capability =
  "clinical_rule_maker" | "clinical_rule_reviewer" | "technical_admin";
type GovernanceSession = {
  actor: string;
  role: string;
  email?: string;
};

const ruleTypes = [
  "diagnosis_support",
  "treatment_opportunity",
  "contraindication",
  "caution",
  "drug_interaction",
  "medication_monitoring",
  "dose_consideration",
  "dose_titration",
  "investigation_indication",
  "investigation_follow_up",
  "device_consideration",
  "procedural_intervention_consideration",
  "follow_up_timing",
  "laboratory_monitoring",
  "complication_pathway",
  "referral_consideration",
  "perioperative_recommendation",
  "risk_assessment",
  "preventive_care",
] as const;
const recommendationCategories = [
  "critical",
  "warning",
  "monitoring",
  "clinical_review",
  "treatment_opportunity",
  "informational",
] as const;
const alertSeverity = [
  "critical",
  "high",
  "moderate",
  "low",
  "information",
] as const;

const evidenceSeeds = [
  {
    key: "esc-hf",
    version: "2026",
    title: "2026 ESC Guidelines for the management of heart failure",
    organization: "ESC",
    topic: "heart_failure",
    publicationYear: 2026,
    publicationDate: "2026-08-28",
    url: "https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/heart-failure/",
    notes:
      "Primary cardiovascular framework candidate for the Kuwait/GCC pilot. Individual rules still require independent review.",
  },
  {
    key: "esc-eacts-vhd",
    version: "2025",
    title:
      "2025 ESC/EACTS Guidelines for the management of valvular heart disease",
    organization: "ESC/EACTS",
    topic: "valvular_heart_disease",
    publicationYear: 2025,
    publicationDate: "2025-08-29",
    url: "https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/valvular-heart-disease/",
    notes:
      "Catalogue metadata only; no intervention threshold is activated by this source record.",
  },
  {
    key: "esc-af",
    version: "2024",
    title: "2024 ESC Guidelines for the management of atrial fibrillation",
    organization: "ESC",
    topic: "atrial_fibrillation",
    publicationYear: 2024,
    publicationDate: "2024-08-30",
    url: "https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/atrial-fibrillation/",
    notes:
      "Catalogue metadata only; anticoagulation and dose rules are not included.",
  },
  {
    key: "esc-ncs",
    version: "2022",
    title:
      "2022 ESC Guidelines on cardiovascular assessment and management of patients undergoing non-cardiac surgery",
    organization: "ESC/ESAIC",
    topic: "non_cardiac_surgery",
    publicationYear: 2022,
    publicationDate: "2022-08-26",
    url: "https://www.escardio.org/guidelines/clinical-practice-guidelines/pocket-guidelines/non-cardiac-surgery-cardiovascular-assessment-and-management",
    notes: "Catalogue metadata only; no perioperative schedule is activated.",
  },
  {
    key: "kdigo-ckd",
    version: "2024",
    title:
      "KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease",
    organization: "KDIGO",
    topic: "chronic_kidney_disease",
    publicationYear: 2024,
    publicationDate: "2024-03-13",
    url: "https://kdigo.org/guidelines/ckd-evaluation-and-management/",
    notes:
      "Current catalogue reference; individual cardiorenal rules require clinical review and current-source verification.",
  },
  {
    key: "ada-soc",
    version: "2026",
    title: "Standards of Care in Diabetes—2026",
    organization: "ADA",
    topic: "diabetes_cardiometabolic",
    publicationYear: 2026,
    publicationDate: "2025-12-08",
    url: "https://professional.diabetes.org/standards-of-care",
    notes:
      "Annual source; review its current edition before publishing any cardiometabolic rule.",
  },
] as const;

async function appendCapabilityIfMissing(
  db: QueryDB,
  subject: string,
  capability: Capability,
) {
  const exists = (
    await db.query(
      "SELECT id FROM governance.capability_event WHERE site_id=$1 AND subject=$2 AND capability=$3 LIMIT 1",
      [SITE, subject, capability],
    )
  ).rows[0];
  if (!exists)
    await db.query(
      "INSERT INTO governance.capability_event(id,site_id,subject,capability,action,reason,actor) VALUES($1,$2,$3,$4,'grant','Stage 1.5 pilot capability migration','system:governance')",
      [randomUUID(), SITE, subject, capability],
    );
}

export async function initializeClinicalGovernance(db: DB) {
  await appendCapabilityIfMissing(db, "demo:reviewer", "clinical_rule_maker");
  await appendCapabilityIfMissing(
    db,
    "demo:reviewer",
    "clinical_rule_reviewer",
  );
  const existingReviewers = (
    await db.query<{ email: string }>(
      "SELECT email FROM governance.membership WHERE active=true AND role='reviewer'",
    )
  ).rows;
  for (const reviewer of existingReviewers) {
    await appendCapabilityIfMissing(
      db,
      reviewer.email.toLowerCase(),
      "clinical_rule_maker",
    );
    await appendCapabilityIfMissing(
      db,
      reviewer.email.toLowerCase(),
      "clinical_rule_reviewer",
    );
  }

  for (const source of evidenceSeeds) {
    await db.query(
      `INSERT INTO decision_support.evidence_source
       (key,version,title,organization,publication_year,locator,reviewed_at,status,metadata,created_by,
        topic,source_kind,publication_date,authoritative_url,last_verified_at,next_review_date,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,'approved',$8,'system:evidence-catalogue',$9,'guideline',$10,$6,$7,'2027-09-01',$11)
       ON CONFLICT DO NOTHING`,
      [
        source.key,
        source.version,
        source.title,
        source.organization,
        source.publicationYear,
        source.url,
        IMPLEMENTATION_DATE,
        JSON.stringify({
          clinicalGuidance: true,
          catalogueOnly: true,
          copyright: "metadata-and-citation-only",
        }),
        source.topic,
        source.publicationDate,
        source.notes,
      ],
    );
    const status = (
      await db.query(
        "SELECT id FROM decision_support.evidence_status_event WHERE evidence_key=$1 AND evidence_version=$2 LIMIT 1",
        [source.key, source.version],
      )
    ).rows[0];
    if (!status)
      await db.query(
        "INSERT INTO decision_support.evidence_status_event(id,evidence_key,evidence_version,status,reason,actor) VALUES($1,$2,$3,'current','Verified against the authoritative publisher during Stage 1.5 implementation','system:evidence-catalogue')",
        [randomUUID(), source.key, source.version],
      );
  }
  const foundationStatus = (
    await db.query(
      "SELECT id FROM decision_support.evidence_status_event WHERE evidence_key='cardioflow-foundation' AND evidence_version='1' LIMIT 1",
    )
  ).rows[0];
  if (!foundationStatus)
    await db.query(
      "INSERT INTO decision_support.evidence_status_event(id,evidence_key,evidence_version,status,reason,actor) VALUES($1,'cardioflow-foundation','1','current','Engineering contract remains applicable','system:foundation')",
      [randomUUID()],
    );

  const preferences = [
    [
      "cardiovascular",
      "ESC",
      1,
      "Default cardiovascular framework for the Kuwait/GCC pilot",
    ],
    [
      "valvular_heart_disease",
      "ESC/EACTS",
      1,
      "Joint cardiovascular and surgical guidance",
    ],
    [
      "electrophysiology",
      "EHRA/HRS/APHRS/LAHRS",
      1,
      "Specialty guidance when applicable",
    ],
    [
      "chronic_kidney_disease",
      "KDIGO",
      1,
      "Primary kidney and cardiorenal framework",
    ],
    [
      "diabetes_cardiometabolic",
      "ADA",
      1,
      "Primary diabetes and cardiometabolic framework",
    ],
  ] as const;
  for (const [domain, organization, priority, rationale] of preferences) {
    const exists = (
      await db.query(
        "SELECT id FROM decision_support.site_guideline_preference WHERE site_id=$1 AND clinical_domain=$2 AND organization=$3 LIMIT 1",
        [SITE, domain, organization],
      )
    ).rows[0];
    if (!exists)
      await db.query(
        "INSERT INTO decision_support.site_guideline_preference(id,site_id,clinical_domain,organization,priority,rationale,actor) VALUES($1,$2,$3,$4,$5,$6,'system:governance')",
        [randomUUID(), SITE, domain, organization, priority, rationale],
      );
  }
}

export async function hasCapability(
  db: QueryDB,
  session: GovernanceSession,
  capability: Capability,
  siteId = SITE,
) {
  const subjects = [session.actor, session.email?.toLowerCase()].filter(
      (value): value is string => !!value,
    ),
    rows = (
      await db.query<any>(
        "SELECT * FROM governance.capability_event WHERE site_id=$1 AND capability=$2 AND (subject=$3 OR subject=$4) ORDER BY event_sequence DESC",
        [siteId, capability, subjects[0], subjects[1] ?? subjects[0]],
      )
    ).rows,
    latest = new Map<string, any>();
  for (const row of rows)
    if (!latest.has(row.subject)) latest.set(row.subject, row);
  return [...latest.values()].some((row) => row.action === "grant");
}

function requireAnyCapability(
  db: DB,
  ...capabilities: Capability[]
): RequestHandler {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const session = res.locals.session as GovernanceSession;
    for (const capability of capabilities)
      if (await hasCapability(db, session, capability)) return next();
    res.status(403).json({
      error: "A clinical governance capability is required for this action",
    });
  };
}

const conditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
  z.union([
    z
      .object({
        kind: z.literal("all"),
        conditions: z.array(conditionSchema).min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("any"),
        conditions: z.array(conditionSchema).min(1),
      })
      .strict(),
    z.object({ kind: z.literal("not"), condition: conditionSchema }).strict(),
    z
      .object({
        kind: z.literal("fact"),
        conceptCode: z.string().min(1).max(200),
        operator: z.enum([
          "exists",
          "not_exists",
          "equals",
          "not_equals",
          "greater_than",
          "greater_or_equal",
          "less_than",
          "less_or_equal",
          "includes",
        ]),
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
        maxAgeDays: z.number().int().positive().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("days_since"),
        conceptCode: z.string().min(1).max(200),
        operator: z.enum([
          "greater_than",
          "greater_or_equal",
          "less_than",
          "less_or_equal",
        ]),
        days: z.number().int().nonnegative(),
      })
      .strict(),
  ]),
);

const evidenceReferenceSchema = z
  .object({
    key: z.string().min(1).max(160),
    version: z.string().min(1).max(80),
    relationship: z
      .enum(["primary", "supporting", "alternative"])
      .default("primary"),
  })
  .strict();

export const governedRuleSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/),
    title: z.string().trim().min(3).max(300),
    clinical_domain: z.string().trim().min(2).max(120),
    subdomain: z.string().trim().max(120).default(""),
    rule_type: z.enum(ruleTypes),
    patient_population: z.record(z.string(), z.json()).default({}),
    trigger: conditionSchema,
    required: z.array(conditionSchema).default([]),
    optional_supporting_data: z.array(z.string().max(200)).default([]),
    exclusions: z.array(conditionSchema).default([]),
    contraindications: z.array(z.string().max(500)).default([]),
    cautions: z.array(z.string().max(500)).default([]),
    recommendation: z.string().trim().min(3).max(3000),
    urgency: z.enum(["immediate", "urgent", "routine", "informational"]),
    recommendation_category: z.enum(recommendationCategories),
    alert_severity: z.enum(alertSeverity),
    priority: z.number().int().min(1).max(6),
    conflict_group: z.string().trim().max(120).nullable().default(null),
    follow_up_implications: z.record(z.string(), z.json()).default({}),
    recommendation_class: z.string().trim().max(80).nullable().default(null),
    evidence_level: z.string().trim().max(80).nullable().default(null),
    evidence_strength: z.string().trim().max(120).nullable().default(null),
    evidence: z.array(evidenceReferenceSchema).min(1),
    review_due_date: z.string().date(),
    test_status: z.literal("not_run").default("not_run"),
    changelog: z.string().trim().min(2).max(2000),
    previous_version: z.number().int().positive().nullable().default(null),
    fixture: z.boolean().default(false),
  })
  .strict();

export type GovernedRuleInput = z.infer<typeof governedRuleSchema>;

export async function recordRuleTestRun(
  db: DB,
  key: string,
  version: number,
  input: {
    outcome: "passed" | "failed";
    suite: string;
    runner_version: string;
    result: Record<string, unknown>;
  },
  session: GovernanceSession,
) {
  if (!(await hasCapability(db, session, "technical_admin")))
    throw new FoundationError(
      403,
      "Technical administrator capability required",
    );
  return db.transaction(async (tx) => {
    const rule = await latestRuleState(tx, key, version);
    if (["PUBLISHED", "SUPERSEDED", "RETIRED"].includes(rule.lifecycle_state))
      throw new FoundationError(
        409,
        "Published or historical rule versions cannot receive a new pre-publication test run",
      );
    return (
      await tx.query<any>(
        `INSERT INTO decision_support.rule_test_run
         (id,rule_key,rule_version,outcome,suite,runner_version,result,actor)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          randomUUID(),
          key,
          version,
          input.outcome,
          input.suite,
          input.runner_version,
          JSON.stringify(input.result),
          session.actor,
        ],
      )
    ).rows[0];
  });
}

async function evidenceReferences(db: QueryDB, input: GovernedRuleInput) {
  const result = [];
  for (const reference of input.evidence) {
    const row = (
      await db.query<any>(
        "SELECT * FROM decision_support.evidence_source WHERE key=$1 AND version=$2",
        [reference.key, reference.version],
      )
    ).rows[0];
    if (!row)
      throw new FoundationError(
        422,
        `Evidence source is not registered: ${reference.key} ${reference.version}`,
      );
    result.push({
      key: row.key,
      version: row.version,
      title: row.title,
      organization: row.organization,
      publicationYear: row.publication_year,
      locator: row.authoritative_url || row.locator,
      reviewedAt: row.last_verified_at || row.reviewed_at,
      relationship: reference.relationship,
    });
  }
  return result;
}

export async function createRuleDraft(
  db: DB,
  input: GovernedRuleInput,
  session: GovernanceSession,
) {
  if (!(await hasCapability(db, session, "clinical_rule_maker")))
    throw new FoundationError(403, "Clinical rule maker capability required");
  return db.transaction(async (tx) => {
    const next = (
      await tx.query<{ version: number }>(
        "SELECT COALESCE(max(version),0)::int + 1 version FROM decision_support.rule_definition WHERE key=$1",
        [input.key],
      )
    ).rows[0].version;
    if (next === 1 && input.previous_version !== null)
      throw new FoundationError(
        422,
        "A first rule version cannot name a previous version",
      );
    if (next > 1 && input.previous_version !== next - 1)
      throw new FoundationError(
        409,
        `Rule version ${next} must continue from version ${next - 1}`,
      );
    if (input.previous_version !== null) {
      const previous = await latestRuleState(
        tx,
        input.key,
        input.previous_version,
      );
      if (["CLINICAL_REVIEW", "APPROVED"].includes(previous.lifecycle_state))
        throw new FoundationError(
          409,
          "Complete or return the current clinical review before creating a revised version",
        );
      if (
        ["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(
          previous.lifecycle_state,
        )
      )
        await tx.query(
          `INSERT INTO decision_support.rule_lifecycle_event
           (id,rule_key,rule_version,site_id,state,comment,actor)
           VALUES($1,$2,$3,$4,'SUPERSEDED',$5,$6)`,
          [
            randomUUID(),
            input.key,
            input.previous_version,
            SITE,
            `Replaced by immutable draft version ${next}`,
            session.actor,
          ],
        );
    }
    const evidence = await evidenceReferences(tx, input),
      rule: ClinicalRule = {
        key: input.key,
        version: next,
        status: "active",
        topic: input.clinical_domain,
        priority: input.priority as ClinicalRule["priority"],
        trigger: input.trigger,
        required: input.required,
        exclusions: input.exclusions,
        ...(input.conflict_group
          ? { conflictGroup: input.conflict_group }
          : {}),
        output: {
          title: input.title,
          recommendation: input.recommendation,
          alert: {
            category: input.recommendation_category,
            severity: input.alert_severity,
          },
        },
        evidence: evidence.map(
          ({ relationship: _relationship, ...item }) => item,
        ),
      },
      serialized = JSON.stringify(rule);
    await tx.query(
      `INSERT INTO decision_support.rule_definition
       (key,version,topic,status,priority,definition,checksum,created_by,site_id,title,clinical_domain,subdomain,
        rule_type,patient_population,required_data,optional_supporting_data,exclusion_criteria,contraindications,
        caution_conditions,urgency,recommendation_category,follow_up_implications,recommendation_class,
        evidence_level,evidence_strength,author,previous_version,changelog,review_due_date,test_status,fixture)
       VALUES($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$7,$25,$26,$27,$28,$29)`,
      [
        rule.key,
        rule.version,
        rule.topic,
        rule.priority,
        serialized,
        digest(serialized),
        session.actor,
        SITE,
        input.title,
        input.clinical_domain,
        input.subdomain,
        input.rule_type,
        JSON.stringify(input.patient_population),
        JSON.stringify(input.required),
        JSON.stringify(input.optional_supporting_data),
        JSON.stringify(input.exclusions),
        JSON.stringify(input.contraindications),
        JSON.stringify(input.cautions),
        input.urgency,
        input.recommendation_category,
        JSON.stringify(input.follow_up_implications),
        input.recommendation_class,
        input.evidence_level,
        input.evidence_strength,
        input.previous_version,
        input.changelog,
        input.review_due_date,
        input.test_status,
        input.fixture,
      ],
    );
    for (const reference of input.evidence)
      await tx.query(
        "INSERT INTO decision_support.rule_evidence(rule_key,rule_version,evidence_key,evidence_version,relationship,added_by) VALUES($1,$2,$3,$4,$5,$6)",
        [
          rule.key,
          rule.version,
          reference.key,
          reference.version,
          reference.relationship,
          session.actor,
        ],
      );
    const lifecycle = (
      await tx.query<any>(
        "INSERT INTO decision_support.rule_lifecycle_event(id,rule_key,rule_version,site_id,state,comment,actor) VALUES($1,$2,$3,$4,'DRAFT',$5,$6) RETURNING *",
        [
          randomUUID(),
          rule.key,
          rule.version,
          SITE,
          input.changelog,
          session.actor,
        ],
      )
    ).rows[0];
    return { rule: { ...input, version: rule.version }, lifecycle };
  });
}

async function latestRuleState(tx: QueryDB, key: string, version: number) {
  const rule = (
    await tx.query<any>(
      "SELECT * FROM decision_support.rule_current_state WHERE key=$1 AND version=$2 AND site_id=$3",
      [key, version, SITE],
    )
  ).rows[0];
  if (!rule) throw new FoundationError(404, "Clinical rule version not found");
  return rule;
}

async function appendPatientRuleEvents(
  tx: QueryDB,
  key: string,
  version: number,
  actor: string,
  eventType: string,
) {
  const patients = (
    await tx.query<{ id: string }>(
      "SELECT id FROM core.patient WHERE site_id=$1 ORDER BY id",
      [SITE],
    )
  ).rows;
  for (const patient of patients) {
    const event = (
      await tx.query<any>(
        "INSERT INTO clinical.event(id,patient_id,event_type,payload,actor) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          randomUUID(),
          patient.id,
          eventType,
          JSON.stringify({ ruleKey: key, ruleVersion: version }),
          actor,
        ],
      )
    ).rows[0];
    await recalculatePatient(tx, patient.id, event, actor);
  }
}

const transitions: Record<string, { from: string[]; to: string }> = {
  submit: { from: ["DRAFT", "CHANGES_REQUESTED"], to: "CLINICAL_REVIEW" },
  approve: { from: ["CLINICAL_REVIEW"], to: "APPROVED" },
  reject: { from: ["CLINICAL_REVIEW"], to: "REJECTED" },
  request_changes: { from: ["CLINICAL_REVIEW"], to: "CHANGES_REQUESTED" },
  publish: { from: ["APPROVED"], to: "PUBLISHED" },
  suspend: { from: ["PUBLISHED"], to: "SUSPENDED" },
  supersede: { from: ["PUBLISHED", "SUSPENDED"], to: "SUPERSEDED" },
  retire: { from: ["PUBLISHED", "SUSPENDED"], to: "RETIRED" },
};

const requiredClinicalReviewChecks = [
  "logic",
  "population",
  "thresholds",
  "exclusions",
  "evidence",
  "monitoring",
  "tests",
] as const;

export async function transitionRule(
  db: DB,
  key: string,
  version: number,
  action: keyof typeof transitions,
  comment: string,
  checklist: Record<string, unknown>,
  session: GovernanceSession,
) {
  const requiredCapability: Capability =
    action === "submit" ? "clinical_rule_maker" : "clinical_rule_reviewer";
  if (!(await hasCapability(db, session, requiredCapability)))
    throw new FoundationError(403, `${requiredCapability} capability required`);
  return db.transaction(async (tx) => {
    const rule = await latestRuleState(tx, key, version),
      transition = transitions[action];
    if (!transition || !transition.from.includes(rule.lifecycle_state))
      throw new FoundationError(
        409,
        `Cannot ${action.replaceAll("_", " ")} a rule in ${rule.lifecycle_state}`,
      );
    const identities = [session.actor, session.email?.toLowerCase()]
      .filter((value): value is string => !!value)
      .map((value) => value.toLowerCase());
    if (
      action !== "submit" &&
      identities.includes(String(rule.author).toLowerCase())
    )
      throw new FoundationError(
        403,
        "A maker cannot clinically review or publish their own rule",
      );
    if (
      action === "approve" &&
      requiredClinicalReviewChecks.some((item) => checklist[item] !== true)
    )
      throw new FoundationError(
        422,
        "Every clinical review checklist item must be confirmed before approval",
      );
    if (["approve", "reject", "request_changes"].includes(action))
      await tx.query(
        "INSERT INTO decision_support.rule_review(id,rule_key,rule_version,outcome,checklist,comments,reviewer) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          key,
          version,
          action === "request_changes"
            ? "changes_requested"
            : action === "approve"
              ? "approved"
              : "rejected",
          JSON.stringify(checklist),
          comment,
          session.actor,
        ],
      );
    if (action === "publish") {
      const review = (
        await tx.query<any>(
          "SELECT * FROM decision_support.rule_review WHERE rule_key=$1 AND rule_version=$2 AND outcome='approved' ORDER BY event_sequence DESC LIMIT 1",
          [key, version],
        )
      ).rows[0];
      if (
        !review ||
        String(review.reviewer).toLowerCase() ===
          String(rule.author).toLowerCase()
      )
        throw new FoundationError(
          422,
          "Independent approved clinical review required",
        );
      if (rule.latest_test_status !== "passed")
        throw new FoundationError(
          422,
          "Automated rule tests must pass before publication",
        );
      if (rule.review_due_date && rule.review_due_date < today())
        throw new FoundationError(422, "Rule review date has expired");
      const invalidEvidence = (
        await tx.query<any>(
          `SELECT re.evidence_key,re.evidence_version,es.status,cs.lifecycle_status
           FROM decision_support.rule_evidence re
           JOIN decision_support.evidence_source es ON es.key=re.evidence_key AND es.version=re.evidence_version
           JOIN decision_support.evidence_current_state cs ON cs.key=re.evidence_key AND cs.version=re.evidence_version
           WHERE re.rule_key=$1 AND re.rule_version=$2
             AND (es.status<>'approved' OR cs.lifecycle_status<>'current' OR es.last_verified_at IS NULL
               OR (es.next_review_date IS NOT NULL AND es.next_review_date < $3))`,
          [key, version, today()],
        )
      ).rows;
      if (invalidEvidence.length)
        throw new FoundationError(
          422,
          "Every published rule requires current, verified, approved evidence",
        );
      const evidenceCount = (
        await tx.query<{ count: number }>(
          "SELECT count(*)::int count FROM decision_support.rule_evidence WHERE rule_key=$1 AND rule_version=$2",
          [key, version],
        )
      ).rows[0].count;
      if (!evidenceCount)
        throw new FoundationError(
          422,
          "Published rules require traceable evidence",
        );

      const older = (
        await tx.query<any>(
          "SELECT * FROM decision_support.rule_current_state WHERE key=$1 AND site_id=$2 AND version<>$3 AND lifecycle_state='PUBLISHED'",
          [key, SITE, version],
        )
      ).rows;
      for (const old of older) {
        await tx.query(
          "INSERT INTO decision_support.rule_lifecycle_event(id,rule_key,rule_version,site_id,state,comment,actor) VALUES($1,$2,$3,$4,'SUPERSEDED',$5,$6)",
          [
            randomUUID(),
            key,
            old.version,
            SITE,
            `Superseded by version ${version}`,
            session.actor,
          ],
        );
        const recommendations = (
          await tx.query<{ id: string }>(
            `SELECT id FROM decision_support.recommendation
             WHERE rule_key=$1 AND rule_version=$2 AND status IN ('active','needs_data')`,
            [key, old.version],
          )
        ).rows;
        for (const recommendation of recommendations)
          await tx.query(
            `INSERT INTO decision_support.recommendation_reassessment
             (id,recommendation_id,reason_type,reason,source_key,source_version,actor)
             VALUES($1,$2,'rule_updated',$3,$4,$5,$6)`,
            [
              randomUUID(),
              recommendation.id,
              `Rule version ${version} was published`,
              key,
              String(version),
              session.actor,
            ],
          );
      }
    }
    const event = (
      await tx.query<any>(
        "INSERT INTO decision_support.rule_lifecycle_event(id,rule_key,rule_version,site_id,state,comment,actor) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          randomUUID(),
          key,
          version,
          SITE,
          transition.to,
          comment,
          session.actor,
        ],
      )
    ).rows[0];
    if (
      ["PUBLISHED", "SUSPENDED", "SUPERSEDED", "RETIRED"].includes(
        transition.to,
      )
    )
      await appendPatientRuleEvents(
        tx,
        key,
        version,
        session.actor,
        `rule.${transition.to.toLowerCase()}`,
      );
    return event;
  });
}

export async function changeEvidenceStatus(
  db: DB,
  key: string,
  version: string,
  status: "current" | "superseded" | "withdrawn" | "under_review",
  supersededBy: { key: string; version: string } | null,
  reason: string,
  session: GovernanceSession,
) {
  if (!(await hasCapability(db, session, "clinical_rule_reviewer")))
    throw new FoundationError(
      403,
      "Clinical rule reviewer capability required",
    );
  return db.transaction(async (tx) => {
    const source = (
      await tx.query<any>(
        "SELECT * FROM decision_support.evidence_source WHERE key=$1 AND version=$2",
        [key, version],
      )
    ).rows[0];
    if (!source) throw new FoundationError(404, "Evidence source not found");
    if (
      [session.actor, session.email?.toLowerCase()]
        .filter((value): value is string => !!value)
        .map((value) => value.toLowerCase())
        .includes(String(source.created_by).toLowerCase())
    )
      throw new FoundationError(
        403,
        "Evidence status needs independent review",
      );
    if (status === "superseded") {
      if (!supersededBy)
        throw new FoundationError(
          422,
          "A superseding evidence version is required",
        );
      if (supersededBy.key === key && supersededBy.version === version)
        throw new FoundationError(422, "Evidence cannot supersede itself");
      const replacement = (
        await tx.query<any>(
          `SELECT * FROM decision_support.evidence_current_state
           WHERE key=$1 AND version=$2 AND status='approved'
             AND lifecycle_status='current' AND last_verified_at IS NOT NULL`,
          [supersededBy.key, supersededBy.version],
        )
      ).rows[0];
      if (!replacement)
        throw new FoundationError(
          422,
          "Superseding evidence must be current, verified and approved",
        );
    }
    const event = (
      await tx.query<any>(
        `INSERT INTO decision_support.evidence_status_event
         (id,evidence_key,evidence_version,status,superseded_by_key,superseded_by_version,reason,actor)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          randomUUID(),
          key,
          version,
          status,
          supersededBy?.key ?? null,
          supersededBy?.version ?? null,
          reason,
          session.actor,
        ],
      )
    ).rows[0];
    const affected = (
      await tx.query<any>(
        `SELECT DISTINCT r.id,r.patient_id
         FROM decision_support.recommendation r
         JOIN decision_support.rule_evidence re ON re.rule_key=r.rule_key AND re.rule_version=r.rule_version
         WHERE re.evidence_key=$1 AND re.evidence_version=$2 AND r.status IN ('active','needs_data')`,
        [key, version],
      )
    ).rows;
    for (const recommendation of affected) {
      await tx.query(
        `INSERT INTO decision_support.recommendation_reassessment
         (id,recommendation_id,reason_type,reason,source_key,source_version,actor)
         VALUES($1,$2,'evidence_updated',$3,$4,$5,$6)`,
        [randomUUID(), recommendation.id, reason, key, version, session.actor],
      );
      const trigger = (
        await tx.query<any>(
          "INSERT INTO clinical.event(id,patient_id,event_type,payload,actor) VALUES($1,$2,'evidence.updated',$3,$4) RETURNING *",
          [
            randomUUID(),
            recommendation.patient_id,
            JSON.stringify({ key, version, status }),
            session.actor,
          ],
        )
      ).rows[0];
      await recalculatePatient(
        tx,
        recommendation.patient_id,
        trigger,
        session.actor,
      );
    }
    return event;
  });
}

async function governanceOverview(db: QueryDB, session: GovernanceSession) {
  const [evidence, rules, reviews, preferences, policies, reviewEvents] =
    await Promise.all([
      db.query<any>(
        "SELECT * FROM decision_support.evidence_current_state ORDER BY organization,publication_year DESC,title",
      ),
      db.query<any>(
        `SELECT r.*,
          COALESCE((SELECT json_agg(re ORDER BY re.relationship,re.evidence_key) FROM decision_support.rule_evidence re WHERE re.rule_key=r.key AND re.rule_version=r.version),'[]') evidence
         FROM decision_support.rule_current_state r WHERE r.site_id=$1 ORDER BY r.clinical_domain,r.title,r.version DESC`,
        [SITE],
      ),
      db.query<any>(
        "SELECT * FROM decision_support.rule_review ORDER BY event_sequence DESC",
      ),
      db.query<any>(
        "SELECT * FROM decision_support.site_guideline_preference WHERE site_id=$1 ORDER BY clinical_domain,priority,created_at DESC",
        [SITE],
      ),
      db.query<any>(
        "SELECT * FROM decision_support.site_policy WHERE site_id=$1 ORDER BY category,key,version DESC",
        [SITE],
      ),
      db.query<any>(
        "SELECT * FROM decision_support.evidence_review_event ORDER BY created_at",
      ),
    ]);
  const latestFlags = new Map<string, any>();
  for (const event of reviewEvents.rows)
    latestFlags.set(event.review_id, event);
  const capabilities = {
    maker: await hasCapability(db, session, "clinical_rule_maker"),
    reviewer: await hasCapability(db, session, "clinical_rule_reviewer"),
    technicalAdmin: await hasCapability(db, session, "technical_admin"),
  };
  return {
    siteId: SITE,
    capabilities,
    evidence: evidence.rows.map((source) => ({
      ...source,
      reviewDue:
        !!source.next_review_date && source.next_review_date <= today(),
    })),
    rules: rules.rows,
    reviews: reviews.rows,
    guidelinePreferences: preferences.rows,
    sitePolicies: policies.rows,
    evidenceReviewQueue: [...latestFlags.values()].filter(
      (event) => event.action === "flag",
    ),
  };
}

export function mountClinicalGovernance(
  app: Express,
  db: DB,
  clinicalRead: RequestHandler,
  clinicalWrite: RequestHandler,
) {
  const governanceRead = requireAnyCapability(
    db,
    "clinical_rule_maker",
    "clinical_rule_reviewer",
    "technical_admin",
  );
  app.get("/api/clinical-governance", governanceRead, async (_req, res) =>
    res.json(
      await governanceOverview(db, res.locals.session as GovernanceSession),
    ),
  );
  app.post(
    "/api/clinical-governance/rules",
    requireAnyCapability(db, "clinical_rule_maker"),
    async (req, res) => {
      const input = governedRuleSchema.parse(req.body);
      res
        .status(201)
        .json(
          await createRuleDraft(
            db,
            input,
            res.locals.session as GovernanceSession,
          ),
        );
    },
  );
  app.post(
    "/api/clinical-governance/rules/:key/:version/actions",
    governanceRead,
    async (req, res) => {
      const input = z
        .object({
          action: z.enum([
            "submit",
            "approve",
            "reject",
            "request_changes",
            "publish",
            "suspend",
            "supersede",
            "retire",
          ]),
          comment: z.string().trim().min(2).max(3000),
          checklist: z.record(z.string(), z.json()).default({}),
        })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json(
          await transitionRule(
            db,
            String(req.params.key),
            z.coerce.number().int().positive().parse(req.params.version),
            input.action,
            input.comment,
            input.checklist,
            res.locals.session as GovernanceSession,
          ),
        );
    },
  );
  app.post(
    "/api/clinical-governance/rules/:key/:version/test-runs",
    requireAnyCapability(db, "technical_admin"),
    async (req, res) => {
      const input = z
        .object({
          outcome: z.enum(["passed", "failed"]),
          suite: z.string().trim().min(2).max(200),
          runner_version: z.string().trim().min(1).max(100),
          result: z.record(z.string(), z.json()).default({}),
        })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json(
          await recordRuleTestRun(
            db,
            String(req.params.key),
            z.coerce.number().int().positive().parse(req.params.version),
            input,
            res.locals.session as GovernanceSession,
          ),
        );
    },
  );
  app.post(
    "/api/clinical-governance/evidence",
    requireAnyCapability(db, "clinical_rule_maker"),
    async (req, res) => {
      const input = z
          .object({
            key: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/),
            version: z.string().min(1).max(80),
            title: z.string().trim().min(3).max(500),
            organization: z.string().trim().min(2).max(200),
            topic: z.string().trim().min(2).max(160),
            publication_year: z.number().int().min(1900).max(2200).nullable(),
            publication_date: z.string().date().nullable(),
            authoritative_url: z.string().url(),
            doi: z.string().trim().max(200).nullable().default(null),
            next_review_date: z.string().date(),
            notes: z.string().trim().max(2000).default(""),
          })
          .strict()
          .parse(req.body),
        session = res.locals.session as GovernanceSession;
      await db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO decision_support.evidence_source
           (key,version,title,organization,publication_year,locator,reviewed_at,status,metadata,created_by,
            topic,source_kind,publication_date,authoritative_url,doi,last_verified_at,next_review_date,notes)
           VALUES($1,$2,$3,$4,$5,$6,CURRENT_DATE,'approved',$7,$8,$9,'guideline',$10,$6,$11,CURRENT_DATE,$12,$13)`,
          [
            input.key,
            input.version,
            input.title,
            input.organization,
            input.publication_year,
            input.authoritative_url,
            JSON.stringify({ catalogueOnly: true }),
            session.actor,
            input.topic,
            input.publication_date,
            input.doi,
            input.next_review_date,
            input.notes,
          ],
        );
        await tx.query(
          "INSERT INTO decision_support.evidence_status_event(id,evidence_key,evidence_version,status,reason,actor) VALUES($1,$2,$3,'under_review','New evidence version requires independent verification',$4)",
          [randomUUID(), input.key, input.version, session.actor],
        );
      });
      res.status(201).json({ key: input.key, version: input.version });
    },
  );
  app.post(
    "/api/clinical-governance/evidence/:key/:version/status",
    requireAnyCapability(db, "clinical_rule_reviewer"),
    async (req, res) => {
      const input = z
        .object({
          status: z.enum([
            "current",
            "superseded",
            "withdrawn",
            "under_review",
          ]),
          superseded_by: z
            .object({ key: z.string(), version: z.string() })
            .nullable()
            .default(null),
          reason: z.string().trim().min(2).max(3000),
        })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json(
          await changeEvidenceStatus(
            db,
            String(req.params.key),
            String(req.params.version),
            input.status,
            input.superseded_by,
            input.reason,
            res.locals.session as GovernanceSession,
          ),
        );
    },
  );
  app.post(
    "/api/clinical-governance/evidence/:key/:version/review-events",
    governanceRead,
    async (req, res) => {
      const input = z
          .object({
            review_id: z.string().uuid().nullable().default(null),
            action: z.enum(["flag", "resolve"]),
            reason: z.string().trim().min(2).max(2000),
          })
          .strict()
          .parse(req.body),
        id = input.review_id ?? randomUUID(),
        row = (
          await db.query<any>(
            `INSERT INTO decision_support.evidence_review_event
             (id,review_id,evidence_key,evidence_version,action,reason,actor)
             VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [
              randomUUID(),
              id,
              String(req.params.key),
              String(req.params.version),
              input.action,
              input.reason,
              (res.locals.session as GovernanceSession).actor,
            ],
          )
        ).rows[0];
      res.status(201).json(row);
    },
  );
  app.get(
    "/api/recommendations/:id/traceability",
    clinicalRead,
    async (req, res) => {
      const recommendation = (
        await db.query<any>(
          `SELECT r.* FROM decision_support.recommendation r
           JOIN core.patient p ON p.id=r.patient_id
           WHERE r.id=$1 AND p.site_id=$2`,
          [z.string().uuid().parse(req.params.id), SITE],
        )
      ).rows[0];
      if (!recommendation)
        throw new FoundationError(404, "Recommendation not found");
      const [rule, facts, reassessments, actions] = await Promise.all([
        db.query<any>(
          `SELECT r.*,
            COALESCE((SELECT json_agg(re) FROM decision_support.rule_evidence re WHERE re.rule_key=r.key AND re.rule_version=r.version),'[]') evidence_links,
            COALESCE((SELECT json_agg(rr ORDER BY rr.event_sequence) FROM decision_support.rule_review rr WHERE rr.rule_key=r.key AND rr.rule_version=r.version),'[]') reviews
           FROM decision_support.rule_current_state r WHERE r.key=$1 AND r.version=$2`,
          [recommendation.rule_key, recommendation.rule_version],
        ),
        db.query<any>(
          "SELECT * FROM clinical.fact WHERE id=ANY($1::uuid[]) ORDER BY observed_at",
          [recommendation.input_fact_ids],
        ),
        db.query<any>(
          "SELECT * FROM decision_support.recommendation_reassessment WHERE recommendation_id=$1 ORDER BY event_sequence",
          [recommendation.id],
        ),
        db.query<any>(
          "SELECT * FROM decision_support.recommendation_action WHERE recommendation_id=$1 ORDER BY event_sequence",
          [recommendation.id],
        ),
      ]);
      res.json({
        recommendation,
        patientFactsUsed: facts.rows,
        rule: rule.rows[0] ?? recommendation.rule_snapshot,
        evidence: recommendation.evidence_snapshot,
        missingInformation: recommendation.missing_concepts,
        reviews: rule.rows[0]?.reviews ?? recommendation.review_snapshot,
        reassessments: reassessments.rows,
        clinicianActions: actions.rows,
      });
    },
  );
  app.post(
    "/api/recommendations/:id/actions",
    clinicalWrite,
    async (req, res) => {
      const input = z
          .object({
            action: z.enum([
              "accept",
              "modify",
              "snooze",
              "dismiss",
              "override",
            ]),
            reason: z.string().trim().max(2000).default(""),
            modified_recommendation: z
              .string()
              .trim()
              .max(3000)
              .nullable()
              .default(null),
            snoozed_until: z.string().datetime().nullable().default(null),
          })
          .strict()
          .parse(req.body),
        recommendation = (
          await db.query<any>(
            `SELECT r.*,a.severity FROM decision_support.recommendation r
             JOIN core.patient p ON p.id=r.patient_id
             LEFT JOIN decision_support.alert a ON a.recommendation_id=r.id
             WHERE r.id=$1 AND p.site_id=$2`,
            [z.string().uuid().parse(req.params.id), SITE],
          )
        ).rows[0];
      if (!recommendation)
        throw new FoundationError(404, "Recommendation not found");
      if (
        ["dismiss", "override", "modify"].includes(input.action) &&
        !input.reason
      )
        throw new FoundationError(422, "Document the clinical reason");
      if (input.action === "snooze" && !input.snoozed_until)
        throw new FoundationError(
          422,
          "A snoozed recommendation needs a review time",
        );
      if (
        recommendation.severity === "critical" &&
        input.action !== "accept" &&
        !input.reason
      )
        throw new FoundationError(
          422,
          "Critical recommendations require a reason",
        );
      const row = (
        await db.query<any>(
          `INSERT INTO decision_support.recommendation_action
           (id,recommendation_id,action,reason,modified_recommendation,snoozed_until,actor)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            randomUUID(),
            recommendation.id,
            input.action,
            input.reason,
            input.modified_recommendation,
            input.snoozed_until,
            (res.locals.session as GovernanceSession).actor,
          ],
        )
      ).rows[0];
      res.status(201).json(row);
    },
  );
}
