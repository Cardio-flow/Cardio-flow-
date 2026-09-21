# CardioFlow UX redesign audit

## Current-state findings

- The global sidebar exposes Today, Admissions, OPD, Patients, Follow-ups and Registries as peer destinations even though they describe the same patient-care flow.
- The patient record uses six primary tabs and divides related clinical information across Overview, Care plan, Journey, Results & medications, Procedures and Registries & reports.
- The highest-priority reminders are collapsed by default, while encounter counts and registry metadata receive prominent space.
- Adding information depends on first choosing the correct patient tab and then choosing a record type.
- The registry area exposes the size and technical origin of recovered forms before telling the clinician what is complete or missing.
- The embedded CAD episode editor introduces a second toolbar, tab system and terminology inside the patient record.
- CAD follow-up milestones are managed in a separate queue and are not visible as part of the patient's current plan.

## Implementation plan

1. Consolidate clinician navigation into Worklist, Patients and Registries & Analytics; retain audit and export tools as secondary utilities.
2. Turn the Worklist into a patient-level attention queue with All, Inpatients, OPD, Due today, Overdue and Registry follow-up filters.
3. Replace the six-tab patient navigation with Summary, Clinical Record, Timeline and Registries inside one shared patient shell.
4. Add a universal Add / Update action that routes to the existing versioned care-entry editors.
5. Present active problems, important results, medications, plan, next event and actionable alerts on the Summary.
6. Combine existing entries and encounters into one filterable Clinical Record and one automatically generated Timeline.
7. Make registry completeness and missing mandatory fields primary, keep advanced fields behind progressive disclosure, and prefill supported values from existing clinical documentation for review.
8. Preserve existing APIs, schema, audit history, permissions, episode versioning and registry records; keep legacy routes reachable through the new structure.

## Duplicate-entry and paradigm transitions

- Patient identity is already reused in registry forms and should remain read-only there.
- CAD presentation, procedures and discharge data may exist in both longitudinal care entries and the CAD episode workflow. The redesign surfaces existing data and only pre-populates supported registry answers; it does not silently overwrite registry records.
- Follow-up dates exist in care-entry due dates and CAD milestone tasks. Both are shown together on the Worklist and patient Summary while retaining their original provenance.
- The legacy CAD episode workflow remains the authoritative versioned CAD record, but is visually contained within the shared Registries tab.
