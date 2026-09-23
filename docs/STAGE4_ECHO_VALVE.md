# Stage 4 — Shared Echo and valve intelligence

## Scope and safety position

Stage 4 adds a shared, append-only Echo source and a connected valvular-heart-disease workspace. It stops before CAD/ACS, AF, full devices, cardiometabolic and perioperative modules. The implementation records and resolves clinician-confirmed data, compares studies, coordinates tasks and supplies governed pathway forms. It does not autonomously diagnose valve severity or choose an intervention.

All 23 Stage 4 rule candidates are in `CLINICAL_REVIEW`. Their trigger deliberately depends on a nonexistent governance fixture, so they cannot execute or create patient recommendations. Threshold extraction, software-use/licensing review, independent clinical review, approval and publication remain required.

## Architecture

The previous `heart_failure.echo_observation` table is retained as immutable history. Migration `008-echo-valve-intelligence` backfills it idempotently into the new shared source. All new Echo writes, including the existing HF quick-entry endpoint, go to `imaging.echo_study`.

The shared model contains:

- `imaging.echo_study`: patient, encounter, study type, formality, time, location, comparison source and legacy provenance.
- `imaging.echo_revision`: append-only draft/preliminary/final/amended reports, quality, rhythm/hemodynamic context, structured findings, interpretation, conclusion and authorship.
- `imaging.echo_measurement`: reusable parameter code, value, unit, method, context, order and linked clinical fact.
- `imaging.valve_finding`: valve, lesion, mechanism, clinician severity, discordance, supporting parameters and override rationale.
- `imaging.quality_check`: factual completeness and consistency checks separated by severity.
- `valve.state_event`: longitudinal clinician-confirmed lesion state.
- `valve.pathway_assessment`, `heart_team_event`, `surveillance_plan`, `prosthesis` and `procedure_record`: connected, auditable valve care.

All Stage 4 clinical records are append-only. Echo amendments create a new revision; current views select the latest revision without deleting the prior report.

## Current-value resolution and longitudinal comparison

Finalized measurements are projected to `clinical.fact` with source study, time, method, quality, verification and author. The existing current-state resolver ranks verified, high-quality sources and preserves competing values. A clinician preference can explicitly select or release the current fact with a documented reason.

The Echo dashboard uses the preferred LVEF source when one exists and otherwise chooses the strongest finalized study using finalization, formal/bedside status, quality and time. A newer very-limited bedside study therefore does not automatically replace a good formal study. Valve current-state projection applies the same formal-study and quality precedence.

Repeat studies compare reusable measurements and structured valve severity. The patient view shows current, previous, change, interval, source and quality. Numeric significance thresholds are intentionally absent until governed candidate rules are independently approved.

## Reporting engine

The adaptive editor supports complete and limited TTE, TEE, stress, contrast, 3D, focused bedside and future interventional Echo. It captures indication, quality and limitations, encounter, reporting clinician, measurements and methods, integrated RV/diastolic/pulmonary/aortic/pericardial findings, valve mechanism/severity/discordance, linked supporting measurements, comparison and conclusion.

Finalized reports require a clinician conclusion. The generated report is always labelled as a draft requiring cardiologist editing and final approval. No generated text can become final by itself.

## Connected clinical workflows

- HF now consumes `echo.lvef` and the shared study ID. A new finalized LVEF supersedes the prior HF imaging-review task and creates a new reassessment task when the clinician-confirmed phenotype points to another study.
- A finalized valve finding creates a longitudinal state and retires obsolete surveillance tasks and plans for that lesion.
- Severe or discordant clinician findings create a review task, without emitting an intervention recommendation.
- Valve pathways use the standard “What we know / What is missing / Why it matters / Next decision / Evidence” structure.
- Heart Team state records consideration, referral, review, decision and planned procedure as separate auditable events.
- Surveillance accepts clinician-confirmed exact Echo and review dates, an acceptable window and early-review triggers.
- Prosthetic records retain position, type, model/size, implant date, route, antithrombotic context and a preferred baseline Echo.
- Procedure records support TAVI/SAVR, mitral, tricuspid and commissurotomy workflows, complications, result, follow-up and a conduction/EP hook.

## Patient experience

Echo and valve intelligence is present inside the same four-tab patient workspace:

- **Summary:** preferred study, LVEF, quality, change, valve state, quality issues, surveillance and actions.
- **Clinical Record:** expandable structured studies and valve pathway records with authorship and provenance.
- **Timeline:** studies, Heart Team events and valve interventions ordered automatically by time.
- **Add / Update:** one `Echo study` action opens the comprehensive adaptive editor.

## Evidence baseline

- 2025 ESC/EACTS Guidelines for valvular heart disease.
- 2025 ASE standardized adult echocardiography reporting.
- 2025 ASE diastolic-function recommendations.
- 2025 ASE right-heart and pulmonary-hypertension recommendations.
- 2024 ASE prosthetic-valve multimodality guideline.
- ASE/EACVI chamber quantification and ASE/SCMR native regurgitation guidance.

Only source metadata and independently authored candidate structures are stored. Copyrighted tables and algorithms were not copied. Software-use and licensing must be confirmed before encoding and publishing clinical thresholds.

## Known limitations and deferred work

- Candidate threshold logic, class/level attribution and surveillance intervals require licensed evidence extraction and independent specialist review.
- Wall-motion segment capture, direct image/DICOM ingestion, attachment storage, strain curves and full interventional Echo remain later work.
- Comparison currently presents raw structured change; approved clinically meaningful-change thresholds remain pending.
- Valve pathways organize clinician reasoning but do not yet calculate intervention eligibility.
- Dedicated aortic, PH, cardiomyopathy, endocarditis, pregnancy and EP modules remain outside Stage 4.
