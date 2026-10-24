// Cross-platform test runner: node scripts/test.mjs [unit|integration|all]
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const which = process.argv[2] ?? "all";
const dirs = which === "all" ? ["unit", "integration"] : [which];
const files = dirs.flatMap((d) => readdirSync(path.join("tests", d)).filter((f) => f.endsWith(".test.js")).sort().map((f) => path.join("tests", d, f)));
if (!files.length) { console.error("No test files found for:", which); process.exit(1); }
const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
