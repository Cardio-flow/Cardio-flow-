-- 20 Oct 2026 (real clinic list): medicines outside the CardioFlow catalogue (lactulose, cetirizine, B complex…)
-- recorded as free text so the medicine list is complete. No rule reads them; they are listed as "not checked".
-- Append-only: the newest row per logical_id is current; stopped = true ends it.
CREATE TABLE IF NOT EXISTS cf.other_medicine (
  id uuid PRIMARY KEY,
  logical_id uuid NOT NULL,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  dose text NOT NULL DEFAULT '',
  frequency text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  stopped boolean NOT NULL DEFAULT false,
  effective_at timestamptz NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS other_medicine_patient ON cf.other_medicine(patient_id, logical_id, effective_at DESC, recorded_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'append_only_other_medicine') THEN
    CREATE TRIGGER append_only_other_medicine BEFORE UPDATE OR DELETE ON cf.other_medicine FOR EACH ROW EXECUTE FUNCTION cf.forbid_change();
  END IF;
END $$;
