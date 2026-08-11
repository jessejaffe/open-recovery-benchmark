import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const benchmarkRoot = new URL("../", import.meta.url);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function inspectRaster(bytes) {
  const image = await loadImage(bytes);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = Buffer.from(context.getImageData(0, 0, image.width, image.height).data);
  return {
    width: image.width,
    height: image.height,
    rgbaSha256: sha256(pixels),
  };
}

async function inspectPdf(bytes) {
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    stopAtErrors: true,
    useWasm: false,
    verbosity: 0,
  });
  try {
    const document = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
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
      page.cleanup();
    }
    return { pageCount: document.numPages, pages };
  } finally {
    await loadingTask.destroy();
  }
}

function locateFinalStartXref(bytes) {
  const text = bytes.toString("latin1");
  const matches = [...text.matchAll(/startxref\s+([0-9]+)/g)];
  if (matches.length === 0) throw new Error("No numeric startxref section found.");
  const match = matches.at(-1);
  const markerOffset = match.index;
  const valueOffset = markerOffset + match[0].lastIndexOf(match[1]);
  return { markerOffset, valueOffset, valueLength: match[1].length, before: match[1] };
}

function removeFinalPdfEof(source) {
  const offset = source.lastIndexOf(Buffer.from("%%EOF", "ascii"));
  if (offset < 0) throw new Error("No final PDF EOF marker found.");
  return {
    bytes: source.subarray(0, offset),
    mutation: { type: "remove-final-eof", offset, removedByteLength: source.byteLength - offset },
  };
}

function replaceStartXref(source, replacementByte) {
  const location = locateFinalStartXref(source);
  const bytes = Buffer.from(source);
  const after = replacementByte.repeat(location.valueLength);
  bytes.write(after, location.valueOffset, location.valueLength, "ascii");
  return {
    bytes,
    mutation: {
      type: replacementByte === "0" ? "corrupt-startxref" : replacementByte === "9" ? "startxref-out-of-range" : "nonnumeric-startxref",
      offset: location.valueOffset,
      before: location.before,
      after,
    },
  };
}

function removeStartXrefSection(source) {
  const { markerOffset } = locateFinalStartXref(source);
  const eofOffset = source.lastIndexOf(Buffer.from("%%EOF", "ascii"));
  if (eofOffset < 0 || eofOffset <= markerOffset) throw new Error("No final PDF EOF marker found after startxref.");
  return {
    bytes: Buffer.concat([source.subarray(0, markerOffset), source.subarray(eofOffset)]),
    mutation: { type: "remove-startxref-section", offset: markerOffset, removedByteLength: eofOffset - markerOffset },
  };
}

function appendTrailingPdfBytes(source) {
  const appended = Buffer.from("EXTERNAL_HOLDOUT_TRAILING_BYTES", "ascii");
  return {
    bytes: Buffer.concat([source, appended]),
    mutation: { type: "append-trailing-bytes-after-eof", offset: source.byteLength, appendedByteLength: appended.byteLength, appendedSha256: sha256(appended) },
  };
}

function finalJpegEoiOffset(source) {
  const offset = source.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (offset < 0) throw new Error("No JPEG EOI marker found.");
  return offset;
}

function removeJpegEoi(source) {
  const offset = finalJpegEoiOffset(source);
  return {
    bytes: source.subarray(0, offset),
    mutation: { type: "remove-final-eoi", offset, removedByteLength: source.byteLength - offset },
  };
}

function corruptJpegEoi(source) {
  const offset = finalJpegEoiOffset(source);
  const bytes = Buffer.from(source);
  bytes[offset + 1] = 0xd8;
  return {
    bytes,
    mutation: { type: "corrupt-final-eoi", offset, beforeHex: "ffd9", afterHex: "ffd8" },
  };
}

function appendTrailingJpegBytes(source) {
  const appended = Buffer.from("EXTERNAL_HOLDOUT_TRAILING_BYTES", "ascii");
  return {
    bytes: Buffer.concat([source, appended]),
    mutation: { type: "append-trailing-bytes-after-eoi", offset: source.byteLength, appendedByteLength: appended.byteLength, appendedSha256: sha256(appended) },
  };
}

function findPngChunk(source, type) {
  let offset = 8;
  while (offset + 12 <= source.byteLength) {
    const length = source.readUInt32BE(offset);
    const chunkType = source.toString("ascii", offset + 4, offset + 8);
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    if (crcOffset + 4 > source.byteLength) throw new Error(`Truncated PNG chunk ${chunkType}.`);
    if (chunkType === type) return { offset, length, dataOffset, crcOffset };
    offset = crcOffset + 4;
  }
  throw new Error(`PNG chunk ${type} not found.`);
}

function removePngIend(source) {
  const chunk = findPngChunk(source, "IEND");
  return {
    bytes: source.subarray(0, chunk.offset),
    mutation: { type: "remove-iend", offset: chunk.offset, removedByteLength: source.byteLength - chunk.offset },
  };
}

function corruptPngCrc(source, type) {
  const chunk = findPngChunk(source, type);
  const bytes = Buffer.from(source);
  const offset = chunk.crcOffset + 3;
  const before = bytes[offset];
  bytes[offset] ^= 0x01;
  return {
    bytes,
    mutation: {
      type: `corrupt-${type.toLowerCase()}-crc`,
      offset,
      beforeHex: before.toString(16).padStart(2, "0"),
      afterHex: bytes[offset].toString(16).padStart(2, "0"),
    },
  };
}

const sourceDefinitions = [
  {
    id: "qpdf-form",
    format: "pdf",
    file: "sources/pdf/qpdf-form.pdf",
    repository: "qpdf/qpdf",
    commit: "babad179ce5db9a21635c8d1ac17baa59637eada",
    upstreamPath: "qpdf/qtest/storage/form.pdf",
    license: "Apache-2.0",
    licenseFile: "licenses/qpdf-Apache-2.0.txt",
  },
  {
    id: "qpdf-11-pages",
    format: "pdf",
    file: "sources/pdf/qpdf-11-pages.pdf",
    repository: "qpdf/qpdf",
    commit: "babad179ce5db9a21635c8d1ac17baa59637eada",
    upstreamPath: "qpdf/qtest/qpdf/11-pages.pdf",
    license: "Apache-2.0",
    licenseFile: "licenses/qpdf-Apache-2.0.txt",
  },
  {
    id: "qpdf-issue-179",
    format: "pdf",
    file: "sources/pdf/qpdf-issue-179.pdf",
    repository: "qpdf/qpdf",
    commit: "babad179ce5db9a21635c8d1ac17baa59637eada",
    upstreamPath: "examples/qtest/bookmarks/issue-179.pdf",
    license: "Apache-2.0",
    licenseFile: "licenses/qpdf-Apache-2.0.txt",
  },
  {
    id: "ijg-testorig",
    format: "jpeg",
    file: "sources/jpeg/ijg-testorig.jpg",
    repository: "libjpeg-turbo/libjpeg-turbo",
    commit: "b9132f0ad099e06d951867e2b6f3d358eebc1f19",
    upstreamPath: "testimages/testorig.jpg",
    license: "IJG",
    licenseFile: "licenses/IJG-README.txt",
  },
  {
    id: "ijg-testimgint",
    format: "jpeg",
    file: "sources/jpeg/ijg-testimgint.jpg",
    repository: "libjpeg-turbo/libjpeg-turbo",
    commit: "b9132f0ad099e06d951867e2b6f3d358eebc1f19",
    upstreamPath: "testimages/testimgint.jpg",
    license: "IJG",
    licenseFile: "licenses/IJG-README.txt",
  },
  {
    id: "ijg-testimgari",
    format: "jpeg",
    file: "sources/jpeg/ijg-testimgari.jpg",
    repository: "libjpeg-turbo/libjpeg-turbo",
    commit: "b9132f0ad099e06d951867e2b6f3d358eebc1f19",
    upstreamPath: "testimages/testimgari.jpg",
    license: "IJG",
    licenseFile: "licenses/IJG-README.txt",
  },
  {
    id: "pngsuite-basn2c08",
    format: "png",
    file: "sources/png/pngsuite-basn2c08.png",
    repository: "pnggroup/libpng",
    commit: "d1d0abeffede1cc898ddc3d0e600839cf026d749",
    upstreamPath: "contrib/pngsuite/basn2c08.png",
    license: "PngSuite permission grant",
    licenseFile: "licenses/pngsuite-README.txt",
  },
  {
    id: "pngsuite-basn3p08",
    format: "png",
    file: "sources/png/pngsuite-basn3p08.png",
    repository: "pnggroup/libpng",
    commit: "d1d0abeffede1cc898ddc3d0e600839cf026d749",
    upstreamPath: "contrib/pngsuite/basn3p08.png",
    license: "PngSuite permission grant",
    licenseFile: "licenses/pngsuite-README.txt",
  },
  {
    id: "pngsuite-basn6a16",
    format: "png",
    file: "sources/png/pngsuite-basn6a16.png",
    repository: "pnggroup/libpng",
    commit: "d1d0abeffede1cc898ddc3d0e600839cf026d749",
    upstreamPath: "contrib/pngsuite/basn6a16.png",
    license: "PngSuite permission grant",
    licenseFile: "licenses/pngsuite-README.txt",
  },
];

const caseDefinitions = [
  { id: "qpdf-form-corrupt-startxref", sourceId: "qpdf-form", mutate: (source) => replaceStartXref(source, "0") },
  { id: "qpdf-form-missing-eof", sourceId: "qpdf-form", mutate: removeFinalPdfEof },
  { id: "qpdf-11-pages-missing-startxref", sourceId: "qpdf-11-pages", mutate: removeStartXrefSection },
  { id: "qpdf-11-pages-trailing-bytes", sourceId: "qpdf-11-pages", mutate: appendTrailingPdfBytes },
  { id: "qpdf-issue-179-startxref-out-of-range", sourceId: "qpdf-issue-179", mutate: (source) => replaceStartXref(source, "9") },
  { id: "qpdf-issue-179-nonnumeric-startxref", sourceId: "qpdf-issue-179", mutate: (source) => replaceStartXref(source, "x") },
  { id: "ijg-testorig-corrupt-eoi", sourceId: "ijg-testorig", mutate: corruptJpegEoi },
  { id: "ijg-testorig-trailing-bytes", sourceId: "ijg-testorig", mutate: appendTrailingJpegBytes },
  { id: "ijg-testimgint-missing-eoi", sourceId: "ijg-testimgint", mutate: removeJpegEoi },
  { id: "ijg-testimgint-trailing-bytes", sourceId: "ijg-testimgint", mutate: appendTrailingJpegBytes },
  { id: "ijg-testimgari-corrupt-eoi", sourceId: "ijg-testimgari", mutate: corruptJpegEoi },
  { id: "ijg-testimgari-missing-eoi", sourceId: "ijg-testimgari", mutate: removeJpegEoi },
  { id: "pngsuite-rgb8-missing-iend", sourceId: "pngsuite-basn2c08", mutate: removePngIend },
  { id: "pngsuite-rgb8-corrupt-iend-crc", sourceId: "pngsuite-basn2c08", mutate: (source) => corruptPngCrc(source, "IEND") },
  { id: "pngsuite-palette8-corrupt-idat-crc", sourceId: "pngsuite-basn3p08", mutate: (source) => corruptPngCrc(source, "IDAT") },
  { id: "pngsuite-palette8-corrupt-ihdr-crc", sourceId: "pngsuite-basn3p08", mutate: (source) => corruptPngCrc(source, "IHDR") },
  { id: "pngsuite-rgba16-missing-iend", sourceId: "pngsuite-basn6a16", mutate: removePngIend },
  { id: "pngsuite-rgba16-corrupt-iend-crc", sourceId: "pngsuite-basn6a16", mutate: (source) => corruptPngCrc(source, "IEND") },
];

const sourceMap = new Map();
const sources = [];
for (const definition of sourceDefinitions) {
  const fileUrl = new URL(definition.file, benchmarkRoot);
  const bytes = await readFile(fileUrl);
  const groundTruth = definition.format === "pdf" ? await inspectPdf(bytes) : await inspectRaster(bytes);
  const row = {
    ...definition,
    upstreamUrl: `https://github.com/${definition.repository}/blob/${definition.commit}/${definition.upstreamPath}`,
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    groundTruth,
  };
  sourceMap.set(definition.id, { ...row, bytes });
  sources.push(row);
}

const cases = [];
for (const definition of caseDefinitions) {
  const source = sourceMap.get(definition.sourceId);
  if (!source) throw new Error(`Unknown source ${definition.sourceId}.`);
  const { bytes, mutation } = definition.mutate(source.bytes);
  const extension = source.format === "jpeg" ? "jpg" : source.format;
  const relativeFile = `cases/${source.format}/${definition.id}.${extension}`;
  const fileUrl = new URL(relativeFile, benchmarkRoot);
  await mkdir(new URL(`cases/${source.format}/`, benchmarkRoot), { recursive: true });
  await writeFile(fileUrl, bytes);
  cases.push({
    id: definition.id,
    format: source.format,
    sourceId: source.id,
    sourceSha256: source.sha256,
    file: relativeFile,
    fileName: basename(fileUrl.pathname),
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    mutation,
    expected: {
      outcome: "exact-source-content",
      groundTruth: source.groundTruth,
    },
  });
}

const manifest = {
  schemaVersion: 1,
  kind: "stillopen-external-source-blind-holdout",
  frozenDate: "2026-08-10",
  generatorVersion: "external-holdout-v1",
  blindPolicy: "Source selection, source fingerprints, mutations, and exact-content ground truth were frozen before StillOpen or competitor execution on this holdout.",
  scope: "Nine permissively licensed upstream source files; eighteen content-preserving structural mutations; six cases per format.",
  expectedOutcome: "Every mutation retains the original page or pixel content, so a passing recovery must independently match the untouched source exactly.",
  sources,
  cases,
};

await writeFile(new URL("manifest.json", benchmarkRoot), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Frozen ${sources.length} external sources and ${cases.length} blind holdout cases.`);
