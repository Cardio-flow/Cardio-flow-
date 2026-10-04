-- CardioFlow migration 005 · procedures (coronary module, 4 Oct 2026): PCI and CABG (later TAVI,
-- ablation, device implants) as their own dated records with structured detail, so durations such
-- as DAPT are counted from the exact day and setting. Additive and append-only: a correction is a
-- new row that marks the old one entered in error.
CREATE TABLE IF NOT EXISTS cf.procedure (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  kind text NOT NULL,
  performed_at timestamptz NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}',
  summary text NOT NULL DEFAULT '',
  replaces uuid REFERENCES cf.procedure(id),
  status text NOT NULL DEFAULT 'final' CHECK (status IN ('final','entered_in_error')),
  context_id uuid REFERENCES cf.care_context(id),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS procedure_patient ON cf.procedure(patient_id, performed_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'append_only_procedure') THEN
    CREATE TRIGGER append_only_procedure BEFORE UPDATE OR DELETE ON cf.procedure FOR EACH ROW EXECUTE FUNCTION cf.forbid_change();
  END IF;
END $$;
