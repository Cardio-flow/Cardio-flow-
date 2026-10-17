# 17 October audit release

Corrects the current-source audit: competing renal/potassium advice, unsafe stale inline confirmations, disappearing IV iron checkboxes, mismatched phosphate completion, uneditable suggested dates, mixed-date BP display, sample-mode reload, and stacked decision forms.

- Shared `potassiumFirst` guard protects preview and completion using the existing >5.5 mmol/L action threshold. The clinician uses the potassium pathway first; a routine renal plan is reconsidered with the repeat result.
- Evidence key is provided with preview and required by the inline confirmation client. Existing clients remain compatible; the server refuses a supplied stale key before writing.
- IV iron preserves five individually reviewable checks. The server stays the final validator; dates preserve at least 7 days between doses and at least 4 weeks before Hb reassessment.
- No assumption that chronic SGLT2 treatment caused an initial eGFR dip.
- All problem headings and primary actions stay visible; a single chosen inline decision opens. Urgent advice precedes the pulse. Manual date entry uses the shared DateInput.
- Synthetic-only regression tests in `tests/audit-oct17.test.ts` and mobile flow in `scripts/audit-oct17-check.mjs` cover the previously reproduced failures.

No patient records are rewritten by deployment. No migration is needed. No native iOS/Safari validation is claimed.
