import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, signedUpClient } from "../helpers/app.js";

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.close(); });
const count = async (t, uid) => (await ctx.pool.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id=$1`, [uid])).rows[0].n;

test("export returns the user's data without secrets; deletion requires the right password", async () => {
  const c = await signedUpClient(ctx, "Del"); const id = c.user.id;
  await c.post("/reminders", { name: "R", time: "07:30" }); await c.post("/history", { title: "Cough", urgency: "routine" });
  await c.put("/checkins/2026-10-01", { mood: "Good", energy: "Steady", digestion: "Normal", sleep: 7 });
  const exp = await c.get("/privacy/export");
  assert.equal(exp.status, 200); assert.match(exp.headers.get("content-disposition"), /attachment/);
  assert.equal(exp.body.reminders.length, 1); assert.equal(exp.body.symptomHistory.length, 1); assert.equal(exp.body.checkins.length, 1);
  assert.doesNotMatch(exp.text, /password_hash|\$argon2|token_hash/);
  const wrong = await c.delete("/auth/account", { password: "not-my-password" });
  assert.equal(wrong.status, 403); assert.equal(await count("reminders", id), 1);
  assert.equal((await c.get("/auth/me")).status, 200, "failed delete does not log out");
});

test("deleting an account removes all of that user's rows and only theirs", async () => {
  const gone = await signedUpClient(ctx, "Gone"), keep = await signedUpClient(ctx, "Keep");
  for (const c of [gone, keep]) { await c.post("/reminders", { name: "R", time: "07:30" }); await c.post("/history", { title: "T", urgency: "routine" }); await c.put("/checkins/2026-10-01", { mood: "Good", energy: "Steady", digestion: "Normal", sleep: 7 }); }
  const oldCookie = gone.sessionCookie();
  const del = await gone.delete("/auth/account", { password: "correct-horse-1" });
  assert.equal(del.status, 200);
  for (const t of ["sessions", "profiles", "health_checkins", "reminders", "symptom_history"]) assert.equal(await count(t, gone.user.id), 0, t);
  assert.equal((await ctx.pool.query("SELECT count(*)::int AS n FROM users WHERE id=$1", [gone.user.id])).rows[0].n, 0);
  for (const t of ["sessions", "profiles", "health_checkins", "reminders", "symptom_history"]) assert.ok((await count(t, keep.user.id)) >= 1, "other user's " + t);
  const replay = ctx.client(); replay.jar.set("ayuva_sid", oldCookie); assert.equal((await replay.get("/auth/me")).status, 401);
  assert.equal((await ctx.client().post("/auth/login", { email: gone.email, password: "correct-horse-1" })).status, 401);
  assert.equal((await ctx.pool.query("SELECT count(*)::int AS n FROM audit_events WHERE user_id=$1", [gone.user.id])).rows[0].n, 0, "audit rows detached");
  assert.ok((await ctx.pool.query("SELECT 1 FROM audit_events WHERE event_type='account.deleted' AND user_id IS NULL")).rowCount >= 1);
  assert.equal((await keep.get("/auth/me")).status, 200);
  // the same email can register again
  assert.equal((await ctx.client().post("/auth/signup", { name: "Again", email: gone.email, password: "correct-horse-1" })).status, 201);
});
test("audit log never contains emails, passwords or symptom text", async () => {
  const { rows } = await ctx.pool.query("SELECT event_type, metadata FROM audit_events");
  assert.doesNotMatch(JSON.stringify(rows), /@example\.com|correct-horse|cough/i);
});
