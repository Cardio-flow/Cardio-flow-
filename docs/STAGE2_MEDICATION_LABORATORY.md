# Stage 2 — Medication and Laboratory Intelligence

Implementation date: 22 September 2026

## Scope

Stage 2 adds reusable medication and laboratory infrastructure without adding disease-treatment eligibility. It answers how a documented medication can be recorded, monitored and reassessed safely. It does not decide whether a patient with a disease should receive that medication.

## 2A — Medication master

- Versioned, immutable generic medication definitions are separate from site products and trade names.
- The initial catalogue contains 62 generic cardiovascular and cardiometabolic medications.
- The catalogue has 30 browsable clinical groups, including HF/cardiorenal, antiplatelet, anticoagulation, lipid lowering, antianginal, antiarrhythmic, antihypertensive, GLP-1, dual GIP/GLP-1 and pulmonary hypertension architecture.
- Generic search covers generic name, class, clinical category, group and configured trade name.
- Current-patient and recently-used medications are ranked before the remaining catalogue.
- `medication.site_product` and its append-only status events form the Kuwait/site formulary layer. Local names and availability are never embedded in generic logic.
- Dose, renal, hepatic, pregnancy, contraindication, caution, monitoring, adverse-effect and interaction fields exist on each generic version. They deliberately remain marked `not_clinically_curated` until evidence and independent review exist.

## 2B — Longitudinal medication record

- A therapy is a stable medication course; every start, dose increase, dose decrease, hold, restart, stop, plan or correction appends an immutable event.
- Clinician-facing states are `ACTIVE`, `TEMPORARILY_HELD`, `STOPPED` and `PLANNED`.
- Events support generic/product, structured indications, dose/unit, frequency, route, effective time, prescriber, provenance, reason, discontinuation, adherence, target dose and planned titration.
- The patient view resolves the current event without overwriting prior doses.
- Exact duplicate current generic courses require explicit confirmation.
- Allergy, intolerance, side effect and unknown reaction are stored as distinct structured types.

## 2C — Laboratory intelligence

- The catalogue contains 39 cardiology-relevant tests across renal/electrolyte, hematology, metabolic, lipid, hepatic, thyroid, cardiac biomarker, iron, renal-risk and coagulation categories.
- Every result retains original value/unit, canonical value/unit, specimen, collection/result time, source, laboratory, reference range, abnormal flag, verification and provenance.
- Corrections append a new version and retain the superseded result.
- Unit conversion uses the versioned Stage 1 unit catalogue. Unsupported conversions fail rather than guess.
- Trends provide latest, previous, change, direction, dates and full underlying results.
- Verified adult creatinine can derive separate race-free 2021 CKD-EPI eGFR and Cockcroft–Gault creatinine clearance records. Each result stores its equation, version and input provenance. They remain separate concepts and units.
- Calculation evidence is recorded from the official NIDDK adult eGFR equations and FDA Cockcroft–Gault guidance.

## 2D — Medication safety

- Each therapy projects governed current medication status and dose facts into the Stage 1 resolver.
- Each laboratory result projects a verified, time-aware clinical fact into the same resolver.
- Published rule conditions can combine medication status/dose, laboratory values, vitals, diagnoses, procedures and any other normalized fact.
- Architecture-only medication–parameter relations identify relevant laboratory, vital, ECG, procedure and clinical context. They contain no thresholds and cannot create an alert.
- Rule types already include contraindication, caution, drug interaction, medication monitoring and dose consideration.
- Alert severity/category and “why am I seeing this?” views retain rule version, publication snapshot, review snapshot, input fact IDs and evidence snapshot.
- Exact-generic duplication and structured adverse-reaction matching run before confirmation. Class duplication and drug interaction alerts remain medication-specific governed rules, avoiding unsafe class-wide assumptions.

## 2E — Monitoring and titration

- Published rules can generate laboratory, clinical review, follow-up or reassessment tasks.
- Tasks store an exact target date, optional acceptable window, triggering therapy, rule key/version and evidence snapshot.
- Open and overdue medication monitoring appears in the Worklist and patient medication detail.
- Titration plans are append-only and support planned, waiting, ready, deferred, target-achieved, maximally-tolerated and stopped states.
- Absolute contraindication, dose limitation and current titration limitation are distinct.
- A rule-created titration plan is explicitly unconfirmed. The engine never changes a dose.
- New results trigger recalculation automatically. Changed recommendations append a replacement and supersede open tasks; history is retained.
- Medication rules consume the clinician-selected current-value override from Stage 1.

## Governance and published clinical rules

Production clinical rule count added by Stage 2: **zero**.

No implementation account acted as its own clinical checker. Real medication thresholds, intervals, contraindications, interactions and titration criteria require:

1. an immutable evidence version from an authoritative product label or guideline;
2. a rule draft and representative technical tests;
3. a maker submission;
4. an independent checker review;
5. approval and explicit publication.

The synthetic `test.*` rule used by automated tests is created only inside an ephemeral test database. It is never seeded or deployed.

## Database migration

`006-medication-laboratory-intelligence` is additive. It adds `medication` and `laboratory` schemas, append-only triggers, current-state views and optional medication/rule/window links on existing clinical tasks. Migrations 001–005 are unchanged.

## Validation

Automated coverage includes:

- catalogue groups/search and local formulary separation;
- medication start, increase, hold and restart;
- immutable dose history and duplicate-course protection;
- adverse-reaction type separation;
- original/canonical lab values and conversion;
- renal equations remaining distinct;
- increasing, decreasing, stable and single-value trends;
- monitoring upcoming, due, overdue and completed states;
- titration ready, waiting, target-achieved, maximally-tolerated, deferred and stopped states;
- published-only fixture safety evaluation;
- exact task date/window and therapy linkage;
- current-value override selection/release;
- new-result recalculation and recommendation/task superseding.

## Deferred beyond Stage 2

- Disease-specific medication eligibility, including HFrEF, AF anticoagulation, GLP-1 eligibility and valve/VTE decisions.
- Medication-specific renal dose selection and target-dose rules until their appropriate disease/product-label review.
- A broad commercial interaction database. CardioFlow will add only reviewed cardiology-relevant interactions.
- Automatic external laboratory and hospital formulary feeds.
- Pediatric renal equations and cystatin-C equations.

## Stage 3 readiness

The normalized medication and laboratory data foundation is suitable for Stage 3 to consume without duplicating medication or laboratory logic. Stage 3 must still publish its own independently reviewed disease and medication rules before they affect production patients.
