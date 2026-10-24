// Static checks: syntax of every JS file, no video code, no browser storage, secrets hygiene.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? (f === "node_modules" ? [] : walk(p)) : [p]; });
const js = ["src", "tests", "scripts", "public"].filter(existsSync).flatMap(walk).filter((f) => /\.(m?js)$/.test(f));
const problems = [];

for (const f of js) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) problems.push(`syntax: ${f}\n${r.stderr}`);
}
for (const f of [...walk("src"), "public/app.js"]) {
  const t = readFileSync(f, "utf8");
  if (/video/i.test(t) && !f.endsWith("check.mjs")) problems.push(`video reference in ${f}`);
  if (f.endsWith("app.js") && /(localStorage|sessionStorage)\s*[.[]/.test(t)) problems.push(`browser storage used in ${f}`);
}
const html = readFileSync("public/index.html", "utf8");
const body = html.slice(html.indexOf("<body"));
if (/video/i.test(body)) problems.push("video reference in index.html body");
if (/<script>[^<]/.test(html)) problems.push("inline <script> in index.html (CSP forbids it)");
if (!/(^|\n)\.env\s*(\n|$)/.test(readFileSync(".gitignore", "utf8"))) problems.push(".env is not git-ignored");
const ex = readFileSync(".env.example", "utf8");
if (!/REPLACE/.test(ex) || /AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}/.test(ex)) problems.push(".env.example must contain placeholders only");

if (problems.length) { console.error("CHECK FAILED:\n" + problems.join("\n")); process.exit(1); }
console.log(`check ok: ${js.length} JS files parsed, no video code, no browser storage, secrets hygiene ok`);
