# Ayuva Product Requirements Document

## 1. Product purpose
A beginner-friendly educational platform that presents traditional Ayurvedic knowledge alongside modern, evidence-informed health information. It supports symptom education, wellness routines, skincare/ingredient education, personal check-ins, reminders, history and appropriate clinician referral.

## 2. Product principles
1. Safety before engagement: deterministic red-flag checks run before any LLM call and cannot be overridden by the LLM.
2. Evidence transparency: distinguish traditional use from clinical/scientific evidence.
3. No diagnosis, prescriptions, cure claims, or guarantees.
4. Every material health claim must have a source or be labelled as traditional knowledge with evidence limitations.
5. Privacy by default: health-related notes are sensitive. Collect only what is needed, explain why, restrict access to the account owner and provide deletion/export paths.
6. Graceful failure: missing API key, timeout, invalid model output or database issue must not cause unsafe advice.
7. Do not add an educational video feature. It was explicitly removed from scope.

## 3. Users and journeys
- Guest: read public educational material and start a symptom conversation without saving sensitive history.
- Registered user: sign up/sign in, save symptom history, daily check-ins, reminders and calendar data.
- User asking about a symptom: deterministic safety screen → clarify key context → validated educational response with evidence, limitations, self-care only when appropriate, red flags and care-seeking guidance.
- User asking about skincare/ingredients: educational explanation, known irritation/allergy risks, evidence level, usage cautions and when to consult a dermatologist.
- User with red flags: stop routine advice, explain urgency, direct to emergency/medical care and show local emergency guidance. Never offer home remedies as a substitute.

## 4. Feature scope
### In scope
- Authentication and profile (name, email; optional age only if necessary).
- Symptom education/chat with structured follow-up questions.
- Deterministic red-flag triage.
- Evidence-aware Ayurvedic knowledge base, source metadata and retrieval.
- Daily routine/check-ins.
- Reminders (user-entered, not prescriptions).
- Health/symptom history and calendar.
- Skincare and ingredient education.
- Clinician referral guidance.
- Audit/security events that do not unnecessarily log raw health text.
- Account data export/deletion.

### Out of scope
- Educational videos.
- Diagnosis, prescription or dose generation for medicines/herbs.
- Autonomous medical decision-making.
- Claims that Ayurvedic practices cure disease.
- Using the LLM as the only safety control.

## 5. Acceptance criteria
- Frontend retains the current look and all core sections except educational videos.
- API and database run from documented setup instructions on a clean machine.
- Migrations are repeatable/safe and do not fail when rerun.
- Passwords are hashed with Argon2id (or an equivalent maintained password-hashing algorithm); never plain text or client-side SHA-256.
- Session cookies are HttpOnly, Secure in production, SameSite=Lax or stricter, and rotated/invalidated appropriately.
- Every account-owned read/write is scoped by authenticated user ID.
- Red flags are screened before LLM calls; test cases prove emergency escalation cannot be overridden.
- LLM output is schema-validated and citations are verified against stored source records.
- If LLM is unavailable, return safe, bounded fallback information or ask the user to seek a clinician; do not invent sources.
- Tests cover auth, authorization, migrations, red flags, malformed model output, provider outage, persistence and input validation.
- No API secrets in browser code or logs.
