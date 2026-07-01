import test from "node:test";
import assert from "node:assert/strict";

import {
    analyzeBeautyFiles,
    buildCharacterZip,
    createStoredZip,
    generateBeautyOutputs,
    parseCallout
} from "../beauty-subcaps/engine.js";

const csv = [
    "VFX Shot Name,VFX Elements/Tasks",
    "117_GMR_1140,\"MRZ:",
    "Eldien Under Eyes Fix\"",
    "118_GBH_1040,\"CSH:",
    "Lantern Fix",
    "",
    "MRZ:",
    "Eldien Under Eye Fix\"",
    "119_ABC_1000,\"MRZ:",
    "Boom Mic Paint Out - 01:01:14:18\""
].join("\n");

const subcaps = [
    "<begin subtitles>",
    "00:15:01:00 00:15:03:00",
    "117_GMR_1140",
    "",
    "00:16:01:00 00:16:04:00",
    "118_GBH_1040",
    "",
    "00:17:01:00 00:17:02:00",
    "119_ABC_1000",
    "",
    "<end subtitles>"
].join("\n");

test("vendor sections and task lines are separated", () => {
    const parsed = parseCallout("CSH:\nLantern Fix\n\nMRZ:\nEldien Under Eye Fix");
    assert.deepEqual(parsed.vendors, ["CSH", "MRZ"]);
    assert.deepEqual(parsed.taskLines, ["Lantern Fix", "Eldien Under Eye Fix"]);
});

test("beauty CSV rows match episode SubCaps and suggest character names", () => {
    const analysis = analyzeBeautyFiles(csv, subcaps);
    assert.equal(analysis.stats.matchedRows, 3);
    assert.ok(analysis.suggestions.some((candidate) => candidate.name === "Eldien"));
    assert.ok(!analysis.suggestions.some((candidate) => candidate.name === "Lantern"));
});

test("subtitle output independently includes vendor, character, and work callout", () => {
    const analysis = analyzeBeautyFiles(csv, subcaps);
    const charactersOnly = generateBeautyOutputs(analysis, {
        includeCharacters: true,
        selectedCharacters: ["Eldien"]
    });
    assert.equal(charactersOnly.entries.length, 2);
    assert.equal(charactersOnly.entries[0].text, "Eldien");

    const full = generateBeautyOutputs(analysis, {
        includeVendor: true,
        includeCharacters: true,
        includeWork: true,
        selectedCharacters: ["Eldien"]
    });
    assert.equal(full.entries[1].text, "CSH/MRZ | Eldien | Lantern Fix / Eldien Under Eye Fix");
    assert.equal(full.entries[2].text, "MRZ | Boom Mic Paint Out - 01:01:14:18");
});

test("character package creates one colour-keyed SubCap file per selected name", () => {
    const analysis = analyzeBeautyFiles(csv, subcaps);
    const result = buildCharacterZip(analysis, {
        useSymbols: true,
        characterConfigs: [
            { name: "Eldien", color: "#E4572E", symbol: "•" }
        ]
    });

    assert.equal(result.stats.characterFiles, 1);
    assert.equal(result.keyRows[0]["Colour HEX"], "#E4572E");
    assert.equal(result.keyRows[0].Marker, "•");
    assert.ok(result.files.some((file) => file.name === "01_Eldien_E4572E.txt"));
    assert.deepEqual([...result.zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});

test("unassigned beauty shots receive an X and a separate ZIP track", () => {
    const analysis = analyzeBeautyFiles(csv, subcaps);
    const output = generateBeautyOutputs(analysis, {
        includeCharacters: true,
        includeUnassigned: true,
        unassignedLabel: "X",
        selectedCharacters: ["Eldien"]
    });
    assert.equal(output.entries.length, 3);
    assert.equal(output.entries[2].text, "X");
    assert.deepEqual(output.entries[2].characters, ["Unassigned"]);

    const packageResult = buildCharacterZip(analysis, {
        includeUnassigned: true,
        unassignedConfig: { color: "#777777", symbol: "X" },
        characterConfigs: [
            { name: "Eldien", color: "#E4572E", symbol: "•" }
        ]
    });
    assert.ok(packageResult.files.some((file) => file.name === "00_Unassigned_777777.txt"));
    assert.equal(packageResult.keyRows[0].Character, "Unassigned");
});

test("ZIP entries use the supplied current timestamp instead of the 1980 epoch", () => {
    const zip = createStoredZip(
        [{ name: "test.txt", data: new TextEncoder().encode("ok") }],
        new Date(2026, 5, 30, 12, 34, 56)
    );
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const dosDate = view.getUint16(12, true);
    const year = 1980 + (dosDate >> 9);
    const month = (dosDate >> 5) & 0x0f;
    const day = dosDate & 0x1f;
    assert.deepEqual([year, month, day], [2026, 6, 30]);
});
