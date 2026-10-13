# Round 6 defect repairs — 13 October 2026

All seven reported defect groups have repairs. Verification used local synthetic patients on the existing PR #18 branch. Production records and deployment were unchanged.

| Finding | Repaired behavior |
| --- | --- |
| Changing one BP component broke the office pair | The displayed new pair requires checking both values when one component changes. The server records the submitted, confirmed pair with one timestamp. Untouched pairs are not duplicated; partial entries never copy a missing component from another reading. |
| Admission accepted an obsolete draft | Admission creation checks the clinician-scoped draft version under the patient lock in the same transaction. A stale or omitted version with a pending draft is refused, leaving that draft available for review. |
| An existing admission failed silently | A visible message at the top of the form offers View existing admission and disables a duplicate admission attempt. |
| Narrative edits disappeared before Note | Narrative and note use the shared serialized draft hook from the first editable visit step. Narrative saves before a generated note/evidence key exists, including immediate Close and clears during an in-flight request. Confirmation alone changes clinical narrative. |
| Clearing narrative removed its editor | The open editor stays mounted for empty text, so replacement is possible without losing the field. Add narrative makes an initially empty editor accessible. |
| A closed visit was reported as new readings | Typed error reasons identify closed/unavailable visits, preserve local edits, and offer View saved visit or Close without saving. The server continues to refuse clinical facts for the closed visit. |
| Note recovery was hidden at Assessment | One recovery warning is available at every visit step: load the newer note, deliberately keep edits, or close without overwriting. Loading/keeping at Note returns to review before finishing. A late conflict fetch cannot restore a warning already resolved by the clinician. |

## Verification

- `npm test`: **396 passed, 0 failed**, including 11 new Round 6 regression tests.
- Focused Round 4–6 tests: **31 passed, 0 failed**. The earlier admission fixture now supplies its reviewed draft version.
- `npm run build`: passed, including TypeScript.
- `node scripts/round6-flow-check.mjs <output-directory>`: **12/12 journeys passed**. Includes all ten audit scenarios, deliberate note retention at Assessment, and clearing narrative during an in-flight save and Close. The admission race also delays its conflict fetch until after the newer draft is loaded, confirming it cannot re-block recovery.
- Previous browser regressions: **Round 4 11/11 and Round 5 12/12 passed**. The two existing Round 5 one-component BP edits now perform the explicit paired-reading check before testing newer-reading conflicts.
- Existing `scripts/flow-integrity-check.mjs`: all checks passed.
- Round 6 API replay: **9/9 scenarios passed**, no defects or harness errors. The clinical tests additionally check refusal without paired confirmation, untouched/partial BP behavior, clinician-scoped admission drafts, and atomic rejection of duplicate measurement codes.
- Final mobile screenshots inspected for the BP check, visible existing-admission error, admission draft recovery, narrative restoration, closed-visit recovery and note conflict controls. The 390 px layout keeps controls accessible without duplicate conflict warnings.
- `git diff --check`: clean. Round 6 browser regressions are included in CI.

Durable local evidence is in `/workspace/cardioflow-round6-fixes-2026-10-13`: `tests.log`, `focused.log`, `build.log`, `final-browser/browser-results.json` and screenshots, `round4-browser/ui-results.json`, `round5-browser-final/ui-results.json`, `api-results.json`, `integrity.log`, `late-conflict.log`, and `verification.json`. The API replay is `api.mjs` in that evidence directory.

## Scope and limits

No new tables, migrations, clinical thresholds, doses, modules or automatic prescriptions were added. Existing admission clients must supply the reviewed draft version when a pending clinician draft exists; a missing version is accepted only without such a draft. BP values from unrelated readings remain unpaired. Narrative/measurement drafts are unconfirmed entries and do not trigger clinical decisions by themselves. The previous limitation for medication stops recorded before cancellation provenance remains documented in the Round 4/5 notes. These checks establish local synthetic behavior, not production deployment or full accessibility compliance.
