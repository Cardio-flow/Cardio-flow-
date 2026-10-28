# Simple connected patient workflow — 28 October 2026

The patient record remains the source of truth. This change reduces navigation and repeated entry around the existing decision engine.

## Structure

- Overview: current decisions and important information.
- Visits & journey: admissions/clinic visits and the existing chronological event view.
- Clinical record: History, Medications and Investigations; registry mapping remains secondary.
- Plan & follow-up: dated actions, outcomes and clinical review.

Old URLs remain valid and highlight their parent section. Common actions remain available in the patient header. Phone navigation has Worklist, Patients and More; registry and role-specific administration are secondary. No clinical data are migrated into a new store.

## Admission and history

Admission date and reason are sufficient to open the admission. Symptoms, narrative, route and background review expand when needed. Previously recorded diagnoses/medicines remain linked, with their original provenance, but opening a form does not mark them as confirmed. Only explicit review selections are submitted. Older drafts with implicit confirmation defaults retain the narrative and other entry but require a fresh explicit background selection. Dates and the explicit-review marker are covered by the existing validated draft API.

History entry, approximate dates, historical admissions, procedures and existing medication reconciliation stay available. No new daily admission assessment or mandatory per-visit reconciliation is introduced.

## Follow-through

The clinic drawer shows the latest completed clinical encounter's plan before starting and keeps it available during assessment/decisions. Reused bookings are linked through context refs rather than copied. Results received but not clinically reviewed remain labelled Awaiting review; reviewed outcomes are distinct. A newly imported historical admission cannot displace the reference encounter. Non-HF post-discharge visits are not preselected as HF visits, and their general review is labelled Clinic review.

## Discharge and documentation

New discharge confirmation saves a compact snapshot in the existing care-context summary JSON: diagnoses, medication regimens/status, selected results with provenance, and outstanding plan/review state. It also saves an automatically generated summary unless the clinician supplied final wording. No new table is required.

The note retrieval endpoint returns saved notes for closed contexts. Explicit `draftNote` generation remains available to support audited record corrections; this is distinct from retrieving the saved document. A visit closed without manually composed wording gets a generated note. Existing clinician-edited notes are preserved.

Legacy closed contexts with no stored note retain the existing generation fallback; this change does not fabricate retrospective snapshots. Historical imported admissions retain their original reporting semantics. Later corrections remain audited through the existing context-edit workflow.

## Validation

`tests/simple-patient-flow.test.ts` covers optional admission confirmation, preserved longitudinal history, frozen discharge data/notes, clinician-edited wording, automatic visit notes, shared bookings and result-review state.

`scripts/simple-patient-flow-check.mjs` exercises the actual four-section navigation, optional admission entry, discharge, later medication change, connected follow-up and visit completion. It checks 320/390/1440 pixel layouts and phone access to secondary workspaces. Existing browser scripts navigate through the new parent sections and explicitly expand optional admission details.

Verified: 759 automated tests passed using `node --import tsx --test --test-concurrency=4 tests/*.test.ts`; `npm run build` passed. The standard `npm test` launcher was attempted but its tsx IPC socket was blocked by this execution environment, so the same test files ran through Node directly. Browser checks passed for the new connected flow, admission integration, Consult, and all 12 draft/recovery scenarios in round 6.

No medical thresholds or doses are changed. Software verification does not establish clinical acceptance or clinic time saved; those require actual use.
