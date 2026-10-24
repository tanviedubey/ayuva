# API routes and schema summary

Base: `/api/v1`. JSON only. Errors: `{ "error": { "code", "message", "requestId" } }`.
Mutating requests (POST/PUT/PATCH/DELETE) need the double-submit CSRF token: `GET /auth/csrf` sets cookie `ayuva_csrf`
and returns `{csrfToken}`; send it as `X-CSRF-Token`. Requests with a foreign `Origin` are rejected (`CSRF_ORIGIN`).
Session cookie `ayuva_sid`: HttpOnly, SameSite=Lax, Path=/, finite Max-Age, Secure in production.

| Method & path | Auth | Notes |
|---|---|---|
| GET `/health` | no | DB ping |
| GET `/auth/csrf` | no | issue CSRF token |
| POST `/auth/signup` | no | `{name,email,password[8-128],age?}` → 201 `{user}`; 409 `EMAIL_TAKEN`; rate-limited |
| POST `/auth/login` | no | `{email,password}` → `{user}`; 401 `INVALID_CREDENTIALS` (same for unknown email); rotates session; rate-limited |
| POST `/auth/logout` | no | revokes session, clears cookie |
| GET `/auth/me` | cookie | `{user}` or 401 |
| DELETE `/auth/account` | yes | `{password}`; cascades deletion |
| POST `/chat` | optional | `{state?,message}`; deterministic red-flag screen first; rate-limited; never persists guest text |
| GET `/knowledge?topic&q` | no | approved entries + approved sources only |
| GET/POST `/history`, DELETE `/history/:id` | yes | `{title,urgency,date?,summary?}` |
| GET `/checkins?from&to`, PUT `/checkins/:date` | yes | upsert `{mood,energy,digestion,sleep}` |
| GET/POST `/reminders`, PATCH/DELETE `/reminders/:id` | yes | `{name,time:"HH:MM"}`; PATCH `{name?,time?,active?,takenOn?}` |
| GET `/calendar/summary?from&to` | yes | ≤ 400 days |
| GET/PATCH `/profile` | yes | `{name?,age?|null}` |
| GET `/privacy/export` | yes | JSON download, no secrets |

Chat response (`/chat`): emergency → `{reply, emergency:true, urgency:"emergency", emergencyNumber:"112", options:["Start over"]}`
with no plan/sources. Otherwise a question (`reply, options, state`) or a final `{plan{title,summary,traditionalUse[],evidence[],
selfCare[],avoidOrCaution[],redFlags[],whenToSeekCare,sources[],origin}, urgency, note, level, disclaimer}`.

## Schema (PostgreSQL 13+; see `src/db/migrations`)
```
users 1─1 profiles(age?)          users 1─* sessions(token_hash, expires_at, revoked_at)
users 1─* health_checkins(UNIQUE user_id,checkin_date)   users 1─* reminders(name,reminder_time,active,taken_on)
users 1─* symptom_history(date,title,urgency,summary)    users 1─* audit_events (SET NULL on delete)
sources(review_status,…) *─* knowledge_entries(review_status,reviewed_by/at,evidence_level,details JSONB)
                   via knowledge_entry_sources(claim_or_section)
symptom_sessions / symptom_assessments: created by 001 but intentionally unused (data minimisation)
schema_migrations(version, checksum, applied_at)
```
Differences from `DATABASE.md` (forward migration `002`): `knowledge_entries.details/is_sample`, evidence/source-type CHECKs,
approval requires reviewer, `reminders.taken_on`.
