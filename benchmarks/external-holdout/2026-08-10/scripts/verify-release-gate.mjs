import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  loadStillOpenCore,
  recoverJpegWithCore,
  recoverPdfWithCore,
  recoverPngWithCore,
  scanProductWithCore,
} from "../../../../tests/helpers/stillopen-wasm.mjs";

const benchmarkRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", benchmarkRoot), "utf8"));
const cleanupCallbacks = [];
const failures = [];
const results = [];
let healthyFalsePositives = 0;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function inspectRaster(bytes) {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = Buffer.from(context.getImageData(0, 0, image.width, image.height).data);
  return { width: image.width, height: image.height, rgbaSha256: sha256(pixels) };
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
    return { pageCount: document.numPages, pages };
  } finally {
    await loadingTask.destroy();
  }
}

function exactContentMatches(actual, expected, format) {
  if (format !== "pdf") {
    return actual.width === expected.width
      && actual.height === expected.height
      && actual.rgbaSha256 === expected.rgbaSha256;
  }
  return actual.pageCount === expected.pageCount
    && actual.pages.every((page, index) => (
      page.width === expected.pages[index]?.width
      && page.height === expected.pages[index]?.height
      && page.rgbaSha256 === expected.pages[index]?.rgbaSha256
      && page.textSha256 === expected.pages[index]?.textSha256
    ));
}

function recover(core, format, bytes) {
  if (format === "pdf") return recoverPdfWithCore(core, bytes);
  if (format === "jpeg") return recoverJpegWithCore(core, bytes);
  if (format === "png") return recoverPngWithCore(core, bytes);
  throw new Error(`Unsupported holdout format: ${format}`);
}

function fail(scope, message) {
  failures.push(`${scope}: ${message}`);
}

if (manifest.kind !== "stillopen-external-source-blind-holdout") {
  fail("manifest", `unexpected corpus kind ${manifest.kind}`);
}
if (manifest.sources.length !== 9 || manifest.cases.length !== 18) {
  fail("manifest", `expected 9 sources and 18 cases, found ${manifest.sources.length} and ${manifest.cases.length}`);
}

const core = await loadStillOpenCore({ after(callback) { cleanupCallbacks.push(callback); } });
try {
  for (const source of manifest.sources) {
    const bytes = new Uint8Array(await readFile(new URL(source.file, benchmarkRoot)));
    const digest = sha256(bytes);
    if (bytes.byteLength !== source.byteLength) {
      fail(source.id, `source size changed: expected ${source.byteLength}, found ${bytes.byteLength}`);
    }
    if (digest !== source.sha256) fail(source.id, "source SHA-256 changed");

    try {
      const inspected = source.format === "pdf"
        ? await inspectPdf(bytes)
        : await inspectRaster(bytes);
      if (!exactContentMatches(inspected, source.groundTruth, source.format)) {
        fail(source.id, "frozen source no longer matches its independent content fingerprint");
      }
    } catch (error) {
      fail(source.id, `source validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const scan = scanProductWithCore(core, bytes, basename(source.file));
    const healthy = scan.status === "healthy" && scan.detectedFormat?.id === source.format;
    if (!healthy) {
      healthyFalsePositives += 1;
      fail(source.id, `healthy source was classified ${scan.status}/${scan.detectedFormat?.id ?? "unknown"}`);
    }
    process.stdout.write(`${healthy ? "PASS" : "FAIL"} healthy ${source.id}\n`);
  }

  for (const testCase of manifest.cases) {
    const source = manifest.sources.find((candidate) => candidate.id === testCase.sourceId);
    if (!source) {
      fail(testCase.id, `unknown source ${testCase.sourceId}`);
      continue;
    }
    const bytes = new Uint8Array(await readFile(new URL(testCase.file, benchmarkRoot)));
    if (sha256(bytes) !== testCase.sha256) fail(testCase.id, "case SHA-256 changed");

    let exactRecovery = false;
    let detectedDamage = false;
    try {
      const scan = scanProductWithCore(core, bytes, basename(testCase.file));
      detectedDamage = scan.status === "damaged" && scan.detectedFormat?.id === testCase.format;
      if (!detectedDamage) {
        fail(testCase.id, `damaged case was classified ${scan.status}/${scan.detectedFormat?.id ?? "unknown"}`);
      }

      const recovered = recover(core, testCase.format, bytes);
      if (!recovered.report?.success || recovered.bytes.byteLength === 0) {
        fail(testCase.id, "recovery did not produce a product-verified output");
      } else {
        const inspected = testCase.format === "pdf"
          ? await inspectPdf(recovered.bytes)
          : await inspectRaster(recovered.bytes);
        exactRecovery = exactContentMatches(inspected, source.groundTruth, testCase.format);
        if (!exactRecovery) fail(testCase.id, "recovered output changed independently decoded content");
        if (testCase.format === "png" && !recovered.report.losslessStructureRepair) {
          fail(testCase.id, "complete PNG pixel stream was not repaired in lossless structure mode");
          exactRecovery = false;
        }
      }
    } catch (error) {
      fail(testCase.id, error instanceof Error ? error.message : String(error));
    }
    results.push({ format: testCase.format, detectedDamage, exactRecovery });
    process.stdout.write(`${detectedDamage && exactRecovery ? "PASS" : "FAIL"} damaged ${testCase.id}\n`);
  }
} finally {
  for (const cleanup of cleanupCallbacks.reverse()) await cleanup();
}

const detected = results.filter((result) => result.detectedDamage).length;
const exact = results.filter((result) => result.exactRecovery).length;
const byFormat = Object.fromEntries(["pdf", "jpeg", "png"].map((format) => {
  const rows = results.filter((result) => result.format === format);
  return [format, `${rows.filter((result) => result.exactRecovery).length}/${rows.length}`];
}));

process.stdout.write(
  `Holdout release gate: ${healthyFalsePositives}/${manifest.sources.length} healthy false positives; `
  + `${detected}/${manifest.cases.length} damaged cases detected; `
  + `${exact}/${manifest.cases.length} exact recoveries `
  + `(PDF ${byFormat.pdf}, JPEG ${byFormat.jpeg}, PNG ${byFormat.png}).\n`,
);

if (failures.length > 0) {
  process.stderr.write(`Release gate failed with ${failures.length} violation(s):\n`);
  for (const failure of failures) process.stderr.write(`- ${failure}\n`);
  process.exitCode = 1;
}
