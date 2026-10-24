import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp } from "../helpers/app.js";
import { seedSamples } from "../../src/db/seed.js";
import { LlmError } from "../../src/services/llm/errors.js";

let llmCalls = 0, llmImpl = async () => { throw new LlmError("LLM_DISABLED", "x"); };
const llm = { enabled: true, async generateEducationalResponse(i) { llmCalls++; return llmImpl(i); } };
let ctx;
before(async () => { ctx = await startApp({ llm }); });
after(async () => { await ctx.close(); });

const EMERGENCIES = ["I can't breathe", "severe chest pain", "face drooping and slurred speech", "she fainted and is unresponsive", "my son is having a seizure",
  "severe allergic reaction, throat swelling", "coughing up blood", "heavy bleeding that won't stop", "I want to kill myself"];

for (const m of EMERGENCIES) {
  test(`HTTP: emergency "${m}" -> 112, no plan, LLM never called, nothing stored`, async () => {
    llmCalls = 0; const c = ctx.client();
    const r = await c.post("/chat", { state: { topic: null }, message: m });
    assert.equal(r.status, 200); assert.equal(r.body.emergency, true); assert.match(r.body.reply, /112/);
    assert.equal(r.body.plan, undefined); assert.equal(llmCalls, 0);
    for (const t of ["symptom_history", "symptom_sessions", "symptom_messages"]) {
      const exists = (await ctx.pool.query("SELECT to_regclass($1) AS t", ["public." + t])).rows[0].t;
      if (exists) assert.equal((await ctx.pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n, 0, t);
    }
  });
}

async function coughFlow(c, answers = ["Since today", "Dry", "None"]) {
  let r = await c.post("/chat", { state: { topic: null }, message: "I have a cough" });
  for (const a of answers) { r = await c.post("/chat", { state: r.body.state, message: a }); if (r.body.emergency) break; }
  return r;
}

test("HTTP: routine flow returns curated plan whose sources all exist and are approved", async () => {
  llmCalls = 0; llmImpl = async () => { throw new LlmError("LLM_TIMEOUT", "x"); };
  const r = await coughFlow(ctx.client());
  assert.equal(r.status, 200); assert.equal(r.body.urgency, "routine"); assert.equal(r.body.plan.origin, "curated"); assert.equal(llmCalls, 1);
  assert.ok(r.body.sources.length > 0);
  for (const s of r.body.sources) {
    const { rows } = await ctx.pool.query("SELECT review_status FROM sources WHERE id=$1", [s.id]);
    assert.equal(rows[0]?.review_status, "approved");
  }
  assert.ok(r.body.plan.traditionalUse.length && r.body.plan.evidence.length && r.body.plan.whenToSeekCare);
  assert.equal((await ctx.pool.query("SELECT count(*)::int AS n FROM symptom_history")).rows[0].n, 0, "guest symptom text not stored");
});

test("HTTP: model citing an unknown source id falls back to curated content", async () => {
  llmImpl = async () => ({ summary: "x", traditionalUse: [], evidenceAssessment: [], selfCare: [], avoidOrCaution: [], redFlags: [], whenToSeekCare: "See a clinician.", sources: ["99999999-9999-4999-8999-999999999999"], disclaimer: "d" });
  const r = await coughFlow(ctx.client());
  assert.equal(r.body.plan.origin, "curated"); assert.ok(r.body.fallbackReason);
});

test("HTTP: invalid JSON / rate limit / missing key paths never produce an unreviewed remedy list", async () => {
  for (const code of ["LLM_BAD_JSON", "LLM_RATE_LIMITED", "LLM_DISABLED", "LLM_UNSUPPORTED_MODEL"]) {
    llmImpl = async () => { throw new LlmError(code, "x"); };
    const r = await coughFlow(ctx.client());
    assert.equal(r.body.plan.origin, "curated", code);
    const { rows } = await ctx.pool.query("SELECT details FROM knowledge_entries WHERE topic='cough' AND review_status='approved'");
    assert.deepEqual(r.body.plan.selfCare, rows[0].details.selfCare);
  }
});

test("HTTP: with no approved knowledge the API states evidence is insufficient and offers no remedies", async () => {
  await ctx.pool.query("UPDATE knowledge_entries SET review_status='in_review', reviewed_by=NULL, reviewed_at=NULL");
  llmCalls = 0; const r = await coughFlow(ctx.client());
  assert.equal(r.body.plan.origin, "none"); assert.equal(r.body.plan.evidence[0].level, "insufficient");
  assert.deepEqual(r.body.plan.selfCare, []); assert.equal(llmCalls, 0);
  assert.equal((await ctx.client().get("/knowledge")).body.entries.length, 0);
  await seedSamples(ctx.pool, { approve: true });
  await ctx.pool.query("UPDATE knowledge_entries SET review_status='approved', reviewed_by='t', reviewed_at=NOW()");
});

test("HTTP: /knowledge serves only approved entries, hides reviewer identity, and escapes LIKE wildcards", async () => {
  const c = ctx.client();
  const all = await c.get("/knowledge"); assert.equal(all.status, 200); assert.ok(all.body.entries.length >= 5);
  assert.ok(all.body.entries.every((e) => e.reviewed === true && e.reviewedBy === undefined && e.sources.length > 0));
  assert.equal((await c.get("/knowledge?topic=cough")).body.entries.length, 1);
  assert.equal((await c.get("/knowledge?q=%25")).body.entries.length, 0, "% is literal, not a wildcard");
  assert.equal((await c.get("/knowledge?topic=bogus")).status, 400);
  await ctx.pool.query("UPDATE sources SET review_status='in_review' WHERE title='Cough'");
  const cough = (await c.get("/knowledge?topic=cough")).body.entries[0];
  assert.ok(cough.sources.every((s) => s.title !== "Cough"), "unapproved source never served");
  await ctx.pool.query("UPDATE sources SET review_status='approved'");
});

test("HTTP: symptom check is saved to history only when signed in (client reports result)", async () => {
  llmImpl = async () => { throw new LlmError("LLM_DISABLED", "x"); };
  const c = ctx.client(); await c.post("/auth/signup", { name: "S", email: `s${Date.now()}@example.com`, password: "correct-horse-1" });
  const r = await coughFlow(c);
  const h = await c.post("/history", { title: r.body.plan.title, urgency: r.body.urgency });
  assert.equal(h.status, 201); assert.equal((await c.get("/history")).body.history.length, 1);
});
