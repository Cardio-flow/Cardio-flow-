-- CardioFlow migration 003 · medication exceptions (Ahmed, 2 Oct 2026: exceptions only, no full
-- reconciliation). Additive: an older build keeps working against a database with this migration.

-- The patient is not taking a prescribed drug, and later takes it again. Distinct from 'hold'
-- (a clinician's decision) so the record and the patient plan never confuse the two.
ALTER TABLE cf.medication_event DROP CONSTRAINT IF EXISTS medication_event_kind_check;
ALTER TABLE cf.medication_event ADD CONSTRAINT medication_event_kind_check
  CHECK (kind IN ('start','increase','decrease','hold','restart','stop','continue','planned','not_taking','resume'));

-- Why a drug class is not given (intolerance, contraindication, patient declines, not available,
-- cost). The newest row per patient and class is current; a row with cleared = true removes it.
-- Append-only like the rest of the clinical history.
CREATE TABLE IF NOT EXISTS cf.treatment_barrier (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  drug_class text NOT NULL,
  category text NOT NULL CHECK (category IN ('intolerance','contraindication','declined','unavailable','cost','other')),
  detail text NOT NULL DEFAULT '',
  drug text,
  cleared boolean NOT NULL DEFAULT false,
  recommendation_id uuid,
  effective_at timestamptz NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS treatment_barrier_patient ON cf.treatment_barrier(patient_id, drug_class, effective_at DESC, recorded_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'append_only_treatment_barrier') THEN
    CREATE TRIGGER append_only_treatment_barrier BEFORE UPDATE OR DELETE ON cf.treatment_barrier FOR EACH ROW EXECUTE FUNCTION cf.forbid_change();
  END IF;
END $$;
