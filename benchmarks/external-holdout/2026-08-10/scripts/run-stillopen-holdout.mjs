import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  loadStillOpenCore,
  recoverJpegWithCore,
  recoverPdfWithCore,
  recoverPngWithCore,
  scanWithCore,
} from "../../../../tests/helpers/stillopen-wasm.mjs";

const benchmarkRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", benchmarkRoot), "utf8"));
const outputRoot = new URL("outputs/stillopen/", benchmarkRoot);
const cleanupCallbacks = [];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function inspectRaster(bytes) {
  const image = await loadImage(Buffer.from(bytes));
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

function compareGroundTruth(actual, expected, format) {
  if (format !== "pdf") {
    return {
      pass: actual.width === expected.width
        && actual.height === expected.height
        && actual.rgbaSha256 === expected.rgbaSha256,
      checks: {
        dimensions: actual.width === expected.width && actual.height === expected.height,
        exactDecodedPixels: actual.rgbaSha256 === expected.rgbaSha256,
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
  return {
    pass: pageCount && pageDimensions && exactPageRenders && exactExtractedText,
    checks: { pageCount, pageDimensions, exactPageRenders, exactExtractedText },
  };
}

function recover(core, format, bytes) {
  if (format === "pdf") return recoverPdfWithCore(core, bytes);
  if (format === "jpeg") return recoverJpegWithCore(core, bytes);
  if (format === "png") return recoverPngWithCore(core, bytes);
  throw new Error(`Unsupported format: ${format}`);
}

function compactReport(report) {
  if (!report || typeof report !== "object") return report;
  const keys = [
    "success",
    "issueCode",
    "outcome",
    "message",
    "verifiedPageCount",
    "width",
    "height",
    "inputRepaired",
    "losslessTranscode",
    "structurallyComplete",
    "crcErrors",
    "rowsSurvived",
    "rowsMissing",
  ];
  return Object.fromEntries(keys.filter((key) => key in report).map((key) => [key, report[key]]));
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const core = await loadStillOpenCore({ after(callback) { cleanupCallbacks.push(callback); } });
const results = [];

try {
  for (const testCase of manifest.cases) {
    const source = manifest.sources.find((candidate) => candidate.id === testCase.sourceId);
    if (!source) throw new Error(`Missing source metadata for ${testCase.sourceId}.`);
    const input = new Uint8Array(await readFile(new URL(testCase.file, benchmarkRoot)));
    const row = {
      id: testCase.id,
      format: testCase.format,
      sourceId: testCase.sourceId,
      mutation: testCase.mutation.type,
      inputByteLength: input.byteLength,
      inputSha256: sha256(input),
      expectedInputSha256: testCase.sha256,
      provenancePass: sha256(input) === testCase.sha256,
    };
    try {
      const scan = scanWithCore(core, input, basename(testCase.file));
      row.scan = {
        status: scan.status,
        detectedFormat: scan.detectedFormat?.id ?? null,
        primaryIssueCode: scan.diagnostics?.[0]?.issueCode ?? null,
      };
      const recovered = recover(core, testCase.format, input);
      row.recoveryReport = compactReport(recovered.report);
      const output = recovered.bytes;
      if (!(output instanceof Uint8Array) || output.byteLength === 0) {
        row.disposition = recovered.report?.success === false ? "safe-refusal" : "no-output";
        row.exactGroundTruthPass = false;
      } else {
        const extension = testCase.format === "jpeg" ? "jpg" : testCase.format;
        const outputFile = `outputs/stillopen/${testCase.id}.${extension}`;
        await writeFile(new URL(outputFile, benchmarkRoot), output);
        row.output = {
          file: outputFile,
          byteLength: output.byteLength,
          sha256: sha256(output),
        };
        try {
          const inspected = testCase.format === "pdf"
            ? await inspectPdf(output)
            : await inspectRaster(output);
          row.validation = compareGroundTruth(inspected, source.groundTruth, testCase.format);
          row.exactGroundTruthPass = row.validation.pass;
          row.disposition = row.validation.pass ? "exact-content-recovery" : "changed-content-output";
        } catch (error) {
          row.validationError = error instanceof Error ? error.message : String(error);
          row.exactGroundTruthPass = false;
          row.disposition = "unreadable-output";
        }
      }
    } catch (error) {
      row.executionError = error instanceof Error ? error.message : String(error);
      row.exactGroundTruthPass = false;
      row.disposition = "recovery-error";
    }
    results.push(row);
    process.stdout.write(`${row.exactGroundTruthPass ? "PASS" : "FAIL"} ${row.id} (${row.disposition})\n`);
  }
} finally {
  for (const cleanup of cleanupCallbacks.reverse()) await cleanup();
}

const byFormat = Object.fromEntries(["pdf", "jpeg", "png"].map((format) => {
  const rows = results.filter((row) => row.format === format);
  return [format, {
    passed: rows.filter((row) => row.exactGroundTruthPass).length,
    total: rows.length,
  }];
}));
const passed = results.filter((row) => row.exactGroundTruthPass).length;
const resultDocument = {
  schemaVersion: 1,
  benchmark: manifest.kind,
  frozenDate: manifest.frozenDate,
  executedDate: "2026-08-10",
  product: "StillOpen",
  validator: "Independent strict decode/render plus exact source-content fingerprints",
  passDefinition: "Recovered output must match the untouched upstream source exactly: dimensions and decoded RGBA pixels for raster files; page count, page dimensions, rendered RGBA pixels, and extracted text for PDFs.",
  summary: { passed, total: results.length, passRate: results.length ? passed / results.length : 0, byFormat },
  results,
};
await writeFile(new URL("stillopen-results.json", benchmarkRoot), `${JSON.stringify(resultDocument, null, 2)}\n`);
process.stdout.write(`StillOpen exact-content score: ${passed}/${results.length}.\n`);
