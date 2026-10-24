import test from "node:test";
import assert from "node:assert/strict";
import { chatStep } from "../../src/services/chat.service.js";
import { LlmError } from "../../src/services/llm/errors.js";
import { fakePool, validModelOutput, SRC_A, SRC_B } from "../helpers/fakePool.js";

function fakeLlm(impl) {
  const llm = { enabled: true, calls: 0, async generateEducationalResponse(i) { llm.calls++; llm.last = i; return impl(i); } };
  return llm;
}
const deps = (over = {}) => ({ pool: fakePool(), llm: fakeLlm(async () => validModelOutput()), log: { warn() {}, info() {}, error() {} }, audit: async () => {}, ...over });

async function runCoughFlow(d, { last = "Dry", wheeze = "None", dur = "Since today" } = {}) {
  let r = await chatStep({ state: { topic: null }, message: "I have a cough" }, d);
  assert.equal(r.state.current, "dur");
  for (const m of [dur, last, wheeze]) {
    r = await chatStep({ state: r.state, message: m }, d);
    if (r.emergency) return r; // state resets after an emergency; stop here
  }
  return r;
}

const EMERGENCY_MESSAGES = ["I can't breathe", "severe chest pain", "face drooping and slurred speech", "she fainted", "seizure", "my throat is swelling", "coughing up blood", "I want to die"];

for (const m of EMERGENCY_MESSAGES) {
  test(`LLM and database retrieval are NOT reached on emergency input: "${m}"`, async () => {
    const d = deps();
    const r = await chatStep({ state: { topic: null }, message: m }, d);
    assert.equal(r.emergency, true);
    assert.equal(r.urgency, "emergency");
    assert.equal(d.llm.calls, 0);
    assert.equal(d.pool.queries.length, 0);
    assert.equal(r.plan, undefined);
    assert.match(r.reply, /112/);
  });
}

test("emergency mid-flow (free-text while a question is pending) short-circuits the LLM", async () => {
  const d = deps();
  let r = await chatStep({ state: { topic: null }, message: "cough" }, d);
  r = await chatStep({ state: r.state, message: "actually I'm coughing up blood now" }, d);
  assert.equal(r.emergency, true); assert.equal(d.llm.calls, 0);
});

test("emergency option answer ('Blood in phlegm' / 'Hard to breathe') escalates server-side", async () => {
  for (const [last, wheeze] of [["Blood in phlegm", "None"], ["Dry", "Hard to breathe"]]) {
    const d = deps();
    const r = await runCoughFlow(d, { last, wheeze });
    assert.equal(r.emergency, true, last + wheeze); assert.equal(d.llm.calls, 0);
  }
});

test("tampered client state cannot hide or inject an emergency: stored answers are re-screened", async () => {
  const d = deps();
  const r = await chatStep({ state: { topic: "cough", answers: { symptom: "I can't breathe", dur: "Since today" }, current: "cough" }, message: "Dry" }, d);
  assert.equal(r.emergency, true); assert.equal(d.llm.calls, 0);
});

test("client-supplied flags/queue are ignored; flow is recomputed server-side", async () => {
  const d = deps();
  const r = await chatStep({ state: { topic: "cough", answers: {}, current: null, flags: 0, queue: [] }, message: "Dry" }, d);
  assert.ok(r.state.current, "server still asks the required questions");
});

test("routine path: curated plan, validated sources only, LLM wording merged but self-care stays curated", async () => {
  const llm = fakeLlm(async () => validModelOutput({ selfCare: ["Something unreviewed"], summary: "Model summary." }));
  const r = await runCoughFlow(deps({ llm }));
  assert.equal(llm.calls, 1);
  assert.equal(r.urgency, "routine"); assert.equal(r.emergency, false);
  assert.equal(r.plan.origin, "llm");
  assert.equal(r.plan.summary, "Model summary.");
  assert.deepEqual(r.plan.selfCare, ["Rest and drink plenty of fluids"]);
  assert.deepEqual(r.plan.sources.map((s) => s.id), [SRC_A]);
  assert.ok(r.plan.redFlags.includes("Coughing up blood"));
  assert.match(r.plan.whenToSeekCare, /clinician/);
  assert.ok(r.disclaimer);
});

test("LLM receives no free-text symptom message (data minimisation)", async () => {
  const llm = fakeLlm(async () => validModelOutput());
  await runCoughFlow(deps({ llm }));
  assert.doesNotMatch(JSON.stringify(llm.last), /I have a cough/);
  assert.ok(llm.last.sourceRecords.every((s) => [SRC_A, SRC_B].includes(s.id)));
});

test("urgency comes only from deterministic rules: answers that need a clinician -> urgent, LLM cannot change it", async () => {
  const llm = fakeLlm(async () => validModelOutput({ summary: "Totally fine, no need to worry." }));
  const r = await runCoughFlow(deps({ llm }), { last: "Yellow or green phlegm", dur: "4 days or more" });
  assert.equal(r.urgency, "urgent"); assert.equal(r.level, 1);
  assert.match(r.note, /clinician should see this soon/);
});

const FAILURES = {
  "provider disabled / missing key": () => { throw new LlmError("LLM_DISABLED", "x"); },
  "timeout": () => { throw new LlmError("LLM_TIMEOUT", "x"); },
  "rate limit": () => { throw new LlmError("LLM_RATE_LIMITED", "x"); },
  "unsupported model": () => { throw new LlmError("LLM_UNSUPPORTED_MODEL", "x"); },
  "invalid JSON": () => { throw new LlmError("LLM_BAD_JSON", "x"); },
  "unknown source ids": () => validModelOutput({ sources: ["99999999-9999-4999-8999-999999999999"] }),
  "schema-invalid object": () => ({ hello: "world" }),
  "unsafe dose language": () => validModelOutput({ summary: "Take 2 tsp daily." }),
  "unexpected crash": () => { throw new Error("boom"); },
};
for (const [name, impl] of Object.entries(FAILURES)) {
  test(`safe fallback to curated, sourced content when LLM fails: ${name}`, async () => {
    const llm = fakeLlm(async () => impl());
    const r = await runCoughFlow(deps({ llm }));
    assert.equal(llm.calls, 1);
    assert.equal(r.plan.origin, "curated");
    assert.deepEqual(r.plan.selfCare, ["Rest and drink plenty of fluids"]);
    assert.deepEqual(r.plan.sources.map((s) => s.id).sort(), [SRC_A, SRC_B].sort());
    assert.ok(r.fallbackReason);
  });
}

test("LLM not configured at all: curated plan, no calls", async () => {
  const r = await runCoughFlow(deps({ llm: { enabled: false, async generateEducationalResponse() { throw new Error("must not be called"); } } }));
  assert.equal(r.plan.origin, "curated");
});

test("no approved entry -> 'evidence insufficient' and no remedies (no fabricated content)", async () => {
  const llm = fakeLlm(async () => validModelOutput());
  const r = await runCoughFlow(deps({ pool: fakePool({ entry: null }), llm }));
  assert.equal(llm.calls, 0);
  assert.equal(r.plan.origin, "none");
  assert.deepEqual(r.plan.selfCare, []); assert.deepEqual(r.plan.sources, []);
  assert.equal(r.plan.evidence[0].level, "insufficient");
});

test("entry without sources is treated as insufficient evidence (never cites nothing)", async () => {
  const r = await runCoughFlow(deps({ pool: fakePool({ sources: [] }) }));
  assert.equal(r.plan.origin, "none");
});

test("every source in the response exists in the retrieved records", async () => {
  const r = await runCoughFlow(deps());
  const known = new Set([SRC_A, SRC_B]);
  for (const s of r.sources) assert.ok(known.has(s.id));
});

test("unrecognised option text re-asks the same question instead of guessing", async () => {
  const d = deps();
  let r = await chatStep({ state: { topic: null }, message: "cough" }, d);
  const asked = r.state.current;
  r = await chatStep({ state: r.state, message: "banana" }, d);
  assert.equal(r.state.current, asked); assert.match(r.reply, /choose one of the options/i);
});

test("'Start over' resets; unknown topic asks for clarification", async () => {
  const d = deps();
  let r = await chatStep({ state: { topic: "cough", answers: { symptom: "cough" }, current: "dur" }, message: "Start over" }, d);
  assert.equal(r.state.topic, null);
  r = await chatStep({ state: { topic: null }, message: "my elbow looks odd" }, d);
  assert.ok(r.options.length >= 5);
});

test("hopeless answer adds Tele-MANAS support text without an emergency", async () => {
  const d = deps();
  let r = await chatStep({ state: { topic: null }, message: "I feel stressed" }, d);
  for (const a of ["Since today", "Feeling hopeless"]) r = await chatStep({ state: r.state, message: a }, d);
  assert.equal(r.urgency, "urgent"); assert.match(r.note, /14416/);
});

test("audit hook receives categories only, never the message text", async () => {
  const events = [];
  await chatStep({ state: { topic: null }, message: "my private text: I can't breathe" }, deps({ audit: async (t, m) => events.push([t, m]) }));
  assert.equal(events[0][0], "redflag.triggered");
  assert.doesNotMatch(JSON.stringify(events), /private text/);
});
