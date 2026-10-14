-- Medicines the patient was already taking when first recorded (start date not known, 14 Oct 2026):
-- their first entry is not a start, so no post-start monitoring, titration wait or renal baseline follows from it.
ALTER TABLE cf.medication ADD COLUMN preexisting boolean NOT NULL DEFAULT false;
