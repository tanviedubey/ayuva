import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_KEY = 727274001; // arbitrary app-wide advisory lock id
const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Applies ordered *.sql files. One transaction per migration; the ledger row is written in the same
 * transaction, so a failure leaves neither partial schema nor a ledger entry. A session-level
 * advisory lock prevents concurrent runners. Applied files whose checksum changed are rejected.
 */
export async function runMigrations(pool, { dir = DEFAULT_DIR, log = () => {} } = {}) {
  const files = (await readdir(dir)).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT");
    const { rows } = await client.query("SELECT version, checksum FROM schema_migrations");
    const done = new Map(rows.map((r) => [r.version, r.checksum]));

    for (const file of files) {
      const sql = await readFile(path.join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      if (done.has(file)) {
        const prev = done.get(file);
        if (prev && prev !== checksum) throw new Error(`Migration ${file} was modified after being applied. Write a new forward migration instead.`);
        if (!prev) await client.query("UPDATE schema_migrations SET checksum=$1 WHERE version=$2", [checksum, file]);
        continue;
      }
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations(version, checksum) VALUES ($1,$2) ON CONFLICT (version) DO NOTHING", [file, checksum]);
        await client.query("COMMIT");
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch { /* ignore */ }
        throw new Error(`Migration ${file} failed and was rolled back: ${e.message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
    return { applied, total: files.length };
  } finally {
    try { await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]); } catch { /* ignore */ }
    client.release();
  }
}

// CLI: node src/db/migrate.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(); } catch { /* no .env file; rely on the real environment */ }
  const { createPool } = await import("./pool.js");
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const pool = createPool(url);
  try {
    const r = await runMigrations(pool, { log: (m) => console.log(m) });
    console.log(r.applied.length ? `Done. Applied ${r.applied.length} migration(s).` : "Database already up to date.");
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await pool.end(); }
}
