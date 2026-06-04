export function normalizeLineBreaks(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function parseCSV(text) {
    const normalized = normalizeLineBreaks(text);
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let index = 0; index < normalized.length; index += 1) {
        const char = normalized[index];
        const nextChar = normalized[index + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                value += '"';
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

    const nonBlankRows = rows.filter((currentRow) => currentRow.some((cell) => String(cell).trim() !== ""));
    if (nonBlankRows.length === 0) {
        return { headers: [], rows: [] };
    }

    const headers = nonBlankRows[0].map((header) => stripBom(String(header).trim()));
    const dataRows = nonBlankRows.slice(1).map((currentRow) => {
        const padded = [...currentRow];
        while (padded.length < headers.length) {
            padded.push("");
        }
        return headers.reduce((accumulator, header, columnIndex) => {
            accumulator[header] = String(padded[columnIndex] ?? "").trim();
            return accumulator;
        }, {});
    });

    return { headers, rows: dataRows };
}

export function serializeCSV(headers, rows) {
    const lines = [headers.map(escapeCsvValue).join(",")];

    for (const row of rows) {
        const values = Array.isArray(row)
            ? row
            : headers.map((header) => row[header] ?? "");
        lines.push(values.map(escapeCsvValue).join(","));
    }

    return `${lines.join("\r\n")}\r\n`;
}

export function makeTableRows(headers, rowObjects) {
    return rowObjects.map((row) => headers.map((header) => row[header] ?? ""));
}

export function findHeader(headers, aliases) {
    const aliasSet = new Set(aliases.map((alias) => normalizeHeader(alias)));
    return headers.find((header) => aliasSet.has(normalizeHeader(header))) ?? null;
}

export function normalizeHeader(header) {
    return String(header)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export function stripBom(value) {
    return value.replace(/^\uFEFF/, "");
}

function escapeCsvValue(value) {
    const stringValue = String(value ?? "");
    if (/[",\n]/.test(stringValue)) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
}
