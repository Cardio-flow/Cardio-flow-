-- CardioFlow v2 kernel. One schema, one migration. Everything clinical is
-- append-only: corrections add a new version and never overwrite history.
CREATE SCHEMA IF NOT EXISTS cf;

CREATE TABLE IF NOT EXISTS cf.site (
  id text PRIMARY KEY,
  name text NOT NULL,
  -- sandbox sites may run DRAFT/CLINICAL_REVIEW rules for testing, clearly labelled.
  -- production sites only ever run PUBLISHED rules.
  mode text NOT NULL CHECK (mode IN ('sandbox','production')),
  settings jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS cf.member (
  email text PRIMARY KEY,
  user_id text UNIQUE,
  site_id text NOT NULL REFERENCES cf.site(id),
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('clinician','reviewer','admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cf.patient (
  id uuid PRIMARY KEY,
  site_id text NOT NULL REFERENCES cf.site(id),
  mrn text NOT NULL,
  name text NOT NULL,
  sex text NOT NULL CHECK (sex IN ('Male','Female')),
  birth_date date NOT NULL,
  allergies text NOT NULL DEFAULT 'Not recorded',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, mrn)
);

-- Admission, clinic visit, ED visit, procedure, phone follow-up.
CREATE TABLE IF NOT EXISTS cf.care_context (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  kind text NOT NULL CHECK (kind IN ('admission','clinic_visit','ed_visit','procedure','phone')),
  status text NOT NULL CHECK (status IN ('open','closed')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  location text,
  service text,
  reasons text[] NOT NULL DEFAULT '{}',
  previous_context_id uuid REFERENCES cf.care_context(id),
  summary jsonb NOT NULL DEFAULT '{}',
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Diagnoses and comorbidities. logical_id groups versions of one problem.
CREATE TABLE IF NOT EXISTS cf.condition (
  id uuid PRIMARY KEY,
  logical_id uuid NOT NULL,
  version int NOT NULL,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  code text NOT NULL,
  display text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','resolved','entered_in_error')),
  onset date,
  detail text NOT NULL DEFAULT '',
  context_id uuid REFERENCES cf.care_context(id),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (logical_id, version)
);

-- Imaging / ECG studies. Their measurements live in cf.observation.
CREATE TABLE IF NOT EXISTS cf.study (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  kind text NOT NULL CHECK (kind IN ('echo','ecg')),
  performed_at timestamptz NOT NULL,
  quality text NOT NULL CHECK (quality IN ('formal','limited','bedside')),
  findings text[] NOT NULL DEFAULT '{}',
  conclusion text NOT NULL DEFAULT '',
  context_id uuid REFERENCES cf.care_context(id),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Every measured or calculated value: labs, vitals, echo measurements, scores.
CREATE TABLE IF NOT EXISTS cf.observation (
  id uuid PRIMARY KEY,
  logical_id uuid NOT NULL,
  version int NOT NULL,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  code text NOT NULL,
  value_num double precision,
  value_text text,
  unit text,
  original_value double precision,
  original_unit text,
  effective_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('final','preliminary','entered_in_error')),
  quality text NOT NULL DEFAULT 'standard' CHECK (quality IN ('standard','formal','limited','bedside')),
  source text NOT NULL DEFAULT 'clinician entry',
  method text,
  derived_from uuid[] NOT NULL DEFAULT '{}',
  study_id uuid REFERENCES cf.study(id),
  context_id uuid REFERENCES cf.care_context(id),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (logical_id, version)
);
CREATE INDEX IF NOT EXISTS observation_patient_code ON cf.observation(patient_id, code, effective_at DESC);

-- Clinician choice of which value is "current" when the newest is not the best.
CREATE TABLE IF NOT EXISTS cf.value_preference (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  code text NOT NULL,
  observation_id uuid NOT NULL REFERENCES cf.observation(id),
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  chosen_by text NOT NULL,
  chosen_at timestamptz NOT NULL DEFAULT now()
);

-- A therapy line (one drug for one patient) and its immutable events.
CREATE TABLE IF NOT EXISTS cf.medication (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  drug text NOT NULL,
  indication text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cf.medication_event (
  id uuid PRIMARY KEY,
  medication_id uuid NOT NULL REFERENCES cf.medication(id),
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  kind text NOT NULL CHECK (kind IN ('start','increase','decrease','hold','restart','stop','continue','planned')),
  dose_value double precision,
  dose_unit text,
  frequency text,
  route text,
  reason text NOT NULL DEFAULT '',
  effective_at timestamptz NOT NULL,
  context_id uuid REFERENCES cf.care_context(id),
  decision_id uuid,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- Governed rules. Logic is code; thresholds and wording are versioned parameters.
CREATE TABLE IF NOT EXISTS cf.rule_version (
  rule_id text NOT NULL,
  version int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('clinical','operational')),
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','CLINICAL_REVIEW','APPROVED','PUBLISHED','RETIRED')),
  params jsonb NOT NULL DEFAULT '{}',
  evidence text NOT NULL DEFAULT '',
  author text NOT NULL,
  reviewer text,
  review_note text,
  published_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, version)
);
CREATE TABLE IF NOT EXISTS cf.rule_event (
  id uuid PRIMARY KEY,
  rule_id text NOT NULL,
  version int NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor text NOT NULL,
  note text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);

-- Rule output. One active row per rule finding; old ones are superseded, never deleted.
CREATE TABLE IF NOT EXISTS cf.recommendation (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  rule_id text NOT NULL,
  rule_version int NOT NULL,
  rule_status text NOT NULL,
  fingerprint text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('red','orange','yellow','blue')),
  title text NOT NULL,
  detail text NOT NULL,
  facts jsonb NOT NULL DEFAULT '[]',
  missing jsonb NOT NULL DEFAULT '[]',
  action jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL CHECK (status IN ('active','superseded','resolved','decided')),
  superseded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS recommendation_active ON cf.recommendation(patient_id) WHERE status='active';

-- What the clinician did with a recommendation (or a free-standing decision).
CREATE TABLE IF NOT EXISTS cf.decision (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  recommendation_id uuid REFERENCES cf.recommendation(id),
  wizard text,
  outcome text NOT NULL CHECK (outcome IN ('acted','declined','deferred')),
  answers jsonb NOT NULL DEFAULT '{}',
  reason text NOT NULL DEFAULT '',
  context_id uuid REFERENCES cf.care_context(id),
  decided_by text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);

-- The plan. A plan action with a due date IS the task; worklist and "due"/"overdue"
-- are views of this table, not separate objects.
CREATE TABLE IF NOT EXISTS cf.plan_action (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  category text NOT NULL CHECK (category IN ('medication','investigation','monitoring','follow_up','referral','procedure','education','other')),
  title text NOT NULL,
  reason text NOT NULL DEFAULT '',
  due_date date,
  -- how the action completes itself: {"type":"lab","codes":["potassium"]} / {"type":"visit"} / {"type":"study","kind":"echo"} / {"type":"manual"}
  completes_on jsonb NOT NULL DEFAULT '{"type":"manual"}',
  status text NOT NULL CHECK (status IN ('planned','completed','deferred','cancelled','superseded')),
  outcome text NOT NULL DEFAULT '',
  completed_at timestamptz,
  completed_by_ref text,
  source_context_id uuid REFERENCES cf.care_context(id),
  decision_id uuid REFERENCES cf.decision(id),
  medication_id uuid REFERENCES cf.medication(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS plan_open ON cf.plan_action(patient_id) WHERE status='planned';

-- Wizard drafts survive an accidental close.
CREATE TABLE IF NOT EXISTS cf.wizard_draft (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  wizard text NOT NULL,
  recommendation_id uuid,
  answers jsonb NOT NULL DEFAULT '{}',
  step int NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('draft','completed','cancelled')),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The patient journey: one row per clinically meaningful event.
CREATE TABLE IF NOT EXISTS cf.clinical_event (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES cf.patient(id),
  occurred_at timestamptz NOT NULL,
  kind text NOT NULL,
  category text NOT NULL CHECK (category IN ('visit','investigation','medication','procedure','complication','plan')),
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  ref_type text,
  ref_id uuid,
  context_id uuid REFERENCES cf.care_context(id),
  planned boolean NOT NULL DEFAULT false,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clinical_event_patient ON cf.clinical_event(patient_id, occurred_at);

CREATE TABLE IF NOT EXISTS cf.audit (
  id uuid PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text NOT NULL,
  patient_id uuid,
  detail jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);

-- Append-only guards: clinical history can never be updated or deleted.
CREATE OR REPLACE FUNCTION cf.forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CardioFlow clinical history is append-only (%).', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['observation','condition','medication_event','clinical_event','audit','decision','rule_event','study']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'append_only_' || t) THEN
      EXECUTE format('CREATE TRIGGER append_only_%s BEFORE UPDATE OR DELETE ON cf.%I FOR EACH ROW EXECUTE FUNCTION cf.forbid_change()', t, t);
    END IF;
  END LOOP;
END $$;
