// Only reviewed ('approved') entries and sources are ever served or sent to a model.
const ENTRY_COLS = `e.id, e.slug, e.title, e.topic, e.content, e.traditional_use_summary, e.scientific_evidence_summary,
  e.evidence_level, e.known_risks, e.contraindications, e.interactions, e.when_to_seek_care, e.details, e.is_sample,
  e.reviewed_by, e.reviewed_at`;

const mapSource = (s) => ({ id: s.id, title: s.title, organization: s.organization, url: s.url, sourceType: s.source_type,
  publicationDate: s.publication_date, updatedDate: s.updated_date, claim: s.claim_or_section });

const mapEntry = (e, sources) => ({
  id: e.id, slug: e.slug, title: e.title, topic: e.topic, content: e.content,
  traditionalUseSummary: e.traditional_use_summary, scientificEvidenceSummary: e.scientific_evidence_summary,
  evidenceLevel: e.evidence_level, knownRisks: e.known_risks, contraindications: e.contraindications,
  interactions: e.interactions, whenToSeekCare: e.when_to_seek_care, details: e.details ?? {},
  isSample: e.is_sample, reviewedBy: e.reviewed_by, reviewedAt: e.reviewed_at, sources,
});

async function attachSources(pool, entries) {
  if (!entries.length) return [];
  const { rows } = await pool.query(
    `SELECT es.knowledge_entry_id, es.claim_or_section, s.id, s.title, s.organization, s.url, s.source_type, s.publication_date, s.updated_date
       FROM knowledge_entry_sources es JOIN sources s ON s.id = es.source_id
      WHERE es.knowledge_entry_id = ANY($1::uuid[]) AND s.review_status = 'approved'
      ORDER BY s.title`, [entries.map((e) => e.id)]);
  return entries.map((e) => mapEntry(e, rows.filter((r) => r.knowledge_entry_id === e.id).map(mapSource)));
}

export async function listEntries(pool, { topic, q } = {}) {
  const params = [];
  let where = "e.review_status = 'approved'";
  if (topic) { params.push(topic); where += ` AND e.topic = $${params.length}`; }
  if (q) {
    params.push("%" + q.replace(/[\\%_]/g, "\\$&") + "%");
    where += ` AND (e.title ILIKE $${params.length} OR e.content ILIKE $${params.length})`;
  }
  const { rows } = await pool.query(`SELECT ${ENTRY_COLS} FROM knowledge_entries e WHERE ${where} ORDER BY e.title LIMIT 50`, params);
  return attachSources(pool, rows);
}

export async function getApprovedEntryForTopic(pool, topic) {
  const { rows } = await pool.query(
    `SELECT ${ENTRY_COLS} FROM knowledge_entries e WHERE e.review_status = 'approved' AND e.topic = $1 ORDER BY e.updated_at DESC LIMIT 1`, [topic]);
  return (await attachSources(pool, rows))[0] ?? null;
}

export function publicEntry(e) {
  const { reviewedBy, ...rest } = e; // reviewer name stays server-side
  return { ...rest, reviewed: true };
}
