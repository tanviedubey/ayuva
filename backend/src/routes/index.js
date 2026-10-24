import { Router } from "express";
import {
  asyncHandler, validate, requireAuth, issueCsrf, createRateLimiter, SESSION_COOKIE,
} from "../middleware/core.js";
import * as S from "../schemas/index.js";
import * as auth from "../services/auth.service.js";
import * as data from "../services/userdata.service.js";
import { chatStep } from "../services/chat.service.js";
import { listEntries, publicEntry } from "../services/knowledge.service.js";
import { writeAudit } from "../services/audit.js";

export function buildRouter({ config, pool, llm, logger }) {
  const r = Router();
  const authLimit = createRateLimiter({ name: "auth", windowMs: config.rate.windowMs, max: config.rate.authMax });
  const chatLimit = createRateLimiter({ name: "chat", windowMs: config.rate.windowMs, max: config.rate.chatMax });
  const cookieOpts = { httpOnly: true, secure: config.isProd, sameSite: "lax", path: "/" };
  const setSession = (res, token) => res.cookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: config.sessionTtlMs });
  const clearSession = (res) => res.clearCookie(SESSION_COOKIE, cookieOpts);
  r.limiters = { authLimit, chatLimit };

  r.get("/health", asyncHandler(async (_req, res) => { await pool.query("SELECT 1"); res.json({ status: "ok" }); }));

  // Safe LLM diagnostics: never return the API key or other secrets.
  r.get("/llm/status", (_req, res) => {
    const provider = config.llm.provider;
    const model = config.llm.model;
    const hasKey = Boolean(config.llm.apiKey);
    const enabled = Boolean(llm?.enabled);
    const reason = enabled ? null
      : provider === "none" ? "LLM_PROVIDER_NONE"
      : !hasKey ? "LLM_API_KEY_MISSING"
      : !model ? "LLM_MODEL_MISSING"
      : "LLM_NOT_READY";
    res.json({ enabled, provider, model: model || null, reason });
  });

  // ---- CSRF + auth
  r.get("/auth/csrf", (req, res) => res.json({ csrfToken: issueCsrf(config, req, res) }));
  r.get("/auth/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Please sign in.", requestId: req.id } });
    res.json({ user: req.user });
  });
  r.post("/auth/signup", authLimit, validate({ body: S.signupBody }), asyncHandler(async (req, res) => {
    const { user, token } = await auth.signup(pool, config, req.valid.body, { requestId: req.id, oldToken: req.cookies?.[SESSION_COOKIE] });
    setSession(res, token); res.status(201).json({ user });
  }));
  r.post("/auth/login", authLimit, validate({ body: S.loginBody }), asyncHandler(async (req, res) => {
    const { user, token } = await auth.login(pool, config, req.valid.body, { requestId: req.id, oldToken: req.cookies?.[SESSION_COOKIE] });
    setSession(res, token); res.json({ user });
  }));
  r.post("/auth/logout", asyncHandler(async (req, res) => {
    await auth.revokeSessionByToken(pool, config, req.cookies?.[SESSION_COOKIE]);
    if (req.user) await writeAudit(pool, { userId: req.user.id, type: "auth.logout", requestId: req.id });
    clearSession(res); res.json({ ok: true });
  }));
  r.delete("/auth/account", authLimit, requireAuth, validate({ body: S.deleteAccountBody }), asyncHandler(async (req, res) => {
    await auth.deleteAccount(pool, req.user.id, req.valid.body.password, { requestId: req.id });
    clearSession(res); res.json({ ok: true });
  }));

  // ---- Chat (public: guests allowed; nothing is persisted for guests)
  r.post("/chat", chatLimit, validate({ body: S.chatBody }), asyncHandler(async (req, res) => {
    const audit = (type, metadata) => writeAudit(pool, { userId: req.user?.id ?? null, type, requestId: req.id, metadata });
    res.json(await chatStep(req.valid.body, { pool, llm, log: logger, audit }));
  }));

  // ---- Knowledge (public, reviewed content only)
  r.get("/knowledge", validate({ query: S.knowledgeQuery }), asyncHandler(async (req, res) => {
    res.json({ entries: (await listEntries(pool, req.valid.query)).map(publicEntry) });
  }));

  // ---- Private user data
  const priv = Router();
  priv.use(requireAuth);
  priv.get("/history", asyncHandler(async (req, res) => res.json({ history: await data.listHistory(pool, req.user.id) })));
  priv.post("/history", validate({ body: S.historyBody }), asyncHandler(async (req, res) =>
    res.status(201).json({ entry: await data.addHistory(pool, req.user.id, req.valid.body) })));
  priv.delete("/history/:id", validate({ params: S.idParam }), asyncHandler(async (req, res) => {
    await data.deleteHistory(pool, req.user.id, req.valid.params.id); res.json({ ok: true });
  }));
  priv.get("/checkins", validate({ query: S.checkinsQuery }), asyncHandler(async (req, res) =>
    res.json({ checkins: await data.listCheckins(pool, req.user.id, req.valid.query) })));
  priv.put("/checkins/:date", validate({ params: S.dateParam, body: S.checkinBody }), asyncHandler(async (req, res) => {
    const d = req.valid.params.date, limit = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    if (d > limit) return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Check-in date cannot be in the future.", requestId: req.id } });
    res.json({ checkin: await data.upsertCheckin(pool, req.user.id, d, req.valid.body) });
  }));
  priv.get("/reminders", asyncHandler(async (req, res) => res.json({ reminders: await data.listReminders(pool, req.user.id) })));
  priv.post("/reminders", validate({ body: S.reminderCreate }), asyncHandler(async (req, res) =>
    res.status(201).json({ reminder: await data.addReminder(pool, req.user.id, req.valid.body) })));
  priv.patch("/reminders/:id", validate({ params: S.idParam, body: S.reminderPatch }), asyncHandler(async (req, res) =>
    res.json({ reminder: await data.patchReminder(pool, req.user.id, req.valid.params.id, req.valid.body) })));
  priv.delete("/reminders/:id", validate({ params: S.idParam }), asyncHandler(async (req, res) => {
    await data.deleteReminder(pool, req.user.id, req.valid.params.id); res.json({ ok: true });
  }));
  priv.get("/calendar/summary", validate({ query: S.calendarQuery }), asyncHandler(async (req, res) =>
    res.json(await data.calendarSummary(pool, req.user.id, req.valid.query))));
  priv.get("/profile", asyncHandler(async (req, res) => res.json({ profile: await data.getProfile(pool, req.user.id) })));
  priv.patch("/profile", validate({ body: S.profilePatch }), asyncHandler(async (req, res) =>
    res.json({ profile: await data.patchProfile(pool, req.user.id, req.valid.body) })));
  priv.get("/privacy/export", asyncHandler(async (req, res) => {
    await writeAudit(pool, { userId: req.user.id, type: "privacy.export", requestId: req.id });
    res.setHeader("Content-Disposition", 'attachment; filename="ayuva-export.json"');
    res.json(await data.exportAll(pool, req.user.id));
  }));
  r.use(priv);
  return r;
}
