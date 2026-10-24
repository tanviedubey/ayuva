-- Forward migration: structured reviewed content, evidence-level enums, reminder "taken on",
-- review guard and indexes. Never edits 001.
ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE knowledge_entries ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_evidence_level_chk') THEN
    ALTER TABLE knowledge_entries ADD CONSTRAINT knowledge_evidence_level_chk CHECK (evidence_level IN
      ('guideline','systematic_review','clinical_trial','observational','preclinical','traditional_source','insufficient'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sources_type_chk') THEN
    ALTER TABLE sources ADD CONSTRAINT sources_type_chk CHECK (source_type IN
      ('public_health_agency','clinical_guideline','systematic_review','peer_reviewed_study','traditional_text','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_approved_needs_reviewer_chk') THEN
    ALTER TABLE knowledge_entries ADD CONSTRAINT knowledge_approved_needs_reviewer_chk
      CHECK (review_status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL));
  END IF;
END $$;

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS taken_on DATE;
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
