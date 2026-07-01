/* app.js — ALE Merge Bench. State, drop zones, match table, overrides,
 * column mapping, diff preview, export. All local; no network with file data. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const state = {
    aleRaw: "", aleModel: null, aleName: "",
    csv: null, csvName: "",
    mode: "key", offset: 0,
    mappings: [],            // [{from:csvField, to:aleColumn}]
    overrides: {},           // clipIndex -> rowIndex | null  (manual)
    assign: [],              // computed per clip {row,status,diff}
    unusedRows: [],
    preserveAll: false,
    acked: false,
  };

  /* ---------- file loading ---------- */
  function wireDrop(zoneId, inputId, onText) {
    const z = $(zoneId), inp = $(inputId);
    z.addEventListener("click", () => inp.click());
    z.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } });
    inp.addEventListener("change", () => { if (inp.files[0]) readFile(inp.files[0], onText); });
    ["dragenter", "dragover"].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove("over"); }));
    z.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f, onText); });
  }
  function readFile(file, onText) {
    const r = new FileReader();
    r.onload = () => onText(String(r.result), file.name);
    r.onerror = () => note("Couldn't read " + file.name);
    r.readAsText(file);   // keeps \r as-is in the string
  }
  function note(msg) { $("#intro-note").textContent = msg || ""; }

  function loadAle(text, name) {
    try {
      const m = ALE.parse(text);
      const v = ALE.validate(m);
      if (!v.ok) { note("ALE looks malformed: " + v.errors[0]); return; }
      state.aleRaw = text; state.aleModel = m; state.aleName = name || "bin.ale";
      $("#dz-ale").classList.add("loaded");
      $("#dz-ale-hint").innerHTML = "✓ " + esc(state.aleName) + " — " + m.rows.length + " clips, " + ALE.columnNames(m).length + " columns";
      maybeStart();
    } catch (e) { note("ALE parse failed: " + e.message); }
  }
  function loadCsv(text, name) {
    try {
      const c = CSVP.parse(text);
      if (!c.rows.length) { note("CSV has no data rows."); return; }
      state.csv = c; state.csvName = name || "vendor.csv";
      $("#dz-csv").classList.add("loaded");
      $("#dz-csv-hint").innerHTML = "✓ " + esc(state.csvName) + " — " + c.rows.length + " rows" + (c.issues.length ? " · " + c.issues.length + " note(s)" : "");
      maybeStart();
    } catch (e) { note("CSV parse failed: " + e.message); }
  }
  function maybeStart() { if (state.aleModel && state.csv) startBench(); }

  /* ---------- key source seam (today: ALE Name column) ---------- */
  function clipKeys() {
    const m = state.aleModel, ci = ALE.colIndex(m, "Name");
    return m.rows.map((r) => (ci >= 0 ? r[ci] : ""));
  }
  function clipStart() {
    const m = state.aleModel, ci = ALE.colIndex(m, "Start");
    return m.rows.map((r) => (ci >= 0 ? r[ci] : ""));
  }
  function rowKeys() { return state.csv.rows.map((r) => r["Version Name"] != null ? r["Version Name"] : r[state.csv.headers[0]]); }

  /* ---------- matching ---------- */
  function recompute() {
    const ck = clipKeys(), rk = rowKeys();
    let base;
    if (state.mode === "positional") {
      base = MATCH.matchPositional(ck.length, rk.length, state.offset).assign;
      state.unusedRows = [];
    } else {
      const res = MATCH.matchByKey(ck, rk);
      base = res.assign; state.unusedRows = res.unusedRows;
    }
    // apply manual overrides
    state.assign = base.map((a, i) => {
      if (Object.prototype.hasOwnProperty.call(state.overrides, i)) {
        const row = state.overrides[i];
        if (row == null) return { row: null, status: "red", diff: "manual: none" };
        const exact = String(ck[i]).trim() === String(rk[row]).trim();
        return { row, status: exact ? "green" : "amber", diff: "manual" + (exact ? "" : " (key differs)") };
      }
      return a;
    });
    // recompute unused for positional/override consistency
    const used = new Set(state.assign.map((a) => a.row).filter((r) => r != null));
    state.unusedRows = rk.map((_, i) => i).filter((i) => !used.has(i));
  }

  /* ---------- bench render ---------- */
  function startBench() {
    $("#intro").hidden = true; $("#bench").hidden = false;
    $("#b-ale").textContent = "ALE: " + state.aleName;
    $("#b-csv").textContent = "CSV: " + state.csvName;
    if (!state.mappings.length) defaultMappings();
    recompute(); renderAll();
  }
  function defaultMappings() {
    const has = (c) => ALE.colIndex(state.aleModel, c) >= 0;
    const csvHas = (f) => state.csv.headers.indexOf(f) >= 0;
    const want = [["Description", "Comments"], ["Vendor", "Vendor"]];
    state.mappings = want.filter(([f, t]) => csvHas(f) && has(t)).map(([from, to]) => ({ from, to }));
    if (!state.mappings.length) state.mappings = [{ from: state.csv.headers[0], to: firstWritable() }];
  }
  function writableColumns() {
    return ALE.columnNames(state.aleModel).filter((c) => !ALE.isKeyLocked(c));
  }
  function firstWritable() { const w = writableColumns(); return w[0] || ""; }

  function renderAll() { renderStats(); renderMappings(); renderTable(); renderUnused(); refreshExport(); }

  function renderStats() {
    const a = state.assign;
    const g = a.filter((x) => x.status === "green").length;
    const am = a.filter((x) => x.status === "amber").length;
    const rd = a.filter((x) => x.status === "red").length;
    $("#stats").innerHTML =
      `<span class="s-tot"><b>${a.length}</b> ALE clips</span>` +
      `<span><b>${state.csv.rows.length}</b> CSV rows</span>` +
      `<span class="s-green"><b>${g}</b> exact</span>` +
      `<span class="s-amber"><b>${am}</b> normalised</span>` +
      `<span class="s-red"><b>${rd}</b> unmatched clips</span>` +
      `<span class="s-amber"><b>${state.unusedRows.length}</b> CSV rows unused</span>`;
  }

  function renderMappings() {
    const box = $("#mappings"); box.innerHTML = "";
    const csvOpts = state.csv.headers;
    const aleNamed = ALE.columnNames(state.aleModel);
    state.mappings.forEach((mp, i) => {
      const row = document.createElement("div"); row.className = "maprow";
      const from = document.createElement("select");
      csvOpts.forEach((h) => from.add(new Option(h, h)));
      from.value = mp.from;
      from.onchange = () => { mp.from = from.value; renderTable(); refreshExport(); };
      const arrow = document.createElement("span"); arrow.className = "arrow"; arrow.textContent = "→";
      const to = document.createElement("select");
      aleNamed.forEach((c) => { if (!ALE.isKeyLocked(c)) to.add(new Option(c, c)); });
      // allow custom add? keep to existing writable columns for safety
      to.value = mp.to;
      to.onchange = () => { mp.to = to.value; renderMappings(); renderTable(); refreshExport(); };
      const warn = document.createElement("span");
      if (ALE.isSystemWarn(mp.to)) { warn.className = "warn"; warn.textContent = "⚠ Avid may not accept merges into this column"; }
      const rm = document.createElement("button"); rm.className = "rm"; rm.textContent = "✕";
      rm.title = "remove mapping";
      rm.onclick = () => { state.mappings.splice(i, 1); renderMappings(); renderTable(); refreshExport(); };
      row.append(from, arrow, to, warn, rm);
      box.appendChild(row);
    });
  }

  function valForWrite(rowIndex, csvField) {
    if (rowIndex == null) return null;
    const r = state.csv.rows[rowIndex];
    return r ? (r[csvField] != null ? r[csvField] : "") : null;
  }

  function renderTable() {
    const m = state.aleModel;
    const names = clipKeys(), starts = clipStart();
    const rk = rowKeys();
    const body = $("#match-body"); body.innerHTML = "";
    $("#prevhead").textContent = "Will write (" + state.mappings.map((mp) => mp.to).join(", ") + ")";
    state.assign.forEach((a, i) => {
      const tr = document.createElement("tr");
      tr.className = "row-" + a.status;
      // # and name and start
      let html = `<td class="cnum">${i + 1}</td>`;
      html += `<td class="cname">${esc(names[i])}</td>`;
      html += `<td class="ctc">${esc(starts[i] || "—")}</td>`;
      // matched select
      html += `<td><select class="match-sel" data-clip="${i}">`;
      html += `<option value="">— none —</option>`;
      rk.forEach((k, ri) => {
        const sel = a.row === ri ? " selected" : "";
        html += `<option value="${ri}"${sel}>${esc(k)}</option>`;
      });
      html += `</select>`;
      if (state.mode === "positional") {
        html += `<div class="nudge"><button data-nudge="${i}" data-d="-1">↑ prev</button><button data-nudge="${i}" data-d="1">↓ next</button></div>`;
      }
      if (a.diff) html += `<div class="diffnote">${esc(a.diff)}</div>`;
      html += `</td>`;
      // confidence
      const label = a.status === "green" ? "EXACT" : a.status === "amber" ? "NORMALISED" : "NONE";
      html += `<td><span class="conf ${a.status}">${label}</span></td>`;
      // will write preview
      html += `<td class="writes">`;
      if (a.row == null) {
        html += `<span class="wk">— no source row — left as-is —</span>`;
      } else {
        state.mappings.forEach((mp) => {
          const ci = ALE.colIndex(m, mp.to);
          const oldV = ci >= 0 ? (m.rows[i][ci] || "") : "";
          const newV = ALE.sanitizeCell(valForWrite(a.row, mp.from));
          const over = oldV && oldV !== newV;
          html += `<span class="w"><span class="wk">${esc(mp.to)}:</span> `;
          if (over) html += `<span class="over">${esc(oldV)} → ${esc(newV) || "(blank)"}</span> ⚠ overwrite`;
          else html += `<span class="wv">${esc(newV) || '<span class="blank">(blank)</span>'}</span>`;
          html += `</span>`;
        });
      }
      html += `</td>`;
      tr.innerHTML = html;
      body.appendChild(tr);
    });
    // wire selects + nudges
    body.querySelectorAll(".match-sel").forEach((sel) => {
      sel.onchange = () => {
        const ci = +sel.dataset.clip;
        state.overrides[ci] = sel.value === "" ? null : +sel.value;
        recompute(); renderStats(); renderTable(); renderUnused(); refreshExport();
      };
    });
    body.querySelectorAll("[data-nudge]").forEach((b) => {
      b.onclick = () => {
        const ci = +b.dataset.nudge, d = +b.dataset.d;
        const cur = state.assign[ci].row;
        const next = (cur == null ? (d > 0 ? 0 : state.csv.rows.length - 1) : cur + d);
        state.overrides[ci] = (next >= 0 && next < state.csv.rows.length) ? next : null;
        recompute(); renderStats(); renderTable(); renderUnused(); refreshExport();
      };
    });
  }

  function renderUnused() {
    const rk = rowKeys();
    if (!state.unusedRows.length) { $("#unused").innerHTML = ""; return; }
    $("#unused").innerHTML = `<b>${state.unusedRows.length} CSV row(s) not matched to any clip:</b> ` +
      state.unusedRows.map((i) => esc(rk[i])).join(", ");
  }

  /* ---------- export ---------- */
  function needsAck() { return state.assign.some((a) => a.status === "amber" || a.status === "red") || state.unusedRows.length > 0; }
  function refreshExport() {
    const ackWrap = $("#ack-wrap");
    ackWrap.hidden = !needsAck();
    const matched = state.assign.some((a) => a.row != null);
    const hasMap = state.mappings.length > 0 && state.mappings.every((mp) => mp.to);
    let ok = true, msg = "";
    if (!hasMap) { ok = false; msg = "Add at least one CSV → column mapping."; }
    else if (!matched) { ok = false; msg = "No clips are matched to a CSV row."; }
    else if (needsAck() && !$("#ack").checked) { ok = false; msg = "Review and acknowledge the amber / unmatched rows to enable export."; }
    $("#export").disabled = !ok;
    $("#export-msg").className = "export-msg" + (ok ? " good" : "");
    $("#export-msg").textContent = ok ? "Ready: " + state.assign.filter((a) => a.row != null).length + " clip(s) will be written." : msg;
  }

  function buildMergedText() {
    // work on a fresh parse so repeated exports are deterministic
    const m = ALE.parse(state.aleRaw);
    state.assign.forEach((a, i) => {
      if (a.row == null) return;
      state.mappings.forEach((mp) => {
        if (ALE.isKeyLocked(mp.to)) return;     // never touch keys (defensive; setCell also refuses)
        if (ALE.colIndex(m, mp.to) < 0) return;
        ALE.setCell(m, i, mp.to, valForWrite(a.row, mp.from));
      });
    });
    const v = ALE.validate(m);
    if (!v.ok) throw new Error(v.errors[0]);
    return ALE.write(m);
  }

  function exportAle() {
    let text;
    try { text = buildMergedText(); }
    catch (e) { $("#export-msg").className = "export-msg bad"; $("#export-msg").textContent = "Export blocked: " + e.message; return; }
    const base = state.aleName.replace(/\.ale$/i, "");
    const fname = base + "_merged.ale";
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("Exported " + fname);
  }

  let toastT;
  function toast(msg, err) { const t = $("#toast"); t.textContent = msg; t.className = "show" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(() => t.className = "", 3000); }

  /* ---------- controls ---------- */
  function wire() {
    wireDrop("#dz-ale", "#file-ale", loadAle);
    wireDrop("#dz-csv", "#file-csv", loadCsv);
    $("#load-sample").onclick = loadSample;
    $("#reset").onclick = () => location.reload();
    $("#mode-seg").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]"); if (!b) return;
      state.mode = b.dataset.mode;
      $("#mode-seg").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      $("#offwrap").hidden = state.mode !== "positional";
      state.overrides = {};   // switching mode clears manual overrides
      recompute(); renderAll();
    });
    const setOff = (v) => { state.offset = v | 0; $("#offset").value = state.offset; recompute(); renderAll(); };
    $("#offset").onchange = () => setOff(+$("#offset").value);
    $("#off-up").onclick = () => setOff(state.offset + 1);
    $("#off-dn").onclick = () => setOff(state.offset - 1);
    $("#preserve-all").onchange = () => { state.preserveAll = $("#preserve-all").checked; };
    $("#add-map").onclick = () => { state.mappings.push({ from: state.csv.headers[0], to: firstWritable() }); renderMappings(); renderTable(); refreshExport(); };
    $("#ack").onchange = () => { state.acked = $("#ack").checked; refreshExport(); };
    $("#export").onclick = exportAle;
  }

  async function loadSample() {
    try {
      const [ale, csv] = await Promise.all([
        fetch("sample/sample_bin.ale").then((r) => r.text()),
        fetch("sample/sample_vendor.csv").then((r) => r.text()),
      ]);
      loadAle(ale, "sample_bin.ale");
      loadCsv(csv, "sample_vendor.csv");
    } catch (e) { note("Couldn't load samples: " + e.message); }
  }

  wire();
})();
