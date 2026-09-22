# CardioFlow Stage 0 audit and Stage 1 foundation

Date: 22 September 2026

This document applies the two master specifications supplied on 22 September 2026. The second specification extends the first and takes precedence. It records the architecture audit, the minimum compatible change, and the staged product roadmap. It does not claim that any disease-specific clinical module is complete.

## Stage 0 — architecture audit

### Current architecture

CardioFlow is a React/TypeScript client with an Express API. Local development uses PGlite and the hosted deployment uses PostgreSQL on Neon. Hosted schema changes run through a checksum-protected migration ledger. Vercel and Neon remain the authorized stack.

The working product has four main data areas:

1. `core.patient` is the shared patient identity. It currently stores name, MRN, sex, birth date, site, author and creation time.
2. `care.encounter` and `care.entry` hold the longitudinal care record. Entries cover problems, decisions, investigations, medications, procedures and complications. Guided forms store coded answers in `care.entry.structured`. Updates use optimistic versions and append immutable `care.revision` snapshots.
3. `registry.*`, `clinical.episode`, `cad.*` and the original `workflow.followup_task` hold CAD registry records, recovered HF/CAD/EP registry drafts and CAD protocol follow-up.
4. `governance.*` stores immutable audits, snapshots, exports and the hosted migration ledger.

The simplified UX introduced in release 0.4 is compatible with the new specification and is retained: Worklist, Patients, Registries & Analytics, plus the unified Summary, Clinical Record, Timeline and Registries patient workspace.

### Existing functionality retained

- Shared patient identity and care-only registration.
- OPD and admission continuity, linked visits, closure and discharge handover.
- Structured and free-text care documentation.
- Guided conditional forms and searchable catalogs.
- Care-entry authorship, timestamps, optimistic concurrency and immutable revision history.
- Registry enrollment, registry draft versioning, conditional fields and recovered source packages.
- Legacy CAD episode finalization, snapshots, follow-up contacts and exports.
- Worklist, patient search, unified patient workspace and progressive registry disclosure.
- Hosted authentication, role checks, same-origin/CSRF controls and fixed pilot-site scoping.

### Duplicated or incompatible structures

| Area           | Existing structures                                                                                                         | Problem for the final architecture                                                                     | Resolution                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visits         | `care.encounter` and registry-linked `clinical.encounter`                                                                   | The registry contact model cannot represent the whole patient journey.                                 | Keep both. `care.encounter` remains the clinical context; legacy registry contacts remain compatible registry evidence.                               |
| Episodes       | `clinical.episode` is tied to CAD enrollment; `care.encounter` is enrollment-independent.                                   | A registry episode cannot be the universal clinical record.                                            | Keep CAD episodes as governed legacy registry records and reference shared clinical facts from them later.                                            |
| Follow-up      | `care.entry.due_date`, CAD `workflow.followup_task`, and registry contacts                                                  | Three queues encode different obligations and cannot support general event-driven tasks.               | Preserve both existing mechanisms and add a generic event-sourced `workflow.clinical_task` adapter for future clinical rules.                         |
| Current values | Values are embedded in `care.entry.structured`; reuse chose the newest dated record.                                        | This cannot distinguish verified, preliminary, superseded, poor-quality or clinician-preferred values. | Add an immutable `clinical.fact` projection and a resolver that ranks verification and quality before time.                                           |
| Diagnoses      | Problem entries contain status and form-specific JSON.                                                                      | There is no shared terminology identity or fact history across forms.                                  | Preserve entries and project each coded entry to a versioned terminology concept.                                                                     |
| Investigations | LVEF, creatinine and other results appear in multiple problem, complication, procedure, medication and investigation forms. | The same measurement can be re-entered with no authoritative source selection.                         | Project supported results to one concept stream with provenance; do not silently overwrite source records.                                            |
| Medications    | Guided medication entries and medication-specific preview logic                                                             | There is no governed generic medication library, dose model or monitoring engine yet.                  | Preserve documentation. Medication intelligence remains Stage 2.                                                                                      |
| Rules          | RCRI and apixaban preview functions plus UI documentation alerts                                                            | Logic is scattered, partly client-side and cannot expire or re-run across events.                      | Keep previews for compatibility and add a centralized versioned rule engine. No disease/treatment rule is activated in Stage 1.                       |
| Forms          | Guided fields and registry fields use related but different condition formats.                                              | Definitions are not governed by one clinical terminology/unit package.                                 | Publish the existing guided catalog as an immutable structured-field package; later adapters can converge registry fields without rewriting them now. |
| Alerts         | Documentation reminders are calculated in the browser.                                                                      | They have no acknowledge, snooze, dismiss, evidence or material-change lifecycle.                      | Preserve reminders and add a persisted alert/action model for rule-generated alerts.                                                                  |

### Specific duplicate clinical values found

- LVEF occurs in the HF problem, cardiomyopathy problem and dedicated LVEF investigation.
- Creatinine occurs in CKD, AKI, noncardiac surgery, apixaban review and the dedicated creatinine investigation.
- Potassium occurs in CKD, hyperkalaemia and the dedicated potassium investigation.
- Symptoms, rhythm, haemodynamic state and procedural status recur across problems, complications and procedures.
- CAD presentation, PCI and discharge information can exist in both care entries and the legacy CAD episode.
- Follow-up intent can exist as a decision entry, entry due date, CAD protocol task or registry contact.

These are retained as source documents. The clinical fact layer provides one resolved state without deleting the original context.

### Minimum architecture change

A replacement of the care model would risk data loss and invalidate working audit history. Stage 1 therefore adds an event-sourced clinical projection above the existing record:

```text
care / investigation / future integration
                 │
                 ▼
       immutable clinical facts
       + terminology + units
                 │
                 ▼
      current clinical state resolver
                 │
                 ▼
 persistent clinical change event
                 │
                 ▼
 versioned rules + evidence + pathways
                 │
                 ▼
 recommendations → alerts → tasks
```

The source record remains authoritative. The projection stores source type, source ID, label, author, observed/effective/recorded times, verification, source quality and supersession. Every recommendation stores the exact fact IDs, rule version and evidence snapshot used to create it.

## Stage 1 — implemented shared foundation

### Clinical terminology and structured fields

- Versioned terminology concepts identify the existing guided templates.
- Generic care concepts cover uncoded problem, decision, investigation, medication, procedure and complication records.
- The guided catalog is published as an immutable, checksummed field package.
- Fields have reusable value type, options, search behavior, units, priority and declarative visibility conditions.
- Search and conditional-field behavior are available as shared pure functions.

This governs the existing fields; it does not add new disease modules.

### Units

- Versioned unit definitions include symbol, dimension, canonical unit, conversion factor and offset.
- Conversion refuses incompatible dimensions.
- Creatinine, mass concentration, pressure, mass, ratio, rate and clearance units required by the existing forms are represented.
- No dosing rule or reference range is inferred from a unit.

### Unified clinical facts and provenance

- `clinical.fact` is append-only.
- Corrections create a new version in the same logical fact stream and reference the superseded fact.
- Historical source records are not overwritten or deleted.
- Existing care entries are backfilled idempotently during migration.
- New and updated care entries project facts in the same transaction as their revision and audit history.
- Direct clinical facts can be recorded through a clinician-only API for future integrations.

### Current clinical state resolver

The resolver separates:

- verified current facts;
- preliminary or unconfirmed pending facts;
- historical facts;
- superseded/corrected facts;
- inactive, retracted or entered-in-error assertions;
- explicit clinician preference.

It does not choose the latest value blindly. It ranks verification status, source quality, observation time and recording time, in that order. A clinician can explicitly select or release a preferred measurement with a recorded reason. Effective start/end time and an `asOf` time support historical state reconstruction.

### Event-driven recalculation

- Every new fact and current-value preference appends a persistent `clinical.event`.
- The event invokes the centralized rule evaluator inside the write transaction.
- Every run is recorded with the engine version and result summary.
- Repeated startup/backfill is idempotent and does not create new fact versions.

### Rules, evidence and recommendation validity

- Rule definitions are immutable, versioned and checksummed.
- The rule condition language supports all/any/not, presence, comparisons, value age and time since an event.
- Rules declare required information, exclusions, priority, conflict group, output, alert proposal, task proposals and evidence.
- Missing required data produces `needs_data`; it does not create false certainty.
- Safety priority wins over lower-priority optimization inside a conflict group.
- Recommendations are immutable generations containing exact inputs and evidence snapshots.
- When new data makes an earlier recommendation false, a resolved generation supersedes it and linked unfinished tasks become superseded.
- No medication, disease, device, valve, anticoagulation, perioperative or treatment rule is active in the shipped catalog.

### Alerts and tasks

- Rule-generated alerts have category, severity, recommendation and material-state fingerprint.
- Clinicians can acknowledge, act, snooze or dismiss; reasons and snooze times are append-only events.
- An unchanged recommendation does not create duplicate alerts or tasks when unrelated data arrives.
- Generic clinical tasks support review, laboratory, follow-up, reassessment and administrative work.
- Task state changes are append-only with optimistic versions and outcome notes.
- The original CAD protocol tasks and existing care due dates remain available.

### Pathways

- Pathway definitions and sessions are versioned and immutable.
- Decision, action and terminal nodes form an interactive tree.
- A pathway reads the resolved patient state and skips a question when an existing current fact supplies the answer.
- Each node can retain its explanation and evidence references.
- No disease pathway is installed by Stage 1.

### API surface

- `GET /api/clinical/catalog`
- `GET /api/patients/:id/clinical-state`
- `POST /api/patients/:id/clinical-facts`
- `POST /api/patients/:id/clinical-preferences`
- `POST /api/clinical-alerts/:id/actions`
- `POST /api/patients/:id/clinical-tasks`
- `POST /api/clinical-tasks/:id/events`
- `GET /api/clinical/pathways`
- `POST /api/patients/:id/pathways/:key/start`
- `GET /api/pathway-sessions/:id`
- `POST /api/pathway-sessions/:id/responses`

The same clinical/reviewer read and clinician write permissions used by the care API protect these routes.

## Database migration

Migration `004-clinical-foundation` is additive. It creates:

- `clinical.terminology_concept`
- `clinical.unit_definition`
- `clinical.field_package`
- `clinical.fact`
- `clinical.current_preference`
- `clinical.event`
- `decision_support.evidence_source`
- `decision_support.rule_definition`
- `decision_support.recommendation`
- `decision_support.alert`
- `decision_support.alert_action`
- `decision_support.pathway_definition`
- `decision_support.pathway_session`
- `decision_support.pathway_response`
- `decision_support.recalculation_run`
- `workflow.clinical_task`
- `workflow.clinical_task_event`

All clinical history, definitions, evidence, recommendations, alert actions, task events and pathway activity are protected by append-only triggers. The migration does not modify or delete existing patient, care, registry, CAD, audit or export tables.

The hosted migration must be run before deploying code that writes clinical facts:

```bash
npm run db:migrate
```

## Controlled implementation roadmap

The second master specification defines the authoritative order:

0. **Architecture audit** — completed in this document.
1. **Clinical foundation** — implemented and validated at the infrastructure level; clinical governance remains required before activating medical rules.
2. **Medication and laboratory intelligence** — medication library, dosing, monitoring, interactions, renal logic and titration.
3. **Heart Failure** — first complete smart disease module and proof of the foundation.
4. **Echo and valvular heart disease** — structured studies, trends, valve surveillance and intervention assessment.
5. **CAD / ACS / PCI** — acute and chronic coronary workflows, secondary prevention, DAPT and registry integration.
6. **AF / arrhythmia / ablation** — AF-CARE, stroke/rhythm strategy, ablation assessment and follow-up.
7. **Devices** — pacemaker, ICD, CRT, interrogation, complications and follow-up.
8. **Cardiometabolic / CKD / GLP-1** — renal, metabolic, weight and medication-specific outcome evidence.
9. **Perioperative cardiology** — only after it can consume the prior structured modules.
10. **Unified clinical plan** — reconcile cross-disease recommendations by safety and urgency.
11. **Smart documentation** — clinician-reviewed drafts based on structured data.
12. **Registry automation** — map mature clinical data into CAD/HF/EP/structural registries.
13. **Analytics / quality** — treatment gaps, follow-up, outcomes and service metrics.
14. **AI assistant** — last, grounded only in structured facts and versioned evidence.

Stage 2 must not start until the foundation is clinically governed and its state-selection behavior is reviewed against representative source conflicts.

## Remaining technical debt and limitations

- The patient master table still lacks civil ID, nationality, contact, consultant/team, height, weight, allergy and smoking fields. These need an identity/governance design before addition.
- The hosted app uses one fixed pilot site. This is not organization isolation or production tenancy.
- Existing registry packages use their original condition model. They are retained and need a later adapter to the shared field language.
- Existing RCRI/apixaban previews and documentation reminders remain compatibility code. They should migrate to approved rule packages in the appropriate later stage.
- Clinical fact projection currently creates one primary concept per care entry. Rich multi-observation studies such as Echo require Stage 4 child measurements and methodology/quality metadata.
- Current preference is event-sourced, but no clinician-facing preference selector is exposed yet.
- The patient Summary does not yet consume the new state endpoint. This avoids presenting unreviewed foundation output as clinical advice.
- There is no background worker. Recalculation is synchronous and transactional, appropriate for the pilot volume but not final scale.
- Institutional maker-checker publication, signing and rollback controls for rule/pathway packages remain to be built.
- No active clinical rule has received local clinical approval.

## Ready for Stage 2

The software foundation can now accept a governed medication/lab catalog and inactive rule packages, resolve current inputs with provenance, re-run rules after data changes, expire outdated recommendations, create explainable alerts/tasks and retain all history. Stage 2 is ready to begin only after clinical governance chooses the first medication/lab sources, unit policies, validation cases and activation workflow.
