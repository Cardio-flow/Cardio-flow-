ALTER TABLE cf.study DROP CONSTRAINT IF EXISTS study_kind_check;
ALTER TABLE cf.study ADD CONSTRAINT study_kind_check CHECK (kind IN ('echo','ecg','holter','abpm','stress','ccta','cmr','nuclear','cath','ep_study','device_check','cpet','laa_imaging','structural_imaging'));
