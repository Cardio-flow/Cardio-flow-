# Refinement audit and simulations — 29 October 2026

Audited deployed revision: 587ed69185567063a4dce1e86c35d8cbbdd66491. This preserves the latest coronary/ectasia and abnormal-result display changes. All write-path simulations used local synthetic records, not production patients.

## Reproduced findings and corrections

1. A cath with a vessel marked Not assessed could be summarised as No obstructive coronary disease and offered as grounds to resolve suspected IHD. The report now says Coronary anatomy incomplete and requests review. A fully documented negative report still offers diagnosis resolution. No extra investigation is automatically booked.
2. Potassium 6.2→5.5, sodium 120→128 and magnesium 0.4→0.6 were labelled harmful trends because the latest result remained abnormal. The story now checks movement farther outside the existing reference range. Improving results retain their abnormal-result status where applicable; they are not described as deterioration. Crossing to an abnormality on the opposite side (for example high to low potassium) remains a warning.
3. A clinician-selected creatinine of 100 after a baseline of 150 could be ignored in favour of a later 250 in the trend narrative. The story now uses the same selected verified endpoint as the decision engine, preserving other reports in history.
4. A newer completed clinic visit did not replace an older discharge as the comparison anchor. The story now uses the latest completed, non-historical visit or admission (a dated historical admission remains the fallback when there is no clinical encounter); an open admission is not described as a completed discharge.
5. Leaving against medical advice was treated as proof that CABG was declined, in both the coronary alert and diagnosis header. Refusal now requires the explicit recorded CABG outcome. The discharge fact remains visible and the unmet surgical review remains actionable.

These are interpretation/provenance corrections using existing clinical definitions. No new doses, medical thresholds, modules or database migrations.

## Evidence

Nine initial regression scenarios ran on the deployed source: seven failed, two passed. After corrections all passed; an additional explicit-refusal control preserves the appropriate CABG recommendation. The prior overview case was updated to explicitly record refusal rather than infer it from discharge disposition.

The new browser simulation enters an incomplete angiogram through the real API, checks the overview, then records complete nonobstructive anatomy and verifies automatic reassessment. It checks 320/390/1440 pixel layouts and is included in CI. Existing Consult and connected patient-flow walkthroughs are also run.

Final verification: **779 full-suite tests passed, zero failures** (Node runner with concurrency 4); the final focused story/overview suite passed 24 tests. Production build passed. Browser checks passed for 136 previews across 68 pathways, 13 representative drawers, the new incomplete-to-complete coronary report flow, Consult confirmation/access and the connected admission/discharge/follow-up flow. The new coronary flow checks 320/390/1440 pixel layouts. Thirteen dedicated refinement scenarios include positive controls and historical/open-encounter edge cases. The superseded initial full run exposed the historical-admission fallback regression and was stopped; the final run includes its correction. Live health returned OK and the existing deployed rules refresh completed; these source fixes are not deployed. Passing software checks does not establish independent clinical validation of every pathway branch.

Display refinement from the sparse-record phone simulation: omit the empty Latest results panel when there are no actual vitals, trend points or abnormal results; omit zero management counters and empty priority panels. The missing-information decision remains visible, and real abnormal results/trends retain their existing display.
