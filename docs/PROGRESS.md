# Progress — 23 September 2026

## Stage 5.5 patient journey UX — in progress

The staged implementation and full acceptance tracking are described in [STAGE5_5_JOURNEY.md](STAGE5_5_JOURNEY.md). Patient-journey navigation, concise Summary/What Changed, quick single and multi-lab entry, diagnosis-context medication browsing, searchable comorbidities, guided HF and complication review, HF discharge handover, dated plan actions and an editable general plan-note draft are implemented on the development branch. The underlying clinical, registry, audit and governance records remain unchanged. Stage 5.5 remains open pending governed dose content, published management rules, wider registry/event mapping, legacy-form retirement, clinician workflow review and production release.

## Release 1.0 — Stage 5 connected coronary care (23 September 2026)

Implemented the additive coronary architecture in [STAGE5_CORONARY.md](STAGE5_CORONARY.md): one longitudinal coronary state, reusable ECG record, ACS event and milestone capture, structured angiography/lesions/physiology/imaging, lesion-linked PCI and stents, combined antiplatelet/OAC plans, CCS and ANOCA/INOCA pathways, complication reassessment, prevention/rehabilitation plans, exact-date tasks, six editable report drafts and shared clinical-fact projection.

The CAD registry draft now reuses supported presentation, procedure, stent, medication, laboratory and Echo data with source provenance. Existing CAD episodes remain accessible. Migration `009-coronary-intelligence` is additive and preserves Stage 0–4 records.

Four dedicated review packs contain 22 evidence-linked candidates across ACS, CCS/ANOCA, PCI/antiplatelet and secondary prevention. All remain unpublished in `CLINICAL_REVIEW`; no treatment threshold, duration, score or intervention recommendation executes before independent review, testing and publication.

## Release 0.9 — Stage 4 shared Echo and valve intelligence (23 September 2026)

Implemented the additive architecture in [STAGE4_ECHO_VALVE.md](STAGE4_ECHO_VALVE.md): one append-only structured Echo source, versioned cardiologist reports, adaptive TTE capture, source-quality-aware current-value resolution, longitudinal comparison, shared HF consumption, structured native/prosthetic valve findings, combined valve state, clinician-authored intervention pathways, Heart Team workflow, exact-date surveillance, prosthesis and post-intervention records, report-quality checks and patient Summary/Clinical Record/Timeline integration.

Migration `008-echo-valve-intelligence` preserves the immutable Stage 3 HF Echo table and idempotently backfills it into the shared source. New writes through both the comprehensive editor and legacy HF endpoint now use the shared model. Repeat finalized imaging supersedes obsolete HF review tasks and valve surveillance plans/tasks without deleting history.

The [Echo Clinical Review Pack](ECHO_CLINICAL_REVIEW_PACK.md) contains 10 candidates and the [Valve Clinical Review Pack](VALVE_CLINICAL_REVIEW_PACK.md) contains 13. All remain unpublished in `CLINICAL_REVIEW`; no Stage 4 clinical threshold or intervention recommendation executes before licensed evidence extraction and independent clinical approval.

## Release 0.8 — Stage 3 heart failure module (22 September 2026)

Implemented the additive, connected HF clinical record and unified patient experience described in [STAGE3_HEART_FAILURE.md](STAGE3_HEART_FAILURE.md): structured longitudinal reviews, clinician-confirmed phenotype with preferred-Echo provenance, automatic reassessment after new imaging, diagnostic/complication pathways, integrated medication/laboratory context, exact dated device and discharge tasks, rehabilitation assessment, editable note draft, and HF views in Summary, Clinical Record and Timeline.

Added migration `007-heart-failure-intelligence`, three current evidence catalogue records, and the dedicated [HF Clinical Review Pack](HF_CLINICAL_REVIEW_PACK.md). All 15 disease-specific rule candidates remain unpublished in `CLINICAL_REVIEW`; no implementation account self-approved them and no HF recommendation can affect a production patient before licensed evidence extraction, tests and independent clinical approval.

Validation: production build and formatting passed; 47 server/domain/integration tests passed, including eight HF cases and immutable-history/governance assertions; all 15 browser workflows passed on desktop, mobile and tablet. Migration 007 was applied to the configured Neon database before deployment.

## Release 0.6 — Stage 1.5 clinical governance (22 September 2026)

Implemented the additive evidence and rule-governance layer described in [CLINICAL_GOVERNANCE.md](CLINICAL_GOVERNANCE.md): versioned evidence status and review queue, site guideline preferences, a separate institutional-policy layer, immutable rule metadata and versions, independent maker/checker review, separate technical test-run authority, server-only execution of published rules, reassessment after rule/evidence changes, recommendation traceability, clinician recommendation actions, and the remaining current-value override UI.

The patient master gained optional reusable Civil ID/file identifier, phone, height, weight, derived BMI/BSA, allergies, smoking/reproductive status, primary team and major comorbidities. Existing clinical facts, patients, registry records, care history, authentication and audit history are preserved.

Seeded metadata-only reference records cover ESC heart failure 2026, ESC/EACTS valvular heart disease 2025, ESC atrial fibrillation 2024, ESC non-cardiac surgery 2022, KDIGO CKD 2024 and ADA 2026. No disease-specific clinical rule is installed or active.

Migration: additive `005-clinical-governance`. Verification: TypeScript/production build passed and all 42 server/domain/auth/foundation/governance tests passed, including lifecycle, rejection, superseding, immutable history, unauthorized publication, separate technical testing, site isolation, evidence update recalculation, traceability, current-value override and unpublished-rule blocking.

## Release 0.5 — Stage 0 audit and Stage 1 clinical foundation (22 September 2026)

The two September 2026 master specifications are now the controlling product roadmap, with the second specification taking precedence. [CLINICAL_FOUNDATION_AUDIT.md](CLINICAL_FOUNDATION_AUDIT.md) contains the architecture comparison, duplicate-data map, additive design, migration inventory, validation scope and Stage 0–14 sequence.

Implemented the shared, disease-neutral foundation: versioned terminology and units; immutable structured-field package; append-only clinical facts with provenance, correction and clinician preference; current-state resolution that separates verified, pending, historical and superseded values; persistent clinical events; centralized time-aware rules; evidence snapshots; expiring recommendations; alert actions; event-sourced tasks; pathways that reuse known facts; and synchronous recalculation after new clinical data. Existing care entries are projected idempotently, including during migration.

No disease, medication, device, valve, AF, CKD, GLP-1 or perioperative clinical rule is active. The existing simplified UX, care records, registry data, CAD workflow, audit and auth remain intact. Stage 2 has not started.

Migration: additive `004-clinical-foundation`. Run `npm run db:migrate` before deploying this code to the hosted application.

Checks executed: TypeScript and production build passed; formatting passed; 35 server/domain/foundation tests passed; all 12 existing browser workflows passed. Foundation tests cover non-latest state selection, clinician preference, pending versus verified facts, immutable correction history, missing data, rule priority conflicts, evidence retention, conditional fields, unit conversion, pathway reuse, recommendation invalidation, alert/task generation, task supersession, append-only enforcement, API roles and guided-care projection.

## Restored baseline

Recovered **Final Codex Plan** and verified all original HF/CAD/EP backups. The complete scope includes HF, CAD, EP, Structural Heart and custom registries. The working Vercel/Neon stack remains in place.

## Release 0.2 implementation

- Today, Admissions, OPD, Registries, Patients and all six agreed patient tabs.
- Independent Admission/OPD encounters, explicit connections and discharge handover.
- Dated problems, decisions, investigations, medications, procedures and complications with owner, review date, assessment, action and response.
- Care-only registration by default; CAD enrollment optional and available later. Procedure documentation does not require enrollment.
- Encounter closure preserves outstanding patient reviews. Overdue means a review is overdue or undocumented, not proof that care was missed.
- Validated states/closure evidence, held-medication reason and review, investigation interpretation, optimistic versions, immutable revisions and audit.
- Fictional Hassan walkthrough: OPD → ACS/PCI admission → discharge → linked OPD with continuing reviews.
- Escaped, printable HTML care reports; browser Print → Save as PDF. Direct PDF generation and finalized report snapshots remain pending.
- Additive migration `002-continuous-care`; existing CAD schema and records preserved.

## Checks executed

- TypeScript and production frontend build passed.
- 23 API/domain/authentication checks passed, including care-only use, discharge continuity, cross-patient/site rejection, role boundaries, immutable history and stale writes.
- Nine browser checks passed across the existing CAD/auth suite and new continuity test. Affected cases were re-run after fixing the Status field's accessible label and adapting the login assertion to Today.
- Browser journey verifies admission, outstanding decision, discharge, linked OPD, reload, completion, history, report download and later enrollment. Phone width checked at 390px.
- Isolated-browser inspection of Today and Hassan's six-tab workspace found meaningful content and no runtime errors.

## Next acceptance gate

Deployment note: `public/` is generated by `build:hosted` and excluded from CLI uploads. Uploading stale local bundles caused missing-file build errors. The Express preset did not publish build-generated assets to its input-based static routes, so `server/frontend.ts` explicitly serves bundled generated assets with correct MIME types and immutable caching. Missing assets return plain-text 404, never HTML. A regression test covers generated files, missing paths and traversal. Build production candidates with `--skip-domain`, verify their HTML and assets, then promote.

Complete the first journey's clinical detail: private ECG/diagnostic attachments with report inclusion; timestamped ACS milestones; structured shared results/medications and detailed procedures; clinician-reviewed fact reuse in CAD; downloadable frozen PDF reports. Preserve origin/date, explicit enrollment and provisional diagnoses.

Then implement the recovered HF/CAD/EP field catalog, Structural Heart workflows and governed custom-registry builder. Acceptance requires actual forms and persistence; family selectors are not complete specialty modules.

## Remaining full-platform work

Complete specialist forms, private attachments/direct PDF, milestone/dependency engine, reviewed clinical guidance, shared-fact mappings, no-code registry versioning/publication, final-record amendments, imports, richer exports/analytics, staff administration, multi-organization grants and operational readiness.

Fixed demonstration-site checks do not establish multi-tenant authorization. All treatment rules remain inactive. This release is a continuous-care foundation, not the completed masterplan.

## Release 0.3 — guided capture and source registry drafts (21 September 2026)

Implemented a searchable catalog across problems, complications, procedures, investigations, medications and follow-up. Multiple selections save atomically as distinct patient records. Branches appear from preceding choices; hidden descendants are removed on both client and server. Unknown is preserved, status/closure checks remain enforced, and custom narrative records remain available.

- Guided medication documentation includes 37 named drugs, indication, route, dose, frequency, decision reason and monitoring selections. This is not a complete prescribing engine.
- Complication forms expose clinician-selected assessment/management actions and response/next-step choices. No treatment is ordered automatically.
- Reusable, dated facts from coded problems/results are proposed for explicit review in noncardiac surgery and apixaban forms. This is a limited set of mappings, not universal cross-registry synchronization.
- Original RCRI point-count and adult-NVAF apixaban label-reference previews explain their criteria and withhold output for missing, contradictory or out-of-scope inputs. These remain synthetic implementation previews pending clinical approval. The server recomputes and retains reference snapshots with rule/source versions in immutable care history.
- Documentation reminders identify overdue reviews, held medication, unreviewed results, missing complication response, recorded deterioration and concurrent bleeding/antithrombotic records. These are not real-time monitoring or exhaustive drug-interaction alerts.
- Source-derived HF/CAD/EP packages expose 2,108 editable fields; 96 legacy controls remain inactive and 48 identity/attribution/contact fields use the shared record rather than duplicate forms. This count describes recovered metadata, not certified full specialist workflows.
- Registry drafts have section navigation, search, supported declarative branching, repeated assessment contexts, linked encounters, draft CSV export, optimistic versions and immutable history. Partial drafts are permitted. Finalization, clinical publication, full EP conditional workflow reconstruction, attachments, calculations, structural/custom registries and universal fact reuse remain pending.
- Additive `003-guided-forms` migration preserves existing clinical tables/data and adds versioned structured care and registry storage. Applied migration SQL must not be edited.

Checks: TypeScript, production build and formatting passed; 28 API/domain/auth tests and all 11 browser tests passed. These cover guided multi-save, hidden-field cleanup, contraindication/unknown blocking, exact numerical boundaries, persisted reference evidence, registry history/branching, roles, stale updates and phone layout. The additive hosted migration preserved all 10 patients, 8 CAD episodes, 3 care encounters and 8 pre-existing care entries, and installed the three versioned registry draft packages.

Deployment verification caught a Node ESM import lacking its `.js` extension in a shared model. The candidate was not promoted; the public site remained healthy. Imports now use explicit runtime extensions and `shared-runtime.test.ts` verifies the emitted modules with plain Node, without the development TypeScript resolver.
