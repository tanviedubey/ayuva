import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../../src/schemas/index.js";
import { loadConfig } from "../../src/config/env.js";

const ok = (schema, v) => assert.ok(schema.safeParse(v).success, JSON.stringify(v));
const bad = (schema, v) => assert.ok(!schema.safeParse(v).success, JSON.stringify(v));

test("signup: normalises email, enforces password length, optional age coercion", () => {
  const r = S.signupBody.parse({ name: "  Asha  ", email: " Asha@Example.COM ", password: "12345678", age: "34" });
  assert.deepEqual([r.name, r.email, r.age], ["Asha", "asha@example.com", 34]);
  assert.equal(S.signupBody.parse({ name: "A", email: "a@b.co", password: "12345678", age: "" }).age, undefined);
  bad(S.signupBody, { name: "A", email: "a@b.co", password: "short" });
  bad(S.signupBody, { name: "A", email: "not-an-email", password: "12345678" });
  bad(S.signupBody, { name: "", email: "a@b.co", password: "12345678" });
  bad(S.signupBody, { name: "A", email: "a@b.co", password: "x".repeat(129) });
  bad(S.signupBody, { name: "A", email: "a@b.co", password: "12345678", age: 0 });
  bad(S.signupBody, { name: "A", email: "a@b.co", password: "12345678", age: 121 });
});
test("chat: message required and bounded; state shape validated", () => {
  ok(S.chatBody, { state: { topic: null }, message: "cough" });
  ok(S.chatBody, { message: "cough", state: { topic: "cough", answers: { dur: "Since today" }, current: "dur", flags: 0, queue: ["x"] } });
  bad(S.chatBody, { message: "" }); bad(S.chatBody, { message: "x".repeat(501) }); bad(S.chatBody, {}); bad(S.chatBody, { message: "hi", state: { answers: { a: 5 } } });
});
test("checkin / reminder / history / profile bounds", () => {
  ok(S.checkinBody, { mood: "Good", energy: "Steady", digestion: "Normal", sleep: 7.5 });
  bad(S.checkinBody, { mood: "Meh", energy: "Steady", digestion: "Normal", sleep: 7 });
  bad(S.checkinBody, { mood: "Good", energy: "Steady", digestion: "Normal", sleep: 15 });
  bad(S.checkinBody, { mood: "Good", energy: "Steady", digestion: "Normal", sleep: -1 });
  ok(S.reminderCreate, { name: "Triphala", time: "08:00" }); bad(S.reminderCreate, { name: "x", time: "8am" }); bad(S.reminderCreate, { name: "x", time: "24:00" });
  bad(S.reminderPatch, {}); ok(S.reminderPatch, { takenOn: null }); bad(S.reminderPatch, { takenOn: "2026-02-30" });
  ok(S.historyBody, { title: "Fever", urgency: "urgent" }); bad(S.historyBody, { title: "Fever", urgency: "severe" }); bad(S.historyBody, { title: "" });
  bad(S.profilePatch, {}); ok(S.profilePatch, { age: null });
});
test("params and dates", () => {
  ok(S.idParam, { id: "11111111-1111-4111-8111-111111111111" }); bad(S.idParam, { id: "1; DROP TABLE users" });
  ok(S.dateParam, { date: "2026-10-23" }); bad(S.dateParam, { date: "2026-13-01" }); bad(S.dateParam, { date: "23-10-2026" });
  ok(S.calendarQuery, { from: "2026-01-01", to: "2026-12-31" }); bad(S.calendarQuery, { from: "2026-12-31", to: "2026-01-01" }); bad(S.calendarQuery, { from: "2020-01-01", to: "2026-01-01" });
  ok(S.knowledgeQuery, { topic: "cough", q: "ginger" }); bad(S.knowledgeQuery, { topic: "../etc" });
});

const base = { DATABASE_URL: "postgresql://u:p@localhost/db", SESSION_SECRET: "s".repeat(40) };
test("config: valid env, defaults, and hard failures", () => {
  const c = loadConfig(base);
  assert.equal(c.port, 3001); assert.equal(c.llm.provider, "none"); assert.equal(c.sessionTtlMs, 24 * 3600 * 1000); assert.equal(c.isProd, false);
  assert.throws(() => loadConfig({ ...base, SESSION_SECRET: "short" }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ ...base, SESSION_SECRET: "REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS" }), /placeholder/);
  assert.throws(() => loadConfig({ SESSION_SECRET: base.SESSION_SECRET }), /DATABASE_URL/);
  assert.throws(() => loadConfig({ ...base, PORT: "abc" }), /PORT/);
  assert.throws(() => loadConfig({ ...base, LLM_PROVIDER: "weird" }), /LLM_PROVIDER/);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: "production", APP_ORIGIN: "http://example.com" }), /https/);
  assert.equal(loadConfig({ ...base, NODE_ENV: "production", APP_ORIGIN: "https://ayuva.example" }).isProd, true);
  assert.equal(loadConfig({ ...base, LLM_PROVIDER: "gemini" }).llm.apiKey, "", "missing key is allowed at startup (safe fallback), not a crash");
});
