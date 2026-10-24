import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../helpers/app.js";

let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.close(); });

const pw = "correct-horse-1";
const mail = (t) => `${t}_${Date.now()}@Example.com`;

test("signup -> me -> logout -> me(401); cookie flags; no secrets in responses", async () => {
  const c = ctx.client(), email = mail("a");
  const s = await c.post("/auth/signup", { name: "Asha Rao", email, password: pw, age: 34 });
  assert.equal(s.status, 201);
  assert.deepEqual(Object.keys(s.body.user).sort(), ["age", "email", "id", "name"]);
  assert.equal(s.body.user.email, email.toLowerCase());
  assert.doesNotMatch(s.text, /password|hash|argon/i);
  const sc = c.setCookies.find((x) => x.startsWith("ayuva_sid="));
  assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Lax/i); assert.match(sc, /Path=\//); assert.match(sc, /Max-Age=\d+/i);
  const me = await c.get("/auth/me"); assert.equal(me.status, 200); assert.equal(me.body.user.name, "Asha Rao"); assert.equal(me.body.user.age, 34);
  const out = await c.post("/auth/logout"); assert.equal(out.status, 200);
  assert.equal((await c.get("/auth/me")).status, 401);
});

test("password is Argon2id; session token is stored only as a hash", async () => {
  const c = ctx.client(), email = mail("h");
  await c.post("/auth/signup", { name: "H", email, password: pw });
  const { rows: [u] } = await ctx.pool.query("SELECT password_hash FROM users WHERE email=$1", [email.toLowerCase()]);
  assert.match(u.password_hash, /^\$argon2id\$/); assert.ok(!u.password_hash.includes(pw));
  const { rows } = await ctx.pool.query("SELECT token_hash FROM sessions");
  assert.ok(rows.length > 0 && rows.every((r) => r.token_hash !== c.sessionCookie() && /^[0-9a-f]{64}$/.test(r.token_hash)));
});

test("duplicate email (any casing) -> 409 EMAIL_TAKEN", async () => {
  const email = mail("dup");
  assert.equal((await ctx.client().post("/auth/signup", { name: "D", email, password: pw })).status, 201);
  const r = await ctx.client().post("/auth/signup", { name: "D2", email: email.toUpperCase(), password: pw });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, "EMAIL_TAKEN");
});

test("invalid signup input -> 400 with consistent error envelope", async () => {
  for (const body of [{ name: "A", email: "bad", password: pw }, { name: "A", email: mail("x"), password: "short" }, { email: mail("y"), password: pw }, {}]) {
    const r = await ctx.client().post("/auth/signup", body);
    assert.equal(r.status, 400); assert.equal(r.body.error.code, "VALIDATION_ERROR"); assert.ok(r.body.error.requestId);
  }
});

test("login: wrong password and unknown email give the same 401; correct login works", async () => {
  const email = mail("l"); await ctx.client().post("/auth/signup", { name: "L", email, password: pw });
  const wrong = await ctx.client().post("/auth/login", { email, password: "wrong-password" });
  const unknown = await ctx.client().post("/auth/login", { email: mail("nobody"), password: pw });
  assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body.error.message, unknown.body.error.message);
  const c = ctx.client(); const ok = await c.post("/auth/login", { email: email.toUpperCase(), password: pw });
  assert.equal(ok.status, 200); assert.equal((await c.get("/auth/me")).status, 200);
});

test("revoked session (after logout) cannot be replayed", async () => {
  const c = ctx.client(); await c.post("/auth/signup", { name: "R", email: mail("r"), password: pw });
  const stolen = c.sessionCookie(); await c.post("/auth/logout");
  const attacker = ctx.client(); attacker.jar.set("ayuva_sid", stolen);
  assert.equal((await attacker.get("/auth/me")).status, 401);
});

test("expired session is rejected", async () => {
  const c = ctx.client(); await c.post("/auth/signup", { name: "E", email: mail("e"), password: pw });
  await ctx.pool.query("UPDATE sessions SET created_at = NOW() - INTERVAL '2 hours', expires_at = NOW() - INTERVAL '1 hour' WHERE user_id = $1", [(await c.get("/auth/me")).body.user.id]);
  assert.equal((await c.get("/auth/me")).status, 401);
});

test("forged / garbage session cookie is rejected", async () => {
  const c = ctx.client(); c.jar.set("ayuva_sid", "x".repeat(43)); assert.equal((await c.get("/auth/me")).status, 401);
  c.jar.set("ayuva_sid", "y".repeat(500)); assert.equal((await c.get("/auth/me")).status, 401);
});

test("login rotates the session: previous token is revoked", async () => {
  const email = mail("rot"); const c = ctx.client(); await c.post("/auth/signup", { name: "Rot", email, password: pw });
  const first = c.sessionCookie(); await c.post("/auth/login", { email, password: pw });
  assert.notEqual(c.sessionCookie(), first);
  const old = ctx.client(); old.jar.set("ayuva_sid", first); assert.equal((await old.get("/auth/me")).status, 401);
});

test("disabled user cannot log in or use an existing session", async () => {
  const email = mail("dis"); const c = ctx.client(); await c.post("/auth/signup", { name: "Dis", email, password: pw });
  await ctx.pool.query("UPDATE users SET disabled_at = NOW() WHERE email = $1", [email.toLowerCase()]);
  assert.equal((await c.get("/auth/me")).status, 401);
  assert.equal((await ctx.client().post("/auth/login", { email, password: pw })).status, 401);
});
