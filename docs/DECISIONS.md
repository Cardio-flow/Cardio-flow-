# Decisions log

Short entries. Newest first. Do not undo a decision without adding a new entry that says why.

## 2026-09-30 · General-clinic core, slice 1: structured history

- **Migration 002 (minimal set, approved by Ahmed).** `server/db/002-general-core.sql`, additive only, so an older build still runs against it: patient `civil_id` (unique per site), `nationality`, `mobile`; `condition.attributes`; `study` accepts holter, abpm, stress, ccta, cmr, nuclear, cath, ep_study, device_check, cpet, plus `study.attributes`; new append-only `cf.status_event` (vital status apart from follow-up status). `migrate()` now runs an ordered, checksum-protected list (`MIGRATIONS` in `db.ts`). Episodes, procedures, implants, documents, reconciliation, plan owners, result review and registry tables wait for later migrations.
- **History has one truth per fact.** A "Yes" for diabetes, hypertension, dyslipidaemia, obesity, CKD and past cardiac history *is* the active diagnosis (rules already read it). "No / Unknown / Not assessed" are dated observations `hx.<item>`. Smoking, alcohol and family history are dated status observations (`hx.smoking` with pack-years and year stopped). Nothing recorded is shown as "Not recorded", never as "No".
- **"No" cannot silently contradict the problem list.** Answering "No" while the diagnosis is active requires "resolved" or "entered in error", which versions the condition. Detail values must come from `shared/history.ts` (descriptive categories only, no thresholds). Dates can be exact or year only (`attributes.onsetYear`); no day is invented.
- **Legacy "Current smoker" diagnosis** is hidden from the picker and reconciled automatically when a non-current smoking status is recorded.
- **Structured detail feeds safety rules.** Derived tags `mechanical-valve`, `ms-significant`, `icd`, `crt`, `pacemaker`. New rule `valve.doac-contraindicated` (red, clinical review): DOAC with a mechanical valve or moderate–severe MS. `af.anticoagulation` proposes warfarin, not a DOAC, in those patients, and no longer suggests switching them off warfarin. `hf.device-assessment` is silent when an ICD/CRT is recorded and asks about a CRT upgrade when a pacemaker is. RULESET 2026-09-30.1.
- **Risk-factor row** in the patient header: major factors (current smoking, diabetes, hypertension, dyslipidaemia, CKD) in navy, not red, because red stays reserved for safety alerts. New History tab and History drawer; registration details editable and audited.
- **Synthetic seed v3** adds structured history, identifiers and a new patient (Huda, mechanical aortic valve on apixaban) to show the new safety rule.

## 2026-09-24 · v2 rebuild

- **Rebuilt instead of refactoring v1.** v1 (Codex, archived at git tag `codex-archive`) grew to 91 tables with parallel task systems (clinical_task, followup_task, care-entry due dates) and per-module state tables because it was constrained to additive migrations. All data was pilot/synthetic, so that constraint no longer applied. v2 keeps the stack, the clinical content and the good engines, and replaces the structure.
- **Same stack.** React 19 + Vite, Express 5, PostgreSQL (Neon) with PGlite locally, Neon Auth, Vercel.
- **New schema `cf`.** The v1 schemas are left untouched in the database (nothing is dropped automatically). v1 users in `governance.membership` are copied into `cf.member` on first boot.
- **A dated plan action is the task.** No separate task table. Worklist, due and overdue are computed.
- **Completion is automatic and conservative.** A lab result, visit or Echo closes the earliest matching open plan action, and only if it arrives no earlier than half the planned interval before the due date (max 7 days; 30 for Echo).
- **Recommendations are reconciled per rule.** Same finding → kept; changed data → old one superseded; finding gone → resolved; clinician decided → not re-raised for the same data.
- **Sandbox vs production.** A site's `mode` decides which rule versions run. The demo and the current hosted pilot are sandbox.
- **Clinical rules seeded as CLINICAL_REVIEW** (hyperkalaemia, worsening renal function, ICD/CRT relevance, LVEF category change). Their parameters are sandbox values pending review. Operational rules (monitoring after a RAAS/MRA change, plan due/overdue) have no clinical threshold and are published.
- **Wizards are shared content.** `shared/wizards.ts` defines steps and the outcome builder used by both the browser preview and the server.
- **Registries deferred** until the HF slice is in daily use; the kernel already captures what they need.
- **Brand.** Logo recreated as SVG; Outfit for the wordmark, Plus Jakarta Sans for the UI, self-hosted. Flow red reserved for the logo.
- **Guideline decision support (2026-09).** `server/engine/guidelines.ts` adds 14 rules citing ESC HF 2026, ESC/EAS lipids 2019/2025, ESC-ERA CVD–CKD 2026, ESC diabetes 2023, ESC obesity consensus, ESC AF 2024, ESC hypertension 2024 and ESC ACS 2023: HF foundational therapy gaps and safe uptitration toward target doses, iron deficiency, LDL-C goal by risk category with an escalation ladder, Lp(a) once, eGFR+UACR screening, SGLT2i/GLP-1 RA in T2DM, semaglutide/tirzepatide in obesity, finerenone, CHA2DS2-VA and DOAC dosing, BP target, antiplatelet/DAPT, HbA1c due. All clinical ones start in CLINICAL_REVIEW (sandbox only). They suggest; the clinician confirms in a prefilled drawer. Summary gains a "Therapy & targets" panel.
- **Performance.** Patient state is one SQL round trip; the worklist is one set-based query; reads skip transactions; reassess reads a patient's recommendations once instead of per rule.
- **Rule set version.** `RULESET` in rules.ts; when it changes (or new rules ship) boot re-evaluates every patient once. Sandbox synthetic data is upgraded in place by `enrichSynthetic` (seedVersion in site settings).
- **Guideline goals gated to sandbox.** The Therapy & targets panel is returned only on sandbox sites until clinical review; `dm.hba1c-due` is a clinical rule (a build-published version is returned to CLINICAL_REVIEW on boot).
