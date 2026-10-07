-- Correcting medical data (7 Oct 2026, Ahmed: "Add the ability to edit patient medical data also").
-- Clinical history stays append-only (constitution §2): a wrong study or medicine is not changed or deleted,
-- a correction row says it was entered in error (or replaced by a corrected entry). Reads leave corrected
-- rows out; the original and the correction both stay for the audit. Results (observations) keep their own
-- version mechanism; procedures keep theirs (a row that replaces the old one).
CREATE TABLE IF NOT EXISTS cf.correction (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  entity text NOT NULL CHECK (entity IN ('study','medication','medication_event')),
  entity_id uuid NOT NULL,
  reason text NOT NULL DEFAULT '',
  replaced_by uuid,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS correction_entity ON cf.correction(entity, entity_id);
CREATE INDEX IF NOT EXISTS correction_patient ON cf.correction(patient_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'append_only_correction') THEN
    CREATE TRIGGER append_only_correction BEFORE UPDATE OR DELETE ON cf.correction FOR EACH ROW EXECUTE FUNCTION cf.forbid_change();
  END IF;
END $$;
