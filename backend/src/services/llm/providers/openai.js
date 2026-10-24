import { mapHttpStatus } from "../errors.js";

export const openaiProvider = {
  async call({ cfg, fetchImpl, signal, system, user }) {
    const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) throw mapHttpStatus(res.status);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  },
};
