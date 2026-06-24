/* review.js — write a restaurant review from a structured questionnaire.
 * Reuses the same LLM env as the translator (LLM_PROVIDER / LLM_API_KEY / LLM_MODEL).
 * The LLM writes PROSE only; the star rating is computed client-side. If no key is
 * set it returns a MOCK so the whole app runs end-to-end in dev. */

const PROVIDER = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
const KEY = process.env.LLM_API_KEY || "";
const MODEL = process.env.LLM_MODEL ||
  (PROVIDER === "openai" ? "gpt-4o-mini" : "claude-haiku-4-5-20251001");

export const usingMock = !KEY;

const STANCE_NOTE = {
  generous: "Generous: warm and forgiving, give the benefit of the doubt, lead with what worked.",
  balanced: "Balanced: even-handed, weigh good and bad fairly.",
  critical: "Critical: hold a high bar (the market is saturated), be fair but unsparing about letdowns.",
};

function systemPrompt(stance, length) {
  const lengthNote = length === "short"
    ? "LENGTH: a short, punchy Google review, about 3 to 5 lines. Tight, no headings."
    : "LENGTH: a full structured review, a few short paragraphs walking the experience.";
  return `You are a sharp, fair restaurant reviewer writing in the FIRST PERSON, as the customer, for posting on Google.

WRITE A REVIEW THAT:
- Opens with a hook (not "I went to X"). Then walks the experience naturally: arrival, drinks, food (the heart of it), service, atmosphere, value. Close with an honest verdict line (return? recommend?).
- WEAVES IN the customer's specific details verbatim where natural (e.g. "the beer came in a warm glass", "the mayonnaise never arrived"). Specifics are what make it real, never generic. Do not invent details they did not give.
- Matches the chosen STANCE. ${STANCE_NOTE[stance] || STANCE_NOTE.balanced}
- Sounds like a real person. No marketing fluff, no cliches ("hidden gem", "culinary journey", "to die for"), no star rating in the text.
- ${lengthNote}

ABSOLUTE PUNCTUATION RULE: do NOT use em-dashes or en-dashes anywhere. No "—", no "–". Use commas, periods, colons, or parentheses instead. (Ordinary hyphens inside words like "well-cooked" are fine.)

Output ONLY the review text. No preamble, no title, no quotes around it.`;
}

function userPrompt(answers) {
  const a = answers || {};
  const L = [];
  const add = (label, v) => { if (v != null && String(v).trim() !== "") L.push(`${label}: ${String(v).trim()}`); };
  add("Restaurant", a.name);
  add("Type/cuisine", a.cuisine);
  add("Occasion", a.occasion);
  add("With", a.withWho);
  add("Price ballpark", a.price);
  const sec = (label, score, specific) => {
    if (score == null && !specific) return;
    let line = `${label}`;
    if (score != null) line += ` rated ${score}/5`;
    if (specific) line += ` — specifics: ${specific}`;   // (input only; not output)
    L.push(line);
  };
  sec("Arrival/booking", a.arrivalScore, a.arrivalText);
  sec("Drinks", a.drinksScore, a.drinksText);
  sec("Food", a.foodScore, a.foodText);
  sec("Service", a.serviceScore, a.serviceText);
  sec("Atmosphere", a.atmosphereScore, a.atmosphereText);
  sec("Value", a.valueScore, a.valueText);
  if (a.standout) L.push(`Standout dish: ${a.standout}`);
  if (Array.isArray(a.issues) && a.issues.length) L.push(`Issues noted: ${a.issues.join(", ")}`);
  add("Would return", a.willReturn);
  add("Would recommend", a.willRecommend);
  return `Write the review from these notes:\n\n${L.join("\n")}`;
}

// safety net: guarantee no em/en dashes even if the model slips
function stripDashes(s) {
  return String(s || "").replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim();
}

export async function writeReview({ answers, stance, length }) {
  stance = (stance || "balanced").toLowerCase();
  length = length === "short" ? "short" : "full";
  if (!KEY) return stripDashes(mock(answers, stance, length));
  try {
    const text = PROVIDER === "openai"
      ? await viaOpenAI(systemPrompt(stance, length), userPrompt(answers))
      : await viaAnthropic(systemPrompt(stance, length), userPrompt(answers));
    return stripDashes(text);
  } catch (e) {
    console.error("[review] failed:", e.message);
    return stripDashes(mock(answers, stance, length));
  }
}

async function viaAnthropic(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 900, temperature: 0.7, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content?.[0]?.text || "").trim();
}
async function viaOpenAI(system, user) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, temperature: 0.7, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

/* dev mock: assembles a plausible, dash-free review from the answers so the
 * frontend works without a key. */
function mock(answers, stance, length) {
  const a = answers || {};
  const name = a.name || "this place";
  const bits = [];
  bits.push(`[MOCK ${stance} review] We came to ${name}${a.occasion ? " for " + a.occasion : ""}.`);
  if (a.arrivalText) bits.push(a.arrivalText + ".");
  if (a.drinksText) bits.push("On drinks, " + a.drinksText + ".");
  if (a.foodText) bits.push("The food: " + a.foodText + ".");
  if (a.standout) bits.push("The standout was " + a.standout + ".");
  if (a.serviceText) bits.push("Service wise, " + a.serviceText + ".");
  if (a.atmosphereText) bits.push(a.atmosphereText + ".");
  if (a.valueText) bits.push("On value, " + a.valueText + ".");
  const verdict = a.willReturn === "no" ? "I won't be rushing back." : a.willReturn === "yes" ? "I'll be back." : "I might give it another go.";
  bits.push(verdict);
  let out = bits.join(" ");
  if (length === "short") out = bits.slice(0, 3).concat(verdict).join(" ");
  return out;
}
