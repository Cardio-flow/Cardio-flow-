# Heart Failure Clinical Review Pack

Prepared: 22 September 2026  
Site: `demo-kuwait`  
Current governance state for every rule: **CLINICAL_REVIEW**  
Execution status: **blocked / unpublished**

This pack contains candidate scopes. Exact triggers, numerical thresholds, exclusions, recommendations, intervals, recommendation class, and evidence level are intentionally absent pending authorized evidence extraction and independent clinical review. Every candidate uses a non-existent governance fact as its trigger, so it cannot execute accidentally.

| Category                    | Rule ID                        | Candidate purpose                                                                                                      | Evidence/version                             | Planned representative tests                                           | Class / level  | Status          |
| --------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- | -------------- | --------------- |
| HF diagnosis/classification | `hf.phenotype-2026`            | Reassess clinician-confirmed phenotype from preferred current LVEF while preserving history                            | ESC HF 2026                                  | New reduced EF; preserved EF; newer Echo                               | Pending review | CLINICAL_REVIEW |
| Pharmacologic therapy       | `hf.chronic-treatment-review`  | Review phenotype, active therapy, exclusions, intolerance, BP, HR, renal function and K without autonomous prescribing | ESC HF 2026                                  | Incomplete therapy; intolerance; temporary safety limitation           | Pending review | CLINICAL_REVIEW |
| Medication titration        | `hf.titration-readiness`       | Reuse shared titration states for ready, waiting and limited treatment                                                 | ESC HF 2026                                  | Ready; waiting; BP/HR/lab limitation                                   | Pending review | CLINICAL_REVIEW |
| Renal/K safety              | `hf.hyperkalaemia-review`      | Review K value and trend, sample context, renal state and therapies                                                    | ESC HF 2026; ESC CVD/CKD 2026-ehag098        | Normal; rising; abnormal; superseding result                           | Pending review | CLINICAL_REVIEW |
| Renal/K safety              | `hf.worsening-renal-function`  | Review renal change with congestion, perfusion, therapies, illness and nephrotoxins                                    | ESC HF 2026; ESC CVD/CKD 2026-ehag098        | Stable; worsening while congested; improving; avoid blanket withdrawal | Pending review | CLINICAL_REVIEW |
| Monitoring                  | `hf.hypotension-review`        | Distinguish asymptomatic low BP from symptomatic hypotension                                                           | ESC HF 2026                                  | Acceptable BP; asymptomatic low BP; symptomatic hypotension            | Pending review | CLINICAL_REVIEW |
| Monitoring                  | `hf.bradycardia-review`        | Review HR, symptoms, rhythm, conduction, rate-slowing drugs and device context                                         | ESC HF 2026                                  | Acceptable HR; asymptomatic; symptomatic                               | Pending review | CLINICAL_REVIEW |
| Congestion                  | `hf.congestion-review`         | Combine symptoms, findings, weight, renal/electrolyte state and diuretic response                                      | ESC HF 2026                                  | None; possible; clinical; worsening/poor response                      | Pending review | CLINICAL_REVIEW |
| Iron deficiency             | `hf.iron-deficiency-review`    | Interpret Hb, ferritin and TSAT with renal and bleeding context                                                        | ESC HF 2026; ESC CVD/CKD 2026-ehag098        | Complete normal; discordant; anaemia with missing iron data            | Pending review | CLINICAL_REVIEW |
| Device assessment           | `hf.icd-assessment`            | Time-aware ICD assessment without automatic implant recommendation                                                     | ESC HF 2026                                  | New low EF; missing therapy duration; improved EF                      | Pending review | CLINICAL_REVIEW |
| Device assessment           | `hf.crt-assessment`            | Review LVEF, symptoms, rhythm, QRS, morphology, pacing and therapy                                                     | ESC HF 2026                                  | Potential; not met; missing ECG/device information                     | Pending review | CLINICAL_REVIEW |
| Follow-up                   | `hf.post-discharge-follow-up`  | Create exact dates after a clinically approved interval is selected                                                    | ESC HF 2026                                  | Recent admission; multiple changes; combined monitoring                | Pending review | CLINICAL_REVIEW |
| Discharge                   | `hf.discharge-readiness`       | Review stability, reconciliation, monitoring, education, rehabilitation and follow-up                                  | ESC HF 2026; ESC Rehabilitation 2026-ehag099 | Ready; monitoring date missing; titration plan incomplete              | Pending review | CLINICAL_REVIEW |
| Rehabilitation              | `hf.rehabilitation-assessment` | Prompt structured eligibility/referral review with limitations                                                         | ESC HF 2026; ESC Rehabilitation 2026-ehag099 | Stable eligible; decompensated; limitation recorded                    | Pending review | CLINICAL_REVIEW |
| Advanced HF                 | `hf.advanced-referral`         | Support specialist referral review from a clinically reviewed signal constellation                                     | ESC HF 2026                                  | Repeated admissions/severe symptoms; isolated feature; missing context | Pending review | CLINICAL_REVIEW |

## Review requirements for each rule

The independent checker must document all of the following before approval:

1. licensed or otherwise authorized access for software implementation;
2. exact patient population and trigger logic;
3. required and optional patient data;
4. exclusions, contraindications, cautions, and conflict priority;
5. the precise recommendation and urgency;
6. monitoring and follow-up implications, including interval anchoring;
7. recommendation class and evidence level where the source provides them;
8. exact source location and verification date;
9. passing boundary, missing-data, contradictory-data, superseding-data, and regression tests;
10. independent reviewer identity, checklist, and approval comment.

After approval, a separate authorized publisher must transition the tested version from `APPROVED` to `PUBLISHED`. Older recommendations must be superseded rather than deleted when new data or a new rule version changes the assessment.
