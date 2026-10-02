-- CardioFlow migration 004 · complication episodes (Ahmed, 2 Oct 2026: a complication is followed
-- as one thread — opened by a pathway, reviewed, then resolved — not a single form).
-- Additive: an older build keeps working against a database with this migration.

-- One open episode per patient and pathway. Each pathway completion is a decision linked to it
-- (the first opens it, later ones are reviews); resolving records the outcome.
CREATE TABLE IF NOT EXISTS cf.episode (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  wizard text NOT NULL,
  status text NOT NULL CHECK (status IN ('open','resolved')),
  started_at timestamptz NOT NULL,
  started_by text NOT NULL,
  context_id uuid REFERENCES cf.care_context(id),
  resolved_at timestamptz,
  resolved_by text,
  outcome text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS episode_one_open ON cf.episode(patient_id, wizard) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS episode_patient ON cf.episode(patient_id, started_at DESC);

ALTER TABLE cf.decision ADD COLUMN IF NOT EXISTS episode_id uuid REFERENCES cf.episode(id);
