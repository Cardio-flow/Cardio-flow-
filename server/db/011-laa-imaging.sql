-- Extend the existing study catalogue with structured LAA / closure-device imaging.
-- No new clinical tables; existing studies, decisions and plan evidence remain the source of truth.
ALTER TABLE cf.study DROP CONSTRAINT IF EXISTS study_kind_check;
ALTER TABLE cf.study ADD CONSTRAINT study_kind_check
  CHECK (kind IN ('echo','ecg','holter','abpm','stress','ccta','cmr','nuclear','cath','ep_study','device_check','cpet','laa_imaging'));
