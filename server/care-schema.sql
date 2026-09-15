CREATE SCHEMA IF NOT EXISTS care;
CREATE TABLE IF NOT EXISTS care.encounter (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL REFERENCES core.patient(id),
 kind text NOT NULL CHECK(kind IN ('Admission','OPD')), started_on date NOT NULL, closed_on date,
 reason text NOT NULL, owner text NOT NULL, summary text NOT NULL DEFAULT '',
 linked_encounter_id uuid REFERENCES care.encounter(id), state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')),
 version integer NOT NULL DEFAULT 1, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,patient_id), CHECK(closed_on IS NULL OR closed_on >= started_on)
);
CREATE TABLE IF NOT EXISTS care.entry (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL REFERENCES core.patient(id), encounter_id uuid,
 kind text NOT NULL CHECK(kind IN ('problem','decision','investigation','medication','procedure','complication')),
 family text NOT NULL, title text NOT NULL, status text NOT NULL, occurred_on date NOT NULL,
 owner text NOT NULL, due_date date, assessment text NOT NULL DEFAULT '', action text NOT NULL DEFAULT '', response text NOT NULL DEFAULT '',
 details jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
 updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id)
);
CREATE INDEX IF NOT EXISTS care_entry_patient ON care.entry(patient_id,occurred_on);
CREATE INDEX IF NOT EXISTS care_encounter_patient ON care.encounter(patient_id,started_on);
CREATE TABLE IF NOT EXISTS care.revision (
 id uuid PRIMARY KEY, entry_id uuid NOT NULL REFERENCES care.entry(id), version integer NOT NULL,
 payload jsonb NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(entry_id,version)
);
DROP TRIGGER IF EXISTS care_revision_immutable ON care.revision;
CREATE TRIGGER care_revision_immutable BEFORE UPDATE OR DELETE ON care.revision FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
