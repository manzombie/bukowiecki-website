import { readTextFile } from "../editorial-converter/core/file.js";
import {
    analyzeBeautyFiles,
    buildCharacterZip,
    encodeUtf16Le,
    generateBeautyOutputs
} from "./engine.js?v=4";

const COLOR_PALETTE = [
    "#E4572E", "#17A65B", "#3B82F6", "#A855F7", "#EAB308",
    "#EC4899", "#14B8A6", "#F97316", "#64748B", "#EF4444"
];
const SYMBOL_PALETTE = ["•", "◆", "■", "▲", "★", "●", "+", "×", "◉", "▣"];

const state = {
    files: {},
    analysis: null,
    output: null
};

const elements = {
    csvInput: document.getElementById("csvInput"),
    subcapInput: document.getElementById("subcapInput"),
    csvDropzone: document.getElementById("csvDropzone"),
    subcapDropzone: document.getElementById("subcapDropzone"),
    csvMeta: document.getElementById("csvMeta"),
    subcapMeta: document.getElementById("subcapMeta"),
    analyzeButton: document.getElementById("analyzeButton"),
    status: document.getElementById("status"),
    controls: document.getElementById("controls"),
    characterList: document.getElementById("characterList"),
    customCharacter: document.getElementById("customCharacter"),
    addCharacter: document.getElementById("addCharacter"),
    selectAll: document.getElementById("selectAll"),
    selectNone: document.getElementById("selectNone"),
    includeVendor: document.getElementById("includeVendor"),
    includeCharacters: document.getElementById("includeCharacters"),
    includeWork: document.getElementById("includeWork"),
    includeUnassigned: document.getElementById("includeUnassigned"),
    unassignedMarker: document.getElementById("unassignedMarker"),
    unassignedColor: document.getElementById("unassignedColor"),
    characterDisplay: document.getElementById("characterDisplay"),
    separator: document.getElementById("separator"),
    emptyState: document.getElementById("emptyState"),
    results: document.getElementById("results"),
    sourceRows: document.getElementById("sourceRows"),
    matchedRows: document.getElementById("matchedRows"),
    detectedCharacters: document.getElementById("detectedCharacters"),
    generatedEntries: document.getElementById("generatedEntries"),
    skippedEntries: document.getElementById("skippedEntries"),
    previewBody: document.getElementById("previewBody"),
    previewCount: document.getElementById("previewCount"),
    downloadSubcaps: document.getElementById("downloadSubcaps"),
    downloadZip: document.getElementById("downloadZip"),
    downloadCsv: document.getElementById("downloadCsv")
};

init();

function init() {
    setupFileInput("csv", elements.csvInput, elements.csvDropzone, elements.csvMeta);
    setupFileInput("subcap", elements.subcapInput, elements.subcapDropzone, elements.subcapMeta);
    elements.analyzeButton.addEventListener("click", analyzeFiles);
    elements.addCharacter.addEventListener("click", addCustomCharacter);
    elements.customCharacter.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            addCustomCharacter();
        }
    });
    elements.selectAll.addEventListener("click", () => setAllCharacters(true));
    elements.selectNone.addEventListener("click", () => setAllCharacters(false));
    [
        elements.includeVendor,
        elements.includeCharacters,
        elements.includeWork,
        elements.includeUnassigned,
        elements.unassignedMarker,
        elements.unassignedColor,
        elements.characterDisplay,
        elements.separator
    ]
        .forEach((control) => control.addEventListener("change", regenerateOutput));
    elements.downloadSubcaps.addEventListener("click", downloadSubcapFile);
    elements.downloadZip.addEventListener("click", downloadCharacterZip);
    elements.downloadCsv.addEventListener("click", downloadAuditCsv);
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
    state.analysis = null;
    state.output = null;
    meta.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span>`;
    resetResults();
    hideStatus();
    elements.analyzeButton.disabled = !(state.files.csv && state.files.subcap);
}

async function analyzeFiles() {
    elements.analyzeButton.disabled = true;
    showStatus("Matching beauty shots and detecting character candidates...", "success");
    try {
        const [csvText, subcapText] = await Promise.all([
            readTextFile(state.files.csv),
            readTextFile(state.files.subcap)
        ]);
        state.analysis = analyzeBeautyFiles(csvText, subcapText);
        renderCharacterSuggestions();
        elements.controls.hidden = false;
        regenerateOutput();
        const { matchedRows, sourceRows } = state.analysis.stats;
        showStatus(`Matched ${matchedRows} of ${sourceRows} beauty rows to episode shots.`, "success");
    } catch (error) {
        state.analysis = null;
        state.output = null;
        resetResults();
        showStatus(error.message || "Could not analyze those files.", "error");
    } finally {
        elements.analyzeButton.disabled = !(state.files.csv && state.files.subcap);
    }
}

function renderCharacterSuggestions() {
    elements.characterList.innerHTML = "";
    state.analysis.suggestions.forEach((suggestion, index) => {
        elements.characterList.appendChild(createCharacterOption(
            suggestion.name,
            suggestion.count,
            `${suggestion.count} shots, ${suggestion.mentions} mentions. ${suggestion.samples[0] || ""}`,
            suggestion.defaultSelected,
            index
        ));
    });
}

function createCharacterOption(name, count = 0, sample = "", checked = true, index = 0) {
    const wrapper = document.createElement("div");
    wrapper.className = "character-option";
    wrapper.title = sample;
    wrapper.innerHTML = `
        <input class="character-enabled" type="checkbox" value="${escapeHtml(name)}" ${checked ? "checked" : ""}>
        <span class="character-name">${escapeHtml(name)}</span>
        <span class="character-count">${count || "custom"}</span>
        <input class="character-color" type="color" value="${COLOR_PALETTE[index % COLOR_PALETTE.length]}" title="Track colour for ${escapeHtml(name)}">
        <select class="character-symbol" title="Marker for ${escapeHtml(name)}">
            ${SYMBOL_PALETTE.map((symbol, symbolIndex) => `<option value="${symbol}" ${symbolIndex === index % SYMBOL_PALETTE.length ? "selected" : ""}>${symbol}</option>`).join("")}
        </select>
    `;
    wrapper.querySelectorAll("input, select").forEach((control) => control.addEventListener("change", regenerateOutput));
    return wrapper;
}

function addCustomCharacter() {
    const names = elements.customCharacter.value
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
    if (!names.length) {
        return;
    }

    const existing = new Set(getCharacterOptions().map((option) => option.value.toLowerCase()));
    for (const name of names) {
        if (!existing.has(name.toLowerCase())) {
            elements.characterList.appendChild(createCharacterOption(
                name,
                0,
                "Custom character",
                true,
                getCharacterOptions().length
            ));
            existing.add(name.toLowerCase());
        }
    }
    elements.customCharacter.value = "";
    regenerateOutput();
}

function setAllCharacters(checked) {
    for (const option of getCharacterOptions()) {
        option.checked = checked;
    }
    regenerateOutput();
}

function regenerateOutput() {
    if (!state.analysis) {
        return;
    }

    try {
        state.output = generateBeautyOutputs(state.analysis, {
            includeVendor: elements.includeVendor.checked,
            includeCharacters: elements.includeCharacters.checked,
            includeWork: elements.includeWork.checked,
            includeUnassigned: elements.includeUnassigned.checked,
            unassignedLabel: elements.unassignedMarker.value,
            selectedCharacters: getCharacterOptions().filter((option) => option.checked).map((option) => option.value),
            characterLabels: characterLabels(),
            separator: separatorValue()
        });
        renderOutput();
        hideStatus();
    } catch (error) {
        state.output = null;
        elements.downloadSubcaps.disabled = true;
        elements.downloadCsv.disabled = true;
        showStatus(error.message, "error");
    }
}

function renderOutput() {
    const analysisStats = state.analysis.stats;
    const outputStats = state.output.stats;
    elements.emptyState.hidden = true;
    elements.results.hidden = false;
    elements.sourceRows.textContent = analysisStats.sourceRows;
    elements.matchedRows.textContent = analysisStats.matchedRows;
    elements.detectedCharacters.textContent = getCharacterOptions().filter((option) => option.checked).length;
    elements.generatedEntries.textContent = outputStats.includedEntries;
    elements.skippedEntries.textContent = outputStats.skippedEntries;
    elements.downloadSubcaps.disabled = outputStats.includedEntries === 0;
    elements.downloadZip.disabled = getCharacterConfigs().length === 0 && !elements.includeUnassigned.checked;
    elements.downloadCsv.disabled = false;

    const previewRows = state.output.auditRows.filter((row) => row.Status === "Included").slice(0, 150);
    elements.previewBody.innerHTML = previewRows.map((row) => `
        <tr>
            <td>${escapeHtml(row["TC IN"])}</td>
            <td>${escapeHtml(row.SHOT_ID)}</td>
            <td>${escapeHtml(row.Vendor)}</td>
            <td>${renderCharacterNames(row.Characters)}</td>
            <td>${escapeHtml(row["SubCap Text"])}</td>
        </tr>
    `).join("");
    elements.previewCount.textContent = `${outputStats.includedEntries} SubCap entr${outputStats.includedEntries === 1 ? "y" : "ies"}. Showing ${previewRows.length}.`;
}

function getCharacterOptions() {
    return [...elements.characterList.querySelectorAll(".character-enabled")];
}

function getCharacterConfigs() {
    return [...elements.characterList.querySelectorAll(".character-option")]
        .map((option) => ({
            enabled: option.querySelector(".character-enabled").checked,
            name: option.querySelector(".character-enabled").value,
            color: option.querySelector(".character-color").value,
            symbol: option.querySelector(".character-symbol").value
        }))
        .filter((config) => config.enabled);
}

function characterLabels() {
    if (elements.characterDisplay.value !== "symbol") {
        return {};
    }
    return Object.fromEntries(getCharacterConfigs().map((config) => [config.name, config.symbol]));
}

function renderCharacterNames(value) {
    const configs = new Map([
        ...getCharacterConfigs().map((config) => [config.name.toLowerCase(), config]),
        ["unassigned", unassignedConfig()]
    ]);
    return String(value ?? "")
        .split(/\s*\|\s*/)
        .filter(Boolean)
        .map((name) => {
            const config = configs.get(name.toLowerCase());
            const label = name === "Unassigned"
                ? config?.symbol || "X"
                : elements.characterDisplay.value === "symbol"
                    ? config?.symbol || name
                    : name;
            const color = config?.color || "#17A65B";
            return `<span class="character-preview" style="color:${color}">${escapeHtml(label)}</span>`;
        })
        .join(" ");
}

function separatorValue() {
    const value = elements.separator.value;
    if (value === "line") {
        return "\n";
    }
    if (value === "dash") {
        return " - ";
    }
    return " | ";
}

function resetResults() {
    elements.controls.hidden = true;
    elements.emptyState.hidden = false;
    elements.results.hidden = true;
    elements.characterList.innerHTML = "";
    elements.previewBody.innerHTML = "";
    elements.downloadSubcaps.disabled = true;
    elements.downloadZip.disabled = true;
    elements.downloadCsv.disabled = true;
}

function downloadSubcapFile() {
    if (!state.output?.subcapText) {
        return;
    }
    const blob = new Blob([encodeUtf16Le(state.output.subcapText)], { type: "application/octet-stream" });
    downloadBlob(blob, `${baseName()}_BEAUTY_SUBCAPS.txt`);
}

function downloadAuditCsv() {
    if (!state.output?.auditCsv) {
        return;
    }
    const blob = new Blob(["\uFEFF", state.output.auditCsv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `${baseName()}_BEAUTY_AUDIT.csv`);
}

function downloadCharacterZip() {
    if (!state.analysis) {
        return;
    }
    try {
        const result = buildCharacterZip(state.analysis, {
            characterConfigs: getCharacterConfigs(),
            useSymbols: elements.characterDisplay.value === "symbol",
            includeVendor: elements.includeVendor.checked,
            includeWork: elements.includeWork.checked,
            includeUnassigned: elements.includeUnassigned.checked,
            unassignedConfig: unassignedConfig(),
            separator: separatorValue()
        });
        const blob = new Blob([result.zip], { type: "application/zip" });
        downloadBlob(blob, `${baseName()}_CHARACTER_TRACKS.zip`);
    } catch (error) {
        showStatus(error.message, "error");
    }
}

function unassignedConfig() {
    return {
        name: "Unassigned",
        color: elements.unassignedColor.value,
        symbol: elements.unassignedMarker.value.trim() || "X"
    };
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
    return state.files.csv?.name.replace(/\.csv$/i, "") || "BEAUTY_WORK";
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
