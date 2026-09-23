# Decisions log

Short entries. Newest first. Do not undo a decision without adding a new entry that says why.

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
