# Cardio Flow

A shared cardiovascular care and registry workspace. The recovered **Final Codex Plan / masterplan v1.2** is the product baseline; see [the recovered brief](docs/MASTERPLAN.md) and [implementation progress](docs/PROGRESS.md). The complete planned platform remains in development.

**Release 0.5 is a synthetic engineering pilot with local and hosted modes. It is not approved for real patient data or clinical use.** The hosted mode uses Neon Auth and shared PostgreSQL; institution approval and clinical release gates remain tracked in [the Stage 0/1 architecture report](docs/CLINICAL_FOUNDATION_AUDIT.md) and [delivery roadmap](docs/ROADMAP.md).

Hosted site: https://cardio-flow-one.vercel.app. Neon Auth trusted-domain configuration and the first approved membership are active.

## Run locally

Requirements: Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4310** and select **Enter demo workspace**. Eight CAD sample patients and **Hassan Sample**, a care-only continuity walkthrough, are seeded. The server stores PostgreSQL data in `.data/cardio/`, which is excluded from Git. Reloading the browser or restarting the server preserves saved records. Sessions expire after eight hours and are intentionally cleared on restart.

To run the optimized frontend locally:

```sh
npm run build
npm start
```

The local server binds to loopback, rejects untrusted Host/Origin headers, and refuses to start with `NODE_ENV=production`. This preview deliberately cannot be deployed as a clinical service without further engineering.

Optional environment variables:

| Variable          | Default        | Purpose                                             |
| ----------------- | -------------- | --------------------------------------------------- |
| `PORT`            | `4310`         | Local HTTP port                                     |
| `CARDIO_DATA_DIR` | `.data/cardio` | Dedicated persistent development database directory |
| `CARDIO_SEED`     | `1`            | Set to `0` to begin with an empty patient registry  |
| `APP_BUILD`       | unset          | Set to `1` to serve `dist/`; `npm start` does this  |

Only one server should open a database directory at a time. Use a new directory for an independent sandbox; never share the data directory over a network or commit it to Git.

## Working features

- Worklist, Patients, Registries & Analytics and a unified four-tab patient workspace.
- Dated clinician-entered problems, decisions, investigations, medications, procedures, complications and review ownership.
- Explicit encounter connections; closure retains outstanding reviews and records a handover.
- Versioned care records with immutable revision history and stale-write rejection.
- Printable HTML patient reports (browser Print → Save as PDF); direct PDF generation and ECG attachments remain pending.
- Transactional synthetic patient registration with **optional** CAD enrollment, unique MRNs and server-allocated registry IDs.
- CAD index episodes with presentation, angiography access, management, repeatable lesions, lesion-linked stents, and discharge disposition.
- Server-side structural validation, optimistic version checks, saved drafts, locked final snapshots, and separate reviewer approval.
- CAD 1/3/6/12-calendar-month tasks anchored to **index admission**, including leap-year and month-end handling.
- Follow-up contacts linked to episodes; only complete in-window contacts satisfy a milestone. Unknown or early contacts are retained. Death closes remaining open tasks.
- Demonstration clinician, reviewer, analyst, and designer access boundaries enforced by the API.
- Read-only registry library with the CAD template and clearly planned HF, EP, and Structural Heart modules.
- Purpose-bound episode CSV exports and a codebook, with frozen content, row counts, and SHA-256 checksums.
- Append-only database audit events and final snapshots. No patient records or privileges are stored in browser local storage.
- Versioned terminology, units and structured-field definitions shared by the clinical foundation.
- Immutable source-linked clinical facts, current/pending/historical state resolution and clinician-preferred measurements.
- Persistent change events with centralized, time-aware rule recalculation, versioned evidence, expiring recommendations, alert actions, tasks and interactive pathway infrastructure.

CAD protocol windows (7 days early / 14 days late), contact requirements, and displayed value sets are **demonstration configuration pending named clinical approval**. There are no active treatment recommendations, proprietary scores, or clinical calculators.

## Try continuous care

Open **Patients → Hassan Sample**. Inspect the current situation, continuing plan, connected OPD/admission/OPD journey, renal review and procedure documentation. No registry enrollment is required. Create an encounter or update a review; reload to verify persistence. Under **Registries & reports**, download the printable report or deliberately select CAD enrollment.

## Try the CAD workflow

1. Enter as **Clinician**. Register a synthetic patient with an MRN such as `SYN-0100`.
2. Open **Registries & reports**, select **Enroll in CAD registry**, then **Open CAD assessment**. Create an index episode and complete Presentation, Angiography & PCI, and Discharge.
3. Add lesions and, when relevant, PCI stents. Save the draft before finalizing.
4. Finalize the saved record. Eligible follow-up tasks appear in **Follow-ups**.
5. Change **Demo role** to **Reviewer**, open the patient, and approve the final record.
6. Return to **Clinician** to record a contact. The server explains whether it satisfied the milestone.
7. Change to **Analyst** to generate a dataset and codebook with a stated export purpose.
8. Change to **Designer** to inspect definitions; patient browsing and patient API access are denied.

The role selector is a synthetic demonstration mechanism, **not authentication**. Every person on this local instance can select a demo role. Production identity and multi-user grants must replace it before any clinical pilot.

## Architecture

```text
React + TypeScript web application
                │ same-origin JSON API
Express modular server: session → permission → validation → transaction
                │
Server-side PGlite (embedded PostgreSQL, persistent on local disk)
  core.patient / registry.enrollment / clinical.episode
  care.encounter / care.entry / care.revision
  cad.lesion / cad.stent / clinical.encounter
  workflow.followup_task / task_satisfaction
  clinical.fact / current_preference / event
  decision_support.rule_definition / recommendation / alert / pathway
  workflow.clinical_task / clinical_task_event
  governance.audit_event / record_snapshot / export_job
```

PGlite runs **on the server**, not in the browser. It provides real PostgreSQL schemas, relational constraints, transactions, and trigger behavior for a setup-free development environment. A separately managed PostgreSQL service, least-privilege database roles, migration management, backups, encryption, and operations are still required for the production architecture.

All runtime web assets are bundled locally. No public CDN, HIS connection, clinical browser PIN, or hospital integration is used.

| Directory                               | Responsibility                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `src/`                                  | Responsive React interface and typed API client                                 |
| `server/app.ts`                         | Session/role checks and transactional domain API                                |
| `server/domain.ts`                      | Input validation, calendar logic, CAD demo definition, CSV escaping             |
| `server/schema.sql`                     | Relational PostgreSQL development schema and immutable record triggers          |
| `server/clinical-foundation-schema.sql` | Additive Stage 1 fact, rules, evidence, alert, task and pathway schema          |
| `src/clinical-foundation.ts`            | Shared state resolver, field/unit primitives, rule evaluator and pathway engine |
| `server/db.ts`                          | Persistent database initialization and synthetic fixtures                       |
| `tests/`                                | Domain, API, and browser acceptance checks                                      |
| `docs/`                                 | Delivery scope, architecture decisions, API guide                               |

## Verification

```sh
npm run build
npm test
npm run test:e2e
npm run format:check
```

Browser tests use a separate temporary database and a second local server on port 4311. On macOS they use an installed Google Chrome. Elsewhere install the Playwright browser first:

```sh
npx playwright install --with-deps chromium
```

The test suite covers authorization, CSRF/origin checks, duplicate identity, chronology, concurrent-version rejection, finalization transaction behavior, immutable history, independent review, calendar boundaries, follow-up satisfaction, CSV injection protection, scope filtering, exports, and phone layout.

See [the API guide](docs/API.md) and [release roadmap](docs/ROADMAP.md) for current limitations and the next build stages.

## Hosted pilot

The Vercel entrypoint is `server.ts`. It uses shared Neon PostgreSQL and Neon Auth through a same-origin Express adapter. Local development still uses PGlite and localhost-only demo sessions. The public version rejects demo-session requests and requires a verified email plus an active `governance.membership` row. Roles are loaded from the database on every request; clients cannot select them.

Required server environment: `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (at least 32 random characters), and `CARDIO_ORIGIN` or Vercel's `VERCEL_PROJECT_PRODUCTION_URL`. Secrets belong in Vercel environment settings and ignored local files. No database credentials are embedded in the browser bundle.

Run migrations explicitly before deployment:

```sh
node --env-file=.env.local --import tsx scripts/migrate.ts
```

For the first approved clinician, set `CARDIO_OWNER_EMAIL` in your local environment when running the migration. An account must verify that email before membership is bound to its immutable user ID. Additional memberships are provisioned by the workspace operator in the database with an explicitly approved email and role. Public signup alone grants no registry access.

Hosted builds use `npm run build:hosted`; Vite writes static assets to `public/` for Vercel. Preview environments require matching trusted origins in Neon Auth before interactive login can be tested. Keep production and preview data separate before using anything beyond this synthetic pilot.

The SDK's signed session cache lasts up to 60 seconds; workspace membership revocation is checked immediately on each data request. Hosted writes use a database advisory transaction lock across server instances to preserve the pilot's workflow invariants. This intentionally serializes writes and should be replaced with finer-grained concurrency controls before scaling.

This remains a synthetic CAD engineering pilot. Clinical approval, real patient-data governance, operational monitoring, restore drills, and broader registry implementation remain outstanding. Password-based sign-in and the shared database do not by themselves establish clinical readiness.
