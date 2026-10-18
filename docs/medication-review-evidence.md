# Integrated medication review

18 October 2026. The Medications screen and overview link use existing active recommendations, medication events and dated plans. The review groups safety/dose findings, list completeness and monitoring, prioritizes the same severity order, and opens the original clinical action. Existing declined findings remain declined; the projection does not independently reissue them. No new tables or mandatory per-visit reconciliation.

## Evidence

- HFA/ESC polypharmacy consensus 2025: Stolfo et al., PMID [40091554](https://pubmed.ncbi.nlm.nih.gov/40091554/), DOI [10.1002/ejhf.3642](https://doi.org/10.1002/ejhf.3642), [PMC12103960](https://pmc.ncbi.nlm.nih.gov/articles/PMC12103960/). Rights-eligible full text retrieved (40,584 characters, not truncated). Supports appropriateness review, ingredient reconciliation, adherence support, interactions and treatment prioritization. Drug count alone never creates a deprescribing recommendation. The publication is a consensus statement, not a new ESC clinical-practice guideline.
- [Ibuprofen SmPC](https://www.medicines.org.uk/emc/product/14695/smpc), sections 4.4/4.5, retrieved 18 October 2026: cautions on bleeding with anticoagulants and antiplatelets; one combined finding covers the recorded current antithrombotics. No new numerical threshold.
- Current [Eliquis EU/UK SmPC](https://www.medicines.org.uk/emc/product/2878/smpc), sections 4.4/4.5, retrieved 18 October 2026: NSAIDs increase bleeding risk and warrant caution. New safety-table row places the NSAID first for review, with no automatic anticoagulant withdrawal or dose change. It does not label this combination contraindicated or require stopping necessary antiplatelet therapy after PCI.
- Corroborating U.S. label: [DailyMed E.R. Squibb Eliquis](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e9481622-7cc6-418a-acb6-c5450daae9b0), set ID e9481622-7cc6-418a-acb6-c5450daae9b0, version 30, effective 17 April 2025; sections 5.1, 5.2 and 7.3 retrieved untruncated. Bleeding interaction corroboration only. U.S. dose, valve and interaction policies do not replace the app's existing EU/UK dosing policy.
- PubMed discovery additionally identified the 2025 pharmacologic-pitfalls consensus (PMID 41382384, DOI 10.1002/ejhf.70087) and 2026 deprescribing guideline summary (PMID 41943558, DOI 10.5694/mja2.70174). Abstract metadata inspected; no new thresholds or drug-specific stopping protocols were encoded from these abstracts.
- Renal limits and monitoring intervals are reused from `med-safety.ts` and `shared/drug-monitoring.ts`, including EHRA 2021 Table 3 and cited product labels. No new renal thresholds, doses, treatment targets or surveillance intervals were invented.

## Behavior and boundaries

- Missing dose/frequency/route opens the audited correction flow. Adding route/frequency retains the event kind, previous start-date uncertainty and reconciliation provenance. Corrections do not become new starts.
- Ingredient overlap applies to active treatment. Held/not-taking/stopped medicines remain visibly distinct without being treated as concurrent exposure.
- CrCl-based label checks request missing verified creatinine/weight, using the safety table's existing freshness windows. The AF DOAC rule remains the sole owner of its missing-input request. Non-AF anticoagulant indications do not inherit an AF dose recommendation. eGFR does not substitute for Cockcroft–Gault.
- The renal display, missing-input checks and monitoring use verified final resolved values. Preliminary or stale values do not establish renal dose suitability. Existing safety warnings retain abnormal preliminary signals, so an unconfirmed high potassium cannot make a pre-start check reassuring. Current values and their dates are displayed rather than copied as today's measurements.
- Due medication-specific blood tests can be selected together and arranged as one panel with an explicit editable date. ECG/echo remain separate study tasks. Existing open equivalent appointments are exposed for review instead of duplicated. No initiation schedule is fabricated for an already-taking medicine with an unknown historical start.
- Missing TSH on amiodarone joins the monitoring decision. A booked TSH is tracked through the same appointment; an abnormal actual result still activates thyroid care.
- Joint panels require all requested verified results from the same actual collection; adding a later result to that collection is supported. Completion means results recorded and awaiting clinical review. Safety decisions remain active independently of a monitoring-plan confirmation.
- Safety finding signatures include the current regimen so a clinically reconsidered dose/frequency change is not hidden by an earlier dismissal of a different regimen.
- This remains catalogue- and recorded-data-based decision support, not a comprehensive commercial interaction database, OTC exposure history or automatic deprescribing service.

Synthetic clinical tests and a phone/desktop browser walkthrough are included in the change. Release verification reports only checks actually run.
