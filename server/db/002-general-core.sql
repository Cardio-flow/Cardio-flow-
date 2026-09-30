-- CardioFlow migration 002 · general-clinic core (minimal set approved 2026-09-30).
-- Additive only: no column is renamed or dropped, so an older build keeps working
-- against a database that already has this migration.

-- Patient identifiers and contact. The MRN column stays the hospital file number.
ALTER TABLE cf.patient ADD COLUMN IF NOT EXISTS civil_id text;
ALTER TABLE cf.patient ADD COLUMN IF NOT EXISTS nationality text;
ALTER TABLE cf.patient ADD COLUMN IF NOT EXISTS mobile text;
CREATE UNIQUE INDEX IF NOT EXISTS patient_site_civil_id ON cf.patient(site_id, civil_id) WHERE civil_id IS NOT NULL;

-- Structured detail for a diagnosis (MI type, PCI vessels, prosthesis type, AF pattern…).
-- Condition rows stay append-only: a change of detail is a new version.
ALTER TABLE cf.condition ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}';

-- Studies beyond Echo and ECG, each with structured findings in attributes.
ALTER TABLE cf.study DROP CONSTRAINT IF EXISTS study_kind_check;
ALTER TABLE cf.study ADD CONSTRAINT study_kind_check
  CHECK (kind IN ('echo','ecg','holter','abpm','stress','ccta','cmr','nuclear','cath','ep_study','device_check','cpet'));
ALTER TABLE cf.study ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}';

-- Vital status and follow-up status are separate histories.
--   vital:     alive | died   (died: date, in/out of hospital, cause group)
--   follow_up: active | lost | transferred | discharged_from_clinic
CREATE TABLE IF NOT EXISTS cf.status_event (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  kind text NOT NULL CHECK (kind IN ('vital','follow_up')),
  status text NOT NULL CHECK (status IN ('alive','died','active','lost','transferred','discharged_from_clinic')),
  effective_on date NOT NULL,
  place text CHECK (place IN ('in_hospital','out_of_hospital','unknown')),
  cause_group text CHECK (cause_group IN ('hf','sudden_cardiac','other_cv','non_cv','unknown')),
  detail text NOT NULL DEFAULT '',
  context_id uuid REFERENCES cf.care_context(id),
  -- append-only: a correction is a newer row (with the reason in detail)
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'vital' AND status IN ('alive','died')) OR (kind = 'follow_up' AND status IN ('active','lost','transferred','discharged_from_clinic')))
);
CREATE INDEX IF NOT EXISTS status_event_patient ON cf.status_event(patient_id, kind, effective_on DESC, recorded_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'append_only_status_event') THEN
    CREATE TRIGGER append_only_status_event BEFORE UPDATE OR DELETE ON cf.status_event FOR EACH ROW EXECUTE FUNCTION cf.forbid_change();
  END IF;
END $$;
