import { serializeCSV } from "../core/csv.js";

const EDL_HEADERS = [
    "TITLE",
    "FCM",
    "EVENT",
    "REEL",
    "TRACK",
    "TRANSITION",
    "SRC IN",
    "SRC OUT",
    "REC IN",
    "REC OUT",
    "FROM CLIP NAME",
    "SOURCE FILE",
    "COMMENT"
];

const TIMECODE_PATTERN = /^\d{2}:\d{2}:\d{2}:\d{2}$/;

export function parseEdl(text, fileName = "EDL") {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let title = "";
    let fcm = "";
    const rows = [];
    const warnings = [];
    let currentEvent = null;

    const pushCurrentEvent = () => {
        if (currentEvent) {
            rows.push(currentEvent);
            currentEvent = null;
        }
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || /^M2\s+/i.test(line)) {
            continue;
        }

        const titleMatch = line.match(/^TITLE:\s*(.*)$/i);
        if (titleMatch) {
            title = titleMatch[1].trim();
            continue;
        }

        const fcmMatch = line.match(/^FCM:\s*(.*)$/i);
        if (fcmMatch) {
            fcm = fcmMatch[1].trim();
            continue;
        }

        if (line.startsWith("*")) {
            if (!currentEvent) {
                continue;
            }
            applyCommentLine(currentEvent, line);
            continue;
        }

        const event = parseEventLine(line, title, fcm);
        if (event) {
            pushCurrentEvent();
            currentEvent = event;
            continue;
        }

        if (currentEvent) {
            currentEvent.COMMENT = appendComment(currentEvent.COMMENT, line);
        } else {
            warnings.push(`Ignored non-event line in ${fileName}: ${line}`);
        }
    }

    pushCurrentEvent();

    return {
        headers: EDL_HEADERS,
        rows: rows.map((row) => EDL_HEADERS.map((header) => row[header] ?? "")),
        csv: serializeCSV(EDL_HEADERS, rows),
        warnings,
        summary: `${rows.length} EDL ${rows.length === 1 ? "event" : "events"} flattened from ${fileName}.`
    };
}

function parseEventLine(line, title, fcm) {
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 8 || !/^\d+$/.test(tokens[0])) {
        return null;
    }

    const remaining = tokens.slice(3);
    const firstTimecodeIndex = remaining.findIndex((token) => TIMECODE_PATTERN.test(token));

    if (firstTimecodeIndex < 0 || remaining.length - firstTimecodeIndex < 4) {
        return null;
    }

    const transitionTokens = remaining.slice(0, firstTimecodeIndex);
    const timecodes = remaining.slice(firstTimecodeIndex, firstTimecodeIndex + 4);

    if (timecodes.length < 4 || timecodes.some((token) => !TIMECODE_PATTERN.test(token))) {
        return null;
    }

    return {
        "TITLE": title,
        "FCM": fcm,
        "EVENT": tokens[0],
        "REEL": tokens[1],
        "TRACK": tokens[2],
        "TRANSITION": transitionTokens.join(" ").trim(),
        "SRC IN": timecodes[0],
        "SRC OUT": timecodes[1],
        "REC IN": timecodes[2],
        "REC OUT": timecodes[3],
        "FROM CLIP NAME": "",
        "SOURCE FILE": "",
        "COMMENT": ""
    };
}

function applyCommentLine(eventRow, line) {
    const content = line.replace(/^\*\s*/, "");
    const match = content.match(/^([^:]+):\s*(.*)$/);

    if (!match) {
        eventRow.COMMENT = appendComment(eventRow.COMMENT, content.trim());
        return;
    }

    const key = match[1].trim().toUpperCase();
    const value = match[2].trim();

    if (key === "FROM CLIP NAME") {
        eventRow["FROM CLIP NAME"] = value;
        return;
    }

    if (key === "SOURCE FILE") {
        eventRow["SOURCE FILE"] = value;
        return;
    }

    if (key === "COMMENT") {
        eventRow.COMMENT = appendComment(eventRow.COMMENT, value);
        return;
    }

    eventRow.COMMENT = appendComment(eventRow.COMMENT, `${match[1].trim()}: ${value}`);
}

function appendComment(existing, addition) {
    if (!addition) {
        return existing ?? "";
    }
    return existing ? `${existing} | ${addition}` : addition;
}
