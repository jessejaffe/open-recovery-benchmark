#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import {
  loadStillOpenCore,
  recoverJpegWithCore,
  recoverPdfWithCore,
  recoverPngWithCore,
  recoverZipWithCore,
  scanProductWithCore,
} from "../../tests/helpers/stillopen-wasm.mjs";

function options(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith("--") || values[index + 1] === undefined) throw new Error(`Invalid option ${key ?? "<missing>"}.`);
    result[key.slice(2)] = values[index + 1];
  }
  return result;
}

function required(value, label) {
  if (!value) throw new Error(`Missing --${label}.`);
  return value;
}

function detectFormat(bytes) {
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
  throw new Error("The StillOpen benchmark adapter could not identify the input format.");
}

function recover(core, bytes, format) {
  if (format === "pdf") return recoverPdfWithCore(core, bytes);
  if (format === "png") return recoverPngWithCore(core, bytes);
  if (format === "zip") return recoverZipWithCore(core, bytes);
  return recoverJpegWithCore(core, bytes);
}

const flags = options(process.argv.slice(2));
const inputPath = required(flags.input, "input");
const outputPath = required(flags.output, "output");
const input = await readFile(inputPath);
const detectedFormat = detectFormat(input);
const format = flags.format ?? detectedFormat;
if (format !== detectedFormat) throw new Error(`Declared format ${format} does not match detected format ${detectedFormat}.`);

const cleanupCallbacks = [];
const core = await loadStillOpenCore({ after(callback) { cleanupCallbacks.push(callback); } });
try {
  const scanFilename = `benchmark-input.${format === "jpeg" ? "jpg" : format}`;
  const scan = scanProductWithCore(core, new Uint8Array(input), scanFilename);
  if (scan.status === "healthy") {
    process.stdout.write(`${JSON.stringify({
      outcome: "healthy-no-action",
      status: scan.status,
      format,
      outputByteLength: 0,
    })}\n`);
    process.exitCode = 3;
  } else {
    const recovered = recover(core, new Uint8Array(input), format);
    const outputBytes = format === "jpeg" && recovered.pngBytes instanceof Uint8Array && recovered.pngBytes.byteLength > 0
      ? recovered.pngBytes
      : recovered.bytes;
    if (!recovered.report?.success || !(outputBytes instanceof Uint8Array) || outputBytes.byteLength === 0) {
      process.stderr.write(`${JSON.stringify(recovered.report ?? { success: false })}\n`);
      process.exitCode = 2;
    } else {
      await writeFile(outputPath, outputBytes, { flag: "wx" });
      process.stdout.write(`${JSON.stringify({
        success: true,
        format,
        issueCode: recovered.report.issueCode ?? null,
        outputFormat: format === "jpeg" && outputBytes === recovered.pngBytes ? "png" : format,
        outputByteLength: outputBytes.byteLength,
      })}\n`);
    }
  }
} finally {
  for (const cleanup of cleanupCallbacks.reverse()) await cleanup();
}
