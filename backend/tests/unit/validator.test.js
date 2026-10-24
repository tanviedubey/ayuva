import test from "node:test";
import assert from "node:assert/strict";
import { validateModelOutput, ModelOutputError } from "../../src/services/response-validator.js";
import { validModelOutput, SRC_A, SRC_B } from "../helpers/fakePool.js";

const allowed = { allowedSourceIds: [SRC_A, SRC_B] };
const code = (fn) => { try { fn(); } catch (e) { return e instanceof ModelOutputError ? e.code : "OTHER:" + e.message; } return "NO_ERROR"; };

test("valid output passes and keeps only retrieved sources", () => {
  const out = validateModelOutput(validModelOutput(), allowed);
  assert.deepEqual(out.sources, [SRC_A]);
});

test("unknown (fabricated) source ID in sources[] is rejected", () => {
  assert.equal(code(() => validateModelOutput(validModelOutput({ sources: ["99999999-9999-4999-8999-999999999999"] }), allowed)), "UNKNOWN_SOURCE");
});
test("unknown source ID inside evidenceAssessment is rejected", () => {
  const o = validModelOutput(); o.evidenceAssessment[0].sourceIds = ["99999999-9999-4999-8999-999999999999"];
  assert.equal(code(() => validateModelOutput(o, allowed)), "UNKNOWN_SOURCE");
});
test("non-UUID source (e.g. an invented URL or title) fails schema", () => {
  assert.equal(code(() => validateModelOutput(validModelOutput({ sources: ["https://made-up.example/study"] }), allowed)), "SCHEMA");
});
test("evidence claim above 'insufficient' without a source is rejected", () => {
  const o = validModelOutput({ sources: [SRC_A] }); o.evidenceAssessment[0].sourceIds = [];
  assert.equal(code(() => validateModelOutput(o, allowed)), "UNCITED_CLAIM");
});
test("no citations at all is rejected when sources were retrieved", () => {
  const o = validModelOutput({ sources: [] }); o.evidenceAssessment = [{ level: "insufficient", summary: "Not enough evidence.", limitations: "None reviewed.", sourceIds: [] }];
  assert.equal(code(() => validateModelOutput(o, allowed)), "NO_CITATIONS");
});
test("schema violations are rejected", () => {
  assert.equal(code(() => validateModelOutput(null, allowed)), "SCHEMA");
  assert.equal(code(() => validateModelOutput({}, allowed)), "SCHEMA");
  assert.equal(code(() => validateModelOutput(validModelOutput({ summary: "" }), allowed)), "SCHEMA");
  assert.equal(code(() => validateModelOutput(validModelOutput({ evidenceAssessment: [{ level: "proven", summary: "x", limitations: "y", sourceIds: [SRC_A] }] }), allowed)), "SCHEMA");
});

const UNSAFE = {
  "dose in mg": "Take 500 mg of the herb.",
  "dose in teaspoons": "Mix 1 tsp of powder in milk.",
  "schedule": "Use it twice a day for relief.",
  "cure claim": "This herb cures cough.",
  "guarantee": "Guaranteed relief within a day.",
  "detox": "A natural detox for your lungs.",
  "diagnosis": "You have bronchitis.",
  "stop medication": "You can stop your medication and use this instead.",
  "impersonation": "As your doctor, I recommend this.",
  "downplay": "There is no need to see a doctor.",
  "risky DIY": "Apply undiluted essential oil to the skin.",
};
for (const [name, text] of Object.entries(UNSAFE)) {
  test(`unsafe model language rejected: ${name}`, () => {
    assert.equal(code(() => validateModelOutput(validModelOutput({ summary: text }), allowed)), "UNSAFE_CONTENT");
    assert.equal(code(() => validateModelOutput(validModelOutput({ selfCare: [text] }), allowed)), "UNSAFE_CONTENT");
  });
}
