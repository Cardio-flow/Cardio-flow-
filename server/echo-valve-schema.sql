CREATE SCHEMA IF NOT EXISTS imaging;
CREATE SCHEMA IF NOT EXISTS valve;

CREATE TABLE IF NOT EXISTS imaging.echo_study (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid REFERENCES care.encounter(id),
  study_type text NOT NULL CHECK(study_type IN (
    'COMPLETE_TTE','LIMITED_TTE','TEE','STRESS_ECHO','CONTRAST_ECHO',
    'THREE_D_ECHO','BEDSIDE_FOCUSED','INTERVENTIONAL_ECHO','OTHER'
  )),
  formality text NOT NULL CHECK(formality IN ('FORMAL','BEDSIDE_LIMITED')),
  performed_at timestamptz NOT NULL,
  location text NOT NULL DEFAULT '',
  comparison_study_id uuid REFERENCES imaging.echo_study(id),
  legacy_source_type text,
  legacy_source_id uuid,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(legacy_source_type,legacy_source_id)
);
CREATE INDEX IF NOT EXISTS echo_study_patient_time
  ON imaging.echo_study(patient_id,performed_at DESC);

CREATE TABLE IF NOT EXISTS imaging.echo_revision (
  id uuid PRIMARY KEY,
  study_id uuid NOT NULL REFERENCES imaging.echo_study(id),
  version integer NOT NULL CHECK(version > 0),
  status text NOT NULL CHECK(status IN ('DRAFT','PRELIMINARY','FINAL','AMENDED','ENTERED_IN_ERROR')),
  indication jsonb NOT NULL DEFAULT '[]',
  priority text NOT NULL DEFAULT 'ROUTINE' CHECK(priority IN ('ROUTINE','URGENT','CRITICAL')),
  study_quality text NOT NULL CHECK(study_quality IN ('GOOD','ADEQUATE','TECHNICALLY_LIMITED','VERY_LIMITED')),
  quality_reasons jsonb NOT NULL DEFAULT '[]',
  rhythm_context text NOT NULL DEFAULT '',
  heart_rate numeric,
  blood_pressure text NOT NULL DEFAULT '',
  contrast_used boolean NOT NULL DEFAULT false,
  structured_findings jsonb NOT NULL DEFAULT '{}',
  interpretation text NOT NULL DEFAULT '',
  comparison_summary text NOT NULL DEFAULT '',
  conclusion text NOT NULL DEFAULT '',
  clinician_override_reason text NOT NULL DEFAULT '',
  reporting_cardiologist text NOT NULL,
  amendment_reason text NOT NULL DEFAULT '',
  source_label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(study_id,version)
);
CREATE INDEX IF NOT EXISTS echo_revision_study_version
  ON imaging.echo_revision(study_id,version DESC);

CREATE TABLE IF NOT EXISTS imaging.echo_measurement (
  id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES imaging.echo_revision(id),
  section text NOT NULL,
  parameter_code text NOT NULL,
  label text NOT NULL,
  value_number numeric,
  value_text text,
  unit text NOT NULL DEFAULT '',
  method text NOT NULL DEFAULT '',
  context text NOT NULL DEFAULT '',
  sequence integer NOT NULL DEFAULT 0,
  fact_id uuid REFERENCES clinical.fact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((value_number IS NOT NULL) <> (value_text IS NOT NULL)),
  UNIQUE(revision_id,parameter_code,context,sequence)
);
CREATE INDEX IF NOT EXISTS echo_measurement_parameter
  ON imaging.echo_measurement(parameter_code,revision_id);

CREATE TABLE IF NOT EXISTS imaging.valve_finding (
  id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES imaging.echo_revision(id),
  valve_name text NOT NULL CHECK(valve_name IN ('AORTIC','MITRAL','TRICUSPID','PULMONARY','MULTIPLE')),
  lesion_type text NOT NULL CHECK(lesion_type IN ('NONE','STENOSIS','REGURGITATION','MIXED','PROSTHETIC','POST_REPAIR')),
  mechanism text NOT NULL DEFAULT '',
  clinician_severity text NOT NULL CHECK(clinician_severity IN (
    'NONE','MILD','MODERATE','SEVERE','INDETERMINATE','DISCORDANT_REQUIRES_CONFIRMATION','POST_INTERVENTION'
  )),
  calculated_assessment text,
  discordant boolean NOT NULL DEFAULT false,
  supporting_parameters jsonb NOT NULL DEFAULT '[]',
  morphology text NOT NULL DEFAULT '',
  narrative text NOT NULL DEFAULT '',
  override_reason text NOT NULL DEFAULT '',
  state_fact_id uuid REFERENCES clinical.fact(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(revision_id,valve_name,lesion_type)
);

CREATE TABLE IF NOT EXISTS imaging.quality_check (
  id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES imaging.echo_revision(id),
  severity text NOT NULL CHECK(severity IN ('ERROR','IMPORTANT_REVIEW','OPTIONAL_COMPLETENESS')),
  code text NOT NULL,
  message text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(revision_id,code)
);

CREATE TABLE IF NOT EXISTS imaging.report_attachment (
  id uuid PRIMARY KEY,
  study_id uuid NOT NULL REFERENCES imaging.echo_study(id),
  file_name text NOT NULL,
  media_type text NOT NULL,
  storage_reference text NOT NULL,
  checksum text NOT NULL,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW imaging.current_echo_revision AS
SELECT DISTINCT ON (s.id)
  s.id study_id,s.patient_id,s.encounter_id,s.study_type,s.formality,s.performed_at,
  s.location,s.comparison_study_id,
  r.id revision_id,r.version,r.status,r.indication,r.priority,r.study_quality,
  r.quality_reasons,r.rhythm_context,r.heart_rate,r.blood_pressure,r.contrast_used,
  r.structured_findings,r.interpretation,r.comparison_summary,r.conclusion,
  r.clinician_override_reason,r.reporting_cardiologist,r.amendment_reason,
  r.source_label,r.created_at revision_created_at
FROM imaging.echo_study s
JOIN imaging.echo_revision r ON r.study_id=s.id
ORDER BY s.id,r.version DESC;

CREATE TABLE IF NOT EXISTS valve.prosthesis (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  position text NOT NULL CHECK(position IN ('AORTIC','MITRAL','TRICUSPID','PULMONARY')),
  prosthesis_type text NOT NULL CHECK(prosthesis_type IN ('MECHANICAL','BIOPROSTHETIC','TRANSCATHETER','REPAIR','OTHER','UNKNOWN')),
  manufacturer text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  size_label text NOT NULL DEFAULT '',
  implanted_on date,
  implantation_route text NOT NULL CHECK(implantation_route IN ('SURGICAL','TRANSCATHETER','REPAIR','UNKNOWN')),
  baseline_echo_id uuid REFERENCES imaging.echo_study(id),
  antithrombotic_context text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','EXPLANTED','UNKNOWN')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS valve_prosthesis_patient ON valve.prosthesis(patient_id,position);

CREATE TABLE IF NOT EXISTS valve.procedure_record (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid REFERENCES care.encounter(id),
  procedure_type text NOT NULL CHECK(procedure_type IN (
    'TAVI','SAVR','MITRAL_REPAIR','MITRAL_REPLACEMENT','TEER',
    'BALLOON_MITRAL_COMMISSUROTOMY','TRICUSPID_REPAIR','TRICUSPID_REPLACEMENT',
    'TRANSCATHETER_TRICUSPID_INTERVENTION','OTHER_STRUCTURAL'
  )),
  procedure_date date NOT NULL,
  indication text NOT NULL,
  prosthesis_id uuid REFERENCES valve.prosthesis(id),
  operator_team text NOT NULL DEFAULT '',
  complications jsonb NOT NULL DEFAULT '[]',
  result text NOT NULL DEFAULT '',
  conduction_context text NOT NULL DEFAULT '',
  follow_up_plan jsonb NOT NULL DEFAULT '{}',
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS valve.state_event (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  valve_name text NOT NULL,
  lesion_type text NOT NULL,
  severity text NOT NULL,
  mechanism text NOT NULL DEFAULT '',
  source_study_id uuid REFERENCES imaging.echo_study(id),
  source_finding_id uuid REFERENCES imaging.valve_finding(id),
  symptoms_context text NOT NULL DEFAULT 'UNKNOWN',
  ventricular_response jsonb NOT NULL DEFAULT '{}',
  pulmonary_context text NOT NULL DEFAULT '',
  rhythm_context text NOT NULL DEFAULT '',
  quality text NOT NULL,
  observed_at timestamptz NOT NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS valve_state_patient_lesion
  ON valve.state_event(patient_id,valve_name,lesion_type,observed_at DESC);

CREATE TABLE IF NOT EXISTS valve.pathway_assessment (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid REFERENCES care.encounter(id),
  pathway_type text NOT NULL CHECK(pathway_type IN (
    'SEVERE_AS','DISCORDANT_AS','LOW_FLOW_LOW_GRADIENT_AS','SEVERE_AR',
    'PRIMARY_MR','SECONDARY_MR','MITRAL_STENOSIS','TRICUSPID_REGURGITATION',
    'MULTIPLE_VALVE_DISEASE','PROSTHETIC_REVIEW','POST_INTERVENTION'
  )),
  source_study_id uuid REFERENCES imaging.echo_study(id),
  state text NOT NULL,
  known_data jsonb NOT NULL DEFAULT '[]',
  missing_data jsonb NOT NULL DEFAULT '[]',
  why_it_matters text NOT NULL DEFAULT '',
  next_decision text NOT NULL DEFAULT '',
  strategy_factors jsonb NOT NULL DEFAULT '[]',
  evidence_note text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS valve.heart_team_event (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid REFERENCES care.encounter(id),
  source_pathway_id uuid REFERENCES valve.pathway_assessment(id),
  status text NOT NULL CHECK(status IN (
    'NOT_CURRENTLY_REQUIRED','CONSIDER','REFERRAL_REQUESTED','REVIEWED','DECISION_DOCUMENTED','PROCEDURE_PLANNED'
  )),
  decision text NOT NULL DEFAULT '',
  rationale text NOT NULL DEFAULT '',
  planned_date date,
  observed_at timestamptz NOT NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS valve.surveillance_plan (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid REFERENCES care.encounter(id),
  valve_name text NOT NULL,
  lesion_type text NOT NULL,
  source_study_id uuid REFERENCES imaging.echo_study(id),
  echo_date date,
  clinical_review_date date,
  acceptable_start date,
  acceptable_end date,
  early_review_triggers jsonb NOT NULL DEFAULT '[]',
  rationale text NOT NULL,
  echo_task_id uuid REFERENCES workflow.clinical_task(id),
  clinical_task_id uuid REFERENCES workflow.clinical_task(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUPERSEDED','COMPLETED','CANCELLED')),
  supersedes_plan_id uuid REFERENCES valve.surveillance_plan(id),
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS valve.surveillance_status_event (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES valve.surveillance_plan(id),
  version integer NOT NULL CHECK(version > 0),
  status text NOT NULL CHECK(status IN ('ACTIVE','SUPERSEDED','COMPLETED','CANCELLED')),
  reason text NOT NULL DEFAULT '',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,version)
);

CREATE OR REPLACE VIEW valve.current_state AS
SELECT DISTINCT ON (e.patient_id,e.valve_name,e.lesion_type) e.*
FROM valve.state_event e
LEFT JOIN imaging.echo_study s ON s.id=e.source_study_id
ORDER BY e.patient_id,e.valve_name,e.lesion_type,
  CASE s.formality WHEN 'FORMAL' THEN 2 ELSE 1 END DESC,
  CASE e.quality WHEN 'GOOD' THEN 4 WHEN 'ADEQUATE' THEN 3 WHEN 'TECHNICALLY_LIMITED' THEN 2 ELSE 1 END DESC,
  e.observed_at DESC,e.created_at DESC;

DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'imaging.echo_study','imaging.echo_revision','imaging.echo_measurement',
    'imaging.valve_finding','imaging.quality_check','imaging.report_attachment',
    'valve.prosthesis','valve.procedure_record','valve.state_event',
    'valve.pathway_assessment','valve.heart_team_event','valve.surveillance_plan'
    ,'valve.surveillance_status_event'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', replace(target,'.','_') || '_immutable', target);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation()', replace(target,'.','_') || '_immutable', target);
  END LOOP;
END $$;
