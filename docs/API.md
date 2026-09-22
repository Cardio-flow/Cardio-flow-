# Local preview API

Hosted mode uses verified Neon Auth and approved membership instead of demo sessions.

## Continuous care

Read routes require clinician/reviewer; mutations require clinician plus the common CSRF/origin checks. All records are scoped to the current demonstration site.

| Route                                                   | Behaviour                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /care/board`                                       | Independent Admission/OPD encounters and outstanding patient reviews                    |
| `GET /patients/:id/care`                                | Shared identity, dated entries and linked encounters                                    |
| `POST /patients/:id/care/encounters`                    | Open Admission/OPD with owner, reason, date and optional earlier same-patient encounter |
| `POST /patients/:id/care/encounters/:encounterId/close` | Version-checked closure and handover; continuing entries stay active                    |
| `POST /patients/:id/care/entries`                       | Create dated problem, decision, investigation, medication, procedure or complication    |
| `PUT /care/entries/:id`                                 | Version-checked review; immutable revision appended; origin retained                    |
| `GET /care/entries/:id/history`                         | Saved versions and authors                                                              |
| `POST /patients/:id/enroll`                             | Deliberate CAD enrollment, `{ "registry": "CAD" }`                                      |

Patient registration defaults to care-only; `enroll_cad: true` explicitly selects CAD. No care mutation requires enrollment. Clinical family and status fields document clinician choices; they do not activate clinical algorithms.

All endpoints are under `/api`. JSON responses use meaningful HTTP status codes: 401 (session absent), 403 (role/origin/token denied), 404 (not found/out of site scope), 409 (duplicate/state/version conflict), and 422 (validation).

## Session boundary

`POST /demo-session` accepts `{ "role": "clinician" }` (or `reviewer`, `analyst`, `designer`) and returns a CSRF token while setting an HTTP-only, SameSite=Strict cookie. This is an intentionally open synthetic entry point on localhost, not a real authentication service. Mutations after entry must include `X-CSRF-Token`. `GET /session` retrieves current demo context; `POST /logout` invalidates it.

## Endpoints

| Method and path               | Role                         | Behavior                                                           |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `GET /health`                 | Public                       | Local mode, health, site calendar date                             |
| `GET /definitions`            | Any demo role                | CAD demo metadata and SHA-256                                      |
| `GET /overview`               | Clinician, reviewer, analyst | Site-scoped sandbox counts                                         |
| `GET /patients?q=`            | Clinician, reviewer          | Search shared names and MRNs                                       |
| `POST /patients`              | Clinician                    | Atomically register and enroll in CAD                              |
| `GET /patients/:id`           | Clinician, reviewer          | Identity, enrollment, episode summaries                            |
| `POST /patients/:id/episodes` | Clinician                    | Start an index episode with admission date                         |
| `GET /episodes/:id`           | Clinician, reviewer          | Episode and normalized lesion/stent children                       |
| `PUT /episodes/:id`           | Clinician                    | Save validated draft at expected version                           |
| `POST /episodes/:id/finalize` | Clinician                    | Validate, lock, snapshot, generate tasks, audit in one transaction |
| `POST /episodes/:id/review`   | Reviewer                     | Independent review of expected final version                       |
| `GET /tasks`                  | Clinician, reviewer          | Site-scoped tasks with current due states                          |
| `POST /tasks/:id/contact`     | Clinician                    | Record encounter and evaluate task satisfaction                    |
| `GET /audit?patient_id=`      | Clinician, reviewer          | Latest 200 eligible audit events                                   |
| `POST /exports`               | Analyst                      | Generate and retain purpose-bound episode CSV and codebook         |

## Register a synthetic patient

```json
{
  "name": "Mariam Sample",
  "mrn": "SYN-0100",
  "sex": "Female",
  "birth_date": "1975-01-15"
}
```

Accepted sex values are Female, Male, and Unknown. MRNs must begin `SYN-` and be unique. Calendar dates use `YYYY-MM-DD`. Future birth/admission/discharge/contact dates and impossible dates are rejected. Birth dates before 1900 are outside the demonstration validator.

## Save a draft episode

```json
{
  "version": 1,
  "admission_date": "2025-01-31",
  "discharge_date": "2025-02-02",
  "presentation": "NSTEMI",
  "access_site": "Radial",
  "management": "PCI",
  "discharge_status": "Alive",
  "lesions": [
    {
      "vessel": "LAD",
      "segment": "Proximal",
      "stenosis": 90,
      "treatment": "PCI",
      "stents": [{ "diameter": 3, "length": 24, "type": "DES" }]
    }
  ]
}
```

Draft scalar selections can be null. Repeated rows must be structurally valid. Every successful save increments `version`; callers must use the returned version for the next action. Finalization and review accept `{ "version": 2 }` with the actual current value. Finalized content cannot be edited in this release.

## Record a follow-up

```json
{
  "version": 1,
  "contact_date": "2025-02-28",
  "contact_type": "Telephone",
  "vital_status": "Alive",
  "rehospitalized": "No",
  "notes": "Synthetic follow-up demonstration"
}
```

The date must not precede admission. Clinic and Telephone are supported. Vital status accepts Alive, Deceased, Unknown; rehospitalization accepts Yes, No, Unknown. A complete contact between the stored window boundaries satisfies the task. Other contacts remain in encounter history with a response explaining why the milestone was not satisfied. Death cancels other open tasks and completes the enrollment. Contacts are atomic with audit writes; idempotency keys and correction workflows are not yet available.

## Export

`POST /exports` requires a purpose of 10–500 characters. The response includes `content`, `codebook`, `filename`, `row_count`, and `checksum`. Drafts are excluded. Direct identifiers are removed but internal linkage identifiers remain, so this is not anonymous data. The original CSV is stored to permit exact reproduction; download access auditing and expiry are future work.

## Hosted authentication

Hosted requests use `/api/auth/*` through the Neon SDK server adapter. `/api/demo-session` returns 404. Data routes require a verified email and active database membership; the API derives the role and actor. `GET /api/config` exposes only whether hosted mode is active. Mutations retain same-origin and CSRF checks. Neon sign-out uses `/api/auth/sign-out`.

# Clinical foundation

`GET /api/clinical/catalog` returns the versioned terminology, units, structured-field package and evidence catalog.

`GET /api/patients/:id/clinical-state` returns resolved current/pending/historical facts, recommendation history, current alerts, event-sourced tasks and recalculation history.

`POST /api/patients/:id/clinical-facts` appends a source-linked fact. Corrections pass `supersedes_fact_id`; the previous fact is retained.

`POST /api/patients/:id/clinical-preferences` appends a clinician selection or release for a preferred current measurement. A reason is required.

`POST /api/clinical-alerts/:id/actions` appends acknowledge, act, snooze or dismiss actions. Acting or dismissing requires a reason; snoozing requires a time.

`POST /api/patients/:id/clinical-tasks` creates a clinician-owned task. `POST /api/clinical-tasks/:id/events` appends its next state using optimistic versioning.

`GET /api/clinical/pathways`, `POST /api/patients/:id/pathways/:key/start`, `GET /api/pathway-sessions/:id` and `POST /api/pathway-sessions/:id/responses` expose the versioned pathway engine.

All patient-level writes require the clinician role. Clinical state/catalog/pathway reads permit clinician and reviewer roles.

# Clinical governance

Governance permissions are site-scoped capabilities independent of application roles. Ordinary clinicians cannot access these routes.

| Route                                                                | Capability                            | Behaviour                                                                       |
| -------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/clinical-governance`                                       | Any governance capability             | Evidence, rule/review status, site guideline preferences and policy             |
| `POST /api/clinical-governance/rules`                                | Clinical rule maker                   | Create the next immutable draft version                                         |
| `POST /api/clinical-governance/rules/:key/:version/actions`          | Maker or clinical reviewer, by action | Submit, approve, reject, request changes, publish, suspend, supersede or retire |
| `POST /api/clinical-governance/rules/:key/:version/test-runs`        | Technical admin                       | Append a controlled passed/failed test run                                      |
| `POST /api/clinical-governance/evidence`                             | Clinical rule maker                   | Register immutable metadata for an evidence version under review                |
| `POST /api/clinical-governance/evidence/:key/:version/status`        | Clinical rule reviewer                | Append current/superseded/withdrawn/under-review status                         |
| `POST /api/clinical-governance/evidence/:key/:version/review-events` | Any governance capability             | Flag or resolve a manual evidence-review item                                   |
| `GET /api/recommendations/:id/traceability`                          | Clinician or reviewer                 | Exact facts, rule, evidence, review, reassessment and action history            |
| `POST /api/recommendations/:id/actions`                              | Clinician                             | Accept, modify, snooze, dismiss or override with recorded rationale             |

Only a `PUBLISHED` rule version can execute. Publication requires an independent approved review, every clinical checklist item, a latest passing technical test run, a future/current review date, and at least one current verified approved evidence version.
