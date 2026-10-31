# Pathway safety simulations — 31 October 2026, round 2

Base: deployed/main `fd20661`. All case creation and clinical writes were limited to local synthetic databases. This audit preserves the all-lab trend display.

## Reproduced defects

1. **HF:** Preliminary post-change potassium/creatinine could unlock an MRA increase while the monitoring workflow still correctly required verification. Preliminary-only results could also produce a start suggestion. Selecting an older pre-change creatinine did not immediately remove an already offered increase. The shared HF gate now uses verified selected inputs, checks their dates against the medication change, and declares creatinine as an input for reassessment.
2. **AF anticoagulation:** The dose checker compared milligrams without frequency. Examples included apixaban 5 mg once daily and rivaroxaban 20 mg twice daily. The recommendation, AF-CARE proposal and rhythm profile now compare the calculated dose plus the existing AF label frequency. Confirmation records the proposed schedule in the existing medication-event stream; it never silently changes treatment. Equivalent daily schedules such as Nightly are accepted. Unknown daily exposure needs reconciliation, and pregnancy safeguards remain effective.
3. **Lipids:** A preliminary-only LDL could drive escalation, and a preliminary pre-treatment result could establish a supposed failure of the ≥50% reduction goal. Both endpoints now require verified results; unit comparability is preserved. Missing verified LDL requests a result. The existing risk categories, targets, treatment ladder and thresholds are unchanged.

## Evidence and scope

- The initial 12 regression cases reproduced **10 failures**, with two positive controls passing before the fixes.
- Expanded focused coverage: 19 cases, including actual clinician confirmation, saved medication events, decision linkage, recurrence, equivalent daily schedules, pregnancy protection, incomplete regimens and verified LDL controls.
- Cross-event audit: **247 operations across 25 synthetic patients**, plus five procedure scenarios. Immediate and full reassessment matched, all expected procedure findings appeared, and no operations failed. Eight operations were appropriately skipped for patients with an existing admission.
- Catalogue navigation/preview check: **136 previews across 68 pathways and 13 representative drawers**, no browser errors. This does not exhaust every clinical branch.
- Dedicated browser workflow: exact apixaban frequency proposal, clinician confirmation, saved regimen and resolved alert; selecting pre-change creatinine immediately removes the MRA increase. Phone (390 px) and desktop (1440 px) checks passed with no horizontal overflow or page errors.
- Existing medication-review and AF-care browser walkthroughs passed, including medication corrections, safety findings, linked ablation/LAA closure aftercare and repeat imaging.
- Production build (`npm run build`) passed. The static integration audit found no reported problems across 144 rules and 68 pathways.
- Sources retained: existing ESC HF practical guidance and result-verification rules; ESC AF 2024/EHRA and EU SmPC §4.2 maintenance schedules (apixaban/dabigatran BID, rivaroxaban/edoxaban OD); existing ESC/EAS LDL targets and baseline reduction rule.

- Full unit/integration suite: **811 tests passed, zero failures, cancellations or skips** (`npm test`).

No new clinical thresholds or drug doses were introduced. Non-AF anticoagulant indications and specialist prescribing protocols remain outside this frequency-correction decision. Passing software scenarios do not constitute independent clinical validation of every pathway or medication combination. Production deployment is unchanged by this audit.
