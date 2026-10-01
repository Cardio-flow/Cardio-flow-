# CardioFlow constitution

Read this before every change. It is short on purpose. The full product vision lives in the master specification; this page is what must never drift.

## What CardioFlow is

A longitudinal cardiology record that turns patient data into actionable, followed-up plans. The cardiologist always decides. The complexity lives in the engine; the screen stays simple.

## The loop (non-negotiable)

```
New fact (lab, Echo, vitals, med change, visit)
  → rules that read it re-run
  → Recommendation (severity, facts, missing data, rule + version)
  → Clinician decision (act / decline with reason)
  → Plan actions with real dates (a dated plan action IS the task)
  → Result, visit or study closes the action automatically
  → new facts → rules re-run
```

There is one chain. Alerts, "needs attention", the worklist and "due/overdue" are **views** of recommendations and plan actions, not separate objects.

## Architecture rules

1. **Kernel first.** Clinical facts live in `cf.*`: patient, care_context, condition, observation, study, medication + medication_event, plan_action, recommendation, decision, clinical_event. Everything else is a projection.
2. **Append-only history.** Observations, conditions, medication events, studies, decisions, clinical events and audit cannot be updated or deleted (database triggers enforce it). Corrections add a new version.
3. **Current ≠ newest.** Use the resolver (`shared/clinical.ts#resolveCurrent`): clinician preference, then verified over preliminary, then a recent formal study over a later limited/bedside one.
4. **Rules are code + governed parameters.** Logic in `server/engine/rules.ts`; thresholds and wording in `cf.rule_version`. Each rule declares the inputs it reads.
5. **Only PUBLISHED rules affect production patients.** A clinical rule whose trigger and thresholds come straight from a current guideline, label or standard definition (cited in its evidence) is published at build (clinical owner's decision, 1 Oct 2026; `server/engine/publication.ts`). A rule that depends on a locally chosen number stays in review and runs only on sandbox sites, labelled with its status. For those, maker/checker applies: the author cannot approve; the reviewer cannot publish.
6. **One wizard engine.** Complications are content in `shared/wizards.ts`. The preview the clinician confirms is produced by the same function the server records (`buildOutcome`).
7. **Registries read the record.** They never become a second data store and never re-ask known data. (Deferred until the HF slice is in daily use.)
8. **No clinical logic in UI components.** The UI renders what the server decides.

## Safety rules

- Never invent doses or thresholds. Dose options are label strengths marked as catalogue draft; thresholds are rule parameters, taken from the cited guideline, or listed in `NEEDS_REVIEW` when chosen locally.
- Never change a dose automatically. Every change is a clinician action with a reason.
- Missing data is shown as missing, never assumed normal.
- Old values are never copied forward as today's values.
- Synthetic data only outside a production site.

## UX rules

- **Select > type.** Chips, segmented controls, dose cards, dates. Free text only for "other", reasoning and final note editing.
- Every alert has a **Why?** and one action button. No dead alerts.
- Exact dates, not "in 2 weeks".
- Complex actions open in a large side drawer with patient context visible. Drafts are saved.
- Flow red is the logo only. In the product, red means a safety alert. Colour semantics: red critical, orange review, yellow due, blue planned/opportunity, green done.
- Clinician words, not software words (Admission, Clinic visit, Plan — not encounter/entity).

## Scope discipline

Build in vertical slices. The HF slice (admission → discharge → labs → hyperkalaemia / renal function → clinic → repeat Echo) must be in real daily use before CAD, valve, AF, devices, GLP-1, perioperative or registries are built. New modules should be mostly new rules, wizard content and plan templates on the same kernel.

## Definition of done

Not tests passing or tables created. Done means: a cardiologist would keep CardioFlow open during clinic because it makes care easier.
