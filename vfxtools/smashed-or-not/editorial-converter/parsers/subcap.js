import { makeTableRows, serializeCSV } from "../core/csv.js";

const SUBCAP_RANGE_PATTERN = /^(\d{2}:\d{2}:\d{2}:\d{2})\s+(\d{2}:\d{2}:\d{2}:\d{2})\s*$/;

export function parseSubcapEntries(text) {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const entries = [];
    const warnings = [];

    for (let index = 0; index < lines.length; index += 1) {
        const trimmed = lines[index].trim();
        if (!trimmed || trimmed.startsWith("@") || /^<.*>$/.test(trimmed)) {
            continue;
        }

        const match = trimmed.match(SUBCAP_RANGE_PATTERN);
        if (!match) {
            continue;
        }

        const tcIn = match[1];
        const tcOut = match[2];
        const textLines = [];
        let cursor = index + 1;

        while (cursor < lines.length) {
            const candidate = lines[cursor].trim();
            if (!candidate) {
                cursor += 1;
                continue;
            }
            if (candidate.startsWith("@") || /^<.*>$/.test(candidate)) {
                cursor += 1;
                continue;
            }
            if (SUBCAP_RANGE_PATTERN.test(candidate)) {
                break;
            }
            textLines.push(candidate.replace(/\s+/g, " ").trim());
            cursor += 1;
        }

        const shotId = textLines.join(" ").trim();
        if (!shotId) {
            warnings.push(`Skipped subtitle at ${tcIn} because it has no caption text.`);
            index = cursor - 1;
            continue;
        }

        entries.push({
            shotId,
            tcIn,
            tcOut
        });
        index = cursor - 1;
    }

    return { entries, warnings };
}

export function buildSubcapCsv(text, fileName, options = {}) {
    const { includeCutName = false } = options;
    const { entries, warnings } = parseSubcapEntries(text);
    const headers = includeCutName
        ? ["SHOT_ID", "TC IN", "CUT NAME"]
        : ["SHOT_ID", "TC IN", "TC OUT"];
    const cutName = deriveCutName(fileName);

    const rowObjects = entries.map((entry) => includeCutName
        ? {
            "SHOT_ID": entry.shotId,
            "TC IN": entry.tcIn,
            "CUT NAME": cutName
        }
        : {
            "SHOT_ID": entry.shotId,
            "TC IN": entry.tcIn,
            "TC OUT": entry.tcOut
        });

    return {
        headers,
        rows: makeTableRows(headers, rowObjects),
        csv: serializeCSV(headers, rowObjects),
        warnings,
        summary: `${entries.length} subtitle ${entries.length === 1 ? "entry" : "entries"} parsed from ${fileName}.`
    };
}

export function deriveCutName(fileName) {
    return String(fileName)
        .replace(/\.[^.]+$/, "")
        .replace(/_SUBCAPS$/i, "");
}
