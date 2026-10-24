// Server-side question flow. The client only ever sends option labels; severity is looked up HERE.
// severity: 0 = general self-care education is fine, 1 = see a clinician soon, 2 = emergency.
export const QUESTIONS = {
  dur: { t: "How long has this been going on?", o: [["Since today", 0], ["1 to 3 days", 0], ["4 days or more", 1]] },
  temp: { t: "What does your thermometer read?", o: [["Under 100°F", 0], ["100 to 102°F", 0], ["103°F or higher", 1], ["I haven’t measured", 0]] },
  meds: { t: "Have you taken paracetamol (Dolo, Crocin)?", o: [["No, not yet", 0], ["Yes, and the fever came down", 0], ["Yes, but it keeps coming back", 1], ["Yes, but it isn’t helping", 1]] },
  assoc: { t: "Any of these with the fever?", o: [["None of these", 0], ["Cough or sore throat", 0], ["Body ache and chills", 0], ["Burning urine or vomiting", 1], ["Rash or stiff neck", 2]] },
  fluids: { t: "Are you able to drink fluids?", o: [["Yes, normally", 0], ["Only small sips", 1], ["No, I bring it up", 1]] },
  cough: { t: "What is the cough like?", o: [["Dry", 0], ["Clear or white phlegm", 0], ["Yellow or green phlegm", 1], ["Blood in phlegm", 2]] },
  wheeze: { t: "Any wheezing or breathlessness?", o: [["None", 0], ["Mild wheeze", 1], ["Hard to breathe", 2]] },
  hkind: { t: "How would you describe the headache?", o: [["Dull, all over", 0], ["One side, throbbing", 0], ["Sudden and the worst ever", 2], ["After a head injury", 2]] },
  hassoc: { t: "Anything else with it?", o: [["Nothing else", 0], ["Nausea or light sensitivity", 0], ["Fever or stiff neck", 2], ["Vision change or weakness", 2]] },
  bkind: { t: "When does it bother you most?", o: [["After meals", 0], ["All day", 0], ["With constipation", 0], ["With sharp pain or vomiting", 1]] },
  bred: { t: "Any black stools or unexplained weight loss?", o: [["No", 0], ["Yes", 1]] },
  skind: { t: "What is weighing on you most?", o: [["Racing thoughts", 0], ["Poor sleep", 0], ["Constant tiredness", 0], ["Feeling hopeless", 1]] },
};

export const TOPICS = {
  fever: { label: "Fever", keys: ["fever", "temperature", "dolo", "chills"], flow: ["dur", "temp", "meds", "assoc", "fluids"] },
  cough: { label: "Cough or cold", keys: ["cough", "cold", "throat", "phlegm"], flow: ["dur", "cough", "wheeze"] },
  headache: { label: "Headache", keys: ["headache", "head", "migraine"], flow: ["dur", "hkind", "hassoc"] },
  digestion: { label: "Bloating or gas", keys: ["bloat", "gas", "indigest", "acid", "digest", "constipat", "stomach"], flow: ["dur", "bkind", "bred"] },
  stress: { label: "Stress or poor sleep", keys: ["stress", "anxi", "worry", "tense", "overwhelm", "sleep", "insomnia", "restless"], flow: ["dur", "skind"] },
};
export const TOPIC_IDS = Object.keys(TOPICS);
export const QUESTION_IDS = Object.keys(QUESTIONS);
export const TOPIC_LABELS = TOPIC_IDS.map((k) => TOPICS[k].label);

export function detectTopic(message) {
  const s = String(message).toLowerCase();
  return TOPIC_IDS.find((id) => TOPICS[id].keys.some((k) => s.includes(k))) ?? null;
}

export function matchOption(qid, label) {
  const q = QUESTIONS[qid];
  const s = String(label).trim().toLowerCase();
  return q?.o.find((o) => o[0].toLowerCase() === s) ?? null;
}

/** Highest severity across recorded option answers. Unknown labels count as 0 (their text is still screened). */
export function answersSeverity(answers) {
  let max = 0;
  for (const [qid, label] of Object.entries(answers ?? {})) {
    if (!QUESTIONS[qid]) continue;
    const m = matchOption(qid, label);
    if (m) max = Math.max(max, m[1]);
  }
  return max;
}
