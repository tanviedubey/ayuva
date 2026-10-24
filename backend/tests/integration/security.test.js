import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../helpers/app.js";

let ctx;
before(async () => { ctx = await startApp({ env: { AUTH_RATE_LIMIT_MAX: "4", CHAT_RATE_LIMIT_MAX: "3", CORS_ORIGINS: "https://app.example" } }); });
after(async () => { await ctx.close(); });
const reset = () => Object.values(ctx.app.locals.limiters).forEach((l) => l.reset());

test("CSRF: mutating requests without / with wrong token are rejected; with token accepted", async () => {
  reset(); const c = ctx.client(); const body = { email: "nobody@example.com", password: "whatever12" };
  assert.equal((await c.post("/auth/login", body, { csrf: false })).body.error.code, "CSRF_INVALID");
  await c.ensureCsrf();
  assert.equal((await c.post("/auth/login", body, { csrf: false, headers: { "x-csrf-token": "forged.value" } })).status, 403);
  assert.equal((await c.post("/auth/login", body)).status, 401, "valid CSRF reaches the handler");
  const other = ctx.client(); await other.ensureCsrf();
  assert.equal((await c.post("/auth/login", body, { csrf: false, headers: { "x-csrf-token": other.csrf } })).status, 403, "token from another cookie jar");
});
test("CSRF: cross-site Origin rejected even with valid token; every mutating private route is protected", async () => {
  reset(); const c = ctx.client(); await c.post("/auth/signup", { name: "C", email: `c${Date.now()}@example.com`, password: "correct-horse-1" });
  const r = await c.post("/history", { title: "x" }, { headers: { origin: "https://evil.example" } }); assert.equal(r.body.error.code, "CSRF_ORIGIN");
  for (const [m, p, b] of [["POST", "/history", { title: "x" }], ["POST", "/reminders", { name: "x", time: "08:00" }], ["PUT", "/checkins/2026-10-01", {}], ["PATCH", "/profile", { name: "x" }], ["DELETE", "/auth/account", { password: "x" }], ["POST", "/auth/logout"]]) {
    const res = await c.send(m, p, b, { csrf: false }); assert.equal(res.status, 403, `${m} ${p}`);
  }
});
test("rate limiting: auth routes -> 429 with Retry-After; chat routes -> 429", async () => {
  reset(); const c = ctx.client();
  const codes = []; for (let i = 0; i < 6; i++) codes.push((await c.post("/auth/login", { email: "a@example.com", password: "wrong-pass1" })).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 429, 429]);
  const limited = await c.post("/auth/login", { email: "a@example.com", password: "x" }); assert.ok(limited.headers.get("retry-after")); assert.equal(limited.body.error.code, "RATE_LIMITED");
  reset(); const chat = []; for (let i = 0; i < 5; i++) chat.push((await c.post("/chat", { message: "cough" })).status);
  assert.deepEqual(chat, [200, 200, 200, 429, 429]);
});
test("input validation: bad JSON, oversize body, bad params, wrong types", async () => {
  reset(); const c = ctx.client(); await c.ensureCsrf();
  const bad = await c.post("/chat", undefined, { rawBody: "{not json", headers: { "content-type": "application/json" } }); assert.equal(bad.status, 400); assert.equal(bad.body.error.code, "INVALID_JSON");
  const big = await c.post("/chat", undefined, { rawBody: JSON.stringify({ message: "x".repeat(40000) }), headers: { "content-type": "application/json" } }); assert.equal(big.status, 413);
  assert.equal((await c.post("/chat", { message: 123 })).status, 400);
  assert.equal((await c.post("/chat", { message: "x".repeat(501) })).status, 400);
  const u = ctx.client(); await u.post("/auth/signup", { name: "V", email: `v${Date.now()}@example.com`, password: "correct-horse-1" });
  assert.equal((await u.delete("/history/not-a-uuid")).status, 400);
  assert.equal((await u.delete("/history/1' OR '1'='1")).status, 400);
  assert.equal((await u.put("/checkins/2026-02-30", { mood: "Good", energy: "Steady", digestion: "Normal", sleep: 7 })).status, 400);
  assert.equal((await u.put("/checkins/2999-01-01", { mood: "Good", energy: "Steady", digestion: "Normal", sleep: 7 })).status, 400);
  assert.equal((await u.get("/calendar/summary?from=2026-12-31&to=2026-01-01")).status, 400);
  assert.equal((await u.patch("/reminders/11111111-1111-4111-8111-111111111111", {})).status, 400);
});
test("SQL injection strings are stored/treated as data", async () => {
  reset(); const u = ctx.client(); await u.post("/auth/signup", { name: "Robert'); DROP TABLE users;--", email: `i${Date.now()}@example.com`, password: "correct-horse-1" });
  assert.equal((await u.get("/auth/me")).body.user.name, "Robert'); DROP TABLE users;--");
  assert.equal((await ctx.pool.query("SELECT to_regclass('public.users') AS t")).rows[0].t, "users");
});
test("security headers, error envelope, 404s and no tech leakage", async () => {
  reset(); const c = ctx.client(); const r = await c.get("/does-not-exist");
  assert.equal(r.status, 404); assert.equal(r.body.error.code, "NOT_FOUND");
  const h = r.headers; assert.equal(h.get("x-content-type-options"), "nosniff"); assert.equal(h.get("x-frame-options"), "DENY"); assert.equal(h.get("x-powered-by"), null);
  assert.match(h.get("content-security-policy"), /frame-ancestors 'none'/); assert.ok(h.get("x-request-id")); assert.equal(h.get("cache-control"), "no-store");
  const home = await fetch(ctx.base + "/"); assert.equal(home.status, 200); const html = await home.text();
  assert.doesNotMatch(html, /<script>[^<]/, "no inline scripts (CSP)");
  const body = html.slice(html.indexOf("<body"));
  assert.doesNotMatch(body, /video/i, "no educational-video UI");
});
test("CORS: allowlisted origin gets credentials headers; others get none", async () => {
  const ok = await fetch(ctx.base + "/api/v1/health", { headers: { origin: "https://app.example" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://app.example");
  const no = await fetch(ctx.base + "/api/v1/health", { headers: { origin: "https://evil.example" } });
  assert.equal(no.headers.get("access-control-allow-origin"), null);
  const pre = await fetch(ctx.base + "/api/v1/auth/login", { method: "OPTIONS", headers: { origin: "https://evil.example" } }); assert.equal(pre.status, 403);
});
test("health endpoint checks the database", async () => { assert.equal((await ctx.client().get("/health")).body.status, "ok"); });
