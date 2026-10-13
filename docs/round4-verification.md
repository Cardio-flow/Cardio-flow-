# Round 4 defect repairs — 13 October 2026

All eight reported issue groups have repairs. Verification used local synthetic records; no production clinical records were changed.

| Finding | Repaired behavior |
| --- | --- |
| Frequency increase bypassed safety | Daily exposure increases use the existing medication safety gate. Unknown comparisons require a documented regimen review; reductions remain available. |
| Later medication events reverted frequency | Continue, dose changes, hold and restart inherit the resolved current prescription. |
| Undoing a pathway hold suppressed potassium review | A correction restoring active treatment reopens potassium review while keeping the original decision, episode and urgent tasks. |
| Calculated eGFR failed task completion | Completion follows the actual blood-draw parent dependency and records both parent and calculated-result references. Requested eGFR is output only in data entry. |
| Large generated baseline blocked short edited notes | Edited notes and generated baselines share a 64,000-character technical limit. The >8,000-character fixture saves and finishes after a concise edit. |
| Discharge confirmed stale results or cancelled bookings | The reviewed record fingerprint is checked before confirmation and again under the patient lock. Changed facts/bookings require review, preserve entries and offer replacement follow-up dates. |
| Unconfirmed admission/assessment entry disappeared | Clinician-scoped, versioned server drafts restore on refresh. Pending saves warn on unload; confirmation alone writes clinical facts. |
| Undo stop reopened independent cancellations | Immutable cancellation provenance records exact task IDs and versions. Undo restores only unchanged cancellations made by that stop. |

## Checks run

- `npm test`: **375 passed, 0 failed** (10 new Round 4 regression tests).
- `npm run build`: passed, including TypeScript validation.
- `node scripts/round4-flow-check.mjs <output-directory>`: **11/11 browser journeys passed**, including the saved-discharge control. Added to CI.
- `node scripts/flow-integrity-check.mjs <output-directory>`: passed all existing clinical integrity browser checks.
- Final mobile screenshots inspected for treatment safety, note saving, refreshed discharge review and restored entries.

The browser fixtures for eGFR-only monitoring and independent medication-linked cancellation were prepared through valid API requests. The note capacity case creates 60 dated plan actions; it is a capacity test rather than a typical visit.

Medication stops recorded before this repair lack reliable task-cancellation provenance. Their cancelled tasks stay unchanged on undo and require manual review; the repair does not infer ownership from matching reason text or timestamps. Clinical history stays append-only. No clinical threshold, dose, automatic prescription or new clinical module was added.

The repairs are on a review branch; production deployment is a separate step.
