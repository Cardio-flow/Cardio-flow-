CREATE SCHEMA IF NOT EXISTS medication;
CREATE SCHEMA IF NOT EXISTS laboratory;

-- Generic clinical medication content is versioned and site independent.
CREATE TABLE IF NOT EXISTS medication.generic_definition (
  medication_id text NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  generic_name text NOT NULL,
  drug_class text NOT NULL,
  subclass text NOT NULL DEFAULT '',
  cardiovascular_category text NOT NULL,
  common_frequencies jsonb NOT NULL DEFAULT '[]',
  dose_metadata jsonb NOT NULL DEFAULT '{}',
  renal_metadata jsonb NOT NULL DEFAULT '{}',
  hepatic_metadata jsonb NOT NULL DEFAULT '{}',
  pregnancy_metadata jsonb NOT NULL DEFAULT '{}',
  contraindications jsonb NOT NULL DEFAULT '[]',
  cautions jsonb NOT NULL DEFAULT '[]',
  monitoring_metadata jsonb NOT NULL DEFAULT '[]',
  adverse_effects jsonb NOT NULL DEFAULT '[]',
  interaction_metadata jsonb NOT NULL DEFAULT '[]',
  evidence_links jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  reviewed_on date,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(medication_id,version)
);

CREATE TABLE IF NOT EXISTS medication.formulation (
  id uuid PRIMARY KEY,
  medication_id text NOT NULL,
  medication_version integer NOT NULL,
  form text NOT NULL,
  strength_value numeric,
  strength_unit text,
  route text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(medication_id,medication_version)
    REFERENCES medication.generic_definition(medication_id,version)
);

CREATE TABLE IF NOT EXISTS medication.clinical_group (
  group_id text NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  name text NOT NULL,
  parent_group_id text,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,version)
);

CREATE TABLE IF NOT EXISTS medication.group_member (
  group_id text NOT NULL,
  group_version integer NOT NULL,
  medication_id text NOT NULL,
  medication_version integer NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,group_version,medication_id,medication_version),
  FOREIGN KEY(group_id,group_version)
    REFERENCES medication.clinical_group(group_id,version),
  FOREIGN KEY(medication_id,medication_version)
    REFERENCES medication.generic_definition(medication_id,version)
);

-- Trade names and formulary availability are isolated by site.
CREATE TABLE IF NOT EXISTS medication.site_product (
  id uuid PRIMARY KEY,
  site_id text NOT NULL,
  medication_id text NOT NULL,
  medication_version integer NOT NULL,
  trade_name text NOT NULL,
  formulation_id uuid REFERENCES medication.formulation(id),
  local_code text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(medication_id,medication_version)
    REFERENCES medication.generic_definition(medication_id,version)
);
CREATE INDEX IF NOT EXISTS site_product_search
  ON medication.site_product(site_id,trade_name);

CREATE TABLE IF NOT EXISTS medication.site_product_event (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES medication.site_product(id),
  version integer NOT NULL CHECK(version > 0),
  formulary_status text NOT NULL CHECK(formulary_status IN ('available','restricted','unavailable','unknown')),
  note text NOT NULL DEFAULT '',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id,version)
);

CREATE TABLE IF NOT EXISTS medication.indication_definition (
  code text NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  display text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(code,version)
);

-- A therapy identifies a longitudinal course. Every clinical change is an event.
CREATE TABLE IF NOT EXISTS medication.therapy (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid,
  medication_id text NOT NULL,
  medication_version integer NOT NULL,
  selected_product_id uuid REFERENCES medication.site_product(id),
  source_type text NOT NULL,
  source_id text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id),
  FOREIGN KEY(medication_id,medication_version)
    REFERENCES medication.generic_definition(medication_id,version)
);
CREATE INDEX IF NOT EXISTS therapy_patient ON medication.therapy(patient_id,created_at DESC);

CREATE TABLE IF NOT EXISTS medication.therapy_event (
  id uuid PRIMARY KEY,
  therapy_id uuid NOT NULL REFERENCES medication.therapy(id),
  version integer NOT NULL CHECK(version > 0),
  status text NOT NULL CHECK(status IN ('ACTIVE','TEMPORARILY_HELD','STOPPED','PLANNED')),
  event_type text NOT NULL CHECK(event_type IN ('started','dose_increased','dose_decreased','held','restarted','stopped','planned','corrected')),
  dose_value numeric,
  dose_unit text,
  frequency text,
  route text,
  effective_at timestamptz NOT NULL,
  indications jsonb NOT NULL DEFAULT '[]',
  prescribing_clinician text NOT NULL,
  reason text NOT NULL DEFAULT '',
  discontinuation_date date,
  adherence text,
  target_dose_value numeric,
  target_dose_unit text,
  planned_next_dose_value numeric,
  planned_next_dose_unit text,
  planned_titration_date date,
  comments text NOT NULL DEFAULT '',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(therapy_id,version),
  CHECK((dose_value IS NULL AND dose_unit IS NULL) OR (dose_value IS NOT NULL AND dose_unit IS NOT NULL)),
  CHECK(status<>'STOPPED' OR discontinuation_date IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS therapy_event_current ON medication.therapy_event(therapy_id,version DESC);

CREATE TABLE IF NOT EXISTS medication.adverse_reaction (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  medication_id text,
  substance_text text NOT NULL,
  reaction_type text NOT NULL CHECK(reaction_type IN ('ALLERGY','INTOLERANCE','SIDE_EFFECT','UNKNOWN_REACTION')),
  reaction text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('unknown','mild','moderate','severe','life_threatening')),
  observed_on date,
  source_type text NOT NULL,
  source_id text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS adverse_reaction_patient ON medication.adverse_reaction(patient_id,created_at DESC);

CREATE TABLE IF NOT EXISTS medication.adverse_reaction_event (
  id uuid PRIMARY KEY,
  reaction_id uuid NOT NULL REFERENCES medication.adverse_reaction(id),
  version integer NOT NULL CHECK(version > 0),
  status text NOT NULL CHECK(status IN ('active','entered_in_error','resolved')),
  note text NOT NULL DEFAULT '',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reaction_id,version)
);

CREATE TABLE IF NOT EXISTS laboratory.test_definition (
  test_id text NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  display text NOT NULL,
  category text NOT NULL,
  canonical_unit text NOT NULL,
  accepted_units jsonb NOT NULL DEFAULT '[]',
  specimen_options jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  reviewed_on date,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(test_id,version)
);

CREATE TABLE IF NOT EXISTS laboratory.result (
  id uuid PRIMARY KEY,
  logical_id uuid NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid,
  test_id text NOT NULL,
  test_version integer NOT NULL,
  original_value numeric NOT NULL,
  original_unit text NOT NULL,
  canonical_value numeric NOT NULL,
  canonical_unit text NOT NULL,
  specimen text,
  collected_at timestamptz NOT NULL,
  resulted_at timestamptz NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_label text NOT NULL,
  laboratory_name text,
  reference_low numeric,
  reference_high numeric,
  abnormal_flag text CHECK(abnormal_flag IN ('low','high','critical_low','critical_high','normal','unknown')),
  verification_status text NOT NULL CHECK(verification_status IN ('unconfirmed','preliminary','verified','entered_in_error')),
  provenance jsonb NOT NULL DEFAULT '{}',
  calculation_method text,
  calculation_version text,
  calculation_inputs jsonb NOT NULL DEFAULT '[]',
  supersedes_result_id uuid REFERENCES laboratory.result(id),
  clinical_fact_id uuid NOT NULL REFERENCES clinical.fact(id),
  author text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(logical_id,version),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id),
  FOREIGN KEY(test_id,test_version) REFERENCES laboratory.test_definition(test_id,version),
  CHECK(resulted_at >= collected_at)
);
CREATE INDEX IF NOT EXISTS laboratory_result_trend
  ON laboratory.result(patient_id,test_id,collected_at DESC);

-- Architecture-only mappings declare relevant observations, never thresholds.
CREATE TABLE IF NOT EXISTS medication.monitoring_relation (
  medication_id text NOT NULL,
  medication_version integer NOT NULL,
  parameter_type text NOT NULL CHECK(parameter_type IN ('laboratory','vital','clinical','ecg','procedure')),
  parameter_code text NOT NULL,
  purpose text NOT NULL,
  priority text NOT NULL CHECK(priority IN ('required','recommended','contextual')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(medication_id,medication_version,parameter_type,parameter_code,purpose),
  FOREIGN KEY(medication_id,medication_version)
    REFERENCES medication.generic_definition(medication_id,version)
);

CREATE TABLE IF NOT EXISTS medication.titration_plan (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  therapy_id uuid NOT NULL REFERENCES medication.therapy(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS medication.titration_event (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES medication.titration_plan(id),
  version integer NOT NULL CHECK(version > 0),
  state text NOT NULL CHECK(state IN ('NOT_REQUIRED','TITRATION_PLANNED','WAITING_FOR_MONITORING','READY_FOR_REVIEW','TITRATION_DEFERRED','TARGET_ACHIEVED','MAXIMALLY_TOLERATED','STOPPED')),
  current_dose jsonb NOT NULL DEFAULT '{}',
  planned_dose jsonb NOT NULL DEFAULT '{}',
  required_checks jsonb NOT NULL DEFAULT '[]',
  earliest_review_date date,
  planned_titration_date date,
  next_laboratory_date date,
  limitation_type text CHECK(limitation_type IN ('ABSOLUTE_CONTRAINDICATION','DOSE_LIMITATION','CURRENT_TITRATION_LIMITATION')),
  limitation_reason text NOT NULL DEFAULT '',
  clinician_confirmed boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id,version)
);

ALTER TABLE workflow.clinical_task
  ADD COLUMN IF NOT EXISTS medication_therapy_id uuid REFERENCES medication.therapy(id),
  ADD COLUMN IF NOT EXISTS acceptable_window_start date,
  ADD COLUMN IF NOT EXISTS acceptable_window_end date,
  ADD COLUMN IF NOT EXISTS rule_key text,
  ADD COLUMN IF NOT EXISTS rule_version integer;

CREATE OR REPLACE VIEW medication.current_therapy AS
SELECT t.*,e.id event_id,e.version event_version,e.status,e.event_type,
       e.dose_value,e.dose_unit,e.frequency,e.route,e.effective_at,e.indications,
       e.prescribing_clinician,e.reason,e.discontinuation_date,e.adherence,
       e.target_dose_value,e.target_dose_unit,e.planned_next_dose_value,
       e.planned_next_dose_unit,e.planned_titration_date,e.comments,e.created_at event_created_at
FROM medication.therapy t
JOIN medication.therapy_event e ON e.therapy_id=t.id
WHERE e.version=(SELECT max(latest.version) FROM medication.therapy_event latest WHERE latest.therapy_id=t.id);

CREATE OR REPLACE VIEW medication.current_titration AS
SELECT p.*,e.id event_id,e.version event_version,e.state,e.current_dose,e.planned_dose,
       e.required_checks,e.earliest_review_date,e.planned_titration_date,
       e.next_laboratory_date,e.limitation_type,e.limitation_reason,
       e.clinician_confirmed,e.note,e.created_at event_created_at
FROM medication.titration_plan p
JOIN medication.titration_event e ON e.plan_id=p.id
WHERE e.version=(SELECT max(latest.version) FROM medication.titration_event latest WHERE latest.plan_id=p.id);

-- Clinical history and catalogue versions are immutable. Corrections append versions/events.
DROP TRIGGER IF EXISTS medication_generic_immutable ON medication.generic_definition;
CREATE TRIGGER medication_generic_immutable BEFORE UPDATE OR DELETE ON medication.generic_definition FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS medication_formulation_immutable ON medication.formulation;
CREATE TRIGGER medication_formulation_immutable BEFORE UPDATE OR DELETE ON medication.formulation FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS medication_group_immutable ON medication.clinical_group;
CREATE TRIGGER medication_group_immutable BEFORE UPDATE OR DELETE ON medication.clinical_group FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS medication_group_member_immutable ON medication.group_member;
CREATE TRIGGER medication_group_member_immutable BEFORE UPDATE OR DELETE ON medication.group_member FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS medication_product_immutable ON medication.site_product;
CREATE TRIGGER medication_product_immutable BEFORE UPDATE OR DELETE ON medication.site_product FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS medication_product_event_immutable ON medication.site_product_event;
CREATE TRIGGER medication_product_event_immutable BEFORE UPDATE OR DELETE ON medication.site_product_event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS medication_therapy_immutable ON medication.therapy;
CREATE TRIGGER medication_therapy_immutable BEFORE UPDATE OR DELETE ON medication.therapy FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS medication_therapy_event_immutable ON medication.therapy_event;
CREATE TRIGGER medication_therapy_event_immutable BEFORE UPDATE OR DELETE ON medication.therapy_event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS medication_reaction_immutable ON medication.adverse_reaction;
CREATE TRIGGER medication_reaction_immutable BEFORE UPDATE OR DELETE ON medication.adverse_reaction FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS medication_reaction_event_immutable ON medication.adverse_reaction_event;
CREATE TRIGGER medication_reaction_event_immutable BEFORE UPDATE OR DELETE ON medication.adverse_reaction_event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS laboratory_test_immutable ON laboratory.test_definition;
CREATE TRIGGER laboratory_test_immutable BEFORE UPDATE OR DELETE ON laboratory.test_definition FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS laboratory_result_immutable ON laboratory.result;
CREATE TRIGGER laboratory_result_immutable BEFORE UPDATE OR DELETE ON laboratory.result FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS monitoring_relation_immutable ON medication.monitoring_relation;
CREATE TRIGGER monitoring_relation_immutable BEFORE UPDATE OR DELETE ON medication.monitoring_relation FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS titration_plan_immutable ON medication.titration_plan;
CREATE TRIGGER titration_plan_immutable BEFORE UPDATE OR DELETE ON medication.titration_plan FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS titration_event_immutable ON medication.titration_event;
CREATE TRIGGER titration_event_immutable BEFORE UPDATE OR DELETE ON medication.titration_event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
