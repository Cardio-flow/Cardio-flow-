-- Sample (synthetic) patients kept apart from real patients on the same site (7 Oct 2026, Ahmed: "keep the same
-- site and separate the sandbox patients apart, and be ready for new patients").
--  * synthetic: the seeded demonstration patients (and any patient a clinician marks as a test patient)
--  * their MRNs carry the prefix SYN- so a real hospital MRN can never collide with a sample one
--  * a civil ID is unique among real patients only
ALTER TABLE cf.patient ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
UPDATE cf.patient SET synthetic = true WHERE created_by = 'system:synthetic-seed';
UPDATE cf.patient SET mrn = 'SYN-' || mrn WHERE synthetic AND mrn NOT LIKE 'SYN-%';
DROP INDEX IF EXISTS cf.patient_site_civil_id;
CREATE UNIQUE INDEX IF NOT EXISTS patient_site_civil_id_real ON cf.patient(site_id, civil_id) WHERE civil_id IS NOT NULL AND NOT synthetic;
CREATE INDEX IF NOT EXISTS patient_site_synthetic ON cf.patient(site_id, synthetic);
