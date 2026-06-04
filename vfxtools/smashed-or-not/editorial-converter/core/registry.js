import { readTextFile } from "./file.js";
import { buildSubcapCsv } from "../parsers/subcap.js";
import { parseEdl } from "../parsers/edl.js";
import { enrichCsvByShotId } from "../parsers/csv-match.js";

export const MODES = [
    {
        id: "subcap-to-csv",
        kicker: "SubCap",
        title: "SubCap -> CSV",
        description: "Extract shot IDs and timecodes from an Avid SubCap TXT export.",
        files: [
            {
                id: "source",
                label: "SubCap TXT",
                help: "Drop an Avid SubCap export here.",
                accept: ".txt,text/plain"
            }
        ],
        async process(files) {
            const source = requireFile(files, "source");
            const text = await readTextFile(source);
            const result = {
                ...buildSubcapCsv(text, source.name),
                downloadName: `${source.name.replace(/\.[^.]+$/, "")}.csv`
            };
            if (result.rows.length === 0) {
                throw new Error(`No valid SubCap entries found in ${source.name}.`);
            }
            return result;
        }
    },
    {
        id: "subcap-to-cutname",
        kicker: "SubCap",
        title: "SubCap -> CSV with CUT NAME",
        description: "Create a compact CSV with SHOT_ID, TC IN, and CUT NAME derived from the file name.",
        files: [
            {
                id: "source",
                label: "SubCap TXT",
                help: "CUT NAME uses the file name, minus extension and trailing _SUBCAPS.",
                accept: ".txt,text/plain"
            }
        ],
        async process(files) {
            const source = requireFile(files, "source");
            const text = await readTextFile(source);
            const result = {
                ...buildSubcapCsv(text, source.name, { includeCutName: true }),
                downloadName: `${source.name.replace(/\.[^.]+$/, "")}_cutname.csv`
            };
            if (result.rows.length === 0) {
                throw new Error(`No valid SubCap entries found in ${source.name}.`);
            }
            return result;
        }
    },
    {
        id: "edl-to-flat-csv",
        kicker: "EDL",
        title: "EDL -> Flat CSV",
        description: "Flatten EDL event rows and companion comments into a clean one-row-per-event CSV.",
        files: [
            {
                id: "source",
                label: "EDL File",
                help: "Supports CMX-style event rows plus comment lines such as FROM CLIP NAME and SOURCE FILE.",
                accept: ".edl,.txt,text/plain"
            }
        ],
        async process(files) {
            const source = requireFile(files, "source");
            const text = await readTextFile(source);
            const result = {
                ...parseEdl(text, source.name),
                downloadName: `${source.name.replace(/\.[^.]+$/, "")}.csv`
            };
            if (result.rows.length === 0) {
                throw new Error(`No valid EDL events found in ${source.name}.`);
            }
            return result;
        }
    },
    {
        id: "csv-match",
        kicker: "CSV Match",
        title: "CSV Match / Enrich",
        description: "Use the master CSV as the base, match rows by Shot ID, and insert Editorial Shot ID after the Shot ID column.",
        files: [
            {
                id: "master",
                label: "Master CSV",
                help: "This is the base file that will be preserved.",
                accept: ".csv,text/csv"
            },
            {
                id: "editorial",
                label: "Editorial CSV",
                help: "Used only to look up matching Shot IDs.",
                accept: ".csv,text/csv"
            }
        ],
        async process(files) {
            const master = requireFile(files, "master");
            const editorial = requireFile(files, "editorial");
            const masterText = await readTextFile(master);
            const editorialText = await readTextFile(editorial);
            return {
                ...enrichCsvByShotId(masterText, editorialText, master.name, editorial.name),
                downloadName: `${master.name.replace(/\.csv$/i, "")}_editorial_match.csv`
            };
        }
    }
];

export function getMode(modeId) {
    return MODES.find((mode) => mode.id === modeId) ?? MODES[0];
}

function requireFile(files, id) {
    const file = files[id];
    if (!file) {
        throw new Error("Please load all required files before processing.");
    }
    return file;
}
