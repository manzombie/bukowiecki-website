# ALE Merge Bench — Research Studio, Day 07

Merge a vendor submission **CSV** into an **Avid-exported bin ALE** and produce a
re-importable ALE that fills the bin's columns in one merge — with every match
shown so the operator can correct it **before** export. 100% local in the browser:
no upload, no backend, no storage.

- `index.html` · `styles.css`
- `app.js` — state, drop zones, match table, overrides, column mapping, export
- `ale.js` — ALE parse / write / structure validation (round-trip byte-exact)
- `csv.js` — robust CSV parser (quoted commas, BOM, CR/LF/CRLF, blank rows)
- `match.js` — normalise, key match + confidence, positional/offset; key-source seam
- `sample/` — **fake/scrubbed** sample ALE + CSV for demo/tests (not real data)

## The proven mechanism (from a real Avid round-trip)

**Mode A — bin-export merge** (the only mode today):

1. Assistant imports vendor MXFs into a new bin; Avid writes Name + Tape/Source File
   + Start/End timecode from the MXF headers.
2. Assistant **exports that bin as an ALE** — this is the source of truth: exact
   match keys + clean column structure (content columns may be empty).
3. **This tool** merges the vendor CSV into that ALE: matches CSV rows to clips on the
   normalised Name key and writes vendor data **only** into chosen content columns,
   leaving Name / Tape / Source File / Start / End and all structure **byte-exact**.
4. Assistant re-imports the merged ALE with **“Merge events with known master clips.”**
   The columns populate because the keys never changed.

**The match key is Name + exact timecode.** Avid relinks on Name and byte-exact
per-clip timecode. Proven by test: a merged ALE that preserved each clip's exact
Start TC relinked and populated; a hand-edited ALE that overwrote Start/End with
wrong/repeated values failed to relink. Therefore the tool **never** alters Name,
Tape, Source File, Start, End, or any structural field — it writes only chosen
content columns. Carrying the keys through untouched **is** the safety model.

Second proven failure mode: **column misalignment** (inconsistent tab counts shifting
fields). The exporter guarantees every row has the same field count as the Column
header, and **refuses to export** otherwise.

## Exact ALE format (locked to real Avid exports)

- **CR (`\r`)** line endings — preserved exactly.
- **TAB**-delimited fields; trailing tabs (empty trailing fields) preserved.
- Three sections: `Heading` (key/value lines) · `Column` (names row) · `Data` (one
  row per clip). Columns/order are **parsed from the loaded file**, never hardcoded —
  every facility/bin differs.
- "Source File" carries `.mxf`; "Name" and the CSV "Version Name" have none — matched
  by stripping the extension.
- **Round-trip is a hard gate:** `parse → write` is byte-identical (verified on real
  97-row Avid ALEs) before any merge runs. If that ever fails, nothing downstream is
  trustworthy.

## Writable vs locked columns

- **Writable** (seen populating in a bin): `Comments`, `Vendor`, `Edit_Note`, and user
  custom columns.
- **System / Avid-derived — mapping allowed but warned** (may not transfer): `Package
  Name` (proven not to transfer), `Duration`, `Drive`, `Video`, `Creation Date`,
  `Color`, etc.
- **Match-key / structural — read-only to the tool, never a write target:** `Name`,
  `Tape`, `Source File`, `Start`, `End`.

## Column-preservation modes

- **Default:** carry the keys + full column structure byte-exact and fill only the
  chosen writable columns. This is exactly the proven path, and the export diff shows
  *only* the content columns you mapped changed.
- **“Preserve ALL original columns” toggle:** because this writer always carries the
  complete original column set through byte-exact (it never drops columns), the output
  already preserves everything; the toggle is retained for forward-compatibility and
  as an explicit affirmation for older/mixed facilities. (A true *lean column-subset*
  export is intentionally **not** shipped — a subset is unproven on a real Avid and a
  reduced structure would defeat the byte-exact safety proof. Flagged for LB.)

## Matching (the bench is the product)

- Auto-match CSV → clips on the normalised Name key:
  **green** = exact key · **amber** = matched only after normalising case/space/extension
  (the difference is shown) · **red** = no match.
- **Positional mode** with an offset + per-row nudge, for "count N down" alignment.
- **Manual override** per clip (dropdown). Unmatched clips and unused CSV rows are
  surfaced, never hidden. Repeated vendor Descriptions stay visible.
- **Diff/preview** per clip: target column old → new, with an overwrite warning when
  the cell wasn't blank. The operator must acknowledge ambers/unmatched before export.

## Re-import into Avid

Select the clips in the bin → **Input ▸ Import → Shot Log** → enable
**“Merge events with known master clips.”**

## Privacy

Everything runs in the browser. User files are read with `FileReader`; the only
network reads are the bundled local sample files. No file data ever leaves the machine.

## Future seam (not built)

`match.js` works on plain `{ key }` arrays behind a **key-source** abstraction. Today
the key source is the exported ALE (key = clip Name). A v2 "direct generate" that skips
the bin export is viable **only** with real, trustworthy Start timecode matching the
MXFs (this vendor CSV has integer frame counts, not timecode). The robust v2 reads the
MXF header timecode itself (Material Package TimecodeComponent, KLV) — a large
in-browser build — and would slot in behind the same seam without a rewrite.

## Note on fixtures

The two named fixtures from the brief (`MKT_EDT_260622_F.ALE`, `00_ALE_TEST.ALE`)
weren't present on disk. Round-trip fidelity was proven instead against the real
Avid-exported ALEs that were available (`MKT_PULL_*` — same format), and the bundled
`sample/` files reproduce the documented MKT_EDT column set. See NEEDS.
