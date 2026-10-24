import { loadConfig } from "../../src/config/env.js";
import { createApp } from "../../src/app.js";
import { createLlm } from "../../src/services/llm/adapter.js";
import { freshDb, testDatabaseUrl } from "./db.js";
import { Client } from "./client.js";

export const SECRET = "t".repeat(48);

export async function startApp({ env = {}, llm, seed = true, approve = true, pool } = {}) {
  pool ??= await freshDb({ seed, approve });
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: testDatabaseUrl(), SESSION_SECRET: SECRET, APP_ORIGIN: "http://localhost:3001",
    RATE_LIMIT_MAX: "1000", AUTH_RATE_LIMIT_MAX: "1000", CHAT_RATE_LIMIT_MAX: "1000", ...env });
  const app = createApp({ config, pool, llm: llm ?? createLlm(config.llm) });
  const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, pool, config, app,
    client: () => new Client(base),
    async close() { await new Promise((r) => server.close(r)); await pool.end(); },
  };
}

let n = 0;
export async function signedUpClient(ctx, name = "Asha") {
  const c = ctx.client();
  const email = `user${++n}_${Date.now()}@example.com`;
  const r = await c.post("/auth/signup", { name, email, password: "correct-horse-1" });
  if (r.status !== 201) throw new Error("signup failed: " + JSON.stringify(r.body));
  c.email = email; c.user = r.body.user;
  return c;
}
