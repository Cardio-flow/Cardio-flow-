# Reviewed visit and admission dictation — 10 October 2026

Result: passed for local synthetic integration. Production has not been changed by this PR.

## Scope and use — final English release

Dictate or paste opens inside admission entry, all clinic visit steps, and discharge. Browser speech recognition is optional, with English-only recognition (en-GB), with no language selector. Its consent prompt explains that the browser speech provider may process audio. CardioFlow does not store audio. Unsupported browsers and denied microphone permission retain editable text/keyboard-dictation input.

Stop recording, edit the transcript, select Review transcript, and choose proposed fields. Structured suggestions start unchecked and show their source words. Use reviewed entries changes form state only; the existing admission/visit/discharge save is required. Form submission is disabled while recording. Transcript edits invalidate a prior preview; hidden/inactive/unmounted forms stop recognition and ignore cancelled speech events.

Structured suggestions cover conservative English catalogue synonyms and common phrases (Here for heart failure follow-up; Patient has breathlessness and ankle swelling; BP is 110 over 70 mmHg), plus complete heart-rate and weight clauses with units. Arbitrary natural-language, unsupported phrases, lab results, medicines, dates and plan instructions remain narrative. Historical/uncertain context and conflicting readings are withheld. This is conservative entry assistance, not an AI medical transcription or interpretation engine.

Reviewed admission narrative is retained in the existing context/Journey. Confirmed admission vitals save in the same transaction and link to its context. Clinic narrative is included in the editable note, corrected narrative survives Back/return, and discharge text appends to the existing handover. No medication instruction executes from dictation.

## Validation and evidence

- npm test: 287 passed, including ten parser/API/persistence checks. Preview authentication, CSRF, site access, limits and absence of writes are checked. Admission vital linkage and rejected-reading transaction rollback, visit narrative draft/final persistence, negation, historical phrases, conflicting readings and medicine exclusion are checked.
- npm run build and npm run build:hosted passed.
- scripts/dictation-check.mjs passed: unchecked/source-linked review; no preview writes; clinic vital and note corrections; simulated microphone transcript; invalidation after editing; phone admission/Journey and discharge handover; denied/unsupported microphone text fallback; hidden microphone cleanup and late-event rejection; submission blocked during recording; no horizontal overflow or browser page errors.
- Existing HF, admission/pathway/decision/discharge, clinic-entry and compact-phone browser walkthroughs passed. The visit drawer now captures visible scroll before suspension and restores it when the original viewport returns; focus restoration does not scroll the preserved body.
- Actual DOM screenshots at 1440 × 1024 and 390 × 844 were opened and inspected: `/workspace/cardioflow-dictation-check/01-review-desktop.png`, `02-review-phone.png`, `03-discharge-phone.png`. Source snippets are readable; the fixed action footer remains reachable; full notifications reserve space above the drawer. Empty narrative fields are omitted until reviewed text exists.
- All five browser scripts run in CI; speech events in the dictation regression are simulated and contain synthetic text. No real audio or production patient data was used.

## Remaining validation

No measured medical speech accuracy, accent/noise benchmark, or live microphone/provider reliability claim is made. Browser/device support and provider policy need confirmation for the intended clinical setting. This release is English-only. Real medical-term accuracy must be evaluated before considering unattended distribution or expanding structured extraction.

## Efficiency improvements verified

- Dictate visit/admission opens capture with one action (provider consent on first use in the mounted form). Pause/resume retains text; a visible English recording/paused indicator tracks the microphone. Type or paste remains available.
- Blank HF follow-up and admission-history headings provide structure without default findings. Common English synonyms map to the existing clinical vocabulary. Arbitrary natural-language interpretation remains limited to supported patterns.
- Add to note appends reviewed text to the existing narrative and fills no fields. Review groups narrative and structured proposals; a focused Needs attention panel shows negation, uncertainty, missing units, conflicts, medicine instructions, labs and relative dates with their original words. No unreliable confidence percentage is displayed.
- Direct numeric edits are applied to the form, with a visible warning when replacing an existing value. Proposed fields remain unchecked; unitless/ambiguous values require correction in the transcript or the normal assessment form.
- A suspended clinic lab action preserves the pending transcript. Resume appends fresh speech, and cancelled/hidden recognition ignores late events. No dictation data is stored in localStorage/sessionStorage.
- The expanded browser regression checks English-only capture, blank templates, note-only entry, pause/resume, interrupted draft recovery, numeric correction and replacement warnings, in addition to the prior safeguards. All five browser walkthroughs passed. New desktop/phone evidence is under `/workspace/cardioflow-efficient-check/`.

Real accent, noise, medical-term transcription accuracy and clinician time savings remain unmeasured. No medical speech provider was selected or configured. A real-voice trial must include clinician review and correction time before claiming efficiency gains.
