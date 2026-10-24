export class LlmError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
// codes: LLM_DISABLED, LLM_TIMEOUT, LLM_RATE_LIMITED, LLM_UNSUPPORTED_MODEL, LLM_BAD_JSON, LLM_PROVIDER_ERROR

export function mapHttpStatus(status) {
  if (status === 429) return new LlmError("LLM_RATE_LIMITED", "LLM provider rate limit.");
  if (status === 404) return new LlmError("LLM_UNSUPPORTED_MODEL", "LLM model not supported.");
  return new LlmError("LLM_PROVIDER_ERROR", `LLM provider returned ${status}.`);
}
