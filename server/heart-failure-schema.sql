CREATE SCHEMA IF NOT EXISTS heart_failure;

CREATE TABLE IF NOT EXISTS heart_failure.profile (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL UNIQUE REFERENCES core.patient(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS heart_failure.review_event (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES heart_failure.profile(id),
  version integer NOT NULL CHECK(version > 0),
  encounter_id uuid,
  status text NOT NULL CHECK(status IN (
    'AT_RISK','PRE_HF','CURRENT_SYMPTOMATIC','PREVIOUS_STABLE',
    'DECOMPENSATED','ADVANCED'
  )),
  presentation text NOT NULL CHECK(presentation IN (
    'NEWLY_DIAGNOSED','CHRONIC_STABLE','ACUTE_DECOMPENSATION',
    'POST_DISCHARGE','WORSENING_OUTPATIENT','RECURRENT_ADMISSION',
    'ADVANCED_ASSESSMENT'
  )),
  symptoms jsonb NOT NULL DEFAULT '[]',
  symptoms_reviewed_unchanged boolean NOT NULL DEFAULT false,
  nyha_class text CHECK(nyha_class IN ('I','II','III','IV','NOT_ASSESSED')),
  etiologies jsonb NOT NULL DEFAULT '[]',
  physical_findings jsonb NOT NULL DEFAULT '{}',
  clinician_congestion text CHECK(clinician_congestion IN (
    'NO_EVIDENT_CONGESTION','POSSIBLE_CONGESTION','CLINICALLY_CONGESTED',
    'SEVERE_OR_WORSENING','NOT_ASSESSED'
  )),
  clinician_phenotype text CHECK(clinician_phenotype IN ('HFrEF','HFpEF','UNCLASSIFIED')),
  phenotype_source_echo_id uuid,
  therapy_decisions jsonb NOT NULL DEFAULT '[]',
  narrative text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_id,version),
  FOREIGN KEY(encounter_id) REFERENCES care.encounter(id)
);
CREATE INDEX IF NOT EXISTS hf_review_profile_time
  ON heart_failure.review_event(profile_id,observed_at DESC,version DESC);

CREATE TABLE IF NOT EXISTS heart_failure.echo_observation (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES heart_failure.profile(id),
  encounter_id uuid,
  study_type text NOT NULL CHECK(study_type IN ('FORMAL_TTE','LIMITED_TTE','TEE','CMR','OTHER')),
  study_quality text NOT NULL CHECK(study_quality IN ('GOOD','FAIR','POOR','NOT_RECORDED')),
  observed_at timestamptz NOT NULL,
  lvef numeric CHECK(lvef >= 0 AND lvef <= 100),
  lvef_fact_id uuid REFERENCES clinical.fact(id),
  rv_function text CHECK(rv_function IN ('NORMAL','MILDLY_REDUCED','MODERATELY_REDUCED','SEVERELY_REDUCED','NOT_REPORTED')),
  valve_summary jsonb NOT NULL DEFAULT '[]',
  pulmonary_pressure_context text NOT NULL DEFAULT '',
  diastolic_context text NOT NULL DEFAULT '',
  pericardial_context text NOT NULL DEFAULT '',
  structural_context text NOT NULL DEFAULT '',
  source_label text NOT NULL,
  verification_status text NOT NULL CHECK(verification_status IN ('preliminary','verified')),
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id) REFERENCES care.encounter(id)
);
CREATE INDEX IF NOT EXISTS hf_echo_profile_time
  ON heart_failure.echo_observation(profile_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS heart_failure.pathway_assessment (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES heart_failure.profile(id),
  encounter_id uuid,
  pathway_type text NOT NULL CHECK(pathway_type IN (
    'DIAGNOSTIC','CONGESTION','DECOMPENSATED_HF','WORSENING_RENAL_FUNCTION',
    'HYPERKALAEMIA','HYPOTENSION','BRADYCARDIA','HYPONATRAEMIA',
    'IRON_OR_ANAEMIA','DIURETIC_RESPONSE','ADVANCED_HF'
  )),
  state text NOT NULL,
  severity text NOT NULL CHECK(severity IN ('NOT_ASSESSED','LOW','MODERATE','HIGH','CRITICAL')),
  patient_data jsonb NOT NULL DEFAULT '{}',
  missing_information jsonb NOT NULL DEFAULT '[]',
  considerations jsonb NOT NULL DEFAULT '[]',
  medication_implications jsonb NOT NULL DEFAULT '[]',
  monitoring_plan jsonb NOT NULL DEFAULT '{}',
  escalation text NOT NULL DEFAULT '',
  evidence_note text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id) REFERENCES care.encounter(id)
);
CREATE INDEX IF NOT EXISTS hf_pathway_profile_time
  ON heart_failure.pathway_assessment(profile_id,pathway_type,observed_at DESC);

CREATE TABLE IF NOT EXISTS heart_failure.device_assessment (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES heart_failure.profile(id),
  encounter_id uuid,
  device_type text NOT NULL CHECK(device_type IN ('ICD','CRT')),
  assessment_status text NOT NULL CHECK(assessment_status IN (
    'POTENTIAL_ASSESSMENT','CRITERIA_NOT_MET','CANNOT_ASSESS','REASSESSMENT_PLANNED',
    'EXISTING_DEVICE','NOT_APPROPRIATE_AFTER_REVIEW'
  )),
  input_snapshot jsonb NOT NULL DEFAULT '{}',
  missing_information jsonb NOT NULL DEFAULT '[]',
  rationale text NOT NULL,
  reassessment_date date,
  task_id uuid REFERENCES workflow.clinical_task(id),
  observed_at timestamptz NOT NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id) REFERENCES care.encounter(id)
);
CREATE INDEX IF NOT EXISTS hf_device_profile_time
  ON heart_failure.device_assessment(profile_id,device_type,observed_at DESC);

CREATE TABLE IF NOT EXISTS heart_failure.discharge_review (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES heart_failure.profile(id),
  encounter_id uuid,
  clinical_stability text NOT NULL CHECK(clinical_stability IN ('CONFIRMED','NOT_CONFIRMED','NOT_ASSESSED')),
  congestion_reviewed boolean NOT NULL DEFAULT false,
  medication_reconciliation boolean NOT NULL DEFAULT false,
  renal_electrolytes_reviewed boolean NOT NULL DEFAULT false,
  titration_plan_reviewed boolean NOT NULL DEFAULT false,
  education_reviewed boolean NOT NULL DEFAULT false,
  rehabilitation_reviewed boolean NOT NULL DEFAULT false,
  outstanding_items jsonb NOT NULL DEFAULT '[]',
  laboratory_date date,
  clinic_date date,
  echo_date date,
  device_reassessment_date date,
  note text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id) REFERENCES care.encounter(id)
);
CREATE INDEX IF NOT EXISTS hf_discharge_profile_time
  ON heart_failure.discharge_review(profile_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS heart_failure.rehabilitation_assessment (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES heart_failure.profile(id),
  encounter_id uuid,
  status text NOT NULL CHECK(status IN (
    'NOT_ASSESSED','ELIGIBILITY_REVIEWED','REFERRED','PLANNED','STARTED',
    'COMPLETED','DEFERRED','NOT_APPROPRIATE'
  )),
  limitation text NOT NULL DEFAULT '',
  referral_date date,
  planned_start_date date,
  exercise_context text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  observed_at timestamptz NOT NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id) REFERENCES care.encounter(id)
);
CREATE INDEX IF NOT EXISTS hf_rehabilitation_profile_time
  ON heart_failure.rehabilitation_assessment(profile_id,observed_at DESC);

CREATE OR REPLACE VIEW heart_failure.current_review AS
SELECT DISTINCT ON (profile_id) *
FROM heart_failure.review_event
ORDER BY profile_id,observed_at DESC,version DESC;

CREATE OR REPLACE VIEW heart_failure.current_rehabilitation AS
SELECT DISTINCT ON (profile_id) *
FROM heart_failure.rehabilitation_assessment
ORDER BY profile_id,observed_at DESC,created_at DESC;

DROP TRIGGER IF EXISTS hf_profile_immutable ON heart_failure.profile;
CREATE TRIGGER hf_profile_immutable BEFORE UPDATE OR DELETE ON heart_failure.profile
FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS hf_review_immutable ON heart_failure.review_event;
CREATE TRIGGER hf_review_immutable BEFORE UPDATE OR DELETE ON heart_failure.review_event
FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS hf_echo_immutable ON heart_failure.echo_observation;
CREATE TRIGGER hf_echo_immutable BEFORE UPDATE OR DELETE ON heart_failure.echo_observation
FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS hf_pathway_immutable ON heart_failure.pathway_assessment;
CREATE TRIGGER hf_pathway_immutable BEFORE UPDATE OR DELETE ON heart_failure.pathway_assessment
FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS hf_device_immutable ON heart_failure.device_assessment;
CREATE TRIGGER hf_device_immutable BEFORE UPDATE OR DELETE ON heart_failure.device_assessment
FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS hf_discharge_immutable ON heart_failure.discharge_review;
CREATE TRIGGER hf_discharge_immutable BEFORE UPDATE OR DELETE ON heart_failure.discharge_review
FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS hf_rehabilitation_immutable ON heart_failure.rehabilitation_assessment;
CREATE TRIGGER hf_rehabilitation_immutable BEFORE UPDATE OR DELETE ON heart_failure.rehabilitation_assessment
FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
