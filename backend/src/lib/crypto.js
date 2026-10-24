import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const newToken = () => randomBytes(32).toString("base64url");
// Session tokens are 256-bit random; only an HMAC of them is stored.
export const hashToken = (token, secret) => createHmac("sha256", secret).update(String(token)).digest("hex");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// CSRF token = nonce.hmac(nonce). Double-submit: cookie must equal header AND be validly signed.
export function makeCsrfToken(secret) {
  const nonce = randomBytes(24).toString("base64url");
  return `${nonce}.${createHmac("sha256", secret).update("csrf:" + nonce).digest("base64url")}`;
}
export function isValidCsrfToken(token, secret) {
  if (typeof token !== "string") return false;
  const [nonce, sig] = token.split(".");
  if (!nonce || !sig) return false;
  const expect = createHmac("sha256", secret).update("csrf:" + nonce).digest("base64url");
  return safeEqual(sig, expect);
}
