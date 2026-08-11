import { readFile } from "node:fs/promises";
import { sha256 } from "./canonical.mjs";

export const SUPPORTED_VALIDATORS = Object.freeze([
  "exact-sha256-v1",
  "raster-rgba-v1",
  "pdf-render-text-v1",
]);

export function isSupportedValidator(value) {
  return SUPPORTED_VALIDATORS.includes(value);
}

export function missingOutputValidation(validator) {
  return { validator, pass: false, checks: { outputPresent: false } };
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
      checks: {
        groundTruthReadable: true,
        outputReadable: false,
      },
    };
  }
  const dimensions = actual.width === expected.width && actual.height === expected.height;
  const exactDecodedPixels = actual.rgbaSha256 === expected.rgbaSha256;
  return {
    validator: "raster-rgba-v1",
    pass: dimensions && exactDecodedPixels,
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
  return {
    validator: "pdf-render-text-v1",
    pass: pageCount && pageDimensions && exactPageRenders && exactExtractedText,
    checks: {
      groundTruthReadable: true,
      outputReadable: true,
      expectedPageCount: expected.pageCount,
      actualPageCount: actual.pageCount,
      pageCount,
      pageDimensions,
      exactPageRenders,
      exactExtractedText,
    },
  };
}

const VALIDATORS = Object.freeze({
  "exact-sha256-v1": exactSha256,
  "raster-rgba-v1": rasterRgba,
  "pdf-render-text-v1": pdfRenderText,
});

export async function validateCapturedOutput({ validator, outputPath, output, groundTruthPath, groundTruth }) {
  const implementation = VALIDATORS[validator];
  if (!implementation) throw new Error(`Unsupported independent validator ${validator}.`);
  return implementation({ outputPath, output, groundTruthPath, groundTruth });
}
