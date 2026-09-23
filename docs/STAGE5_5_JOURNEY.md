# Stage 5.5 — patient journey implementation audit

Status: in progress. This is a staged UX rebuild, not a new disease module or a new clinical rule release.

## First increment implemented

- Patient navigation now follows Summary, Journey, Current Visit, Medications, Investigations, Plan & Follow-up and Registries. The full clinical record remains accessible from Journey, while the Summary stays concise and shows What Changed. Current HF and coronary status and recent specialty events appear in the Summary without re-entering them.
- Routine laboratory entry now asks for test, result and one date, with site-preferred units where the existing catalog supports them. Presets add several tests to one screen; specimen, verification, source and encounter details are optional advanced controls. The existing server still validates units, normalizes values, records provenance and recalculates current clinical state. Manually entered results default to **unconfirmed** until checked against a source report.
- Medication browsing now starts with groups matching documented problems; all medications remain searchable. A single matching documented indication is attached after clinician review. Multiple or unmatched contexts require clinician selection. The existing reaction/duplicate/safety review remains in place.
- Registration uses a searchable comorbidity multi-select. Existing structured diagnosis templates remain the route for adding active problems.
- Opening a visit shows prior open care actions and automatically selects the latest encounter link. Dated plan actions use the existing clinical task engine, appear in Worklist, survive visits and reloads, and require an outcome before completion.
- Specialist review dashboards are now focused choices within Current Visit. Existing registry and historical CAD episode workflows remain available.
- HF review now uses a step-by-step journey for clinical course, symptoms, function/congestion, current treatment, complications and dated plan actions. It generates an editable review narrative and saves it to the existing versioned HF record. The focused complication review shows current laboratory and medication context and records the clinician's assessment in the existing HF pathway history.
- HF discharge now guides reconciliation and scheduling. The existing discharge engine creates dated laboratory, clinic, imaging and device-review tasks that carry into the next OPD visit; an admission can be closed from the same review only after clinical stability is confirmed.
- Visit/admission reasons have quick clinical choices while preserving an editable reason for other contexts. The start-of-visit flow can show the patient's active problems, medicines, recent results and imaging already in the record, alongside open actions from the prior visit.
- The general Plan & Follow-up workspace now drafts an editable note from active problems, current medications, recent results and dated actions. Saving creates a clinician-authored, visit-linked and versioned clinical decision record. The source records and actionable tasks remain independent; the generated narrative is a reviewed snapshot, not a new source of clinical truth.

No database migration was needed for this increment. It changes presentation and reuses existing records, endpoints and task history. No historical data was transformed or removed.

## Stage 5.5 acceptance still open

- Dose presets cannot safely be shown yet: the installed medication catalog marks dose content `not_clinically_curated` and has no independently reviewed presets. The UI will expose presets only when reviewed metadata is present; clinical review and publication must precede that rollout.
- Diagnosis matching is a navigation aid over documented names and catalog groups, not clinical treatment logic. It needs a governed terminology mapping before it can drive medication recommendations or safety decisions.
- HF review, complication and discharge now have focused steps, but clinician-selected management choices cannot be generated from unpublished disease rules. The complication wizard records assessment and monitoring without suggesting treatment. Independent clinical publication is required before patient-specific management options can appear.
- The generated HF and general plan narratives can be edited before save. The general plan note is a record snapshot; structured actions still have to be selected and dated separately. The generic admission/discharge flow remains available for non-HF care.
- Registry source projection is retained; automatic reuse is limited to existing supported mappings. It is not a claim of complete registry coverage.
- The global More actions menu remains for less common legacy editors. The old specialty editors are still active behind focused review choices. A clinician UX review should guide their final retirement.
- No new disease-specific clinical rule has been published. Safety action prompts appear only for server-returned published alerts.

Stage 5.5 remains **open**. Do not begin Stage 6 or call the product a finished clinical decision-support system.

## Master specification acceptance tracking

The full Stage 5.5 request has 73 numbered requirements, ten acceptance scenarios and 39 definition-of-done checks. This table groups every major workflow so remaining work cannot disappear behind a visual redesign. “Implemented” means present in code; it does not mean a clinician has accepted the workflow or that unpublished treatment content is safe for production.

| Requirement group                                                                                                | Current state                                                                                                            | Remaining acceptance work                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Preserve all clinical records, provenance, governance and old encounters (1, 53, 63, DoD 34–36)                  | Existing models, history, endpoints and rule-publication gate are reused; no migration in this UX increment.             | Recheck production migration/data counts before any promotion.                                                                                               |
| One continuous patient journey, connected visits and timeline (2–5, 43–44, 47, 51–52, DoD 20–26; G, H, J)        | Patient shell, Journey, Summary/What Changed, new-visit context and continuing tasks exist.                              | Complete event coverage for all specialist procedures/medication changes and observe a real clinician's 10-second review.                                    |
| Low-friction admission, inpatient review, discharge and follow-up (6, 48–52, 71–73)                              | Choice-based visit reasons, prior context and HF handover are available.                                                 | Non-HF daily inpatient and discharge journeys still rely on the generic care forms.                                                                          |
| Structured comorbidities and diagnosis (7–8, 70, DoD 12–13)                                                      | Searchable comorbidity multi-select and structured diagnosis catalog are available.                                      | Review specialty diagnosis choices and reduce remaining generic-form prominence.                                                                             |
| Quick labs, presets, dates, local units and hidden advanced details (9–15, 68, DoD 1–3; A, B)                    | Single/multi-result quick entry, test groups, shared date, preferred units and optional advanced details are available.  | Clinician timing and tablet usability review.                                                                                                                |
| Lab intelligence and actionable abnormal alerts (16–17, 46, 62–63, DoD 10, 17; E)                                | New facts trigger existing recalculation; only published alerts open a review/action flow.                               | Disease-specific candidate rules remain unpublished; no patient-specific abnormal-result recommendation can be claimed yet.                                  |
| Diagnosis-aware medication choice, groups, indication, route and frequency (18–27, 33–34, 69, DoD 4–8, 11; C, D) | Relevant groups, medication search, conditional indication, route/frequency choices and clinical grouping are available. | Governed terminology mapping and independently reviewed common dose presets are missing; dose remains entered manually for current catalog content.          |
| Medication safety, monitoring and titration (28–32, 59–60, DoD 9–10; E)                                          | Current medication, reaction and lab context is shown; documented changes and published alert actions persist.           | Medication-specific checklists, dose-step choices and monitoring suggestions need reviewed metadata/published rules. No treatment action is auto-prescribed. |
| HF review and complication management (35–39, 42, DoD 14–15; F)                                                  | Guided HF review, focused complication context, editable note and dated plan exist.                                      | Management options require independent publication of clinical rules; current wizard records clinician decision without fabricated treatment options.        |
| Structured plans, tasks, dates and scheduling (40–42, 60–61, DoD 16, 18–19)                                      | Dated plan tasks, completion outcome, worklist continuity and editable generated HF/general note exist.                  | Expand structured action categories and clinically governed date suggestions; do not treat a free-text note as a task.                                       |
| Registry reuse and missing fields (54–56, DoD 27–28; I)                                                          | Existing source projections prefill supported CAD/HF/EP draft fields and preserve provenance.                            | Broaden mappings and audit duplicate prompts; no claim of universal prepopulation.                                                                           |
| Shared wizard pattern, contextual actions and legacy retirement (57–58, 65, DoD 29–31)                           | Focused quick actions and some large guided reviews replace common form paths.                                           | Inventory every old editor as replaced, read-only or required; harmonize Echo/valve/CAD and retire the legacy global action menu from routine care.          |
| Visual design, contextual values and responsive workflows (45, 59, 66–70, DoD 32–33; J)                          | Summary panels, clinical cards, trends, spacing and browser viewport checks exist.                                       | Manual 13–16 inch desktop and iPad landscape workflow testing with practicing cardiologists.                                                                 |
| Reviewer sandbox and published-rule safety (63–64, DoD 34–35)                                                    | Rule governance and synthetic test APIs are retained; candidate rules cannot affect real patients.                       | Interactive reviewer scenario editing for K/BP/EF/medication/symptoms remains to be built.                                                                   |
| Verification and release (DoD 37–39)                                                                             | Automated unit/domain and browser suites cover several synthetic patient journeys.                                       | Rerun the entire suite after changes, complete real-clinician review and controlled production deployment.                                                   |

The primary success test is a cardiologist completing a clinic review without the software slowing the consultation. This requires observed use, not an automated test alone.

Verification of this increment: production build and formatting passed; 51 server/domain tests and 19 browser workflows passed. The browser journey covers quick labs, an editable general plan note, a dated action and carryover into a later visit. These checks do not substitute for real-clinician acceptance or a controlled production release.

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
