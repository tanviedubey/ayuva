import { z } from "zod";

const bool = (v) => (typeof v === "string" ? ["1", "true", "yes"].includes(v.toLowerCase()) : !!v);
const int = (def) => z.preprocess((v) => (v === undefined || v === "" ? def : Number(v)), z.number().int().positive());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: int(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: int(24),
  APP_ORIGIN: z.string().url().default("http://localhost:3001"),
  CORS_ORIGINS: z.string().default(""),
  TRUST_PROXY: z.string().default("false"),
  LLM_PROVIDER: z.enum(["none", "gemini", "openai"]).default("none"),
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default(""),
  LLM_TIMEOUT_MS: int(15000),
  RATE_LIMIT_WINDOW_MS: int(900000),
  RATE_LIMIT_MAX: int(100),
  AUTH_RATE_LIMIT_MAX: int(10),
  CHAT_RATE_LIMIT_MAX: int(30),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  const e = parsed.data;
  if (/^REPLACE/i.test(e.SESSION_SECRET)) throw new Error("Invalid environment: SESSION_SECRET is still the placeholder");
  const prod = e.NODE_ENV === "production";
  if (prod && !e.APP_ORIGIN.startsWith("https://")) throw new Error("Invalid environment: APP_ORIGIN must be https in production");
  return Object.freeze({
    env: e.NODE_ENV,
    isProd: prod,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    sessionTtlMs: e.SESSION_TTL_HOURS * 3600 * 1000,
    appOrigin: new URL(e.APP_ORIGIN).origin,
    corsOrigins: e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    trustProxy: bool(e.TRUST_PROXY) ? 1 : false,
    llm: { provider: e.LLM_PROVIDER, apiKey: e.LLM_API_KEY, model: e.LLM_MODEL, timeoutMs: e.LLM_TIMEOUT_MS },
    rate: { windowMs: e.RATE_LIMIT_WINDOW_MS, max: e.RATE_LIMIT_MAX, authMax: e.AUTH_RATE_LIMIT_MAX, chatMax: e.CHAT_RATE_LIMIT_MAX },
  });
}
