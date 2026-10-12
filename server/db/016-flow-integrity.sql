ALTER TABLE cf.wizard_draft ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE cf.plan_action ADD COLUMN indications text[] NOT NULL DEFAULT '{}';
ALTER TABLE cf.plan_action ADD COLUMN decision_refs uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE cf.plan_action ADD COLUMN context_refs uuid[] NOT NULL DEFAULT '{}';
