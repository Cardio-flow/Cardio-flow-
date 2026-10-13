# Round 5 defect repairs — 13 October 2026

All six reported defect groups have repairs. Verification used local synthetic patients on the existing repair branch; production records and deployment were unchanged.

| Finding | Repaired behavior |
| --- | --- |
| Confirmed assessment draft replaced newer BP | Confirmed and untouched fields resolve from the current record. Genuine pending edits retain observation references; changed readings require review. Confirmation checks the draft version and readings under the patient lock, records only changed values and resets the draft atomically. |
| Reversing an MRA reduction suppressed potassium review | Dose/frequency corrections that restore increased or uncertain exposure reopen the existing potassium review. Reductions remain quiet; episodes and dated actions are not duplicated. |
| Erasing text restored an obsolete queued value | Autosave writes the latest form intent, including empty fields. Concurrent autosave and Close share one flush; an in-flight obsolete save is followed by the clear without a duplicate stale-version request. |
| Conflicting drafts blocked recovery and Close | One compact warning offers Use saved draft / Use latest readings, Keep my edits and Close without saving. Replacement requires an explicit choice; changed readings cannot be confirmed silently. |
| Near-midnight correction changed the selected date | Medication corrections preserve the Kuwait calendar day and original clock, including milliseconds. Empty or partially typed dates cannot submit. |
| Corrected medication stop lost cancellation provenance | Undo follows immutable correction lineage and restores only its own cancellations still at their recorded task versions. Independently cancelled or subsequently edited tasks stay unchanged. |

## Verification

- `npm test`: **385 passed, 0 failed**; includes 10 new Round 5 regression tests. Focused Round 3–5 checks: 33 passed.
- `npm run build`: passed, including TypeScript.
- `node scripts/round5-flow-check.mjs <output-directory>`: **12/12 browser journeys passed**, including all nine original failing journeys plus in-flight clear/Close and both explicit recovery choices after new readings.
- `node scripts/round4-flow-check.mjs <output-directory>`: **11/11 browser journeys passed**.
- Existing `scripts/flow-integrity-check.mjs`: all checks passed.
- Round 5 API audit replay: **17/17 scenarios passed**, no defects or harness errors. Covers medication correction, lab pathways, resistance/RDN eligibility and bicuspid TAVI safeguards.
- Final screenshots reviewed for refreshed BP, admission/assessment draft recovery and changed-reading review at a 390 px mobile viewport. Controls fit and duplicate warnings are absent.
- `git diff --check`: clean. Round 5 browser checks are included in CI.

Durable local evidence is in `/workspace/cardioflow-round5-fixes-2026-10-13`: `tests.log`, `build.log`, `verified-browser/ui-results.json` and screenshots, `round4-browser/ui-results.json`, `integrity.log`, `api-results.json`, and `verification.json`. The API replay uses `api-cases.mjs` in that evidence directory; it is an audit harness, not an application module.

## Scope and limits

No new tables, migrations, clinical thresholds, doses or automatic prescriptions were added. Genuine pending measurements from a prior clinical day require review. Confirmed historical measurements are not copied forward as today's measurements. Older medication stops recorded before cancellation provenance was introduced cannot safely restore unknown task cancellations; those remain for manual review. Verification is local and synthetic and does not establish that this branch has been deployed.
