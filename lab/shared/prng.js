/* ============================================================================
 * shared/prng.js — the canonical deterministic randomness for Research Studio.
 *
 * WHY THIS EXISTS (read me even if you don't code):
 * A generative-art "collection" is only real if it is *reproducible*. If we
 * used the computer's normal randomness (Math.random), every reload would
 * produce different art and we could never recreate, export, or prove a piece.
 *
 * Instead we use a "seeded" random generator: you give it a starting word or
 * number (the "seed"), and it produces the exact same sequence of "random"
 * numbers every single time. Same seed in → same art out. Forever. On any
 * computer.
 *
 * Every tool in the 10-day lab imports THIS file. Do not fork it — keeping one
 * shared generator means a seed means the same thing across all the tools.
 * ========================================================================== */

/**
 * hashString — turn any text seed (e.g. "spring-2026:42") into one 32-bit number.
 *
 * This is a small, well-known mixing function (FNV-1a style). It just scrambles
 * the characters of the string into a single integer so that tiny changes to the
 * seed ("42" vs "43") produce completely different starting points.
 *
 * @param {string} str  any seed text
 * @returns {number}    an unsigned 32-bit integer
 */
export function hashString(str) {
  let h = 0x811c9dc5; // FNV offset basis — just a fixed, arbitrary starting value
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);              // mix in the next character
    // multiply by the FNV prime (written as shifts/adds to stay in 32-bit land)
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // force it to be a positive 32-bit integer
}

/**
 * mulberry32 — the actual number generator.
 *
 * Given a starting integer ("a"), it returns a function. Every time you call
 * that function it spits out the next number in a fixed sequence, as a decimal
 * between 0 (inclusive) and 1 (exclusive) — the same shape as Math.random(),
 * but deterministic.
 *
 * Mulberry32 is a tiny, fast, well-tested PRNG. It's plenty good for visuals.
 *
 * @param {number} a  32-bit seed integer
 * @returns {() => number}  call it to get the next float in [0, 1)
 */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * makeRng — the one function tools should call.
 *
 * Pass a seed (string OR number); get back a rich little random object whose
 * methods all draw from the same deterministic stream.
 *
 * @param {string|number} seed
 * @returns {Rng}
 */
export function makeRng(seed) {
  const seedInt =
    typeof seed === "number" ? seed >>> 0 : hashString(String(seed));
  const next = mulberry32(seedInt);

  /** @typedef {object} Rng */
  return {
    /** the raw seed integer used (handy for debugging / display) */
    seed: seedInt,

    /** next float in [0, 1) */
    next,

    /** float in [min, max) */
    range(min, max) {
      return min + next() * (max - min);
    },

    /** integer in [min, max] inclusive */
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1));
    },

    /** true with the given probability p (0..1) */
    chance(p) {
      return next() < p;
    },

    /** pick one element of an array, uniformly */
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },

    /**
     * pick one element using weights (higher weight = more likely).
     * @param {Array} arr
     * @param {number[]} weights  same length as arr
     */
    weighted(arr, weights) {
      let total = 0;
      for (const w of weights) total += w;
      let r = next() * total;
      for (let i = 0; i < arr.length; i++) {
        r -= weights[i];
        if (r < 0) return arr[i];
      }
      return arr[arr.length - 1];
    },

    /**
     * gaussian-ish value via the central-limit trick (sum of uniforms).
     * Returns roughly mean-centred values; good for "natural" jitter.
     * @param {number} mean
     * @param {number} spread  standard-deviation-ish
     */
    gauss(mean = 0, spread = 1) {
      let s = 0;
      for (let i = 0; i < 6; i++) s += next();
      // sum of 6 uniforms has mean 3; normalise to ~[-1,1] then scale
      return mean + ((s - 3) / 3) * spread;
    },
  };
}
