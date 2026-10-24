import argon2 from "argon2";
import { newToken, hashToken } from "../lib/crypto.js";
import { HttpError, conflict } from "../lib/httpError.js";
import { withTransaction } from "../db/pool.js";
import { writeAudit } from "./audit.js";

const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }; // OWASP-recommended minimum profile
let dummyHash;
const getDummy = async () => (dummyHash ??= await argon2.hash("ayuva-dummy-password", ARGON));

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, age: u.age ?? null });
const invalidCreds = () => new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");

async function createSession(client, config, userId) {
  const token = newToken();
  await client.query(
    "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1,$2, NOW() + make_interval(secs => $3::double precision))",
    [hashToken(token, config.sessionSecret), userId, config.sessionTtlMs / 1000]);
  return token;
}

export async function revokeSessionByToken(pool, config, token) {
  if (!token) return;
  await pool.query("UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL", [hashToken(token, config.sessionSecret)]);
}

export async function signup(pool, config, { name, email, password, age }, { requestId, oldToken }) {
  const password_hash = await argon2.hash(password, ARGON);
  try {
    const out = await withTransaction(pool, async (c) => {
      const { rows } = await c.query("INSERT INTO users(name, email, password_hash) VALUES ($1,$2,$3) RETURNING id, name, email", [name, email, password_hash]);
      const u = rows[0];
      await c.query("INSERT INTO profiles(user_id, age) VALUES ($1,$2)", [u.id, age ?? null]);
      const token = await createSession(c, config, u.id);
      return { user: publicUser({ ...u, age }), token };
    });
    await revokeSessionByToken(pool, config, oldToken);
    await writeAudit(pool, { userId: out.user.id, type: "auth.signup", requestId });
    return out;
  } catch (e) {
    if (e?.code === "23505") throw conflict("An account with this email already exists. Sign in instead.", "EMAIL_TAKEN");
    throw e;
  }
}

export async function login(pool, config, { email, password }, { requestId, oldToken }) {
  const { rows } = await pool.query(
    "SELECT u.id, u.name, u.email, u.password_hash, u.disabled_at, p.age FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.email = $1", [email]);
  const u = rows[0];
  // Always run one argon2 verification so unknown emails and wrong passwords take similar time.
  const ok = await argon2.verify(u?.password_hash ?? (await getDummy()), password).catch(() => false);
  if (!u || !ok || u.disabled_at) {
    await writeAudit(pool, { userId: null, type: "auth.login_failed", requestId });
    throw invalidCreds();
  }
  const token = await withTransaction(pool, (c) => createSession(c, config, u.id)); // new token each login (rotation)
  await revokeSessionByToken(pool, config, oldToken);
  await writeAudit(pool, { userId: u.id, type: "auth.login", requestId });
  return { user: publicUser(u), token };
}

/** Re-authenticates, then deletes the user. FK cascades remove sessions, profile, check-ins, reminders, history and symptom rows. */
export async function deleteAccount(pool, userId, password, { requestId }) {
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  const ok = rows[0] && (await argon2.verify(rows[0].password_hash, password).catch(() => false));
  if (!ok) throw new HttpError(403, "REAUTH_FAILED", "Password is incorrect.");
  await withTransaction(pool, async (c) => {
    await c.query("DELETE FROM users WHERE id = $1", [userId]);
    // audit_events.user_id is ON DELETE SET NULL; new event carries no user reference or PII.
    await c.query("INSERT INTO audit_events(user_id, event_type, request_id) VALUES (NULL,'account.deleted',$1)", [requestId]);
  });
}
