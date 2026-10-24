import { geminiProvider } from "./providers/gemini.js";
import { openaiProvider } from "./providers/openai.js";
import { LlmError } from "./errors.js";

export { LlmError };

export const SYSTEM_PROMPT = `You write short EDUCATIONAL summaries about traditional (Ayurvedic) practices and what modern evidence says.
Rules:
- You are not a doctor or Ayurvedic practitioner. Never diagnose, prescribe, give doses, durations of use, or cure/detox claims.
- Use ONLY the reviewed knowledge and source records supplied. Cite sources only by the exact "id" values supplied. Never invent sources, titles, URLs or authors.
- Keep traditional use and scientific evidence clearly separate. State limitations. If evidence is thin say "evidence is insufficient".
- Safety status is decided elsewhere. Do not assess emergencies and do not discourage seeing a clinician.
- Respond with a single JSON object, no markdown, with keys: summary, traditionalUse[], evidenceAssessment[{level,summary,limitations,sourceIds[]}], selfCare[], avoidOrCaution[], redFlags[], whenToSeekCare, sources[], disclaimer.
- level is one of: guideline, systematic_review, clinical_trial, observational, preclinical, traditional_source, insufficient.`;

export function buildUserPayload({ question, safeContext, retrievedKnowledge, sourceRecords, locale }) {
  return JSON.stringify({ question, locale: locale ?? "en", context: safeContext, knowledge: retrievedKnowledge, sources: sourceRecords });
}

export function parseJsonLoose(textOut) {
  if (typeof textOut !== "string") throw new LlmError("LLM_BAD_JSON", "Provider returned no text.");
  const cleaned = textOut.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); } catch { throw new LlmError("LLM_BAD_JSON", "Provider returned invalid JSON."); }
}

const PROVIDERS = { gemini: geminiProvider, openai: openaiProvider };

/**
 * Provider-independent adapter.
 *   generateEducationalResponse({ question, safeContext, retrievedKnowledge, sourceRecords, locale }) -> parsed JSON (UNVALIDATED)
 * Every failure becomes a typed LlmError; callers must fall back to curated content.
 */
export function createLlm(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const provider = PROVIDERS[cfg.provider];
  const enabled = !!provider && !!cfg.apiKey;
  return {
    name: cfg.provider,
    enabled,
    async generateEducationalResponse(input) {
      if (!provider) throw new LlmError("LLM_DISABLED", "No LLM provider configured.");
      if (!cfg.apiKey) throw new LlmError("LLM_DISABLED", "LLM API key is not configured.");
      if (!cfg.model) throw new LlmError("LLM_UNSUPPORTED_MODEL", "LLM_MODEL is not set.");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
      try {
        const textOut = await provider.call({ cfg, fetchImpl, signal: ctrl.signal, system: SYSTEM_PROMPT, user: buildUserPayload(input) });
        return parseJsonLoose(textOut);
      } catch (e) {
        if (e instanceof LlmError) throw e;
        if (e?.name === "AbortError" || ctrl.signal.aborted) throw new LlmError("LLM_TIMEOUT", "LLM request timed out.");
        throw new LlmError("LLM_PROVIDER_ERROR", "LLM request failed.");
      } finally { clearTimeout(timer); }
    },
  };
}
