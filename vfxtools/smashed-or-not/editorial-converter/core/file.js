export async function readTextFile(file) {
    const buffer = await file.arrayBuffer();
    return decodeTextFromArrayBuffer(buffer);
}

export function decodeTextFromArrayBuffer(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const encoding = detectEncoding(bytes);
    const decoder = new TextDecoder(encoding);
    return decoder.decode(bytes).replace(/^\uFEFF/, "");
}

export function detectEncoding(bytes) {
    if (bytes.length >= 2) {
        if (bytes[0] === 0xff && bytes[1] === 0xfe) {
            return "utf-16le";
        }
        if (bytes[0] === 0xfe && bytes[1] === 0xff) {
            return "utf-16be";
        }
    }

    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return "utf-8";
    }

    let evenZeroes = 0;
    let oddZeroes = 0;

    for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] === 0x00) {
            if (index % 2 === 0) {
                evenZeroes += 1;
            } else {
                oddZeroes += 1;
            }
        }
    }

    if (oddZeroes > bytes.length * 0.2 && oddZeroes > evenZeroes * 2) {
        return "utf-16le";
    }

    if (evenZeroes > bytes.length * 0.2 && evenZeroes > oddZeroes * 2) {
        return "utf-16be";
    }

    return "utf-8";
}

export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "0 Bytes";
    }

    const units = ["Bytes", "KB", "MB", "GB"];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const size = bytes / 1024 ** exponent;
    return `${size.toFixed(size >= 100 || exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}
