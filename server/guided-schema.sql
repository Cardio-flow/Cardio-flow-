ALTER TABLE care.entry ADD COLUMN IF NOT EXISTS template_key text;
ALTER TABLE care.entry ADD COLUMN IF NOT EXISTS template_version text;
ALTER TABLE care.entry ADD COLUMN IF NOT EXISTS structured jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS registry.form_package (
 registry_key text NOT NULL, version integer NOT NULL, definition jsonb NOT NULL, checksum text NOT NULL,
 review_status text NOT NULL DEFAULT 'source_draft', PRIMARY KEY(registry_key,version)
);
CREATE TABLE IF NOT EXISTS registry.assessment (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL REFERENCES core.patient(id), registry_key text NOT NULL,
 package_version integer NOT NULL, context text NOT NULL, encounter_id uuid,
 answers jsonb NOT NULL DEFAULT '{}', state text NOT NULL DEFAULT 'draft', version integer NOT NULL DEFAULT 1,
 updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(registry_key,package_version) REFERENCES registry.form_package(registry_key,version),
 FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id)
);
CREATE TABLE IF NOT EXISTS registry.assessment_revision (
 id uuid PRIMARY KEY, assessment_id uuid NOT NULL REFERENCES registry.assessment(id), version integer NOT NULL,
 payload jsonb NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(assessment_id,version)
);
DROP TRIGGER IF EXISTS assessment_revision_immutable ON registry.assessment_revision;
CREATE TRIGGER assessment_revision_immutable BEFORE UPDATE OR DELETE ON registry.assessment_revision FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS form_package_immutable ON registry.form_package;
CREATE TRIGGER form_package_immutable BEFORE UPDATE OR DELETE ON registry.form_package FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
