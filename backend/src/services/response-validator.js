import { z } from "zod";

export class ModelOutputError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const LEVELS = ["guideline", "systematic_review", "clinical_trial", "observational", "preclinical", "traditional_source", "insufficient"];
const text = (max) => z.string().trim().min(1).max(max);

export const modelOutputSchema = z.object({
  summary: text(800),
  traditionalUse: z.array(text(400)).max(6),
  evidenceAssessment: z.array(z.object({
    level: z.enum(LEVELS),
    summary: text(600),
    limitations: text(500),
    sourceIds: z.array(z.string().uuid()).max(6),
  })).max(6),
  selfCare: z.array(text(240)).max(8),
  avoidOrCaution: z.array(text(240)).max(8),
  redFlags: z.array(text(240)).max(8),
  whenToSeekCare: text(500),
  sources: z.array(z.string().uuid()).max(12),
  disclaimer: text(600),
});

// Post-processing: reject (never "fix") unsafe model language. Conservative by design.
const UNSAFE = [
  ["dose", /\b\d+(\.\d+)?\s*(mg|mcg|µg|g|gm|grams?|ml|tsp|tbsp|teaspoons?|tablespoons?|tablets?|capsules?|pills?|drops?)\b/i],
  ["schedule", /\b(once|twice|thrice|three times)\s+(a|per|every)\s+(day|daily)\b|\bevery \d+\s*hours?\b/i],
  ["cure-claim", /\b(cure[sd]?|curing|guarantee[sd]?|100\s?%|permanent(ly)?|miracle|detox(ify|ification)?)\b/i],
  ["diagnosis", /\byou (probably |likely |definitely |clearly )?(have|are suffering from|suffer from)\b/i],
  ["medication-change", /\b(stop|discontinue|skip|reduce|increase)\b.{0,25}\b(medicine|medication|prescription|tablets?)\b/i],
  ["impersonation", /\bas (your|an?) (doctor|physician|ayurved\w*|vaid\w*)\b/i],
  ["downplay", /\b(no need to|dont need to|don't need to|not necessary to)\b.{0,30}\b(see|visit|consult)\b.{0,15}\b(doctor|clinician)\b|\bsafe to ignore\b/i],
  ["risky-diy", /\bundiluted\b|\braw lemon\b/i],
];

function collectStrings(o, out = []) {
  if (typeof o === "string") out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => collectStrings(x, out));
  else if (o && typeof o === "object") Object.values(o).forEach((x) => collectStrings(x, out));
  return out;
}

/**
 * @param raw           parsed JSON from the provider (untrusted)
 * @param allowedSourceIds  IDs of source records retrieved from PostgreSQL for this request
 */
export function validateModelOutput(raw, { allowedSourceIds }) {
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) throw new ModelOutputError("SCHEMA", "Model output did not match the required schema.");
  const out = parsed.data;
  const allowed = new Set(allowedSourceIds);

  const cited = new Set([...out.sources, ...out.evidenceAssessment.flatMap((e) => e.sourceIds)]);
  for (const id of cited) if (!allowed.has(id)) throw new ModelOutputError("UNKNOWN_SOURCE", "Model cited a source that was not retrieved.");
  for (const e of out.evidenceAssessment) {
    if (e.level !== "insufficient" && e.sourceIds.length === 0) throw new ModelOutputError("UNCITED_CLAIM", "Evidence claim without a source.");
  }
  if (allowed.size > 0 && cited.size === 0) throw new ModelOutputError("NO_CITATIONS", "Model returned no citations.");

  const all = collectStrings(out).join("\n");
  for (const [name, re] of UNSAFE) if (re.test(all)) throw new ModelOutputError("UNSAFE_CONTENT", `Unsafe content pattern: ${name}`);
  return { ...out, sources: [...cited] };
}
