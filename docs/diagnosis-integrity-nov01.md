# Diagnosis integrity — 1 November 2026

The baseline synthetic audit reproduced concurrent active HFrEF/HFpEF, diabetes types and CKD stages, and an identical dated STEMI appearing twice. The first 14 regression cases produced 12 failures and two positive controls before fixes.

## Changes

- All shared diagnosis writes check exclusive phenotype/type/stage groups under a patient row lock. Imports reject conflicts before creating a patient. Updates, changes and reactivation/restoration use the same checks. A valid explicit change resolves/corrects the old diagnosis and keeps its versions.
- An exact repeat of a known full-date MI/PCI/valve diagnosis is idempotent. Array ordering does not change structured identity. Different dates, findings, vessels, valve positions or narrative details stay separate. A shared year or missing event date is insufficient to merge historical events.
- Compact header, risk-factor, coronary-event and summary-document projections collapse exact legacy duplicates. The original diagnoses remain available for correction. Separate condition-only PCIs now all appear in coronary history instead of only the first.
- Existing HF/type/stage conflicts get an actionable reconciliation recommendation. Routine HF treatment suggestions and HF/diabetes treatment confirmation cannot bypass a relevant conflicting diagnosis. No phenotype is chosen automatically.
- The picker disables adding a sibling type/stage and points to changing the existing diagnosis.

## Verification

- 17 focused synthetic regression cases pass, including legacy rows deliberately inserted to test safeguards against data written before the fix.
- Production and hosted builds pass (`npm run build`, `npm run build:hosted`).
- Dedicated compiled browser workflow passed at 390 px and 1440 px: a legacy STEMI displays once, all source diagnoses remain editable, removing the erroneous HF diagnosis clears the reconciliation alert, the sibling picker is disabled and direct API submission returns 409. No browser errors or horizontal overflow.
- Static integration audit: 145 rules, 68 pathways, no reported problems.
- Full unit/integration suite: **828 tests passed; no failures, skips or cancellations** (`npm test`).

This release also includes the pending pathway safety changes documented in `pathway-safety-round2.md`. No schema migration or production patient-record rewrite is involved. Existing clinical conflicts require clinician reconciliation; duplicate source records are retained for audit and correction.
