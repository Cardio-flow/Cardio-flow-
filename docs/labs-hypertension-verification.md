# Expanded labs and hypertension activation — 13 October 2026

Lab entry now has **TFT** (TSH, FT4, FT3) and **Bone profile** (total calcium, reported adjusted calcium, albumin, phosphate/phosphorus, ALP) presets. Urate/uric acid and phosphorus are searchable under Any test. Phosphate and phosphorus share one measurement code. New results use the existing dated observations, corrections, series and lab displays.

New analytes use SI units: FT4/FT3 pmol/L, calcium/phosphate mmol/L, albumin g/L and urate µmol/L. New reference ranges and conversions are not assumed. Reported assay upper limits use the existing lab-limit entry. Adjusted calcium is entered from the report rather than derived from an invented formula.

Hypertension status is selectable during registration and directly in the compact risk-factor editor. Registration asks for a status when hypertension is selected. Existing records/API clients without a status remain supported and are not classified as newly diagnosed solely because they were recorded today.

| Recorded situation | Automatic hypertension offers |
| --- | --- |
| Newly diagnosed | Existing confirmation/target/treatment assessment and secondary screening, without a duplicate BP-target alert |
| Established/unspecified, non-resistant | BP target only; the target remains displayed when BP is controlled |
| Apparent resistance | Resistance verification and secondary screening; RDN still requires its existing confirmed criteria |
| Validated white-coat phenotype in established disease | BP-target review of the white-coat effect, with no routine resistance/screening offer or automatic escalation |
| Known positive screening result or acute severe BP | Dedicated existing clinical review |

The manual pathway catalogue remains available. Changes to status resolve obsolete offers without removing recorded care. Confirming a genuinely new hypertension diagnosis records the clinical status and starts screening without immediately reopening the completed initial BP assessment. The existing audited review stores a key for the BP/regimen/risk facts separately from its hypertension-condition output.

Routine goals include both 120–129 systolic and 70–79 diastolic if tolerated. The existing ESC individualization criteria and recorded individualized choice are respected. Goal displays require measurements from the same collection time to show a complete BP pair or declare the goal met; separate readings retain their own facts. Age ≥85, advanced CKD or an individualized clinician choice display an individualized target rather than implying a fixed numerical treatment goal.

## Verification

- `npm test`: **413 passed, 0 failed**, including eight added regression tests. Covers established/unknown/new diagnosis, status transitions, confirmation without repeat assessment, resistant/white-coat gating, incomplete BP, known abnormal results, acute BP, new lab units/limits, isolated diastolic elevation, individualization and separate measurement times.
- Focused hypertension, guideline and existing lab-result flow suite before the final BP-goal cases: **36 passed, 0 failed**.
- `npm run build`: passed, including TypeScript.
- `scripts/labs-hypertension-check.mjs`: **8/8 mobile journeys passed**, without page errors or horizontal overflow. Covers TFT and bone presets, urate/phosphorus search, ordinary/new/resistant/white-coat activation, status correction, registration and both BP-target display cases. Included in CI.
- Final screenshots inspected for TFT entry, the compact hypertension-status control, diastolic BP goals and individualized targets. React review covered event-driven state, typed status options, accessible radio groups and shared server-side classification.
- Existing `scripts/hypertension-admin-check.mjs`: passed through criteria-triggered RDN, procedure recording, aftercare, mobile layout and unchanged medicines.

Evidence is in `/workspace/cardioflow-labs-hypertension-2026-10-13`: `tests-final.log`, `focused.log`, `build-final.log`, `browser-final.log`, `browser-final/browser-results.json`, screenshots and `rdn-browser.log`. Verification uses local synthetic patients; production deployment is separate. Guideline source details remain in `docs/hypertension-guideline-matrix.md`. New lab results and pathway offers do not prescribe or book care without clinician confirmation.
