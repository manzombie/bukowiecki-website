import test from "node:test";
import assert from "node:assert/strict";

import {
    buildVersionIndex,
    encodeUtf16Le,
    parseQcRows,
    parseVfxSubcaps,
    runQcReportPipeline
} from "../qc-report-pipeline/engine.js";

const qcRows = [
    ["Report title"],
    ["Timecode In", "Timecode Out", "Description", "", "", "Duration", "A/V/F", "Scale", "Chan./Sectr", "Picture/Audio Content", "In Source", "Sign-off"],
    ["00:03:06:10", "00:03:10:21", "Judder in carriage", "", "", "00:00:04:12", "V", "3", "M-C", "", "", "Rejected"],
    ["00:03:10:22", "", "Pixel hit", "", "", "00:00:00:01", "V", "3", "M-R", "", "", "Rejected"]
];

const subcaps = [
    "<begin subtitles>",
    "01:03:06:10 01:03:10:22",
    "202_AVP_3040",
    "",
    "01:03:10:22 01:03:17:09",
    "202_AVP_3060",
    "",
    "<end subtitles>"
].join("\n");

const edl = [
    "* FROM CLIP NAME: 202_AVP_3040_comp_ilm_v0007.[1000-1118].exr",
    "* FROM CLIP NAME: 202_AVP_3060_comp_ilm_v0006.[1010-1173].exr"
].join("\n");

test("QC rows are discovered below report metadata", () => {
    const parsed = parseQcRows(qcRows);
    assert.equal(parsed.headerRowIndex, 1);
    assert.equal(parsed.issues.length, 2);
    assert.equal(parsed.issues[0].cutFrames, 108);
    assert.equal(parsed.issues[1].cutFrames, 1);
});

test("VFX SubCaps convert editorial 01 hour to Pixelogic 00 hour", () => {
    const shots = parseVfxSubcaps(subcaps);
    assert.equal(shots[0].shotId, "202_AVP_3040");
    assert.equal(shots[0].inFrames, 4474);
});

test("EDL frame-sequence suffixes are removed from version names", () => {
    const versions = buildVersionIndex(edl);
    assert.deepEqual(versions.get("202_AVP_3040"), ["202_AVP_3040_comp_ilm_v0007"]);
});

test("integrated pipeline enriches CSV and creates Pixelogic-timecode SubCaps", () => {
    const result = runQcReportPipeline({ qcRows, subcapText: subcaps, edlText: edl });
    assert.equal(result.rows[0].VFX_ID, "202_AVP_3040");
    assert.equal(result.rows[0].versions, "202_AVP_3040_comp_ilm_v0007");
    assert.equal(result.subcapEntries[0].timecodeIn, "00:03:06:10");
    assert.equal(result.subcapEntries[1].timecodeOut, "00:03:10:23");
    assert.equal(new Uint8Array(encodeUtf16Le("A"))[0], 0xff);
});
