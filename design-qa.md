# CardioFlow admission workspace design QA

Result: passed

Reviewed 10 October 2026. The selected direction combines Quiet Workspace desktop and Bedside Focus phone; the combined desktop reference was generated and shown before implementation. This is a responsive adaptation to the existing clinical app, rather than a pixel-identical reproduction of illustrative data.

## Reference and rendered evidence

- Desktop reference: `/workspace/generated_images/exec-e5fc985f-f92d-442a-914c-e103039ddf0e.png`, normalized to 1440 × 1024 CSS pixels.
- Phone reference: `/workspace/generated_images/exec-534126f8-a285-4a51-8806-bcf22a260e3a.png`, normalized to 390 × 844 CSS pixels.
- Actual desktop: `/workspace/cardioflow-workspace-check/admission/04c-desktop-workspace.png`, 1440 × 1024, Chromium, device scale factor 1.
- Actual phone: `/workspace/cardioflow-workspace-check/admission/04b-phone-plan.png`, 390 × 844, Chromium, device scale factor 1.
- Full comparisons (reference left; real app right): `/workspace/cardioflow-workspace-check/comparison-desktop.png` and `comparison-phone.png` in the same directory.
- Focused milestone comparison: `/workspace/cardioflow-workspace-check/comparison-timeline.png`.
- The comparisons were opened and visually inspected together. Screenshots come from the actual React DOM and local server, signed in as the synthetic sandbox clinician, using a newly registered synthetic patient admitted for acute decompensated HF after a hyperkalaemia decision. Browser screenshots disable animation so intermediate fade frames do not conceal surfaces.

## Findings and fixes

- P1: Phone entry actions were below the initial viewport. The admission header is compact; the disabled admission-entry banner is omitted during an open admission; labs and medicines precede the timeline on phones. Both buttons are now verified above the bottom navigation at 390 × 844.
- P1: Desktop modal entry obscured admission context. Clinical forms now share a two-column dialog with the current admission, milestones, medication changes and follow-up on the left. Patient identifiers, synthetic-data marker, allergy status and existing alert severity remain visible.
- P1: Expandable context rows must remain accessible within the modal keyboard loop. The focus trap now includes summary elements; the browser verifies 35 successive Tab presses stay inside the entry dialog.
- P2: Long event narratives made the admission difficult to scan. Event titles remain visible and narratives expand on demand. Historical admission milestones start folded; the discharge summary remains directly accessible.
- P2: Immediate screenshots captured a translucent animation frame and a large transient toast. Final comparison captures settled surfaces after the toast closes.

- P1: An immediate browser fill could race the arrival of the generated clinic note and append text to the new draft. The note field and Finish visit stay disabled until the draft request settles. The entry regression verifies replacement text and retention.

No unresolved P0 or P1 findings in the reviewed states. Preserved differences from the illustrative references: existing navigation and patient identification, allergy status, real recorded event ordering and task severities, the full renal profile including urea and calculated eGFR, actual previous results, and required date entry. Phone actions precede milestones to prioritize data entry. No decorative dots imply unrecorded clinical status or timings; no new clinical thresholds, modules or daily review were added.

## Functional verification

- All 277 regression tests passed (0 failures).
- Standard and hosted builds passed.
- Existing HF clinic browser walkthrough passed, with no page errors.
- Entry regression passed: initial focus, value-to-value Tab progression, unit access path, retained values on panel changes, discard protection, focus containment, save/cancel return to the same clinic decision step, retained assessment/scroll, phone overflow, and clinic-note completion.
- Expanded admission browser walkthrough passed: admission → catalog pathway retaining context/recommendation links → medication and dated plan → three-result batch save → reused clinic booking → discharge summary with decision and handover → corrected potassium visible in Investigations.
- The three-result batch uses one save. The final automated fill/save sequence including 35 Tab checks took 507 ms in this local run; this is automation timing, not measured clinician entry time. A clinician trial is still needed to establish real-world speed.

Evidence is local workspace output. CI runs the same browser scripts and uploads screenshots. This change is prepared for review; production deployment is a separate release step.

## Phone entry follow-up — 10 October 2026

Result: passed in a local synthetic sandbox. The date row now shows the effective date and reveals custom entry on request. Partial dates disable Save without losing results. Medicine cards show dose, frequency and indication; Edit reveals controls on phones while desktop controls stay expanded. Monitoring, contraindications and required override reasons remain outside the collapsed controls. Notifications reserve measured space above the app and drawers, display their full text and offer dismissal.

Inspected actual Chromium screenshots at 390 × 844: `/workspace/cardioflow-phone-polish-check/02-compact-date.png`, `03-compact-medicines.png`, `04-notification.png`, `05-safety-visible.png`, and `hf/08-phone-decision-notification.png`. Two routine medicine summaries and their Edit controls fit above the footer. The longer decision notification wraps above the header without overlapping it. The contraindicated combination remains visibly red with Start disabled until the required reason is supplied.

Validation: 277 tests passed; standard and hosted builds passed; existing HF, admission/pathway/decision/discharge and clinic-entry browser walkthroughs passed. New `scripts/phone-polish.mjs` verifies default/custom/partial dates, saved effective date, retained results, saved dose edit, responsive controls, second-card visibility, reserved notification space, and the required contraindication override. It is included in CI. These are automated synthetic checks, not measured clinician entry times or clinical validation. No new clinical rules, doses, schemas, modules or daily admission review were added.
