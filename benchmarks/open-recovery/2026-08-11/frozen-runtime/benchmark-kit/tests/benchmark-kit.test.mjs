import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalize, sha256 } from "../lib/canonical.mjs";
import { hashFile, readJson } from "../lib/files.mjs";
import { publishRun, verifyPublication } from "../lib/publisher.mjs";
import { prepareGuidedPacket } from "../lib/guided-packet.mjs";
import { executeBenchmark, ingestGuidedBenchmark, makePlan, verifyRun } from "../lib/runner.mjs";

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

test("command slice preserves exact, changed, and refusal outcomes", async () => {
  const root = await workspace();
  const result = await executeBenchmark({ ...inputs, workspaceRoot: root, runId: "proof-run" });
  assert.deepEqual(result.run.summary, {
    eligibleCases: 3,
    verifiedPasses: 1,
    changedOutputs: 1,
    refusals: 1,
    unavailable: 0,
    errors: 0,
    competitiveSummaryEligible: false,
  });
  assert.deepEqual(result.run.cases.map((item) => item.disposition), ["verified-pass", "changed-output", "refusal"]);
  assert.equal(result.run.cases[1].observation.disposition, "output-produced");
  assert.equal(result.run.cases[1].validation.pass, false);
  assert.match(await readFile(path.join(result.runRoot, "cases", "changed-case", "stdout.txt"), "utf8"), /reports recovery success/);
  assert.equal((await verifyRun(result.runRoot)).ok, true);
});

test("command adapters can preserve an explicit healthy no-change outcome", async () => {
  const root = await workspace();
  const definitionRoot = path.join(root, "definitions");
  await mkdir(path.join(definitionRoot, "cases"), { recursive: true });
  await mkdir(path.join(definitionRoot, "ground-truth"), { recursive: true });
  const healthy = "Already healthy fixture\n";
  const inputPath = path.join(definitionRoot, "cases", "healthy.txt");
  const groundTruthPath = path.join(definitionRoot, "ground-truth", "healthy.txt");
  await writeFile(inputPath, healthy);
  await writeFile(groundTruthPath, healthy);
  const descriptor = await hashFile(inputPath);
  const protocol = await readJson(inputs.protocolPath);
  const corpus = {
    schemaVersion: 1,
    kind: "benchmark-corpus",
    id: "healthy-command-control-v1",
    title: "Healthy command control",
    cases: [{
      id: "healthy-no-change",
      format: "synthetic/text",
      damageClass: "none",
      inputCondition: "healthy-control",
      input: { path: "cases/healthy.txt", ...descriptor },
      groundTruth: { validator: "exact-sha256-v1", path: "ground-truth/healthy.txt", ...descriptor },
      provenance: { source: "Project fixture", license: "Project-authored" },
    }],
  };
  const tool = {
    schemaVersion: 1,
    kind: "benchmark-tool",
    id: "healthy-command-tool-v1",
    vendor: "StillOpen test fixtures",
    product: "Healthy no-change command adapter",
    version: "1.0.0",
    platform: "Node.js test runtime",
    synthetic: true,
    acquisition: { source: "Project fixture" },
    adapter: {
      kind: "command",
      executable: "{node}",
      args: [path.join(kitRoot, "fixtures", "synthetic-tool.mjs"), "--mode", "{caseId}", "--input", "{input}", "--output", "{output}"],
      outputFile: "healthy.txt",
      healthyNoChangeExitCodes: [3],
    },
  };
  const protocolPath = path.join(definitionRoot, "protocol.json");
  const corpusPath = path.join(definitionRoot, "corpus.json");
  const toolPath = path.join(definitionRoot, "tool.json");
  await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  await writeFile(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);
  await writeFile(toolPath, `${JSON.stringify(tool, null, 2)}\n`);
  const result = await executeBenchmark({ protocolPath, corpusPath, toolPath, workspaceRoot: root, runId: "healthy-command-run" });
  assert.equal(result.run.summary.verifiedPasses, 1);
  assert.equal(result.run.cases[0].disposition, "verified-pass");
  assert.equal(result.run.cases[0].observation.disposition, "healthy-no-change");
  assert.equal(result.run.cases[0].observation.healthyNoChange, true);
  assert.equal(result.run.cases[0].observation.output, null);
  assert.equal(result.run.cases[0].validation.pass, true);
  assert.equal((await verifyRun(result.runRoot)).ok, true);
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

test("guided packet preparation copies frozen inputs and omits ground truth", async () => {
  const root = await workspace();
  const outputRoot = path.join(root, "operator-packet");
  const result = await prepareGuidedPacket({
    protocolPath: inputs.protocolPath,
    corpusPath: inputs.corpusPath,
    toolPath: path.join(exampleRoot, "tools", "synthetic-guided.json"),
    outputRoot,
    preparedAt: "2026-08-11T12:00:00Z",
  });
  assert.equal(result.packet.groundTruthIncluded, false);
  assert.equal(result.packet.cases.length, 3);
  assert.equal(
    await readFile(path.join(outputRoot, "cases", "exact-case", "input.damaged"), "utf8"),
    "Recovered document: alpha\nDAMAGE:truncated-directory\n",
  );
  await assert.rejects(readFile(path.join(outputRoot, "ground-truth", "exact.txt")), /ENOENT/);
  const template = await readJson(path.join(outputRoot, "observations.template.json"));
  assert.equal(template.toolId, "synthetic-guided-fixture-v1");
  assert.equal(template.cases.length, 3);
  assert.match(template.cases[0].productOutcome, /^REPLACE_WITH_/);
  assert.match(await readFile(path.join(outputRoot, "README.md"), "utf8"), /Ground-truth files are\s+deliberately omitted/);
});

test("guided packet preparation rejects command adapters", async () => {
  const root = await workspace();
  await assert.rejects(
    prepareGuidedPacket({ ...inputs, outputRoot: path.join(root, "operator-packet") }),
    /requires a guided adapter/,
  );
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
  await writeFile(casePath, `${JSON.stringify(caseRecord, null, 2)}\n`);
  const runPath = path.join(result.runRoot, "run.json");
  const run = await readJson(runPath);
  run.cases[0] = caseRecord;
  run.summary.verifiedPasses = 0;
  run.summary.refusals = 2;
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
  assert.match(html, /Synthetic qualification — excluded from competitor performance summaries/);
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
  caseRecord.validation.checks.exactBytes = true;
  caseRecord.disposition = "verified-pass";
  await writeFile(casePath, `${JSON.stringify(caseRecord, null, 2)}\n`);
  const runPath = path.join(result.runRoot, "run.json");
  const run = await readJson(runPath);
  run.cases[1] = caseRecord;
  run.summary.verifiedPasses = 2;
  run.summary.changedOutputs = 0;
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

test("documented nonzero success exit codes remain eligible when output is produced", async () => {
  const root = await workspace();
  const tool = await readJson(path.join(exampleRoot, "tools", "synthetic-exact-nonzero.json"));
  delete tool.adapter.exitCodeDisposition;
  tool.adapter.successExitCodes = [0, 2];
  tool.adapter.args[0] = path.join(kitRoot, "fixtures", "synthetic-tool.mjs");
  const toolPath = path.join(root, "nonzero-success-tool.json");
  await writeFile(toolPath, `${JSON.stringify(tool, null, 2)}\n`);
  const result = await executeBenchmark({
    ...inputs,
    toolPath,
    workspaceRoot: path.join(root, "work"),
    runId: "nonzero-success-run",
  });
  assert.ok(result.run.cases.every((item) => item.observation.exitCode === 2));
  assert.ok(result.run.cases.every((item) => item.disposition === "verified-pass"));
  assert.equal((await verifyRun(result.runRoot)).ok, true);
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
  await writeFile(casePath, `${JSON.stringify(caseRecord, null, 2)}\n`);
  const runPath = path.join(result.runRoot, "run.json");
  const run = await readJson(runPath);
  run.cases[0] = caseRecord;
  run.summary.verifiedPasses = 1;
  run.summary.refusals = 2;
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
