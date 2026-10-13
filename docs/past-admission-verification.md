# Past admission entry — 13 October 2026

Admissions & visits now offers **Past admission** for a closed hospital stay, including while a current visit or admission is open and for deceased patients. Enter admission/discharge dates, the record source and admission reasons. Discharge summary, hospital/ward, events, discharge condition/destination and reported historical lab/medicine notes are optional. Both displayed dates retain their year.

The existing care_context, journey, audit and clinician-scoped draft stores are reused. Drafts survive closing/reloading, with optimistic versions checked at confirmation. Historical dates cannot be in the future, precede confirmed birth, extend after the latest recorded death, duplicate or overlap an active admission record. Adjacent discharge/admission dates remain possible. Adding, correcting or removing history reconciles later readmission relationships.

Historical records are labelled in the cards and Journey; dates retain date-only precision without displaying an invented clock time. Their discharge summaries use the supplied historical documentation rather than today's diagnoses, medicines, labs or plans. Reported lab and medicine notes do not become structured observations or active prescriptions. Existing rules still reassess the changed admission history and may offer a clinician-reviewed recommendation; recording history itself creates no follow-up tasks or treatment changes.

Anemia is already an **other comorbidity**, separate from cardiovascular risk factors. The diagnosis search now accepts both **anemia** and **anaemia**. It appears under Add diagnosis → Other → Anaemia and History → Other comorbidities.

## Verification

- `npm test`: 405 tests passed, 0 failed, including nine historical admission tests.
- Final `npx tsx --test --test-concurrency=4 tests/*.test.ts`, after the Journey projection change: 405 passed, 0 failed.
- Focused admission/context tests: 25 passed, 0 failed.
- `npm run build`: passed, including TypeScript.
- `scripts/past-admission-check.mjs`: seven browser journeys passed on a 390 × 844 viewport, without page errors or horizontal overflow. Covers draft recovery, saving beside current care, historical Journey labels/source/precision, duplicate recovery, editing/removal, current inpatient access, and both anemia spellings/classification. Added to CI.
- Existing `scripts/admission-shots.mjs` and `scripts/structural-context-check.mjs`: passed, including live admission/discharge and correction/removal flows.
- Final screenshots inspected for the date controls, historical admission cards, mobile current inpatient access and Journey.
- `git diff --check`: clean.

Evidence: `/workspace/cardioflow-past-admission-check-2026-10-13`, including `tests.log`, `focused.log`, `build-final.log`, `browser-final.log`, `final-browser/browser-results.json`, screenshots and existing-flow logs. Checks used local synthetic patients. No tables, migrations, clinical thresholds or doses changed. Production deployment is a separate step.
