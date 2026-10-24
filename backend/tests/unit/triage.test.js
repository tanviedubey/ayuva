import test from "node:test";
import assert from "node:assert/strict";
import { screenText, emergencyResponse, normalize, EMERGENCY_RULES, SAFETY_RULE_VERSION } from "../../src/services/triage.service.js";

const EMERGENCY_CASES = {
  breathing: ["I can't breathe", "severe difficulty breathing", "she is gasping for air", "I have shortness of breath and my lips are turning blue", "trouble breathing since morning"],
  chest_pain: ["I have severe chest pain", "my chest feels tight and heavy", "pressure in my chest spreading to my arm", "chest pain for 20 minutes"],
  stroke: ["his face is drooping", "slurred speech and confusion", "sudden weakness on one side", "one-sided weakness since morning", "she cannot speak properly"],
  unconscious: ["my father fainted", "he passed out and is unresponsive", "she is unconscious"],
  seizure: ["my son is having a seizure", "she was convulsing", "he had a seizure at night"],
  anaphylaxis: ["severe allergic reaction after eating peanuts", "my throat is swelling", "tongue swelling after the medicine", "anaphylaxis"],
  bleeding: ["I am coughing up blood", "vomiting blood", "blood in my phlegm", "heavy bleeding that won't stop", "cough with blood"],
  self_harm: ["I want to die", "I am thinking about suicide", "I want to kill myself", "I might hurt myself", "I don't want to live anymore"],
};

for (const [category, examples] of Object.entries(EMERGENCY_CASES)) {
  for (const text of examples) {
    test(`emergency: ${category} <- "${text}"`, () => {
      const r = screenText(text);
      assert.equal(r.urgency, "emergency");
      assert.ok(r.categories.includes(category), `expected category ${category}, got ${r.categories}`);
    });
  }
}

test("emergency detection survives casing, punctuation, curly apostrophes and spacing", () => {
  for (const t of ["I CAN’T   BREATHE!!!", "chest-pain", "Coughing  UP  blood.", "i can`t breathe"]) assert.equal(screenText(t).urgency, "emergency", t);
});

test("Hinglish/Hindi sample rules escalate", () => {
  for (const t of ["seene mein dard hai", "saans lene mein takleef", "wo behosh ho gaya", "सीने में दर्द", "बेहोश हो गया", "आत्महत्या"]) assert.equal(screenText(t).urgency, "emergency", t);
});

test("safe non-red-flag inputs are routine", () => {
  for (const t of ["mild cough since today", "bloating after meals", "I feel stressed and sleep poorly", "dull headache", "runny nose", "Fever"]) {
    const r = screenText(t);
    assert.equal(r.urgency, "routine", `${t} -> ${r.ruleIds}`);
    assert.deepEqual(r.categories, []);
  }
});

test("urgent (non-emergency) rules escalate conservatively", () => {
  for (const t of ["my fever is getting worse", "I can't keep fluids down", "black stools since yesterday", "severe abdominal pain", "cough for more than 3 weeks", "stiff neck"]) {
    assert.equal(screenText(t).urgency, "urgent", t);
  }
});

test("emergency outranks urgent", () => {
  assert.equal(screenText("my cough is getting worse and I'm coughing up blood").urgency, "emergency");
});

test("empty / non-string input is routine and never throws", () => {
  for (const t of ["", null, undefined, 42, {}]) assert.equal(screenText(t).urgency, "routine");
});

test("emergency copy: states 112, no remedies, never says to consult an Ayurvedic doctor", () => {
  for (const cats of [["breathing"], ["chest_pain"], ["self_harm"], ["answer"]]) {
    const r = emergencyResponse(cats, { answerBased: cats[0] === "answer" });
    assert.equal(r.emergency, true);
    assert.equal(r.urgency, "emergency");
    assert.match(r.reply, /112/);
    assert.doesNotMatch(r.reply, /ayurved|vaidya|kadha|tulsi|honey|ginger|turmeric|try (this|drinking|taking)/i);
    assert.equal(r.plan, undefined);
    assert.equal(r.sources, undefined);
    assert.deepEqual(r.options, ["Start over"]);
    assert.equal(r.safetyRuleVersion, SAFETY_RULE_VERSION);
  }
  assert.match(emergencyResponse(["self_harm"]).reply, /14416/);
});

test("rule ids are unique and every minimum category has at least one rule", () => {
  const ids = EMERGENCY_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of Object.keys(EMERGENCY_CASES)) assert.ok(EMERGENCY_RULES.some((r) => r.category === c), c);
});

test("normalize strips apostrophes and punctuation", () => {
  assert.equal(normalize("Can’t  breathe!!"), "cant breathe");
});
