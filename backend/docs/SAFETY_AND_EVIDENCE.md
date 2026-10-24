# Safety, red flags and evidence policy

## Non-negotiable
- The deterministic safety layer runs before retrieval/LLM generation and cannot be bypassed by prompts, client state, model output or provider choice.
- This is educational software, not a diagnostic or treatment service.
- Never recommend starting/stopping prescription medicines or give individualized medicine/herb dosing.
- Do not present traditional use as proven efficacy.
- Never fabricate references, study titles, URLs, authors, dates or confidence.
- If evidence is absent/uncertain, say so plainly.

## Red-flag examples to implement and test
Emergency-level examples include severe difficulty breathing, severe/persistent chest pain, signs of stroke (face drooping, one-sided weakness, speech difficulty), loss of consciousness, seizure, severe allergic reaction (throat/tongue swelling or breathing compromise), severe bleeding/coughing blood, and immediate self-harm danger. This list is a minimum, not exhaustive. Include symptom-specific and age/pregnancy-related escalation rules only when reviewed by a qualified clinical reviewer.

Urgent/non-emergency review examples may include rapidly worsening symptoms, persistent high fever, inability to keep fluids down, dehydration signs, new neurological symptoms, severe abdominal pain, black/bloody stools, or symptoms that persist beyond a safe period. Do not treat keyword matching alone as clinically complete; combine deterministic rules, explicit clarification and conservative escalation.

Emergency UX:
- Stop routine self-care recommendations.
- Use clear language: seek emergency medical care now.
- India emergency number: 112. Do not promise ambulance availability or auto-contact services.
- Avoid wording that says “consult an Ayurvedic doctor” for emergencies.
- Do not rely on an LLM to detect or dismiss emergencies.

## Evidence/source model
For each source store: title, organization/authors, URL, publication/update date, accessed date, source type, population/context, relevant excerpt or summary, and review status.
Evidence levels must be defined and not represented as a medical certainty score. Keep separate fields:
- `traditional_use_summary`
- `scientific_evidence_summary`
- `evidence_level` (e.g. guideline/systematic review/clinical trial/observational/preclinical/traditional source/insufficient)
- `known_risks`
- `contraindications`
- `interactions`
- `when_to_seek_care`
- `reviewed_by`, `reviewed_at`, `review_status`

Prioritize recognized public health agencies, clinical guidelines, systematic reviews and peer-reviewed studies. NCCIH and dermatology/public-health sources are useful starting points, not a substitute for checking each claim. Traditional knowledge sources should be labelled as such.

## Model response rules
- Cite sources inline per material claim where possible; provide source title and clickable URL.
- Sources must come from retrieved database records; reject unknown source IDs.
- Label evidence limitations and applicability.
- If sources conflict, state the conflict and avoid overstating conclusions.
- If no reliable source is available, say that and avoid confident medical claims.
- Never call the model a doctor or Ayurvedic practitioner.
- No guaranteed cure, “detox” claims, or universal statements.
- Skincare: flag irritation/allergy, patch-test caveats, sun sensitivity and known ingredient interactions when supported; advise clinician/dermatologist for severe reactions.
- Avoid recommending raw lemon juice, undiluted essential oils or other risky DIY skin applications.
