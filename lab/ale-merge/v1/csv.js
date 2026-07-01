/* csv.js — robust, hand-rolled CSV parser for vendor submission sheets.
 * Handles: quoted fields with embedded commas ("h264, mxf, prores, exr"),
 * escaped quotes (""), BOM, CR / LF / CRLF, trailing spaces, blank rows.
 * Never silently drops a row: blank rows and unparseable rows are surfaced.
 *
 * Returns { headers:[...], rows:[{...}], raw:[ [cells] ], issues:[...] }.
 * Works as a browser global (window.CSVP) and under Node (module.exports). */
(function (root) {
  "use strict";

  function parse(text) {
    if (typeof text !== "string") throw new Error("CSV.parse: expected string");
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip BOM

    const records = [];     // array of arrays (raw cells)
    let field = "";
    let record = [];
    let inQuotes = false;
    let i = 0;
    const n = text.length;
    let started = false;    // has the current record any content yet

    function endField() { record.push(field); field = ""; }
    function endRecord() { endField(); records.push(record); record = []; started = false; }

    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }   // escaped quote
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; started = true; i++; continue; }
      if (c === ",") { endField(); started = true; i++; continue; }
      if (c === "\r") { if (text[i + 1] === "\n") i++; endRecord(); i++; continue; }
      if (c === "\n") { endRecord(); i++; continue; }
      field += c; started = true; i++;
    }
    // flush trailing field/record (file not ending in newline)
    if (field !== "" || record.length || started) endRecord();

    const issues = [];
    if (inQuotes) issues.push("File ended inside a quoted field — last row may be incomplete.");

    // drop a single trailing fully-empty record (from a final newline), but flag others
    while (records.length && records[records.length - 1].length === 1 && records[records.length - 1][0] === "") {
      records.pop();
    }
    if (!records.length) return { headers: [], rows: [], raw: [], issues: ["No rows found in CSV."] };

    const headers = records[0].map((h) => h.trim());
    const rows = [];
    for (let r = 1; r < records.length; r++) {
      const cells = records[r];
      const isBlank = cells.every((x) => x.trim() === "");
      if (isBlank) { issues.push("Row " + (r + 1) + " is blank — skipped."); continue; }
      if (cells.length !== headers.length) {
        issues.push("Row " + (r + 1) + " has " + cells.length + " fields, header has " +
          headers.length + " — kept, but check alignment.");
      }
      const obj = { __row: r + 1, __cells: cells };
      for (let h = 0; h < headers.length; h++) obj[headers[h]] = (cells[h] != null ? cells[h] : "").trim();
      rows.push(obj);
    }
    return { headers, rows, raw: records, issues };
  }

  const API = { parse };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.CSVP = API;
})(typeof window !== "undefined" ? window : this);
