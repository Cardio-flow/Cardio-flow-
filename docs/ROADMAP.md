# Delivery roadmap

## Authoritative September 2026 sequence

The two master specifications supplied on 22 September 2026 supersede the older sequence below. Their controlled Stage 0–14 roadmap and the implemented Stage 0/1 architecture are recorded in [CLINICAL_FOUNDATION_AUDIT.md](CLINICAL_FOUNDATION_AUDIT.md). Stage 1.5 evidence control and maker-checker publication are implemented and documented in [CLINICAL_GOVERNANCE.md](CLINICAL_GOVERNANCE.md). Stage 2 disease-independent medication/lab work is next; no disease-specific module has begun.

## Product baseline restored — continuous care, then complete specialty workflows

The later **Final Codex Plan** takes precedence over the earlier CAD-only interpretation below. See [MASTERPLAN.md](MASTERPLAN.md). The complete release includes HF, CAD, EP, Structural Heart and no-code custom registries. Their staged implementation is not a reduction of scope.

Release 0.2 adds the six-tab patient workspace, independent Admission/OPD encounters, continuing care records, ownership and review dates, discharge handover, immutable care history, optional CAD enrollment and a printable patient report. Source backups and their 2,252-field inventory are recovered; specialist parity is not complete. See [PROGRESS.md](PROGRESS.md) for the exact next gate.

## Earlier CAD slice — retained scope details

This repository implements a useful engineering preview, not the whole first clinical release described in the source blueprint. The source documents are the Cardio Flow Implementation Blueprint v0.2 and Canonical Field Mapping workbook dated 5 September 2026. The workbook's full field catalog has **not** yet been implemented or clinically reconciled.

### Completed in this iteration

- A usable responsive workspace with actual server persistence.
- Shared synthetic identity, one CAD enrollment per patient, repeatable episodes, relational lesions and stents.
- A fixed CAD form with server-validated fields and a frozen demo form version.
- Draft → final → reviewed workflow, final snapshots, transactional audit writes, optimistic update checks.
- Index-admission-anchored calendar follow-ups with retained contact encounters and explicit satisfaction.
- Role boundary demonstration, same-origin request checks, HTTP-only sessions, and CSRF tokens.
- A limited episode dataset, codebook, export purpose, reproducible stored CSV, checksum, and audit.
- Desktop/mobile browser tests, domain/API tests, reproducible locked dependencies, and CI checks.

### Hosted engineering pilot

- Vercel Express deployment with static frontend, shared Neon PostgreSQL, and an initial migration ledger.
- Neon Auth sign-in with email verification, approved memberships, immutable account binding, server-derived roles, and immediate membership revocation.
- Local demo-role access is disabled on the hosted server.
- Trusted production domain and initial verified/approved clinician membership are active.

### P0: before a clinical pilot

1. Complete institutional identity review, MFA enrollment/recovery, lockouts, invitation and account lifecycle, and session idle/absolute policies. Hosted Neon identity and approved memberships are implemented; demo roles remain local only.
2. Move to institution-approved PostgreSQL with ordered migrations, least-privilege application/audit database roles, scoped organizations/sites/teams, scope-aware queries and database defense in depth. The current one-site demo is not a tenant isolation implementation.
3. Implement sensitive identifier protection, contact access and masking, consent/lawful-basis records, duplicate review, reversible merge, and patient-level termination status. Current synthetic MRN checks are not an identity management policy.
4. Establish encrypted transport/storage, private attachments, backup/restore verification, audit retention, protected logs, deployment secrets, and operational monitoring.
5. Obtain named clinical approval of CAD value sets, completeness rules, follow-up windows, required datasets, end states, export variables, and all licensed content. No demonstration metadata is a clinical sign-off.

### P1: complete the CAD release contract

- A versioned form engine driven by the approved mapping catalog. This release's form is explicitly coded; the registry library is read-only.
- Immutable registry version packages with stable field keys, maker-checker publication, dependency/cycle/license checks, site activation, and governed local extensions.
- A full shared encounter timeline, observations, diagnostics, medication reconciliation, procedures, complications, outcomes, attachments, and provenance.
- CAD vessel findings, physiology/imaging, balloon-only PCI details, additional timing/medication fields, adjudicated outcomes, and full approved follow-up assessments.
- Structured queries, amendment drafts with reason and supersession, reviewed amendments, soft deletion, controlled restore, and concurrency conflict comparison. Final records are currently locked with no amendment route.
- Durable follow-up jobs, approved termination/waiver rules, task assignment, idempotent contact submission, protocol transitions, and multi-module task satisfaction.
- CSV/XLSX import staging, explicit identity matching, immutable source batches, reconciliation, and governed migration from legacy registries.
- Long-table lesion/stent/follow-up exports, labeled and coded XLSX datasets, date/cohort filters, export authorization workflows, expiry and download audit. Current exports contain only episode rows and codebook CSV.
- Deep-link routing, dirty-form navigation protection, paginated search/audit queries, accessibility contrast/focus audit, and performance checks at clinical registry scale.

### Subsequent implementation stages within the complete release

Add HF, EP, and Structural Heart screens to the same shared core. Their library cards currently communicate planned scope only. Clinical advisories, calculators, scores, and questionnaires stay disabled until independently approved and validated.

### Known engineering limits

- PGlite provides local relational development persistence but is not the blueprint's managed multi-user PostgreSQL service.
- Local schema initialization is idempotent. Hosted PostgreSQL has a checksum-checked initial migration ledger; future schema changes need ordered forward migrations.
- Only CAD demo v1 can be active. Multi-version registry transitions and site customization are pending.
- API permission checks use a fixed demonstration site; the same demo role has the same actor across sessions. This cannot establish real person attribution.
- Database triggers protect ordinary UPDATE/DELETE operations; the process owns its embedded database and can alter schema. Production append-only enforcement needs distinct database roles and protected operational access.
- The UI requires explicit Save draft. Unsaved changes can be lost on navigation. There is no offline/resumable draft synchronization.
- Follow-up contact windows and required data are illustrative. An out-of-window death closes open tasks and retains the encounter; it does not adjudicate historical endpoint timing.
- All seeded content is fictional. Dashboard counts describe the sandbox population and are not validated clinical performance metrics.

The original blueprint's 15-step registry-builder acceptance path remains open until P0 and the governed configuration engine are implemented.
