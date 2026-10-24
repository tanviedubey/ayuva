import test from "node:test";
import assert from "node:assert/strict";
import { ZodError, z } from "zod";
import { createRateLimiter, parseCookies, csrfProtection, cors, errorHandler, validate, securityHeaders } from "../../src/middleware/core.js";
import { makeCsrfToken, isValidCsrfToken, hashToken, newToken } from "../../src/lib/crypto.js";
import { HttpError } from "../../src/lib/httpError.js";

const SECRET = "x".repeat(40);
const cfg = { appOrigin: "http://localhost:3001", corsOrigins: ["https://app.example"], sessionSecret: SECRET, isProd: false, sessionTtlMs: 1000 };
const mkRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, end() { r.ended = true; return r; }, json(b) { r.body = b; return r; }, headersSent: false }; return r; };
const mkReq = (o = {}) => ({ method: "POST", headers: {}, cookies: {}, path: "/api/v1/x", ip: "1.1.1.1", get(h) { return this.headers[h.toLowerCase()]; }, ...o });
const run = (mw, req, res = mkRes()) => new Promise((resolve) => mw(req, res, (err) => resolve({ err, res })));

test("rate limiter allows up to max then returns 429 with Retry-After; resets", async () => {
  const rl = createRateLimiter({ name: "t", windowMs: 60000, max: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await run(rl, mkReq())).err, undefined);
  const { err, res } = await run(rl, mkReq());
  assert.equal(err.status, 429); assert.equal(err.code, "RATE_LIMITED"); assert.ok(res.headers["Retry-After"]);
  assert.equal((await run(rl, mkReq({ ip: "2.2.2.2" }))).err, undefined, "other clients unaffected");
  rl.reset(); assert.equal((await run(rl, mkReq())).err, undefined);
});

test("parseCookies handles encoding, duplicates and junk", () => {
  assert.deepEqual(parseCookies("a=1; b=hello%20world; a=2; bad; c=%E0%A4%A"), { a: "1", b: "hello world" });
  assert.deepEqual(parseCookies(undefined), {});
});

test("csrf: GET passes; POST without token, mismatched token, or forged token is rejected", async () => {
  const mw = csrfProtection(cfg);
  assert.equal((await run(mw, mkReq({ method: "GET" }))).err, undefined);
  assert.equal((await run(mw, mkReq())).err.code, "CSRF_INVALID");
  const good = makeCsrfToken(SECRET);
  assert.equal((await run(mw, mkReq({ headers: { "x-csrf-token": good }, cookies: { ayuva_csrf: makeCsrfToken(SECRET) } }))).err.code, "CSRF_INVALID");
  assert.equal((await run(mw, mkReq({ headers: { "x-csrf-token": "forged.token" }, cookies: { ayuva_csrf: "forged.token" } }))).err.code, "CSRF_INVALID");
  assert.equal((await run(mw, mkReq({ headers: { "x-csrf-token": makeCsrfToken("y".repeat(40)) }, cookies: { ayuva_csrf: makeCsrfToken("y".repeat(40)) } }))).err.code, "CSRF_INVALID", "signed with another secret");
  assert.equal((await run(mw, mkReq({ headers: { "x-csrf-token": good }, cookies: { ayuva_csrf: good } }))).err, undefined);
});
test("csrf: foreign Origin is rejected even with a valid token; allowlisted origins pass", async () => {
  const mw = csrfProtection(cfg), t = makeCsrfToken(SECRET);
  const base = { cookies: { ayuva_csrf: t } };
  assert.equal((await run(mw, mkReq({ ...base, headers: { "x-csrf-token": t, origin: "https://evil.example" } }))).err.code, "CSRF_ORIGIN");
  assert.equal((await run(mw, mkReq({ ...base, headers: { "x-csrf-token": t, origin: "https://app.example" } }))).err, undefined);
  assert.equal((await run(mw, mkReq({ ...base, headers: { "x-csrf-token": t, origin: "http://localhost:3001" } }))).err, undefined);
});
test("csrf token helpers", () => {
  const t = makeCsrfToken(SECRET);
  assert.ok(isValidCsrfToken(t, SECRET)); assert.ok(!isValidCsrfToken(t, "z".repeat(40))); assert.ok(!isValidCsrfToken(undefined, SECRET)); assert.ok(!isValidCsrfToken("abc", SECRET));
});

test("session tokens: random, long, stored only as keyed hashes", () => {
  const a = newToken(), b = newToken();
  assert.notEqual(a, b); assert.ok(a.length >= 43);
  assert.notEqual(hashToken(a, SECRET), a); assert.equal(hashToken(a, SECRET), hashToken(a, SECRET)); assert.notEqual(hashToken(a, SECRET), hashToken(a, "k".repeat(40)));
});

test("CORS: strict allowlist; unknown origin gets no CORS headers; preflight answered only for allowed", async () => {
  const mw = cors(cfg);
  let { res } = await run(mw, mkReq({ method: "GET", headers: { origin: "https://evil.example" } }));
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
  ({ res } = await run(mw, mkReq({ method: "GET", headers: { origin: "https://app.example" } })));
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://app.example"); assert.equal(res.headers["Access-Control-Allow-Credentials"], "true");
  const pre = mkRes(); mw(mkReq({ method: "OPTIONS", headers: { origin: "https://app.example" } }), pre, () => {});
  assert.equal(pre.code, 204);
  const bad = mkRes(); mw(mkReq({ method: "OPTIONS", headers: { origin: "https://evil.example" } }), bad, () => {});
  assert.equal(bad.code, 403);
});

test("security headers set; HSTS only in production; no-store on API", async () => {
  const dev = await run(securityHeaders(cfg), mkReq({ method: "GET" }));
  assert.equal(dev.res.headers["X-Content-Type-Options"], "nosniff"); assert.equal(dev.res.headers["X-Frame-Options"], "DENY");
  assert.match(dev.res.headers["Content-Security-Policy"], /script-src 'self'(;|$)/); assert.doesNotMatch(dev.res.headers["Content-Security-Policy"], /script-src[^;]*unsafe-inline/);
  assert.equal(dev.res.headers["Strict-Transport-Security"], undefined); assert.equal(dev.res.headers["Cache-Control"], "no-store");
  assert.ok((await run(securityHeaders({ ...cfg, isProd: true }), mkReq({ method: "GET" }))).res.headers["Strict-Transport-Security"]);
});

test("error handler: consistent JSON, no stack traces, correct statuses", () => {
  const logs = []; const h = errorHandler({ error: (...a) => logs.push(a) });
  const call = (err) => { const res = mkRes(); h(err, { id: "rid-1", path: "/x" }, res, () => {}); return res; };
  let r = call(new HttpError(409, "EMAIL_TAKEN", "Taken")); assert.deepEqual(r.body, { error: { code: "EMAIL_TAKEN", message: "Taken", requestId: "rid-1" } }); assert.equal(r.code, 409);
  const zerr = (() => { try { z.object({ a: z.string() }).parse({}); } catch (e) { return e; } })();
  assert.ok(zerr instanceof ZodError); r = call(zerr); assert.equal(r.code, 400); assert.equal(r.body.error.code, "VALIDATION_ERROR");
  r = call(Object.assign(new Error("bad"), { type: "entity.parse.failed" })); assert.equal(r.body.error.code, "INVALID_JSON");
  r = call(Object.assign(new Error("big"), { type: "entity.too.large" })); assert.equal(r.code, 413);
  r = call(new Error("secret db password in stack")); assert.equal(r.code, 500); assert.doesNotMatch(JSON.stringify(r.body), /secret|stack/); assert.equal(logs.length, 1);
});

test("validate middleware parses body/query/params and forwards ZodError", async () => {
  const mw = validate({ body: z.object({ n: z.number() }) });
  const ok = mkReq({ body: { n: 1 } }); assert.equal((await run(mw, ok)).err, undefined); assert.deepEqual(ok.valid.body, { n: 1 });
  assert.ok((await run(mw, mkReq({ body: { n: "x" } }))).err instanceof ZodError);
  assert.ok((await run(mw, mkReq({ body: undefined }))).err instanceof ZodError);
});
