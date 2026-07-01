import { readTextFile } from "../editorial-converter/core/file.js";
import {
    encodeUtf16Le,
    parseCsvRows,
    runQcReportPipeline
} from "./engine.js";

const state = {
    files: {},
    result: null
};

const elements = {
    qcInput: document.getElementById("qcInput"),
    subcapInput: document.getElementById("subcapInput"),
    edlInput: document.getElementById("edlInput"),
    qcDropzone: document.getElementById("qcDropzone"),
    subcapDropzone: document.getElementById("subcapDropzone"),
    edlDropzone: document.getElementById("edlDropzone"),
    qcMeta: document.getElementById("qcMeta"),
    subcapMeta: document.getElementById("subcapMeta"),
    edlMeta: document.getElementById("edlMeta"),
    processButton: document.getElementById("processButton"),
    csvButton: document.getElementById("csvButton"),
    subcapButton: document.getElementById("subcapButton"),
    bothButton: document.getElementById("bothButton"),
    status: document.getElementById("status"),
    emptyState: document.getElementById("emptyState"),
    results: document.getElementById("results"),
    qcIssues: document.getElementById("qcIssues"),
    matchedIssues: document.getElementById("matchedIssues"),
    affectedShots: document.getElementById("affectedShots"),
    matchedVersions: document.getElementById("matchedVersions"),
    subcapEntries: document.getElementById("subcapEntries"),
    unmatchedIssues: document.getElementById("unmatchedIssues"),
    previewBody: document.getElementById("previewBody"),
    previewCount: document.getElementById("previewCount")
};

init();

function init() {
    setupFileInput("qc", elements.qcInput, elements.qcDropzone, elements.qcMeta);
    setupFileInput("subcap", elements.subcapInput, elements.subcapDropzone, elements.subcapMeta);
    setupFileInput("edl", elements.edlInput, elements.edlDropzone, elements.edlMeta);
    elements.processButton.addEventListener("click", processFiles);
    elements.csvButton.addEventListener("click", downloadCsv);
    elements.subcapButton.addEventListener("click", downloadSubcaps);
    elements.bothButton.addEventListener("click", () => {
        downloadCsv();
        window.setTimeout(downloadSubcaps, 150);
    });
}

function setupFileInput(id, input, dropzone, meta) {
    input.addEventListener("change", (event) => {
        const [file] = event.target.files;
        if (file) {
            setFile(id, file, meta);
        }
    });
    dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropzone.classList.remove("dragover");
        const [file] = event.dataTransfer.files;
        if (file) {
            setFile(id, file, meta);
        }
    });
}

function setFile(id, file, meta) {
    state.files[id] = file;
    state.result = null;
    meta.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span>`;
    resetResult();
    hideStatus();
    syncButtons();
}

async function processFiles() {
    if (!state.files.qc || !state.files.subcap || !state.files.edl) {
        return;
    }

    elements.processButton.disabled = true;
    showStatus("Reading report, matching VFX shots, and attaching versions...", "success");

    try {
        const [qcRows, subcapText, edlText] = await Promise.all([
            readQcRows(state.files.qc),
            readTextFile(state.files.subcap),
            readTextFile(state.files.edl)
        ]);
        state.result = runQcReportPipeline({
            qcRows,
            subcapText,
            edlText,
            fps: 24
        });
        renderResult();
        showStatus("QC package ready: enriched CSV and Avid SubCaps can be downloaded.", "success");
    } catch (error) {
        state.result = null;
        resetResult();
        showStatus(error.message || "Could not process these files.", "error");
    } finally {
        syncButtons();
    }
}

async function readQcRows(file) {
    if (/\.xlsx$/i.test(file.name)) {
        await ensureXlsxReader();
        const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            throw new Error("The XLSX workbook does not contain a worksheet.");
        }
        const sheet = workbook.Sheets[sheetName];
        repairWorksheetRange(sheet);
        return window.XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: false,
            defval: ""
        });
    }

    if (/\.csv$/i.test(file.name)) {
        return parseCsvRows(await readTextFile(file));
    }

    throw new Error("The QC report must be an .xlsx or .csv file.");
}

async function ensureXlsxReader() {
    if (window.XLSX) {
        return;
    }

    await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error(
            "The XLSX reader could not load locally or from the fallback CDN. Upload vendor/xlsx.full.min.js to the server."
        ));
        document.head.appendChild(script);
    });

    if (!window.XLSX) {
        throw new Error("The XLSX reader loaded without exposing the XLSX API.");
    }
}

function repairWorksheetRange(sheet) {
    let maxRow = 0;
    let maxColumn = 0;

    for (const address of Object.keys(sheet)) {
        if (address.startsWith("!")) {
            continue;
        }
        const cell = window.XLSX.utils.decode_cell(address);
        maxRow = Math.max(maxRow, cell.r);
        maxColumn = Math.max(maxColumn, cell.c);
    }

    if (maxRow > 0 || maxColumn > 0) {
        sheet["!ref"] = window.XLSX.utils.encode_range({
            s: { r: 0, c: 0 },
            e: { r: maxRow, c: maxColumn }
        });
    }
}

function renderResult() {
    const { stats, tableRows } = state.result;
    elements.emptyState.hidden = true;
    elements.results.hidden = false;
    elements.qcIssues.textContent = stats.qcIssues;
    elements.matchedIssues.textContent = stats.matchedIssues;
    elements.affectedShots.textContent = stats.affectedShots;
    elements.matchedVersions.textContent = stats.matchedVersions;
    elements.subcapEntries.textContent = stats.subcapEntries;
    elements.unmatchedIssues.textContent = stats.unmatchedIssues;

    const matchedRows = tableRows.filter((row) => row[2]).slice(0, 150);
    elements.previewBody.innerHTML = matchedRows.map((row) => `
        <tr>
            <td>${escapeHtml(row[0])}</td>
            <td>${escapeHtml(row[2])}</td>
            <td>${escapeHtml(row[3])}</td>
            <td>${escapeHtml(row[4])}</td>
            <td>${escapeHtml(row[7])}</td>
            <td>${escapeHtml(row[11])}</td>
        </tr>
    `).join("");
    elements.previewCount.textContent = `${stats.matchedIssues} matched QC line${stats.matchedIssues === 1 ? "" : "s"}. Showing ${matchedRows.length}.`;
    syncButtons();
}

function resetResult() {
    elements.emptyState.hidden = false;
    elements.results.hidden = true;
    elements.previewBody.innerHTML = "";
    syncButtons();
}

function syncButtons() {
    elements.processButton.disabled = !(state.files.qc && state.files.subcap && state.files.edl);
    const hasResult = Boolean(state.result);
    elements.csvButton.disabled = !hasResult;
    elements.subcapButton.disabled = !hasResult;
    elements.bothButton.disabled = !hasResult;
}

function downloadCsv() {
    if (!state.result?.csv) {
        return;
    }
    const blob = new Blob(["\uFEFF", state.result.csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `${baseName()}_VFX_QC_ENRICHED.csv`);
}

function downloadSubcaps() {
    if (!state.result?.subcapText) {
        return;
    }
    const blob = new Blob([encodeUtf16Le(state.result.subcapText)], { type: "application/octet-stream" });
    downloadBlob(blob, `${baseName()}_VFX_QC_SUBCAPS.txt`);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function baseName() {
    return state.files.qc?.name.replace(/\.(xlsx|csv)$/i, "") || "QC_REPORT";
}

function showStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = `status-message ${type} show`;
}

function hideStatus() {
    elements.status.textContent = "";
    elements.status.className = "status-message";
}

function formatBytes(bytes) {
    const units = ["Bytes", "KB", "MB", "GB"];
    const exponent = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
    const size = bytes / 1024 ** exponent;
    return `${size.toFixed(size >= 100 || exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
