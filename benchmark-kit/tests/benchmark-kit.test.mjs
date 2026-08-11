import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalize, sha256 } from "../lib/canonical.mjs";
import { hashFile, readJson } from "../lib/files.mjs";
import { publishRun, verifyPublication } from "../lib/publisher.mjs";
import { executeBenchmark, ingestGuidedBenchmark, makePlan, verifyRun } from "../lib/runner.mjs";
import { validateCapturedOutput } from "../lib/validators.mjs";

const kitRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const exampleRoot = path.join(kitRoot, "examples", "synthetic");
const inputs = {
  protocolPath: path.join(exampleRoot, "protocol.json"),
  corpusPath: path.join(exampleRoot, "corpus.json"),
  toolPath: path.join(exampleRoot, "tools", "synthetic-command.json"),
};

async function workspace() {
  return mkdtemp(path.join(os.tmpdir(), "stillopen-benchmark-test-"));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;
  for (const [nameText, contentText] of entries) {
    const name = Buffer.from(nameText, "utf8");
    const content = Buffer.from(contentText, "utf8");
    const checksum = crc32(content);
    const local = Buffer.alloc(30 + name.byteLength + content.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.byteLength, 18);
    local.writeUInt32LE(content.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    name.copy(local, 30);
    content.copy(local, 30 + name.byteLength);
    localRecords.push(local);

    const central = Buffer.alloc(46 + name.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.byteLength, 20);
    central.writeUInt32LE(content.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.byteLength;
  }
  const central = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localRecords, central, end]);
}

test("command slice preserves exact, changed, and refusal outcomes", async () => {
  const root = await workspace();
  const result = await executeBenchmark({ ...inputs, workspaceRoot: root, runId: "proof-run" });
  assert.deepEqual(result.run.summary, {
    declaredCases: 3,
    eligibleCases: 3,
    unscoredCases: 0,
    verifiedPasses: 1,
    verifiedPartials: 0,
    changedOutputs: 1,
    refusals: 1,
    unavailable: 0,
    errors: 0,
    meanRecoveryScore: 0.333333,
    categoryScores: {
      "damaged-full-restoration": {
        cases: 1,
        eligibleCases: 1,
        unscoredCases: 0,
        meanRecoveryScore: 1,
        fullRecoveries: 1,
        partialRecoveries: 0,
        zeroRecoveries: 0,
      },
      "damaged-partial-restoration": {
        cases: 1,
        eligibleCases: 1,
        unscoredCases: 0,
        meanRecoveryScore: 0,
        fullRecoveries: 0,
        partialRecoveries: 0,
        zeroRecoveries: 1,
      },
      "healthy-control": {
        cases: 1,
        eligibleCases: 1,
        unscoredCases: 0,
        meanRecoveryScore: 0,
        fullRecoveries: 0,
        partialRecoveries: 0,
        zeroRecoveries: 1,
      },
    },
    competitiveSummaryEligible: false,
  });
  assert.deepEqual(result.run.cases.map((item) => item.disposition), ["verified-pass", "changed-output", "refusal"]);
  assert.equal(result.run.cases[1].observation.disposition, "output-produced");
  assert.equal(result.run.cases[1].validation.pass, false);
  assert.match(await readFile(path.join(result.runRoot, "cases", "changed-case", "stdout.txt"), "utf8"), /reports recovery success/);
  assert.equal((await verifyRun(result.runRoot)).ok, true);
});

test("raster scoring exposes exact recovered pixels separately from visual similarity", async () => {
  const root = await workspace();
  const { createCanvas } = await import("@napi-rs/canvas");
  const makePng = (rightColor) => {
    const canvas = createCanvas(2, 1);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = rightColor;
    context.fillRect(1, 0, 1, 1);
    return canvas.toBuffer("image/png");
  };
  const groundTruthPath = path.join(root, "ground.png");
  const outputPath = path.join(root, "partial.png");
  await writeFile(groundTruthPath, makePng("#00ff00"));
  await writeFile(outputPath, makePng("#0000ff"));
  const output = await hashFile(outputPath);
  const groundTruth = { validator: "raster-rgba-v1", ...await hashFile(groundTruthPath) };
  const validation = await validateCapturedOutput({
    validator: groundTruth.validator,
    outputPath,
    output,
    groundTruthPath,
    groundTruth,
  });
  assert.equal(validation.pass, false);
  assert.equal(validation.score, 0.5);
  assert.equal(validation.recoveredUnits, 1);
  assert.equal(validation.totalUnits, 2);
  assert.ok(validation.checks.normalizedChannelSimilarity > validation.score);
  assert.ok(validation.checks.normalizedChannelSimilarity < 1);
});

test("ZIP scoring credits exact entries and only the verified prefix of a partial entry", async () => {
  const root = await workspace();
  const groundTruthPath = path.join(root, "ground.zip");
  const outputPath = path.join(root, "partial.zip");
  await writeFile(groundTruthPath, storedZip([["a.txt", "alpha"], ["b.txt", "bravo"]]));
  await writeFile(outputPath, storedZip([["a.txt", "alpha"], ["b.txt", "br"]]));
  const output = await hashFile(outputPath);
  const groundTruth = { validator: "zip-entry-bytes-v1", ...await hashFile(groundTruthPath) };
  const validation = await validateCapturedOutput({
    validator: groundTruth.validator,
    outputPath,
    output,
    groundTruthPath,
    groundTruth,
  });
  assert.equal(validation.pass, false);
  assert.equal(validation.score, 0.7);
  assert.equal(validation.recoveredUnits, 7);
  assert.equal(validation.totalUnits, 10);
  assert.equal(validation.checks.exactEntries, 1);
});

test("ZIP scoring reports unexpected entries without erasing exact recovery credit", async () => {
  const root = await workspace();
  const groundTruthPath = path.join(root, "ground.zip");
  const outputPath = path.join(root, "with-report.zip");
  await writeFile(groundTruthPath, storedZip([["a.txt", "alpha"], ["b.txt", "bravo"]]));
  await writeFile(outputPath, storedZip([
    ["a.txt", "alpha"],
    ["b.txt", "bravo"],
    ["recovery-report.txt", "generated by the repair tool"],
  ]));
  const output = await hashFile(outputPath);
  const groundTruth = { validator: "zip-entry-bytes-v1", ...await hashFile(groundTruthPath) };
  const validation = await validateCapturedOutput({
    validator: groundTruth.validator,
    outputPath,
    output,
    groundTruthPath,
    groundTruth,
  });
  assert.equal(validation.pass, true);
  assert.equal(validation.score, 1);
  assert.equal(validation.recoveredUnits, 10);
  assert.equal(validation.checks.unexpectedEntryCount, 1);
  assert.deepEqual(validation.checks.unexpectedEntries, ["recovery-report.txt"]);
});

test("guided evidence keeps product outcomes separate from independent validation", async () => {
  const root = await workspace();
  const result = await ingestGuidedBenchmark({
    protocolPath: inputs.protocolPath,
    corpusPath: inputs.corpusPath,
    toolPath: path.join(exampleRoot, "tools", "synthetic-guided.json"),
    observationsPath: path.join(exampleRoot, "guided-observations.json"),
    workspaceRoot: root,
    runId: "guided-run",
  });
  assert.deepEqual(result.run.cases.map((item) => item.disposition), ["verified-pass", "changed-output", "refusal"]);
  assert.equal(result.run.cases[1].observation.productOutcome, "success");
  assert.equal(result.run.cases[1].validation.pass, false);
  assert.equal(result.run.summary.competitiveSummaryEligible, false);
  assert.equal((await verifyRun(result.runRoot)).ok, true);
});

test("unavailable guided cases stay visible without entering recovery-score denominators", async () => {
  const root = await workspace();
  const observations = await readJson(path.join(exampleRoot, "guided-observations.json"));
  observations.id = "synthetic-guided-with-unavailable-v1";
  observations.cases[2].productOutcome = "unavailable";
  observations.cases[2].productMessage = "Synthetic service unavailable.";
  const observationsPath = path.join(root, "observations.json");
  const outputRoot = path.join(root, "guided-outputs");
  await mkdir(outputRoot);
  for (const filename of ["exact.txt", "changed.txt"]) {
    await writeFile(
      path.join(outputRoot, filename),
      await readFile(path.join(exampleRoot, "guided-outputs", filename)),
    );
  }
  await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);
  const result = await ingestGuidedBenchmark({
    protocolPath: inputs.protocolPath,
    corpusPath: inputs.corpusPath,
    toolPath: path.join(exampleRoot, "tools", "synthetic-guided.json"),
    observationsPath,
    workspaceRoot: root,
    runId: "guided-unavailable-run",
  });
  assert.equal(result.run.summary.declaredCases, 3);
  assert.equal(result.run.summary.eligibleCases, 2);
  assert.equal(result.run.summary.unscoredCases, 1);
  assert.equal(result.run.summary.meanRecoveryScore, 0.5);
  assert.equal(result.run.summary.categoryScores["healthy-control"].eligibleCases, 0);
  assert.equal(result.run.summary.categoryScores["healthy-control"].meanRecoveryScore, null);
  assert.equal(result.run.cases[2].eligible, false);
  assert.equal((await verifyRun(result.runRoot)).ok, true);
});

test("verification ties rehashed guided outcomes to their source observation record", async () => {
  const root = await workspace();
  const result = await ingestGuidedBenchmark({
    protocolPath: inputs.protocolPath,
    corpusPath: inputs.corpusPath,
    toolPath: path.join(exampleRoot, "tools", "synthetic-guided.json"),
    observationsPath: path.join(exampleRoot, "guided-observations.json"),
    workspaceRoot: root,
    runId: "guided-forgery-run",
  });
  const casePath = path.join(result.runRoot, "cases", "exact-case", "result.json");
  const caseRecord = await readJson(casePath);
  caseRecord.observation.productOutcome = "refusal";
  caseRecord.observation.disposition = "refusal";
  caseRecord.observation.terminalOutcomeEligible = false;
  caseRecord.disposition = "refusal";
  caseRecord.score = 0;
  await writeFile(casePath, `${JSON.stringify(caseRecord, null, 2)}\n`);
  const runPath = path.join(result.runRoot, "run.json");
  const run = await readJson(runPath);
  run.cases[0] = caseRecord;
  run.summary.verifiedPasses = 0;
  run.summary.refusals = 2;
  run.summary.meanRecoveryScore = 0;
  Object.assign(run.summary.categoryScores["damaged-full-restoration"], {
    meanRecoveryScore: 0,
    fullRecoveries: 0,
    zeroRecoveries: 1,
  });
  await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
  const attestationPath = path.join(result.runRoot, "attestation.json");
  const attestation = await readJson(attestationPath);
  for (const relativePath of ["cases/exact-case/result.json", "run.json"]) {
    Object.assign(attestation.files.find((item) => item.path === relativePath), await hashFile(path.join(result.runRoot, ...relativePath.split("/"))));
  }
  attestation.rootDigest = sha256(canonicalize(attestation.files));
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
  await assert.rejects(verifyRun(result.runRoot), /Guided case record does not match guided-observations/);
});

test("publication is self-contained and keeps the synthetic claim boundary visible", async () => {
  const root = await workspace();
  const result = await executeBenchmark({ ...inputs, workspaceRoot: root, runId: "publication-run" });
  const publication = await publishRun(result.runRoot, path.join(root, "publication"));
  const html = await readFile(publication.index, "utf8");
  assert.match(html, /Synthetic harness demonstration only/);
  assert.match(html, new RegExp(result.run.planDigest));
  assert.match(html, new RegExp(result.attestation.rootDigest));
  assert.match(html, /verified-pass/);
  assert.match(html, /changed-output/);
  assert.match(html, /refusal/);
  assert.match(html, /StillOpen test fixtures · Synthetic command adapter/);
  assert.match(html, /Version 1\.0\.0 · Node\.js test runtime/);
  assert.match(html, /Protocol excludes this run from competitor performance summaries/);
  assert.match(html, /declared cases/);
  assert.match(html, /scored cases/);
  assert.match(html, /Three-case synthetic recovery corpus/);
  assert.match(html, /synthetic-command-corpus-v1/);
  assert.match(html, /all-eligible-cases/);
  assert.match(html, /5000 ms per case timeout/);
  assert.match(html, /Claim limitations/);
  assert.equal((await verifyRun(path.join(root, "publication", "run"))).filesVerified, result.attestation.files.length);
  assert.equal((await verifyPublication(path.join(root, "publication"))).ok, true);
});

test("publication verification detects rendered report tampering", async () => {
  const root = await workspace();
  const result = await executeBenchmark({ ...inputs, workspaceRoot: root, runId: "report-tamper-run" });
  const publicationRoot = path.join(root, "publication");
  await publishRun(result.runRoot, publicationRoot);
  await writeFile(path.join(publicationRoot, "report.json"), "{}\n");
  await assert.rejects(verifyPublication(publicationRoot), /Publication verification failed/);
});

test("verification detects evidence tampering", async () => {
  const root = await workspace();
  const result = await executeBenchmark({ ...inputs, workspaceRoot: root, runId: "tamper-run" });
  await writeFile(path.join(result.runRoot, "cases", "exact-case", "tool-output", "output.bin"), "tampered\n");
  await assert.rejects(verifyRun(result.runRoot), /Evidence verification failed/);
});

test("verification rejects a semantically inconsistent but rehashed plan", async () => {
  const root = await workspace();
  const result = await executeBenchmark({ ...inputs, workspaceRoot: root, runId: "semantic-plan-run" });
  const planPath = path.join(result.runRoot, "plan.json");
  const plan = await readJson(planPath);
  plan.limits.timeoutMs += 1;
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const attestationPath = path.join(result.runRoot, "attestation.json");
  const attestation = await readJson(attestationPath);
  const planEntry = attestation.files.find((item) => item.path === "plan.json");
  Object.assign(planEntry, await hashFile(planPath));
  attestation.rootDigest = sha256(canonicalize(attestation.files));
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
  await assert.rejects(verifyRun(result.runRoot), /Frozen plan does not match/);
});

test("verification independently rejects a rehashed forged pass", async () => {
  const root = await workspace();
  const result = await executeBenchmark({ ...inputs, workspaceRoot: root, runId: "forged-pass-run" });
  const casePath = path.join(result.runRoot, "cases", "changed-case", "result.json");
  const caseRecord = await readJson(casePath);
  caseRecord.validation.pass = true;
  caseRecord.validation.score = 1;
  caseRecord.validation.recoveredUnits = 1;
  caseRecord.validation.checks.exactBytes = true;
  caseRecord.disposition = "verified-pass";
  caseRecord.score = 1;
  await writeFile(casePath, `${JSON.stringify(caseRecord, null, 2)}\n`);
  const runPath = path.join(result.runRoot, "run.json");
  const run = await readJson(runPath);
  run.cases[1] = caseRecord;
  run.summary.verifiedPasses = 2;
  run.summary.changedOutputs = 0;
  run.summary.meanRecoveryScore = 0.666667;
  Object.assign(run.summary.categoryScores["damaged-partial-restoration"], {
    meanRecoveryScore: 1,
    fullRecoveries: 1,
    zeroRecoveries: 0,
  });
  await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
  const attestationPath = path.join(result.runRoot, "attestation.json");
  const attestation = await readJson(attestationPath);
  for (const relativePath of ["cases/changed-case/result.json", "run.json"]) {
    const entry = attestation.files.find((item) => item.path === relativePath);
    Object.assign(entry, await hashFile(path.join(result.runRoot, ...relativePath.split("/"))));
  }
  attestation.rootDigest = sha256(canonicalize(attestation.files));
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
  await assert.rejects(verifyRun(result.runRoot), /Independent validation record is inconsistent/);
});

test("a tool that mutates its copied input invalidates the run", async () => {
  const root = await workspace();
  await assert.rejects(
    executeBenchmark({
      ...inputs,
      toolPath: path.join(exampleRoot, "tools", "synthetic-mutating-command.json"),
      workspaceRoot: root,
      runId: "mutating-run",
    }),
    /input was mutated during tool execution/,
  );
});

test("an unavailable command is preserved as evidence instead of crashing the harness", async () => {
  const root = await workspace();
  const result = await executeBenchmark({
    ...inputs,
    toolPath: path.join(exampleRoot, "tools", "synthetic-missing-command.json"),
    workspaceRoot: root,
    runId: "missing-command-run",
  });
  assert.deepEqual(result.run.cases.map((item) => item.disposition), ["launch-error", "launch-error", "launch-error"]);
  assert.equal(result.run.summary.errors, 3);
  assert.equal(result.run.cases[0].observation.launchError.code, "ENOENT");
  assert.equal((await verifyRun(result.runRoot)).ok, true);
});

test("exact output cannot pass after a timeout or mapped non-success exit", async () => {
  const root = await workspace();
  const protocol = await readJson(inputs.protocolPath);
  protocol.limits.timeoutMs = 100;
  const shortProtocolPath = path.join(root, "short-protocol.json");
  await writeFile(shortProtocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  const timed = await executeBenchmark({
    ...inputs,
    protocolPath: shortProtocolPath,
    toolPath: path.join(exampleRoot, "tools", "synthetic-exact-timeout.json"),
    workspaceRoot: root,
    runId: "exact-timeout-run",
  });
  assert.ok(timed.run.cases.every((item) => item.validation.pass));
  assert.ok(timed.run.cases.every((item) => item.disposition === "timeout" && item.observation.timedOut && !item.observation.terminalOutcomeEligible));
  assert.equal((await verifyRun(timed.runRoot)).ok, true);

  const nonzero = await executeBenchmark({
    ...inputs,
    toolPath: path.join(exampleRoot, "tools", "synthetic-exact-nonzero.json"),
    workspaceRoot: root,
    runId: "exact-nonzero-run",
  });
  assert.ok(nonzero.run.cases.every((item) => item.validation.pass));
  assert.ok(nonzero.run.cases.every((item) => item.disposition === "refusal" && item.observation.exitCode === 2 && !item.observation.terminalOutcomeEligible));
  assert.equal((await verifyRun(nonzero.runRoot)).ok, true);
});

test("verification rejects a rehashed forged terminal outcome", async () => {
  const root = await workspace();
  const result = await executeBenchmark({
    ...inputs,
    toolPath: path.join(exampleRoot, "tools", "synthetic-exact-nonzero.json"),
    workspaceRoot: root,
    runId: "forged-outcome-run",
  });
  const casePath = path.join(result.runRoot, "cases", "exact-case", "result.json");
  const caseRecord = await readJson(casePath);
  caseRecord.observation.disposition = "output-produced";
  caseRecord.observation.terminalOutcomeEligible = true;
  caseRecord.disposition = "verified-pass";
  caseRecord.score = 1;
  await writeFile(casePath, `${JSON.stringify(caseRecord, null, 2)}\n`);
  const runPath = path.join(result.runRoot, "run.json");
  const run = await readJson(runPath);
  run.cases[0] = caseRecord;
  run.summary.verifiedPasses = 1;
  run.summary.refusals = 2;
  run.summary.meanRecoveryScore = 0.333333;
  Object.assign(run.summary.categoryScores["damaged-full-restoration"], {
    meanRecoveryScore: 1,
    fullRecoveries: 1,
    zeroRecoveries: 0,
  });
  await writeFile(runPath, `${JSON.stringify(run, null, 2)}\n`);
  const attestationPath = path.join(result.runRoot, "attestation.json");
  const attestation = await readJson(attestationPath);
  for (const relativePath of ["cases/exact-case/result.json", "run.json"]) {
    Object.assign(attestation.files.find((item) => item.path === relativePath), await hashFile(path.join(result.runRoot, ...relativePath.split("/"))));
  }
  attestation.rootDigest = sha256(canonicalize(attestation.files));
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
  await assert.rejects(verifyRun(result.runRoot), /Terminal outcome semantics are inconsistent/);
});

test("corpus paths cannot escape the declared corpus root", async () => {
  const root = await workspace();
  const corpus = await readJson(inputs.corpusPath);
  corpus.cases[0].input.path = "../../outside.bin";
  const corpusPath = path.join(root, "corpus.json");
  await writeFile(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);
  await assert.rejects(
    executeBenchmark({ ...inputs, corpusPath, workspaceRoot: path.join(root, "work"), runId: "escape-run" }),
    /escapes its declared root/,
  );
});

test("corpus files cannot escape through a symlinked directory", async () => {
  const root = await workspace();
  await symlink(path.join(exampleRoot, "cases"), path.join(root, "linked-cases"), "dir");
  const corpus = await readJson(inputs.corpusPath);
  corpus.cases[0].input.path = "linked-cases/exact.damaged";
  const corpusPath = path.join(root, "corpus.json");
  await writeFile(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);
  await assert.rejects(
    executeBenchmark({ ...inputs, corpusPath, workspaceRoot: path.join(root, "work"), runId: "symlink-corpus-run" }),
    /resolves outside its declared root through a symbolic link/,
  );
});

test("guided outputs cannot be captured through symlinks", async () => {
  const root = await workspace();
  const observationsRoot = path.join(root, "observations");
  await mkdir(observationsRoot);
  await symlink(path.join(exampleRoot, "ground-truth", "exact.txt"), path.join(observationsRoot, "linked-output.txt"));
  await writeFile(path.join(observationsRoot, "changed.txt"), "Recovered document: BRAVO\n");
  const observations = await readJson(path.join(exampleRoot, "guided-observations.json"));
  observations.cases[0].outputPath = "linked-output.txt";
  observations.cases[1].outputPath = "changed.txt";
  const observationsPath = path.join(observationsRoot, "observations.json");
  await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);
  await assert.rejects(
    ingestGuidedBenchmark({
      protocolPath: inputs.protocolPath,
      corpusPath: inputs.corpusPath,
      toolPath: path.join(exampleRoot, "tools", "synthetic-guided.json"),
      observationsPath,
      workspaceRoot: path.join(root, "work"),
      runId: "symlink-output-run",
    }),
    /guided output may not be a symbolic link/,
  );
});

test("guided attachments cannot be captured through symlinks", async () => {
  const root = await workspace();
  const observationsRoot = path.join(root, "observations");
  await mkdir(observationsRoot);
  await writeFile(path.join(observationsRoot, "exact.txt"), "Recovered document: alpha\n");
  await writeFile(path.join(observationsRoot, "changed.txt"), "Recovered document: BRAVO\n");
  await symlink(path.join(exampleRoot, "ground-truth", "refusal.txt"), path.join(observationsRoot, "linked-attachment.txt"));
  const observations = await readJson(path.join(exampleRoot, "guided-observations.json"));
  observations.cases[0].outputPath = "exact.txt";
  observations.cases[1].outputPath = "changed.txt";
  observations.cases[2].attachments = ["linked-attachment.txt"];
  const observationsPath = path.join(observationsRoot, "observations.json");
  await writeFile(observationsPath, `${JSON.stringify(observations, null, 2)}\n`);
  await assert.rejects(
    ingestGuidedBenchmark({
      protocolPath: inputs.protocolPath,
      corpusPath: inputs.corpusPath,
      toolPath: path.join(exampleRoot, "tools", "synthetic-guided.json"),
      observationsPath,
      workspaceRoot: path.join(root, "work"),
      runId: "symlink-attachment-run",
    }),
    /attachment may not be a symbolic link/,
  );
});

test("the frozen plan digest is deterministic", async () => {
  const protocol = await readJson(inputs.protocolPath);
  const corpus = await readJson(inputs.corpusPath);
  const tool = await readJson(inputs.toolPath);
  assert.equal(makePlan(protocol, corpus, tool).planDigest, makePlan(protocol, corpus, tool).planDigest);
});

test("harness 1.0 compatibility remains limited to its exact-byte validator", async () => {
  const protocol = await readJson(inputs.protocolPath);
  const corpus = await readJson(inputs.corpusPath);
  const tool = await readJson(inputs.toolPath);
  corpus.cases[0].groundTruth.validator = "raster-rgba-v1";
  assert.throws(
    () => makePlan(protocol, corpus, tool, undefined, {
      name: "stillopen-open-recovery-benchmark-kit",
      version: "1.0.0",
    }),
    /supports only exact-sha256-v1/,
  );
});

test("adapter outcome mappings cannot forge an independently verified pass", async () => {
  const root = await workspace();
  const tool = await readJson(inputs.toolPath);
  tool.adapter.exitCodeDisposition["2"] = "verified-pass";
  const toolPath = path.join(root, "unsafe-tool.json");
  await writeFile(toolPath, `${JSON.stringify(tool, null, 2)}\n`);
  await assert.rejects(
    executeBenchmark({ ...inputs, toolPath, workspaceRoot: root, runId: "unsafe-mapping-run" }),
    /unsafe mapping/,
  );
});
