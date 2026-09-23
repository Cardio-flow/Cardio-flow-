# Stage 5.5 — patient journey implementation audit

Status: in progress. This is a staged UX rebuild, not a new disease module or a new clinical rule release.

## First increment implemented

- Patient navigation now follows Summary, Journey, Current Visit, Medications, Investigations, Plan & Follow-up and Registries. The full clinical record remains accessible from Journey, while the Summary stays concise and shows What Changed. Current HF and coronary status and recent specialty events appear in the Summary without re-entering them.
- Routine laboratory entry now asks for test, result and one date, with site-preferred units where the existing catalog supports them. Presets add several tests to one screen; specimen, verification, source and encounter details are optional advanced controls. The existing server still validates units, normalizes values, records provenance and recalculates current clinical state. Manually entered results default to **unconfirmed** until checked against a source report.
- Medication browsing now starts with groups matching documented problems; all medications remain searchable. A single matching documented indication is attached after clinician review. Multiple or unmatched contexts require clinician selection. The existing reaction/duplicate/safety review remains in place.
- Registration uses a searchable comorbidity multi-select. Existing structured diagnosis templates remain the route for adding active problems.
- Opening a visit shows prior open care actions and automatically selects the latest encounter link. Dated plan actions use the existing clinical task engine, appear in Worklist, survive visits and reloads, and require an outcome before completion.
- Specialist review dashboards are now focused choices within Current Visit. Existing registry and historical CAD episode workflows remain available.

No database migration was needed for this increment. It changes presentation and reuses existing records, endpoints and task history. No historical data was transformed or removed.

## Stage 5.5 acceptance still open

- Dose presets cannot safely be shown yet: the installed medication catalog marks dose content `not_clinically_curated` and has no independently reviewed presets. The UI will expose presets only when reviewed metadata is present; clinical review and publication must precede that rollout.
- Diagnosis matching is a navigation aid over documented names and catalog groups, not clinical treatment logic. It needs a governed terminology mapping before it can drive medication recommendations or safety decisions.
- HF review and complication flows still contain form-first sections. They need focused step-by-step wizards and structured management choices, with published rules before patient-specific action suggestions.
- Plans currently create dated tasks but do not yet generate an editable clinical note. Admission/discharge notes and the task engine are connected in the patient record, but a dedicated structured handover wizard remains to be built.
- Registry source projection is retained; automatic reuse is limited to existing supported mappings. It is not a claim of complete registry coverage.
- The global More actions menu remains for less common legacy editors. The old specialty editors are still active behind focused review choices. A clinician UX review should guide their final retirement.
- No new disease-specific clinical rule has been published. Safety action prompts appear only for server-returned published alerts.

Stage 5.5 remains **open**. Do not begin Stage 6 or call the product a finished clinical decision-support system.

## Existing architecture to retain

- One patient identity and linked OPD/admission encounters; care entries, tasks and registry follow-up already survive discharge.
- Append-only clinical facts, structured medication and laboratory histories, HF/Echo/coronary records, clinician provenance, optimistic versions and governance are the system of record.
- Registry drafts already project a supported subset of clinical data, with source provenance and explicit review. The legacy CAD episode editor remains necessary for historical drafts and independent review.

## UX friction found

- The Summary stacks full HF, Echo, coronary, medication/laboratory and current-value panels after the overview. It becomes a long series of separate module screens rather than a patient-at-a-glance view.
- `Add / Update` opens a taxonomy menu before a clinician can add a routine result or medication. The laboratory form exposes specimen, two timestamps, source, laboratory, verification and other metadata for every routine result, one at a time.
- Medication search defaults to all drugs and asks for an indication even when an active diagnosis could resolve context. Dose is free text because the medication catalog has no independently reviewed dose presets yet.
- The Timeline is split across module-specific lists followed by the general patient timeline. The clinician must reconstruct the sequence mentally.
- New visits require a manual previous-encounter choice, and prior open plans are not surfaced in the visit-start flow.
- Registration uses comma-separated comorbidity text. Existing coded problem capture is available but reached through the generic action menu.

## Implementation sequence

1. Establish the patient journey shell and a concise Summary; keep all existing data and specialty views available from context.
2. Replace routine lab entry with one-row and multi-row quick capture using catalog units and a shared date. Hide required provenance defaults under Advanced Details. Retain server normalization, verification and history.
3. Reorganize medication selection by documented problem and catalog group; expose governed dose presets only when reviewed data exists. Preserve the existing safety and reaction review.
4. Convert comorbidities/diagnoses and HF review to choice-driven entry using existing structured records. Connect contextual actions, plans, discharge and visits to the journey.
5. Verify registry reuse, browser workflows at desktop/iPad widths and production safety before release.

No treatment thresholds, medication doses or clinical recommendations may be inferred from UI metadata. Only independently published rules may produce actionable patient-specific advice.
