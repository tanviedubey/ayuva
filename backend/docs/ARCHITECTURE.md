# Architecture

## Request pipeline
1. HTTP request → security middleware (headers, rate limiting, request size limits).
2. Authentication/session middleware for private routes.
3. Input validation with Zod.
4. **Deterministic red-flag screening** for symptom/chat input.
5. If emergency/urgent: short-circuit LLM and return the appropriate escalation response.
6. If safe to continue: retrieve relevant curated knowledge and source records from PostgreSQL.
7. Optional LLM provider adapter receives only minimum necessary context.
8. Validate output against a strict schema; verify source IDs exist and match claims.
9. Apply safety post-processing; if invalid/unsafe, return safe fallback.
10. Persist only permitted data and return a stable API response.

## Suggested layers
- `src/server.js`: app bootstrap.
- `src/app.js`: Express app/middleware/routes.
- `src/config/env.js`: environment validation.
- `src/db/pool.js`: PostgreSQL pool.
- `src/db/migrate.js`: ordered SQL migration runner with a migration ledger and transaction per migration.
- `src/routes/*`: route definitions.
- `src/controllers/*`: request/response orchestration.
- `src/services/auth.service.js`: signup/login/logout/session.
- `src/services/triage.service.js`: deterministic red-flag rules and urgency classification.
- `src/services/knowledge.service.js`: curated knowledge retrieval and source metadata.
- `src/services/llm/adapter.js`: provider-independent interface.
- `src/services/llm/providers/*`: provider-specific clients.
- `src/services/response-validator.js`: schema and citation validation.
- `src/repositories/*`: parameterized SQL access.
- `src/middleware/*`: auth, rate limits, validation, error handling.
- `src/schemas/*`: Zod request/response schemas.
- `tests/*`: unit/integration/security tests.

## Provider-independent LLM contract
`generateEducationalResponse({ question, safeContext, retrievedKnowledge, sourceRecords, locale })`
returns structured JSON:
- `summary`
- `traditionalUse[]`
- `evidenceAssessment[]` (level, what evidence says, limitations)
- `selfCare[]` (only if safe)
- `avoidOrCaution[]`
- `redFlags[]`
- `whenToSeekCare`
- `sources[]` (database source IDs only)
- `disclaimer`

Never let the model choose its own safety classification. Triage is deterministic and separately represented.
