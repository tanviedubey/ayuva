/**
 * Deterministic red-flag screening. No network, no LLM, no database: pure functions.
 * This is a MINIMUM safety net, not clinical triage. Limitations (see docs/SAFETY_AND_EVIDENCE.md):
 *  - keyword/regex based, English plus a small Hinglish/Hindi set that needs clinical+linguistic review;
 *  - no negation handling on purpose ("no chest pain" still escalates; false alarms are cheaper than misses);
 *  - misspellings, other languages, slang and indirect descriptions can be missed;
 *  - no age/pregnancy-specific rules (they require a qualified clinical reviewer).
 */
export const SAFETY_RULE_VERSION = "rf-2026.10-1";
export const EMERGENCY_NUMBER_IN = "112";
export const TELE_MANAS_IN = "14416";

export function normalize(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}.]+/gu, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const R = (category, id, re) => ({ category, id, re });

export const EMERGENCY_RULES = [
  // severe breathing difficulty
  R("breathing", "breath-difficulty", /\b(severe |serious |extreme |bad )?(difficulty|trouble|hard time|struggling|struggle|hard)\s+(in |with |to )?breath(e|ing)\b/),
  R("breathing", "breath-cant", /\b(cant|cannot|can not|unable to|couldnt|could not)\s+(\w+\s+)?(breathe|breathing|breath)\b/),
  R("breathing", "breath-catch", /\bcatch (my|his|her|their) breath\b/),
  R("breathing", "breath-short", /\b(short(ness)? of breath|breathless(ness)?|gasping|gasp(ing)? for (air|breath)|blue lips|lips (are )?turning blue|choking)\b/),
  // serious chest pain
  R("chest_pain", "chest-pain", /\bchest\s+(pain|pains|tightness|tight|pressure|heaviness|discomfort)\b/),
  R("chest_pain", "chest-pain-rev", /\b(pain|pressure|tightness|heaviness|squeezing)\s+(in|on|across|around)\s+(my |the |his |her )?chest\b/),
  R("chest_pain", "chest-feels", /\bchest\b.{0,25}\b(tight|heavy|heaviness|pressure|squeez\w*|crushing|burning)\b/),
  R("chest_pain", "chest-tight", /\btight chest\b|\bheart attack\b|\bcrushing (pain|pressure)\b/),
  // stroke
  R("stroke", "stroke-face", /\b(face|facial)\s+(is\s+)?(droop|drooping|drooped|sagging)\b|\bdrooping (face|mouth)\b/),
  R("stroke", "stroke-speech", /\bslurred speech\b|\bslurring\b|\b(cant|cannot|unable to)\s+(speak|talk)\b|\btrouble speaking\b/),
  R("stroke", "stroke-side", /\b(one sided|one side|onesided)\s+(weakness|numbness|paralysis)\b|\b(weakness|numbness)\s+(on|in)\s+(one|my (left|right)|the (left|right))\s+side\b|\barm (is )?(weak|numb)\b/),
  R("stroke", "stroke-sudden", /\bsudden(ly)?\s+(numbness|weakness|confusion|loss of vision|vision loss|loss of balance)\b|\bworst headache (of|ever)\b|\bsudden(ly)? and the worst\b/),
  R("stroke", "stroke-word", /\bstroke\b|\bparalysis\b|\bparalys[ez]d\b/),
  // unconsciousness
  R("unconscious", "uncon", /\b(faint|fainted|fainting|passed out|pass out|passing out|blacked out|black out|unconscious|unresponsive|collapsed|not waking up|wont wake up|cant wake)\b/),
  // seizure
  R("seizure", "seizure", /\b(seizure|seizures|convulsion|convulsions|convulsing|epileptic fit|having a fit)\b/),
  // severe allergic reaction
  R("anaphylaxis", "allergy-severe", /\bsevere allergic reaction\b|\banaphyla\w*\b/),
  R("anaphylaxis", "allergy-swelling", /\b(throat|tongue|lips?|face)\s+(is\s+|are\s+)?(swelling|swollen|closing)\b|\bswelling (of|in) (my |the )?(throat|tongue|lips|face)\b|\bthroat (is )?closing\b/),
  // significant bleeding / coughing blood
  R("bleeding", "blood-cough", /\b(cough(ing|ed)?|spit(ting)?|vomit(ing)?|throw(ing)? up)\s+(up\s+)?(some |a lot of )?blood\b/),
  R("bleeding", "blood-in", /\bblood in (my |the )?(sputum|phlegm|cough|vomit|spit|spittle)\b|\bblood\b.{0,20}\b(sputum|phlegm)\b|\b(sputum|phlegm)\b.{0,20}\bblood\b|\bcough\b.{0,15}\bblood\b|\bhaemoptysis\b|\bhemoptysis\b/),
  R("bleeding", "bleed-heavy", /\b(heavy|severe|profuse|uncontrolled|uncontrollable|serious)\s+bleeding\b|\bbleeding (wont|will not|doesnt|does not|cannot|cant) stop\b|\bbleeding (a lot|heavily)\b|\bblood (is )?(pouring|gushing)\b/),
  // self-harm emergency
  R("self_harm", "selfharm-words", /\bsuicid(e|al)\b|\bkill (myself|my self)\b|\bend (my|my own) life\b|\bwant to die\b|\bwish (i was|i were) dead\b|\b(dont|do not) want to (live|be alive|exist)\b|\bno reason to live\b|\bself harm\b|\bselfharm\b|\b(harm|hurt|cut|injure) myself\b|\boverdos(e|ing)\b|\btake all my (pills|tablets)\b/),
  // Hinglish / Hindi (SAMPLE set; needs linguistic + clinical review)
  R("chest_pain", "hi-chest", /\bseene (mein|me|mai) (dard|jakdan|bhaari)\b|सीने में (दर्द|जकड़न)/u),
  R("breathing", "hi-breath", /\bsaans (lene )?(mein|me|mai) (takleef|dikkat|problem)\b|\bsaans nahi\b|सांस (लेने )?में (तकलीफ|दिक्कत)/u),
  R("unconscious", "hi-faint", /\bbehosh\b|बेहोश/u),
  R("bleeding", "hi-blood", /\bkhoon (ki )?ulti\b|खून की उल्टी/u),
  R("self_harm", "hi-selfharm", /\bkhud ko (khatam|maar)\b|\bmarna chahta\b|\bmarna chahti\b|\baatmahatya\b|आत्महत्या|मरना चाहत/u),
];

export const URGENT_RULES = [
  R("worsening", "urgent-worse", /\b(getting|gotten|got|is|are|keeps|keep)\s+(much |way |a lot )?worse\b|\bworsening\b|\bnot improving\b|\bdoesnt improve\b/),
  R("fever", "urgent-fever", /\bhigh fever\b|\bfever\b.{0,20}\b10[3-9](\.\d)?\b|\b10[3-9](\.\d)?\s*(f|fahrenheit|degrees)\b/),
  R("fluids", "urgent-fluids", /\b(cant|cannot|unable to|not able to)\s+(keep|hold)\s+(\w+\s+){0,2}down\b|\bdehydrat\w*\b|\bno urine\b|\bnot (peeing|urinating)\b/),
  R("abdomen", "urgent-abdomen", /\bsevere (abdominal|stomach|belly|tummy)\s+pain\b|\bsevere vomiting\b|\bsevere diarrh(o)?ea\b/),
  R("stool", "urgent-stool", /\bblack (tarry )?stools?\b|\bbloody stools?\b|\bblood in (my |the )?(stool|stools|urine|poop)\b/),
  R("neuro", "urgent-neuro", /\bstiff neck\b|\bnew (numbness|tingling|confusion|vision (change|changes|loss))\b|\bdouble vision\b/),
  R("persistent", "urgent-persistent", /\b(more than|over|for|past)\s+(a |one |1 |two |2 |three |3 |several )?(week|weeks|month|months)\b/),
  R("allergy", "urgent-allergy", /\ballergic reaction\b|\brash\b.{0,20}\bspreading\b/),
];

/** @returns {{urgency:'emergency'|'urgent'|'routine', categories:string[], ruleIds:string[]}} */
export function screenText(text) {
  const t = normalize(text);
  const hits = (rules) => rules.filter((r) => r.re.test(t));
  const em = hits(EMERGENCY_RULES);
  if (em.length) return { urgency: "emergency", categories: [...new Set(em.map((r) => r.category))], ruleIds: em.map((r) => r.id) };
  const ur = hits(URGENT_RULES);
  if (ur.length) return { urgency: "urgent", categories: [...new Set(ur.map((r) => r.category))], ruleIds: ur.map((r) => r.id) };
  return { urgency: "routine", categories: [], ruleIds: [] };
}

export const DISCLAIMER =
  "Ayuva provides education, not diagnosis or treatment. Traditional use is not proof of effectiveness. " +
  "Check evidence, risks and interactions, and see a qualified clinician for persistent, worsening or severe symptoms.";

/** Fixed, pre-written emergency copy. Never generated by a model. Contains no remedies. */
export function emergencyResponse(categories = [], { answerBased = false } = {}) {
  const selfHarm = categories.includes("self_harm");
  const reply = selfHarm
    ? `I’m really sorry you’re feeling this way. Your safety matters most right now. If you might act on these thoughts or are in immediate danger, call ${EMERGENCY_NUMBER_IN} now or go to the nearest emergency department, and stay with someone you trust. In India, Tele-MANAS (${TELE_MANAS_IN}) offers free, confidential mental-health support.`
    : answerBased
      ? `That combination needs prompt in-person medical care. Please seek emergency medical care now. In India, call ${EMERGENCY_NUMBER_IN}. I won’t suggest home remedies for this.`
      : `What you describe could be a medical emergency. Please seek emergency medical care now. In India, call ${EMERGENCY_NUMBER_IN}, or ask someone to take you to the nearest emergency department. Don’t wait or try home remedies first.`;
  return {
    reply,
    options: ["Start over"],
    state: { topic: null, answers: {}, current: null },
    urgency: "emergency",
    emergency: true,
    emergencyNumber: EMERGENCY_NUMBER_IN,
    categories,
    safetyRuleVersion: SAFETY_RULE_VERSION,
    disclaimer: DISCLAIMER,
  };
}
