-- Age typed when the date of birth is not known (7 Oct 2026, Ahmed: "Add age field that can be filled manually").
-- The date of birth is then estimated from the age and flagged, so the record shows "about" and a civil ID or a
-- real date replaces it later.
ALTER TABLE cf.patient ADD COLUMN IF NOT EXISTS birth_date_estimated boolean NOT NULL DEFAULT false;
