import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

export async function loadStillOpenCore(context) {
  const wasmBytes = await readFile(new URL("../../public/wasm/stillopen-core.wasm", import.meta.url));
  const server = createServer((request, response) => {
    if (request.url !== "/stillopen-core.wasm") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/wasm",
      "Content-Length": wasmBytes.byteLength,
    });
    response.end(wasmBytes);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("The local WebAssembly fixture server did not start.");
  }
  const moduleUrl = new URL("../../public/wasm/stillopen-core.mjs", import.meta.url);
  moduleUrl.searchParams.set("fixture-test", `${process.pid}-${Date.now()}`);
  const { default: createModule } = await import(moduleUrl.href);
  return createModule({
    locateFile: (path) => `http://127.0.0.1:${address.port}/${path}`,
  });
}

export function scanWithCore(core, sample, filename) {
  const extensionOffset = filename.lastIndexOf(".");
  const extension = extensionOffset >= 0 ? filename.slice(extensionOffset) : "";
  const handle = core.ccall(
    "so_scan_create",
    "number",
    ["string", "string", "string", "string", "number", "number", "string"],
    [`fixtures/${filename}`, filename, filename, extension, sample.byteLength, 0, ""],
  );
  if (!handle) throw new Error(`The scan engine did not start for ${filename}.`);

  const pointer = core._malloc(sample.byteLength);
  if (!pointer && sample.byteLength > 0) {
    core.ccall("so_scan_destroy", null, ["number"], [handle]);
    throw new Error(`The scan engine could not allocate ${sample.byteLength} bytes for ${filename}.`);
  }
  try {
    core.writeArrayToMemory(sample, pointer);
    const accepted = core.ccall(
      "so_scan_update",
      "number",
      ["number", "number", "number"],
      [handle, pointer, sample.byteLength],
    );
    if (accepted !== 1) throw new Error(`The scan engine rejected ${filename}.`);
  } finally {
    core._free(pointer);
  }

  const resultPointer = core.ccall("so_scan_finish", "number", ["number"], [handle]);
  try {
    if (!resultPointer) throw new Error(`The scan engine returned no result for ${filename}.`);
    return JSON.parse(core.UTF8ToString(resultPointer));
  } finally {
    if (resultPointer) core.ccall("so_string_free", null, ["number"], [resultPointer]);
    core.ccall("so_scan_destroy", null, ["number"], [handle]);
  }
}

export function scanProductWithCore(core, sample, filename) {
  const scan = scanWithCore(core, sample, filename);
  if (scan.detectedFormat.id === "pdf" && scan.status !== "unreadable") {
    const { report } = recoverPdfWithCore(core, sample);
    if (report.damageDetected) {
      return {
        ...scan,
        status: "damaged",
        diagnostics: [{ issueCode: scan.diagnostics?.[0]?.issueCode ?? report.issueCode }],
      };
    }
  }
  if (scan.detectedFormat.id === "png" && scan.status !== "unreadable") {
    const { report } = recoverPngWithCore(core, sample);
    if (!report.structurallyComplete) {
      return {
        ...scan,
        status: "damaged",
        diagnostics: [{ issueCode: report.issueCode }],
      };
    }
  }
  if (scan.detectedFormat.id === "zip" && scan.status !== "unreadable") {
    const { report } = recoverZipWithCore(core, sample);
    if (!report.structurallyComplete) {
      return {
        ...scan,
        status: "damaged",
        diagnostics: [{ issueCode: report.issueCode }],
      };
    }
  }
  if (scan.detectedFormat.id === "jpeg" && scan.status !== "unreadable") {
    const report = analyzeJpegWithCore(core, sample);
    if (!report.complete) {
      return {
        ...scan,
        status: "damaged",
        diagnostics: [{ issueCode: scan.diagnostics?.[0]?.issueCode ?? "JPEG_DECODE_INCOMPLETE" }],
      };
    }
  }
  return scan;
}

function recoverWithCore(core, sample, configuration) {
  const pointer = core._malloc(sample.byteLength);
  if (!pointer && sample.byteLength > 0) {
    throw new Error(`The ${configuration.label} recovery engine could not allocate ${sample.byteLength} bytes.`);
  }
  let handle = 0;
  try {
    core.writeArrayToMemory(sample, pointer);
    handle = core.ccall(
      configuration.recoverFunction,
      "number",
      ["number", "number"],
      [pointer, sample.byteLength],
    );
    if (!handle) throw new Error(`The ${configuration.label} recovery engine did not start.`);
    const reportPointer = core.ccall(configuration.reportFunction, "number", ["number"], [handle]);
    if (!reportPointer) throw new Error(`The ${configuration.label} recovery engine returned no report.`);
    let report;
    try {
      report = JSON.parse(core.UTF8ToString(reportPointer));
    } finally {
      core.ccall("so_string_free", null, ["number"], [reportPointer]);
    }
    const result = { report };
    for (const output of configuration.outputs) {
      const dataPointer = core.ccall(output.dataFunction, "number", ["number"], [handle]);
      const dataSize = core.ccall(output.sizeFunction, "number", ["number"], [handle]);
      result[output.property] = dataPointer && dataSize > 0
        ? core.HEAPU8.slice(dataPointer, dataPointer + dataSize)
        : new Uint8Array();
    }
    return result;
  } finally {
    if (handle) core.ccall(configuration.destroyFunction, null, ["number"], [handle]);
    core._free(pointer);
  }
}

export function recoverPdfWithCore(core, sample) {
  return recoverWithCore(core, sample, {
    label: "PDF",
    recoverFunction: "so_pdf_recover",
    reportFunction: "so_pdf_recovery_json",
    destroyFunction: "so_pdf_recovery_destroy",
    outputs: [
      { property: "bytes", dataFunction: "so_pdf_recovery_data", sizeFunction: "so_pdf_recovery_size" },
    ],
  });
}

export function recoverPngWithCore(core, sample) {
  return recoverWithCore(core, sample, {
    label: "PNG",
    recoverFunction: "so_png_recover",
    reportFunction: "so_png_recovery_json",
    destroyFunction: "so_png_recovery_destroy",
    outputs: [
      { property: "bytes", dataFunction: "so_png_recovery_data", sizeFunction: "so_png_recovery_size" },
    ],
  });
}

export function recoverZipWithCore(core, sample) {
  return recoverWithCore(core, sample, {
    label: "ZIP",
    recoverFunction: "so_zip_recover",
    reportFunction: "so_zip_recovery_json",
    destroyFunction: "so_zip_recovery_destroy",
    outputs: [
      { property: "bytes", dataFunction: "so_zip_recovery_data", sizeFunction: "so_zip_recovery_size" },
    ],
  });
}

export function recoverJpegWithCore(core, sample) {
  return recoverWithCore(core, sample, {
    label: "JPEG",
    recoverFunction: "so_jpeg_recover",
    reportFunction: "so_jpeg_recovery_json",
    destroyFunction: "so_jpeg_recovery_destroy",
    outputs: [
      { property: "bytes", dataFunction: "so_jpeg_recovery_data", sizeFunction: "so_jpeg_recovery_size" },
      { property: "pngBytes", dataFunction: "so_jpeg_recovery_png_data", sizeFunction: "so_jpeg_recovery_png_size" },
      { property: "damageMapBytes", dataFunction: "so_jpeg_damage_map_data", sizeFunction: "so_jpeg_damage_map_size" },
    ],
  });
}

export function analyzeJpegWithCore(core, sample) {
  const pointer = core._malloc(sample.byteLength);
  if (!pointer && sample.byteLength > 0) {
    throw new Error(`The JPEG decoder could not allocate ${sample.byteLength} bytes.`);
  }
  try {
    core.writeArrayToMemory(sample, pointer);
    const reportPointer = core.ccall(
      "so_jpeg_analyze",
      "number",
      ["number", "number"],
      [pointer, sample.byteLength],
    );
    if (!reportPointer) throw new Error("The JPEG decoder returned no report.");
    try {
      return JSON.parse(core.UTF8ToString(reportPointer));
    } finally {
      core.ccall("so_string_free", null, ["number"], [reportPointer]);
    }
  } finally {
    core._free(pointer);
  }
}
