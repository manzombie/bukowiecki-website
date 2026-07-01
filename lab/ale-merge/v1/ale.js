/* ale.js — Avid Log Exchange (ALE) parser / writer / validator.
 *
 * SAFETY MODEL (proven on a real Avid round-trip): Avid merges on Name + exact
 * timecode, so the tool must carry Name / Tape / Source File / Start / End and
 * ALL structure through BYTE-EXACT, writing only into chosen content columns.
 * Therefore: parse keeps every line verbatim; write rebuilds ONLY the data-row
 * lines whose cells changed. parse->write with no edits is byte-identical.
 *
 * Format (locked to real Avid exports): CR (\r) line endings, TAB field delim,
 * three sections — Heading / Column / Data. Column + data rows can carry trailing
 * tabs (empty trailing fields) which are preserved exactly.
 *
 * Works as a browser global (window.ALE) and under Node (module.exports). */
(function (root) {
  "use strict";

  // Columns that are match keys / structure — the tool must NEVER write to these.
  const KEY_LOCKED = ["name", "tape", "source file", "start", "end"];
  // System / Avid-derived columns — allowed to map but warn (may not transfer).
  const SYSTEM_WARN = ["package name", "duration", "drive", "video", "creation date", "color", "tracks", "audio sr", "fps"];

  function detectEol(text) {
    if (text.indexOf("\r\n") >= 0) return "\r\n";
    if (text.indexOf("\r") >= 0) return "\r";
    return "\n";
  }

  /** Parse ALE text into a model that round-trips byte-exact. */
  function parse(text) {
    if (typeof text !== "string") throw new Error("ALE.parse: expected string");
    const eol = detectEol(text);
    const lines = text.split(eol);   // verbatim lines (no terminators)

    const model = {
      eol, lines,
      heading: {},                   // key -> value (informational)
      headingLineIdxs: [],
      columnMarkerIdx: -1,
      columnNamesIdx: -1,
      columns: [],                   // raw tokens of the column-names row (incl trailing empties)
      dataMarkerIdx: -1,
      rowIdxs: [],                   // line index of each data row
      rows: [],                      // parallel: array of cell arrays
    };

    let section = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "Heading") { section = "heading"; continue; }
      if (line === "Column")  { section = "column"; model.columnMarkerIdx = i; continue; }
      if (line === "Data")    { section = "data"; model.dataMarkerIdx = i; continue; }

      if (section === "heading") {
        if (line === "") continue;
        const t = line.split("\t");
        model.headingLineIdxs.push(i);
        if (t.length >= 2) model.heading[t[0]] = t[1];
      } else if (section === "column") {
        if (line === "") continue;
        if (model.columnNamesIdx === -1) {       // first non-empty line after "Column"
          model.columnNamesIdx = i;
          model.columns = line.split("\t");
        }
      } else if (section === "data") {
        if (line === "") continue;               // blank / final trailing line: keep in lines, not a row
        model.rowIdxs.push(i);
        model.rows.push(line.split("\t"));
      }
    }

    if (model.columnNamesIdx === -1) throw new Error("ALE.parse: no Column section / column names found");
    if (model.dataMarkerIdx === -1) throw new Error("ALE.parse: no Data section found");
    return model;
  }

  /** Named columns (drop trailing empty padding columns from the header). */
  function columnNames(model) {
    return model.columns.filter((c) => c !== "");
  }

  /** Index of a column by name (case-insensitive, trimmed). -1 if absent. */
  function colIndex(model, name) {
    const target = String(name).trim().toLowerCase();
    for (let i = 0; i < model.columns.length; i++) {
      if (model.columns[i].trim().toLowerCase() === target) return i;
    }
    return -1;
  }

  function isKeyLocked(name) { return KEY_LOCKED.indexOf(String(name).trim().toLowerCase()) >= 0; }
  function isSystemWarn(name) { return SYSTEM_WARN.indexOf(String(name).trim().toLowerCase()) >= 0; }

  /** Set a cell value by row index + column name. Refuses match-key/locked cols.
   *  Mutates model.rows; the changed row is re-emitted by write(). */
  function setCell(model, rowI, colName, value) {
    if (isKeyLocked(colName)) throw new Error("ALE.setCell: refusing to write match-key/structural column '" + colName + "'");
    const ci = colIndex(model, colName);
    if (ci < 0) throw new Error("ALE.setCell: column not found '" + colName + "'");
    const row = model.rows[rowI];
    if (!row) throw new Error("ALE.setCell: row " + rowI + " out of range");
    while (row.length < model.columns.length) row.push("");   // pad if short (shouldn't happen on valid ALE)
    row[ci] = sanitizeCell(value);
  }

  /** Strip characters that would corrupt the ALE grid (tabs / line breaks). */
  function sanitizeCell(v) {
    return String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ").trim();
  }

  /** Serialize model back to text. Byte-exact when nothing changed. */
  function write(model) {
    const lines = model.lines.slice();
    for (let k = 0; k < model.rowIdxs.length; k++) {
      lines[model.rowIdxs[k]] = model.rows[k].join("\t");
    }
    return lines.join(model.eol);
  }

  /** Validate structure before export. Returns {ok, errors:[...]}. */
  function validate(model) {
    const errors = [];
    if (model.columnMarkerIdx < 0) errors.push("missing 'Column' section marker");
    if (model.dataMarkerIdx < 0) errors.push("missing 'Data' section marker");
    if (!model.columns.length) errors.push("no columns parsed");
    const expected = model.columns.length;
    for (let k = 0; k < model.rows.length; k++) {
      const n = model.rows[k].length;
      if (n !== expected) {
        errors.push("row " + (k + 1) + " has " + n + " fields, expected " + expected +
          " (column misalignment — would break the Avid merge)");
      }
    }
    if (model.eol !== "\r" && model.eol !== "\r\n") {
      errors.push("unexpected line endings (Avid ALE expects CR)");
    }
    return { ok: errors.length === 0, errors };
  }

  const API = {
    parse, write, validate, columnNames, colIndex, setCell, sanitizeCell,
    isKeyLocked, isSystemWarn, KEY_LOCKED, SYSTEM_WARN,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.ALE = API;
})(typeof window !== "undefined" ? window : this);
