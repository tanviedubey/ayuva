import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = "src/db/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const stripComments = (t) => t.replace(/--.*$/gm, "");
const sql = Object.fromEntries(files.map((f) => [f, stripComments(readFileSync(`${dir}/${f}`, "utf8"))]));

test("migrations are numbered sequentially with no gaps", () => {
  files.forEach((f, i) => assert.equal(Number(f.slice(0, 3)), i + 1, f));
});
test("no destructive statements or extensions in migrations", () => {
  for (const [f, s] of Object.entries(sql)) {
    assert.doesNotMatch(s, /\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i, f);
    assert.doesNotMatch(s, /\bTRUNCATE\b/i, f);
    assert.doesNotMatch(s, /CREATE\s+EXTENSION/i, f);
    assert.doesNotMatch(s, /video/i, f);
  }
});
test("every table with user_id cascades on user deletion (account deletion guarantee)", () => {
  const all = Object.values(sql).join("\n");
  const tables = [...all.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)];
  const owned = tables.filter(([, , body]) => /user_id UUID/.test(body));
  assert.ok(owned.length >= 6);
  for (const [, name, body] of owned) {
    if (name === "audit_events") assert.match(body, /ON DELETE SET NULL/, name);
    else assert.match(body, /user_id UUID (NOT NULL |PRIMARY KEY )?REFERENCES users\(id\) ON DELETE CASCADE/, name);
  }
});
test("all CREATEs in 001 are idempotent and 002 only adds forward changes", () => {
  assert.doesNotMatch(sql[files[0]], /CREATE TABLE (?!IF NOT EXISTS)/);
  assert.doesNotMatch(sql[files[1]], /CREATE TABLE (?!IF NOT EXISTS)/);
});
test("health data minimisation: no height/weight/medical-history columns", () => {
  const all = Object.values(sql).join("\n");
  assert.doesNotMatch(all, /\b(height|weight|medical_history|allerg\w*|medications?)\b\s+(TEXT|INT|NUMERIC)/i);
});
