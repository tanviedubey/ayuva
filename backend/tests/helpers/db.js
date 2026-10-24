import { createPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { seedSamples } from "../../src/db/seed.js";

try { process.loadEnvFile(); } catch { /* no .env */ }

export function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set. Integration tests need a PostgreSQL database whose name ends in _test (see README).");
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/_test$/.test(name)) throw new Error(`Refusing to run: database "${name}" does not end in _test. Tests DROP the public schema.`);
  return url;
}

export async function resetSchema(pool) {
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

export async function freshDb({ seed = true, approve = true } = {}) {
  const pool = createPool(testDatabaseUrl(), { max: 5 });
  await resetSchema(pool);
  await runMigrations(pool);
  if (seed) await seedSamples(pool, { approve });
  return pool;
}
