import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalize, sha256 } from "../lib/canonical.mjs";
import { hashFile, readJson } from "../lib/files.mjs";
import { publishRun, verifyPublication } from "../lib/publisher.mjs";
import { ingestGuidedBenchmark, verifyRun } from "../lib/runner.mjs";

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeFixture(root, relativePath, content) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  return { path: relativePath, ...await hashFile(file) };
}

async function createGuidedFixture(root, definitions) {
  const observationsRoot = path.join(root, "observations");
  const corpus = {
    schemaVersion: 1,
    kind: "benchmark-corpus",
    id: "guided-returned-file-corpus-v1",
    title: "Guided returned-file classification fixtures",
    cases: [],
  };
  const observations = {
    schemaVersion: 1,
    kind: "benchmark-guided-observations",
    id: "guided-returned-file-observations-v1",
    toolId: "guided-returned-file-tool-v1",
    cases: [],
  };
  for (const [index, definition] of definitions.entries()) {
    const input = await writeFixture(root, `fixtures/${definition.id}.input`, definition.input);
    const groundTruth = await writeFixture(root, `fixtures/${definition.id}.expected`, definition.groundTruth);
    const corpusCase = {
      id: definition.id,
      format: "synthetic/text",
      damageClass: definition.damageClass ?? "synthetic-damage",
      input,
      groundTruth: { validator: "exact-sha256-v1", ...groundTruth },
      provenance: {
        source: "Project-generated returned-file classification fixture",
        license: "Project-authored fixture included for benchmark reproduction",
      },
    };
    if (definition.inputCondition) corpusCase.inputCondition = definition.inputCondition;
    corpus.cases.push(corpusCase);
    const observationCase = {
      caseId: definition.id,
      productOutcome: definition.productOutcome ?? "success",
      attemptedAt: `2026-08-11T12:${String(index).padStart(2, "0")}:00Z`,
      productMessage: "Synthetic guided product observation.",
    };
    if (definition.returnedFiles) {
      observationCase.returnedFiles = [];
      for (const [returnedIndex, returned] of definition.returnedFiles.entries()) {
        const relativePath = `returned/${definition.id}-${returnedIndex + 1}.bin`;
        await writeFixture(observationsRoot, relativePath, returned.content);
        observationCase.returnedFiles.push({
          path: relativePath,
          ...(returned.recommended ? { recommended: true } : {}),
        });
      }
    }
    observations.cases.push(observationCase);
  }
  const protocolPath = path.join(root, "protocol.json");
  const corpusPath = path.join(root, "corpus.json");
  const toolPath = path.join(root, "tool.json");
  const observationsPath = path.join(observationsRoot, "observations.json");
  await writeJson(protocolPath, {
    schemaVersion: 1,
    kind: "benchmark-protocol",
    id: "guided-returned-file-protocol-v1",
    title: "Guided returned-file classification proof",
    publicClaim: "Synthetic proof of guided returned-file selection.",
    frozenAt: "2026-08-11T12:00:00Z",
    scoring: { denominator: "all-eligible-cases", passDisposition: "verified-pass" },
    limits: { timeoutMs: 5000, maxCapturedBytes: 65536 },
  });
  await writeJson(corpusPath, corpus);
  await writeJson(toolPath, {
    schemaVersion: 1,
    kind: "benchmark-tool",
    id: "guided-returned-file-tool-v1",
    vendor: "StillOpen test fixtures",
    product: "Synthetic returned-file product",
    version: "1.0.0",
    platform: "Node.js test runtime",
    synthetic: true,
    acquisition: { source: "Project-generated guided evidence fixture" },
    adapter: { kind: "guided", instructions: ["Capture every product-returned file in display order."] },
  });
  await writeJson(observationsPath, observations);
  return { protocolPath, corpusPath, toolPath, observationsPath };
}

async function runFixture(definitions, runId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stillopen-guided-returned-files-"));
  const inputs = await createGuidedFixture(root, definitions);
  const result = await ingestGuidedBenchmark({
    ...inputs,
    workspaceRoot: path.join(root, "work"),
    runId,
  });
  return { root, result };
}

test("guided damaged-file scoring excludes returned originals and preserves every classification", async () => {
  const { root, result } = await runFixture([
    {
      id: "damaged-original-and-repair",
      input: "damaged input\n",
      groundTruth: "repaired input\n",
      returnedFiles: [
        { content: "damaged input\n", recommended: true },
        { content: "repaired input\n" },
      ],
    },
  ], "damaged-original-run");
  const record = result.run.cases[0];
  assert.equal(record.disposition, "verified-pass");
  assert.equal(record.observation.outputSelection.strategy, "sole-changed-output");
  assert.equal(record.observation.output.path, "cases/damaged-original-and-repair/returned-files/02.bin");
  assert.deepEqual(record.observation.returnedFiles.map((returnedFile) => ({
    inputComparison: returnedFile.inputComparison,
    classification: returnedFile.classification,
  })), [
    { inputComparison: "byte-identical", classification: "original-returned" },
    { inputComparison: "changed", classification: "selected-repair-output" },
  ]);
  assert.ok(result.attestation.files.some((file) => file.path === "cases/damaged-original-and-repair/returned-files/01.bin"));
  assert.ok(result.attestation.files.some((file) => file.path === "cases/damaged-original-and-repair/returned-files/02.bin"));
  assert.equal((await verifyRun(result.runRoot)).ok, true);
  const publication = await publishRun(result.runRoot, path.join(root, "publication"));
  const html = await readFile(publication.index, "utf8");
  assert.match(html, /original-returned/);
  assert.match(html, /selected-repair-output/);
  assert.equal((await verifyPublication(path.join(root, "publication"))).ok, true);
});

test("guided multi-repair selection prefers the recommended changed result then display order", async () => {
  const { result } = await runFixture([
    {
      id: "multiple-recommended",
      input: "damaged recommended\n",
      groundTruth: "recommended repair\n",
      returnedFiles: [
        { content: "alternative repair\n" },
        { content: "recommended repair\n", recommended: true },
      ],
    },
    {
      id: "multiple-first-displayed",
      input: "damaged first\n",
      groundTruth: "first repair\n",
      returnedFiles: [
        { content: "first repair\n" },
        { content: "second repair\n" },
      ],
    },
  ], "multiple-repair-run");
  const [recommended, firstDisplayed] = result.run.cases;
  assert.equal(recommended.disposition, "verified-pass");
  assert.equal(recommended.observation.outputSelection.strategy, "recommended-changed-output");
  assert.equal(recommended.observation.output.path, "cases/multiple-recommended/returned-files/02.bin");
  assert.deepEqual(recommended.observation.returnedFiles.map((returnedFile) => returnedFile.classification), [
    "repair-candidate",
    "selected-repair-output",
  ]);
  assert.equal(firstDisplayed.disposition, "verified-pass");
  assert.equal(firstDisplayed.observation.outputSelection.strategy, "first-displayed-changed-output");
  assert.equal(firstDisplayed.observation.output.path, "cases/multiple-first-displayed/returned-files/01.bin");
  assert.deepEqual(firstDisplayed.observation.returnedFiles.map((returnedFile) => returnedFile.classification), [
    "selected-repair-output",
    "repair-candidate",
  ]);
  assert.equal((await verifyRun(result.runRoot)).ok, true);
});

test("guided healthy controls retain identical-output and explicit no-change success semantics", async () => {
  const { result } = await runFixture([
    {
      id: "healthy-identical-output",
      inputCondition: "healthy-control",
      input: "healthy input\n",
      groundTruth: "healthy input\n",
      returnedFiles: [
        { content: "unexpected edit\n", recommended: true },
        { content: "healthy input\n" },
      ],
    },
    {
      id: "healthy-no-returned-file",
      inputCondition: "healthy-control",
      input: "unchanged healthy input\n",
      groundTruth: "unchanged healthy input\n",
      productOutcome: "no-output",
    },
  ], "healthy-control-run");
  const [identicalOutput, noChange] = result.run.cases;
  assert.equal(identicalOutput.disposition, "verified-pass");
  assert.equal(identicalOutput.observation.outputSelection.strategy, "healthy-identical-output");
  assert.equal(identicalOutput.observation.output.path, "cases/healthy-identical-output/returned-files/02.bin");
  assert.deepEqual(identicalOutput.observation.returnedFiles.map((returnedFile) => returnedFile.classification), [
    "unexpected-changed-output",
    "selected-healthy-output",
  ]);
  assert.equal(noChange.disposition, "verified-pass");
  assert.equal(noChange.observation.disposition, "healthy-no-change");
  assert.equal(noChange.observation.outputSelection.strategy, "healthy-no-change");
  assert.equal(noChange.observation.output.path, "cases/healthy-no-returned-file/input.bin");
  assert.equal((await verifyRun(result.runRoot)).ok, true);
});

test("verification rejects a rehashed forged returned-file classification", async () => {
  const { result } = await runFixture([
    {
      id: "classification-tamper",
      input: "damaged input\n",
      groundTruth: "repaired input\n",
      returnedFiles: [
        { content: "damaged input\n" },
        { content: "repaired input\n" },
      ],
    },
  ], "classification-tamper-run");
  const casePath = path.join(result.runRoot, "cases", "classification-tamper", "result.json");
  const caseRecord = await readJson(casePath);
  caseRecord.observation.returnedFiles[0].classification = "selected-repair-output";
  await writeJson(casePath, caseRecord);
  const runPath = path.join(result.runRoot, "run.json");
  const run = await readJson(runPath);
  run.cases[0] = caseRecord;
  await writeJson(runPath, run);
  const attestationPath = path.join(result.runRoot, "attestation.json");
  const attestation = await readJson(attestationPath);
  for (const relativePath of ["cases/classification-tamper/result.json", "run.json"]) {
    Object.assign(attestation.files.find((file) => file.path === relativePath), await hashFile(path.join(result.runRoot, ...relativePath.split("/"))));
  }
  attestation.rootDigest = sha256(canonicalize(attestation.files));
  await writeJson(attestationPath, attestation);
  await assert.rejects(verifyRun(result.runRoot), /Guided returned-file classification is inconsistent/);
});
