import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../server/app.js";
import { createDb } from "../server/db.js";
import {
  resolveHfPhenotypeState,
  type HfEcho,
  type HfReview,
} from "../src/heart-failure.js";

const observed = "2026-09-22T08:00:00.000Z";
function echo(id: string, lvef: number, at = observed): HfEcho {
  return {
    id,
    study_type: "FORMAL_TTE",
    study_quality: "GOOD",
    observed_at: at,
    lvef,
    lvef_fact_id: `fact-${id}`,
    rv_function: "NORMAL",
    valve_summary: [],
    pulmonary_pressure_context: "",
    diastolic_context: "",
    pericardial_context: "",
    structural_context: "",
    source_label: "Synthetic formal echo",
    verification_status: "verified",
    author: "test",
  };
}
function review(sourceId: string): HfReview {
  return {
    id: "review-1",
    profile_id: "profile-1",
    version: 1,
    encounter_id: null,
    status: "CURRENT_SYMPTOMATIC",
    presentation: "NEWLY_DIAGNOSED",
    symptoms: [],
    symptoms_reviewed_unchanged: true,
    nyha_class: "II",
    etiologies: ["Ischaemic"],
    physical_findings: {},
    clinician_congestion: "NO_EVIDENT_CONGESTION",
    clinician_phenotype: "HFrEF",
    phenotype_source_echo_id: sourceId,
    therapy_decisions: [],
    narrative: "Synthetic architecture fixture",
    observed_at: observed,
    author: "test",
  };
}

test("HF phenotype resolver preserves clinician history and requires reassessment for newer imaging", () => {
  assert.equal(
    resolveHfPhenotypeState(null, echo("echo-a", 30)).status,
    "NOT_ASSESSED",
  );
  assert.equal(
    resolveHfPhenotypeState(review("echo-a"), echo("echo-a", 30)).status,
    "CONFIRMED",
  );
  const changed = resolveHfPhenotypeState(
    review("echo-a"),
    echo("echo-b", 55, "2026-10-10T08:00:00.000Z"),
  );
  assert.equal(changed.value, "HFrEF");
  assert.equal(changed.status, "REASSESSMENT_REQUIRED");
  assert.match(changed.reason, /previous phenotype remains historical/i);
});

test("Stage 3 connects eight HF cases while keeping candidate guidance unpublished", async () => {
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
  const people: string[] = [];
  async function patient(caseNumber: number) {
    const response = await call("/patients", {
      name: `HF Case ${caseNumber}`,
      mrn: `SYN-HF-00${caseNumber}`,
      sex: caseNumber % 2 ? "Male" : "Female",
      birth_date: "1960-01-01",
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    people.push(response.data.id);
    return response.data.id as string;
  }
  async function addEcho(
    id: string,
    lvef: number,
    day = "2026-09-22T08:00:00.000Z",
  ) {
    const response = await call(`/patients/${id}/heart-failure/echoes`, {
      encounter_id: null,
      study_type: "FORMAL_TTE",
      study_quality: "GOOD",
      observed_at: day,
      lvef,
      rv_function: "NORMAL",
      valve_summary: [],
      pulmonary_pressure_context: "",
      diastolic_context: "",
      pericardial_context: "",
      structural_context: "Synthetic test imaging",
      source_label: `Formal TTE ${day.slice(0, 10)}`,
      verification_status: "verified",
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
  }
  async function addReview(
    id: string,
    phenotype: "HFrEF" | "HFpEF" | "UNCLASSIFIED",
    sourceId: string | null,
    overrides: Record<string, unknown> = {},
  ) {
    const response = await call(`/patients/${id}/heart-failure/reviews`, {
      encounter_id: null,
      status: "CURRENT_SYMPTOMATIC",
      presentation: "NEWLY_DIAGNOSED",
      symptoms: [
        { symptom: "Exertional dyspnoea", severity: "moderate", change: "new" },
      ],
      symptoms_reviewed_unchanged: false,
      nyha_class: "II",
      etiologies: ["Unknown / under investigation"],
      physical_findings: {},
      clinician_congestion: "NO_EVIDENT_CONGESTION",
      clinician_phenotype: phenotype,
      phenotype_source_echo_id: sourceId,
      therapy_decisions: [],
      narrative: "Synthetic clinician review",
      observed_at: observed,
      ...overrides,
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
  }
  async function pathway(
    id: string,
    type: string,
    state: string,
    severity = "MODERATE",
  ) {
    const response = await call(`/patients/${id}/heart-failure/pathways`, {
      encounter_id: null,
      pathway_type: type,
      state,
      severity,
      patient_data: {},
      missing_information: [],
      considerations: ["Clinician interpretation recorded"],
      medication_implications: [],
      monitoring_plan: {},
      escalation: "Review in clinical context",
      evidence_note: "",
      observed_at: observed,
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
  }
  try {
    await call("/demo-session", { role: "clinician" });

    // 1. Newly diagnosed HFrEF: imaging and clinician-confirmed phenotype connect.
    const newHfref = await patient(1),
      firstEcho = await addEcho(newHfref, 30);
    await addReview(newHfref, "HFrEF", firstEcho.id);
    let state = (await call(`/patients/${newHfref}/heart-failure`)).data;
    assert.equal(state.phenotype.status, "CONFIRMED");
    assert.equal(state.phenotype.value, "HFrEF");
    assert.equal(state.preferredEcho.lvef, 30);

    // 2–4. Low BP, hyperkalaemia and renal change use explicit clinician pathways.
    const lowBp = await patient(2);
    await pathway(
      lowBp,
      "HYPOTENSION",
      "Symptomatic low blood pressure",
      "HIGH",
    );
    const highK = await patient(3);
    await pathway(
      highK,
      "HYPERKALAEMIA",
      "Increasing potassium under review",
      "HIGH",
    );
    const renal = await patient(4);
    await pathway(
      renal,
      "WORSENING_RENAL_FUNCTION",
      "Renal deterioration with persistent congestion",
      "HIGH",
    );

    // 5. Improved EF never overwrites the earlier HFrEF classification.
    const improved = await patient(5),
      oldEcho = await addEcho(improved, 28);
    await addReview(improved, "HFrEF", oldEcho.id);
    await addEcho(improved, 55, "2026-09-22T09:00:00.000Z");
    state = (await call(`/patients/${improved}/heart-failure`)).data;
    assert.equal(state.phenotype.value, "HFrEF");
    assert.equal(state.phenotype.status, "REASSESSMENT_REQUIRED");
    assert.equal(state.reviews.length, 1);
    assert.ok(
      state.integratedPlan.some((item: any) => /phenotype/i.test(item.purpose)),
    );

    // 6. HFpEF is clinician confirmed from a separate imaging source.
    const hfpef = await patient(6),
      preservedEcho = await addEcho(hfpef, 60);
    await addReview(hfpef, "HFpEF", preservedEcho.id);
    state = (await call(`/patients/${hfpef}/heart-failure`)).data;
    assert.equal(state.phenotype.value, "HFpEF");

    // 7. Discharge creates exact, shared follow-up dates and captures rehab.
    const discharge = await patient(7);
    assert.equal(
      (
        await call(`/patients/${discharge}/heart-failure/discharge-reviews`, {
          encounter_id: null,
          clinical_stability: "CONFIRMED",
          congestion_reviewed: true,
          medication_reconciliation: true,
          renal_electrolytes_reviewed: true,
          titration_plan_reviewed: true,
          education_reviewed: true,
          rehabilitation_reviewed: true,
          outstanding_items: [],
          laboratory_date: "2026-09-25",
          clinic_date: "2026-10-01",
          echo_date: "2026-12-22",
          device_reassessment_date: null,
          note: "Synthetic discharge test",
          observed_at: observed,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await call(`/patients/${discharge}/heart-failure/rehabilitation`, {
          encounter_id: null,
          status: "REFERRED",
          limitation: "",
          referral_date: "2026-09-22",
          planned_start_date: "2026-10-05",
          exercise_context: "Clinician reviewed",
          note: "Synthetic referral",
          observed_at: observed,
        })
      ).status,
      201,
    );
    state = (await call(`/patients/${discharge}/heart-failure`)).data;
    assert.deepEqual(
      state.integratedPlan.map((item: any) => item.target_date).sort(),
      ["2026-09-25", "2026-10-01", "2026-12-22"],
    );
    assert.equal(state.rehabilitation.status, "REFERRED");

    // 8. Advanced HF remains a documented assessment requiring specialist judgement.
    const advanced = await patient(8);
    await addReview(advanced, "UNCLASSIFIED", null, {
      status: "ADVANCED",
      presentation: "ADVANCED_ASSESSMENT",
    });
    await pathway(
      advanced,
      "ADVANCED_HF",
      "Repeated admission and severe limitation constellation",
      "CRITICAL",
    );
    state = (await call(`/patients/${advanced}/heart-failure`)).data;
    assert.equal(state.currentReview.status, "ADVANCED");
    assert.equal(state.pathways[0].pathway_type, "ADVANCED_HF");

    const pack = await call("/heart-failure/review-pack");
    assert.equal(pack.status, 200);
    assert.equal(pack.data.length, 15);
    assert.ok(
      pack.data.every(
        (item: any) => item.lifecycle_state === "CLINICAL_REVIEW",
      ),
    );
    assert.ok(
      pack.data.every((item: any) => item.definition.status === "draft"),
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM decision_support.rule_current_state WHERE key LIKE 'hf.%' AND lifecycle_state='PUBLISHED'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "SELECT * FROM decision_support.recommendation WHERE rule_key LIKE 'hf.%'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "SELECT count(*)::int count FROM heart_failure.profile",
        )
      ).rows[0].count,
      8,
    );
    await assert.rejects(
      db.query(
        "UPDATE heart_failure.review_event SET narrative='changed' WHERE profile_id=(SELECT id FROM heart_failure.profile WHERE patient_id=$1)",
        [advanced],
      ),
      /append-only/i,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
