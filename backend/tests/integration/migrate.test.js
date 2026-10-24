import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPool } from "../../src/db/pool.js";
import { runMigrations } from "../../src/db/migrate.js";
import { resetSchema, testDatabaseUrl } from "../helpers/db.js";

const pool = createPool(testDatabaseUrl(), { max: 6 });
after(async () => { await pool.end(); });
const tableExists = async (t) => (await pool.query("SELECT to_regclass($1) AS t", ["public." + t])).rows[0].t !== null;
const realDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "../../src/db/migrations");

test("real migrations apply on a clean DB and are repeatable (idempotent)", async () => {
  await resetSchema(pool);
  const first = await runMigrations(pool);
  const files = (await readdir(realDir)).filter((f) => f.endsWith(".sql"));
  assert.equal(first.applied.length, files.length);
  const second = await runMigrations(pool);
  assert.deepEqual(second.applied, []);
  const { rows } = await pool.query("SELECT version, checksum FROM schema_migrations ORDER BY version");
  assert.equal(rows.length, files.length); assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r.checksum)));
  for (const t of ["users", "profiles", "sessions", "health_checkins", "reminders", "symptom_history", "sources", "knowledge_entries", "knowledge_entry_sources", "audit_events"])
    assert.ok(await tableExists(t), t);
  assert.ok(!(await tableExists("videos")) && !(await tableExists("educational_videos")), "no video tables");
});

test("schema constraints hold (reviewer required for approval, mood enum, evidence level)", async () => {
  await assert.rejects(pool.query(`INSERT INTO knowledge_entries(slug,title,topic,content,review_status) VALUES ('x','x','cough','c','approved')`), /knowledge_approved_needs_reviewer_chk/);
  await assert.rejects(pool.query(`INSERT INTO knowledge_entries(slug,title,topic,content,evidence_level) VALUES ('y','y','cough','c','proven')`), /knowledge_evidence_level_chk/);
  await assert.rejects(pool.query(`INSERT INTO users(name,email,password_hash) VALUES ('n','UPPER@X.COM','h')`), /check/i);
});

test("a failing migration rolls back completely (no partial table, no ledger row); earlier ones stay", async () => {
  await resetSchema(pool);
  const dir = await mkdtemp(path.join(os.tmpdir(), "ayuva-mig-"));
  await writeFile(path.join(dir, "001_ok.sql"), "CREATE TABLE t_ok(id int);");
  await writeFile(path.join(dir, "002_bad.sql"), "CREATE TABLE t_partial(id int); INSERT INTO t_ok VALUES (1); SELECT 1/0;");
  await assert.rejects(runMigrations(pool, { dir }), /002_bad\.sql failed and was rolled back/);
  assert.ok(await tableExists("t_ok")); assert.ok(!(await tableExists("t_partial")));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM t_ok")).rows[0].n, 0);
  assert.deepEqual((await pool.query("SELECT version FROM schema_migrations ORDER BY 1")).rows.map((r) => r.version), ["001_ok.sql"]);
  // fixing the file lets the runner continue forward
  await writeFile(path.join(dir, "002_bad.sql"), "CREATE TABLE t_fixed(id int);");
  assert.deepEqual((await runMigrations(pool, { dir })).applied, ["002_bad.sql"]);
});

test("modifying an already-applied migration is rejected", async () => {
  await resetSchema(pool);
  const dir = await mkdtemp(path.join(os.tmpdir(), "ayuva-mig-"));
  await writeFile(path.join(dir, "001_a.sql"), "CREATE TABLE a(id int);");
  await runMigrations(pool, { dir });
  await writeFile(path.join(dir, "001_a.sql"), "CREATE TABLE a(id int, extra int);");
  await assert.rejects(runMigrations(pool, { dir }), /modified after being applied/);
});

test("concurrent runners are serialised by the advisory lock", async () => {
  await resetSchema(pool);
  const results = await Promise.all([runMigrations(pool), runMigrations(pool), runMigrations(pool)]);
  const files = (await readdir(realDir)).filter((f) => f.endsWith(".sql"));
  assert.equal(results.reduce((n, r) => n + r.applied.length, 0), files.length, "each migration applied exactly once");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, files.length);
});
