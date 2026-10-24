import { mapHttpStatus } from "../errors.js";

export const geminiProvider = {
  async call({ cfg, fetchImpl, signal, system, user }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
    const res = await fetchImpl(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 1800 },
      }),
    });
    if (!res.ok) throw mapHttpStatus(res.status);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  },
};
