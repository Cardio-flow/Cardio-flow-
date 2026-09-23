import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../server/app.js";
import { createDb } from "../server/db.js";
import { preferredEchoStudy, type EchoStudy } from "../src/echo-valve.js";

test("shared Echo preference keeps a high-quality formal study over a newer limited bedside study", () => {
  const base = {
    revision_id: "revision",
    version: 1,
    patient_id: "patient",
    encounter_id: null,
    location: "",
    comparison_study_id: null,
    status: "FINAL",
    indication: [],
    priority: "ROUTINE",
    quality_reasons: [],
    rhythm_context: "",
    heart_rate: null,
    blood_pressure: "",
    contrast_used: false,
    structured_findings: {},
    interpretation: "",
    comparison_summary: "",
    conclusion: "Synthetic",
    clinician_override_reason: "",
    reporting_cardiologist: "test",
    amendment_reason: "",
    source_label: "Synthetic",
    measurements: [],
    valve_findings: [],
    quality_checks: [],
  };
  const formal = {
    ...base,
    study_id: "formal",
    study_type: "COMPLETE_TTE",
    formality: "FORMAL",
    performed_at: "2026-01-01T08:00:00.000Z",
    study_quality: "GOOD",
  } as EchoStudy;
  const bedside = {
    ...base,
    study_id: "bedside",
    study_type: "BEDSIDE_FOCUSED",
    formality: "BEDSIDE_LIMITED",
    performed_at: "2026-09-22T08:00:00.000Z",
    study_quality: "TECHNICALLY_LIMITED",
  } as EchoStudy;
  assert.equal(preferredEchoStudy([formal, bedside])?.study_id, "formal");
});

test("Stage 4 connects twelve Echo and valve cases while candidate guidance remains unpublished", async () => {
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
  let number = 0;
  async function person(label: string) {
    number += 1;
    const response = await call("/patients", {
      name: `Valve ${label}`,
      mrn: `SYN-VHD-${String(number).padStart(3, "0")}`,
      sex: number % 2 ? "Male" : "Female",
      birth_date: "1955-01-01",
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.id as string;
  }
  const parameter = (
    code: string,
    value: number,
    section = "AORTIC_VALVE",
    unit = code === "lvef" ? "%" : "",
  ) => ({
    section,
    parameter_code: code,
    label: code,
    value_number: value,
    value_text: null,
    unit,
    method: "Synthetic validated measurement",
    context: "",
    sequence: 0,
  });
  async function echo(
    patientId: string,
    options: {
      at?: string;
      type?: string;
      formality?: string;
      quality?: string;
      lvef?: number;
      measurements?: any[];
      valve?: string;
      lesion?: string;
      severity?: string;
      discordant?: boolean;
      mechanism?: string;
      comparison?: string | null;
      label?: string;
    } = {},
  ) {
    const measurements = [
      ...(options.lvef === undefined
        ? []
        : [parameter("lvef", options.lvef, "LV", "%")]),
      ...(options.measurements ?? []),
    ];
    const finding = options.valve
      ? [
          {
            valve_name: options.valve,
            lesion_type: options.lesion ?? "REGURGITATION",
            mechanism: options.mechanism ?? "",
            clinician_severity: options.severity ?? "INDETERMINATE",
            calculated_assessment: null,
            discordant: options.discordant ?? false,
            supporting_parameters: measurements.map(
              (item) => item.parameter_code,
            ),
            morphology: "",
            narrative: "Synthetic clinician-confirmed finding",
            override_reason: "",
          },
        ]
      : [];
    const at = options.at ?? "2026-09-22T08:00:00.000Z";
    const response = await call(`/patients/${patientId}/echo-studies`, {
      encounter_id: null,
      study_type: options.type ?? "COMPLETE_TTE",
      formality: options.formality ?? "FORMAL",
      performed_at: at,
      location: "Synthetic lab",
      comparison_study_id: options.comparison ?? null,
      status: "FINAL",
      indication: ["Known valve disease"],
      priority: "ROUTINE",
      study_quality: options.quality ?? "GOOD",
      quality_reasons: [],
      rhythm_context: "Sinus rhythm",
      heart_rate: 70,
      blood_pressure: "120/70",
      contrast_used: false,
      structured_findings: {},
      interpretation: "Synthetic test fixture",
      comparison_summary: options.comparison
        ? "Compared with prior structured study"
        : "",
      conclusion: "Clinician-confirmed synthetic conclusion",
      clinician_override_reason: "",
      reporting_cardiologist: "synthetic@test",
      amendment_reason: "",
      source_label: options.label ?? `Synthetic TTE ${at.slice(0, 10)}`,
      measurements,
      valve_findings: finding,
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
  }
  async function surveillance(
    patientId: string,
    studyId: string,
    echoDate: string,
  ) {
    const response = await call(`/patients/${patientId}/valve/surveillance`, {
      encounter_id: null,
      valve_name: "AORTIC",
      lesion_type: "STENOSIS",
      source_study_id: studyId,
      echo_date: echoDate,
      clinical_review_date: echoDate,
      acceptable_start: null,
      acceptable_end: null,
      early_review_triggers: ["New symptoms"],
      rationale: "Clinician-confirmed synthetic interval",
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
  }
  async function pathway(
    patientId: string,
    studyId: string | null,
    pathwayType: string,
    known: string[],
    missing: string[],
  ) {
    const response = await call(`/patients/${patientId}/valve/pathways`, {
      encounter_id: null,
      pathway_type: pathwayType,
      source_study_id: studyId,
      state: missing.length
        ? "Cannot determine because essential information is missing"
        : "Potential indication for clinician review",
      known_data: known,
      missing_data: missing,
      why_it_matters:
        "Valve intervention requires imaging and clinical context",
      next_decision: "Clinician and Heart Team review",
      strategy_factors: [],
      evidence_note: "2025 ESC/EACTS candidate pathway",
      observed_at: "2026-09-22T09:00:00.000Z",
    });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
  }
  try {
    await call("/demo-session", { role: "clinician" });

    // 1 Progressive AS supersedes surveillance and activates review.
    const progressive = await person("Progressive AS"),
      moderate = await echo(progressive, {
        at: "2026-01-01T08:00:00.000Z",
        valve: "AORTIC",
        lesion: "STENOSIS",
        severity: "MODERATE",
        measurements: [parameter("av_vmax", 3.3)],
      });
    await surveillance(progressive, moderate.study_id, "2027-01-01");
    const severe = await echo(progressive, {
      at: "2026-09-22T08:00:00.000Z",
      valve: "AORTIC",
      lesion: "STENOSIS",
      severity: "SEVERE",
      measurements: [parameter("av_vmax", 4.4)],
      comparison: moderate.study_id,
    });
    await pathway(
      progressive,
      severe.study_id,
      "SEVERE_AS",
      ["Severe AS", "New exertional symptoms"],
      [],
    );
    let state = (await call(`/patients/${progressive}/echo-valve`)).data;
    assert.equal(state.valveStates[0].severity, "SEVERE");
    assert.equal(state.surveillance[0].current_status, "SUPERSEDED");
    assert.ok(
      state.tasks.some((item: any) =>
        /AORTIC STENOSIS assessment/.test(item.purpose),
      ),
    );

    // 2 Discordant AS stays explicitly unresolved.
    const discordant = await person("Discordant AS"),
      discordantEcho = await echo(discordant, {
        valve: "AORTIC",
        lesion: "STENOSIS",
        severity: "DISCORDANT_REQUIRES_CONFIRMATION",
        discordant: true,
        measurements: [
          parameter("ava", 0.8),
          parameter("av_mean_gradient", 28),
        ],
      });
    state = (await call(`/patients/${discordant}/echo-valve`)).data;
    assert.equal(
      state.valveStates[0].severity,
      "DISCORDANT_REQUIRES_CONFIRMATION",
    );
    assert.ok(
      discordantEcho.quality_checks.some((item: any) =>
        item.code.startsWith("discordant_"),
      ),
    );

    // 3 Severe AS + low EF uses the same Echo in HF and valve state.
    const lowEf = await person("AS low EF"),
      lowEfEcho = await echo(lowEf, {
        valve: "AORTIC",
        lesion: "STENOSIS",
        severity: "SEVERE",
        lvef: 28,
        measurements: [parameter("av_mean_gradient", 34)],
      });
    const hfState = (await call(`/patients/${lowEf}/heart-failure`)).data;
    assert.equal(hfState.profile, null);
    assert.equal(
      (
        await call(`/patients/${lowEf}/clinical-state`)
      ).data.state.concepts.find(
        (item: any) => item.concept_code === "echo.lvef",
      ).current.source_id,
      lowEfEcho.study_id,
    );

    // 4 Primary MR progression creates a current severe state.
    const primaryMr = await person("Primary MR"),
      mrPrior = await echo(primaryMr, {
        at: "2025-09-22T08:00:00.000Z",
        valve: "MITRAL",
        severity: "MODERATE",
        mechanism: "Primary",
      });
    await echo(primaryMr, {
      valve: "MITRAL",
      severity: "SEVERE",
      mechanism: "Primary",
      comparison: mrPrior.study_id,
      measurements: [
        parameter("mr_regurgitant_volume", 66, "MITRAL_VALVE", "mL"),
      ],
    });
    assert.equal(
      (await call(`/patients/${primaryMr}/echo-valve`)).data.valveStates[0]
        .severity,
      "SEVERE",
    );

    // 5 Secondary MR pathway reuses the Stage 3 HF record.
    const secondary = await person("Secondary MR"),
      hfEcho = await call(`/patients/${secondary}/heart-failure/echoes`, {
        encounter_id: null,
        study_type: "FORMAL_TTE",
        study_quality: "GOOD",
        observed_at: "2026-09-20T08:00:00.000Z",
        lvef: 30,
        rv_function: "NORMAL",
        valve_summary: [],
        pulmonary_pressure_context: "",
        diastolic_context: "",
        pericardial_context: "",
        structural_context: "HFrEF",
        source_label: "HF TTE",
        verification_status: "verified",
      });
    assert.equal(hfEcho.status, 201, JSON.stringify(hfEcho.data));
    const secondaryEcho = await echo(secondary, {
      at: "2026-09-22T08:00:00.000Z",
      valve: "MITRAL",
      severity: "SEVERE",
      mechanism: "Secondary",
      lvef: 30,
    });
    const secondaryPath = await pathway(
      secondary,
      secondaryEcho.study_id,
      "SECONDARY_MR",
      ["Shared LVEF 30%", "HF therapy record reused"],
      ["Confirm optimized GDMT/CRT context"],
    );
    assert.match(secondaryPath.known_data.join(" "), /Shared LVEF/);

    // 6 Severe TR with RV dysfunction remains an integrated clinician assessment.
    const tr = await person("TR"),
      trEcho = await echo(tr, {
        valve: "TRICUSPID",
        severity: "SEVERE",
        mechanism: "Functional",
        measurements: [parameter("tapse", 12, "RV", "mm")],
      });
    const trPath = await pathway(
      tr,
      trEcho.study_id,
      "TRICUSPID_REGURGITATION",
      ["Severe TR", "Reduced RV function", "Right-HF symptoms"],
      [],
    );
    assert.equal(trPath.known_data.length, 3);

    // 7 Improvement supersedes the prior imaging review task and current state.
    const improved = await person("Improvement"),
      oldSevere = await echo(improved, {
        at: "2026-01-01T08:00:00.000Z",
        valve: "MITRAL",
        severity: "SEVERE",
      });
    await echo(improved, {
      valve: "MITRAL",
      severity: "MILD",
      comparison: oldSevere.study_id,
    });
    state = (await call(`/patients/${improved}/echo-valve`)).data;
    assert.equal(state.valveStates[0].severity, "MILD");
    assert.ok(
      state.tasks
        .filter((item: any) => item.source_type === "echo_valve_review")
        .every((item: any) => item.current_status === "superseded"),
    );

    // 8 A new poor bedside study does not replace a high-quality formal source.
    const quality = await person("Quality"),
      formal = await echo(quality, {
        at: "2026-09-01T08:00:00.000Z",
        quality: "GOOD",
        formality: "FORMAL",
        type: "COMPLETE_TTE",
        lvef: 45,
      });
    await echo(quality, {
      at: "2026-09-22T08:00:00.000Z",
      quality: "VERY_LIMITED",
      formality: "BEDSIDE_LIMITED",
      type: "BEDSIDE_FOCUSED",
      lvef: 20,
    });
    state = (await call(`/patients/${quality}/echo-valve`)).data;
    assert.equal(state.preferredStudy.study_id, formal.study_id);
    assert.equal(
      state.currentValues.find((item: any) => item.concept_code === "echo.lvef")
        .current.source_id,
      formal.study_id,
    );

    // 9 Prosthetic baseline and changed gradient produce a review pathway, not a thrombosis diagnosis.
    const prosthetic = await person("Prosthetic"),
      baseline = await echo(prosthetic, {
        at: "2025-10-01T08:00:00.000Z",
        valve: "AORTIC",
        lesion: "PROSTHETIC",
        severity: "POST_INTERVENTION",
        measurements: [
          parameter("prosthetic_mean_gradient", 12, "PROSTHESIS", "mmHg"),
        ],
      });
    const prosthesis = await call(`/patients/${prosthetic}/valve/prostheses`, {
      position: "AORTIC",
      prosthesis_type: "TRANSCATHETER",
      manufacturer: "Synthetic",
      model: "S1",
      size_label: "26",
      implanted_on: "2025-09-30",
      implantation_route: "TRANSCATHETER",
      baseline_echo_id: baseline.study_id,
      antithrombotic_context: "Clinician reviewed",
    });
    assert.equal(prosthesis.status, 201, JSON.stringify(prosthesis.data));
    const changed = await echo(prosthetic, {
      valve: "AORTIC",
      lesion: "PROSTHETIC",
      severity: "INDETERMINATE",
      measurements: [
        parameter("prosthetic_mean_gradient", 25, "PROSTHESIS", "mmHg"),
      ],
      comparison: baseline.study_id,
    });
    const prostheticPath = await pathway(
      prosthetic,
      changed.study_id,
      "PROSTHETIC_REVIEW",
      ["Gradient differs from known baseline"],
      ["Mechanism", "Multimodality imaging if clinically indicated"],
    );
    assert.doesNotMatch(prostheticPath.state, /thrombosis/i);
    state = (await call(`/patients/${prosthetic}/echo-valve`)).data;
    assert.equal(state.prostheticComparisons.length, 1);
    assert.ok(state.prostheticComparisons[0].changes.length >= 1);

    // 10 Post-TAVI procedure, prosthesis and Echo share one timeline source.
    const postTavi = await person("Post TAVI"),
      taviProsthesis = await call(`/patients/${postTavi}/valve/prostheses`, {
        position: "AORTIC",
        prosthesis_type: "TRANSCATHETER",
        manufacturer: "Synthetic",
        model: "T1",
        size_label: "26",
        implanted_on: "2026-09-01",
        implantation_route: "TRANSCATHETER",
        baseline_echo_id: null,
        antithrombotic_context: "Reviewed",
      });
    const procedure = await call(`/patients/${postTavi}/valve/procedures`, {
      encounter_id: null,
      procedure_type: "TAVI",
      procedure_date: "2026-09-01",
      indication: "Clinician-confirmed severe AS",
      prosthesis_id: taviProsthesis.data.id,
      operator_team: "Heart Team",
      complications: [],
      result: "Successful implantation",
      conduction_context: "No new conduction abnormality",
      follow_up_plan: { echo: "Structured follow-up" },
    });
    assert.equal(procedure.status, 201, JSON.stringify(procedure.data));
    await echo(postTavi, {
      at: "2026-09-02T08:00:00.000Z",
      valve: "AORTIC",
      lesion: "PROSTHETIC",
      severity: "POST_INTERVENTION",
    });
    state = (await call(`/patients/${postTavi}/echo-valve`)).data;
    assert.equal(state.procedures[0].procedure_type, "TAVI");
    assert.equal(state.studies.length, 1);

    // 11 Multiple valve disease has one combined pathway.
    const multiple = await person("Multiple"),
      multiEcho = await echo(multiple, {
        valve: "MULTIPLE",
        lesion: "MIXED",
        severity: "SEVERE",
        measurements: [
          parameter("av_vmax", 4.3),
          parameter("mr_regurgitant_volume", 55, "MITRAL_VALVE", "mL"),
        ],
      });
    const multiPath = await pathway(
      multiple,
      multiEcho.study_id,
      "MULTIPLE_VALVE_DISEASE",
      ["Severe AS", "Moderate/severe MR", "Hemodynamic interaction"],
      ["Dominant lesion confirmation"],
    );
    assert.equal(multiPath.pathway_type, "MULTIPLE_VALVE_DISEASE");

    // 12 Missing symptom status is not interpreted as asymptomatic.
    const asymptomatic = await person("Symptoms unknown"),
      asymEcho = await echo(asymptomatic, {
        valve: "AORTIC",
        lesion: "STENOSIS",
        severity: "SEVERE",
        measurements: [parameter("av_vmax", 4.2)],
      });
    const asymPath = await pathway(
      asymptomatic,
      asymEcho.study_id,
      "SEVERE_AS",
      ["Severe lesion"],
      ["Structured symptom status", "Lesion-specific risk markers"],
    );
    assert.match(asymPath.missing_data.join(" "), /symptom/i);

    const echoPack = await call("/echo-valve/review-pack?domain=echo"),
      valvePack = await call("/echo-valve/review-pack?domain=valve");
    assert.equal(echoPack.data.length, 10);
    assert.equal(valvePack.data.length, 13);
    assert.ok(
      [...echoPack.data, ...valvePack.data].every(
        (item: any) => item.lifecycle_state === "CLINICAL_REVIEW",
      ),
    );
    const executedCandidates = await db.query(
      "SELECT id FROM decision_support.recommendation WHERE patient_id=$1 AND (rule_key LIKE 'echo.%' OR rule_key LIKE 'valve.%')",
      [progressive],
    );
    assert.equal(executedCandidates.rows.length, 0);

    await assert.rejects(
      db.query("UPDATE imaging.echo_study SET location='changed' WHERE id=$1", [
        severe.study_id,
      ]),
      /Append-only/,
    );
    const report = await call(`/echo-studies/${severe.study_id}/report-draft`);
    assert.equal(report.data.requiresApproval, true);
    assert.match(
      report.data.draft,
      /requires cardiologist editing and final approval/i,
    );
    const history = await call(`/echo-studies/${severe.study_id}/history`);
    assert.equal(history.data.revisions.length, 1);
    const crossPatientBaseline = await call(
      `/patients/${progressive}/valve/prostheses`,
      {
        position: "AORTIC",
        prosthesis_type: "UNKNOWN",
        manufacturer: "",
        model: "",
        size_label: "",
        implanted_on: null,
        implantation_route: "UNKNOWN",
        baseline_echo_id: discordantEcho.study_id,
        antithrombotic_context: "",
      },
    );
    assert.equal(crossPatientBaseline.status, 422);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await db.close();
  }
});
