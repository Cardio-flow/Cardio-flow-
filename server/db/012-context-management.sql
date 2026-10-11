-- Context metadata remains editable; every change is retained in the append-only audit.
-- Removal hides an encounter, preserving the original and its linked clinical facts.
ALTER TABLE cf.care_context ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE cf.care_context ADD COLUMN IF NOT EXISTS removed_by text;
ALTER TABLE cf.care_context ADD COLUMN IF NOT EXISTS removed_reason text;
ALTER TABLE cf.care_context ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS live_contexts ON cf.care_context(patient_id,started_at) WHERE removed_at IS NULL;
