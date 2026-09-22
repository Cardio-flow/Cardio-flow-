CREATE SCHEMA IF NOT EXISTS decision_support;

-- Hosted migration bootstrap creates this table before versioned migrations.
-- Keeping the additive migration self-contained also supports fresh local and
-- test databases that apply schema files directly.
CREATE TABLE IF NOT EXISTS governance.membership (
  email text PRIMARY KEY,
  user_id text UNIQUE,
  role text NOT NULL CHECK(role IN ('clinician','reviewer','analyst','designer')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Capabilities are deliberately independent of application roles. A technical
-- administrator is not implicitly a clinical reviewer.
CREATE TABLE IF NOT EXISTS governance.capability_event (
  id uuid PRIMARY KEY,
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  site_id text NOT NULL,
  subject text NOT NULL,
  capability text NOT NULL CHECK(capability IN ('clinical_rule_maker','clinical_rule_reviewer','technical_admin')),
  action text NOT NULL CHECK(action IN ('grant','revoke')),
  reason text NOT NULL DEFAULT '',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capability_event_lookup
  ON governance.capability_event(site_id,subject,capability,created_at DESC);

-- Extend the immutable evidence version with searchable, non-copyrighted
-- metadata. Lifecycle changes are recorded below rather than mutating it.
ALTER TABLE decision_support.evidence_source
  ADD COLUMN IF NOT EXISTS topic text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'guideline',
  ADD COLUMN IF NOT EXISTS publication_date date,
  ADD COLUMN IF NOT EXISTS authoritative_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS doi text,
  ADD COLUMN IF NOT EXISTS last_verified_at date,
  ADD COLUMN IF NOT EXISTS next_review_date date,
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS decision_support.evidence_status_event (
  id uuid PRIMARY KEY,
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  evidence_key text NOT NULL,
  evidence_version text NOT NULL,
  status text NOT NULL CHECK(status IN ('current','superseded','withdrawn','under_review')),
  superseded_by_key text,
  superseded_by_version text,
  reason text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(evidence_key,evidence_version)
    REFERENCES decision_support.evidence_source(key,version),
  FOREIGN KEY(superseded_by_key,superseded_by_version)
    REFERENCES decision_support.evidence_source(key,version),
  CHECK(
    (status='superseded' AND superseded_by_key IS NOT NULL AND superseded_by_version IS NOT NULL)
    OR status<>'superseded'
  )
);
CREATE INDEX IF NOT EXISTS evidence_status_lookup
  ON decision_support.evidence_status_event(evidence_key,evidence_version,created_at DESC);

CREATE TABLE IF NOT EXISTS decision_support.evidence_review_event (
  id uuid PRIMARY KEY,
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  review_id uuid NOT NULL,
  evidence_key text NOT NULL,
  evidence_version text NOT NULL,
  action text NOT NULL CHECK(action IN ('flag','resolve')),
  reason text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(evidence_key,evidence_version)
    REFERENCES decision_support.evidence_source(key,version)
);
CREATE INDEX IF NOT EXISTS evidence_review_lookup
  ON decision_support.evidence_review_event(review_id,created_at DESC);

-- Rule content is still stored in rule_definition and remains immutable. These
-- columns make each version independently reviewable and understandable.
ALTER TABLE decision_support.rule_definition
  ADD COLUMN IF NOT EXISTS site_id text NOT NULL DEFAULT 'demo-kuwait',
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS clinical_domain text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS subdomain text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS rule_type text NOT NULL DEFAULT 'diagnosis_support',
  ADD COLUMN IF NOT EXISTS patient_population jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS required_data jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS optional_supporting_data jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS exclusion_criteria jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS contraindications jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS caution_conditions jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'routine',
  ADD COLUMN IF NOT EXISTS recommendation_category text NOT NULL DEFAULT 'informational',
  ADD COLUMN IF NOT EXISTS follow_up_implications jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recommendation_class text,
  ADD COLUMN IF NOT EXISTS evidence_level text,
  ADD COLUMN IF NOT EXISTS evidence_strength text,
  ADD COLUMN IF NOT EXISTS author text NOT NULL DEFAULT 'system:migration',
  ADD COLUMN IF NOT EXISTS previous_version integer,
  ADD COLUMN IF NOT EXISTS changelog text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS review_due_date date,
  ADD COLUMN IF NOT EXISTS test_status text NOT NULL DEFAULT 'not_run',
  ADD COLUMN IF NOT EXISTS fixture boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS decision_support.rule_evidence (
  rule_key text NOT NULL,
  rule_version integer NOT NULL,
  evidence_key text NOT NULL,
  evidence_version text NOT NULL,
  relationship text NOT NULL DEFAULT 'primary' CHECK(relationship IN ('primary','supporting','alternative')),
  added_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(rule_key,rule_version,evidence_key,evidence_version,relationship),
  FOREIGN KEY(rule_key,rule_version)
    REFERENCES decision_support.rule_definition(key,version),
  FOREIGN KEY(evidence_key,evidence_version)
    REFERENCES decision_support.evidence_source(key,version)
);

CREATE TABLE IF NOT EXISTS decision_support.rule_lifecycle_event (
  id uuid PRIMARY KEY,
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  rule_key text NOT NULL,
  rule_version integer NOT NULL,
  site_id text NOT NULL,
  state text NOT NULL CHECK(state IN (
    'DRAFT','CLINICAL_REVIEW','APPROVED','PUBLISHED','CHANGES_REQUESTED',
    'REJECTED','SUSPENDED','SUPERSEDED','RETIRED'
  )),
  comment text NOT NULL DEFAULT '',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(rule_key,rule_version)
    REFERENCES decision_support.rule_definition(key,version)
);
CREATE INDEX IF NOT EXISTS rule_lifecycle_lookup
  ON decision_support.rule_lifecycle_event(site_id,rule_key,rule_version,created_at DESC);

CREATE TABLE IF NOT EXISTS decision_support.rule_review (
  id uuid PRIMARY KEY,
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  rule_key text NOT NULL,
  rule_version integer NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('approved','rejected','changes_requested')),
  checklist jsonb NOT NULL DEFAULT '{}',
  comments text NOT NULL,
  reviewer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(rule_key,rule_version)
    REFERENCES decision_support.rule_definition(key,version)
);
CREATE INDEX IF NOT EXISTS rule_review_lookup
  ON decision_support.rule_review(rule_key,rule_version,created_at DESC);

CREATE TABLE IF NOT EXISTS decision_support.rule_test_run (
  id uuid PRIMARY KEY,
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  rule_key text NOT NULL,
  rule_version integer NOT NULL,
  outcome text NOT NULL CHECK(outcome IN ('passed','failed')),
  suite text NOT NULL,
  runner_version text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(rule_key,rule_version)
    REFERENCES decision_support.rule_definition(key,version)
);
CREATE INDEX IF NOT EXISTS rule_test_run_lookup
  ON decision_support.rule_test_run(rule_key,rule_version,event_sequence DESC);

CREATE TABLE IF NOT EXISTS decision_support.site_guideline_preference (
  id uuid PRIMARY KEY,
  site_id text NOT NULL,
  clinical_domain text NOT NULL,
  organization text NOT NULL,
  priority integer NOT NULL CHECK(priority BETWEEN 1 AND 20),
  rationale text NOT NULL DEFAULT '',
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_guideline_preference_lookup
  ON decision_support.site_guideline_preference(site_id,clinical_domain,priority,created_at DESC);

CREATE TABLE IF NOT EXISTS decision_support.site_policy (
  site_id text NOT NULL,
  category text NOT NULL CHECK(category IN (
    'formulary','trade_name','laboratory','clinic','follow_up_service',
    'device_service','referral_pathway','heart_team','local_protocol'
  )),
  key text NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  value jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','retired')),
  source_label text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(site_id,category,key,version)
);

ALTER TABLE decision_support.recommendation
  ADD COLUMN IF NOT EXISTS generation_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  ADD COLUMN IF NOT EXISTS rule_snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS publication_snapshot jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS review_snapshot jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS decision_support.recommendation_reassessment (
  id uuid PRIMARY KEY,
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  recommendation_id uuid NOT NULL REFERENCES decision_support.recommendation(id),
  reason_type text NOT NULL CHECK(reason_type IN ('rule_updated','evidence_updated','manual_review')),
  reason text NOT NULL,
  source_key text NOT NULL,
  source_version text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recommendation_reassessment_lookup
  ON decision_support.recommendation_reassessment(recommendation_id,created_at DESC);

CREATE TABLE IF NOT EXISTS decision_support.recommendation_action (
  id uuid PRIMARY KEY,
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  recommendation_id uuid NOT NULL REFERENCES decision_support.recommendation(id),
  action text NOT NULL CHECK(action IN ('accept','modify','snooze','dismiss','override')),
  reason text NOT NULL DEFAULT '',
  modified_recommendation text,
  snoozed_until timestamptz,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((action='snooze' AND snoozed_until IS NOT NULL) OR action<>'snooze'),
  CHECK((action='modify' AND modified_recommendation IS NOT NULL) OR action<>'modify')
);
CREATE INDEX IF NOT EXISTS recommendation_action_lookup
  ON decision_support.recommendation_action(recommendation_id,created_at DESC);

ALTER TABLE clinical.current_preference
  ADD COLUMN IF NOT EXISTS event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  ADD COLUMN IF NOT EXISTS competing_fact_ids jsonb NOT NULL DEFAULT '[]';

ALTER TABLE core.patient
  ADD COLUMN IF NOT EXISTS civil_id text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS height_cm numeric,
  ADD COLUMN IF NOT EXISTS weight_kg numeric,
  ADD COLUMN IF NOT EXISTS allergies jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS smoking_status text,
  ADD COLUMN IF NOT EXISTS reproductive_status text,
  ADD COLUMN IF NOT EXISTS primary_team text,
  ADD COLUMN IF NOT EXISTS major_comorbidities jsonb NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX IF NOT EXISTS patient_site_civil_id
  ON core.patient(site_id,civil_id) WHERE civil_id IS NOT NULL;

-- Expand the alert vocabulary while retaining all Stage 1 values.
ALTER TABLE decision_support.alert DROP CONSTRAINT IF EXISTS alert_category_check;
ALTER TABLE decision_support.alert ADD CONSTRAINT alert_category_check CHECK(category IN (
  'critical','warning','monitoring','clinical_review','treatment_opportunity',
  'informational','administrative'
));

CREATE OR REPLACE VIEW decision_support.evidence_current_state AS
SELECT e.*,
  COALESCE(s.status,'under_review') lifecycle_status,
  s.superseded_by_key,
  s.superseded_by_version,
  s.reason lifecycle_reason,
  s.actor lifecycle_actor,
  s.created_at lifecycle_changed_at
FROM decision_support.evidence_source e
LEFT JOIN LATERAL (
  SELECT * FROM decision_support.evidence_status_event x
  WHERE x.evidence_key=e.key AND x.evidence_version=e.version
  ORDER BY x.event_sequence DESC LIMIT 1
) s ON true;

CREATE OR REPLACE VIEW decision_support.rule_current_state AS
SELECT r.*,
  COALESCE(s.state,'DRAFT') lifecycle_state,
  s.id lifecycle_event_id,
  s.comment lifecycle_comment,
  s.actor lifecycle_actor,
  s.created_at lifecycle_changed_at,
  t.outcome latest_test_status,
  t.suite latest_test_suite,
  t.runner_version latest_test_runner_version,
  t.created_at latest_test_run_at
FROM decision_support.rule_definition r
LEFT JOIN LATERAL (
  SELECT * FROM decision_support.rule_lifecycle_event x
  WHERE x.rule_key=r.key AND x.rule_version=r.version AND x.site_id=r.site_id
  ORDER BY x.event_sequence DESC LIMIT 1
) s ON true
LEFT JOIN LATERAL (
  SELECT * FROM decision_support.rule_test_run x
  WHERE x.rule_key=r.key AND x.rule_version=r.version
  ORDER BY x.event_sequence DESC LIMIT 1
) t ON true;

DROP TRIGGER IF EXISTS capability_event_immutable ON governance.capability_event;
CREATE TRIGGER capability_event_immutable BEFORE UPDATE OR DELETE ON governance.capability_event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS evidence_status_immutable ON decision_support.evidence_status_event;
CREATE TRIGGER evidence_status_immutable BEFORE UPDATE OR DELETE ON decision_support.evidence_status_event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS evidence_review_immutable ON decision_support.evidence_review_event;
CREATE TRIGGER evidence_review_immutable BEFORE UPDATE OR DELETE ON decision_support.evidence_review_event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS rule_evidence_immutable ON decision_support.rule_evidence;
CREATE TRIGGER rule_evidence_immutable BEFORE UPDATE OR DELETE ON decision_support.rule_evidence FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS rule_lifecycle_immutable ON decision_support.rule_lifecycle_event;
CREATE TRIGGER rule_lifecycle_immutable BEFORE UPDATE OR DELETE ON decision_support.rule_lifecycle_event FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS rule_review_immutable ON decision_support.rule_review;
CREATE TRIGGER rule_review_immutable BEFORE UPDATE OR DELETE ON decision_support.rule_review FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS rule_test_run_immutable ON decision_support.rule_test_run;
CREATE TRIGGER rule_test_run_immutable BEFORE UPDATE OR DELETE ON decision_support.rule_test_run FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS guideline_preference_immutable ON decision_support.site_guideline_preference;
CREATE TRIGGER guideline_preference_immutable BEFORE UPDATE OR DELETE ON decision_support.site_guideline_preference FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS site_policy_immutable ON decision_support.site_policy;
CREATE TRIGGER site_policy_immutable BEFORE UPDATE OR DELETE ON decision_support.site_policy FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS recommendation_reassessment_immutable ON decision_support.recommendation_reassessment;
CREATE TRIGGER recommendation_reassessment_immutable BEFORE UPDATE OR DELETE ON decision_support.recommendation_reassessment FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
DROP TRIGGER IF EXISTS recommendation_action_immutable ON decision_support.recommendation_action;
CREATE TRIGGER recommendation_action_immutable BEFORE UPDATE OR DELETE ON decision_support.recommendation_action FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
