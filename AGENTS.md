# Cardio Flow implementation context

- Follow `docs/MASTERPLAN.md`, `docs/PROGRESS.md`, and `docs/reference/SOURCES.md`. The earlier CAD-only roadmap is not the complete scope.
- Preserve the working Vercel/Neon stack authorized by the user.
- One patient record spans OPD, admissions, procedures and continuing care. Registry enrollment is optional.
- Treat legacy HF/CAD/EP backups as read-only specification sources. Do not connect to legacy databases or commit their credentials or patient data.
- Synthetic records only. Keep unverified clinical rules inactive; never invent treatment thresholds or doses.
- Preserve hosted data. Use additive migrations, server authorization/validation, optimistic concurrency and immutable history.
- Report only executed checks. Distinguish shared foundations from completed specialist workflows.
