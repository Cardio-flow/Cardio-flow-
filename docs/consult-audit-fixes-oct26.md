# Consult audit corrections — 26 October 2026

This change addresses the eight findings reproduced against main `3d665aa`. It retains the Consult layout and shared pathway engine.

| Finding | Correction | Regression evidence |
|---|---|---|
| Different meanings of stable carried across pathways | Same-pathway carry only; newer concern blocks older reassurance | `screen-carry.test.ts`, `consult-audit.test.ts` |
| Confirm applied hidden medication changes | Full non-routine proposal, explicit routine count; compact cards open review before confirmation | `consult-audit.test.ts`, `consult-audit-check.mjs` |
| HF target percentages disagreed | Shared frequency-aware daily-dose reference; unknown stays unknown | `consult-audit.test.ts`, `overview-snapshots.test.ts` |
| Finerenone monitoring missing after confirmation | Shared catalogue monitoring added to preview and saved atomically; existing same-date checks reused | `consult-audit.test.ts` |
| Orange pathway displaced red safety finding | Severity remains the grouping priority; direct safety action precedes related pathway | `consult-audit.test.ts`, `consult-audit-check.mjs` |
| EF brief implied recovery from a limited study | Brief uses resolved EF; trend distinguishes latest report from decision value | `consult-audit.test.ts` |
| Incomplete or overdue chart claimed all on track | Neutral assessment wording; pending work without a problem card remains accessible | `consult-audit.test.ts` |
| Phone results buried beneath decisions | Results panel first on narrow screens, dated/unit-labelled trends and direct section access | `consult-audit-check.mjs`, `overview-snapshots-check.mjs` |

Clinical dose choices and monitoring intervals are reused from the existing catalogue and cited schedules; no new guideline thresholds or automatic prescribing were introduced. Medication and plan changes still require clinician confirmation and existing server checks. The new browser case runs only on localhost with synthetic data.

Validation results are recorded in the PR after the final build, full automated test run and browser walkthroughs complete.
