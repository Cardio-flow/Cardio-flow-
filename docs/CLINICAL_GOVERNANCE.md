# CardioFlow Stage 1.5 clinical governance

Date: 22 September 2026

This stage extends the Stage 1 clinical foundation with evidence control and a server-enforced rule publication process. It does not add or publish disease, medication, dosing, monitoring, device, procedural, AF, valve, CKD, GLP-1 or perioperative rules.

## Architecture changes

The clinical runtime now reads only rule versions whose latest site-scoped lifecycle event is `PUBLISHED`. A rule author creates an immutable version, submits it for review, and a different identity completes the clinical checklist. A separately authorized technical administrator records the automated test result. A clinical reviewer may publish only after an independent approval, a latest passing test run, and current verified approved evidence.

Published recommendations retain:

- the exact rule key and version;
- an immutable rule snapshot;
- the publication event and reviewer history;
- the evidence metadata/version snapshot;
- the clinical fact IDs used;
- missing information and the engine explanation;
- validity, triggering event and supersession links.

Superseding a published rule preserves its historical definition and recommendations, flags active recommendations for reassessment, and recalculates current pilot-site patients. Evidence status changes also append reassessment records and trigger recalculation without rewriting clinical notes.

## Evidence-source model

Evidence versions are immutable. Append-only status events represent `current`, `superseded`, `withdrawn` and `under_review`. Each source supports organization, topic, kind, publication year/date, version, authoritative URL or DOI, verification date, next review date and notes. A review-event queue supports manual flagging and resolution. Guideline preference and hospital policy are separate site-scoped structures so formulary or service availability does not rewrite scientific evidence.

The catalogue contains metadata and links only. It does not reproduce guideline tables or long copyrighted text. The seed catalogue contains:

- 2026 ESC heart failure;
- 2025 ESC/EACTS valvular heart disease;
- 2024 ESC atrial fibrillation;
- 2022 ESC non-cardiac surgery;
- KDIGO 2024 CKD;
- ADA Standards of Care in Diabetes—2026.

These records are reference metadata. They do not activate clinical logic and must be re-verified before a clinical rule is published.

## Rule publication workflow

```text
DRAFT → CLINICAL_REVIEW → APPROVED → PUBLISHED
              │                │
              ├→ REJECTED      └→ SUSPENDED → SUPERSEDED / RETIRED
              └→ CHANGES_REQUESTED
```

Rules carry domain, subdomain, explicit rule type, population, trigger and required data, exclusions, contraindications, cautions, urgency, recommendation category, follow-up implications, evidence grading fields, author, previous version, changelog, review date and evidence links.

Clinical approval requires confirmation of logic, population, thresholds/timing, exclusions/contraindications, evidence, monitoring/follow-up and automated tests. A rule author cannot review or publish their own version. A passing result cannot be supplied in the draft: it must be appended through the technical-admin test-run boundary.

## Permissions

Governance uses site-scoped append-only capability events independent of application roles:

- `clinical_rule_maker` creates versions and submits them;
- `clinical_rule_reviewer` approves, rejects, requests changes, publishes, suspends, supersedes or retires;
- `technical_admin` records controlled test runs and does not gain clinical approval rights.

Ordinary clinicians have no evidence or rule-governance access. During the pilot, existing reviewer memberships receive maker and reviewer capabilities, but the identity-level maker/checker rule still prevents self-approval. Technical-admin capability is provisioned separately.

## Current-value override

When verified values compete, the patient Summary exposes every candidate with source, observation date and quality. A clinician can select one value for current decision support with a reason. The original values remain immutable. The preference event stores the selected fact, competing fact IDs, clinician and timestamp. Releasing the override restores automatic resolution and immediately recalculates recommendations.

## Patient master additions

The shared patient record adds only reusable attributes needed by later stages: Civil ID/file identifier, phone, height, weight, derived BMI/BSA, allergies, smoking status, reproductive status when relevant, primary team and major comorbidities. Existing identity, care and registry data remain unchanged.

## Additive migration

Migration `005-clinical-governance` adds:

- `governance.capability_event`;
- evidence status and review events;
- rule metadata, rule/evidence links, lifecycle events and clinical reviews;
- immutable technical test runs;
- site guideline preferences and local policies;
- recommendation publication/review snapshots, reassessment records and clinician actions;
- competing fact IDs for current-value preferences;
- the limited patient-master attributes;
- current-state views with deterministic append sequence ordering.

No table or historical record is dropped. Existing Stage 0/1 clinical facts, care entries, registry data, audit history, authentication and recommendations are preserved.

## Verification

The automated suite covers:

- draft, review, approval and publication;
- rejection and invalid lifecycle transitions;
- maker self-approval and unauthorized test/publication attempts;
- complete reviewer checklist enforcement;
- failed and passing technical test runs;
- unpublished-rule execution blocking;
- published-rule execution and pilot-site isolation;
- immutable review/rule history;
- superseding a published version and recommendation reassessment;
- evidence replacement verification, superseding and event-driven recalculation;
- recommendation facts, evidence, rule and review traceability;
- clinician current-value selection, competing values and release;
- all prior API, care, registry, auth and clinical-foundation regressions.

## Remaining limitations and debt

- The runtime remains scoped to the single `demo-kuwait` pilot site. Fixed-site checks are tested but are not a complete multi-tenant authorization design.
- Evidence review is manual; there is no internet monitoring or automatic guideline ingestion.
- The technical-admin API records CI/test-run evidence but does not execute arbitrary rule tests on the server. Stage 2 needs a controlled fixture compiler and CI publisher around this boundary.
- Capability provisioning has no staff-administration UI yet.
- Local policy structures are ready, but actual formulary, laboratory, referral and service data have not been configured.
- Patient recommendation traceability is available through the API; a focused clinician-facing “Why?” drawer remains a Stage 2 UX task.
- No real clinical rule has been published. Fixture rules exist only inside isolated automated test databases.

## Stage 2 gate

The architecture is ready to begin authoring clinically reviewed medication and monitoring rules. Each rule must still have current verified source metadata, independently reviewed logic, representative boundary/missing-data/conflict fixtures, a passing controlled test run, and an explicit publication decision. Architectural readiness does not constitute clinical approval of any rule.
