import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  requestId, securityHeaders, cors, cookies, csrfProtection, createRateLimiter, sessionLoader, notFoundApi, errorHandler,
} from "./middleware/core.js";
import { buildRouter } from "./routes/index.js";
import { createLlm } from "./services/llm/adapter.js";
import { createLogger } from "./lib/logger.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

export function createApp({ config, pool, llm = createLlm(config.llm), logger = createLogger({ silent: config.env === "test" }) }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(requestId);
  app.use(securityHeaders(config));
  app.use(cors(config));
  app.use((req, res, next) => {
    const t0 = Date.now();
    res.on("finish", () => { if (req.path.startsWith("/api/")) logger.info("req", { requestId: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t0 }); });
    next();
  });

  app.use(express.static(PUBLIC_DIR, { index: "index.html", maxAge: 0 }));

  const api = express.Router();
  const general = createRateLimiter({ name: "general", windowMs: config.rate.windowMs, max: config.rate.max });
  api.use(general);
  api.use(express.json({ limit: "32kb", strict: true }));
  api.use(cookies);
  api.use(csrfProtection(config));
  api.use(sessionLoader({ pool, config }));
  const router = buildRouter({ config, pool, llm, logger });
  api.use(router);
  api.use(notFoundApi);
  app.use("/api/v1", api);
  app.use("/api", notFoundApi);

  app.use(errorHandler(logger));
  app.locals.limiters = { general, ...router.limiters };
  return app;
}
