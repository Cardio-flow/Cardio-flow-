-- Removing a patient record (7 Oct 2026, Ahmed: "No option to edit or delete patients?").
-- Clinical history is append-only (constitution §2), so a record is never erased: it is marked removed
-- (registered in error, duplicate, test record), leaves every list, search, count, registry and nightly run,
-- and stays in the database with who removed it, when and why. Its file number and civil ID become free again.
ALTER TABLE cf.patient ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE cf.patient ADD COLUMN IF NOT EXISTS removed_by text;
ALTER TABLE cf.patient ADD COLUMN IF NOT EXISTS removed_reason text;
ALTER TABLE cf.patient DROP CONSTRAINT IF EXISTS patient_site_id_mrn_key;
CREATE UNIQUE INDEX IF NOT EXISTS patient_site_mrn_active ON cf.patient(site_id, mrn) WHERE removed_at IS NULL;
DROP INDEX IF EXISTS cf.patient_site_civil_id_real;
CREATE UNIQUE INDEX IF NOT EXISTS patient_site_civil_id_active ON cf.patient(site_id, civil_id) WHERE civil_id IS NOT NULL AND NOT synthetic AND removed_at IS NULL;
