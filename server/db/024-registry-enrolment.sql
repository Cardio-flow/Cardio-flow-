-- 10 Nov 2026 (phase 4): who is enrolled in each registry. Registries still read every clinical value from the
-- record (constitution rule 7); this table holds only the enrolment decision itself — enrol or withdraw, the date,
-- the reason and who recorded it. Append-only like the rest of the history: the newest row per patient and
-- registry is the current state; a mistaken enrolment is withdrawn with the reason "entered in error".
CREATE TABLE IF NOT EXISTS cf.registry_event (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  registry text NOT NULL CHECK (registry IN ('hf','cad','eps')),
  action text NOT NULL CHECK (action IN ('enrol','withdraw')),
  effective_on date NOT NULL,
  reason text NOT NULL DEFAULT '',
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registry_event_patient ON cf.registry_event(patient_id, registry, recorded_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'append_only_registry_event') THEN
    CREATE TRIGGER append_only_registry_event BEFORE UPDATE OR DELETE ON cf.registry_event FOR EACH ROW EXECUTE FUNCTION cf.forbid_change();
  END IF;
END $$;
