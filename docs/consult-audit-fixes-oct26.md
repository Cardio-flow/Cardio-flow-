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

27 October update: integrated production revision 3dbc812, preserving the new HF/lipid pathways and start safety checks. Extended the HF calculation fix into both gdmtPlan and the titration alert; full before/after regimens include frequency. Non-reference regimens need clarification. Added regression assertions that ramipril 5 mg BID produces no increase and carvedilol 25 mg OD is not labelled at target. Clarified the diabetes no-additional-step wording. Validation logs are under /workspace/cardio-fixes-oct26 with oct27 filenames.

Final 27 October verification: 746/746 full-suite tests passed (zero failures); 21 targeted HF/dose/Consult tests passed against the final dose logic; production build passed. Browser checks passed: 136 previews across 68 pathways, 13 representative drawers, Consult at 320/390/1440 pixels with complete medication preview and direct section access, and structural/TAVI/bicuspid/TEER context flows. Synthetic data only; no production patient changes. This fixes software consistency; it does not claim independent clinical validation of every possible branch.
