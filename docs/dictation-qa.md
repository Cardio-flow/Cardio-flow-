# Reviewed visit and admission dictation — 10 October 2026

Result: passed for local synthetic integration. Production has not been changed by this PR.

## Scope and use

Dictate or paste opens inside admission entry, all clinic visit steps, and discharge. Browser speech recognition is optional, with English and Arabic language choices. Its consent prompt explains that the browser speech provider may process audio. CardioFlow does not store audio. Unsupported browsers and denied microphone permission retain editable text/keyboard-dictation input.

Stop recording, edit the transcript, select Review transcript, and choose proposed fields. Structured suggestions start unchecked and show their source words. Use reviewed entries changes form state only; the existing admission/visit/discharge save is required. Form submission is disabled while recording. Transcript edits invalidate a prior preview; hidden/inactive/unmounted forms stop recognition and ignore cancelled speech events.

Initial structured suggestions cover explicitly labelled English catalogue reasons/symptoms and complete BP, heart-rate and weight clauses with units. Arbitrary natural-language, Arabic/mixed-language phrases, lab results, medicines, dates and plan instructions remain narrative. Historical/uncertain context and conflicting readings are withheld. This is conservative entry assistance, not an AI medical transcription or interpretation engine.

Reviewed admission narrative is retained in the existing context/Journey. Confirmed admission vitals save in the same transaction and link to its context. Clinic narrative is included in the editable note, corrected narrative survives Back/return, and discharge text appends to the existing handover. No medication instruction executes from dictation.

## Validation and evidence

- npm test: 284 passed, including seven new parser/API/persistence checks. Preview authentication, CSRF, site access, limits and absence of writes are checked. Admission vital linkage and rejected-reading transaction rollback, visit narrative draft/final persistence, negation, historical phrases, conflicting readings and medicine exclusion are checked.
- npm run build and npm run build:hosted passed.
- scripts/dictation-check.mjs passed: unchecked/source-linked review; no preview writes; clinic vital and note corrections; simulated microphone transcript; invalidation after editing; phone admission/Journey and discharge handover; denied/unsupported microphone text fallback; hidden microphone cleanup and late-event rejection; submission blocked during recording; no horizontal overflow or browser page errors.
- Existing HF, admission/pathway/decision/discharge, clinic-entry and compact-phone browser walkthroughs passed. The visit drawer now captures visible scroll before suspension and restores it when the original viewport returns; focus restoration does not scroll the preserved body.
- Actual DOM screenshots at 1440 × 1024 and 390 × 844 were opened and inspected: `/workspace/cardioflow-dictation-check/01-review-desktop.png`, `02-review-phone.png`, `03-discharge-phone.png`. Source snippets are readable; the fixed action footer remains reachable; full notifications reserve space above the drawer. Empty narrative fields are omitted until reviewed text exists.
- All five browser scripts run in CI; speech events in the dictation regression are simulated and contain synthetic text. No real audio or production patient data was used.

## Remaining validation

No measured medical speech accuracy, accent/noise benchmark, or live microphone/provider reliability claim is made. Browser/device support and provider policy need confirmation for the intended clinical setting. Arabic dictation is available as a language option, but structured Arabic extraction is outside this first version. Real medical-term accuracy must be evaluated before considering unattended distribution or expanding structured extraction.
