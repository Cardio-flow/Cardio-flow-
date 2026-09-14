CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS registry;
CREATE SCHEMA IF NOT EXISTS clinical;
CREATE SCHEMA IF NOT EXISTS cad;
CREATE SCHEMA IF NOT EXISTS workflow;
CREATE SCHEMA IF NOT EXISTS governance;
CREATE TABLE IF NOT EXISTS registry.definition (
 key text PRIMARY KEY, version integer NOT NULL, name text NOT NULL, definition jsonb NOT NULL, checksum text NOT NULL
);
CREATE TABLE IF NOT EXISTS core.patient (
 id uuid PRIMARY KEY, name text NOT NULL, mrn text NOT NULL UNIQUE, sex text NOT NULL,
 birth_date date NOT NULL, site_id text NOT NULL DEFAULT 'demo-kuwait', created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL
);
CREATE TABLE IF NOT EXISTS registry.enrollment (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL REFERENCES core.patient(id), registry_key text NOT NULL REFERENCES registry.definition(key),
 definition_version integer NOT NULL, crf bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 status text NOT NULL DEFAULT 'enrolled', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(patient_id,registry_key)
);
CREATE TABLE IF NOT EXISTS clinical.episode (
 id uuid PRIMARY KEY, enrollment_id uuid NOT NULL REFERENCES registry.enrollment(id), admission_date date NOT NULL,
 discharge_date date, presentation text, access_site text, management text, discharge_status text,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','final','reviewed')), version integer NOT NULL DEFAULT 1,
 form_version integer NOT NULL DEFAULT 1, created_by text NOT NULL, updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cad.lesion (
 id uuid PRIMARY KEY, episode_id uuid NOT NULL REFERENCES clinical.episode(id), vessel text NOT NULL,
 segment text NOT NULL, stenosis numeric NOT NULL CHECK(stenosis BETWEEN 0 AND 100), treatment text NOT NULL
);
CREATE TABLE IF NOT EXISTS cad.stent (
 id uuid PRIMARY KEY, lesion_id uuid NOT NULL REFERENCES cad.lesion(id) ON DELETE CASCADE,
 diameter numeric NOT NULL CHECK(diameter > 0), length numeric NOT NULL CHECK(length > 0), type text NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow.followup_task (
 id uuid PRIMARY KEY, episode_id uuid NOT NULL REFERENCES clinical.episode(id), milestone integer NOT NULL,
 protocol_version text NOT NULL, anchor_date date NOT NULL, due_date date NOT NULL, window_start date NOT NULL, window_end date NOT NULL,
 state text NOT NULL DEFAULT 'scheduled' CHECK(state IN ('scheduled','satisfied','cancelled')), version integer NOT NULL DEFAULT 1,
 UNIQUE(episode_id,milestone)
);
CREATE TABLE IF NOT EXISTS clinical.encounter (
 id uuid PRIMARY KEY, episode_id uuid NOT NULL REFERENCES clinical.episode(id), contact_date date NOT NULL, contact_type text NOT NULL,
 vital_status text NOT NULL, rehospitalized text NOT NULL, notes text NOT NULL DEFAULT '', created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workflow.task_satisfaction (
 task_id uuid PRIMARY KEY REFERENCES workflow.followup_task(id), encounter_id uuid NOT NULL REFERENCES clinical.encounter(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS governance.record_snapshot (
 id uuid PRIMARY KEY, episode_id uuid NOT NULL REFERENCES clinical.episode(id), version integer NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(episode_id,version)
);
CREATE TABLE IF NOT EXISTS governance.audit_event (
 id uuid PRIMARY KEY, actor text NOT NULL, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
 patient_id uuid REFERENCES core.patient(id), detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS governance.export_job (
 id uuid PRIMARY KEY, actor text NOT NULL, purpose text NOT NULL, definition_version text NOT NULL, row_count integer NOT NULL,
 checksum text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION governance.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append-only record cannot be updated or deleted'; END; $$;
DROP TRIGGER IF EXISTS audit_immutable ON governance.audit_event;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON governance.audit_event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS snapshot_immutable ON governance.record_snapshot;
CREATE TRIGGER snapshot_immutable BEFORE UPDATE OR DELETE ON governance.record_snapshot FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS definition_immutable ON registry.definition;
CREATE TRIGGER definition_immutable BEFORE UPDATE OR DELETE ON registry.definition FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
