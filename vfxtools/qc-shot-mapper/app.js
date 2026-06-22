import { readTextFile } from "../editorial-converter/core/file.js";
import { enrichQcCsv } from "./matcher.js";

const state = {
    files: {},
    result: null,
    filteredRows: []
};

const elements = {
    shotInput:      document.getElementById("shotInput"),
    qcInput:        document.getElementById("qcInput"),
    shotDropzone:   document.getElementById("shotDropzone"),
    qcDropzone:     document.getElementById("qcDropzone"),
    shotFileMeta:   document.getElementById("shotFileMeta"),
    qcFileMeta:     document.getElementById("qcFileMeta"),
    processButton:  document.getElementById("processButton"),
    downloadButton: document.getElementById("downloadButton"),
    statusMessage:  document.getElementById("statusMessage"),
    emptyState:     document.getElementById("emptyState"),
    resultsPanel:   document.getElementById("resultsPanel"),
    resultSummary:  document.getElementById("resultSummary"),
    statShots:      document.getElementById("statShots"),
    statIssues:     document.getElementById("statIssues"),
    statAffected:   document.getElementById("statAffected"),
    statUnmatched:  document.getElementById("statUnmatched"),
    searchInput:    document.getElementById("searchInput"),
    severityFilter: document.getElementById("severityFilter"),
    contentFilter:  document.getElementById("contentFilter"),
    tableBody:      document.getElementById("tableBody"),
    rowCount:       document.getElementById("rowCount"),
    warningBox:     document.getElementById("warningBox")
};

// Columns to show in the preview table, in order
const PREVIEW_COLS = [
    "SHOT_ID",
    "Timecode In",
    "Timecode Out",
    "Description",
    "Duration",
    "A/V/F",
    "Scale",
    "Chan./Sectr"
];

init();

function init() {
    setupDropzone("shot", elements.shotInput, elements.shotDropzone, elements.shotFileMeta);
    setupDropzone("qc",   elements.qcInput,   elements.qcDropzone,   elements.qcFileMeta);
    elements.processButton.addEventListener("click", processFiles);
    elements.downloadButton.addEventListener("click", downloadResult);
    elements.searchInput.addEventListener("input", renderFilteredRows);
    elements.severityFilter.addEventListener("change", renderFilteredRows);
    elements.contentFilter.addEventListener("change", renderFilteredRows);
    hideStatus();
    syncButtons();
}

function setupDropzone(id, input, dropzone, metaElement) {
    input.addEventListener("change", (event) => {
        const [file] = event.target.files;
        if (file) setFile(id, file, metaElement);
    });

    dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropzone.classList.remove("dragover");
        const [file] = event.dataTransfer.files;
        if (file) {
            input.files = event.dataTransfer.files;
            setFile(id, file, metaElement);
        }
    });
}

function setFile(id, file, metaElement) {
    state.files[id] = file;
    state.result    = null;
    metaElement.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span>`;
    resetResults();
    hideStatus();
    syncButtons();
}

async function processFiles() {
    elements.processButton.disabled = true;
    showStatus("Matching QC timecodes to shot ranges...", "success");

    try {
        const [shotText, qcText] = await Promise.all([
            readTextFile(state.files.shot),
            readTextFile(state.files.qc)
        ]);
        state.result = enrichQcCsv(shotText, qcText, { fps: 24 });
        populateFilters(state.result.rows, state.result.headers);
        renderResults();
        showStatus("Done. Download the enriched QC CSV below.", "success");
    } catch (error) {
        state.result = null;
        resetResults();
        showStatus(error.message || "Could not process those CSV files.", "error");
    } finally {
        syncButtons();
    }
}

function renderResults() {
    const { stats, summary, warnings } = state.result;

    elements.emptyState.hidden    = false;
    elements.resultsPanel.hidden  = false;
    elements.emptyState.hidden    = true;
    elements.resultSummary.textContent = summary;
    elements.statShots.textContent    = stats.shotCount;
    elements.statIssues.textContent   = stats.issueCount;
    elements.statAffected.textContent = stats.affectedShotCount;
    elements.statUnmatched.textContent = stats.unmatchedCount;

    if (warnings.length) {
        elements.warningBox.hidden      = false;
        elements.warningBox.textContent = warnings.join(" ");
    } else {
        elements.warningBox.hidden      = true;
        elements.warningBox.textContent = "";
    }

    renderFilteredRows();
}

function renderFilteredRows() {
    if (!state.result) return;

    const { headers, rows } = state.result;

    // Build a lookup: column name (trimmed) → row array index
    const colIdx = (name) => headers.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());

    const scaleIdx   = colIdx("Scale");
    const avfIdx     = colIdx("A/V/F");
    const query      = elements.searchInput.value.trim().toLowerCase();
    const severity   = elements.severityFilter.value;
    const content    = elements.contentFilter.value;

    state.filteredRows = rows.filter(row => {
        const matchesSeverity = !severity || (row[scaleIdx] ?? "").trim() === severity;
        const matchesContent  = !content  || (row[avfIdx]   ?? "").trim() === content;
        const matchesQuery    = !query    || row.some(cell => String(cell).toLowerCase().includes(query));
        return matchesSeverity && matchesContent && matchesQuery;
    });

    // Resolve display column indices once
    const displayCols = PREVIEW_COLS.map(name => ({
        name,
        index: colIdx(name)
    })).filter(c => c.index !== -1);

    const rowsToRender = state.filteredRows.slice(0, 250);
    elements.tableBody.innerHTML = rowsToRender.map(row => {
        const shotId  = (row[colIdx("SHOT_ID")] ?? "").trim();
        const isMulti = shotId.includes("|");
        const noMatch = !shotId;
        const cellClass = noMatch ? "status-miss" : isMulti ? "shot-multi" : "shot-cell";

        return `<tr>${displayCols.map(({ name, index }) => {
            const val = (row[index] ?? "").trim();
            if (name === "SHOT_ID") {
                return `<td class="${cellClass}">${escapeHtml(val || "—")}</td>`;
            }
            return `<td>${escapeHtml(val)}</td>`;
        }).join("")}</tr>`;
    }).join("");

    const capped = state.filteredRows.length > rowsToRender.length
        ? ` Showing first ${rowsToRender.length}.`
        : "";
    elements.rowCount.textContent = `${state.filteredRows.length} row${state.filteredRows.length === 1 ? "" : "s"} match the current filters.${capped}`;
}

function populateFilters(rows, headers) {
    const colIdx  = name => headers.findIndex(h => h.trim().toLowerCase() === name.toLowerCase());
    const scaleIdx = colIdx("Scale");
    const avfIdx   = colIdx("A/V/F");

    const severities = uniqueColValues(rows, scaleIdx);
    const contents   = uniqueColValues(rows, avfIdx);
    populateSelect(elements.severityFilter, "All severities", severities);
    populateSelect(elements.contentFilter,  "All A/V/F",      contents);
}

function uniqueColValues(rows, index) {
    return [...new Set(rows.map(r => (r[index] ?? "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function populateSelect(select, label, values) {
    select.innerHTML = `<option value="">${label}</option>${values.map(v =>
        `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`
    ).join("")}`;
}

function downloadResult() {
    if (!state.result?.csv) return;

    const blob   = new Blob(["\uFEFF", state.result.csv], { type: "text/csv;charset=utf-8" });
    const url    = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href     = url;
    anchor.download = state.result.downloadName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function resetResults() {
    elements.emptyState.hidden   = false;
    elements.resultsPanel.hidden = true;
    elements.tableBody.innerHTML = "";
    elements.warningBox.hidden   = true;
    elements.warningBox.textContent = "";
    elements.rowCount.textContent   = "";
    elements.searchInput.value      = "";
    populateSelect(elements.severityFilter, "All severities", []);
    populateSelect(elements.contentFilter,  "All A/V/F",      []);
}

function syncButtons() {
    const hasFiles = Boolean(state.files.shot && state.files.qc);
    elements.processButton.disabled  = !hasFiles;
    elements.downloadButton.disabled = !state.result?.csv;
}

function showStatus(message, type) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className   = `status-message ${type} show`;
}

function hideStatus() {
    elements.statusMessage.className   = "status-message";
    elements.statusMessage.textContent = "";
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 Bytes";
    const units    = ["Bytes", "KB", "MB", "GB"];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const size     = bytes / 1024 ** exponent;
    return `${size.toFixed(size >= 100 || exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
