# Admissions and pathway integration review

Reviewed 10 October 2026 using synthetic records. Inventory: 44 pathways and 119 rules. Inventory presence does not establish clinical completeness or validate every branch against a guideline.

## Admission discovery

Production previously exposed admissions through an Admit header action and a tab labelled Visits. On phones that tab could require sideways scrolling. While a clinic visit is open, the header shows Continue visit instead of Admit.

The proposed change labels the existing tab Admissions & visits and places it next to Overview. It exposes New admission, explains the open-visit state, and offers pathways, labs, medicines and plan entry on the active admission card. The route and clinical records remain the same. Starting a new admission from this UI still requires finishing the open clinic visit; an explicit clinic-to-hospital handoff is a future workflow.

## Integration tested

- Admission and clinic: a confirmed pathway retains the encounter ID and recommendation ID; changes the clinician-selected medication dose; creates dated tasks linked to the decision and encounter; appears in Journey and generated documentation.
- Follow-up: a recorded result completes task performance and enters the results-to-review queue.
- Corrections: the existing regression confirms undoing a medication stop restores its cancelled task. Its start-time fixture now stays in the past across Kuwait midnight.
- Joined decisions: failure of the second pathway rolls back the earlier decision and medication changes in the transaction.
- Browser: new admission → catalog pathway → confirmation → admission plan → discharge → discharge summary. The request carries both admission and alert IDs, and the summary contains the pathway medication change. Phone admission navigation has no horizontal page overflow.
- Existing clinic browser walkthrough: pathway, labs, clinical review, clinic assessment/note, medications and sign-out.
- Existing tests exercise joined pathway routing, pre-start contraindications, admission/readmission/death status and procedural checklists. They do not prove complete clinical branch coverage across all pathways.

The catalog previously opened a pathway without the active alert ID. The proposed change supplies the matching recommendation ID, consistent with opening the alert's action button.

## Remaining integration findings

1. **Daily inpatient review:** admissions have recording and discharge actions, but no dedicated daily review combining today's vitals, weight/fluid balance, relevant results, medication changes, active decisions and progress note. This should be the first workflow addition.
2. **Discharge readiness:** show unresolved urgent findings, evidence still awaiting review, pending investigations, medicine changes and responsible follow-up owners before discharge. Clinicians should explicitly document how outstanding issues are handled; do not silently assume readiness.
3. **Overlapping follow-up:** the browser example created a pathway clinic review for 17 October and an HF discharge clinic review for 24 October. Current discharge matching uses exact task titles. Consolidate by purpose and clinically appropriate timing, while preserving reasons and decision links; distinct visits can still be intentionally retained.
4. **Decision merging:** Overview merges related suggestions, but the visit decision screen renders individual recommendations. Use consistent grouping while retaining each source and decision link.
5. **Return to encounter:** pathway/actions replace the visit drawer. Preserve the prior step and scroll position, then return directly to the encounter.
6. **Decision narrative:** generated notes summarize medication changes and plans, but do not provide a complete section of acted/declined/deferred decisions and reasons. Add that section from recorded decisions rather than inferred text.

## Current pathway coverage

| Group | Pathways | Main scope |
|---|---:|---|
| Heart failure | 4 | Hyperkalaemia, renal deterioration, congestion, hypotension |
| Acute and safety | 7 | Shock, sepsis, bleeding, low potassium/magnesium, hyponatraemia, INR, severe hypertension |
| Coronary | 6 | Recurrent chest pain, ACS discharge, antithrombotics, CABG, CCS test results, suspected IHD testing |
| Rhythm and devices | 7 | Bradycardia, digoxin, amiodarone thyroid, AF care/procedures, ICD shocks, post-device care |
| Valve disease | 3 | Heart Team, intervention antithrombotics, prosthetic dysfunction/thrombosis |
| Cardiomyopathy | 3 | HCM sudden-death risk, LVOT obstruction, family screening |
| Inflammatory/infective heart disease | 3 | Pericarditis, myocarditis, endocarditis |
| Pulmonary hypertension | 4 | Suspected PH, PAH follow-up, PH with heart/lung disease, post-PE chronic disease |
| Diabetes | 5 | Management, hyperglycaemia/DKA, hypoglycaemia, sick-day, Ramadan |
| Procedures/general medicine | 2 | Non-cardiac surgery assessment, chest infection |

Eight procedural checklists are exposed separately: angiography/PCI, cardioversion, AF ablation, device implantation, valve intervention, right-heart catheterisation, CABG and pericardiocentesis.

## Priority additions or extensions

These are workflow candidates, not newly validated treatment algorithms. Each requires current guideline references, a clinical owner, explicit missing-data handling and review of every decision branch before publication.

| Priority | Candidate | Existing coverage to reuse |
|---|---|---|
| First | Daily inpatient review and discharge readiness | Admission record, all existing complication pathways, task review, discharge templates |
| High | Comprehensive HF initiation, optimisation and follow-up | Existing HF drug/target/advanced-HF/device rules; four HF complication pathways |
| High | First-presentation acute chest pain/ACS | Recurrent post-ACS/PCI pathway and stable suspected-IHD testing exist; extend the entry assessment and acute disposition rather than duplicating discharge care |
| High | Syncope assessment and disposition | Bradycardia, HCM risk and device pathways cover subsets only |
| High | Acute pulmonary embolism assessment and disposition | Current post-PE pathway addresses chronic follow-up/CTEPH, not the initial acute workflow |
| High | Tamponade/acute pericardial effusion assessment and escalation | Pericarditis content and pericardiocentesis checklist exist; no dedicated acute presentation workflow |
| High | Acute dyspnoea assessment and routing | Reuse congestion, shock, infection and PH pathways; add a shared presentation workflow |
| Later | Cardiac arrest/post-arrest care and acute aortic syndrome | Mentioned within other pathways but no dedicated end-to-end workflow |
| Later | HFpEF with obesity, amyloidosis/DCM integrated care, lipid escalation and resistant hypertension | Several relevant rules and treatment suggestions already exist; integrate them into longitudinal decisions |
| Specialist expansion | Pregnancy, cardio-oncology and adult congenital disease | No dedicated pathway in the current catalog |

## Meaningful completeness

Do not define completeness by pathway count. Maintain a scenario matrix by presentation, setting, severity, comorbidity and follow-up stage. For each supported scenario verify: needed data → cited recommendation → clinician act/decline/defer → attributable decision → medication/task → result/review → reassessment → documentation/handoff. Track unsupported scenarios explicitly.

Validation uses local synthetic data. It does not establish real-world clinician timing, current guideline accuracy, hospital-interface functionality or all-branch clinical safety. No new clinical thresholds or pathway algorithms were introduced in this change.

## Admission-reason coverage checks

| Admission reason offered by the UI | Workflow assessment |
|---|---|
| Acute decompensated HF | Congestion and shock pathways; daily review/discharge readiness still fragmented |
| STEMI / NSTE-ACS / ACS to exclude | Recurrent chest-pain and ACS discharge care exist; dedicated first-presentation routing remains a priority |
| AF / flutter | AF-CARE exists; flutter-specific decisions need explicit branch coverage |
| VT / VF / ICD shock | ICD/ventricular-arrhythmia pathway exists; assess arrest and no-device scenarios separately |
| Bradycardia / AV block | Dedicated pathway exists |
| Syncope | No dedicated general assessment/disposition pathway |
| Valve / prosthetic valve problem | Dedicated Heart Team and prosthetic-valve pathways exist |
| Endocarditis / myocarditis / pericarditis | Dedicated pathways exist; acute tamponade/effusion is not a complete separate flow |
| Pulmonary embolism | Post-PE chronic follow-up exists; acute assessment/disposition is missing |
| Hypertensive emergency | Severe-hypertension pathway exists |
| Chest infection / bleeding | Dedicated pathways exist |
| Elective procedure | Procedure checklists and pre-procedure assessment exist |
| Other | Explicit unsupported-scenario routing and responsible clinician/team are needed |
