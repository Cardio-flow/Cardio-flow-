-- Actual report reference limit, in the same normalized unit as value_num.
ALTER TABLE cf.observation ADD COLUMN reference_high numeric CHECK (reference_high > 0 AND reference_high < 1000000);
