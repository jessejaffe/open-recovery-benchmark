import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { sha256 } from "./canonical.mjs";

export const SUPPORTED_VALIDATORS = Object.freeze([
  "exact-sha256-v1",
  "raster-rgba-v1",
  "pdf-render-text-v1",
  "zip-entry-bytes-v1",
]);

export function isSupportedValidator(value) {
  return SUPPORTED_VALIDATORS.includes(value);
}

export function missingOutputValidation(validator) {
  return {
    validator,
    pass: false,
    score: 0,
    recoveredUnits: 0,
    totalUnits: null,
    unit: null,
    checks: { outputPresent: false },
  };
}

async function inspectRaster(file, required) {
  try {
    const [{ createCanvas, loadImage }, bytes] = await Promise.all([
      import("@napi-rs/canvas"),
      readFile(file),
    ]);
    const image = await loadImage(bytes);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = Buffer.from(context.getImageData(0, 0, image.width, image.height).data);
    return {
      readable: true,
      width: image.width,
      height: image.height,
      rgbaSha256: sha256(pixels),
      pixels,
    };
  } catch (error) {
    if (required) {
      throw new Error(`Frozen raster ground truth could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { readable: false };
  }
}

async function exactSha256({ output, groundTruth }) {
  const pass = output.sha256 === groundTruth.sha256;
  return {
    validator: "exact-sha256-v1",
    pass,
    score: pass ? 1 : 0,
    recoveredUnits: pass ? 1 : 0,
    totalUnits: 1,
    unit: "file",
    checks: {
      expectedSha256: groundTruth.sha256,
      actualSha256: output.sha256,
      exactBytes: pass,
    },
  };
}

async function rasterRgba({ outputPath, groundTruthPath }) {
  const expected = await inspectRaster(groundTruthPath, true);
  const actual = await inspectRaster(outputPath, false);
  if (!actual.readable) {
    return {
      validator: "raster-rgba-v1",
      pass: false,
      score: 0,
      recoveredUnits: 0,
      totalUnits: expected.width * expected.height,
      unit: "exact-decoded-pixel",
      checks: {
        groundTruthReadable: true,
        outputReadable: false,
      },
    };
  }
  const dimensions = actual.width === expected.width && actual.height === expected.height;
  const exactDecodedPixels = actual.rgbaSha256 === expected.rgbaSha256;
  const overlapWidth = Math.min(actual.width, expected.width);
  const overlapHeight = Math.min(actual.height, expected.height);
  let matchingPixels = 0;
  let channelSimilarity = 0;
  for (let row = 0; row < overlapHeight; row += 1) {
    for (let column = 0; column < overlapWidth; column += 1) {
      const expectedOffset = (row * expected.width + column) * 4;
      const actualOffset = (row * actual.width + column) * 4;
      let exactPixel = true;
      for (let channel = 0; channel < 4; channel += 1) {
        const difference = Math.abs(expected.pixels[expectedOffset + channel] - actual.pixels[actualOffset + channel]);
        channelSimilarity += 255 - difference;
        if (difference !== 0) exactPixel = false;
      }
      if (exactPixel) matchingPixels += 1;
    }
  }
  const totalPixels = expected.width * expected.height;
  const score = totalPixels === 0 ? 0 : matchingPixels / totalPixels;
  const normalizedChannelSimilarity = totalPixels === 0
    ? 0
    : channelSimilarity / (totalPixels * 4 * 255);
  return {
    validator: "raster-rgba-v1",
    pass: dimensions && exactDecodedPixels,
    score,
    recoveredUnits: matchingPixels,
    totalUnits: totalPixels,
    unit: "exact-decoded-pixel",
    checks: {
      groundTruthReadable: true,
      outputReadable: true,
      expectedWidth: expected.width,
      expectedHeight: expected.height,
      actualWidth: actual.width,
      actualHeight: actual.height,
      dimensions,
      expectedRgbaSha256: expected.rgbaSha256,
      actualRgbaSha256: actual.rgbaSha256,
      exactDecodedPixels,
      matchingPixels,
      totalPixels,
      exactPixelFraction: score,
      normalizedChannelSimilarity,
    },
  };
}

async function inspectPdf(file, required) {
  let loadingTask;
  try {
    const [{ getDocument }, { createCanvas }, bytes] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("@napi-rs/canvas"),
      readFile(file),
    ]);
    loadingTask = getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      stopAtErrors: true,
      useWasm: false,
      verbosity: 0,
    });
    const document = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 0.25 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const pixels = Buffer.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
        const text = await page.getTextContent();
        const textContent = text.items.map((item) => "str" in item ? item.str : "").join(" ");
        pages.push({
          pageNumber,
          width: canvas.width,
          height: canvas.height,
          rgbaSha256: sha256(pixels),
          textSha256: sha256(Buffer.from(textContent, "utf8")),
        });
      } finally {
        page.cleanup();
      }
    }
    return { readable: true, pageCount: document.numPages, pages };
  } catch (error) {
    if (required) {
      throw new Error(`Frozen PDF ground truth could not be rendered: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { readable: false };
  } finally {
    if (loadingTask) await loadingTask.destroy();
  }
}

async function pdfRenderText({ outputPath, groundTruthPath }) {
  const expected = await inspectPdf(groundTruthPath, true);
  const actual = await inspectPdf(outputPath, false);
  if (!actual.readable) {
    return {
      validator: "pdf-render-text-v1",
      pass: false,
      score: 0,
      recoveredUnits: 0,
      totalUnits: expected.pageCount,
      unit: "exact-render-and-text-page",
      checks: {
        groundTruthReadable: true,
        outputReadable: false,
      },
    };
  }
  const pageCount = actual.pageCount === expected.pageCount;
  const pageDimensions = pageCount && actual.pages.every((page, index) => (
    page.width === expected.pages[index].width && page.height === expected.pages[index].height
  ));
  const exactPageRenders = pageCount && actual.pages.every((page, index) => (
    page.rgbaSha256 === expected.pages[index].rgbaSha256
  ));
  const exactExtractedText = pageCount && actual.pages.every((page, index) => (
    page.textSha256 === expected.pages[index].textSha256
  ));
  const matchingPages = expected.pages.filter((page, index) => {
    const candidate = actual.pages[index];
    return candidate && candidate.width === page.width && candidate.height === page.height &&
      candidate.rgbaSha256 === page.rgbaSha256 && candidate.textSha256 === page.textSha256;
  }).length;
  const score = expected.pageCount === 0 ? 0 : matchingPages / expected.pageCount;
  return {
    validator: "pdf-render-text-v1",
    pass: pageCount && pageDimensions && exactPageRenders && exactExtractedText,
    score,
    recoveredUnits: matchingPages,
    totalUnits: expected.pageCount,
    unit: "exact-render-and-text-page",
    checks: {
      groundTruthReadable: true,
      outputReadable: true,
      expectedPageCount: expected.pageCount,
      actualPageCount: actual.pageCount,
      pageCount,
      pageDimensions,
      exactPageRenders,
      exactExtractedText,
      matchingPages,
      pageRecoveryFraction: score,
    },
  };
}

function zipCrcTable() {
  return Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    return crc >>> 0;
  });
}

const ZIP_CRC_TABLE = zipCrcTable();

function zipCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findZipEnd(bytes) {
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end record was not found.");
}

function safeZipU64(bytes, offset) {
  const value = Number(bytes.readBigUInt64LE(offset));
  if (!Number.isSafeInteger(value)) throw new Error("ZIP64 value exceeds the verifier's safe integer range.");
  return value;
}

function zip64Values(bytes, offset, length, needs) {
  const end = offset + length;
  while (offset + 4 <= end) {
    const id = bytes.readUInt16LE(offset);
    const size = bytes.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + size > end) break;
    if (id === 0x0001) {
      const values = {};
      for (const property of ["uncompressed", "compressed", "offset"]) {
        if (!needs[property]) continue;
        if (offset + 8 > end) throw new Error("ZIP64 extra field is incomplete.");
        values[property] = safeZipU64(bytes, offset);
        offset += 8;
      }
      return values;
    }
    offset += size;
  }
  throw new Error("Required ZIP64 extra field was not found.");
}

function inspectZipBytes(bytesLike) {
  const bytes = Buffer.from(bytesLike);
  const end = findZipEnd(bytes);
  const usesZip64 = bytes.readUInt16LE(end + 10) === 0xffff ||
    bytes.readUInt32LE(end + 12) === 0xffffffff || bytes.readUInt32LE(end + 16) === 0xffffffff;
  let entryCount = bytes.readUInt16LE(end + 10);
  let centralOffset = bytes.readUInt32LE(end + 16);
  if (usesZip64) {
    const locator = end - 20;
    if (locator < 0 || bytes.readUInt32LE(locator) !== 0x07064b50) throw new Error("ZIP64 locator was not found.");
    const zip64End = safeZipU64(bytes, locator + 8);
    if (bytes.readUInt32LE(zip64End) !== 0x06064b50) throw new Error("ZIP64 end record was not found.");
    entryCount = safeZipU64(bytes, zip64End + 32);
    centralOffset = safeZipU64(bytes, zip64End + 48);
  }
  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`ZIP central entry ${index} is invalid.`);
    }
    const method = bytes.readUInt16LE(offset + 10);
    const expectedCrc = bytes.readUInt32LE(offset + 16);
    const rawCompressed = bytes.readUInt32LE(offset + 20);
    const rawUncompressed = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const rawLocalOffset = bytes.readUInt32LE(offset + 42);
    const values = rawCompressed === 0xffffffff || rawUncompressed === 0xffffffff || rawLocalOffset === 0xffffffff
      ? zip64Values(bytes, offset + 46 + nameLength, extraLength, {
          compressed: rawCompressed === 0xffffffff,
          uncompressed: rawUncompressed === 0xffffffff,
          offset: rawLocalOffset === 0xffffffff,
        })
      : {};
    const compressedSize = rawCompressed === 0xffffffff ? values.compressed : rawCompressed;
    const expectedSize = rawUncompressed === 0xffffffff ? values.uncompressed : rawUncompressed;
    const localOffset = rawLocalOffset === 0xffffffff ? values.offset : rawLocalOffset;
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (entries.has(name)) throw new Error(`ZIP contains duplicate entry ${name}.`);
    if (localOffset + 30 > bytes.byteLength || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`ZIP local entry ${name} is invalid.`);
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`ZIP entry ${name} uses unsupported compression method ${method}.`);
    if (data.byteLength !== expectedSize || zipCrc32(data) !== expectedCrc) {
      throw new Error(`ZIP entry ${name} failed size or CRC verification.`);
    }
    entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inspectZip(file, required) {
  try {
    return { readable: true, entries: inspectZipBytes(await readFile(file)) };
  } catch (error) {
    if (required) {
      throw new Error(`Frozen ZIP ground truth could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { readable: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function zipEntryBytes({ outputPath, groundTruthPath }) {
  const expected = await inspectZip(groundTruthPath, true);
  const actual = await inspectZip(outputPath, false);
  const totalBytes = [...expected.entries.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
  if (!actual.readable) {
    return {
      validator: "zip-entry-bytes-v1",
      pass: false,
      score: 0,
      recoveredUnits: 0,
      totalUnits: totalBytes,
      unit: "verified-entry-byte",
      checks: { groundTruthReadable: true, outputReadable: false, outputError: actual.error },
    };
  }
  let recoveredBytes = 0;
  let exactEntries = 0;
  for (const [name, expectedBytes] of expected.entries) {
    const actualBytes = actual.entries.get(name);
    if (!actualBytes) continue;
    let prefix = 0;
    const limit = Math.min(expectedBytes.byteLength, actualBytes.byteLength);
    while (prefix < limit && expectedBytes[prefix] === actualBytes[prefix]) prefix += 1;
    recoveredBytes += prefix;
    if (prefix === expectedBytes.byteLength && actualBytes.byteLength === expectedBytes.byteLength) exactEntries += 1;
  }
  const score = totalBytes === 0 ? Number(exactEntries === expected.entries.size) : recoveredBytes / totalBytes;
  const unexpectedEntries = [...actual.entries.keys()]
    .filter((name) => !expected.entries.has(name))
    .sort();
  const pass = exactEntries === expected.entries.size;
  return {
    validator: "zip-entry-bytes-v1",
    pass,
    score,
    recoveredUnits: recoveredBytes,
    totalUnits: totalBytes,
    unit: "verified-entry-byte",
    checks: {
      groundTruthReadable: true,
      outputReadable: true,
      expectedEntries: expected.entries.size,
      actualEntries: actual.entries.size,
      exactEntries,
      unexpectedEntries,
      unexpectedEntryCount: unexpectedEntries.length,
      recoveredBytes,
      totalBytes,
      recoveredByteFraction: score,
    },
  };
}

const VALIDATORS = Object.freeze({
  "exact-sha256-v1": exactSha256,
  "raster-rgba-v1": rasterRgba,
  "pdf-render-text-v1": pdfRenderText,
  "zip-entry-bytes-v1": zipEntryBytes,
});

export async function validateCapturedOutput({ validator, outputPath, output, groundTruthPath, groundTruth }) {
  const implementation = VALIDATORS[validator];
  if (!implementation) throw new Error(`Unsupported independent validator ${validator}.`);
  return implementation({ outputPath, output, groundTruthPath, groundTruth });
}
