import { MODES, getMode } from "./core/registry.js";
import { formatBytes } from "./core/file.js";

const state = {
    modeId: MODES[0].id,
    files: {},
    result: null
};

const elements = {
    modeList: document.getElementById("modeList"),
    modeKicker: document.getElementById("modeKicker"),
    modeTitle: document.getElementById("modeTitle"),
    modeDescription: document.getElementById("modeDescription"),
    dropzoneGrid: document.getElementById("dropzoneGrid"),
    processButton: document.getElementById("processButton"),
    statusMessage: document.getElementById("statusMessage"),
    resultSummary: document.getElementById("resultSummary"),
    warningBox: document.getElementById("warningBox"),
    emptyState: document.getElementById("emptyState"),
    previewMeta: document.getElementById("previewMeta"),
    tableWrap: document.getElementById("tableWrap"),
    previewTable: document.getElementById("previewTable"),
    downloadButton: document.getElementById("downloadButton")
};

init();

function init() {
    renderModes();
    renderModeWorkspace();
    bindEvents();
}

function bindEvents() {
    elements.processButton.addEventListener("click", processCurrentMode);
    elements.downloadButton.addEventListener("click", downloadResult);
}

function renderModes() {
    elements.modeList.innerHTML = "";

    for (const mode of MODES) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `mode-button${mode.id === state.modeId ? " active" : ""}`;
        button.innerHTML = `<strong>${mode.title}</strong><span>${mode.description}</span>`;
        button.addEventListener("click", () => {
            state.modeId = mode.id;
            state.files = {};
            state.result = null;
            renderModes();
            renderModeWorkspace();
            resetPreview();
            hideStatus();
        });
        elements.modeList.appendChild(button);
    }
}

function renderModeWorkspace() {
    const mode = getMode(state.modeId);
    elements.modeKicker.textContent = mode.kicker;
    elements.modeTitle.textContent = mode.title;
    elements.modeDescription.textContent = mode.description;
    elements.dropzoneGrid.innerHTML = "";

    for (const fileConfig of mode.files) {
        elements.dropzoneGrid.appendChild(createDropzone(fileConfig));
    }

    syncProcessButtonState();
}

function createDropzone(fileConfig) {
    const wrapper = document.createElement("label");
    wrapper.className = "dropzone";
    wrapper.dataset.fileId = fileConfig.id;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = fileConfig.accept;

    const selectedFile = state.files[fileConfig.id];
    const fileBadge = selectedFile
        ? `<div class="file-pill">Loaded</div>`
        : `<div class="dropzone-help">Drag and drop or click to browse</div>`;
    const footerMeta = selectedFile
        ? `<div class="file-meta">${escapeHtml(selectedFile.name)}<br>${formatBytes(selectedFile.size)}</div>`
        : `<div class="file-meta">${fileConfig.accept.replaceAll(",", " · ")}</div>`;

    wrapper.innerHTML = `
        <div class="dropzone-top">
            <div class="dropzone-label">
                <strong>${fileConfig.label}</strong>
                <p>${fileConfig.help}</p>
            </div>
            <div class="dropzone-glyph">${selectedFile ? "✓" : "↓"}</div>
        </div>
        <div class="dropzone-footer">
            ${fileBadge}
            ${footerMeta}
        </div>
    `;
    wrapper.appendChild(input);

    wrapper.addEventListener("dragover", (event) => {
        event.preventDefault();
        wrapper.classList.add("dragover");
    });

    wrapper.addEventListener("dragleave", () => {
        wrapper.classList.remove("dragover");
    });

    wrapper.addEventListener("drop", (event) => {
        event.preventDefault();
        wrapper.classList.remove("dragover");
        const [file] = event.dataTransfer.files;
        if (file) {
            setFile(fileConfig.id, file);
        }
    });

    input.addEventListener("change", (event) => {
        const [file] = event.target.files;
        if (file) {
            setFile(fileConfig.id, file);
        }
    });

    return wrapper;
}

function setFile(fileId, file) {
    state.files[fileId] = file;
    state.result = null;
    renderModeWorkspace();
    resetPreview();
    hideStatus();
}

async function processCurrentMode() {
    const mode = getMode(state.modeId);
    elements.processButton.disabled = true;
    showStatus("Processing files in your browser...", "success");

    try {
        const result = await mode.process(state.files);
        state.result = result;
        renderResult(result);
        showStatus("Preview ready. Download when you’re happy with it.", "success");
    } catch (error) {
        state.result = null;
        resetPreview();
        showStatus(error.message || "Something went wrong while processing the files.", "error");
    } finally {
        elements.processButton.disabled = false;
    }
}

function syncProcessButtonState() {
    const mode = getMode(state.modeId);
    const hasAllFiles = mode.files.every((fileConfig) => Boolean(state.files[fileConfig.id]));
    elements.processButton.disabled = !hasAllFiles;
}

function renderResult(result) {
    const previewCount = Math.min(result.rows.length, 20);
    const previewRows = result.rows.slice(0, previewCount);

    elements.emptyState.hidden = true;
    elements.tableWrap.hidden = false;
    elements.previewMeta.hidden = false;
    elements.downloadButton.disabled = !result.csv;
    elements.resultSummary.textContent = result.summary;
    elements.previewMeta.textContent = `${result.rows.length} row${result.rows.length === 1 ? "" : "s"} total. Showing first ${previewCount}.`;

    if (result.warnings?.length) {
        elements.warningBox.hidden = false;
        elements.warningBox.textContent = result.warnings.slice(0, 5).join(" ");
    } else {
        elements.warningBox.hidden = true;
        elements.warningBox.textContent = "";
    }

    const headRow = `<tr>${result.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`;
    const bodyRows = previewRows.map((row) => `
        <tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>
    `).join("");

    elements.previewTable.innerHTML = `
        <thead>${headRow}</thead>
        <tbody>${bodyRows}</tbody>
    `;
}

function resetPreview() {
    elements.resultSummary.textContent = "Load files to see the parsed output.";
    elements.previewTable.innerHTML = "";
    elements.previewMeta.hidden = true;
    elements.previewMeta.textContent = "";
    elements.warningBox.hidden = true;
    elements.warningBox.textContent = "";
    elements.tableWrap.hidden = true;
    elements.emptyState.hidden = false;
    elements.downloadButton.disabled = true;
}

function downloadResult() {
    if (!state.result?.csv) {
        return;
    }

    const blob = new Blob(["\uFEFF", state.result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = state.result.downloadName || "editorial-converter.csv";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function showStatus(message, type) {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = `status-message ${type} show`;
}

function hideStatus() {
    elements.statusMessage.className = "status-message";
    elements.statusMessage.textContent = "";
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
