# PostgreSQL data model

Use UUID primary keys, `timestamptz` timestamps, foreign keys, indexes, check constraints and migrations. Enable `pgcrypto` only if UUID generation needs it.

## Tables
- `users`: id, name, email (normalized unique), password_hash, created_at, updated_at, disabled_at.
- `sessions`: id/token_hash, user_id, expires_at, created_at, last_seen_at, revoked_at, user_agent_hash/ip metadata only if justified and privacy reviewed.
- `profiles`: user_id, optional age range or date-of-birth only if necessary, preferences, created_at, updated_at. Avoid collecting height/weight/medical history by default unless the product requirement and consent justify it.
- `knowledge_entries`: id, slug, title, topic, content, traditional_use_summary, scientific_evidence_summary, evidence_level, known_risks, contraindications, interactions, reviewed status, reviewed_at, created_at, updated_at.
- `sources`: id, title, organization, authors, url, source_type, publication_date, updated_date, accessed_at, review_status, notes.
- `knowledge_entry_sources`: knowledge_entry_id, source_id, claim_or_section, notes.
- `symptom_sessions`: id, user_id nullable for guest sessions, topic, urgency, created_at, closed_at. Avoid saving guest raw text unless consented.
- `symptom_messages`: id, session_id, role, content, created_at. Prefer minimized/redacted retention; define retention policy.
- `symptom_assessments`: id, session_id, urgency, safety_rule_version, structured_answers JSONB, summary, created_at. Never store an LLM diagnosis.
- `health_checkins`: id, user_id, checkin_date, mood, energy, digestion, sleep_hours, created_at, updated_at; unique(user_id, checkin_date).
- `reminders`: id, user_id, name, reminder_time, active, created_at, updated_at. Label as user-entered reminders, not prescriptions.
- `symptom_history`: id, user_id, date, title/topic, urgency, summary, created_at.
- `audit_events`: id, user_id nullable, event_type, request_id, created_at, minimal metadata. Never log passwords, session tokens, API keys or full sensitive prompts.
- `account_deletion_jobs` only if deletion must be asynchronous.

## Access and integrity
- All user-owned rows have `user_id` and are queried with authenticated `req.user.id`.
- Use parameterized SQL only.
- Add indexes on `sessions(user_id, expires_at)`, `health_checkins(user_id, checkin_date)`, `symptom_history(user_id, date)`, `reminders(user_id, active)`, `knowledge_entries(topic, reviewed_status)`.
- Add constraints for valid sleep ranges, mood/energy/digestion enumerations, expiry > creation, and non-empty required text.
- Transactionally delete or anonymize personal data on account deletion, consistent with the documented retention policy.
- Migrations use a `schema_migrations` table and advisory lock to prevent concurrent runners.
