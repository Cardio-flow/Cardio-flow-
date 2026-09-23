# Stage 5 — connected coronary care

## Architecture changes

Stage 5 adds one disease-specific layer on the Stage 0–4 foundations. Coronary presentation, ECG, ACS, angiography, lesions, PCI, stents and care-plan events live in append-only tables under the `coronary` schema. Final records project reusable, versioned clinical facts into the shared clinical foundation. Medication, laboratory, Echo, HF, valve, task, evidence, audit, timeline and registry systems remain the source systems for their respective domains.

The patient Summary, Clinical Record, Timeline and Registries tabs consume the same coronary record. The universal **Add / Update → Coronary care** action is the normal entry point. Legacy CAD episodes remain readable; they are not migrated destructively and are no longer the preferred entry path for new coronary care.

## Database migration

Additive migration `009-coronary-intelligence` creates:

- `coronary.state_event`
- shared `clinical.ecg`
- `coronary.acs_event`
- `coronary.angiogram` and `coronary.lesion`
- `coronary.pci` and `coronary.stent`
- `coronary.plan_event`
- indexes, ownership constraints and immutable-update/delete triggers

No Stage 0–4 table is removed or rewritten. Existing CAD enrollments and episodes are queried as legacy history. The migration also seeds only evidence metadata and 22 unpublished candidate rule contracts.

## Connected clinical model

- **Coronary state:** current and historical suspected CAD, CCS, MI, PCI, CABG, ACS, post-ACS, ANOCA/INOCA and recurrent angina are retained. A new current state supersedes the previous current assertion without deleting it.
- **ECG:** structured timing, indication, rhythm, intervals, axis, ischemic changes, conduction/pacing, comparison, source, attachment reference and clinician interpretation. Final interpretation becomes a shared clinical fact and creates reassessment work.
- **Troponin:** serial hs-cTnI/hs-cTnT remains in the laboratory engine with assay, unit, reference range, time and provenance. No universal threshold is implemented.
- **ACS:** supports possible/uncertain ACS, STEMI, NSTEMI, NSTE-ACS, unstable angina and revised alternatives; optional timing milestones; symptoms; hemodynamics; HF/shock/arrhythmia context; and transparent risk-tool input/missing-data storage.
- **Angiography:** structured anatomy, lesions, culprit certainty, TIMI flow, grafts, optional FFR/iFR/RFR, IVUS/OCT, contrast, complications, conclusion and plan.
- **PCI/stents:** PCI links to ACS, angiogram and lesion; stores technique, procedural timeline, physiology/imaging, final flow, complications, residual disease and staged plan. Stent type, dimensions, model/manufacturer, vessel, lesion and implantation time are reusable.
- **Antithrombotics:** one plan can link aspirin, P2Y12 and oral anticoagulant therapies with combination dates, review date, bleeding/ischemic context and deviation rationale. A significant bleeding or stent concern makes the current plan uncertain and schedules reassessment without modifying medication.
- **CCS and ANOCA/INOCA:** clinician-authored decision pathways retain known facts, missing facts, options, mechanism assessment and next review. They do not issue an autonomous diagnosis or therapy.
- **Prevention/rehabilitation:** LDL-C and Lp(a) reuse shared laboratory results; medications reuse the Stage 2 medication record; smoking, barriers, rehabilitation status and exact review dates are documented as plans/tasks.
- **Complications:** structured ACS/PCI complications trigger reassessment and appear in the longitudinal record. Existing HF/shock, Echo and valve data are displayed jointly instead of duplicated.
- **Reports:** six editable drafts are generated from structured data: ACS admission, angiography, PCI, ACS progress, ACS discharge and CAD follow-up. Missing data remains missing and every draft requires clinician finalization.

## Registry and legacy handling

The CAD registry editor now pre-populates supported fields from the connected record: presentation/admission, angiography date/access, PCI/staged status, target vessel, stent count, antiplatelet/OAC medication, troponin, LDL-C and LVEF. Option and unit checks still apply, and a clinician reviews the draft before saving. Registry projection shows each value with its clinical source and date. Legacy CAD episodes remain queryable and visible.

## Governance and evidence

The four review packs are:

- [ACS](ACS_CLINICAL_REVIEW_PACK.md)
- [CCS and ANOCA/INOCA](CCS_CLINICAL_REVIEW_PACK.md)
- [PCI and antiplatelet](PCI_ANTIPLATELET_REVIEW_PACK.md)
- [Secondary prevention](SECONDARY_PREVENTION_REVIEW_PACK.md)

All 22 candidates have an evidence record, review contract, exclusions and at least three planned boundary cases. Their database rule status is `draft`, test status is `not_run`, and lifecycle queue is `CLINICAL_REVIEW`. Their only trigger is a deliberately absent governance fact. No Stage 5 clinical recommendation is active or published.

## Validation scope

Server/integration coverage includes twelve synthetic cases: STEMI primary PCI, NSTEMI with CKD context, ACS with AF/OAC combination, post-PCI bleeding, staged PCI, CCS, ANOCA/INOCA, post-ACS LDL-C review, ACS with severe AS, ACS with HF, repeat angina/stent concern after PCI, and prior CABG. It also verifies cross-patient link rejection, append-only records, current-state supersession, shared clinical-fact projection, exact task dates, medication non-interference and dormant rule governance.

The browser journey registers a patient, records a longitudinal coronary state and ACS event from Add / Update, and confirms the same information in Summary, Clinical Record, Timeline and registry projection. The full Stage 0–4 regression suite remains required before deployment.

## Known limitations and deferred work

- Candidate rules need licensed source extraction, explicit expected boundary outputs, independent clinical approval, separate technical test evidence and publication before real decision support is active.
- GRACE, ARC-HBR and PRECISE-DAPT calculators are architectural candidates only; no score is computed without a reviewed implementation/licensing decision.
- Reports are editable structured drafts rather than signed/frozen PDFs.
- Attachments are referenced but private object storage is deferred.
- Full AF indication logic belongs to Stage 6. The Stage 5 combination plan can already link an OAC without duplicating the future AF record.
- Legacy CAD episode editing remains available for historical compatibility during the transition. New documentation should use the unified coronary record.

Stage 6 has not started.
