-- 20 Oct 2026 (Ahmed): a value reported as a range ("EF 35–40%", "RVSP 70–75") keeps both numbers.
-- value_num holds the lower number (used by every rule); value_high the upper, for display only.
ALTER TABLE cf.observation ADD COLUMN value_high numeric;
ALTER TABLE cf.observation ADD CONSTRAINT observation_value_high_check CHECK (value_high IS NULL OR (value_num IS NOT NULL AND value_high > value_num));
