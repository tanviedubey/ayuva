// Tiny cookie-jar HTTP client using Node's fetch. Handles the double-submit CSRF token like the browser app does.
export class Client {
  constructor(base) { this.base = base + "/api/v1"; this.jar = new Map(); this.csrf = null; this.rawBase = base; }
  cookieHeader() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "); }
  store(res) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = sc.split(";"); const i = pair.indexOf("="); const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      const maxAge = attrs.map((a) => a.trim().toLowerCase()).find((a) => a.startsWith("max-age="));
      if (v === "" || (maxAge && Number(maxAge.split("=")[1]) <= 0) || attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a))) this.jar.delete(k); else this.jar.set(k, v);
      (this.setCookies ??= []).push(sc);
    }
  }
  async ensureCsrf() {
    if (this.csrf) return this.csrf;
    const r = await this.raw("GET", "/auth/csrf"); this.csrf = r.body.csrfToken; return this.csrf;
  }
  async raw(method, path, { body, headers = {}, rawBody } = {}) {
    const h = { ...headers }; const ck = this.cookieHeader(); if (ck) h.cookie = ck;
    let payload; if (rawBody !== undefined) payload = rawBody; else if (body !== undefined) { h["content-type"] ??= "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(this.base + path, { method, headers: h, body: payload });
    this.store(res);
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, headers: res.headers, body: json, text };
  }
  async send(method, path, body, opts = {}) {
    const headers = { ...(opts.headers ?? {}) };
    if (opts.csrf !== false && method !== "GET") headers["x-csrf-token"] = await this.ensureCsrf();
    return this.raw(method, path, { body, headers, rawBody: opts.rawBody });
  }
  get(p, o) { return this.send("GET", p, undefined, o); }
  post(p, b, o) { return this.send("POST", p, b, o); }
  put(p, b, o) { return this.send("PUT", p, b, o); }
  patch(p, b, o) { return this.send("PATCH", p, b, o); }
  delete(p, b, o) { return this.send("DELETE", p, b, o); }
  sessionCookie() { return this.jar.get("ayuva_sid"); }
}
