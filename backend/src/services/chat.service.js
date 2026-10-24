import { screenText, emergencyResponse, DISCLAIMER, SAFETY_RULE_VERSION, TELE_MANAS_IN } from "./triage.service.js";
import { QUESTIONS, TOPICS, TOPIC_LABELS, detectTopic, matchOption, answersSeverity } from "./triage-flow.js";
import { getApprovedEntryForTopic } from "./knowledge.service.js";
import { validateModelOutput } from "./response-validator.js";

const EMPTY_STATE = { topic: null, answers: {}, current: null };
const NO_EVIDENCE_PLAN = (title) => ({
  title,
  summary: "I don’t have a clinician-reviewed, sourced entry for this topic yet, so I can’t give evidence-based self-care guidance.",
  traditionalUse: [], evidence: [{ level: "insufficient", summary: "Evidence is insufficient or not yet reviewed in Ayuva’s knowledge base.", limitations: "No reviewed sources available." }],
  selfCare: [], avoidOrCaution: [], redFlags: [],
  whenToSeekCare: "Please speak with a qualified clinician, especially if symptoms persist, worsen or worry you.",
  sources: [], origin: "none",
});

const cleanAnswers = (answers) => {
  const out = {};
  for (const [k, v] of Object.entries(answers ?? {})) if (k === "symptom" || QUESTIONS[k]) out[k] = String(v).slice(0, 200);
  return out;
};

export function curatedPlan(entry) {
  const d = entry.details ?? {};
  const caution = [entry.knownRisks, entry.contraindications, entry.interactions].filter(Boolean);
  return {
    title: entry.title,
    summary: entry.content,
    traditionalUse: entry.traditionalUseSummary ? [entry.traditionalUseSummary] : [],
    evidence: [{ level: entry.evidenceLevel, summary: entry.scientificEvidenceSummary || "Evidence is insufficient.", limitations: d.evidenceLimitations || "See the listed sources; evidence for traditional practices is often limited." }],
    selfCare: d.selfCare ?? [],
    avoidOrCaution: [...(d.avoid ?? []), ...caution],
    redFlags: d.redFlags ?? [],
    whenToSeekCare: entry.whenToSeekCare || "See a qualified clinician if symptoms persist, worsen or worry you.",
    sources: entry.sources.map((s) => ({ id: s.id, title: s.title, organization: s.organization, url: s.url, sourceType: s.sourceType })),
    origin: "curated",
  };
}

/** The model may only reword narrative parts. Self-care, red flags and care-seeking text always stay curated. */
export function mergeModelPlan(curated, model, entry) {
  const byId = new Map(entry.sources.map((s) => [s.id, s]));
  const uniq = (a) => [...new Set(a.map((x) => x.trim()).filter(Boolean))];
  return {
    ...curated,
    summary: model.summary,
    traditionalUse: model.traditionalUse.length ? model.traditionalUse : curated.traditionalUse,
    evidence: model.evidenceAssessment.map((e) => ({ level: e.level, summary: e.summary, limitations: e.limitations })),
    avoidOrCaution: uniq([...curated.avoidOrCaution, ...model.avoidOrCaution]),
    redFlags: uniq([...curated.redFlags, ...model.redFlags]),
    sources: model.sources.map((id) => byId.get(id)).filter(Boolean).map((s) => ({ id: s.id, title: s.title, organization: s.organization, url: s.url, sourceType: s.sourceType })),
    origin: "llm",
  };
}

/**
 * chatStep never trusts client state beyond option labels: queue/flags are recomputed here.
 * Order is fixed: screen -> (emergency? return) -> flow -> retrieve -> optional LLM -> validate -> fallback.
 */
export async function chatStep({ state, message }, { pool, llm, log, audit }) {
  const msg = message.trim();
  const st = { topic: TOPICS[state?.topic] ? state.topic : null, answers: cleanAnswers(state?.answers), current: QUESTIONS[state?.current] ? state.current : null };

  // 1. Deterministic screen of the new message AND every stored free-text answer. LLM is not reachable before this.
  const screens = [screenText(msg), ...Object.values(st.answers).map(screenText)];
  const emergency = screens.find((s) => s.urgency === "emergency");
  if (emergency) {
    await audit?.("redflag.triggered", { categories: emergency.categories, ruleVersion: SAFETY_RULE_VERSION });
    return emergencyResponse(emergency.categories);
  }

  if (/^(start over|check another concern)$/i.test(msg)) {
    return { reply: "Okay. What is troubling you most?", options: TOPIC_LABELS, state: EMPTY_STATE, urgency: "unknown", emergency: false, disclaimer: DISCLAIMER };
  }

  // 2. Topic
  if (!st.topic) {
    const topic = detectTopic(msg);
    if (!topic) return { reply: "I want to understand this properly. What is troubling you most?", options: TOPIC_LABELS, state: EMPTY_STATE, urgency: "unknown", emergency: false, disclaimer: DISCLAIMER };
    st.topic = topic; st.answers = { symptom: msg.slice(0, 200) }; st.current = null;
  } else if (st.current) {
    const m = matchOption(st.current, msg);
    if (!m) {
      const q = QUESTIONS[st.current];
      return { reply: "Please choose one of the options below, or start over if you’d like to describe something else.", options: [...q.o.map((o) => o[0]), "Start over"], state: st, urgency: "unknown", emergency: false, disclaimer: DISCLAIMER };
    }
    if (m[1] === 2) { await audit?.("redflag.triggered", { categories: ["answer"], ruleVersion: SAFETY_RULE_VERSION }); return emergencyResponse(["answer"], { answerBased: true }); }
    st.answers[st.current] = m[0]; st.current = null;
  }

  // 3. Ask the next question (queue recomputed from the server-side flow)
  const remaining = TOPICS[st.topic].flow.filter((q) => !(q in st.answers));
  if (remaining.length) {
    st.current = remaining[0];
    const q = QUESTIONS[st.current];
    const intro = Object.keys(st.answers).length === 1 && st.answers.symptom ? "I’m sorry you’re unwell. A few quick questions first. " : "";
    return { reply: intro + q.t, options: q.o.map((o) => o[0]), state: st, urgency: "unknown", emergency: false, disclaimer: DISCLAIMER };
  }

  // 4. Complete: urgency is computed ONLY from deterministic sources.
  const textUrgent = screens.some((s) => s.urgency === "urgent");
  const urgent = answersSeverity(st.answers) >= 1 || textUrgent;
  const urgency = urgent ? "urgent" : "routine";
  let note = urgent
    ? "From what you’ve told me, a qualified clinician should see this soon, ideally within a day or two. The information below is general education and doesn’t replace an examination."
    : "This may be suitable for general self-care education. If it isn’t improving in 3 days or gets worse, please see a clinician.";
  if (st.answers.skind === "Feeling hopeless") note += ` Please also talk to someone you trust. In India, Tele-MANAS (${TELE_MANAS_IN}) offers free, confidential support.`;

  const title = TOPICS[st.topic].label;
  const entry = await getApprovedEntryForTopic(pool, st.topic);
  let plan, sourceNote = null;
  if (!entry || entry.sources.length === 0) {
    plan = NO_EVIDENCE_PLAN(title);
  } else {
    plan = curatedPlan(entry);
    if (llm?.enabled) {
      try {
        const raw = await llm.generateEducationalResponse({
          question: `General education about: ${title}`,
          safeContext: { topic: st.topic, urgency, answers: Object.fromEntries(Object.entries(st.answers).filter(([k]) => k !== "symptom")) },
          retrievedKnowledge: { title: entry.title, content: entry.content, traditionalUseSummary: entry.traditionalUseSummary, scientificEvidenceSummary: entry.scientificEvidenceSummary, evidenceLevel: entry.evidenceLevel, knownRisks: entry.knownRisks, contraindications: entry.contraindications, interactions: entry.interactions },
          sourceRecords: entry.sources.map((s) => ({ id: s.id, title: s.title, organization: s.organization, url: s.url, sourceType: s.sourceType })),
          locale: "en",
        });
        const valid = validateModelOutput(raw, { allowedSourceIds: entry.sources.map((s) => s.id) });
        plan = mergeModelPlan(plan, valid, entry);
      } catch (e) {
        log?.warn("llm fallback", { code: e.code ?? "UNKNOWN" });
        sourceNote = e.code ?? "LLM_ERROR";
      }
    }
  }
  return {
    reply: "Thank you. Here is general educational information. It is not a diagnosis.",
    options: ["Check another concern"], state: EMPTY_STATE, urgency, emergency: false,
    plan, sources: plan.sources, note, level: urgent ? 1 : 0, answers: Object.fromEntries(Object.entries(st.answers).filter(([k]) => k !== "symptom")),
    fallbackReason: sourceNote, safetyRuleVersion: SAFETY_RULE_VERSION, disclaimer: DISCLAIMER,
  };
}
