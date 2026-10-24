import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { HttpError, forbidden, unauthorized } from "../lib/httpError.js";
import { isValidCsrfToken, makeCsrfToken, hashToken, safeEqual } from "../lib/crypto.js";

export const SESSION_COOKIE = "ayuva_sid";
export const CSRF_COOKIE = "ayuva_csrf";

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function requestId(req, res, next) {
  const inbound = req.get("x-request-id");
  req.id = inbound && /^[\w-]{8,64}$/.test(inbound) ? inbound : randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

export function securityHeaders(config) {
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'", "object-src 'none'",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join("; ");
  return (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", csp);
    if (config.isProd) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
  };
}

export function cors(config) {
  const allowed = new Set([config.appOrigin, ...config.corsOrigins]);
  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin && allowed.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
        res.setHeader("Access-Control-Max-Age", "600");
        return res.status(204).end();
      }
    } else if (origin && req.method === "OPTIONS") {
      return res.status(403).end(); // origin not on the allowlist: no CORS headers
    }
    next();
  };
}

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed cookie */ }
  }
  return out;
}
export const cookies = (req, _res, next) => { req.cookies = parseCookies(req.headers.cookie); next(); };

export function csrfProtection(config) {
  const allowed = new Set([config.appOrigin, ...config.corsOrigins]);
  return (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (origin && !allowed.has(origin)) return next(forbidden("Request origin is not allowed.", "CSRF_ORIGIN"));
    const header = req.get("x-csrf-token"), cookie = req.cookies?.[CSRF_COOKIE];
    if (!header || !cookie || !safeEqual(header, cookie) || !isValidCsrfToken(cookie, config.sessionSecret))
      return next(forbidden("Missing or invalid CSRF token. Reload the page and try again.", "CSRF_INVALID"));
    next();
  };
}

export function issueCsrf(config, req, res) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!isValidCsrfToken(token, config.sessionSecret)) token = makeCsrfToken(config.sessionSecret);
  res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: config.isProd, sameSite: "lax", path: "/", maxAge: config.sessionTtlMs });
  return token;
}

export function createRateLimiter({ windowMs, max, name, keyFn = (req) => req.ip }) {
  const hits = new Map();
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, Math.min(windowMs, 60000));
  sweep.unref?.();
  const mw = (req, res, next) => {
    const now = Date.now(), key = `${name}:${keyFn(req)}`;
    let h = hits.get(key);
    if (!h || h.reset <= now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
    h.count += 1;
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - h.count)));
    if (h.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return next(new HttpError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again."));
    }
    next();
  };
  mw.reset = () => hits.clear();
  return mw;
}

export function validate({ body, query, params }) {
  return (req, _res, next) => {
    try {
      req.valid = {};
      if (params) req.valid.params = params.parse(req.params);
      if (query) req.valid.query = query.parse(req.query);
      if (body) req.valid.body = body.parse(req.body ?? {});
      next();
    } catch (e) { next(e); }
  };
}

export function sessionLoader({ pool, config }) {
  return asyncHandler(async (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    req.user = null; req.sessionId = null;
    if (token && token.length < 200) {
      const { rows } = await pool.query(
        `SELECT s.id AS sid, s.last_seen_at, u.id, u.name, u.email, p.age
           FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN profiles p ON p.user_id = u.id
          WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND u.disabled_at IS NULL`,
        [hashToken(token, config.sessionSecret)]);
      if (rows[0]) {
        const r = rows[0];
        req.user = { id: r.id, name: r.name, email: r.email, age: r.age ?? null };
        req.sessionId = r.sid;
        if (Date.now() - new Date(r.last_seen_at).getTime() > 5 * 60 * 1000)
          await pool.query("UPDATE sessions SET last_seen_at = NOW() WHERE id = $1", [r.sid]);
      }
    }
    next();
  });
}
export const requireAuth = (req, _res, next) => (req.user ? next() : next(unauthorized()));

export function notFoundApi(_req, _res, next) { next(new HttpError(404, "NOT_FOUND", "Route not found.")); }

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    let status = 500, code = "INTERNAL_ERROR", message = "Something went wrong. Please try again.";
    if (err instanceof HttpError) { status = err.status; code = err.code; message = err.message; }
    else if (err instanceof ZodError) {
      status = 400; code = "VALIDATION_ERROR";
      message = err.issues.slice(0, 3).map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join(" ");
    } else if (err?.type === "entity.parse.failed") { status = 400; code = "INVALID_JSON"; message = "Request body is not valid JSON."; }
    else if (err?.type === "entity.too.large") { status = 413; code = "PAYLOAD_TOO_LARGE"; message = "Request body is too large."; }
    if (status >= 500) logger.error("request failed", { requestId: req.id, path: req.path, errName: err?.name, errCode: err?.code });
    if (res.headersSent) return;
    res.status(status).json({ error: { code, message, requestId: req.id } });
  };
}
