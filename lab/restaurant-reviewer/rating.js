/* rating.js — deterministic, explainable star rating from the questionnaire.
 * No API. Food weighs most, then service, then value/atmosphere/arrival/drinks.
 * Stance nudges tone-of-number; the verdict ("won't return") keeps the number
 * honest so it can't read like a glowing score next to a list of letdowns.
 * Works as a browser global (window.RATING) and under Node (module.exports). */
(function (root) {
  "use strict";

  // section weights (renormalised over the sections actually answered)
  const WEIGHTS = { food: 0.35, service: 0.25, value: 0.15, atmosphere: 0.10, arrival: 0.075, drinks: 0.075 };
  const STANCE_NUDGE = { generous: 0.35, balanced: 0, critical: -0.35 };

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* answers: { food, service, value, atmosphere, arrival, drinks  (1..5 or null),
   *           stance: 'generous'|'balanced'|'critical',
   *           willReturn / willRecommend: 'yes'|'maybe'|'no' } */
  function compute(answers) {
    const a = answers || {};
    let wsum = 0, score = 0;
    const present = [];
    for (const k in WEIGHTS) {
      const v = a[k];
      if (typeof v === "number" && v >= 1 && v <= 5) { score += v * WEIGHTS[k]; wsum += WEIGHTS[k]; present.push(k); }
    }
    if (!wsum) return { stars: null, score: null, rationale: "Answer a few sections to get a suggested rating.", tension: false };

    const base = score / wsum;                 // 1..5 weighted average of answered sections
    const stance = a.stance || "balanced";
    let s = base + (STANCE_NUDGE[stance] || 0);

    const reasons = [];
    // headline driver
    const sorted = present.slice().sort((x, y) => (a[y] - a[x]));
    const food = a.food;
    if (typeof food === "number") reasons.push(`food ${food}/5 (counts most)`);

    // verdict honesty — the number must agree with the words
    let tension = false;
    const wontReturn = a.willReturn === "no";
    const wontRec = a.willRecommend === "no";
    if (wontReturn || wontRec) {
      if (base >= 4) {
        tension = true;
        s = Math.min(s, 3.2);
        reasons.push(`your notes score well, but you ${wontReturn ? "won't return" : "wouldn't recommend"}, so the number is pulled toward 3 to match`);
      } else {
        const capped = Math.min(s, 3.4);   // cap an enthusiastic score; don't punish an already-modest one
        if (capped < s) reasons.push(`${wontReturn ? "won't return" : "wouldn't recommend"} caps the score`);
        s = capped;
      }
    }
    if (a.willReturn === "yes" && a.willRecommend === "yes" && base >= 3.5) {
      s += 0.2; reasons.push("you'd return and recommend, a small lift");
    }
    if (stance === "critical") reasons.push("critical stance");
    else if (stance === "generous") reasons.push("generous stance");

    s = clamp(s, 1, 5);
    const stars = clamp(Math.round(s), 1, 5);

    let rationale = `${stars}★ (computed ${s.toFixed(1)}): ${reasons.slice(0, 3).join("; ")}.`;
    if (tension) rationale = "⚠ " + rationale + " The words describe letdowns, so a glowing score wouldn't be honest.";

    return { stars, score: +s.toFixed(1), base: +base.toFixed(2), rationale, tension };
  }

  const API = { compute, WEIGHTS, STANCE_NUDGE };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.RATING = API;
})(typeof window !== "undefined" ? window : this);
