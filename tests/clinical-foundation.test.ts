import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  installPathway,
  installRule,
  loadClinicalState,
  recordClinicalFact,
} from "../server/clinical-foundation.js";
import {
  convertUnit,
  evaluateRules,
  resolveClinicalState,
  resolvePathway,
  searchFieldOptions,
  visibleStructuredFields,
  type ClinicalFact,
  type ClinicalRule,
  type PathwayDefinition,
  type StructuredFieldDefinition,
  type UnitDefinition,
} from "../src/clinical-foundation.js";

const patientId = "11111111-1111-4111-8111-111111111111";
function fact(
  value: number,
  observed: string,
  overrides: Partial<ClinicalFact> = {},
): ClinicalFact {
  const id = randomUUID();
  return {
    id,
    logical_id: overrides.logical_id ?? id,
    version: 1,
    patient_id: patientId,
    encounter_id: null,
    concept_system: "cardioflow",
    concept_code: "investigation.lvef",
    concept_version: 1,
    value: { type: "quantity", value, unit: "%" },
    observed_at: observed,
    effective_start: observed,
    effective_end: null,
    recorded_at: observed,
    source_type: "study",
    source_id: id,
    source_label: "Formal study",
    source_quality: "high",
    verification_status: "verified",
    lifecycle_status: "active",
    author: "test:clinician",
    supersedes_fact_id: null,
    ...overrides,
  };
}

test("current state preserves history and does not blindly prefer the newest result", () => {
  const formal = fact(32, "2026-09-01T09:00:00.000Z"),
    bedside = fact(48, "2026-09-20T09:00:00.000Z", {
      source_label: "Limited bedside study",
      source_quality: "low",
    }),
    pending = fact(52, "2026-09-21T09:00:00.000Z", {
      verification_status: "preliminary",
      source_label: "Unverified imported report",
    }),
    state = resolveClinicalState(
      [formal, bedside, pending],
      [],
      "2026-09-22T00:00:00.000Z",
    ),
    lvef = state.concepts[0];
  assert.equal(lvef.current?.id, formal.id);
  assert.equal(lvef.history.length, 3);
  assert.deepEqual(
    lvef.pending.map((item) => item.id),
    [pending.id],
  );
  assert.ok(lvef.superseded.some((item) => item.id === bedside.id));

  const overridden = resolveClinicalState(
    [formal, bedside, pending],
    [
      {
        id: randomUUID(),
        patient_id: patientId,
        concept_system: "cardioflow",
        concept_code: "investigation.lvef",
        fact_id: bedside.id,
        action: "select",
        reason: "Clinician reviewed loading conditions and selected this study",
        actor: "test:clinician",
        created_at: "2026-09-22T08:00:00.000Z",
      },
    ],
    "2026-09-22T09:00:00.000Z",
  );
  assert.equal(overridden.concepts[0].current?.id, bedside.id);
  assert.match(overridden.concepts[0].rationale, /Clinician preference/);
});

test("corrections supersede old assertions without deleting history", () => {
  const original = fact(30, "2026-08-01T09:00:00.000Z"),
    correction = fact(45, "2026-08-01T09:00:00.000Z", {
      logical_id: original.logical_id,
      version: 2,
      recorded_at: "2026-08-02T09:00:00.000Z",
      supersedes_fact_id: original.id,
    }),
    state = resolveClinicalState(
      [original, correction],
      [],
      "2026-08-03T09:00:00.000Z",
    );
  assert.equal(state.concepts[0].current?.id, correction.id);
  assert.equal(state.concepts[0].history.length, 2);
  assert.ok(
    state.concepts[0].superseded.some((item) => item.id === original.id),
  );
});

test("rule engine reports missing data, respects priority conflicts, and retains evidence", () => {
  const state = resolveClinicalState(
      [fact(30, "2026-09-20T09:00:00.000Z")],
      [],
      "2026-09-22T09:00:00.000Z",
    ),
    evidence = [
      {
        key: "synthetic-test",
        version: "1",
        title: "Synthetic architecture test",
        organization: "CardioFlow",
        publicationYear: null,
        reviewedAt: "2026-09-22",
      },
    ],
    base: ClinicalRule = {
      key: "test.monitoring",
      version: 1,
      status: "active",
      topic: "Synthetic engine validation",
      priority: 4,
      conflictGroup: "test-plan",
      trigger: {
        kind: "fact",
        conceptCode: "investigation.lvef",
        operator: "less_than",
        value: 40,
      },
      required: [
        {
          kind: "fact",
          conceptCode: "investigation.creatinine",
          operator: "exists",
        },
      ],
      output: {
        title: "Synthetic review",
        recommendation: "Review the synthetic test state.",
      },
      evidence,
    },
    missing = evaluateRules([base], state)[0];
  assert.equal(missing.status, "needs_data");
  assert.deepEqual(missing.missingConcepts, ["investigation.creatinine"]);
  assert.equal(missing.rule.evidence[0].version, "1");

  const unsafe: ClinicalRule = {
      ...base,
      key: "test.safety",
      priority: 1,
      required: [],
    },
    optimization: ClinicalRule = {
      ...base,
      key: "test.optimization",
      priority: 6,
      required: [],
    },
    resolved = evaluateRules([optimization, unsafe], state);
  assert.equal(
    resolved.find((item) => item.rule.key === "test.safety")?.status,
    "active",
  );
  assert.equal(
    resolved.find((item) => item.rule.key === "test.optimization")?.status,
    "suppressed",
  );
});

test("structured fields, option search, units, and pathways are reusable primitives", () => {
  const fields: StructuredFieldDefinition[] = [
      {
        key: "rhythm",
        label: "Rhythm",
        valueType: "choice",
        options: ["Sinus", "AF", "Flutter"],
        searchable: true,
        priority: "required",
      },
      {
        key: "af_pattern",
        label: "AF pattern",
        valueType: "choice",
        priority: "recommended",
        conditions: [{ key: "rhythm", operator: "equals", value: "AF" }],
      },
    ],
    visible = visibleStructuredFields(fields, { rhythm: "Sinus" });
  assert.deepEqual(
    visible.map((item) => item.key),
    ["rhythm"],
  );
  assert.deepEqual(searchFieldOptions(fields[0], "fl"), ["Flutter"]);
  const mg: UnitDefinition = {
      code: "mg/dL",
      symbol: "mg/dL",
      dimension: "creatinine",
      canonicalCode: "mg/dL",
      factor: 1,
      offset: 0,
      version: 1,
    },
    micro: UnitDefinition = {
      ...mg,
      code: "µmol/L",
      symbol: "µmol/L",
      factor: 1 / 88.4,
    };
  assert.ok(Math.abs(convertUnit(88.4, micro, mg) - 1) < 1e-9);

  const pathway: PathwayDefinition = {
      key: "test.pathway",
      version: 1,
      status: "active",
      title: "Synthetic pathway",
      start: "function",
      nodes: [
        {
          id: "function",
          type: "decision",
          title: "Known function",
          conceptCode: "investigation.lvef",
          choices: [
            { value: "30", label: "Reduced", next: "review" },
            { value: "50", label: "Preserved", next: "finish" },
          ],
        },
        { id: "review", type: "action", title: "Review", next: "finish" },
        { id: "finish", type: "terminal", title: "Complete" },
      ],
    },
    state = resolveClinicalState(
      [fact(30, "2026-09-20T09:00:00.000Z")],
      [],
      "2026-09-22T09:00:00.000Z",
    ),
    result = resolvePathway(pathway, state);
  assert.equal(result.complete, true);
  assert.deepEqual(result.traversed, ["function", "review", "finish"]);
  assert.equal(result.known[0].conceptCode, "investigation.lvef");
});

test("event-driven persistence invalidates obsolete recommendations and tasks", async () => {
  const db = await createDb(undefined, false),
    patient = randomUUID(),
    actor = "test:clinician";
  try {
    await db.query(
      "INSERT INTO core.patient(id,name,mrn,sex,birth_date,created_by) VALUES($1,'Foundation Sample','SYN-F001','Male','1960-01-01',$2)",
      [patient, actor],
    );
    const rule: ClinicalRule = {
      key: "test.low-value-review",
      version: 1,
      status: "active",
      topic: "Synthetic architecture test only",
      priority: 4,
      trigger: {
        kind: "fact",
        conceptCode: "investigation.lvef",
        operator: "less_than",
        value: 40,
      },
      output: {
        title: "Synthetic reassessment",
        recommendation:
          "A synthetic reassessment is available for engine testing.",
        alert: { category: "clinical_review", severity: "moderate" },
        tasks: [
          {
            kind: "reassessment",
            purpose: "Review the synthetic result",
            dueInDays: 7,
            relatedConcept: "investigation.lvef",
          },
        ],
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
    await installRule(db, rule, actor);
    let first!: ClinicalFact;
    await db.transaction(async (tx) => {
      first = await recordClinicalFact(
        tx,
        patient,
        {
          concept_system: "cardioflow",
          concept_code: "investigation.lvef",
          concept_version: 1,
          value: { type: "quantity", value: 30, unit: "%" },
          observed_at: "2025-09-20T09:00:00.000Z",
          source_type: "synthetic_test",
          source_id: "study-1",
          source_label: "Synthetic verified study",
          source_quality: "high",
          verification_status: "verified",
          lifecycle_status: "active",
        },
        actor,
      );
    });
    assert.equal(
      (
        await db.query<{ status: string }>(
          "SELECT status FROM decision_support.recommendation WHERE patient_id=$1 ORDER BY created_at DESC LIMIT 1",
          [patient],
        )
      ).rows[0].status,
      "active",
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int count FROM decision_support.alert WHERE patient_id=$1",
          [patient],
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int count FROM workflow.clinical_task WHERE patient_id=$1",
          [patient],
        )
      ).rows[0].count,
      1,
    );

    await db.transaction(async (tx) => {
      await recordClinicalFact(
        tx,
        patient,
        {
          concept_system: "cardioflow",
          concept_code: "investigation.lvef",
          concept_version: 1,
          value: { type: "quantity", value: 50, unit: "%" },
          observed_at: "2025-09-22T09:00:00.000Z",
          source_type: "synthetic_test",
          source_id: "study-2",
          source_label: "Synthetic repeat study",
          source_quality: "high",
          verification_status: "verified",
          lifecycle_status: "active",
          supersedes_fact_id: first.id,
        },
        actor,
      );
    });
    const recommendations = (
        await db.query<any>(
          "SELECT * FROM decision_support.recommendation WHERE patient_id=$1 ORDER BY created_at,id",
          [patient],
        )
      ).rows,
      taskEvents = (
        await db.query<any>(
          "SELECT e.* FROM workflow.clinical_task_event e JOIN workflow.clinical_task t ON t.id=e.task_id WHERE t.patient_id=$1 ORDER BY e.version",
          [patient],
        )
      ).rows,
      state = await loadClinicalState(db, patient);
    assert.deepEqual(
      recommendations.map((item) => item.status),
      ["active", "resolved"],
    );
    assert.deepEqual(
      taskEvents.map((item) => item.status),
      ["open", "superseded"],
    );
    assert.equal(
      (state.concepts[0].current?.value as { value: number }).value,
      50,
    );
    assert.equal(state.concepts[0].history.length, 2);
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int count FROM decision_support.recalculation_run WHERE patient_id=$1",
          [patient],
        )
      ).rows[0].count,
      2,
    );
    await assert.rejects(
      db.query("UPDATE clinical.fact SET source_label='changed' WHERE id=$1", [
        first.id,
      ]),
      /Append-only record/,
    );
    await assert.rejects(
      db.query(
        "DELETE FROM decision_support.recommendation WHERE patient_id=$1",
        [patient],
      ),
      /Append-only record/,
    );

    const pathway: PathwayDefinition = {
      key: "test.persisted-pathway",
      version: 1,
      status: "active",
      title: "Persisted synthetic pathway",
      start: "known",
      nodes: [
        {
          id: "known",
          type: "decision",
          title: "Use known result",
          conceptCode: "investigation.lvef",
          choices: [{ value: "50", label: "Known", next: "done" }],
        },
        { id: "done", type: "terminal", title: "Done" },
      ],
    };
    await installPathway(db, pathway, actor);
    assert.equal(
      (
        await db.query<{ status: string }>(
          "SELECT status FROM decision_support.pathway_definition WHERE key=$1",
          [pathway.key],
        )
      ).rows[0].status,
      "active",
    );
  } finally {
    await db.close();
  }
});

test("clinical foundation API enforces roles and projects guided care with provenance", async () => {
  const db = await createDb(undefined, false),
    server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  function client() {
    let cookie = "",
      csrf = "";
    return async (
      path: string,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) => {
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
    };
  }
  const anonymous = client(),
    clinician = client(),
    reviewer = client();
  try {
    assert.equal((await anonymous("/clinical/catalog")).status, 401);
    await clinician("/demo-session", { role: "clinician" });
    await reviewer("/demo-session", { role: "reviewer" });
    const patient = await clinician("/patients", {
      name: "Projection Sample",
      mrn: "SYN-PROJECTION-01",
      sex: "Female",
      birth_date: "1975-01-01",
    });
    assert.equal(patient.status, 201);
    assert.equal((await reviewer("/clinical/catalog")).status, 200);
    assert.equal(
      (
        await reviewer(`/patients/${patient.data.id}/clinical-facts`, {
          concept_code: "investigation.lvef",
        })
      ).status,
      403,
    );
    const payload = {
      template_key: "investigation.lvef",
      answers: {
        value: 35,
        unit: "%",
        interpretation: "Abnormal — action documented",
        sample_status: "Current encounter",
      },
      status: "resulted",
      encounter_id: null,
      occurred_on: "2025-09-01",
      due_date: "2025-09-02",
      owner: "Echo team",
      note: "Synthetic test result",
      action_note: "",
      response_note: "",
    };
    const created = await clinician(
      `/patients/${patient.data.id}/care/guided`,
      {
        entries: [payload],
      },
    );
    assert.equal(created.status, 201, JSON.stringify(created.data));
    let state = await clinician(
      `/patients/${patient.data.id}/clinical-state?asOf=2026-09-22T00%3A00%3A00.000Z`,
    );
    assert.equal(state.status, 200);
    const pending = state.data.state.concepts.find(
      (item: any) => item.concept_code === "investigation.lvef",
    );
    assert.equal(pending.current, null);
    assert.equal(pending.pending.length, 1);

    const updated = await clinician(
      `/care/guided/${created.data[0].id}`,
      {
        ...payload,
        status: "reviewed",
        due_date: null,
        version: created.data[0].version,
        action_note: "Clinician reviewed the study",
        response_note: "Result incorporated into the current record",
      },
      "PUT",
    );
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    state = await clinician(
      `/patients/${patient.data.id}/clinical-state?asOf=2026-09-22T00%3A00%3A00.000Z`,
    );
    const current = state.data.state.concepts.find(
      (item: any) => item.concept_code === "investigation.lvef",
    );
    assert.equal(current.current.value.value, 35);
    assert.equal(current.current.source_type, "care_entry");
    assert.equal(current.current.source_id, created.data[0].id);
    assert.equal(current.history.length, 2);
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int count FROM decision_support.recalculation_run WHERE patient_id=$1",
          [patient.data.id],
        )
      ).rows[0].count,
      2,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
