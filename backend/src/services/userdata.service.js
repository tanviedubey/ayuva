import { notFound } from "../lib/httpError.js";

// Every query below is scoped by user_id. Callers pass req.user.id; never a client-supplied owner.
const CHECKIN = "checkin_date::text AS date, mood, energy, digestion, sleep_hours::float8 AS sleep";
const REMINDER = "id, name, to_char(reminder_time,'HH24:MI') AS time, active, taken_on::text AS \"takenOn\"";
const HISTORY = "id, date::text AS date, title, urgency, summary";

export const listHistory = async (pool, uid, limit = 200) =>
  (await pool.query(`SELECT ${HISTORY} FROM symptom_history WHERE user_id=$1 ORDER BY date DESC, created_at DESC LIMIT $2`, [uid, limit])).rows;

export async function addHistory(pool, uid, { date, title, urgency, summary }) {
  const { rows } = await pool.query(
    `INSERT INTO symptom_history(user_id, date, title, urgency, summary) VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5) RETURNING ${HISTORY}`,
    [uid, date ?? null, title, urgency, summary ?? null]);
  return rows[0];
}
export async function deleteHistory(pool, uid, id) {
  const { rowCount } = await pool.query("DELETE FROM symptom_history WHERE id=$1 AND user_id=$2", [id, uid]);
  if (!rowCount) throw notFound("History entry not found.");
}

export const listCheckins = async (pool, uid, { from, to } = {}) =>
  (await pool.query(
    `SELECT ${CHECKIN} FROM health_checkins WHERE user_id=$1 AND ($2::date IS NULL OR checkin_date >= $2::date) AND ($3::date IS NULL OR checkin_date <= $3::date)
      ORDER BY checkin_date DESC LIMIT 800`, [uid, from ?? null, to ?? null])).rows;

export async function upsertCheckin(pool, uid, date, { mood, energy, digestion, sleep }) {
  const { rows } = await pool.query(
    `INSERT INTO health_checkins(user_id, checkin_date, mood, energy, digestion, sleep_hours) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, checkin_date) DO UPDATE SET mood=EXCLUDED.mood, energy=EXCLUDED.energy, digestion=EXCLUDED.digestion,
       sleep_hours=EXCLUDED.sleep_hours, updated_at=NOW() RETURNING ${CHECKIN}`, [uid, date, mood, energy, digestion, sleep]);
  return rows[0];
}

export const listReminders = async (pool, uid) =>
  (await pool.query(`SELECT ${REMINDER} FROM reminders WHERE user_id=$1 ORDER BY reminder_time, created_at`, [uid])).rows;

export async function addReminder(pool, uid, { name, time, active }) {
  const { rows } = await pool.query(
    `INSERT INTO reminders(user_id, name, reminder_time, active) VALUES ($1,$2,$3,COALESCE($4,TRUE)) RETURNING ${REMINDER}`, [uid, name, time, active ?? null]);
  return rows[0];
}

export async function patchReminder(pool, uid, id, patch) {
  const cols = { name: "name", time: "reminder_time", active: "active", takenOn: "taken_on" };
  const sets = [], vals = [id, uid];
  for (const [k, col] of Object.entries(cols)) if (k in patch) { vals.push(patch[k]); sets.push(`${col} = $${vals.length}`); }
  const { rows } = await pool.query(`UPDATE reminders SET ${sets.join(", ")}, updated_at = NOW() WHERE id=$1 AND user_id=$2 RETURNING ${REMINDER}`, vals);
  if (!rows[0]) throw notFound("Reminder not found.");
  return rows[0];
}
export async function deleteReminder(pool, uid, id) {
  const { rowCount } = await pool.query("DELETE FROM reminders WHERE id=$1 AND user_id=$2", [id, uid]);
  if (!rowCount) throw notFound("Reminder not found.");
}

export async function getProfile(pool, uid) {
  const { rows } = await pool.query("SELECT u.id, u.name, u.email, p.age FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=$1", [uid]);
  if (!rows[0]) throw notFound("Profile not found.");
  return { ...rows[0], age: rows[0].age ?? null };
}
export async function patchProfile(pool, uid, patch) {
  if ("name" in patch) await pool.query("UPDATE users SET name=$1, updated_at=NOW() WHERE id=$2", [patch.name, uid]);
  if ("age" in patch) await pool.query(
    "INSERT INTO profiles(user_id, age) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET age=EXCLUDED.age, updated_at=NOW()", [uid, patch.age]);
  return getProfile(pool, uid);
}

export async function calendarSummary(pool, uid, { from, to }) {
  const checkins = await listCheckins(pool, uid, { from, to });
  const { rows: history } = await pool.query(
    `SELECT ${HISTORY} FROM symptom_history WHERE user_id=$1 AND date BETWEEN $2::date AND $3::date ORDER BY date`, [uid, from, to]);
  const sleeps = checkins.map((c) => c.sleep).filter((x) => x != null);
  return { from, to, checkins, history, stats: { checkins: checkins.length, symptomChecks: history.length, averageSleep: sleeps.length ? Math.round((sleeps.reduce((a, b) => a + b, 0) / sleeps.length) * 10) / 10 : null } };
}

export async function exportAll(pool, uid) {
  return {
    exportedAt: new Date().toISOString(),
    profile: await getProfile(pool, uid),
    checkins: await listCheckins(pool, uid),
    reminders: await listReminders(pool, uid),
    symptomHistory: await listHistory(pool, uid, 5000),
    notes: "Passwords, session tokens and audit logs are intentionally excluded.",
  };
}
