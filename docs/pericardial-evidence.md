# Pericardial disease — 19 October 2026

Primary reference: [2025 ESC myocarditis/pericarditis guideline, PMID 40878297](https://pubmed.ncbi.nlm.nih.gov/40878297/), [DOI 10.1093/eurheartj/ehaf192](https://doi.org/10.1093/eurheartj/ehaf192), and [official ESC recommendations](https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/myocarditis-and-pericarditis/). PubMed/ESC searches through 19 October 2026 found no superseding ESC pericardial guideline or correction. Publisher indexing and official recommendation-table extracts were available; direct publisher/ESC PDF downloads returned access errors. This implementation does not calculate drug doses or a patient-specific steroid taper.

Clinical boundaries encoded from the guideline:

- Definite clinical pericarditis requires compatible presentation and more than one supporting finding. Missing findings cannot establish it.
- Echo categories use <10, 10–20, >20 mm; a large effusion alone is not tamponade or an automatic drainage indication.
- Suspected tamponade needs urgent assessment; unstable tamponade must not wait for outpatient tests. Drainage assessment also covers symptomatic moderate/large effusions despite treatment and suspected bacterial/neoplastic causes; surgical assessment covers purulent or inaccessible effusions.
- Isolated non-inflammatory effusion does not trigger empirical anti-inflammatory drugs. High-risk pericarditis requires hospital assessment.
- Colchicine course and remission-guided withdrawal remain prescriber decisions. Anticoagulation does not itself select high-dose aspirin. Renal, hepatic, bleeding, pregnancy and interaction review precede drug suggestions.
- Refractory recurrence, corticosteroid/infection precautions and inflammatory versus persistent constriction lead to specialist strategies.

Workflow verification uses synthetic cases only. Imaging purpose/modality and fluid sample links are explicit. Pending/unsent fluid tests cannot close a result task. Actual results await clinical review; withdrawal of the report or source drainage reopens the task. Matching bookings are reused; distinct surveillance dates are preserved. New imaging, vital signs and relevant laboratory data reopen the decision. Reviewed advice creates no repeat task; aftercare uses one clinical follow-up. No medicines, diagnoses, admission or procedure are performed merely by an alert firing.
