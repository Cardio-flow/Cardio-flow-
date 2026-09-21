# Clinical reference implementation status

This release supports synthetic workflow development. Source verification does not constitute clinical validation, local formulary approval, device certification, or authorization for live patient care. Guidance previews do not prescribe, order treatment, infer that an unrecorded condition is absent, or automatically change a care plan.

## RCRI original criteria — `rcri-1999.1`

Primary source: [Lee et al., Circulation 1999;100:1043–1049](https://pubmed.ncbi.nlm.nih.gov/10477528/), DOI 10.1161/01.CIR.100.10.1043. Verified 16 September 2026.

Six one-point criteria: high-risk surgery, history of ischaemic heart disease, history of heart failure, cerebrovascular disease, preoperative insulin treatment, and serum creatinine **greater than** 2.0 mg/dL. This implementation explicitly follows the original paper's strict `>` boundary, not later summary-table variants using `≥`. It returns a point count only; it does not attach a portable absolute event probability or provide surgical clearance.

The preview is restricted to the original study population context: age at least 50, elective major noncardiac surgery, expected postoperative stay at least two days. Cardiac surgery uses a separate documentation form with external STS/EuroSCORE review options; neither cardiac model is implemented. Procedure category, all five categorical inputs, creatinine/unit/current relevance and clinician confirmation must be explicit. Functional assessment and the rest of the perioperative evaluation remain clinical responsibilities.

## Apixaban adult NVAF label reference — `apixaban-nvaf-label-2025.1`

Primary source: [DailyMed ELIQUIS prescribing information, revision August 2025](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=7be1f4c1-bb2f-4ded-ae9a-515d2a22f93e), label page updated 11 September 2026; verified 16 September 2026. This is a US-label reference, not a statement of local Kuwait/European prescribing policy.

The standard adult NVAF label dose is 5 mg orally twice daily; the reduced dose is 2.5 mg twice daily when at least two characteristics apply: age ≥80 years, weight ≤60 kg, serum creatinine ≥1.5 mg/dL. This rule is not used for VTE or pediatric indications.

The limited preview additionally withholds output unless clinician-verified creatinine clearance is ≥30 mL/min and every safety/context check is explicitly reviewed: active bleeding/severe allergy; prosthetic valve/significant mitral stenosis/triple-positive APS; interacting P-gp/CYP3A4 drugs or concurrent antithrombotics requiring review; AKI/unstable renal function/dialysis; hepatic impairment/coagulopathy; pregnancy/breastfeeding; perioperative/neuraxial/interruption context. These are conservative preview exclusions, not assertions that all are label contraindications. No automatic renal estimate or complete interaction database is supplied. Full label and local pathway review remains required.

Creatinine conversion uses 88.4 µmol/L per mg/dL with floating-point normalization before boundary comparisons. Tests cover exact age/weight/creatinine thresholds, unknown inputs, indication mismatch, renal limitation and blocked safety contexts. Changes to patient-context inputs invalidate the confirmation; the reference is recomputed server-side and versioned alongside the record.

## Complications and reminders

The complication action lists are documentation choices for the treating team, not activated treatment protocols. The hyperkalaemia form links to [UK Kidney Association guidance](https://www.ukkidney.org/health-professionals/guidelines/treatment-acute-hyperkalaemia-adults-0) for review; it does not implement a potassium-threshold treatment/dosing algorithm. Other complication menus require local specialist review before conversion into recommendations.

Reminders use recorded workflow states and explicit findings, not invented physiological thresholds. The bleeding/antithrombotic reminder flags records for reconciliation and does not stop or reverse therapy. Medication records may not reflect actual administration. Broader medication dosing, contraindication/interaction screening, risk models, clinical pathways and alert escalation remain unfinished.
