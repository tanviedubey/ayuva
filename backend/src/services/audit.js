// Audit events carry only an event type, request id and tiny non-sensitive metadata. Never health text, emails or secrets.
export async function writeAudit(db, { userId = null, type, requestId = null, metadata = {} }) {
  try {
    await db.query("INSERT INTO audit_events(user_id, event_type, request_id, metadata) VALUES ($1,$2,$3,$4)",
      [userId, type, requestId, JSON.stringify(metadata)]);
  } catch { /* auditing must never break a request */ }
}
