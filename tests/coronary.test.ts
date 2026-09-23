import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../server/app.js";
import { createDb } from "../server/db.js";

test("Stage 5A–D connects ECG, ACS, angiography and PCI in one patient record", async () => {
  const db = await createDb(undefined, false);
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let cookie = "",
    csrf = "";
  async function call(path: string, body?: unknown) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
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
    assert.equal(
      (await call("/demo-session", { role: "clinician" })).status,
      200,
    );
    const person = await call("/patients", {
      name: "Synthetic Coronary",
      mrn: "SYN-CAD-501",
      sex: "Male",
      birth_date: "1968-01-01",
    });
    assert.equal(person.status, 201, JSON.stringify(person.data));
    const patientId = person.data.id;
    let state = await call(`/patients/${patientId}/coronary`);
    assert.equal(state.status, 200, JSON.stringify(state.data));
    assert.equal(state.data.currentState, null);
    const suspected = await call(`/patients/${patientId}/coronary/state`, {
      state: "SUSPECTED_CAD",
      status: "CURRENT",
      observed_at: "2026-09-22T08:00:00.000Z",
      detail: "Synthetic initial working state",
    });
    assert.equal(suspected.status, 201, JSON.stringify(suspected.data));
    const ecg = await call(`/patients/${patientId}/coronary/ecg`, {
      performed_at: "2026-09-22T08:10:00.000Z",
      rhythm: "Sinus rhythm",
      rate: 82,
      ischemic_interpretation: "ST_ELEVATION",
      st_changes: "Anterior leads",
      clinician_interpretation: "Clinician-confirmed anterior ST elevation",
      source_label: "12-lead ECG",
      status: "FINAL",
    });
    assert.equal(ecg.status, 201, JSON.stringify(ecg.data));
    const acs = await call(`/patients/${patientId}/coronary/acs`, {
      presented_at: "2026-09-22T08:15:00.000Z",
      diagnosis: "STEMI",
      diagnosis_status: "CONFIRMED",
      symptom_onset_at: "2026-09-22T07:20:00.000Z",
      first_ecg_at: "2026-09-22T08:10:00.000Z",
      symptoms: { chest_discomfort: true, pressure: true },
      clinical_interpretation: "Synthetic anterior STEMI",
      status: "ACTIVE",
    });
    assert.equal(acs.status, 201, JSON.stringify(acs.data));
    const angio = await call(`/patients/${patientId}/coronary/angiograms`, {
      acs_event_id: acs.data.id,
      performed_at: "2026-09-22T09:00:00.000Z",
      indication: "Anterior STEMI",
      access_site: "Right radial",
      contrast_ml: 90,
      conclusion: "LAD culprit",
      status: "FINAL",
      lesions: [
        {
          vessel: "LAD",
          segment: "Proximal",
          stenosis_percent: 95,
          culprit_status: "CONFIRMED",
          timi_flow: 1,
        },
      ],
    });
    assert.equal(angio.status, 201, JSON.stringify(angio.data));
    state = await call(`/patients/${patientId}/coronary`);
    assert.equal(state.status, 200, JSON.stringify(state.data));
    const lesion = state.data.angiograms[0].lesions[0];
    const pci = await call(`/patients/${patientId}/coronary/pcis`, {
      acs_event_id: acs.data.id,
      angiogram_id: angio.data.id,
      target_lesion_id: lesion.id,
      performed_at: "2026-09-22T09:22:00.000Z",
      indication: "Primary PCI",
      target_vessel: "LAD",
      urgency: "EMERGENCY",
      final_timi_flow: 3,
      result: "Successful PCI",
      revascularization_status: "STAGED",
      staged_plan: "Review RCA disease",
      status: "FINAL",
      stents: [
        {
          vessel: "LAD",
          lesion_id: lesion.id,
          stent_type: "DES",
          diameter_mm: 3,
          length_mm: 24,
        },
      ],
    });
    assert.equal(pci.status, 201, JSON.stringify(pci.data));
    state = await call(`/patients/${patientId}/coronary`);
    assert.equal(state.status, 200, JSON.stringify(state.data));
    assert.equal(state.data.currentState.state, "CURRENT_ACS");
    assert.equal(
      state.data.states.filter(
        (item: any) =>
          item.status === "CURRENT" &&
          !state.data.states.some(
            (newer: any) => newer.supersedes_id === item.id,
          ),
      ).length,
      1,
    );
    assert.equal(state.data.ecgs.length, 1);
    assert.equal(state.data.acsEvents[0].diagnosis, "STEMI");
    assert.equal(state.data.angiograms[0].lesions[0].vessel, "LAD");
    assert.equal(Number(state.data.pcis[0].stents[0].length_mm), 24);
    assert.equal(state.data.registryProjection.management.value, "PCI");
    assert.ok(
      state.data.tasks.some(
        (t: any) => t.source_type === "coronary_staged_pci",
      ),
    );
    const report = await call(`/patients/${patientId}/coronary/report/pci`);
    assert.equal(report.status, 200);
    assert.match(report.data.text, /LAD/);
    const troponin = await call(`/patients/${patientId}/laboratory`, {
      test_id: "hs-troponin-i",
      value: 320,
      unit: "ng/L",
      specimen: "Plasma",
      collected_at: "2026-09-22T08:20:00.000Z",
      resulted_at: "2026-09-22T08:35:00.000Z",
      source_type: "laboratory",
      source_id: "synthetic-troponin-1",
      source_label: "Synthetic assay result",
      laboratory_name: "Synthetic lab",
      reference_high: 20,
      verification_status: "verified",
      provenance: { assay: "Synthetic hs-cTnI assay" },
    });
    assert.equal(troponin.status, 201, JSON.stringify(troponin.data));
    state = await call(`/patients/${patientId}/coronary`);
    assert.equal(state.data.troponins.length, 1);
    assert.equal(state.data.troponins[0].test_id, "hs-troponin-i");
    const aspirin = await call(`/patients/${patientId}/medications`, {
      medication_id: "aspirin",
      event: {
        status: "ACTIVE",
        event_type: "started",
        effective_at: "2026-09-22T09:30:00.000Z",
        prescribing_clinician: "Synthetic clinician",
      },
    });
    assert.equal(aspirin.status, 201, JSON.stringify(aspirin.data));
    const p2y12 = await call(`/patients/${patientId}/medications`, {
      medication_id: "ticagrelor",
      event: {
        status: "ACTIVE",
        event_type: "started",
        effective_at: "2026-09-22T09:30:00.000Z",
        prescribing_clinician: "Synthetic clinician",
      },
    });
    assert.equal(p2y12.status, 201, JSON.stringify(p2y12.data));
    state = await call(`/patients/${patientId}/coronary`);
    const therapies = state.data.medications;
    const dapt = await call(`/patients/${patientId}/coronary/plans`, {
      category: "ANTITHROMBOTIC",
      plan_key: "post-ACS-PCI",
      observed_at: "2026-09-22T12:00:00.000Z",
      status: "ACTIVE",
      review_date: "2026-10-22",
      data: {
        purpose: "Post-PCI combination review",
        aspirin_therapy_id: therapies.find(
          (m: any) => m.medication_id === "aspirin",
        ).id,
        p2y12_therapy_id: therapies.find(
          (m: any) => m.medication_id === "ticagrelor",
        ).id,
        duration_strategy: "Clinician review at dated follow-up",
      },
    });
    assert.equal(dapt.status, 201, JSON.stringify(dapt.data));
    const bleed = await call(`/patients/${patientId}/coronary/plans`, {
      category: "COMPLICATION",
      plan_key: "GI-bleeding",
      observed_at: "2026-09-25T11:00:00.000Z",
      status: "ACTIVE",
      data: {
        complication_type: "MAJOR_BLEEDING",
        severity: "HIGH",
        assessment: "Synthetic GI bleed",
      },
    });
    assert.equal(bleed.status, 201, JSON.stringify(bleed.data));
    state = await call(`/patients/${patientId}/coronary`);
    assert.equal(
      state.data.currentPlans.some((p: any) => p.id === dapt.data.id),
      false,
    );
    assert.ok(
      state.data.plans.some(
        (p: any) =>
          p.supersedes_id === dapt.data.id && p.status === "UNCERTAIN",
      ),
    );
    assert.ok(
      state.data.currentPlans.some((p: any) => p.status === "UNCERTAIN"),
    );
    assert.ok(
      state.data.tasks.some(
        (t: any) => t.source_type === "coronary_antithrombotic_reassessment",
      ),
    );
    assert.equal(
      state.data.medications.find((m: any) => m.medication_id === "aspirin")
        .status,
      "ACTIVE",
    );
    const ccsPerson = await call("/patients", {
      name: "Synthetic ANOCA",
      mrn: "SYN-CAD-502",
      sex: "Female",
      birth_date: "1969-01-01",
    });
    assert.equal(ccsPerson.status, 201);
    const ccsId = ccsPerson.data.id;
    const ccs = await call(`/patients/${ccsId}/coronary/state`, {
      state: "ANOCA",
      status: "CURRENT",
      observed_at: "2026-09-23T10:00:00.000Z",
      detail: "Persistent angina with non-obstructive CCTA",
    });
    assert.equal(ccs.status, 201);
    const ccsPlan = await call(`/patients/${ccsId}/coronary/plans`, {
      category: "ANOCA_INOCA",
      plan_key: "mechanism-review",
      observed_at: "2026-09-23T10:00:00.000Z",
      status: "ACTIVE",
      review_date: "2026-10-02",
      data: {
        purpose: "Review microvascular or vasospastic mechanism",
        mechanism: "Uncertain",
      },
    });
    assert.equal(ccsPlan.status, 201, JSON.stringify(ccsPlan.data));
    const ccsRecord = await call(`/patients/${ccsId}/coronary`);
    assert.equal(ccsRecord.data.currentState.state, "ANOCA");
    assert.equal(ccsRecord.data.currentPlans[0].category, "ANOCA_INOCA");
    const stolen = await call(`/patients/${ccsId}/coronary/pcis`, {
      acs_event_id: acs.data.id,
      performed_at: "2026-09-23T10:00:00.000Z",
      indication: "Should reject",
      target_vessel: "LAD",
      status: "FINAL",
    });
    assert.equal(stolen.status, 400);

    // Case 2 — NSTEMI + CKD: renal context stays explicit and does not create an autonomous strategy.
    const nstemiPerson = await call("/patients", {
      name: "Synthetic NSTEMI CKD",
      mrn: "SYN-CAD-503",
      sex: "Male",
      birth_date: "1948-01-01",
    });
    const nstemi = await call(
      `/patients/${nstemiPerson.data.id}/coronary/acs`,
      {
        presented_at: "2026-09-23T11:00:00.000Z",
        diagnosis: "NSTEMI",
        diagnosis_status: "CONFIRMED",
        symptoms: { chest_discomfort: true },
        hemodynamics: { stable: true },
        risk_context: {
          renal: "Known CKD; renal function requires clinician review",
          score_missing: ["Complete validated risk score inputs"],
        },
        clinical_interpretation: "Synthetic NSTEMI with CKD",
        status: "ACTIVE",
      },
    );
    assert.equal(nstemi.status, 201, JSON.stringify(nstemi.data));
    const nstemiRecord = await call(
      `/patients/${nstemiPerson.data.id}/coronary`,
    );
    assert.match(nstemiRecord.data.acsEvents[0].risk_context.renal, /CKD/);
    assert.equal(nstemiRecord.data.currentPlans.length, 0);

    // Case 3 — ACS + AF/OAC: one linked combination plan references the shared medication records.
    const afPerson = await call("/patients", {
      name: "Synthetic ACS AF",
      mrn: "SYN-CAD-504",
      sex: "Female",
      birth_date: "1952-01-01",
    });
    const afId = afPerson.data.id;
    await call(`/patients/${afId}/coronary/acs`, {
      presented_at: "2026-09-23T12:00:00.000Z",
      diagnosis: "NSTE_ACS",
      diagnosis_status: "WORKING",
      symptoms: { chest_discomfort: true },
      clinical_interpretation: "ACS under assessment with established AF",
      status: "ACTIVE",
    });
    for (const medication_id of ["aspirin", "clopidogrel", "apixaban"])
      assert.equal(
        (
          await call(`/patients/${afId}/medications`, {
            medication_id,
            event: {
              status: "ACTIVE",
              event_type: "started",
              effective_at: "2026-09-23T12:30:00.000Z",
              prescribing_clinician: "Synthetic clinician",
            },
          })
        ).status,
        201,
      );
    const afTherapies = (await call(`/patients/${afId}/coronary`)).data
      .medications;
    const combined = await call(`/patients/${afId}/coronary/plans`, {
      category: "ANTITHROMBOTIC",
      plan_key: "acs-af-combination",
      observed_at: "2026-09-23T13:00:00.000Z",
      status: "ACTIVE",
      review_date: "2026-09-30",
      data: {
        purpose: "Combined therapy review",
        aspirin_therapy_id: afTherapies.find(
          (m: any) => m.medication_id === "aspirin",
        ).id,
        p2y12_therapy_id: afTherapies.find(
          (m: any) => m.medication_id === "clopidogrel",
        ).id,
        anticoagulant_therapy_id: afTherapies.find(
          (m: any) => m.medication_id === "apixaban",
        ).id,
        combination_start: "2026-09-23",
        combination_end: "2026-09-30",
        duration_strategy: "Clinician-authored and dated review",
      },
    });
    assert.equal(combined.status, 201, JSON.stringify(combined.data));

    // Case 6 — CCS: diagnostic and management uncertainty is retained as an explicit pathway.
    const stablePerson = await call("/patients", {
      name: "Synthetic CCS",
      mrn: "SYN-CAD-505",
      sex: "Male",
      birth_date: "1962-01-01",
    });
    await call(`/patients/${stablePerson.data.id}/coronary/state`, {
      state: "CCS",
      status: "CURRENT",
      observed_at: "2026-09-23T14:00:00.000Z",
      detail: "Exertional symptoms under structured assessment",
    });
    const stablePlan = await call(
      `/patients/${stablePerson.data.id}/coronary/plans`,
      {
        category: "CCS",
        plan_key: "diagnostic-review",
        observed_at: "2026-09-23T14:05:00.000Z",
        status: "ACTIVE",
        review_date: "2026-10-05",
        data: {
          known: ["Exertional symptoms"],
          missing: [
            "Current validated likelihood assessment",
            "Appropriate test selection",
          ],
          options: [
            "Review prior testing",
            "Select an appropriate current diagnostic test",
          ],
          next_assessment: "Clinician review",
        },
      },
    );
    assert.equal(stablePlan.status, 201, JSON.stringify(stablePlan.data));

    // Case 8 — post-ACS LDL: shared laboratory data feeds a dated prevention review without changing therapy.
    const lipidPerson = await call("/patients", {
      name: "Synthetic Post ACS Lipid",
      mrn: "SYN-CAD-506",
      sex: "Female",
      birth_date: "1959-01-01",
    });
    const lipidId = lipidPerson.data.id;
    await call(`/patients/${lipidId}/coronary/acs`, {
      presented_at: "2026-09-20T09:00:00.000Z",
      diagnosis: "NSTEMI",
      diagnosis_status: "CONFIRMED",
      clinical_interpretation: "Synthetic post-ACS prevention case",
      status: "DISCHARGED",
    });
    assert.equal(
      (
        await call(`/patients/${lipidId}/laboratory`, {
          test_id: "ldl-c",
          value: 2.8,
          unit: "mmol/L",
          collected_at: "2026-09-22T07:00:00.000Z",
          resulted_at: "2026-09-22T07:30:00.000Z",
          source_type: "laboratory",
          source_id: "synthetic-ldl-1",
          source_label: "Synthetic lipid profile",
          verification_status: "verified",
        })
      ).status,
      201,
    );
    const prevention = await call(`/patients/${lipidId}/coronary/plans`, {
      category: "PREVENTION",
      plan_key: "post-acs-lipid-review",
      observed_at: "2026-09-23T15:00:00.000Z",
      status: "ACTIVE",
      review_date: "2026-10-07",
      data: {
        purpose:
          "Review LDL-C result, adherence, tolerance and treatment options",
        assessment: "No treatment was changed automatically",
      },
    });
    assert.equal(prevention.status, 201, JSON.stringify(prevention.data));
    assert.equal(
      (await call(`/patients/${lipidId}/coronary`)).data.lipids[0].test_id,
      "ldl-c",
    );

    // Cases 9 and 10 — existing severe valve disease and HF are surfaced in the coronary review panel.
    const integrationPerson = await call("/patients", {
      name: "Synthetic ACS HF AS",
      mrn: "SYN-CAD-507",
      sex: "Male",
      birth_date: "1944-01-01",
    });
    const integrationId = integrationPerson.data.id;
    await db.query(
      "INSERT INTO valve.state_event(id,patient_id,valve_name,lesion_type,severity,mechanism,symptoms_context,ventricular_response,pulmonary_context,rhythm_context,quality,observed_at,author) VALUES($1,$2,'AORTIC','STENOSIS','SEVERE','Synthetic calcific morphology','UNKNOWN','{}','','','GOOD',$3,'synthetic:test')",
      [randomUUID(), integrationId, "2026-09-22T10:00:00.000Z"],
    );
    await db.query(
      "INSERT INTO heart_failure.profile(id,patient_id,created_by) VALUES($1,$2,'synthetic:test')",
      [randomUUID(), integrationId],
    );
    await call(`/patients/${integrationId}/coronary/acs`, {
      presented_at: "2026-09-23T16:00:00.000Z",
      diagnosis: "NSTEMI",
      diagnosis_status: "CONFIRMED",
      hemodynamics: { hf: true },
      clinical_interpretation:
        "Synthetic ACS with existing severe AS and HF record",
      status: "ACTIVE",
    });
    const integrated = await call(`/patients/${integrationId}/coronary`);
    assert.ok(
      integrated.data.reviewItems.some((item: string) =>
        /severe valve/i.test(item),
      ),
    );
    assert.ok(
      integrated.data.reviewItems.some((item: string) =>
        /existing HF/i.test(item),
      ),
    );

    // Case 11 — repeat angina after PCI creates review work and does not invent a diagnosis.
    const recurrent = await call(`/patients/${patientId}/coronary/plans`, {
      category: "COMPLICATION",
      plan_key: "repeat-angina",
      observed_at: "2026-09-26T08:00:00.000Z",
      status: "ACTIVE",
      data: {
        complication_type: "STENT_THROMBOSIS_CONCERN",
        severity: "UNCERTAIN",
        symptoms: "Recurrent chest discomfort after PCI",
        assessment: "Cause not established",
      },
    });
    assert.equal(recurrent.status, 201, JSON.stringify(recurrent.data));
    assert.equal(
      (await call(`/patients/${patientId}/coronary`)).data.acsEvents[0]
        .diagnosis,
      "STEMI",
    );

    // Case 12 — CABG history remains a current longitudinal state and is available to future modules.
    const cabgPerson = await call("/patients", {
      name: "Synthetic CABG",
      mrn: "SYN-CAD-508",
      sex: "Female",
      birth_date: "1950-01-01",
    });
    await call(`/patients/${cabgPerson.data.id}/coronary/state`, {
      state: "PREVIOUS_CABG",
      status: "CURRENT",
      observed_at: "2026-09-23T17:00:00.000Z",
      detail: "CABG history; graft anatomy requires review",
    });
    const cabgRecord = await call(`/patients/${cabgPerson.data.id}/coronary`);
    assert.equal(cabgRecord.data.currentState.state, "PREVIOUS_CABG");

    const projectedFacts = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM clinical.fact WHERE patient_id=$1 AND concept_code LIKE 'coronary.%'",
        [patientId],
      )
    ).rows[0];
    assert.ok(projectedFacts.n >= 5);
    const governance = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM decision_support.rule_definition WHERE key LIKE 'cad.%'",
      )
    ).rows[0];
    assert.equal(governance.n, 22);
    const unpublished = (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM decision_support.rule_definition WHERE key LIKE 'cad.%' AND status<>'draft'",
      )
    ).rows[0];
    assert.equal(unpublished.n, 0);
    const reviewEvents = (
      await db.query<{ n: number }>(
        "SELECT count(DISTINCT rule_key)::int n FROM decision_support.rule_lifecycle_event WHERE rule_key LIKE 'cad.%' AND state='CLINICAL_REVIEW'",
      )
    ).rows[0];
    assert.equal(reviewEvents.n, 22);
    const candidateContracts = (
      await db.query<any>(
        "SELECT definition FROM decision_support.rule_definition WHERE key LIKE 'cad.%'",
      )
    ).rows;
    assert.ok(
      candidateContracts.every(
        (row: any) =>
          row.definition.reviewContract.plannedBoundaryTests.length >= 3,
      ),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
