import { loadConfig } from "./config/env.js";
import { createPool } from "./db/pool.js";
import { createApp } from "./app.js";
import { createLogger } from "./lib/logger.js";

try { process.loadEnvFile(); } catch { /* no .env file; rely on the real environment */ }

let config;
try { config = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }

const logger = createLogger();
const pool = createPool(config.databaseUrl);
try { await pool.query("SELECT 1"); } catch (e) { console.error("Cannot reach PostgreSQL. Check DATABASE_URL and that the server is running."); process.exit(1); }
const { rows } = await pool.query("SELECT to_regclass('public.schema_migrations') AS t").catch(() => ({ rows: [{}] }));
if (!rows[0]?.t) { console.error("Database has no schema. Run: npm run migrate"); process.exit(1); }

const app = createApp({ config, pool, logger });
const server = app.listen(config.port, () => logger.info("listening", { port: config.port, env: config.env, llm: config.llm.provider }));
server.requestTimeout = 30000; server.headersTimeout = 35000; server.keepAliveTimeout = 5000;

const shutdown = (sig) => { logger.info("shutdown", { sig }); server.close(async () => { await pool.end().catch(() => {}); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); };
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
