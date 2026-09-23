# Instructions for coding agents

- Read `docs/CONSTITUTION.md` and `docs/DECISIONS.md` before changing anything. They override older documents.
- The v1 implementation is archived at tag `codex-archive`. Do not restore its structure.
- Keep the kernel small. New clinical modules are rules (`server/engine/rules.ts`), wizard content (`shared/wizards.ts`) and plan templates (`shared/catalog.ts`) — not new parallel tables or screens.
- Never invent doses or clinical thresholds; new clinical rules start as DRAFT/CLINICAL_REVIEW and only run on sandbox sites.
- `server/db/schema.sql` is checksum-protected once applied. Add a new migration file instead of editing it.
- Synthetic data only. Run `npm test` and `npm run build` before committing; report only checks you actually ran.
- Add a line to `docs/DECISIONS.md` for any structural decision.
