import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeTextFromArrayBuffer } from "../editorial-converter/core/file.js";
import { parseCSV } from "../editorial-converter/core/csv.js";
import { buildSubcapCsv, deriveCutName } from "../editorial-converter/parsers/subcap.js";
import { parseEdl } from "../editorial-converter/parsers/edl.js";
import { enrichCsvByShotId } from "../editorial-converter/parsers/csv-match.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

test("UTF-16LE buffers decode correctly", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x53, 0x00, 0x48, 0x00, 0x4f, 0x00, 0x54, 0x00]);
    assert.equal(decodeTextFromArrayBuffer(bytes.buffer), "SHOT");
});

test("CSV parser keeps quoted commas and skips blank rows", () => {
    const csv = 'Shot ID,Comment\nSHOT_010,"Needs, review"\n\nSHOT_020,Ready\n';
    const parsed = parseCSV(csv);
    assert.deepEqual(parsed.headers, ["Shot ID", "Comment"]);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].Comment, "Needs, review");
});

test("SubCap mode extracts shot ids and cut name cleanly", async () => {
    const fixture = await fs.readFile(path.join(fixturesDir, "subcaps", "basic_subcaps.txt"), "utf8");
    const basic = buildSubcapCsv(fixture, "REEL_01_SUBCAPS.txt");
    const cutName = buildSubcapCsv(fixture, "REEL_01_SUBCAPS.txt", { includeCutName: true });

    assert.deepEqual(basic.headers, ["SHOT_ID", "TC IN", "TC OUT"]);
    assert.equal(basic.rows.length, 3);
    assert.deepEqual(basic.rows[0], ["SHOT_010", "01:00:00:00", "01:00:12:00"]);
    assert.deepEqual(cutName.rows[1], ["SHOT_020", "01:00:12:00", "REEL_01"]);
    assert.equal(deriveCutName("ABC_SUBCAPS.txt"), "ABC");
});

test("EDL parser flattens comment metadata into a single row per event", async () => {
    const fixture = await fs.readFile(path.join(fixturesDir, "edl", "basic.edl"), "utf8");
    const result = parseEdl(fixture, "basic.edl");

    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.headers.slice(0, 5), ["TITLE", "FCM", "EVENT", "REEL", "TRACK"]);
    assert.equal(result.rows[0][10], "SHOT_010_comp_v003");
    assert.equal(result.rows[0][11], "/show/plates/SHOT_010_comp_v003.mov");
    assert.match(result.rows[1][12], /COLOR: RED/);
});

test("CSV enrich inserts Editorial Shot ID after Shot ID", async () => {
    const master = await fs.readFile(path.join(fixturesDir, "csv", "master.csv"), "utf8");
    const editorial = await fs.readFile(path.join(fixturesDir, "csv", "editorial.csv"), "utf8");
    const result = enrichCsvByShotId(master, editorial);

    assert.deepEqual(result.headers, ["Shot ID", "Editorial Shot ID", "Version", "Status"]);
    assert.deepEqual(result.rows[0], ["SHOT_010", "SHOT_010", "v003", "ready"]);
    assert.deepEqual(result.rows[2], ["SHOT_030", "", "v002", "hold"]);
});
