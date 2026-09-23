import assert from "node:assert/strict";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { createDb } from "../server/db.js";
import { installRule } from "../server/clinical-foundation.js";
import {
  bmi,
  ckdEpi2021Creatinine,
  cockcroftGault,
  mostellerBsa,
  monitoringState,
  resolveTitrationState,
  trendDirection,
  type MedicationStatus,
} from "../src/medication-laboratory.js";
import type { ClinicalRule } from "../src/clinical-foundation.js";
import {
  evaluateRule,
  resolveClinicalState,
  type ClinicalFact,
} from "../src/clinical-foundation.js";

function syntheticQuantityFact(
  conceptCode: string,
  value: number,
  unit: string,
): ClinicalFact {
  return {
    id: `fact-${conceptCode}-${value}`,
    logical_id: `logical-${conceptCode}`,
    version: 1,
    patient_id: "synthetic-patient",
    encounter_id: null,
    concept_system: "cardioflow",
    concept_code: conceptCode,
    concept_version: 1,
    value: { type: "quantity", value, unit },
    observed_at: "2026-09-22T08:00:00.000Z",
    effective_start: "2026-09-22T08:00:00.000Z",
    effective_end: null,
    recorded_at: "2026-09-22T08:00:00.000Z",
    source_type: "synthetic_test",
    source_id: `source-${conceptCode}`,
    source_label: "Synthetic test fixture",
    source_quality: "high",
    verification_status: "verified",
    lifecycle_status: "active",
    author: "test",
    supersedes_fact_id: null,
  };
}

test("validated derived calculation primitives keep renal estimates distinct", () => {
  assert.equal(Number(bmi(80, 180).toFixed(1)), 24.7);
  assert.equal(Number(mostellerBsa(80, 180).toFixed(2)), 2);
  assert.equal(Number(ckdEpi2021Creatinine(1, 60, "Male").toFixed(1)), 86.2);
  assert.equal(Number(cockcroftGault(1, 60, 80, "Male").toFixed(1)), 88.9);
  assert.notEqual(
    ckdEpi2021Creatinine(1, 60, "Male"),
    cockcroftGault(1, 60, 80, "Male"),
  );
  assert.throws(() => ckdEpi2021Creatinine(1, 16, "Male"), /Adult age/);
  assert.equal(trendDirection([5.4, 4.8]), "increasing");
  assert.equal(trendDirection([4.8, 5.4]), "decreasing");
  assert.equal(trendDirection([4.8, 4.8]), "unchanged");
  assert.equal(monitoringState("2026-09-21", "open", "2026-09-22"), "overdue");
  assert.equal(
    monitoringState("2026-09-22", "open", "2026-09-22"),
    "due_today",
  );
  assert.equal(monitoringState("2026-09-23", "open", "2026-09-22"), "upcoming");
  assert.equal(
    monitoringState("2026-09-21", "completed", "2026-09-22"),
    "complete",
  );
  assert.equal(
    resolveTitrationState({ planned: true, requiredChecksComplete: true }),
    "READY_FOR_REVIEW",
  );
  assert.equal(
    resolveTitrationState({ planned: true, requiredChecksComplete: false }),
    "WAITING_FOR_MONITORING",
  );
  assert.equal(
    resolveTitrationState({ targetAchieved: true }),
    "TARGET_ACHIEVED",
  );
  assert.equal(
    resolveTitrationState({ maximallyTolerated: true }),
    "MAXIMALLY_TOLERATED",
  );
  assert.equal(
    resolveTitrationState({ limitation: "current" }),
    "TITRATION_DEFERRED",
  );
  assert.equal(resolveTitrationState({ stopped: true }), "STOPPED");
  assert.equal(resolveTitrationState({}), "NOT_REQUIRED");
  assert.equal(trendDirection([4.8]), "single");
});

test("medication rules can consume current BP and HR while remaining fixture-only", () => {
  const rule: ClinicalRule = {
    key: "test.stage2-vitals-limitation",
    version: 1,
    status: "active",
    topic: "Synthetic vitals architecture test only",
    priority: 2,
    trigger: {
      kind: "any",
      conditions: [
        {
          kind: "fact",
          conceptCode: "vital.systolic_blood_pressure",
          operator: "less_than",
          value: 90,
        },
        {
          kind: "fact",
          conceptCode: "vital.heart_rate",
          operator: "less_than",
          value: 50,
        },
      ],
    },
    output: {
      title: "Synthetic vitals review",
      recommendation: "Architecture fixture only.",
      titration: {
        medicationId: "synthetic-medication",
        state: "TITRATION_DEFERRED",
        limitationType: "CURRENT_TITRATION_LIMITATION",
      },
    },
    evidence: [
      {
        key: "synthetic",
        version: "1",
        title: "Synthetic test evidence",
        organization: "CardioFlow test suite",
        publicationYear: null,
        reviewedAt: "2026-09-22",
      },
    ],
  };
  const acceptable = resolveClinicalState([
    syntheticQuantityFact("vital.systolic_blood_pressure", 120, "mmHg"),
    syntheticQuantityFact("vital.heart_rate", 70, "beats/min"),
  ]);
  const lowBp = resolveClinicalState([
    syntheticQuantityFact("vital.systolic_blood_pressure", 85, "mmHg"),
    syntheticQuantityFact("vital.heart_rate", 70, "beats/min"),
  ]);
  const bradycardia = resolveClinicalState([
    syntheticQuantityFact("vital.systolic_blood_pressure", 120, "mmHg"),
    syntheticQuantityFact("vital.heart_rate", 45, "beats/min"),
  ]);
  assert.equal(evaluateRule(rule, acceptable).status, "inactive");
  assert.equal(evaluateRule(rule, lowBp).status, "active");
  assert.equal(evaluateRule(rule, bradycardia).status, "active");
});

test("Stage 2 medication, laboratory, safety, monitoring and titration foundation is longitudinal and governed", async () => {
  const db = await createDb(undefined, false);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = "",
    csrf = "";
  async function call(
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie")!.split(";")[0];
    if (data.csrf) csrf = data.csrf;
    return { status: response.status, data };
  }
  try {
    await call("/demo-session", { role: "clinician" });
    const patientResponse = await call("/patients", {
      name: "Stage Two Sample",
      mrn: "SYN-STAGE2-001",
      sex: "Male",
      birth_date: "1966-09-22",
      weight_kg: 80,
      height_cm: 180,
    });
    assert.equal(patientResponse.status, 201);
    const patientId = patientResponse.data.id;

    const catalog = await call(
      `/medications/catalog?q=spirono&patientId=${patientId}`,
    );
    assert.equal(catalog.status, 200);
    assert.equal(catalog.data.medications[0].medication_id, "spironolactone");
    assert.ok(
      catalog.data.medications[0].groups.some(
        (group: any) => group.group_id === "mras",
      ),
    );
    assert.ok(
      catalog.data.groups.some(
        (group: any) => group.group_id === "dual-gip-glp1",
      ),
    );

    const reaction = await call(`/patients/${patientId}/adverse-reactions`, {
      medication_id: "ramipril",
      substance_text: "Ramipril",
      reaction_type: "INTOLERANCE",
      reaction: "Synthetic cough history",
      severity: "mild",
      observed_on: "2026-08-01",
      source_type: "clinician",
      source_id: "synthetic-reaction",
    });
    assert.equal(reaction.status, 201);
    const allergy = await call(`/patients/${patientId}/adverse-reactions`, {
      medication_id: "enalapril",
      substance_text: "Enalapril",
      reaction_type: "ALLERGY",
      reaction: "Synthetic immediate hypersensitivity",
      severity: "severe",
      observed_on: "2026-08-02",
      source_type: "clinician",
      source_id: "synthetic-allergy",
    });
    assert.equal(allergy.status, 201);
    const allergyContext = await call(
      `/medications/catalog?q=enalapril&patientId=${patientId}`,
    );
    assert.equal(
      allergyContext.data.patientSafety.adverseReactions.find(
        (item: any) => item.medication_id === "enalapril",
      ).reaction_type,
      "ALLERGY",
    );

    const started = await call(`/patients/${patientId}/medications`, {
      medication_id: "spironolactone",
      product_id: null,
      encounter_id: null,
      source_type: "clinician",
      event: {
        status: "ACTIVE" satisfies MedicationStatus,
        event_type: "started",
        dose_value: 25,
        dose_unit: "mg",
        frequency: "Once daily",
        route: "Oral",
        effective_at: "2026-09-22T08:00:00.000Z",
        indications: ["HFrEF"],
        prescribing_clinician: "Dr Test",
        target_dose_value: 50,
        target_dose_unit: "mg",
      },
    });
    assert.equal(started.status, 201, JSON.stringify(started.data));
    const therapyId = started.data.therapy.id;

    const duplicate = await call(`/patients/${patientId}/medications`, {
      medication_id: "spironolactone",
      event: {
        status: "ACTIVE",
        event_type: "started",
        dose_value: 25,
        dose_unit: "mg",
        frequency: "Once daily",
        route: "Oral",
        effective_at: "2026-09-22T09:00:00.000Z",
        indications: [],
        prescribing_clinician: "Dr Test",
      },
    });
    assert.equal(duplicate.status, 409);

    const increased = await call(`/medication-therapies/${therapyId}/events`, {
      status: "ACTIVE",
      event_type: "dose_increased",
      dose_value: 50,
      dose_unit: "mg",
      frequency: "Once daily",
      route: "Oral",
      effective_at: "2026-09-22T08:30:00.000Z",
      indications: ["HFrEF"],
      prescribing_clinician: "Dr Test",
    });
    assert.equal(increased.status, 201, JSON.stringify(increased.data));
    const held = await call(`/medication-therapies/${therapyId}/events`, {
      status: "TEMPORARILY_HELD",
      event_type: "held",
      dose_value: 50,
      dose_unit: "mg",
      frequency: "Once daily",
      route: "Oral",
      effective_at: "2026-09-22T08:45:00.000Z",
      indications: ["HFrEF"],
      prescribing_clinician: "Dr Test",
      reason: "Synthetic monitoring review",
    });
    assert.equal(held.status, 201);
    const restarted = await call(`/medication-therapies/${therapyId}/events`, {
      status: "ACTIVE",
      event_type: "restarted",
      dose_value: 25,
      dose_unit: "mg",
      frequency: "Once daily",
      route: "Oral",
      effective_at: "2026-09-22T09:00:00.000Z",
      indications: ["HFrEF"],
      prescribing_clinician: "Dr Test",
      reason: "Synthetic restart",
    });
    assert.equal(restarted.status, 201);
    const decreased = await call(`/medication-therapies/${therapyId}/events`, {
      status: "ACTIVE",
      event_type: "dose_decreased",
      dose_value: 20,
      dose_unit: "mg",
      frequency: "Once daily",
      route: "Oral",
      effective_at: "2026-09-22T09:05:00.000Z",
      indications: ["HFrEF"],
      prescribing_clinician: "Dr Test",
      reason: "Synthetic dose decrease",
    });
    assert.equal(decreased.status, 201);
    const stopped = await call(`/medication-therapies/${therapyId}/events`, {
      status: "STOPPED",
      event_type: "stopped",
      dose_value: 20,
      dose_unit: "mg",
      frequency: "Once daily",
      route: "Oral",
      effective_at: "2026-09-22T09:10:00.000Z",
      indications: ["HFrEF"],
      prescribing_clinician: "Dr Test",
      reason: "Synthetic stop",
      discontinuation_date: "2026-09-22",
    });
    assert.equal(stopped.status, 201);
    const restartedAgain = await call(
      `/medication-therapies/${therapyId}/events`,
      {
        status: "ACTIVE",
        event_type: "restarted",
        dose_value: 25,
        dose_unit: "mg",
        frequency: "Once daily",
        route: "Oral",
        effective_at: "2026-09-22T09:15:00.000Z",
        indications: ["HFrEF"],
        prescribing_clinician: "Dr Test",
        reason: "Synthetic second restart",
      },
    );
    assert.equal(restartedAgain.status, 201);

    const medications = await call(`/patients/${patientId}/medications`);
    assert.equal(medications.data.current[0].dose_value, 25);
    assert.deepEqual(
      medications.data.history.map((event: any) => event.event_type),
      [
        "restarted",
        "stopped",
        "dose_decreased",
        "restarted",
        "held",
        "dose_increased",
        "started",
      ],
    );
    assert.ok(
      medications.data.monitoringRelations.some(
        (item: any) => item.parameter_code === "potassium",
      ),
    );
    assert.equal(
      medications.data.adverseReactions.find(
        (item: any) => item.medication_id === "ramipril",
      ).reaction_type,
      "INTOLERANCE",
    );
    await assert.rejects(
      db.query(
        "UPDATE medication.therapy_event SET dose_value=1 WHERE therapy_id=$1",
        [therapyId],
      ),
      /Append-only/,
    );

    const fixtureRule: ClinicalRule = {
      key: "test.stage2-potassium-review",
      version: 1,
      status: "active",
      topic: "Synthetic Stage 2 architecture test only",
      priority: 2,
      trigger: {
        kind: "all",
        conditions: [
          {
            kind: "fact",
            conceptCode: "medication.spironolactone.status",
            operator: "equals",
            value: "ACTIVE",
          },
          {
            kind: "fact",
            conceptCode: "laboratory.potassium",
            operator: "greater_than",
            value: 5,
          },
        ],
      },
      output: {
        title: "Synthetic potassium review",
        recommendation:
          "Synthetic fixture: review current medication and potassium.",
        medicationId: "spironolactone",
        alert: { category: "warning", severity: "high" },
        tasks: [
          {
            kind: "laboratory",
            purpose: "Synthetic repeat potassium",
            dueInDays: 3,
            acceptableWindowAfterDays: 2,
            medicationId: "spironolactone",
            relatedConcept: "laboratory.potassium",
          },
        ],
        titration: {
          medicationId: "spironolactone",
          state: "WAITING_FOR_MONITORING",
          requiredChecks: ["laboratory.potassium", "laboratory.creatinine"],
          nextLaboratoryInDays: 3,
          limitationType: "CURRENT_TITRATION_LIMITATION",
          limitationReason: "Synthetic laboratory limitation",
        },
      },
      evidence: [
        {
          key: "cardioflow-foundation",
          version: "1",
          title: "CardioFlow clinical foundation engineering contract",
          organization: "CardioFlow",
          publicationYear: null,
          reviewedAt: "2026-09-22",
        },
      ],
    };
    await installRule(db, fixtureRule, "test:technical-admin");

    const potassiumOne = await call(`/patients/${patientId}/laboratory`, {
      test_id: "potassium",
      value: 4.8,
      unit: "mmol/L",
      specimen: "Serum",
      collected_at: "2026-09-22T09:10:00.000Z",
      resulted_at: "2026-09-22T09:20:00.000Z",
      source_type: "laboratory",
      source_id: "K-1",
      source_label: "Synthetic laboratory",
      verification_status: "verified",
    });
    assert.equal(potassiumOne.status, 201, JSON.stringify(potassiumOne.data));
    const potassiumTwo = await call(`/patients/${patientId}/laboratory`, {
      test_id: "potassium",
      value: 5.4,
      unit: "mmol/L",
      specimen: "Serum",
      collected_at: "2026-09-22T09:30:00.000Z",
      resulted_at: "2026-09-22T09:40:00.000Z",
      source_type: "laboratory",
      source_id: "K-2",
      source_label: "Synthetic laboratory",
      verification_status: "verified",
    });
    assert.equal(potassiumTwo.status, 201, JSON.stringify(potassiumTwo.data));
    const labs = await call(`/patients/${patientId}/laboratory`);
    const trend = labs.data.trends.find(
      (item: any) => item.test_id === "potassium",
    );
    assert.equal(trend.direction, "increasing");
    assert.ok(Math.abs(trend.change - 0.6) < 0.00001);

    const creatinine = await call(`/patients/${patientId}/laboratory`, {
      test_id: "creatinine",
      value: 88.4,
      unit: "µmol/L",
      specimen: "Serum",
      collected_at: "2026-09-22T09:45:00.000Z",
      resulted_at: "2026-09-22T09:50:00.000Z",
      source_type: "laboratory",
      source_id: "CR-1",
      source_label: "Synthetic laboratory",
      verification_status: "verified",
    });
    assert.equal(creatinine.status, 201, JSON.stringify(creatinine.data));
    assert.equal(creatinine.data.result.original_value, 88.4);
    assert.equal(creatinine.data.result.original_unit, "µmol/L");
    assert.equal(creatinine.data.result.canonical_unit, "mg/dL");
    assert.equal(creatinine.data.derived.length, 2);
    assert.deepEqual(
      creatinine.data.derived.map((item: any) => item.test_id).sort(),
      ["crcl-cockcroft-gault", "egfr-ckd-epi-2021"],
    );

    const clinical = await call(`/patients/${patientId}/clinical-state`);
    assert.ok(
      clinical.data.alerts.some(
        (alert: any) => alert.title === "Synthetic potassium review",
      ),
      JSON.stringify({
        alerts: clinical.data.alerts,
        recommendations: clinical.data.recommendations,
        concepts: clinical.data.state.concepts.filter((item: any) =>
          ["medication.spironolactone.status", "laboratory.potassium"].includes(
            item.concept_code,
          ),
        ),
      }),
    );
    const task = clinical.data.tasks.find(
      (item: any) => item.purpose === "Synthetic repeat potassium",
    );
    const expectedTarget = new Date();
    expectedTarget.setUTCDate(expectedTarget.getUTCDate() + 3);
    const expectedWindowEnd = new Date(expectedTarget);
    expectedWindowEnd.setUTCDate(expectedWindowEnd.getUTCDate() + 2);
    assert.equal(task.target_date, expectedTarget.toISOString().slice(0, 10));
    assert.equal(
      task.acceptable_window_end,
      expectedWindowEnd.toISOString().slice(0, 10),
    );
    assert.equal(task.medication_therapy_id, therapyId);
    assert.ok(
      (
        await call(`/patients/${patientId}/medications`)
      ).data.titrationPlans.some(
        (plan: any) => plan.state === "WAITING_FOR_MONITORING",
      ),
    );

    const selectPreferred = await call(
      `/patients/${patientId}/clinical-preferences`,
      {
        concept_system: "cardioflow",
        concept_code: "laboratory.potassium",
        fact_id: potassiumOne.data.result.clinical_fact_id,
        action: "select",
        reason:
          "Synthetic verified source selected for current-value override test",
      },
    );
    assert.equal(
      selectPreferred.status,
      201,
      JSON.stringify(selectPreferred.data),
    );
    let overridden = await call(`/patients/${patientId}/clinical-state`);
    assert.equal(
      overridden.data.state.concepts.find(
        (item: any) => item.concept_code === "laboratory.potassium",
      ).current.id,
      potassiumOne.data.result.clinical_fact_id,
    );
    assert.equal(
      overridden.data.recommendations.current.find(
        (item: any) => item.rule_key === fixtureRule.key,
      ).status,
      "resolved",
    );
    const releasePreferred = await call(
      `/patients/${patientId}/clinical-preferences`,
      {
        concept_system: "cardioflow",
        concept_code: "laboratory.potassium",
        fact_id: null,
        action: "release",
        reason: "Synthetic override released after verification",
      },
    );
    assert.equal(releasePreferred.status, 201);
    overridden = await call(`/patients/${patientId}/clinical-state`);
    assert.equal(
      overridden.data.recommendations.current.find(
        (item: any) => item.rule_key === fixtureRule.key,
      ).status,
      "active",
    );

    const potassiumNormal = await call(`/patients/${patientId}/laboratory`, {
      test_id: "potassium",
      value: 4.4,
      unit: "mmol/L",
      specimen: "Serum",
      collected_at: "2026-09-22T10:00:00.000Z",
      resulted_at: "2026-09-22T10:10:00.000Z",
      source_type: "laboratory",
      source_id: "K-3",
      source_label: "Synthetic laboratory",
      verification_status: "verified",
    });
    assert.equal(potassiumNormal.status, 201);
    const recommendationStates = (
      await db.query<any>(
        "SELECT status FROM decision_support.recommendation WHERE patient_id=$1 AND rule_key=$2 ORDER BY generation_sequence",
        [patientId, fixtureRule.key],
      )
    ).rows.map((row) => row.status);
    assert.deepEqual(recommendationStates, [
      "active",
      "resolved",
      "active",
      "resolved",
    ]);
    const taskStates = (
      await db.query<any>(
        `SELECT e.status FROM workflow.clinical_task_event e JOIN workflow.clinical_task t ON t.id=e.task_id
       WHERE t.patient_id=$1 AND t.rule_key=$2 ORDER BY e.version`,
        [patientId, fixtureRule.key],
      )
    ).rows.map((row) => row.status);
    assert.equal(taskStates.filter((state) => state === "open").length, 2);
    assert.equal(
      taskStates.filter((state) => state === "superseded").length,
      2,
    );
  } finally {
    server.close();
    await db.close();
  }
});
