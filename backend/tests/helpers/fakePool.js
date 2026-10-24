// Minimal pg.Pool stand-in for unit tests of services that only READ curated knowledge.
export const SRC_A = "11111111-1111-4111-8111-111111111111";
export const SRC_B = "22222222-2222-4222-8222-222222222222";

export function entryRow(over = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slug: "cough-general-care", title: "Cough and throat irritation", topic: "cough",
    content: "Most coughs with colds settle by themselves.", traditional_use_summary: "Traditional use summary.",
    scientific_evidence_summary: "Guidance says rest and fluids.", evidence_level: "guideline", known_risks: "Herbs are not risk-free.",
    contraindications: null, interactions: "May interact with medicines.", when_to_seek_care: "See a clinician if it lasts weeks.",
    details: { selfCare: ["Rest and drink plenty of fluids"], avoid: ["Avoid smoke"], redFlags: ["Coughing up blood"] },
    is_sample: true, reviewed_by: "Reviewer", reviewed_at: new Date(), ...over,
  };
}
export const sourceRows = (entryId) => [
  { knowledge_entry_id: entryId, claim_or_section: "General", id: SRC_A, title: "Cough", organization: "NHS (UK)", url: "https://www.nhs.uk/conditions/cough/", source_type: "public_health_agency", publication_date: null, updated_date: null },
  { knowledge_entry_id: entryId, claim_or_section: "Context", id: SRC_B, title: "Ayurvedic Medicine: In Depth", organization: "NCCIH", url: "https://www.nccih.nih.gov/health/ayurvedic-medicine-in-depth", source_type: "public_health_agency", publication_date: null, updated_date: null },
];

export function fakePool({ entry = entryRow(), sources, queries = [] } = {}) {
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (/FROM knowledge_entries/.test(sql)) return { rows: entry ? [entry] : [] };
      if (/knowledge_entry_sources/.test(sql)) return { rows: entry ? (sources ?? sourceRows(entry.id)) : [] };
      return { rows: [] };
    },
  };
}

export function validModelOutput(over = {}) {
  return {
    summary: "Coughs from colds usually settle by themselves.",
    traditionalUse: ["Traditional practice uses warm fluids."],
    evidenceAssessment: [{ level: "guideline", summary: "Guidance recommends rest and fluids.", limitations: "General guidance only.", sourceIds: [SRC_A] }],
    selfCare: ["Rest and drink plenty of fluids"], avoidOrCaution: ["Herbs are not risk-free."], redFlags: ["Coughing up blood"],
    whenToSeekCare: "See a clinician if it lasts for weeks.", sources: [SRC_A], disclaimer: "Educational only.", ...over,
  };
}
