# Repeat simulation audit — 31 October 2026

Base: main `861cf6b` (PR #39, last verified deployment). This pass preserves that release and adds focused regression cases. All simulated patient writes use isolated local synthetic databases.

## Reproduced defects and corrections

| Scenario | Observed defect | Result after correction |
| --- | --- | --- |
| Creatinine 100 → selected 180 → latest 90 | Abnormal card showed 180 with the newest result's −50% comparison and previous 180 | Selected 180 compares with 100: +80%; latest 90 retains its separate −50% comparison |
| First potassium 5.8 selected over newer 4 | First measurement inherited a later measurement's trend | No earlier comparable result means no percentage |
| Preliminary potassium alone, or newer preliminary 6.8 after verified 4.2 | A lone preliminary result could enter the normal list; a newer preliminary result could disappear from the overview | Preliminary values have explicit verification notices; verified current value remains distinct |
| HF, TSAT 10%, ferritin absent or 400 | Display asserted iron deficiency using TSAT alone, disagreeing with the treatment rule | Low TSAT stays visible with an iron-studies review; the existing combined HF definition controls the diagnostic wording |
| Iron deficiency, EF 55 → 40 → 55 | Incremental reassessment retained the previous iron recommendation | Both directions immediately select the correct existing iron review route |
| Severe secondary MR, EF 55 → 40 → 55 entered without a new study | Generic Heart Team route remained active after the HF optimization route should own the handoff | EF re-evaluates that route; measured valve facts also refresh their existing findings |
| ALT 40 → 80 | Non-timeline abnormal result omitted percentage/comparison date | Compact result row shows percentage, prior result/unit and date |
| Sparse overview; DBP only | Empty headings/vital placeholders, and isolated DBP hidden | Empty sections omitted; actual DBP displayed without an invented systolic reading |
| Repeated “Review”/“Missing aortic assessment” facts in pathway drawers | Duplicate React keys during catalogue walkthrough | Fact and assessment rows retain separate identities; browser check now catches duplicate-key console errors |

## Verification

- Initial focused reproduction: eight failures and one positive control. A separate secondary-MR reproduction also failed before its fix.
- Focused regression suite covers selected/latest comparisons, preliminary data, iron-status controls, visible percentages, sparse display, isolated DBP and both EF-dependent handoffs.
- Static audit covers 144 rules / 68 pathways. Extended helper inspection catches `cur()` and `hfPhenotype()` result dependencies.
- The original sweep passed 425 incremental-versus-full result-entry checks over 25 synthetic patients. An expanded sweep adds EF, pulse, BP, weight, height and glucose probes.
- Browser workflow creates a synthetic record, selects an older ALT, verifies the percentage and newer-value notice, enters changed EF, then withdraws the erroneous newer echo and checks the iron decision reverts. Layout checks use 320, 390 and 1440 pixels.
- Complete catalogue walkthrough requests 136 previews across 68 pathways and opens 13 representative drawers. This is navigation/preview coverage, not exhaustive clinical branch validation.

- Full regression suite: **792 passed, 0 failed** (`node --import tsx --test --test-concurrency=4 tests/*.test.ts`). All 12 new regression cases passed, including the secondary-MR handoff.
- Production build: **passed** (`npm run build`).
- Compiled-app browser checks: selected lab/iron workflow and 320/390/1440 layouts passed; the catalogue rerun passed **136 previews / 13 drawers**, including the new duplicate-key console guard. Existing Consult and four-section admission/discharge/visit walkthroughs also passed.
- Expanded sweep: **650 checks / 25 patients / 26 probes, no incremental-versus-full divergences**. The first parallel attempt was killed by workspace memory pressure; a fresh isolated rerun completed successfully.
- Public production homepage and `/api/health`: HTTP 200; health status `ok`, rule refresh `complete` on 31 October. Vercel deployment listing returned 403 and no CLI was available, so this pass could not independently confirm production commit metadata or inspect authenticated production flows.

## Boundaries

No new guidelines, numerical treatment thresholds, prescriptions or modules were introduced. Treatment changes still require clinician confirmation through the existing pathway engine. The TSAT correction aligns display wording with the existing cited ESC HF definition. The deployment was not changed during this audit. There was no authenticated production-patient browser session or real-patient mutation. Passing simulations establish the tested software behavior, not independent clinical validation of every pathway or drug combination.
