CREATE SCHEMA IF NOT EXISTS coronary;

-- Every coronary record is append-only. A correction is a new event linked to
-- the prior event; the original clinical and registry history remains readable.
CREATE TABLE coronary.state_event (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid,
  state text NOT NULL CHECK(state IN (
    'NO_ESTABLISHED_CAD','SUSPECTED_CAD','CCS','PREVIOUS_MI','PREVIOUS_PCI',
    'PREVIOUS_CABG','CURRENT_ACS','POST_ACS','ANOCA','INOCA',
    'RECURRENT_ANGINA','OTHER'
  )),
  status text NOT NULL CHECK(status IN ('CURRENT','HISTORICAL','RESOLVED','UNCERTAIN')),
  observed_at timestamptz NOT NULL,
  detail text NOT NULL DEFAULT '',
  source_type text NOT NULL,
  source_id text NOT NULL,
  supersedes_id uuid REFERENCES coronary.state_event(id),
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id)
);
CREATE INDEX coronary_state_patient_time ON coronary.state_event(patient_id,observed_at DESC);

-- ECG is shared clinical infrastructure. Stage 6 may extend this record without
-- copying an ischemia-only ECG into an arrhythmia module.
CREATE TABLE clinical.ecg (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid,
  performed_at timestamptz NOT NULL,
  indication text NOT NULL DEFAULT '',
  rhythm text NOT NULL DEFAULT 'UNKNOWN',
  rate numeric,
  pr_ms numeric,
  qrs_ms numeric,
  qtc_ms numeric,
  axis_degrees numeric,
  st_changes text NOT NULL DEFAULT '',
  t_changes text NOT NULL DEFAULT '',
  pathologic_q_waves boolean,
  conduction text NOT NULL DEFAULT '',
  pacing text NOT NULL DEFAULT '',
  ischemic_interpretation text NOT NULL DEFAULT 'UNCERTAIN',
  comparison text NOT NULL DEFAULT '',
  clinician_interpretation text NOT NULL DEFAULT '',
  attachment_reference text NOT NULL DEFAULT '',
  source_label text NOT NULL,
  status text NOT NULL CHECK(status IN ('PRELIMINARY','FINAL','ENTERED_IN_ERROR')),
  supersedes_id uuid REFERENCES clinical.ecg(id),
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id)
);
CREATE INDEX clinical_ecg_patient_time ON clinical.ecg(patient_id,performed_at DESC);

CREATE TABLE coronary.acs_event (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid,
  presented_at timestamptz NOT NULL,
  diagnosis text NOT NULL CHECK(diagnosis IN (
    'POSSIBLE_ACS','STEMI','NSTEMI','NSTE_ACS','UNSTABLE_ANGINA',
    'ALTERNATIVE_DIAGNOSIS','UNCERTAIN'
  )),
  diagnosis_status text NOT NULL CHECK(diagnosis_status IN ('WORKING','CONFIRMED','REVISED')),
  symptom_onset_at timestamptz,
  first_medical_contact_at timestamptz,
  first_ecg_at timestamptz,
  diagnosis_at timestamptz,
  cath_activation_at timestamptz,
  hospital_arrival_at timestamptz,
  wire_at timestamptz,
  reperfusion_at timestamptz,
  symptoms jsonb NOT NULL DEFAULT '{}',
  hemodynamics jsonb NOT NULL DEFAULT '{}',
  risk_context jsonb NOT NULL DEFAULT '{}',
  clinical_interpretation text NOT NULL DEFAULT '',
  status text NOT NULL CHECK(status IN ('ACTIVE','DISCHARGED','CLOSED','ENTERED_IN_ERROR')),
  supersedes_id uuid REFERENCES coronary.acs_event(id),
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id)
);
CREATE INDEX coronary_acs_patient_time ON coronary.acs_event(patient_id,presented_at DESC);

CREATE TABLE coronary.angiogram (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid,
  acs_event_id uuid REFERENCES coronary.acs_event(id),
  performed_at timestamptz NOT NULL,
  indication text NOT NULL,
  access_site text NOT NULL DEFAULT '',
  contrast_ml numeric CHECK(contrast_ml IS NULL OR contrast_ml >= 0),
  operator_name text NOT NULL DEFAULT '',
  coronary_dominance text NOT NULL DEFAULT 'UNKNOWN',
  anatomy_summary text NOT NULL DEFAULT '',
  physiology jsonb NOT NULL DEFAULT '[]',
  intracoronary_imaging jsonb NOT NULL DEFAULT '[]',
  complications jsonb NOT NULL DEFAULT '[]',
  conclusion text NOT NULL DEFAULT '',
  plan text NOT NULL DEFAULT '',
  status text NOT NULL CHECK(status IN ('DRAFT','FINAL','ENTERED_IN_ERROR')),
  supersedes_id uuid REFERENCES coronary.angiogram(id),
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id)
);
CREATE INDEX coronary_angio_patient_time ON coronary.angiogram(patient_id,performed_at DESC);

CREATE TABLE coronary.lesion (
  id uuid PRIMARY KEY,
  angiogram_id uuid NOT NULL REFERENCES coronary.angiogram(id),
  vessel text NOT NULL,
  segment text NOT NULL DEFAULT '',
  stenosis_percent numeric CHECK(stenosis_percent BETWEEN 0 AND 100),
  length_mm numeric CHECK(length_mm IS NULL OR length_mm >= 0),
  culprit_status text NOT NULL DEFAULT 'UNCERTAIN' CHECK(culprit_status IN ('CONFIRMED','PROBABLE','UNCERTAIN','NOT_CULPRIT','NONE_IDENTIFIED')),
  timi_flow integer CHECK(timi_flow BETWEEN 0 AND 3),
  calcification text NOT NULL DEFAULT '',
  bifurcation boolean,
  thrombus boolean,
  tortuosity boolean,
  cto boolean,
  ostial boolean,
  restenosis boolean,
  graft_lesion boolean,
  comments text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coronary.pci (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid,
  acs_event_id uuid REFERENCES coronary.acs_event(id),
  angiogram_id uuid REFERENCES coronary.angiogram(id),
  target_lesion_id uuid REFERENCES coronary.lesion(id),
  performed_at timestamptz NOT NULL,
  indication text NOT NULL,
  target_vessel text NOT NULL,
  urgency text NOT NULL DEFAULT 'UNKNOWN',
  access_site text NOT NULL DEFAULT '',
  technique jsonb NOT NULL DEFAULT '{}',
  imaging jsonb NOT NULL DEFAULT '[]',
  physiology jsonb NOT NULL DEFAULT '[]',
  procedural_timeline jsonb NOT NULL DEFAULT '[]',
  final_timi_flow integer CHECK(final_timi_flow BETWEEN 0 AND 3),
  contrast_ml numeric CHECK(contrast_ml IS NULL OR contrast_ml >= 0),
  radiation_gy numeric CHECK(radiation_gy IS NULL OR radiation_gy >= 0),
  complications jsonb NOT NULL DEFAULT '[]',
  result text NOT NULL DEFAULT '',
  residual_disease text NOT NULL DEFAULT '',
  revascularization_status text NOT NULL DEFAULT 'UNKNOWN',
  staged_plan text NOT NULL DEFAULT '',
  status text NOT NULL CHECK(status IN ('DRAFT','FINAL','ENTERED_IN_ERROR')),
  supersedes_id uuid REFERENCES coronary.pci(id),
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id)
);
CREATE INDEX coronary_pci_patient_time ON coronary.pci(patient_id,performed_at DESC);

CREATE TABLE coronary.stent (
  id uuid PRIMARY KEY,
  pci_id uuid NOT NULL REFERENCES coronary.pci(id),
  lesion_id uuid REFERENCES coronary.lesion(id),
  vessel text NOT NULL,
  model text NOT NULL DEFAULT '',
  manufacturer text NOT NULL DEFAULT '',
  stent_type text NOT NULL CHECK(stent_type IN ('DES','BMS','OTHER','UNKNOWN')),
  diameter_mm numeric CHECK(diameter_mm IS NULL OR diameter_mm > 0),
  length_mm numeric CHECK(length_mm IS NULL OR length_mm > 0),
  overlap boolean NOT NULL DEFAULT false,
  implanted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Structured plans carry clinical decisions, complications and follow-up without
-- duplicating the medication/laboratory or task engines.
CREATE TABLE coronary.plan_event (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES core.patient(id),
  encounter_id uuid,
  acs_event_id uuid REFERENCES coronary.acs_event(id),
  category text NOT NULL CHECK(category IN (
    'ANTITHROMBOTIC','CCS','ANOCA_INOCA','REVASCULARIZATION','PREVENTION',
    'REHABILITATION','COMPLICATION','DISCHARGE','FOLLOW_UP','RISK_ASSESSMENT'
  )),
  plan_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('ACTIVE','COMPLETED','SUPERSEDED','UNCERTAIN','ENTERED_IN_ERROR')),
  data jsonb NOT NULL DEFAULT '{}',
  review_date date,
  task_id uuid REFERENCES workflow.clinical_task(id),
  supersedes_id uuid REFERENCES coronary.plan_event(id),
  reason text NOT NULL DEFAULT '',
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(encounter_id,patient_id) REFERENCES care.encounter(id,patient_id)
);
CREATE INDEX coronary_plan_patient_time ON coronary.plan_event(patient_id,category,observed_at DESC);

DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['state_event','acs_event','angiogram','lesion','pci','stent','plan_event'] LOOP
    EXECUTE format('CREATE TRIGGER coronary_%s_immutable BEFORE UPDATE OR DELETE ON coronary.%I FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation()',tab,tab);
  END LOOP;
END $$;

CREATE TRIGGER clinical_ecg_immutable BEFORE UPDATE OR DELETE ON clinical.ecg
FOR EACH ROW EXECUTE FUNCTION governance.reject_mutation();
