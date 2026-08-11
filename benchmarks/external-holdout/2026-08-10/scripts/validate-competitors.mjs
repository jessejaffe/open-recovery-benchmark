import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const benchmarkRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", benchmarkRoot), "utf8"));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

function comparePdf(actual, expected) {
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

const uiRuns = [
  { competitor: "zpdf", caseId: "qpdf-form-corrupt-startxref", uiOutcome: "refused", uiEvidence: "Unable to repair the PDF file." },
  { competitor: "zpdf", caseId: "qpdf-form-missing-eof", uiOutcome: "success", uiEvidence: "PDF repaired successfully!", outputFile: "outputs/zpdf/qpdf-form-missing-eof.pdf" },
  { competitor: "zpdf", caseId: "qpdf-11-pages-missing-startxref", uiOutcome: "refused", uiEvidence: "Unable to repair the PDF file." },
  { competitor: "zpdf", caseId: "qpdf-11-pages-trailing-bytes", uiOutcome: "success", uiEvidence: "PDF repaired successfully!", outputFile: "outputs/zpdf/qpdf-11-pages-trailing-bytes.pdf" },
  { competitor: "zpdf", caseId: "qpdf-issue-179-startxref-out-of-range", uiOutcome: "refused", uiEvidence: "Unable to repair the PDF file." },
  { competitor: "zpdf", caseId: "qpdf-issue-179-nonnumeric-startxref", uiOutcome: "refused", uiEvidence: "Unable to repair the PDF file." },
  { competitor: "iLovePDF", caseId: "qpdf-form-corrupt-startxref", uiOutcome: "success", uiEvidence: "This task has been processed successfully.", outputFile: "outputs/ilovepdf/qpdf-form-corrupt-startxref.pdf" },
  { competitor: "iLovePDF", caseId: "qpdf-form-missing-eof", uiOutcome: "success", uiEvidence: "This task has been processed successfully.", outputFile: "outputs/ilovepdf/qpdf-form-missing-eof.pdf" },
  { competitor: "iLovePDF", caseId: "qpdf-11-pages-missing-startxref", uiOutcome: "refused", uiEvidence: "Oh no! We couldn't process your files." },
  { competitor: "iLovePDF", caseId: "qpdf-11-pages-trailing-bytes", uiOutcome: "refused", uiEvidence: "Oh no! We couldn't process your files." },
  { competitor: "iLovePDF", caseId: "qpdf-issue-179-startxref-out-of-range", uiOutcome: "refused", uiEvidence: "Oh no! We couldn't process your files." },
  { competitor: "iLovePDF", caseId: "qpdf-issue-179-nonnumeric-startxref", uiOutcome: "refused", uiEvidence: "Oh no! We couldn't process your files." },
];

const results = [];
for (const uiRun of uiRuns) {
  const testCase = manifest.cases.find((candidate) => candidate.id === uiRun.caseId);
  const source = manifest.sources.find((candidate) => candidate.id === testCase?.sourceId);
  if (!testCase || !source) throw new Error(`Missing manifest metadata for ${uiRun.caseId}.`);
  const row = {
    ...uiRun,
    format: testCase.format,
    sourceId: testCase.sourceId,
    exactGroundTruthPass: false,
    disposition: uiRun.uiOutcome === "refused" ? "safe-refusal" : "unvalidated-success",
  };
  if (uiRun.outputFile) {
    try {
      const bytes = await readFile(new URL(uiRun.outputFile, benchmarkRoot));
      row.output = { file: uiRun.outputFile, byteLength: bytes.byteLength, sha256: sha256(bytes) };
      const validation = comparePdf(await inspectPdf(bytes), source.groundTruth);
      row.validation = validation;
      row.exactGroundTruthPass = validation.pass;
      row.disposition = validation.pass ? "exact-content-recovery" : "changed-content-output";
    } catch (error) {
      row.disposition = "unreadable-or-missing-output";
      row.validationError = error instanceof Error ? error.message : String(error);
    }
  }
  results.push(row);
}

const competitors = ["zpdf", "iLovePDF"].map((competitor) => {
  const rows = results.filter((row) => row.competitor === competitor);
  return {
    competitor,
    passed: rows.filter((row) => row.exactGroundTruthPass).length,
    total: rows.length,
    uiSuccesses: rows.filter((row) => row.uiOutcome === "success").length,
    refusals: rows.filter((row) => row.uiOutcome === "refused").length,
  };
});

const document = {
  schemaVersion: 1,
  benchmark: manifest.kind,
  executedDate: "2026-08-10",
  scope: "Six frozen external PDF cases. Only vendors that completed a consistent no-account PDF workflow were scored.",
  passDefinition: "A vendor UI success counts only if the downloaded output independently matches the untouched upstream source's page count, page dimensions, rendered RGBA fingerprints, and extracted-text fingerprints.",
  competitors,
  results,
  sources: [
    "https://zpdf.app/en/tools/repair-pdf",
    "https://www.ilovepdf.com/repair-pdf",
  ],
};

await writeFile(new URL("competitor-results.json", benchmarkRoot), `${JSON.stringify(document, null, 2)}\n`);
for (const competitor of competitors) {
  process.stdout.write(`${competitor.competitor}: ${competitor.passed}/${competitor.total} exact-content recoveries (${competitor.uiSuccesses} UI successes, ${competitor.refusals} refusals).\n`);
}
