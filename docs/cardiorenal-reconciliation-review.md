# Cardiorenal review and medication reconciliation

A clinician-provided review identified that medicines entered together on a record-entry date were actually longstanding treatment. The changes below address the resulting decision-support and documentation problems. No real patient data is included in fixtures, screenshots or this document, and no production record was changed.

## Behavior

- Single and batch medicine entry offer **Start new** and **Already taking**. When the historical start date is unknown, reconciliation records an initial `continue` event with explicit provenance. The resolver retains the current dose, route and frequency, activates the medicine and leaves `startedAt` null. It does not fabricate a past date, announce a new treatment, or include it among treatment starts in copied documents. Journey and medication history identify the reconciliation.
- Reconciliation cannot book initiation schedules. Routine monitoring still uses verified actual results and the existing label intervals. Subsequent clinician-confirmed starts, restarts and increases retain their post-change checks. Medication warnings and clinician review requirements remain active. Existing records are not automatically reclassified; clinical correction remains audited and clinician-owned.
- Renal/K post-change monitoring requires both verified post-change results or a future paired booking. One result, a preliminary result or a potassium-only booking cannot silence the safeguard. The general monitoring rule also requires all requested tests when checking bookings and excludes preliminary/future lab evidence.
- The release retains the newer main-branch shared creatinine baseline and MRA-specific governed thresholds. Renal alerts, titration gates and pathway context use the same calculation. The alert presents a dated baseline and a cardiorenal review rather than automatically attributing deterioration to a drug or labelling an undated rise as AKI. The renal wizard remains clinician-confirmed.
- An isolated recorded kidney-injury marker prompts cardiorenal assessment, without asserting advanced HF or immediately offering a centre referral. Current renal deterioration owns the renal prompt. Other I-NEED-HELP markers still support advanced-HF consultation.
- Recorded CKD stage conflicting with current verified eGFR prompts review of chronicity and the diagnosis. It does not automatically replace the chronic stage. Single abnormal results may represent acute illness.
- DOAC checks expose missing verified creatinine/weight rather than silently treating an unevaluated dose as correct. Existing dose calculations use verified inputs, including Cockcroft–Gault renal assessment under the existing regional label conventions.
- Copied summaries include non-urgent recommendations separately from open safety issues. Blue optimization opportunities were previously omitted from the document even when present in the app.

Existing medication events, conditions, observations, rules, decisions and documents are reused. No tables or migrations are added. No drug is prescribed, changed or stopped automatically. Ruleset: `2026-10-13.cardiorenal-reconciliation2`.

## Source checks

- [KDIGO CKD 2024 full guideline](https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf): G3b is 30–44 mL/min/1.73m²; CKD requires chronicity for a minimum of three months. Do not assume chronicity from a single abnormal eGFR/ACR. The full PDF was retrieved and searched for classification/chronicity statements.
- [ESC HF 2026](https://pubmed.ncbi.nlm.nih.gov/42661420/): publication identity verified. Existing sourced I-NEED-HELP/advanced-HF recommendations are retained; a kidney-injury risk clue is not equivalent to a confirmed advanced-HF diagnosis. No new HF severity threshold was inferred from publication metadata.
- [ESC AF 2024](https://pubmed.ncbi.nlm.nih.gov/39210723/): guideline identity verified; existing ESC/EHRA dosing conventions are retained. US and European severe-renal dosing recommendations are not interchangeable.
- [Eliquis label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=41a133ef-e461-48ad-8221-b735bdd0ec25), section 2.1: usual AF dose 5 mg twice daily; 2.5 mg twice daily with at least two age/weight/creatinine criteria. The actual dosage section was retrieved, not only label metadata.
- [Aldactone label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=0fed2822-3a03-4b64-9857-c682fcd462bc), sections 2.2 and 5.1: renal impairment affects initiation strategy; potassium within one week of actual initiation/titration and regularly thereafter. Initial-dose guidance is not automatically applied as a stop/reduction order to longstanding stable therapy.
- [ADA/KDIGO diabetes–CKD consensus](https://pubmed.ncbi.nlm.nih.gov/36189689/): retrieved rights-permitted full text confirms metformin 1,000 mg/day at stable eGFR 30–44 and sick-day review during acute illness, and SGLT2 cardiorenal benefit independent of HbA1c. This is supporting guidance, not a newly introduced medication rule.

## Verification

`tests/cardiorenal-reconciliation.test.ts` covers ten synthetic cases: truthful current-list history/documents, routine monitoring, genuine later titration, paired final results, partial bookings, dated renal review without causal inference, CKD mismatch without automatic restaging, missing DOAC weight, isolated versus multiple advanced-HF markers, atomic API batches and non-urgent recommendations in copied summaries.

`scripts/cardiorenal-reconciliation-check.mjs` covers four mobile browser journeys: single reconciliation/history, existing batch entry, return to true-start entry, and automatic cardiorenal/CKD/DOAC findings. No page errors or horizontal overflow were observed. The CI workflow runs the script with the other synthetic walkthroughs. Detailed local evidence is outside the repository in `/workspace/cardioflow-cardiorenal-review-2026-10-13/`.

Clinical suggestions for an individual patient remain provisional until current symptoms, volume status, weight, the dated renal baseline and the complete app recommendations have been reviewed. The supplied clinical summary is not equivalent to access to the live patient chart.
