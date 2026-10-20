# Clinical integration audit — 20 October 2026

This audit used the current application code and synthetic records only. It checked all 143 rule definitions and opened all 66 pathway contexts against 25 sample patients. A differential simulation entered 17 types of results for each patient (425 entries), comparing the app's input-specific reassessment with a full reassessment after every entry. The final run found no difference. Eight focused patient-journey tests cover the clinically consequential failures found during the audit.

Repeat the synthetic checks with `node --import tsx scripts/audit-integrations.ts` and `node --import tsx scripts/audit-reassessment.ts`.

## Findings corrected

| Journey | Before | After |
| --- | --- | --- |
| HFrEF treatment and new moderate/severe congestion | A beta-blocker or other HF uptitration offer could stay visible | The congestion entry withdraws the uptitration offer; it returns when congestion clears |
| AF stroke prevention and new weight/creatinine | The suggested apixaban dose could stay stale; missing dose inputs opened a prefilled 5 mg start | New values recalculate the label-dose suggestion; missing values open AF-CARE for a clinician decision and data collection |
| AF on warfarin | “Plan DOAC switch” opened a direct apixaban start | AF-CARE handles the switch, including INR timing and drug choice |
| PCI antithrombotic planning and new anaemia/renal/platelet results | The high-bleeding-risk description could remain stale | ARC-HBR inputs refresh the plan card and its suggested duration |
| Iron deficiency and a newly started oral iron preparation | The alert kept telling the clinician to start replacement | It switches to review of cause and treatment response |
| HCM obstruction after mavacamten entry | The LVOTO card kept pre-mavacamten advice | It shows the specialist titration context |
| Congestion, INR, bleeding and other safety cards | Context values such as creatinine, haemoglobin, platelets or INR could remain stale | The cards refresh when those values are entered |

The remaining changes align declared rule inputs with facts already read by 18 rules. They add no new clinical threshold and make no automatic medicine change. A ruleset revision refreshes existing production recommendations after deployment.

A second synthetic pass compared 247 medication, correction, echo, ABPM, PCI, admission, discharge and procedure events against full reassessment. An HF congestion alert could persist during admission and fail to return on discharge because its rule did not declare care contexts as an input. Adding that input resolved both differences. TAVI, renal denervation, AF ablation, LAA closure and pericardial drainage records each opened the expected follow-up pathway. Repeat this pass with `node --import tsx scripts/audit-journeys-round2.ts`.

## Verification and limits

The form-opening check validates context construction and option availability, not every choice or completed outcome in each of the 66 forms. The differential simulations sample result, medication, study, procedure, correction and admission events, but cannot cover every combination. Existing repository tests cover those paths more broadly. No real patient record was used or changed. This audit did not re-review all guideline citations or visually test the hosted interface.

The next integration pass should complete full pathway decisions and verify dated plan actions through result review, then test mobile clinician task time. Manual DOAC entry deserves a separate pre-start data-completeness review: the AF recommendation now uses AF-CARE when dose inputs are missing, while manual prescribing remains a clinician action.
