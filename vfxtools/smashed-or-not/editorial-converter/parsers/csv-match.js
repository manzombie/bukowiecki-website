import { findHeader, parseCSV, serializeCSV } from "../core/csv.js";

const SHOT_ID_ALIASES = ["SHOT_ID", "Shot ID", "shot id", "ShotID", "shot_id"];
const EDITORIAL_ID_ALIASES = ["Editorial Shot ID", "EDITORIAL_SHOT_ID"];

export function enrichCsvByShotId(masterText, editorialText, masterName = "master.csv", editorialName = "editorial.csv") {
    const master = parseCSV(masterText);
    const editorial = parseCSV(editorialText);

    if (master.headers.length === 0) {
        throw new Error(`No CSV headers found in ${masterName}.`);
    }

    if (editorial.headers.length === 0) {
        throw new Error(`No CSV headers found in ${editorialName}.`);
    }

    const masterShotIdHeader = findHeader(master.headers, SHOT_ID_ALIASES);
    const editorialShotIdHeader = findHeader(editorial.headers, SHOT_ID_ALIASES);
    const editorialValueHeader = findHeader(editorial.headers, EDITORIAL_ID_ALIASES) ?? editorialShotIdHeader;

    if (!masterShotIdHeader) {
        throw new Error(`Could not find a Shot ID column in ${masterName}.`);
    }

    if (!editorialShotIdHeader) {
        throw new Error(`Could not find a Shot ID column in ${editorialName}.`);
    }

    const warnings = [];
    const editorialIndex = new Map();

    for (const row of editorial.rows) {
        const key = normalizeShotId(row[editorialShotIdHeader]);
        if (!key) {
            continue;
        }
        if (editorialIndex.has(key)) {
            warnings.push(`Duplicate Shot ID "${row[editorialShotIdHeader]}" found in ${editorialName}; keeping the first match.`);
            continue;
        }
        editorialIndex.set(key, row[editorialValueHeader] ?? row[editorialShotIdHeader] ?? "");
    }

    const shotColumnIndex = master.headers.indexOf(masterShotIdHeader);
    const outputHeaders = [...master.headers];
    outputHeaders.splice(shotColumnIndex + 1, 0, "Editorial Shot ID");

    let matchedCount = 0;
    const outputRows = master.rows.map((row) => {
        const shotValue = row[masterShotIdHeader] ?? "";
        const matchedValue = editorialIndex.get(normalizeShotId(shotValue)) ?? "";
        if (matchedValue) {
            matchedCount += 1;
        }

        const values = master.headers.map((header) => row[header] ?? "");
        values.splice(shotColumnIndex + 1, 0, matchedValue);
        return values;
    });

    return {
        headers: outputHeaders,
        rows: outputRows,
        csv: serializeCSV(outputHeaders, outputRows),
        warnings,
        summary: `${matchedCount} of ${master.rows.length} master rows matched against ${editorial.rows.length} editorial rows.`
    };
}

function normalizeShotId(value) {
    return String(value ?? "").trim().toUpperCase();
}
