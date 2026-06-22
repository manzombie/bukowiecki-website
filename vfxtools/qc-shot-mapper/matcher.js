import { findHeader, normalizeHeader, parseCSV } from "../editorial-converter/core/csv.js";

const DEFAULT_FPS = 24;
const SHOT_TC_OFFSET_FRAMES = DEFAULT_FPS * 60 * 60;

const SHOT_ID_HEADERS = ["ShotID", "Shot ID", "SHOT_ID", "VFX_ID", "VFX ID"];
const SHOT_IN_HEADERS = ["ReelTC_in", "Reel TC In", "TC In", "Timecode In", "In"];
const SHOT_OUT_HEADERS = ["ReelTC_out", "Reel TC Out", "TC Out", "Timecode Out", "Out"];

// ─── Main export ────────────────────────────────────────────────────────────

export function enrichQcCsv(shotCsvText, qcCsvText, options = {}) {
    const fps = Number(options.fps) || DEFAULT_FPS;
    const shotOffset = Math.round(fps * 60 * 60);
    const rawShots = parseShotList(shotCsvText, { fps, shotOffset: 0 });

    if (rawShots.length === 0) {
        throw new Error("No shots found. The shot CSV needs ShotID, ReelTC_in, and ReelTC_out columns.");
    }

    // Parse QC as raw rows (arrays of strings, structure fully preserved)
    const rawRows = parseRawRows(qcCsvText);

    if (rawRows.length === 0) {
        throw new Error("QC CSV appears to be empty.");
    }

    // Find the header row (row containing "Timecode In")
    const headerRowIndex = findHeaderRowIndex(rawRows);

    if (headerRowIndex === -1) {
        throw new Error("No header row found in QC CSV. Expected a row containing 'Timecode In'.");
    }

    const headerRow = rawRows[headerRowIndex];
    const tcInCol  = findColIndex(headerRow, ["timecode in", "tc in"]);
    const tcOutCol = findColIndex(headerRow, ["timecode out", "tc out"]);

    if (tcInCol === -1) {
        throw new Error("Could not find a 'Timecode In' column in the QC CSV header.");
    }

    const qcRanges = getQcRanges(rawRows, headerRowIndex, tcInCol, tcOutCol, fps);
    const timeline = chooseShotTimeline(rawShots, qcRanges, shotOffset);
    const shots = timeline.shots;

    // SHOT_ID is inserted at column index 2 (after Timecode In, Timecode Out)
    const INSERT_INDEX = 2;

    let matchedCount = 0;
    let unmatchedCount = 0;
    const affectedShotIds = new Set();
    const previewRows = []; // data rows only, for the UI table

    const enrichedRaws = rawRows.map((row, rowIndex) => {
        const enriched = [...row];

        // Header row
        if (rowIndex === headerRowIndex) {
            enriched.splice(INSERT_INDEX, 0, "SHOT_ID");
            return enriched;
        }

        // Pre-header metadata rows (e.g. HDR info line)
        if (rowIndex < headerRowIndex) {
            enriched.splice(INSERT_INDEX, 0, "");
            return enriched;
        }

        // Data rows
        const inTc     = (row[tcInCol]  ?? "").trim();
        const outTc    = tcOutCol >= 0 ? (row[tcOutCol] ?? "").trim() : "";
        const inFrames = timecodeToFrames(inTc, fps);

        if (inFrames === null) {
            // Row has no valid TC (blank spacer, note-only row, etc.)
            enriched.splice(INSERT_INDEX, 0, "");
            return enriched;
        }

        const explicitOut = outTc ? timecodeToFrames(outTc, fps) : null;
        const outFrames   = explicitOut !== null ? Math.max(explicitOut + 1, inFrames + 1) : inFrames + 1;

        const matched = shots.filter(s => s.inFrames < outFrames && inFrames < s.outFrames);

        if (matched.length > 0) {
            matchedCount++;
            matched.forEach(s => affectedShotIds.add(s.shotId));
        } else {
            unmatchedCount++;
        }

        const shotId = matched.map(s => s.shotId).join(" | ");
        enriched.splice(INSERT_INDEX, 0, shotId);
        previewRows.push(enriched);

        return enriched;
    });

    // Serialise back to CSV
    const csv = enrichedRaws.map(row => row.map(serializeCell).join(",")).join("\n");

    // Trimmed headers for the UI
    const headers = enrichedRaws[headerRowIndex].map(h => h.trim());

    return {
        csv,
        headers,
        rows: previewRows,
        downloadName: "qc_with_shot_ids.csv",
        summary: `${affectedShotIds.size} affected shot${affectedShotIds.size === 1 ? "" : "s"} across ${matchedCount + unmatchedCount} QC issues.`,
        stats: {
            shotCount:        shots.length,
            issueCount:       matchedCount + unmatchedCount,
            matchedCount,
            unmatchedCount,
            affectedShotCount: affectedShotIds.size
        },
        warnings: unmatchedCount > 0
            ? [`${unmatchedCount} QC issue${unmatchedCount === 1 ? "" : "s"} had no matching shot.`]
            : []
    };
}

// ─── Shot list parser ────────────────────────────────────────────────────────

export function parseShotList(text, options = {}) {
    const fps        = Number(options.fps) || DEFAULT_FPS;
    const shotOffset = Number.isFinite(Number(options.shotOffset)) ? Number(options.shotOffset) : SHOT_TC_OFFSET_FRAMES;
    const parsed     = parseCSV(text);
    const shotIdHeader = findHeader(parsed.headers, SHOT_ID_HEADERS);
    const inHeader     = findHeader(parsed.headers, SHOT_IN_HEADERS);
    const outHeader    = findHeader(parsed.headers, SHOT_OUT_HEADERS);

    if (!shotIdHeader || !inHeader || !outHeader) {
        return [];
    }

    return parsed.rows
        .map((row, index) => {
            const shotId       = row[shotIdHeader];
            const inTc         = row[inHeader];
            const outTc        = row[outHeader];
            const rawInFrames  = timecodeToFrames(inTc, fps);
            const rawOutFrames = timecodeToFrames(outTc, fps);

            if (!shotId || rawInFrames === null || rawOutFrames === null) {
                return null;
            }

            return {
                shotId,
                inTc,
                outTc,
                rawInFrames,
                rawOutFrames,
                inFrames:   rawInFrames  >= shotOffset ? rawInFrames  - shotOffset : rawInFrames,
                outFrames:  rawOutFrames >= shotOffset ? rawOutFrames - shotOffset : rawOutFrames,
                sourceRow:  index + 2
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.inFrames - b.inFrames);
}

function getQcRanges(rawRows, headerRowIndex, tcInCol, tcOutCol, fps) {
    const ranges = [];
    for (let rowIndex = headerRowIndex + 1; rowIndex < rawRows.length; rowIndex += 1) {
        const row = rawRows[rowIndex];
        const inTc = (row[tcInCol] ?? "").trim();
        const outTc = tcOutCol >= 0 ? (row[tcOutCol] ?? "").trim() : "";
        const inFrames = timecodeToFrames(inTc, fps);

        if (inFrames === null) continue;

        const explicitOut = outTc ? timecodeToFrames(outTc, fps) : null;
        const outFrames = explicitOut !== null ? Math.max(explicitOut + 1, inFrames + 1) : inFrames + 1;
        ranges.push({ inFrames, outFrames });
    }
    return ranges;
}

function chooseShotTimeline(rawShots, qcRanges, shotOffset) {
    const candidates = [
        { mode: "same timeline", offset: 0 },
        { mode: "subtract one hour", offset: shotOffset }
    ].map(candidate => {
        const shots = applyShotOffset(rawShots, candidate.offset);
        return {
            ...candidate,
            shots,
            score: scoreTimeline(shots, qcRanges)
        };
    });

    return candidates.sort((a, b) => b.score - a.score || a.offset - b.offset)[0];
}

function applyShotOffset(shots, shotOffset) {
    return shots
        .map(shot => ({
            ...shot,
            inFrames: shot.rawInFrames >= shotOffset ? shot.rawInFrames - shotOffset : shot.rawInFrames,
            outFrames: shot.rawOutFrames >= shotOffset ? shot.rawOutFrames - shotOffset : shot.rawOutFrames
        }))
        .sort((a, b) => a.inFrames - b.inFrames);
}

function scoreTimeline(shots, qcRanges) {
    return qcRanges.reduce((score, range) => {
        return score + (shots.some(s => s.inFrames < range.outFrames && range.inFrames < s.outFrames) ? 1 : 0);
    }, 0);
}

// ─── Timecode utilities ──────────────────────────────────────────────────────

export function timecodeToFrames(timecode, fps = DEFAULT_FPS) {
    const match = String(timecode ?? "").trim().match(/^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, hours, minutes, seconds, frames] = match.map(Number);
    if (minutes > 59 || seconds > 59 || frames >= fps) return null;
    return (((hours * 60 + minutes) * 60) + seconds) * fps + frames;
}

export function framesToTimecode(totalFrames, fps = DEFAULT_FPS) {
    const frames       = Math.max(0, Math.floor(totalFrames));
    const frame        = frames % fps;
    const totalSeconds = Math.floor(frames / fps);
    const seconds      = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes      = totalMinutes % 60;
    const hours        = Math.floor(totalMinutes / 60);
    return [hours, minutes, seconds, frame].map(v => String(v).padStart(2, "0")).join(":");
}

// ─── Raw CSV parsing ─────────────────────────────────────────────────────────

function parseRawRows(text) {
    const normalized = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rows = [];
    let row = [], value = "", inQuotes = false;

    for (let i = 0; i < normalized.length; i++) {
        const c = normalized[i], n = normalized[i + 1];

        if (c === '"') {
            if (inQuotes && n === '"') { value += '"'; i++; }
            else { inQuotes = !inQuotes; }
            continue;
        }
        if (c === ',' && !inQuotes) { row.push(value); value = ""; continue; }
        if (c === '\n' && !inQuotes) { row.push(value); rows.push(row); row = []; value = ""; continue; }
        value += c;
    }
    if (value || row.length) { row.push(value); rows.push(row); }

    return rows;
}

function findHeaderRowIndex(rows) {
    const keywords = ["timecode in", "tc in"];
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
        if (rows[i].some(cell => keywords.includes(cell.toLowerCase().trim()))) {
            return i;
        }
    }
    return -1;
}

function findColIndex(headerRow, keywords) {
    return headerRow.findIndex(h => keywords.includes(h.toLowerCase().trim()));
}

function serializeCell(v) {
    const s = String(v ?? "");
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─── Legacy helpers (used by parseShotList via parseCSV) ─────────────────────

function parseCsvWithDetectedHeader(text, requiredHeaders) {
    const normalizedRequired = requiredHeaders.map(normalizeHeader);
    const raw = parseCSV(text);

    if (hasRequiredHeaders(raw.headers, normalizedRequired)) {
        return { ...raw, headerRowIndex: 0 };
    }

    const lines = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    for (let index = 0; index < Math.min(lines.length, 20); index += 1) {
        const candidate = parseCSV(lines.slice(index).join("\n"));
        if (hasRequiredHeaders(candidate.headers, normalizedRequired)) {
            return { ...candidate, headerRowIndex: index };
        }
    }

    return { ...raw, headerRowIndex: 0 };
}

function hasRequiredHeaders(headers, normalizedRequired) {
    const normalizedHeaders = new Set(headers.map(normalizeHeader));
    return normalizedRequired.every(h => normalizedHeaders.has(h));
}
