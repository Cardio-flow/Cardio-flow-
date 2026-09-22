CREATE SCHEMA IF NOT EXISTS decision_support;

CREATE TABLE IF NOT EXISTS clinical.terminology_concept (
  system text NOT NULL,
  code text NOT NULL,
  version integer NOT NULL,
  display text NOT NULL,
  kind text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]',
  definition text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','retired')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(system,code,version)
);

CREATE TABLE IF NOT EXISTS clinical.unit_definition (
  code text NOT NULL,
  version integer NOT NULL,
  symbol text NOT NULL,
  dimension text NOT NULL,
  canonical_code text NOT NULL,
  factor numeric NOT NULL,
  conversion_offset numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','retired')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(code,version)
);

CREATE TABLE IF NOT EXISTS clinical.field_package (
  key text NOT NULL,
  version integer NOT NULL,
  definition jsonb NOT NULL,
  checksum text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','retired')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(key,version)
);

CREATE TABLE IF NOT EXISTS clinical.fact (
  id uuid PRIMARY KEY,
  logical_id uuid NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid,
  concept_system text NOT NULL,
  concept_code text NOT NULL,
  concept_version integer NOT NULL,
  value jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  effective_start timestamptz NOT NULL,
  effective_end timestamptz,
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_label text NOT NULL,
  source_quality text NOT NULL DEFAULT 'unknown' CHECK(source_quality IN ('unknown','low','moderate','high')),
  verification_status text NOT NULL DEFAULT 'unconfirmed' CHECK(verification_status IN ('unconfirmed','preliminary','verified','entered_in_error')),
  lifecycle_status text NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('active','resolved','retracted')),
  author text NOT NULL,
  supersedes_fact_id uuid REFERENCES clinical.fact(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id),
  FOREIGN KEY(concept_system,concept_code,concept_version) REFERENCES clinical.terminology_concept(system,code,version),
  UNIQUE(logical_id,version),
  CHECK(effective_end IS NULL OR effective_end > effective_start)
);
CREATE INDEX IF NOT EXISTS clinical_fact_patient_concept ON clinical.fact(patient_id,concept_system,concept_code,observed_at DESC);
CREATE INDEX IF NOT EXISTS clinical_fact_source ON clinical.fact(source_type,source_id);

CREATE TABLE IF NOT EXISTS clinical.current_preference (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  concept_system text NOT NULL,
  concept_code text NOT NULL,
  fact_id uuid REFERENCES clinical.fact(id),
  action text NOT NULL CHECK(action IN ('select','release')),
  reason text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((action='select' AND fact_id IS NOT NULL) OR action='release')
);
CREATE INDEX IF NOT EXISTS clinical_preference_patient ON clinical.current_preference(patient_id,concept_system,concept_code,created_at DESC);

CREATE TABLE IF NOT EXISTS clinical.event (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  fact_id uuid REFERENCES clinical.fact(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  actor text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinical_event_patient ON clinical.event(patient_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS decision_support.evidence_source (
  key text NOT NULL,
  version text NOT NULL,
  title text NOT NULL,
  organization text NOT NULL,
  publication_year integer,
  locator text NOT NULL DEFAULT '',
  reviewed_at date NOT NULL,
  supersedes_version text,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','retired')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(key,version)
);

CREATE TABLE IF NOT EXISTS decision_support.rule_definition (
  key text NOT NULL,
  version integer NOT NULL,
  topic text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')),
  priority integer NOT NULL CHECK(priority BETWEEN 1 AND 6),
  definition jsonb NOT NULL,
  checksum text NOT NULL,
  reviewed_at date,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(key,version)
);

CREATE TABLE IF NOT EXISTS decision_support.recommendation (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  rule_key text NOT NULL,
  rule_version integer NOT NULL,
  status text NOT NULL CHECK(status IN ('active','needs_data','resolved','excluded','suppressed')),
  title text NOT NULL,
  recommendation text NOT NULL,
  explanation jsonb NOT NULL DEFAULT '[]',
  missing_concepts jsonb NOT NULL DEFAULT '[]',
  input_fact_ids jsonb NOT NULL DEFAULT '[]',
  evidence_snapshot jsonb NOT NULL DEFAULT '[]',
  input_fingerprint text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  trigger_event_id uuid NOT NULL REFERENCES clinical.event(id),
  supersedes_recommendation_id uuid REFERENCES decision_support.recommendation(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(rule_key,rule_version) REFERENCES decision_support.rule_definition(key,version)
);
CREATE INDEX IF NOT EXISTS recommendation_patient_rule ON decision_support.recommendation(patient_id,rule_key,created_at DESC);

CREATE TABLE IF NOT EXISTS decision_support.alert (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  recommendation_id uuid NOT NULL REFERENCES decision_support.recommendation(id),
  fingerprint text NOT NULL,
  category text NOT NULL CHECK(category IN ('critical','clinical_review','monitoring','treatment_opportunity','administrative')),
  severity text NOT NULL CHECK(severity IN ('critical','high','moderate','low','information')),
  title text NOT NULL,
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_patient ON decision_support.alert(patient_id,created_at DESC);

CREATE TABLE IF NOT EXISTS decision_support.alert_action (
  id uuid PRIMARY KEY,
  alert_id uuid NOT NULL REFERENCES decision_support.alert(id),
  action text NOT NULL CHECK(action IN ('acknowledge','act','snooze','dismiss')),
  reason text NOT NULL DEFAULT '',
  snoozed_until timestamptz,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((action='snooze' AND snoozed_until IS NOT NULL) OR action<>'snooze')
);
CREATE INDEX IF NOT EXISTS alert_action_alert ON decision_support.alert_action(alert_id,created_at DESC);

CREATE TABLE IF NOT EXISTS workflow.clinical_task (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid,
  kind text NOT NULL CHECK(kind IN ('clinical_review','laboratory','follow_up','reassessment','administrative')),
  purpose text NOT NULL,
  related_concept text,
  target_date date,
  assigned_to text NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id)
);
CREATE INDEX IF NOT EXISTS clinical_task_patient ON workflow.clinical_task(patient_id,target_date,created_at DESC);

CREATE TABLE IF NOT EXISTS workflow.clinical_task_event (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES workflow.clinical_task(id),
  version integer NOT NULL CHECK(version > 0),
  status text NOT NULL CHECK(status IN ('open','in_progress','completed','cancelled','snoozed','superseded')),
  note text NOT NULL DEFAULT '',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id,version)
);

CREATE TABLE IF NOT EXISTS decision_support.pathway_definition (
  key text NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')),
  definition jsonb NOT NULL,
  checksum text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(key,version)
);

CREATE TABLE IF NOT EXISTS decision_support.pathway_session (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  pathway_key text NOT NULL,
  pathway_version integer NOT NULL,
  encounter_id uuid,
  started_by text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(pathway_key,pathway_version) REFERENCES decision_support.pathway_definition(key,version),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id)
);

CREATE TABLE IF NOT EXISTS decision_support.pathway_response (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES decision_support.pathway_session(id),
  node_id text NOT NULL,
  response jsonb NOT NULL,
  known_fact_id uuid REFERENCES clinical.fact(id),
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS decision_support.recalculation_run (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  trigger_event_id uuid NOT NULL REFERENCES clinical.event(id),
  engine_version text NOT NULL,
  result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trigger_event_id,engine_version)
);

DROP TRIGGER IF EXISTS terminology_immutable ON clinical.terminology_concept;
CREATE TRIGGER terminology_immutable BEFORE UPDATE OR DELETE ON clinical.terminology_concept FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS unit_definition_immutable ON clinical.unit_definition;
CREATE TRIGGER unit_definition_immutable BEFORE UPDATE OR DELETE ON clinical.unit_definition FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS field_package_immutable ON clinical.field_package;
CREATE TRIGGER field_package_immutable BEFORE UPDATE OR DELETE ON clinical.field_package FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS clinical_fact_immutable ON clinical.fact;
CREATE TRIGGER clinical_fact_immutable BEFORE UPDATE OR DELETE ON clinical.fact FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS clinical_preference_immutable ON clinical.current_preference;
CREATE TRIGGER clinical_preference_immutable BEFORE UPDATE OR DELETE ON clinical.current_preference FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS clinical_event_immutable ON clinical.event;
CREATE TRIGGER clinical_event_immutable BEFORE UPDATE OR DELETE ON clinical.event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS evidence_source_immutable ON decision_support.evidence_source;
CREATE TRIGGER evidence_source_immutable BEFORE UPDATE OR DELETE ON decision_support.evidence_source FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS rule_definition_immutable ON decision_support.rule_definition;
CREATE TRIGGER rule_definition_immutable BEFORE UPDATE OR DELETE ON decision_support.rule_definition FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS recommendation_immutable ON decision_support.recommendation;
CREATE TRIGGER recommendation_immutable BEFORE UPDATE OR DELETE ON decision_support.recommendation FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS clinical_alert_immutable ON decision_support.alert;
CREATE TRIGGER clinical_alert_immutable BEFORE UPDATE OR DELETE ON decision_support.alert FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS alert_action_immutable ON decision_support.alert_action;
CREATE TRIGGER alert_action_immutable BEFORE UPDATE OR DELETE ON decision_support.alert_action FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS clinical_task_immutable ON workflow.clinical_task;
CREATE TRIGGER clinical_task_immutable BEFORE UPDATE OR DELETE ON workflow.clinical_task FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS clinical_task_event_immutable ON workflow.clinical_task_event;
CREATE TRIGGER clinical_task_event_immutable BEFORE UPDATE OR DELETE ON workflow.clinical_task_event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS pathway_definition_immutable ON decision_support.pathway_definition;
CREATE TRIGGER pathway_definition_immutable BEFORE UPDATE OR DELETE ON decision_support.pathway_definition FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS pathway_session_immutable ON decision_support.pathway_session;
CREATE TRIGGER pathway_session_immutable BEFORE UPDATE OR DELETE ON decision_support.pathway_session FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS pathway_response_immutable ON decision_support.pathway_response;
CREATE TRIGGER pathway_response_immutable BEFORE UPDATE OR DELETE ON decision_support.pathway_response FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS recalculation_run_immutable ON decision_support.recalculation_run;
CREATE TRIGGER recalculation_run_immutable BEFORE UPDATE OR DELETE ON decision_support.recalculation_run FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
