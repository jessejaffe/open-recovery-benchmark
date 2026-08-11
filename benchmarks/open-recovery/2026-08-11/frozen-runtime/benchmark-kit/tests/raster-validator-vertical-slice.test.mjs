import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hashFile } from "../lib/files.mjs";
import { publishRun, verifyPublication } from "../lib/publisher.mjs";
import { executeBenchmark, verifyRun } from "../lib/runner.mjs";

const kitRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.dirname(kitRoot);
const holdoutRoot = path.join(repositoryRoot, "benchmarks", "external-holdout", "2026-08-10");

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function sliceInputs(root) {
  const definitionRoot = path.join(root, "definition");
  const caseRoot = path.join(definitionRoot, "cases");
  const truthRoot = path.join(definitionRoot, "ground-truth");
  await Promise.all([mkdir(caseRoot, { recursive: true }), mkdir(truthRoot, { recursive: true })]);

  const inputPath = path.join(caseRoot, "pngsuite-rgb8-missing-iend.png");
  const groundTruthPath = path.join(truthRoot, "pngsuite-basn2c08.png");
  await Promise.all([
    cp(path.join(holdoutRoot, "cases", "png", "pngsuite-rgb8-missing-iend.png"), inputPath),
    cp(path.join(holdoutRoot, "sources", "png", "pngsuite-basn2c08.png"), groundTruthPath),
  ]);
  const [input, groundTruth] = await Promise.all([hashFile(inputPath), hashFile(groundTruthPath)]);

  const protocolPath = path.join(definitionRoot, "protocol.json");
  const corpusPath = path.join(definitionRoot, "corpus.json");
  const toolPath = path.join(definitionRoot, "tool.json");
  await writeJson(protocolPath, {
    schemaVersion: 1,
    kind: "benchmark-protocol",
    id: "external-holdout-raster-slice-v1",
    title: "External holdout raster recovery vertical slice",
    publicClaim: "One frozen external PNG structure case is recovered by StillOpen and independently compared with the untouched source's decoded RGBA pixels.",
    frozenAt: "2026-08-10T00:00:00Z",
    inclusionRules: ["Run the frozen missing-IEND PNG case."],
    exclusionRules: ["This one-case slice is not a complete format or competitor comparison."],
    scoring: { denominator: "all-eligible-cases", passDisposition: "verified-pass" },
    limits: { timeoutMs: 30_000, maxCapturedBytes: 65_536 },
  });
  await writeJson(corpusPath, {
    schemaVersion: 1,
    kind: "benchmark-corpus",
    id: "external-holdout-raster-slice-v1",
    title: "One-case external PNG holdout slice",
    cases: [{
      id: "pngsuite-rgb8-missing-iend",
      format: "png",
      damageClass: "missing-iend",
      input: { path: "cases/pngsuite-rgb8-missing-iend.png", ...input },
      groundTruth: { validator: "raster-rgba-v1", path: "ground-truth/pngsuite-basn2c08.png", ...groundTruth },
      provenance: {
        source: "pnggroup/libpng PngSuite basn2c08.png at d1d0abeffede1cc898ddc3d0e600839cf026d749",
        license: "PngSuite permission grant retained in the external holdout",
      },
    }],
  });
  await writeJson(toolPath, {
    schemaVersion: 1,
    kind: "benchmark-tool",
    id: "stillopen-wasm-raster-v1",
    vendor: "StillOpen",
    product: "StillOpen WebAssembly recovery core",
    version: "0305ef9",
    platform: "Node.js host with repository WebAssembly artifact",
    synthetic: false,
    acquisition: { source: "public/wasm/stillopen-core.wasm" },
    adapter: {
      kind: "command",
      executable: "{node}",
      args: [
        path.join(kitRoot, "adapters", "stillopen-recovery.mjs"),
        "--format", "png",
        "--input", "{input}",
        "--output", "{output}",
      ],
      outputFile: "recovered.png",
      exitCodeDisposition: { "2": "refusal" },
    },
  });
  return { protocolPath, corpusPath, toolPath };
}

test("external PNG recovery passes independent RGBA validation and remains tamper-evident", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stillopen-raster-slice-"));
  const inputs = await sliceInputs(root);
  const result = await executeBenchmark({
    ...inputs,
    workspaceRoot: path.join(root, "runs"),
    runId: "png-raster-proof",
  });

  assert.equal(result.run.summary.verifiedPasses, 1);
  assert.equal(result.run.summary.competitiveSummaryEligible, true);
  assert.equal(result.run.cases[0].disposition, "verified-pass");
  assert.deepEqual(result.run.cases[0].validation, {
    validator: "raster-rgba-v1",
    pass: true,
    checks: {
      groundTruthReadable: true,
      outputReadable: true,
      expectedWidth: 32,
      expectedHeight: 32,
      actualWidth: 32,
      actualHeight: 32,
      dimensions: true,
      expectedRgbaSha256: "eaf754543de2f7b68ed1d07f36802ef667bf41dad1ecf55a19d554f3077f1d53",
      actualRgbaSha256: "eaf754543de2f7b68ed1d07f36802ef667bf41dad1ecf55a19d554f3077f1d53",
      exactDecodedPixels: true,
    },
  });
  assert.equal((await verifyRun(result.runRoot)).ok, true);

  const publicationRoot = path.join(root, "publication");
  await publishRun(result.runRoot, publicationRoot);
  assert.equal((await verifyPublication(publicationRoot)).ok, true);
  const report = await readFile(path.join(publicationRoot, "index.html"), "utf8");
  assert.match(report, /raster-rgba-v1/);
  assert.match(report, /verified-pass/);

  await writeFile(
    path.join(publicationRoot, "run", "cases", "pngsuite-rgb8-missing-iend", "tool-output", "recovered.png"),
    "tampered raster evidence\n",
  );
  await assert.rejects(verifyPublication(publicationRoot), /Publication verification failed/);
});
