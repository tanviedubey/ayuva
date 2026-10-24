import test from "node:test";
import assert from "node:assert/strict";
import { createLlm, parseJsonLoose } from "../../src/services/llm/adapter.js";
import { validModelOutput } from "../helpers/fakePool.js";

const input = { question: "q", safeContext: {}, retrievedKnowledge: {}, sourceRecords: [], locale: "en" };
const cfg = (o = {}) => ({ provider: "gemini", apiKey: "test-key", model: "m", timeoutMs: 80, ...o });
const geminiBody = (obj) => ({ candidates: [{ content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }] });
const okFetch = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });
const codeOf = async (p) => { try { await p; return "NO_ERROR"; } catch (e) { return e.code; } };

test("provider 'none' -> LLM_DISABLED and enabled=false", async () => {
  const llm = createLlm(cfg({ provider: "none", apiKey: "" }));
  assert.equal(llm.enabled, false);
  assert.equal(await codeOf(llm.generateEducationalResponse(input)), "LLM_DISABLED");
});
test("missing API key -> LLM_DISABLED (no network call)", async () => {
  let called = false;
  const llm = createLlm(cfg({ apiKey: "" }), { fetchImpl: async () => { called = true; } });
  assert.equal(llm.enabled, false);
  assert.equal(await codeOf(llm.generateEducationalResponse(input)), "LLM_DISABLED");
  assert.equal(called, false);
});
test("missing model -> LLM_UNSUPPORTED_MODEL", async () => {
  assert.equal(await codeOf(createLlm(cfg({ model: "" })).generateEducationalResponse(input)), "LLM_UNSUPPORTED_MODEL");
});
test("HTTP 404 -> LLM_UNSUPPORTED_MODEL, 429 -> LLM_RATE_LIMITED, 500 -> LLM_PROVIDER_ERROR", async () => {
  for (const [status, expected] of [[404, "LLM_UNSUPPORTED_MODEL"], [429, "LLM_RATE_LIMITED"], [500, "LLM_PROVIDER_ERROR"], [503, "LLM_PROVIDER_ERROR"]]) {
    const llm = createLlm(cfg(), { fetchImpl: okFetch({}, status) });
    assert.equal(await codeOf(llm.generateEducationalResponse(input)), expected, String(status));
  }
});
test("timeout aborts the request -> LLM_TIMEOUT", async () => {
  const fetchImpl = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  assert.equal(await codeOf(createLlm(cfg({ timeoutMs: 30 }), { fetchImpl }).generateEducationalResponse(input)), "LLM_TIMEOUT");
});
test("network failure -> LLM_PROVIDER_ERROR", async () => {
  assert.equal(await codeOf(createLlm(cfg(), { fetchImpl: async () => { throw new TypeError("fetch failed"); } }).generateEducationalResponse(input)), "LLM_PROVIDER_ERROR");
});
test("invalid JSON -> LLM_BAD_JSON", async () => {
  assert.equal(await codeOf(createLlm(cfg(), { fetchImpl: okFetch(geminiBody("not json {")) }).generateEducationalResponse(input)), "LLM_BAD_JSON");
  assert.equal(await codeOf(createLlm(cfg(), { fetchImpl: okFetch({ candidates: [] }) }).generateEducationalResponse(input)), "LLM_BAD_JSON");
});
test("gemini success: key sent in header (never the URL), JSON parsed, fenced JSON tolerated", async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, status: 200, json: async () => geminiBody("```json\n" + JSON.stringify(validModelOutput()) + "\n```") }; };
  const out = await createLlm(cfg(), { fetchImpl }).generateEducationalResponse(input);
  assert.equal(out.summary, validModelOutput().summary);
  assert.equal(seen.opts.headers["x-goog-api-key"], "test-key");
  assert.ok(!seen.url.includes("test-key"));
  assert.match(seen.url, /models\/m:generateContent$/);
});
test("openai-style provider parses chat completion JSON", async () => {
  const body = { choices: [{ message: { content: JSON.stringify(validModelOutput()) } }] };
  const out = await createLlm(cfg({ provider: "openai" }), { fetchImpl: okFetch(body) }).generateEducationalResponse(input);
  assert.equal(out.whenToSeekCare, validModelOutput().whenToSeekCare);
});
test("unknown provider name is treated as disabled", async () => {
  assert.equal(await codeOf(createLlm(cfg({ provider: "mystery" })).generateEducationalResponse(input)), "LLM_DISABLED");
});
test("parseJsonLoose rejects non-strings", () => { assert.throws(() => parseJsonLoose(undefined), { code: "LLM_BAD_JSON" }); });
