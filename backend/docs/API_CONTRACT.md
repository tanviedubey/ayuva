# API contract

Use `/api/v1` prefix. JSON errors should be consistent: `{ "error": { "code": "VALIDATION_ERROR", "message": "Readable message", "requestId": "..." } }`. Never expose stack traces.

## Auth
- `POST /api/v1/auth/signup` — `{ name, email, password }`; return safe user profile and set session cookie.
- `POST /api/v1/auth/login` — `{ email, password }`; set session cookie.
- `POST /api/v1/auth/logout` — invalidate session and clear cookie.
- `GET /api/v1/auth/me` — current safe profile or 401.
- `DELETE /api/v1/auth/account` — re-authenticate/confirm before deleting account and dependent personal data.

## Chat and safety
- `POST /api/v1/chat` — `{ state, message, locale? }`; returns `{ reply, options, state, urgency, emergency, plan?, sources?, disclaimer }`.
- Do not trust client-supplied triage state or flags. Revalidate all user content server-side.
- A red-flag response must not include home remedies or an LLM-generated diagnosis.
- `GET /api/v1/knowledge?topic=&q=` — curated educational entries and source metadata; public safe content only.

## User data (authenticated)
- `GET /api/v1/history`
- `POST /api/v1/history`
- `DELETE /api/v1/history/:id`
- `GET /api/v1/checkins`
- `PUT /api/v1/checkins/:date`
- `GET /api/v1/reminders`
- `POST /api/v1/reminders`
- `PATCH /api/v1/reminders/:id`
- `DELETE /api/v1/reminders/:id`
- `GET /api/v1/calendar/summary?from=&to=`
- `GET /api/v1/profile`
- `PATCH /api/v1/profile`
- `GET /api/v1/privacy/export`

## API integration requirements for current frontend
- Replace `API.base: null` mock mode with a configurable same-origin `/api/v1` base or validated `API_BASE_URL`.
- Remove localStorage-based password/account mock and do not store health data locally for authenticated users.
- Use `GET /auth/me` on page load to establish login state.
- Use `credentials: "include"` and CSRF protection for state-changing requests.
- Map server errors to user-readable messages without displaying secrets or internal stack traces.
- Keep the frontend's current IDs and layout where practical; do not redesign it unnecessarily.
