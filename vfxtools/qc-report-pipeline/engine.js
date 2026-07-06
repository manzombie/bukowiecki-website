const DEFAULT_FPS = 24;

const OUTPUT_HEADERS = [
    "Timecode In",
    "Timecode Out",
    "VFX_ID",
    "versions",
    "Description",
    "Duration",
    "A/V/F",
    "Scale",
    "Chan./Sectr",
    "Picture/Audio Content",
    "In Source",
    "Sign-off"
];

const QC_ALIASES = {
    timecodeIn: ["TIMECODE_IN", "TC_IN"],
    timecodeOut: ["TIMECODE_OUT", "TC_OUT"],
    description: ["DESCRIPTION", "ISSUE", "NOTES", "COMMENT"],
    duration: ["DURATION", "LENGTH"],
    avf: ["A_V_F", "AVF", "PICTURE_AUDIO"],
    scale: ["SCALE", "SEVERITY"],
    area: ["CHAN_SECTR", "SECTION", "AREA"],
    content: ["PICTURE_AUDIO_CONTENT", "CONTENT"],
    source: ["IN_SOURCE", "SOURCE"],
    signoff: ["SIGN_OFF", "SIGNOFF"]
};

export function runQcReportPipeline({ qcRows, subcapText, edlText, fps = DEFAULT_FPS }) {
    const base = nominalFps(fps);
    const report = parseQcRows(qcRows, base);
    const shots = parseVfxSubcaps(subcapText, base);
    const versionIndex = buildVersionIndex(edlText);

    if (report.issues.length === 0) {
        throw new Error("No Program Notes rows with Timecode In and Description were found in the QC report.");
    }
    if (shots.length === 0) {
        throw new Error("No VFX shot entries were found in the SubCap export.");
    }
    if (versionIndex.size === 0) {
        throw new Error("No VFX versions were found in the EDL.");
    }

    const enrichedIssues = report.issues.map((issue) => {
        const matchedShots = issue.inFrames === null
            ? []
            : shots.filter((shot) => rangesOverlap(
                shot.inFrames,
                shot.outFrames,
                issue.inFrames,
                issue.matchOutFrames
            ));
        const shotIds = unique(matchedShots.map((shot) => shot.shotId));
        const versions = unique(shotIds.flatMap((shotId) => versionIndex.get(normalizeShotId(shotId)) ?? []));

        return {
            ...issue,
            shotIds,
            versions
        };
    });

    const csvObjects = enrichedIssues.map((issue) => ({
        "Timecode In": issue.timecodeIn,
        "Timecode Out": issue.timecodeOut,
        VFX_ID: issue.shotIds.join(" | "),
        versions: issue.versions.join(" | "),
        Description: issue.description,
        Duration: issue.duration,
        "A/V/F": issue.avf,
        Scale: issue.scale,
        "Chan./Sectr": issue.area,
        "Picture/Audio Content": issue.content,
        "In Source": issue.source,
        "Sign-off": issue.signoff
    }));

    const subcapEntries = buildSubcapEntries(enrichedIssues, base);
    const matchedIssues = enrichedIssues.filter((issue) => issue.shotIds.length > 0);
    const affectedShotIds = unique(matchedIssues.flatMap((issue) => issue.shotIds));
    const matchedVersionNames = unique(matchedIssues.flatMap((issue) => issue.versions));

    return {
        headers: OUTPUT_HEADERS,
        rows: csvObjects,
        tableRows: csvObjects.map((row) => OUTPUT_HEADERS.map((header) => row[header])),
        csv: serializeCsv(OUTPUT_HEADERS, csvObjects),
        subcapText: serializeSubcaps(subcapEntries),
        subcapEntries,
        stats: {
            qcIssues: enrichedIssues.length,
            matchedIssues: matchedIssues.length,
            unmatchedIssues: enrichedIssues.length - matchedIssues.length,
            vfxShots: shots.length,
            affectedShots: affectedShotIds.length,
            edlVersions: [...versionIndex.values()].reduce((count, values) => count + values.length, 0),
            matchedVersions: matchedVersionNames.length,
            subcapEntries: subcapEntries.length
        }
    };
}

export function parseQcRows(rows, fps = DEFAULT_FPS) {
    const base = nominalFps(fps);
    const normalizedRows = Array.isArray(rows) ? rows.map((row) => row.map(cellText)) : [];
    const headerRowIndex = normalizedRows.findIndex((row) => {
        const normalized = row.map(normalizeHeader);
        return normalized.includes("TIMECODE_IN") && normalized.includes("DESCRIPTION");
    });

    if (headerRowIndex === -1) {
        return { headers: [], issues: [], headerRowIndex: -1 };
    }

    const headers = normalizedRows[headerRowIndex];
    const columns = Object.fromEntries(
        Object.entries(QC_ALIASES).map(([key, aliases]) => [
            key,
            headers.findIndex((header) => aliases.includes(normalizeHeader(header)))
        ])
    );

    const issues = normalizedRows.slice(headerRowIndex + 1)
        .map((row, index) => {
            const timecodeIn = getCell(row, columns.timecodeIn);
            const description = getCell(row, columns.description);
            const inFrames = timecodeToFrames(timecodeIn, base);
            if (!description) {
                return null;
            }

            const timecodeOut = getCell(row, columns.timecodeOut);
            const duration = getCell(row, columns.duration);
            const durationFrames = timecodeToFrames(duration, base);
            const explicitOutFrames = timecodeToFrames(timecodeOut, base);
            const cutFrames = inFrames === null
                ? 0
                : durationFrames && durationFrames > 0
                    ? durationFrames
                    : explicitOutFrames !== null && explicitOutFrames > inFrames
                        ? explicitOutFrames - inFrames
                        : 1;

            return {
                sourceRow: headerRowIndex + index + 2,
                timecodeIn,
                timecodeOut,
                description,
                duration,
                avf: getCell(row, columns.avf),
                scale: getCell(row, columns.scale),
                area: getCell(row, columns.area),
                content: getCell(row, columns.content),
                source: getCell(row, columns.source),
                signoff: getCell(row, columns.signoff),
                inFrames,
                cutFrames,
                outFrames: inFrames === null ? null : inFrames + cutFrames,
                subcapEligible: Boolean(
                    inFrames !== null
                    && (
                        (durationFrames && durationFrames > 0)
                        || (explicitOutFrames !== null && explicitOutFrames > inFrames)
                    )
                ),
                matchOutFrames: inFrames === null
                    ? null
                    : explicitOutFrames !== null
                        ? Math.max(inFrames + 1, explicitOutFrames + 1)
                        : durationFrames && durationFrames > 0
                            ? inFrames + durationFrames
                            : inFrames + 1
            };
        })
        .filter(Boolean);

    return { headers, issues, headerRowIndex };
}

export function parseVfxSubcaps(text, fps = DEFAULT_FPS) {
    const base = nominalFps(fps);
    const normalized = String(text ?? "")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
    const lines = normalized.split("\n");
    const shots = [];

    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].trim().match(/^(\d{2,3}:\d{2}:\d{2}:\d{2})\s+(\d{2,3}:\d{2}:\d{2}:\d{2})$/);
        if (!match) {
            continue;
        }

        let textIndex = index + 1;
        while (textIndex < lines.length && !lines[textIndex].trim()) {
            textIndex += 1;
        }
        const shotId = lines[textIndex]?.trim();
        const rawInFrames = timecodeToFrames(match[1], base);
        const rawOutFrames = timecodeToFrames(match[2], base);
        if (!shotId || rawInFrames === null || rawOutFrames === null || rawOutFrames <= rawInFrames) {
            continue;
        }

        const oneHour = base * 60 * 60;
        shots.push({
            shotId,
            sourceIn: match[1],
            sourceOut: match[2],
            inFrames: rawInFrames >= oneHour ? rawInFrames - oneHour : rawInFrames,
            outFrames: rawOutFrames >= oneHour ? rawOutFrames - oneHour : rawOutFrames
        });
    }

    return shots.sort((left, right) => left.inFrames - right.inFrames);
}

export function buildVersionIndex(edlText) {
    const candidates = [];
    const clipPattern = /^\*\s*(?:FROM|TO) CLIP NAME:\s*(.+?)\s*$/gmi;
    let match;

    while ((match = clipPattern.exec(String(edlText ?? ""))) !== null) {
        candidates.push(cleanVersionName(match[1]));
    }

    const eventPattern = /^\d+\s+(\S+_comp_\S+_v\d+\S*)\s+V\s+/gmi;
    while ((match = eventPattern.exec(String(edlText ?? ""))) !== null) {
        candidates.push(cleanVersionName(match[1]));
    }

    const index = new Map();
    for (const version of unique(candidates)) {
        const shotId = extractShotId(version);
        if (!shotId) {
            continue;
        }

        const key = normalizeShotId(shotId);
        const versions = index.get(key) ?? [];
        versions.push(version);
        index.set(key, unique(versions));
    }
    return index;
}

export function extractShotId(versionName) {
    const match = cleanVersionName(versionName).match(/^(.+?)_comp_.+?_v\d+(?:\b|_)/i);
    return match ? match[1] : null;
}

export function buildSubcapEntries(enrichedIssues, fps = DEFAULT_FPS) {
    const base = nominalFps(fps);
    const grouped = new Map();

    for (const issue of enrichedIssues.filter((item) => item.shotIds.length > 0 && item.subcapEligible)) {
        const existing = grouped.get(issue.inFrames);
        if (!existing) {
            grouped.set(issue.inFrames, {
                inFrames: issue.inFrames,
                outFrames: issue.outFrames,
                descriptions: [issue.description],
                shotIds: [...issue.shotIds],
                versions: [...issue.versions]
            });
            continue;
        }

        existing.outFrames = Math.max(existing.outFrames, issue.outFrames);
        existing.descriptions = unique([...existing.descriptions, issue.description]);
        existing.shotIds = unique([...existing.shotIds, ...issue.shotIds]);
        existing.versions = unique([...existing.versions, ...issue.versions]);
    }

    const entries = [...grouped.values()].sort((left, right) => left.inFrames - right.inFrames);
    for (let index = 0; index < entries.length - 1; index += 1) {
        entries[index].outFrames = Math.min(entries[index].outFrames, entries[index + 1].inFrames);
        if (entries[index].outFrames <= entries[index].inFrames) {
            entries[index].outFrames = entries[index].inFrames + 1;
        }
    }

    return entries.map((entry) => ({
        ...entry,
        timecodeIn: framesToTimecode(entry.inFrames, base),
        timecodeOut: framesToTimecode(entry.outFrames, base),
        text: entry.descriptions.join(" | ")
    }));
}

export function serializeSubcaps(entries) {
    const lineBreak = "\r\n";
    const lines = [
        "@ This file written with the Avid Caption plugin, version 1",
        "",
        "<begin subtitles>"
    ];

    for (const entry of entries) {
        lines.push(`${entry.timecodeIn} ${entry.timecodeOut}`);
        lines.push(entry.text);
        lines.push("");
    }
    lines.push("<end subtitles>");
    return `${lines.join(lineBreak)}${lineBreak}`;
}

export function encodeUtf16Le(text) {
    const buffer = new ArrayBuffer(2 + text.length * 2);
    const bytes = new Uint8Array(buffer);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        bytes[2 + index * 2] = code & 0xff;
        bytes[3 + index * 2] = code >> 8;
    }
    return buffer;
}

export function timecodeToFrames(timecode, fps = DEFAULT_FPS) {
    const base = nominalFps(fps);
    const match = String(timecode ?? "").trim().match(/^(\d{1,3}):(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
        return null;
    }
    const [, hours, minutes, seconds, frames] = match.map(Number);
    if (minutes > 59 || seconds > 59 || frames >= base) {
        return null;
    }
    return (((hours * 60 + minutes) * 60) + seconds) * base + frames;
}

export function framesToTimecode(totalFrames, fps = DEFAULT_FPS) {
    const base = nominalFps(fps);
    const safe = Math.max(0, Math.floor(totalFrames));
    const frames = safe % base;
    const totalSeconds = Math.floor(safe / base);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    return [hours, minutes, seconds, frames].map((part) => String(part).padStart(2, "0")).join(":");
}

export function parseCsvRows(text) {
    const normalized = String(text ?? "")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let index = 0; index < normalized.length; index += 1) {
        const char = normalized[index];
        const next = normalized[index + 1];
        if (char === "\"") {
            if (inQuotes && next === "\"") {
                value += "\"";
                index += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (char === "," && !inQuotes) {
            row.push(value);
            value = "";
            continue;
        }
        if (char === "\n" && !inQuotes) {
            row.push(value);
            rows.push(row);
            row = [];
            value = "";
            continue;
        }
        value += char;
    }
    if (value.length > 0 || row.length > 0) {
        row.push(value);
        rows.push(row);
    }
    return rows;
}

function serializeCsv(headers, rows) {
    const lines = [headers.map(escapeCsvValue).join(",")];
    for (const row of rows) {
        lines.push(headers.map((header) => escapeCsvValue(row[header])).join(","));
    }
    return `${lines.join("\r\n")}\r\n`;
}

function cleanVersionName(value) {
    return String(value ?? "")
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/\.\[\d+-\d+\]\.[A-Z0-9]+$/i, "")
        .replace(/\.(?:MOV|MXF|EXR|DPX|TIF|TIFF)$/i, "");
}

function normalizeShotId(value) {
    return String(value ?? "").trim().toUpperCase();
}

function normalizeHeader(value) {
    return cellText(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function getCell(row, index) {
    return index >= 0 ? cellText(row[index]) : "";
}

function cellText(value) {
    // Strip control / line-separator chars (e.g. in-cell line breaks from XLSX or
    // FileMaker exports use vertical tab U+000B, which Avid renders as a box).
    // Replace any run with a single space so subcap + CSV text stays clean.
    return String(value ?? "")
        .replace(/[\u0000-\u001F\u0085\u2028\u2029]+/g, " ")
        .trim();
}

function rangesOverlap(leftIn, leftOut, rightIn, rightOut) {
    return leftIn < rightOut && rightIn < leftOut;
}

function nominalFps(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : DEFAULT_FPS;
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function escapeCsvValue(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}
