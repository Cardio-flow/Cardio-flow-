# Stage 3 — Intelligent Heart Failure module

## Delivery status

Stage 3 provides the connected heart-failure data model, longitudinal workflows, patient workspace, clinical review pack, and non-executable candidate rules. No disease-specific treatment, monitoring, device, or diagnostic recommendation is active. Those rules remain in `CLINICAL_REVIEW` until the evidence can be used in software under an appropriate licence and an independent clinical checker approves the exact logic and test evidence.

The module therefore supports structured longitudinal HF documentation and clinician-selected plans. It does not yet provide production clinical decision recommendations.

## Architecture

The implementation adds the `heart_failure` schema and mounts its API within the existing unified patient workspace. It deliberately reuses:

- `clinical.fact`, the current-value resolver, preferences, provenance, and event-driven recalculation;
- the Stage 2 medication catalogue, medication history, safety context, laboratory results, trends, monitoring, and titration state;
- `workflow.clinical_task` for dated imaging, laboratory, clinic, device, and follow-up work;
- care encounters and continuing care entries;
- evidence sources, rule versions, lifecycle events, maker-checker controls, recommendation history, and audit events.

It does not add parallel HF medication, laboratory, task, encounter, alert, or recommendation stores.

## Migration 007

`server/heart-failure-schema.sql` creates append-only tables for:

- one HF profile per patient;
- versioned structured HF reviews;
- source-linked cardiac imaging observations;
- complication and diagnostic pathway assessments;
- ICD and CRT assessment snapshots;
- discharge reviews with exact follow-up dates;
- cardiac rehabilitation assessments;
- current-review and current-rehabilitation views.

All clinical rows retain author, observation time, encounter context, and immutable history. Database triggers reject updates and deletes. Migration checksum protection prevents a deployed migration from being edited in place.

## HF data model and current state

The review captures clinical status, presentation, symptom change, NYHA class, contributing aetiologies, optional physical findings, clinician-assessed congestion, clinician-confirmed phenotype, imaging source, treatment decisions, and narrative. New reviews create later versions; previous versions remain accessible.

The state service combines the HF record with current medications, laboratory results, tasks, care entries, encounters, and clinical facts. It exposes what is known, what is missing, why the missing information matters, and the next clinician assessment. Gaps are limited to higher-value items: core review, cardiac imaging, functional class, renal function, potassium, UACR, iron status, and rehabilitation review.

## 2026 phenotype implementation

The official 2026 ESC HF materials were verified on 22 September 2026 and recorded as evidence metadata. The module supports the current two-phenotype vocabulary, `HFrEF` and `HFpEF`, plus `UNCLASSIFIED` while assessment is incomplete. It does not encode the numerical boundary as an executable rule because the publisher requires formal permission for incorporation or transformation in software.

Phenotype is clinician confirmed against a selected imaging source. A new or newly preferred Echo does not silently overwrite the prior phenotype. It changes the state to `REASSESSMENT_REQUIRED`, preserves the historical phenotype, and creates an open shared task. The current-value resolver ranks verification, source quality, date, and explicit clinician preference, so a low-quality recent result does not automatically displace a preferred formal study.

## Diagnosis and pathways

The diagnostic view is data driven. It presents known evidence, missing evidence, the reason for review, and the suggested next assessment. Reusable structured pathway records cover:

- diagnostic assessment;
- congestion and diuretic response;
- decompensated HF;
- worsening renal function;
- hyperkalaemia;
- hypotension;
- bradycardia;
- hyponatraemia;
- iron deficiency or anaemia;
- advanced HF recognition.

These records capture severity, patient data, missing information, considerations, medication implications, monitoring plan, escalation, and evidence note. They structure clinician judgment and do not generate autonomous orders.

## Treatment, titration, cardiorenal, and iron review

The dashboard reads the active Stage 2 medication and laboratory state. It shows current structured therapy and current high-value renal, potassium, and natriuretic-peptide results. The shared medication/titration engine continues to own dose history, adverse reactions, treatment limitations, monitoring prerequisites, and exact dated tasks.

UACR, renal function, potassium, ferritin, and transferrin saturation feed focused documentation gaps. Renal deterioration is represented alongside congestion, blood pressure, current therapy, illness, and clinician assessment. The data model does not equate one creatinine rise with stopping therapy and never changes medication automatically.

Clinical treatment prioritization, thresholds, dose advice, monitoring intervals, and class/level display remain blocked candidate rules.

## Device, discharge, follow-up, and rehabilitation

ICD and CRT assessment snapshots retain the data used, missing information, clinician rationale, status, and an optional exact reassessment date. A date creates a shared worklist task.

The HF discharge review records stability, congestion review, reconciliation, renal/electrolyte review, titration planning, education, rehabilitation, outstanding items, and clinician-selected exact dates for laboratory review, HF clinic, repeat imaging, and device reassessment. Compatible dates flow into the existing shared task/worklist system.

Rehabilitation captures eligibility/referral status, limitation, referral date, planned start, exercise context, and history. Full rehabilitation programme management is outside Stage 3.

## Patient experience

Heart Failure remains inside the four-tab unified patient workspace:

- **Summary:** ten-second phenotype, status, preferred LVEF, NYHA/congestion, high-value evidence, active therapy, attention items, and next dated actions;
- **Clinical Record:** time-aware HF reviews, imaging, and pathway assessments with author and date;
- **Timeline:** automatically composed HF reviews, Echoes, pathways, device reviews, discharge reviews, and rehabilitation events;
- **Add/update actions:** review, cardiac imaging, clinical issue, discharge plan, device review, rehabilitation, and editable note draft.

The generated HF clinic note is explicitly marked as a draft requiring clinician review. It is never auto-finalized.

## Evidence baseline and licence boundary

Evidence metadata is stored for:

- 2026 ESC Guidelines for the management of heart failure, version `2026`;
- 2026 ESC Guidelines for cardiovascular disease and chronic kidney disease, `2026-ehag098`;
- 2026 ESC Guidelines on cardiac rehabilitation, `2026-ehag099`;
- Second Universal Definition of Heart Failure, `2026-ehag500`.

The ESC publisher page states that guideline content incorporated or transformed in software/algorithms requires formal permission. CardioFlow stores citation and catalogue metadata, not copied guideline text. Exact triggers, thresholds, exclusions, intervals, medication logic, recommendation class, and evidence level must be extracted through the authorized clinical review process.

## Validation

Automated tests cover eight connected HF scenarios:

1. newly diagnosed HFrEF with linked formal Echo and confirmed phenotype;
2. symptomatic low blood pressure pathway;
3. hyperkalaemia pathway;
4. worsening renal function while congested without automatic therapy withdrawal;
5. improved EF with retained HFrEF history and mandatory reassessment;
6. clinician-confirmed HFpEF without an HFrEF rule firing;
7. post-discharge exact dates, shared tasks, and rehabilitation referral;
8. possible advanced HF with documented high-severity assessment.

Tests also assert that all 15 candidate rules remain in `CLINICAL_REVIEW`, no HF rule is published, no HF recommendation is generated, and append-only records reject mutation. The complete legacy test suite verifies that existing registry, continuous care, authentication, governance, medication, laboratory, and export behavior remains intact.

## Known limitations and deferred work

- Candidate clinical rules cannot affect patients until licensing, exact evidence extraction, test completion, and independent maker-checker approval.
- Imaging capture is a focused HF connector. Full Echo measurements, valve workflows, image ingestion, and report management belong to Stage 4.
- Full device clinic management belongs to Stage 7.
- Full cardiometabolic/GLP-1 logic belongs to Stage 8.
- No transplant or LVAD workflow is included; advanced HF support is a recognition and referral framework.
- Patient education is held as meaningful clinician narrative rather than mandatory checkbox completion.
- Guideline-derived intervals are not proposed automatically while their rules are unpublished. Clinicians can set exact dates, and the shared task engine tracks them.

## Readiness statement

The connected HF record and workflow architecture is suitable for real longitudinal documentation and clinician-authored care plans. The disease-specific decision support is not yet mature for production clinical influence. It becomes eligible for that use only after every relevant candidate rule has licensed evidence extraction, passing representative tests, and independent clinical approval and publication.
