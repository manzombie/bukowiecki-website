import { parseCSV, serializeCSV } from "../editorial-converter/core/csv.js";

const SHOT_HEADERS = ["VFX Shot Name", "VFX Shot", "SHOT_ID", "Shot ID"];
const TASK_HEADERS = ["VFX Elements/Tasks", "VFX Elements", "Tasks", "Work Callout"];

const CHARACTER_STOP_WORDS = new Set([
    "Add", "Age", "Arrow", "Backing", "Beauty", "Behind", "Black", "Bluescreen",
    "Boom", "Brief", "Camera", "Check", "Coin", "Comp", "Contact", "Corner",
    "Chambers", "Colour", "Correct", "Costume", "Dead", "Dry", "Dynamic", "Ear", "Environment",
    "Expanded", "Expended", "Extended", "EXRs", "Eye", "Eyes", "Falling", "First",
    "Fix", "Fixes", "Flicker", "Frame", "Glue", "Grade", "Hair", "Hairline",
    "Hand", "Hanging", "Lantern", "Leaves", "Lens", "Light", "Mage", "Mask",
    "Mic", "Moonlit", "Nose", "Note", "Old", "Out", "Paint", "Painted",
    "Paintout", "Possible", "Print", "Production", "Remove", "Removal", "Repo",
    "Reposition", "Respeed", "Resize", "Set", "Shot", "Skin", "Smooth", "Sprites",
    "Step", "Stray", "Supression", "Sword", "Take", "Under", "Undereyes",
    "Upper", "Wig", "Wigline", "Wire", "Ynder"
]);

const BEAUTY_CONTEXT = /\b(?:under\s*eyes?|wig(?:line)?|hair(?:line)?|de[\s-]?age|nose|piercing|contact\s+lens|sclera|skin|face|cheek|cosmetic|ear\s+glue|lace|body|costume|hand)\b/i;

export function analyzeBeautyFiles(csvText, subcapText) {
    const parsed = parseCSV(csvText);
    const shotHeader = findHeader(parsed.headers, SHOT_HEADERS);
    const taskHeader = findHeader(parsed.headers, TASK_HEADERS);
    if (!shotHeader || !taskHeader) {
        throw new Error("The CSV needs VFX Shot Name and VFX Elements/Tasks columns.");
    }

    const episodeShots = parseEpisodeSubcaps(subcapText);
    if (episodeShots.length === 0) {
        throw new Error("No timed shot entries were found in the episode SubCaps file.");
    }

    const shotIndex = new Map(episodeShots.map((shot) => [normalizeShotId(shot.shotId), shot]));
    const rows = parsed.rows
        .map((sourceRow, index) => {
            const shotId = String(sourceRow[shotHeader] ?? "").trim();
            const callout = String(sourceRow[taskHeader] ?? "").trim();
            if (!shotId || !callout) {
                return null;
            }
            const parsedCallout = parseCallout(callout);
            return {
                sourceRow: index + 2,
                shotId,
                callout,
                vendors: parsedCallout.vendors,
                taskLines: parsedCallout.taskLines,
                compactCallout: parsedCallout.taskLines.join(" / "),
                shot: shotIndex.get(normalizeShotId(shotId)) ?? null
            };
        })
        .filter(Boolean);

    const suggestions = detectCharacterCandidates(rows);
    const matchedRows = rows.filter((row) => row.shot);
    return {
        rows,
        episodeShots,
        suggestions,
        stats: {
            sourceRows: rows.length,
            episodeShots: episodeShots.length,
            matchedRows: matchedRows.length,
            unmatchedRows: rows.length - matchedRows.length,
            vendors: unique(rows.flatMap((row) => row.vendors)).length,
            suggestions: suggestions.length
        }
    };
}

export function generateBeautyOutputs(analysis, options = {}) {
    const includeVendor = Boolean(options.includeVendor);
    const includeCharacters = options.includeCharacters !== false;
    const includeWork = Boolean(options.includeWork);
    const separator = options.separator ?? " | ";
    const selectedCharacters = unique((options.selectedCharacters ?? []).map(cleanCharacterName));
    const characterLabels = options.characterLabels ?? {};
    const includeUnassigned = Boolean(options.includeUnassigned);
    const unassignedLabel = String(options.unassignedLabel || "X").trim() || "X";

    if (!includeVendor && !includeCharacters && !includeWork) {
        throw new Error("Select Vendor, Character, or Full Work Call-out for the subtitle text.");
    }

    const entries = [];
    const auditRows = [];

    for (const row of analysis.rows) {
        if (!row.shot) {
            continue;
        }

        const characters = includeCharacters
            ? selectedCharacters.filter((name) => calloutContainsCharacter(row.callout, name))
            : [];
        const isUnassigned = includeCharacters && includeUnassigned && characters.length === 0;
        const outputCharacters = isUnassigned ? ["Unassigned"] : characters;
        const displayCharacters = isUnassigned
            ? [unassignedLabel]
            : characters.map((name) => characterLabels[name] || name);
        const textParts = [];
        if (includeVendor && row.vendors.length) {
            textParts.push(row.vendors.join("/"));
        }
        if (includeCharacters && displayCharacters.length) {
            textParts.push(displayCharacters.join("/"));
        }
        if (includeWork && row.compactCallout) {
            textParts.push(row.compactCallout);
        }

        const text = textParts.filter(Boolean).join(separator);
        auditRows.push({
            SHOT_ID: row.shotId,
            "TC IN": row.shot.timecodeIn,
            "TC OUT": row.shot.timecodeOut,
            Vendor: row.vendors.join(" | "),
            Characters: outputCharacters.join(" | "),
            "Work Call-out": row.compactCallout,
            "SubCap Text": text,
            Status: text ? "Included" : "Skipped: no selected text"
        });

        if (!text) {
            continue;
        }

        entries.push({
            shotId: row.shotId,
            timecodeIn: row.shot.timecodeIn,
            timecodeOut: row.shot.timecodeOut,
            inFrames: row.shot.inFrames,
            outFrames: row.shot.outFrames,
            vendors: row.vendors,
            characters: outputCharacters,
            workCallout: row.compactCallout,
            text
        });
    }

    entries.sort((left, right) => left.inFrames - right.inFrames);
    const auditHeaders = [
        "SHOT_ID", "TC IN", "TC OUT", "Vendor", "Characters",
        "Work Call-out", "SubCap Text", "Status"
    ];

    return {
        entries,
        subcapText: serializeSubcaps(entries),
        auditHeaders,
        auditRows,
        auditCsv: serializeCSV(auditHeaders, auditRows),
        stats: {
            includedEntries: entries.length,
            skippedEntries: auditRows.length - entries.length,
            charactersUsed: unique(entries.flatMap((entry) => entry.characters)).length,
            vendorsUsed: unique(entries.flatMap((entry) => entry.vendors)).length
        }
    };
}

export function buildCharacterZip(analysis, options = {}) {
    const configs = (options.characterConfigs ?? [])
        .map((config) => ({
            name: cleanCharacterName(config.name),
            color: normalizeColor(config.color),
            symbol: String(config.symbol || "•").trim() || "•"
        }))
        .filter((config) => config.name);
    if (configs.length === 0 && !options.includeUnassigned) {
        throw new Error("Select at least one character before exporting separate tracks.");
    }

    const files = [];
    const keyRows = [];
    let totalEntries = 0;

    configs.forEach((config, index) => {
        const label = options.useSymbols ? config.symbol : config.name;
        const output = generateBeautyOutputs(analysis, {
            includeVendor: Boolean(options.includeVendor),
            includeCharacters: true,
            includeWork: Boolean(options.includeWork),
            selectedCharacters: [config.name],
            characterLabels: { [config.name]: label },
            separator: options.separator ?? " | "
        });
        if (output.entries.length === 0) {
            return;
        }

        const colorName = config.color.replace("#", "").toUpperCase();
        const order = String(index + 1).padStart(2, "0");
        const filename = `${order}_${safeFilename(config.name)}_${colorName}.txt`;
        files.push({
            name: filename,
            data: new Uint8Array(encodeUtf16Le(output.subcapText))
        });
        keyRows.push({
            Character: config.name,
            Marker: config.symbol,
            "Colour HEX": config.color.toUpperCase(),
            "SubCap File": filename,
            Entries: String(output.entries.length)
        });
        totalEntries += output.entries.length;
    });

    if (options.includeUnassigned) {
        const unassignedConfig = {
            name: "Unassigned",
            color: normalizeColor(options.unassignedConfig?.color || "#7A7A7A"),
            symbol: String(options.unassignedConfig?.symbol || "X").trim() || "X"
        };
        const allNames = configs.map((config) => config.name);
        const allLabels = Object.fromEntries(configs.map((config) => [
            config.name,
            options.useSymbols ? config.symbol : config.name
        ]));
        const output = generateBeautyOutputs(analysis, {
            includeVendor: Boolean(options.includeVendor),
            includeCharacters: true,
            includeWork: Boolean(options.includeWork),
            includeUnassigned: true,
            unassignedLabel: unassignedConfig.symbol,
            selectedCharacters: allNames,
            characterLabels: allLabels,
            separator: options.separator ?? " | "
        });
        const entries = output.entries.filter((entry) => entry.characters.includes("Unassigned"));
        if (entries.length > 0) {
            const colorName = unassignedConfig.color.replace("#", "").toUpperCase();
            const filename = `00_Unassigned_${colorName}.txt`;
            files.unshift({
                name: filename,
                data: new Uint8Array(encodeUtf16Le(serializeSubcaps(entries)))
            });
            keyRows.unshift({
                Character: "Unassigned",
                Marker: unassignedConfig.symbol,
                "Colour HEX": unassignedConfig.color.toUpperCase(),
                "SubCap File": filename,
                Entries: String(entries.length)
            });
            totalEntries += entries.length;
        }
    }

    const keyHeaders = ["Character", "Marker", "Colour HEX", "SubCap File", "Entries"];
    files.push({
        name: "CHARACTER_COLOUR_KEY.csv",
        data: new TextEncoder().encode(`\uFEFF${serializeCSV(keyHeaders, keyRows)}`)
    });
    files.push({
        name: "README.txt",
        data: new TextEncoder().encode([
            "BEAUTY WORK CHARACTER SUBCAPS",
            "",
            "1. Import each character TXT file as a separate Avid SubCap track.",
            "2. In the SubCap Effect Editor, set that track's font colour to the HEX value in CHARACTER_COLOUR_KEY.csv.",
            "3. Keep tracks named after the character so the colour assignment remains clear.",
            "4. The Avid DS text format carries caption text and timing; colour is applied in the SubCap effect.",
            ""
        ].join("\r\n"))
    });

    return {
        zip: createStoredZip(files),
        files,
        keyRows,
        stats: {
            characterFiles: keyRows.length,
            totalEntries
        }
    };
}

export function parseEpisodeSubcaps(text, fps = 24) {
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
        const inFrames = timecodeToFrames(match[1], fps);
        const outFrames = timecodeToFrames(match[2], fps);
        if (!shotId || inFrames === null || outFrames === null || outFrames <= inFrames) {
            continue;
        }

        shots.push({
            shotId,
            timecodeIn: match[1],
            timecodeOut: match[2],
            inFrames,
            outFrames
        });
    }

    return shots;
}

export function parseCallout(callout) {
    const lines = String(callout ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const vendors = [];
    const taskLines = [];
    let currentVendor = "";

    for (const line of lines) {
        const vendorMatch = line.match(/^([A-Z0-9]{2,5}):$/);
        if (vendorMatch) {
            currentVendor = vendorMatch[1];
            vendors.push(currentVendor);
            continue;
        }
        if (/^(?:Expanded|Extended|Expended|Old)\s+Brief:$/i.test(line)) {
            continue;
        }
        taskLines.push(line);
    }

    return {
        vendors: unique(vendors),
        taskLines,
        currentVendor
    };
}

export function detectCharacterCandidates(rows) {
    const candidates = new Map();
    const vendorSet = new Set(rows.flatMap((row) => row.vendors).map((vendor) => vendor.toUpperCase()));

    for (const row of rows) {
        for (const line of row.taskLines) {
            const beautyContext = BEAUTY_CONTEXT.test(line);
            const tokens = line.match(/\b[A-Z][A-Za-z'’]{2,}\b/g) ?? [];
            for (const rawToken of tokens) {
                const token = cleanCharacterName(rawToken);
                if (
                    !token
                    || token === token.toUpperCase()
                    || CHARACTER_STOP_WORDS.has(token)
                    || vendorSet.has(token.toUpperCase())
                ) {
                    continue;
                }
                const existing = candidates.get(token) ?? {
                    name: token,
                    count: 0,
                    beautyContextCount: 0,
                    samples: [],
                    shotIds: []
                };
                existing.count += 1;
                existing.shotIds.push(row.shotId);
                if (beautyContext) {
                    existing.beautyContextCount += 1;
                }
                if (!existing.samples.includes(line) && existing.samples.length < 3) {
                    existing.samples.push(line);
                }
                candidates.set(token, existing);
            }
        }
    }

    collapsePossessiveVariants(candidates);

    return [...candidates.values()]
        .filter((candidate) => candidate.count >= 2 || candidate.beautyContextCount >= 1)
        .map((candidate) => ({
            ...candidate,
            score: candidate.count + candidate.beautyContextCount * 2,
            mentions: candidate.count,
            count: unique(candidate.shotIds).length,
            defaultSelected: candidate.beautyContextCount > 0
        }))
        .sort((left, right) => right.score - left.score || right.count - left.count || left.name.localeCompare(right.name));
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

export function createStoredZip(files, timestamp = new Date()) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { dosDate, dosTime } = toDosDateTime(timestamp);

    for (const file of files) {
        const nameBytes = new TextEncoder().encode(file.name);
        const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
        const checksum = crc32(data);
        const localHeader = new Uint8Array(30 + nameBytes.length);
        const localView = new DataView(localHeader.buffer);
        localView.setUint32(0, 0x04034b50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 0x0800, true);
        localView.setUint16(8, 0, true);
        localView.setUint16(10, dosTime, true);
        localView.setUint16(12, dosDate, true);
        localView.setUint32(14, checksum, true);
        localView.setUint32(18, data.length, true);
        localView.setUint32(22, data.length, true);
        localView.setUint16(26, nameBytes.length, true);
        localView.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);
        localParts.push(localHeader, data);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(centralHeader.buffer);
        centralView.setUint32(0, 0x02014b50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0x0800, true);
        centralView.setUint16(10, 0, true);
        centralView.setUint16(12, dosTime, true);
        centralView.setUint16(14, dosDate, true);
        centralView.setUint32(16, checksum, true);
        centralView.setUint32(20, data.length, true);
        centralView.setUint32(24, data.length, true);
        centralView.setUint16(28, nameBytes.length, true);
        centralView.setUint16(30, 0, true);
        centralView.setUint16(32, 0, true);
        centralView.setUint16(34, 0, true);
        centralView.setUint16(36, 0, true);
        centralView.setUint32(38, 0, true);
        centralView.setUint32(42, offset, true);
        centralHeader.set(nameBytes, 46);
        centralParts.push(centralHeader);
        offset += localHeader.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    return concatenateBytes([...localParts, ...centralParts, end]);
}

function calloutContainsCharacter(callout, character) {
    const escaped = character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}(?:['’]s|s)?\\b`, "i").test(callout);
}

function collapsePossessiveVariants(candidates) {
    for (const [name, candidate] of [...candidates.entries()]) {
        if (!name.endsWith("s") || name.length < 5) {
            continue;
        }
        const singular = name.slice(0, -1);
        const existing = candidates.get(singular);
        if (!existing) {
            continue;
        }
        existing.count += candidate.count;
        existing.beautyContextCount += candidate.beautyContextCount;
        existing.samples = unique([...existing.samples, ...candidate.samples]).slice(0, 3);
        existing.shotIds = unique([...existing.shotIds, ...candidate.shotIds]);
        candidates.delete(name);
    }
}

function cleanCharacterName(value) {
    return String(value ?? "")
        .trim()
        .replace(/['’]s$/i, "")
        .replace(/[^A-Za-z'-]/g, "");
}

function normalizeColor(value) {
    const color = String(value ?? "").trim();
    return /^#[0-9A-F]{6}$/i.test(color) ? color : "#FF6B35";
}

function safeFilename(value) {
    return String(value ?? "")
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "Character";
}

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function concatenateBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}

function toDosDateTime(value) {
    const date = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
    const year = Math.min(2107, Math.max(1980, date.getFullYear()));
    return {
        dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
        dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
    };
}

function findHeader(headers, aliases) {
    const normalizedAliases = new Set(aliases.map(normalizeHeader));
    return headers.find((header) => normalizedAliases.has(normalizeHeader(header))) ?? null;
}

function normalizeHeader(value) {
    return String(value ?? "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function normalizeShotId(value) {
    return String(value ?? "").trim().toUpperCase();
}

function timecodeToFrames(timecode, fps) {
    const match = String(timecode ?? "").match(/^(\d{1,3}):(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
        return null;
    }
    const [, hours, minutes, seconds, frames] = match.map(Number);
    return (((hours * 60 + minutes) * 60) + seconds) * fps + frames;
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();
