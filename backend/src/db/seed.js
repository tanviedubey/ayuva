import path from "node:path";
import { fileURLToPath } from "node:url";
import { withTransaction } from "./pool.js";
import { SOURCES, ENTRIES } from "./seed-data.js";

export const SAMPLE_REVIEWER = "SAMPLE-DEV (NOT clinically reviewed)";

/** Idempotent. Without approve=true everything is 'in_review' and the app serves NO health content (safe default). */
export async function seedSamples(pool, { approve = false } = {}) {
  return withTransaction(pool, async (c) => {
    const status = approve ? "approved" : "in_review";
    const ids = {};
    for (const s of SOURCES) {
      const found = await c.query("SELECT id FROM sources WHERE url = $1", [s.url]);
      if (found.rows[0]) { ids[s.key] = found.rows[0].id; continue; }
      const { rows } = await c.query(
        `INSERT INTO sources(title, organization, url, source_type, review_status, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [s.title, s.organization, s.url, s.source_type, status, s.notes]);
      ids[s.key] = rows[0].id;
    }
    let entries = 0;
    for (const e of ENTRIES) {
      const { rows } = await c.query(
        `INSERT INTO knowledge_entries(slug, title, topic, content, traditional_use_summary, scientific_evidence_summary, evidence_level,
           known_risks, contraindications, interactions, when_to_seek_care, details, is_sample, review_status, reviewed_by, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE,$13,$14,$15) ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [e.slug, e.title, e.topic, e.content, e.traditional, e.scientific, e.evidence_level, e.risks, e.contra, e.interactions, e.seek,
         JSON.stringify(e.details), status, approve ? SAMPLE_REVIEWER : null, approve ? new Date() : null]);
      if (!rows[0]) continue;
      entries++;
      for (const [key, claim] of e.sources)
        await c.query("INSERT INTO knowledge_entry_sources(knowledge_entry_id, source_id, claim_or_section) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [rows[0].id, ids[key], claim]);
    }
    return { sources: Object.keys(ids).length, entriesInserted: entries, status };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(); } catch { /* ignore */ }
  const { createPool } = await import("./pool.js");
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }
  const pool = createPool(process.env.DATABASE_URL);
  try {
    const approve = process.argv.includes("--approve-samples");
    const r = await seedSamples(pool, { approve });
    console.log(`Seeded sample data (${r.status}): ${r.sources} sources, ${r.entriesInserted} new entries.`);
    if (approve) console.log("WARNING: samples were marked approved WITHOUT clinical review. Development use only.");
    else console.log("Samples are 'in_review' and will not be served until a reviewer approves them (see README).");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await pool.end(); }
}
