# CardioFlow v2

A longitudinal cardiology clinical platform: one patient journey from admission to clinic, structured entry, governed decision support, and plans that follow themselves up.

This branch is a clean rebuild. The previous implementation is preserved at git tag **`codex-archive`**. Start with [`docs/CONSTITUTION.md`](docs/CONSTITUTION.md), then [`docs/DECISIONS.md`](docs/DECISIONS.md).

## What works (HF slice)

- **Worklist:** who needs attention now, ranked by alert severity and overdue plans, with filters.
- **Patient Summary:** needs attention (each alert has *Why?* and one action), what changed since discharge or the last visit, the active plan with live status, medications grouped by purpose, latest results with trends, LVEF with source quality, upcoming items.
- **Journey:** admissions, labs, Echo, medication changes, decisions and completed tasks in one timeline, with planned items after *Today*. Selecting an admission shows its medication changes, its plan and the discharge summary.
- **Quick labs:** presets, one date, one save; eGFR (CKD-EPI 2021) is calculated; out-of-range values are flagged as you type; saving closes the plan item waiting for the result.
- **Complication wizards:** hyperkalaemia and worsening renal function. Prefilled context, auto-detected contributors, clinician-chosen management, exact monitoring dates, preview equals what is recorded, drafts survive an accidental close.
- **Medications:** context-aware add (relevant groups first, indication inferred from diagnoses or required), label-strength dose chips, pre-start check with missing-data warnings, optional monitoring booking; quick dose change / hold / stop / restart with reason and follow-up.
- **Admission → discharge → clinic:** admission confirms (never copies) prior history; discharge reconciles medications and creates a dated plan; the clinic visit shows the previous plan's status, records vitals/NYHA/congestion, surfaces decisions, and drafts the clinic note.
- **Echo:** one source; a later limited/bedside study does not silently replace a recent formal one; clinicians can override. Improved EF resolves the device alert and raises an LVEF-change review.
- **Guideline decision support:** HF foundational therapy gaps and safe titration to target doses, LDL-C goals with an escalation ladder (statin → ezetimibe → PCSK9/bempedoic acid), GLP-1 RA and SGLT2i in diabetes/obesity, finerenone, kidney screening, CHA2DS2-VA and DOAC dosing, BP target, DAPT, iron deficiency. Every suggestion cites its ESC source and opens a prefilled drawer; the Summary shows a *Therapy & targets* panel.
- **Rule governance:** versions, parameters, maker/checker, separate publisher; production sites run only published rules.

## Run locally

Node 22+ (Vercel uses Node 24).

```sh
npm ci
npm run dev            # http://127.0.0.1:4310 — embedded Postgres, synthetic patients
npm test               # kernel, engine, loop, governance and API tests
npm run build          # type-check + production bundle
```

Pick a synthetic user on the sign-in screen: **Dr. Ahmed** (clinician), **Dr. Clinical Reviewer** (reviewer) or **Rule Administrator** (admin). Local data lives in `.data/cardioflow-v2`; delete it (or set `CARDIO_DATA_DIR=memory`) for a fresh journey. Synthetic dates are relative to today.

`node scripts/shots.mjs` walks the full HF slice in a headless browser and saves screenshots (dev server must be running).

## Deploy (Vercel + Neon)

Environment variables (Vercel project settings, never in git):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection string |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | Neon Auth (unchanged from v1) |
| `CARDIO_ORIGIN` | Public origin, e.g. `https://cardio-flow-one.vercel.app` (falls back to `VERCEL_PROJECT_PRODUCTION_URL`) |
| `CARDIO_SITE_MODE` | `sandbox` (default: runs rules in review, labelled) or `production` (published rules only) |
| `CARDIO_SEED` | `0` to skip synthetic patients on an empty sandbox |

On first request the server creates schema `cf` (one migration, checksum-protected), seeds rule versions, copies approved v1 users from `governance.membership`, and — on an empty sandbox — seeds synthetic patients. v1 tables are left untouched; drop them manually once v2 is accepted.

Push the `v2` branch and Vercel builds a preview deployment. Promote it only after testing the preview.

## Layout

```
shared/     catalogue (labs, meds, diagnoses, plan templates), clinical maths, resolver, wizard content
server/db/  schema.sql (cf), PGlite/pg adapters, migration
server/kernel/  write operations, patient state snapshot, read models (summary, journey, worklist), notes
server/engine/  rules, reconciliation, wizards, governance
server/app.ts   HTTP API (zod-validated, CSRF, site-scoped, audited)
src/        React UI: screens (worklist, patient tabs, governance) and drawers (labs, wizard, meds, plan, echo, admission/discharge/visit)
docs/       constitution, decisions, clinical review packs and sources carried over from v1
```

## Not built yet (by design)

CAD/ACS/PCI, valve pathways, AF, devices, cardiometabolic, perioperative, registries and analytics. They come after the HF slice is in daily use, as new rules, wizard content and plan templates on the same kernel. Hosted data residency and regulatory classification need checking before real patient data.
