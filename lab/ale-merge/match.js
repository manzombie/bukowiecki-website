/* match.js — match vendor CSV rows to ALE clips.
 *
 * KEY-SOURCE SEAM: matching works on plain { key, raw } arrays, not on the ALE
 * directly. Today the key source is the Avid-exported ALE (key = clip Name).
 * A future v2 could supply keys from MXF-header timecode without touching this
 * file — build the clip list from a different source and feed it in.
 *
 * Confidence:
 *   green = raw keys identical (after trim)
 *   amber = matched only after normalisation (case / spaces / extension) — diff shown
 *   red   = no match
 *
 * Works as a browser global (window.MATCH) and under Node (module.exports). */
(function (root) {
  "use strict";

  const MEDIA_EXT = /\.(mxf|mov|mp4|mxf|exr|dpx|tif|tiff|wav|aif|aiff|mp3|prores)$/i;

  function stripExt(s) { return String(s == null ? "" : s).replace(MEDIA_EXT, ""); }

  /** normalise a key for comparison: drop extension, lowercase, collapse ws. */
  function normalizeKey(s) {
    return stripExt(String(s == null ? "" : s))
      .trim().toLowerCase().replace(/\s+/g, " ");
  }

  /** Describe how two raw keys differ (for amber explanations). */
  function describeDiff(aRaw, bRaw) {
    const a = String(aRaw || ""), b = String(bRaw || "");
    const diffs = [];
    if (stripExt(a) !== a || stripExt(b) !== b) diffs.push("extension");
    if (a.toLowerCase() === b.toLowerCase() && a !== b) diffs.push("case");
    if (a.replace(/\s+/g, "") === b.replace(/\s+/g, "") && a !== b) diffs.push("spacing");
    if (!diffs.length && normalizeKey(a) === normalizeKey(b) && a !== b) diffs.push("formatting");
    return diffs.join(", ");
  }

  /** Key match. clips/rows are arrays of raw key strings.
   *  Returns { assign:[{row,status,diff}], unusedRows:[idx], stats }. */
  function matchByKey(clipKeys, rowKeys) {
    const index = new Map();   // normKey -> [rowIndex,...]
    rowKeys.forEach((rk, i) => {
      const n = normalizeKey(rk);
      if (!n) return;
      if (!index.has(n)) index.set(n, []);
      index.get(n).push(i);
    });

    const usedRow = new Set();
    const assign = clipKeys.map((ck) => {
      const n = normalizeKey(ck);
      const candidates = index.get(n) || [];
      // prefer an unused candidate, else reuse (flag ambiguity)
      let row = candidates.find((r) => !usedRow.has(r));
      let ambiguous = false;
      if (row == null && candidates.length) { row = candidates[0]; ambiguous = true; }
      if (row == null) return { row: null, status: "red", diff: "" };
      usedRow.add(row);
      const exact = String(ck).trim() === String(rowKeys[row]).trim();
      return {
        row,
        status: exact ? "green" : "amber",
        diff: exact ? "" : describeDiff(ck, rowKeys[row]),
        ambiguous,
      };
    });

    const unusedRows = [];
    rowKeys.forEach((_, i) => { if (!usedRow.has(i)) unusedRows.push(i); });

    const stats = {
      green: assign.filter((a) => a.status === "green").length,
      amber: assign.filter((a) => a.status === "amber").length,
      red: assign.filter((a) => a.status === "red").length,
      unusedRows: unusedRows.length,
    };
    return { assign, unusedRows, stats };
  }

  /** Positional match: clip[i] <- row[i + offset]. Mirrors "count N down". */
  function matchPositional(clipCount, rowCount, offset) {
    offset = offset | 0;
    const assign = [];
    for (let i = 0; i < clipCount; i++) {
      const r = i + offset;
      assign.push({ row: (r >= 0 && r < rowCount) ? r : null, status: (r >= 0 && r < rowCount) ? "amber" : "red", diff: "positional" });
    }
    return { assign };
  }

  const API = { normalizeKey, stripExt, describeDiff, matchByKey, matchPositional, MEDIA_EXT };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.MATCH = API;
})(typeof window !== "undefined" ? window : this);
