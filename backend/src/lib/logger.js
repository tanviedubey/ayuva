// Minimal structured logger. Callers must never pass passwords, cookies, API keys or health text.
export function createLogger({ silent = false } = {}) {
  const w = (level, msg, meta) => { if (!silent) process.stdout.write(JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta }) + "\n"); };
  return { info: (m, x) => w("info", m, x), warn: (m, x) => w("warn", m, x), error: (m, x) => w("error", m, x) };
}
