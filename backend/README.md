# Ayuva – backend + PostgreSQL

Educational Ayurveda + evidence platform. Node.js/Express API, PostgreSQL, server-side sessions, deterministic
red-flag triage, curated (reviewed) knowledge, optional LLM wording with safe fallback. The existing frontend is served
from `public/` (same origin), with its inline script moved to `public/app.js` so the CSP can forbid inline scripts.
The Educational Videos feature is removed everywhere (UI, routes, tables, seed data).

> Ayuva is education, not diagnosis. Sample knowledge is **not clinically reviewed** (see "Content review").

## Quick start (Windows PowerShell)

Prerequisites: Node.js 20.12+ (LTS), PostgreSQL 13+ (installer from postgresql.org; keep `psql` on PATH).

```powershell
# 1. Create the role and databases (enter the 'postgres' superuser password you chose at install)
psql -U postgres -c "CREATE ROLE ayuva_app LOGIN PASSWORD 'choose-a-strong-password';"
psql -U postgres -c "CREATE DATABASE ayuva OWNER ayuva_app;"
psql -U postgres -c "CREATE DATABASE ayuva_test OWNER ayuva_app;"

# 2. Install and configure
npm install
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # paste into SESSION_SECRET in .env
# edit .env: DATABASE_URL, TEST_DATABASE_URL (password you chose), SESSION_SECRET

# 3. Create the schema, then (optional) load SAMPLE knowledge
npm run migrate
npm run seed:samples:approve      # DEV ONLY: marks samples approved without clinical review

# 4. Run
npm run dev                       # http://localhost:3001
```

Generic Linux/macOS: same steps with `cp .env.example .env` and `createdb`/`psql` as your DB admin.

### Scripts
| Script | Purpose |
|---|---|
| `npm run dev` / `start` | Run the server (`dev` restarts on change) |
| `npm run migrate` | Apply ordered SQL migrations (ledger + advisory lock) |
| `npm run seed:samples` | Load SAMPLE sources/entries as `in_review` (not served) |
| `npm run seed:samples:approve` | Same, but marks them approved (development only) |
| `npm run check` / `lint` | Syntax of all JS, no video code, no browser storage, secrets hygiene |
| `npm run test:unit` | No database needed |
| `npm run test:integration` | Needs `TEST_DATABASE_URL` (DB name must end in `_test`; its `public` schema is wiped) |
| `npm test` | Both |

### Least-privilege database user
The quick start gives `ayuva_app` ownership so one role can migrate and run tests. For production use two roles:
```sql
CREATE ROLE ayuva_migrator LOGIN PASSWORD '...';   -- owns the schema; used only by `npm run migrate`
CREATE ROLE ayuva_runtime  LOGIN PASSWORD '...';   -- used by the server
GRANT CONNECT ON DATABASE ayuva TO ayuva_runtime;
GRANT USAGE ON SCHEMA public TO ayuva_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ayuva_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE ayuva_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ayuva_runtime;
```
The runtime role needs no DDL, no superuser and no `CREATE EXTENSION`.

## Configuration (`.env`)
See `.env.example`. Startup fails fast on a missing/short `SESSION_SECRET` (min 32 chars) or missing `DATABASE_URL`;
in production `APP_ORIGIN` must be https. `.env` is git-ignored. Keys stay server-side.

**LLM:** To enable Gemini, set `LLM_PROVIDER=gemini`, `LLM_API_KEY` to your own Gemini API key, and
`LLM_MODEL=gemini-3.8-flash` (or another model your key can access). The key must stay in the backend `.env`,
never in frontend code. Check configuration at `GET http://localhost:3001/api/v1/llm/status`; this endpoint never
returns the key. If generation fails, the app uses available curated information and displays a fallback notice.
The LLM is never consulted for emergencies. A model is only called when an approved knowledge entry with approved
sources exists for the selected topic.

## Content review (important)
Only entries with `review_status='approved'` (and approved sources) are served or sent to a model. Approval requires
`reviewed_by` and `reviewed_at` (DB constraint). A qualified reviewer should open each source URL, verify the claim, then:
```sql
UPDATE sources SET review_status='approved', accessed_at=NOW() WHERE id='...';
UPDATE knowledge_entries SET review_status='approved', reviewed_by='Dr Name, credentials', reviewed_at=NOW() WHERE slug='cough-general-care';
```
Seed data (`src/db/seed-data.js`) is clearly SAMPLE; URLs were recorded by the developer and must be verified.

## Privacy defaults
Stored: name, email, Argon2id hash, optional age, check-ins, reminders, saved symptom-check titles. Not collected: medical history,
allergies, medicines, height, weight. Guest symptom text is never stored; signed-in users store only the topic title + urgency
the client reports after a result. Logs contain request id/method/path/status only. `GET /api/v1/privacy/export` downloads
your data; `DELETE /api/v1/auth/account` (password re-entry) deletes the user and, via `ON DELETE CASCADE`, sessions, profile,
check-ins, reminders, history; audit rows are detached (`user_id` NULL, no PII).

## Troubleshooting
| Symptom | Fix |
|---|---|
| `Invalid environment: SESSION_SECRET…` | Generate a 32+ char secret (command above) |
| `Cannot reach PostgreSQL` | Service running? Check host/port/password in `DATABASE_URL` |
| `Database has no schema` | `npm run migrate` |
| `password authentication failed` | Recreate role password; URL-encode special characters in `DATABASE_URL` |
| `permission denied for schema public` (PG 15+) | `GRANT ALL ON SCHEMA public TO ayuva_app;` or make it the DB owner |
| Integration tests refuse to run | `TEST_DATABASE_URL` must point at a DB whose name ends `_test` |
| Sign-in works on localhost but not behind a proxy | Set `TRUST_PROXY=true`, serve over https, `NODE_ENV=production` (cookie is `Secure`) |
| `argon2` install fails | Use Node LTS; prebuilt binaries cover Windows/macOS/Linux x64/arm64; otherwise install build tools |
| Front-end on another origin | Prefer same origin. Otherwise set `CORS_ORIGINS` and note `SameSite=Lax` cookies are not sent on cross-site fetches |

More: `docs/API_AND_SCHEMA.md` (routes, schema), `docs/SAFETY_AND_EVIDENCE.md` (binding safety rules + limitations).
