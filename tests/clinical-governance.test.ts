import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../server/app.js";
import {
  changeEvidenceStatus,
  createRuleDraft,
  governedRuleSchema,
  recordRuleTestRun,
  transitionRule,
} from "../server/clinical-governance.js";
import {
  FoundationError,
  recordClinicalFact,
} from "../server/clinical-foundation.js";
import { createDb, type DB } from "../server/db.js";

const site = "demo-kuwait";
const fullChecklist = {
  logic: true,
  population: true,
  thresholds: true,
  exclusions: true,
  evidence: true,
  monitoring: true,
  tests: true,
};
const maker = { actor: "maker:one", role: "reviewer" };
const checker = { actor: "checker:one", role: "reviewer" };
const technicalAdmin = { actor: "admin:one", role: "designer" };
const outsider = { actor: "clinician:one", role: "clinician" };

async function grant(
  db: DB,
  subject: string,
  capability: string,
  grantSite = site,
) {
  await db.query(
    `INSERT INTO governance.capability_event
     (id,site_id,subject,capability,action,reason,actor)
     VALUES($1,$2,$3,$4,'grant','Governance test grant','test:setup')`,
    [randomUUID(), grantSite, subject, capability],
  );
}

function ruleInput(key: string, previousVersion: number | null = null) {
  return governedRuleSchema.parse({
    key,
    title: "Synthetic low function review",
    clinical_domain: "foundation_test",
    subdomain: "governance",
    rule_type: "laboratory_monitoring",
    patient_population: { purpose: "architecture verification only" },
    trigger: {
      kind: "fact",
      conceptCode: "investigation.lvef",
      operator: "less_than",
      value: 40,
    },
    required: [],
    optional_supporting_data: ["care.problem"],
    exclusions: [],
    contraindications: [],
    cautions: [],
    recommendation:
      previousVersion === null
        ? "Review the synthetic low value."
        : "Review the revised synthetic low value.",
    urgency: "routine",
    recommendation_category: "monitoring",
    alert_severity: "moderate",
    priority: 4,
    conflict_group: null,
    follow_up_implications: { review: true },
    recommendation_class: null,
    evidence_level: null,
    evidence_strength: null,
    evidence: [{ key: "esc-hf", version: "2026", relationship: "primary" }],
    review_due_date: "2027-09-22",
    test_status: "not_run",
    changelog:
      previousVersion === null
        ? "Initial synthetic governance fixture"
        : "Revised synthetic governance fixture",
    previous_version: previousVersion,
    fixture: true,
  });
}

function isFoundationError(status: number) {
  return (error: unknown) =>
    error instanceof FoundationError && error.status === status;
}

test("clinical governance enforces publication, evidence, history, reassessment, site scope and current-value provenance", async (t) => {
  const db = await createDb(undefined, false);
  const patientId = randomUUID();
  const otherSitePatientId = randomUUID();
  let olderFactId = "";
  let newerFactId = "";
  try {
    await Promise.all([
      grant(db, maker.actor, "clinical_rule_maker"),
      grant(db, checker.actor, "clinical_rule_reviewer"),
      grant(db, technicalAdmin.actor, "technical_admin"),
    ]);
    await db.query(
      `INSERT INTO core.patient(id,name,mrn,sex,birth_date,created_by)
       VALUES($1,'Governance Sample','SYN-GOV-001','Male','1960-01-01','test:setup')`,
      [patientId],
    );
    await db.query(
      `INSERT INTO core.patient(id,site_id,name,mrn,sex,birth_date,created_by)
       VALUES($1,'other-site','Other Site Sample','SYN-GOV-002','Female','1970-01-01','test:setup')`,
      [otherSitePatientId],
    );
    await db.transaction(async (tx) => {
      const older = await recordClinicalFact(
        tx,
        patientId,
        {
          concept_system: "cardioflow",
          concept_code: "investigation.lvef",
          concept_version: 1,
          value: { type: "quantity", value: 30, unit: "%" },
          observed_at: "2026-09-20T08:00:00.000Z",
          source_type: "synthetic_test",
          source_id: "echo-older",
          source_label: "Verified synthetic echo A",
          source_quality: "high",
          verification_status: "verified",
          lifecycle_status: "active",
        },
        "test:clinician",
      );
      olderFactId = older.id;
      const newer = await recordClinicalFact(
        tx,
        patientId,
        {
          concept_system: "cardioflow",
          concept_code: "investigation.lvef",
          concept_version: 1,
          value: { type: "quantity", value: 35, unit: "%" },
          observed_at: "2026-09-21T08:00:00.000Z",
          source_type: "synthetic_test",
          source_id: "echo-newer",
          source_label: "Verified synthetic echo B",
          source_quality: "high",
          verification_status: "verified",
          lifecycle_status: "active",
        },
        "test:clinician",
      );
      newerFactId = newer.id;
    });

    await t.test("unpublished rules never execute", async () => {
      await assert.rejects(
        createRuleDraft(db, ruleInput("fixture.no-access"), outsider),
        isFoundationError(403),
      );
      await createRuleDraft(
        db,
        ruleInput("fixture.governed-monitoring"),
        maker,
      );
      assert.equal(
        (
          await db.query<{ count: number }>(
            "SELECT count(*)::int count FROM decision_support.recommendation WHERE patient_id=$1",
            [patientId],
          )
        ).rows[0].count,
        0,
      );
    });

    await t.test(
      "maker-checker, complete review and independent test evidence are required",
      async () => {
        const key = "fixture.governed-monitoring";
        await transitionRule(
          db,
          key,
          1,
          "submit",
          "Ready for independent review",
          {},
          maker,
        );
        await assert.rejects(
          transitionRule(
            db,
            key,
            1,
            "approve",
            "Self approval",
            fullChecklist,
            maker,
          ),
          isFoundationError(403),
        );
        await assert.rejects(
          transitionRule(
            db,
            key,
            1,
            "approve",
            "Incomplete review",
            { logic: true },
            checker,
          ),
          isFoundationError(422),
        );
        await transitionRule(
          db,
          key,
          1,
          "approve",
          "All clinical review domains checked",
          fullChecklist,
          checker,
        );
        await assert.rejects(
          transitionRule(db, key, 1, "publish", "No test run yet", {}, checker),
          isFoundationError(422),
        );
        await assert.rejects(
          recordRuleTestRun(
            db,
            key,
            1,
            {
              outcome: "passed",
              suite: "fixture",
              runner_version: "1",
              result: {},
            },
            checker,
          ),
          isFoundationError(403),
        );
        await recordRuleTestRun(
          db,
          key,
          1,
          {
            outcome: "failed",
            suite: "governance-fixture",
            runner_version: "1",
            result: { failed: 1 },
          },
          technicalAdmin,
        );
        await assert.rejects(
          transitionRule(db, key, 1, "publish", "Failed tests", {}, checker),
          isFoundationError(422),
        );
        await recordRuleTestRun(
          db,
          key,
          1,
          {
            outcome: "passed",
            suite: "governance-fixture",
            runner_version: "2",
            result: { passed: 8, failed: 0 },
          },
          technicalAdmin,
        );
        await transitionRule(
          db,
          key,
          1,
          "publish",
          "Approved version released",
          {},
          checker,
        );
        const state = (
          await db.query<any>(
            "SELECT * FROM decision_support.rule_current_state WHERE key=$1 AND version=1",
            [key],
          )
        ).rows[0];
        assert.equal(state.lifecycle_state, "PUBLISHED");
        assert.equal(state.latest_test_status, "passed");
        assert.equal(
          (
            await db.query<{ count: number }>(
              "SELECT count(*)::int count FROM decision_support.recommendation WHERE patient_id=$1 AND rule_key=$2 AND status='active'",
              [patientId, key],
            )
          ).rows[0].count,
          1,
        );
        assert.equal(
          (
            await db.query<{ count: number }>(
              "SELECT count(*)::int count FROM decision_support.recommendation WHERE patient_id=$1",
              [otherSitePatientId],
            )
          ).rows[0].count,
          0,
        );
      },
    );

    await t.test(
      "rejection is terminal and remains in immutable history",
      async () => {
        const key = "fixture.rejected-rule";
        await createRuleDraft(db, ruleInput(key), maker);
        await transitionRule(
          db,
          key,
          1,
          "submit",
          "Review requested",
          {},
          maker,
        );
        await transitionRule(
          db,
          key,
          1,
          "reject",
          "Unsafe fixture logic",
          {},
          checker,
        );
        await assert.rejects(
          transitionRule(db, key, 1, "publish", "Cannot publish", {}, checker),
          isFoundationError(409),
        );
        await assert.rejects(
          db.query(
            "UPDATE decision_support.rule_review SET comments='changed' WHERE rule_key=$1",
            [key],
          ),
        );
      },
    );

    await t.test(
      "a new published version supersedes the old rule and flags prior recommendations",
      async () => {
        const key = "fixture.governed-monitoring";
        await createRuleDraft(db, ruleInput(key, 1), maker);
        await transitionRule(
          db,
          key,
          2,
          "submit",
          "Revised version for review",
          {},
          maker,
        );
        await transitionRule(
          db,
          key,
          2,
          "approve",
          "Revision clinically approved",
          fullChecklist,
          checker,
        );
        await recordRuleTestRun(
          db,
          key,
          2,
          {
            outcome: "passed",
            suite: "governance-fixture",
            runner_version: "3",
            result: { passed: 10, failed: 0 },
          },
          technicalAdmin,
        );
        await transitionRule(
          db,
          key,
          2,
          "publish",
          "Revised version released",
          {},
          checker,
        );
        const versions = (
          await db.query<any>(
            "SELECT version,lifecycle_state FROM decision_support.rule_current_state WHERE key=$1 ORDER BY version",
            [key],
          )
        ).rows;
        assert.deepEqual(
          versions.map((row) => [row.version, row.lifecycle_state]),
          [
            [1, "SUPERSEDED"],
            [2, "PUBLISHED"],
          ],
        );
        assert.ok(
          (
            await db.query<{ count: number }>(
              `SELECT count(*)::int count FROM decision_support.recommendation_reassessment rr
             JOIN decision_support.recommendation r ON r.id=rr.recommendation_id
             WHERE r.rule_key=$1 AND rr.reason_type='rule_updated'`,
              [key],
            )
          ).rows[0].count >= 1,
        );
        await assert.rejects(
          db.query(
            "UPDATE decision_support.rule_definition SET title='changed' WHERE key=$1 AND version=1",
            [key],
          ),
        );
      },
    );

    await t.test(
      "evidence superseding requires a verified replacement and triggers reassessment",
      async () => {
        await db.query(
          `INSERT INTO decision_support.evidence_source
         (key,version,title,organization,publication_year,locator,reviewed_at,status,metadata,created_by,
          topic,source_kind,publication_date,authoritative_url,last_verified_at,next_review_date,notes)
         VALUES('esc-hf','fixture-next','Synthetic replacement metadata','ESC',2027,'https://example.test/fixture','2026-09-22','approved','{}',$1,
          'heart_failure','guideline','2027-01-01','https://example.test/fixture','2026-09-22','2027-09-22','Test metadata only')`,
          [maker.actor],
        );
        await db.query(
          `INSERT INTO decision_support.evidence_status_event
         (id,evidence_key,evidence_version,status,reason,actor)
         VALUES($1,'esc-hf','fixture-next','under_review','Needs independent verification',$2)`,
          [randomUUID(), maker.actor],
        );
        await assert.rejects(
          changeEvidenceStatus(
            db,
            "esc-hf",
            "2026",
            "superseded",
            { key: "esc-hf", version: "fixture-next" },
            "Replacement not verified",
            checker,
          ),
          isFoundationError(422),
        );
        await changeEvidenceStatus(
          db,
          "esc-hf",
          "fixture-next",
          "current",
          null,
          "Replacement independently verified",
          checker,
        );
        await changeEvidenceStatus(
          db,
          "esc-hf",
          "2026",
          "superseded",
          { key: "esc-hf", version: "fixture-next" },
          "Synthetic replacement registered",
          checker,
        );
        assert.ok(
          (
            await db.query<{ count: number }>(
              `SELECT count(*)::int count FROM decision_support.recommendation_reassessment rr
             JOIN decision_support.recommendation r ON r.id=rr.recommendation_id
             WHERE r.rule_key='fixture.governed-monitoring' AND rr.reason_type='evidence_updated'`,
            )
          ).rows[0].count >= 1,
        );
        assert.ok(
          (
            await db.query<{ count: number }>(
              "SELECT count(*)::int count FROM clinical.event WHERE patient_id=$1 AND event_type='evidence.updated'",
              [patientId],
            )
          ).rows[0].count >= 1,
        );
      },
    );

    await t.test(
      "API exposes traceability and documented current-value selection and release",
      async () => {
        const server = createApp(db).listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => server.once("listening", resolve));
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        let cookie = "";
        let csrf = "";
        const request = async (
          path: string,
          body?: unknown,
          method = body === undefined ? "GET" : "POST",
        ) => {
          const response = await fetch(`${base}/api${path}`, {
            method,
            headers: {
              "Content-Type": "application/json",
              Cookie: cookie,
              "X-CSRF-Token": csrf,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const data = await response.json();
          const nextCookie = response.headers.get("set-cookie");
          if (nextCookie) cookie = nextCookie.split(";")[0];
          if (data.csrf) csrf = data.csrf;
          return { status: response.status, data };
        };
        try {
          assert.equal(
            (await request("/demo-session", { role: "clinician" })).status,
            200,
          );
          assert.equal((await request("/clinical-governance")).status, 403);
          assert.equal(
            (
              await request(`/patients/${patientId}/clinical-preferences`, {
                concept_system: "cardioflow",
                concept_code: "investigation.lvef",
                fact_id: olderFactId,
                action: "select",
                reason:
                  "Older verified study selected for a documented comparison",
              })
            ).status,
            201,
          );
          const selected = await request(
            `/patients/${patientId}/clinical-state`,
          );
          assert.equal(selected.status, 200);
          assert.equal(
            selected.data.state.concepts.find(
              (concept: any) => concept.concept_code === "investigation.lvef",
            ).current.id,
            olderFactId,
          );
          assert.deepEqual(
            selected.data.currentPreferences[0].competing_fact_ids,
            [newerFactId],
          );
          assert.equal(
            (
              await request(`/patients/${patientId}/clinical-preferences`, {
                concept_system: "cardioflow",
                concept_code: "investigation.lvef",
                fact_id: null,
                action: "release",
                reason: "Return to automatic verified-value resolution",
              })
            ).status,
            201,
          );
          const released = await request(
            `/patients/${patientId}/clinical-state`,
          );
          assert.equal(
            released.data.state.concepts.find(
              (concept: any) => concept.concept_code === "investigation.lvef",
            ).current.id,
            newerFactId,
          );
          const recommendation = (
            await db.query<{ id: string }>(
              `SELECT id FROM decision_support.recommendation
             WHERE patient_id=$1 AND rule_key='fixture.governed-monitoring'
             ORDER BY created_at DESC,id DESC LIMIT 1`,
              [patientId],
            )
          ).rows[0];
          const traceability = await request(
            `/recommendations/${recommendation.id}/traceability`,
          );
          assert.equal(traceability.status, 200);
          assert.equal(traceability.data.recommendation.rule_version, 2);
          assert.ok(traceability.data.patientFactsUsed.length >= 1);
          assert.ok(traceability.data.evidence.length >= 1);
          assert.equal(traceability.data.reviews[0].outcome, "approved");
        } finally {
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        }
      },
    );
  } finally {
    await db.close();
  }
});
