import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyPublication } from "../lib/publisher.mjs";

const repositoryRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const publicationRoot = path.join(repositoryRoot, "public", "benchmarks", "open-recovery-holdout");

test("published external holdout contains 18 independently verified recoveries", async () => {
  const verification = await verifyPublication(publicationRoot);
  assert.equal(verification.ok, true);
  assert.equal(verification.filesVerified, 116);

  const report = JSON.parse(await readFile(path.join(publicationRoot, "report.json"), "utf8"));
  assert.deepEqual(report.summary, {
    eligibleCases: 18,
    verifiedPasses: 18,
    changedOutputs: 0,
    refusals: 0,
    unavailable: 0,
    errors: 0,
    competitiveSummaryEligible: true,
  });
  assert.equal(report.cases.filter((item) => item.validation.validator === "pdf-render-text-v1").length, 6);
  assert.equal(report.cases.filter((item) => item.validation.validator === "raster-rgba-v1").length, 12);
  for (const item of report.cases) {
    assert.equal(item.disposition, "verified-pass");
    assert.equal(item.observation.terminalOutcomeEligible, true);
    assert.equal(item.validation.pass, true);
  }
  for (const item of report.cases.filter((candidate) => candidate.format === "pdf")) {
    assert.deepEqual({
      pageCount: item.validation.checks.pageCount,
      pageDimensions: item.validation.checks.pageDimensions,
      exactPageRenders: item.validation.checks.exactPageRenders,
      exactExtractedText: item.validation.checks.exactExtractedText,
    }, {
      pageCount: true,
      pageDimensions: true,
      exactPageRenders: true,
      exactExtractedText: true,
    });
  }
});

test("published external holdout rejects changed nested output evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stillopen-holdout-publication-"));
  const copyRoot = path.join(root, "publication");
  await cp(publicationRoot, copyRoot, { recursive: true });
  await writeFile(
    path.join(copyRoot, "run", "cases", "qpdf-form-corrupt-startxref", "tool-output", "recovered.bin"),
    "tampered PDF output\n",
  );
  await assert.rejects(verifyPublication(copyRoot), /Publication verification failed/);
});
