-- Track the complete evidence for a task and distinguish recorded results from clinical review.
ALTER TABLE cf.plan_action ADD COLUMN IF NOT EXISTS completion_refs text[] NOT NULL DEFAULT '{}';
ALTER TABLE cf.plan_action ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT '';
ALTER TABLE cf.plan_action ADD COLUMN IF NOT EXISTS progress text NOT NULL DEFAULT 'planned'
  CHECK (progress IN ('planned','ordered','booked','performed','reviewed'));
ALTER TABLE cf.plan_action ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE cf.plan_action ADD COLUMN IF NOT EXISTS reviewed_by text;
UPDATE cf.plan_action SET owner=created_by WHERE owner='';
UPDATE cf.plan_action SET completion_refs=ARRAY[completed_by_ref]
  WHERE completed_by_ref IS NOT NULL AND cardinality(completion_refs)=0;
-- Existing completed actions do not prove review: results/studies need an explicit review.
UPDATE cf.plan_action SET progress=CASE
  WHEN status='completed' AND completed_by_ref IS NOT NULL AND completes_on->>'type' IN ('lab','study') THEN 'performed'
  WHEN status='completed' THEN 'reviewed' ELSE 'planned' END;
CREATE INDEX IF NOT EXISTS plan_awaiting_review ON cf.plan_action(patient_id)
  WHERE status='completed' AND progress='performed';

-- Published content is retained under a new version from this release onward.
ALTER TABLE cf.rule_version ADD COLUMN IF NOT EXISTS content_hash text NOT NULL DEFAULT '';
ALTER TABLE cf.recommendation ADD COLUMN IF NOT EXISTS rule_content_hash text NOT NULL DEFAULT '';
CREATE OR REPLACE FUNCTION cf.protect_published_rule_content() RETURNS trigger AS $$
BEGIN
  IF OLD.published_by IS NOT NULL AND (OLD.params IS DISTINCT FROM NEW.params OR
      OLD.evidence IS DISTINCT FROM NEW.evidence OR OLD.title IS DISTINCT FROM NEW.title OR
      OLD.content_hash IS DISTINCT FROM NEW.content_hash) THEN
    RAISE EXCEPTION 'Published rule content is immutable: create a new version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER protect_published_rule_content BEFORE UPDATE ON cf.rule_version
  FOR EACH ROW EXECUTE FUNCTION cf.protect_published_rule_content();
