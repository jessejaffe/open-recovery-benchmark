import { spawn } from "node:child_process";
import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalize, digestDocument, sha256 } from "./canonical.mjs";
import { filesEqual, hashFile, readJson, resolveContained, resolveContainedFile, writeJson } from "./files.mjs";
import { validateCorpus, validateGuidedObservations, validateProtocol, validateTool } from "./contracts.mjs";
import { missingOutputValidation, validateCapturedOutput } from "./validators.mjs";

const HARNESS = Object.freeze({
  name: "stillopen-open-recovery-benchmark-kit",
  version: "1.4.0",
});

const SUPPORTED_HARNESS_VERSIONS = new Set(["1.0.0", "1.1.0", "1.2.0", "1.3.0", HARNESS.version]);

function safeRunId(value) {
  if (!/^[a-z0-9][a-z0-9._-]{1,99}$/.test(value)) throw new Error("runId is not a portable identifier.");
  return value;
}

function substitute(value, replacements) {
  return value.replace(/\{(node|input|output|caseId)\}/g, (_, key) => replacements[key]);
}

function commandTerminalOutcome(tool, observation, hasOutput, healthyNoChange = false) {
  const mappedDisposition = tool.adapter.exitCodeDisposition?.[String(observation.exitCode)];
  const successExitCodes = tool.adapter.successExitCodes ?? [0];
  let disposition = "error";
  if (observation.launchError) disposition = "launch-error";
  else if (observation.timedOut) disposition = "timeout";
  else if (healthyNoChange) disposition = "healthy-no-change";
  else if (mappedDisposition) disposition = mappedDisposition;
  else if (successExitCodes.includes(observation.exitCode) && hasOutput) disposition = "output-produced";
  else if (successExitCodes.includes(observation.exitCode)) disposition = "no-output";
  return { disposition, terminalOutcomeEligible: ["output-produced", "healthy-no-change"].includes(disposition) };
}

function commandHealthyNoChange(tool, frozenCase, observation, hasOutput) {
  return inputCondition(frozenCase) === "healthy-control"
    && !hasOutput
    && !observation.launchError
    && !observation.timedOut
    && tool.adapter.healthyNoChangeExitCodes?.includes(observation.exitCode) === true;
}

function guidedTerminalOutcome(productOutcome, hasOutput, healthyNoChange = false) {
  if (healthyNoChange && ["success", "no-output"].includes(productOutcome)) {
    return { disposition: "healthy-no-change", terminalOutcomeEligible: true };
  }
  const disposition = productOutcome === "success" && hasOutput ? "output-produced" : productOutcome === "success" ? "no-output" : productOutcome;
  return { disposition, terminalOutcomeEligible: disposition === "output-produced" };
}

function scoredDisposition(validationPass, terminal) {
  if (!terminal.terminalOutcomeEligible) return terminal.disposition;
  return validationPass ? "verified-pass" : "changed-output";
}

function inputCondition(item) {
  return item.inputCondition ?? "damaged";
}

function evidenceExtension(relativePath) {
  return path.extname(relativePath).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
}

function guidedReturnedFileDescriptors(recorded) {
  if (recorded.returnedFiles) {
    return recorded.returnedFiles.map((returnedFile) => ({
      path: returnedFile.path,
      recommended: returnedFile.recommended === true,
      legacy: false,
    }));
  }
  if (!recorded.outputPath) return [];
  return [{ path: recorded.outputPath, recommended: false, legacy: true }];
}

function outputDescriptor(file) {
  if (!file) return null;
  return { path: file.path, byteLength: file.byteLength, sha256: file.sha256 };
}

function chooseChangedOutput(changedFiles) {
  if (changedFiles.length === 0) return { selected: null, strategy: "no-changed-output" };
  if (changedFiles.length === 1) return { selected: changedFiles[0], strategy: "sole-changed-output" };
  const recommended = changedFiles.find((file) => file.recommended);
  if (recommended) return { selected: recommended, strategy: "recommended-changed-output" };
  return { selected: changedFiles[0], strategy: "first-displayed-changed-output" };
}

function classifyReturnedFiles(condition, returnedFiles) {
  const identicalFiles = returnedFiles.filter((file) => file.inputComparison === "byte-identical");
  const changedFiles = returnedFiles.filter((file) => file.inputComparison === "changed");
  let selected = null;
  let strategy;
  if (condition === "healthy-control") {
    if (identicalFiles.length > 0) {
      selected = identicalFiles.find((file) => file.recommended) ?? identicalFiles[0];
      strategy = selected.recommended ? "healthy-recommended-identical-output" : "healthy-identical-output";
    } else if (changedFiles.length > 0) {
      const changedSelection = chooseChangedOutput(changedFiles);
      selected = changedSelection.selected;
      strategy = changedSelection.strategy === "recommended-changed-output"
        ? "recommended-unexpected-changed-output"
        : changedSelection.strategy === "first-displayed-changed-output"
          ? "first-displayed-unexpected-changed-output"
          : "sole-unexpected-changed-output";
    } else {
      strategy = "no-returned-output";
    }
  } else {
    ({ selected, strategy } = chooseChangedOutput(changedFiles));
  }
  const classifiedFiles = returnedFiles.map((file) => {
    let classification;
    if (condition === "healthy-control") {
      if (file.inputComparison === "byte-identical") {
        classification = file === selected ? "selected-healthy-output" : "unchanged-healthy-output";
      } else {
        classification = file === selected ? "selected-unexpected-changed-output" : "unexpected-changed-output";
      }
    } else if (file.inputComparison === "byte-identical") {
      classification = "original-returned";
    } else {
      classification = file === selected ? "selected-repair-output" : "repair-candidate";
    }
    return { ...file, classification };
  });
  const classifiedSelection = selected
    ? classifiedFiles.find((file) => file.path === selected.path)
    : null;
  return {
    returnedFiles: classifiedFiles,
    selected: classifiedSelection,
    outputSelection: {
      strategy,
      selectedReturnedFile: classifiedSelection?.path ?? null,
    },
  };
}

function usesReturnedFileClassification(plan) {
  return ["1.2.0", "1.3.0", "1.4.0"].includes(plan.harness.version);
}

function guidedObservationMatchesRecorded(observation, recorded) {
  return observation.productOutcome === recorded.productOutcome
    && observation.attemptedAt === recorded.attemptedAt
    && observation.productMessage === (recorded.productMessage ?? null)
    && observation.operatorNote === (recorded.operatorNote ?? null);
}

function returnedEvidencePath(caseId, returnedPath, index) {
  return `cases/${caseId}/returned-files/${String(index + 1).padStart(2, "0")}${evidenceExtension(returnedPath)}`;
}

async function expectedClassifiedGuidedObservation({ runRoot, caseId, frozenCase, recorded, inputEvidencePath, inputEvidence }) {
  const returnedFiles = [];
  for (const [index, returnedDescriptor] of guidedReturnedFileDescriptors(recorded).entries()) {
    const relativePath = returnedEvidencePath(caseId, returnedDescriptor.path, index);
    const evidenceFile = resolveContained(runRoot, relativePath, "guided returned-file evidence");
    returnedFiles.push({
      path: relativePath,
      ...await hashFile(evidenceFile),
      displayOrder: index + 1,
      recommended: returnedDescriptor.recommended,
      inputComparison: await filesEqual(inputEvidencePath, evidenceFile) ? "byte-identical" : "changed",
    });
  }
  const classification = classifyReturnedFiles(inputCondition(frozenCase), returnedFiles);
  const healthyNoChange = inputCondition(frozenCase) === "healthy-control"
    && returnedFiles.length === 0
    && ["success", "no-output"].includes(recorded.productOutcome);
  const output = healthyNoChange
    ? { path: `cases/${caseId}/input.bin`, ...inputEvidence }
    : outputDescriptor(classification.selected);
  return {
    output,
    returnedFiles: classification.returnedFiles,
    outputSelection: healthyNoChange
      ? { strategy: "healthy-no-change", selectedReturnedFile: null }
      : classification.outputSelection,
    healthyNoChange,
  };
}

async function captureProcess({ executable, args, cwd, timeoutMs, maxCapturedBytes }) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exceeded = false;
    let timedOut = false;
    let settled = false;
    const collect = (target, chunk, type) => {
      const current = type === "stdout" ? stdoutBytes : stderrBytes;
      const remaining = Math.max(0, maxCapturedBytes - current);
      if (remaining > 0) target.push(chunk.subarray(0, remaining));
      if (type === "stdout") stdoutBytes += chunk.byteLength;
      else stderrBytes += chunk.byteLength;
      if (current + chunk.byteLength > maxCapturedBytes) exceeded = true;
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk) => collect(stderr, chunk, "stderr"));
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.once("error", (error) => finish({
      exitCode: null,
      signal: null,
      timedOut: false,
      captureTruncated: exceeded,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
      launchError: { code: error.code ?? "UNKNOWN", message: error.message },
    }));
    const terminate = () => {
      timedOut = true;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // The process may have exited between the timer and signal.
      }
    };
    timer = setTimeout(terminate, timeoutMs);
    child.once("close", (exitCode, signal) => {
      finish({
        exitCode,
        signal,
        timedOut,
        captureTruncated: exceeded,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        launchError: null,
      });
    });
  });
}

async function assertDeclaredFile(root, descriptor, label) {
  const file = await resolveContainedFile(root, descriptor.path, label);
  const actual = await hashFile(file);
  if (actual.byteLength !== descriptor.byteLength || actual.sha256 !== descriptor.sha256) {
    throw new Error(`${label} no longer matches its frozen byte length and SHA-256.`);
  }
  return file;
}

function makePlan(protocol, corpus, tool, environment = {
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
}, harness = HARNESS) {
  if (harness.name !== HARNESS.name || !SUPPORTED_HARNESS_VERSIONS.has(harness.version)) {
    throw new Error("Frozen plan uses an unsupported benchmark harness version.");
  }
  if (harness.version === "1.0.0" && corpus.cases.some((item) => item.groundTruth.validator !== "exact-sha256-v1")) {
    throw new Error("Benchmark harness 1.0.0 supports only exact-sha256-v1.");
  }
  const planBody = {
    schemaVersion: 1,
    kind: "benchmark-plan",
    harness,
    protocol: { id: protocol.id, digest: digestDocument(protocol) },
    corpus: { id: corpus.id, digest: digestDocument(corpus) },
    tool: {
      id: tool.id,
      digest: digestDocument(tool),
      vendor: tool.vendor,
      product: tool.product,
      version: tool.version,
      platform: tool.platform,
      synthetic: tool.synthetic,
    },
    scoring: protocol.scoring,
    limits: protocol.limits,
    environment,
    orderedCases: corpus.cases.map((item) => item.id),
  };
  return { ...planBody, planDigest: digestDocument(planBody) };
}

async function inventory(root) {
  const relativePaths = [];
  async function walk(directory, relativeDirectory = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Evidence may not contain symbolic links: ${relativePath}.`);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relativePath);
      else if (entry.isFile() && relativePath !== "attestation.json") relativePaths.push(relativePath);
      else if (!entry.isFile()) throw new Error(`Unsupported evidence item: ${relativePath}.`);
    }
  }
  await walk(root);
  const files = [];
  for (const relativePath of [...relativePaths].sort()) {
    files.push({ path: relativePath, ...await hashFile(resolveContained(root, relativePath, "evidence path")) });
  }
  return files;
}

function summarize(caseResults, tool) {
  return {
    eligibleCases: caseResults.length,
    verifiedPasses: caseResults.filter((item) => item.disposition === "verified-pass").length,
    changedOutputs: caseResults.filter((item) => item.disposition === "changed-output").length,
    refusals: caseResults.filter((item) => item.disposition === "refusal").length,
    unavailable: caseResults.filter((item) => ["unavailable", "paywalled"].includes(item.disposition)).length,
    errors: caseResults.filter((item) => ["error", "launch-error", "timeout", "no-output"].includes(item.disposition)).length,
    competitiveSummaryEligible: !tool.synthetic,
  };
}

async function finalizeRun({ runRoot, protocol, corpus, tool, plan, caseResults }) {
  const summary = summarize(caseResults, tool);
  const run = {
    schemaVersion: 1,
    kind: "benchmark-run",
    runId: path.basename(runRoot),
    protocol: { id: protocol.id, title: protocol.title, publicClaim: protocol.publicClaim, digest: plan.protocol.digest },
    corpus: { id: corpus.id, title: corpus.title, digest: plan.corpus.digest },
    tool: plan.tool,
    planDigest: plan.planDigest,
    claimBoundary: tool.synthetic
      ? "Synthetic harness demonstration only; this run is not competitor performance evidence."
      : protocol.publicClaim,
    cases: caseResults,
    summary,
  };
  await writeJson(path.join(runRoot, "run.json"), run);
  const files = await inventory(runRoot);
  const attestationBody = {
    schemaVersion: 1,
    kind: "benchmark-attestation",
    runId: run.runId,
    algorithm: "sha256",
    files,
    signature: null,
    signatureStatus: "unsigned",
  };
  const attestation = { ...attestationBody, rootDigest: sha256(canonicalize(files)) };
  await writeJson(path.join(runRoot, "attestation.json"), attestation);
  return { runRoot, run, attestation };
}

export async function executeBenchmark({ protocolPath, corpusPath, toolPath, workspaceRoot, runId }) {
  const protocol = await readJson(protocolPath);
  const corpus = await readJson(corpusPath);
  const tool = await readJson(toolPath);
  validateProtocol(protocol);
  validateCorpus(corpus);
  validateTool(tool);
  if (tool.adapter.kind !== "command") throw new Error("executeBenchmark requires a command adapter; use ingest-guided for guided observations.");
  safeRunId(runId);
  const plan = makePlan(protocol, corpus, tool);
  const runRoot = path.resolve(workspaceRoot, runId);
  await mkdir(path.resolve(workspaceRoot), { recursive: true });
  await mkdir(runRoot, { recursive: false });
  const caseResults = [];
  const corpusRoot = path.dirname(path.resolve(corpusPath));
  const toolRoot = path.dirname(path.resolve(toolPath));

  await writeJson(path.join(runRoot, "plan.json"), plan);
  await writeJson(path.join(runRoot, "protocol.json"), protocol);
  await writeJson(path.join(runRoot, "corpus.json"), corpus);
  await writeJson(path.join(runRoot, "tool.json"), tool);

  for (const item of corpus.cases) {
    const caseRoot = path.join(runRoot, "cases", item.id);
    const inputEvidence = path.join(caseRoot, "input.bin");
    const outputRoot = path.join(caseRoot, "tool-output");
    const outputEvidence = resolveContained(outputRoot, tool.adapter.outputFile, "tool outputFile");
    const outputRelative = path.relative(runRoot, outputEvidence).split(path.sep).join("/");
    const groundTruthEvidence = path.join(caseRoot, "ground-truth.bin");
    const stdoutFile = path.join(caseRoot, "stdout.txt");
    const stderrFile = path.join(caseRoot, "stderr.txt");
    await mkdir(path.dirname(outputEvidence), { recursive: true });
    const declaredInput = await assertDeclaredFile(corpusRoot, item.input, `case ${item.id} input`);
    const declaredGroundTruth = await assertDeclaredFile(corpusRoot, item.groundTruth, `case ${item.id} ground truth`);
    await cp(declaredInput, inputEvidence, { errorOnExist: true, force: false });
    const copiedInput = await hashFile(inputEvidence);
    if (copiedInput.sha256 !== item.input.sha256) throw new Error(`case ${item.id} input changed while it was copied.`);

    const replacements = {
      node: process.execPath,
      input: inputEvidence,
      output: outputEvidence,
      caseId: item.id,
    };
    const executable = substitute(tool.adapter.executable, replacements);
    const args = tool.adapter.args.map((arg) => substitute(arg, replacements));
    const startedAt = new Date().toISOString();
    const processResult = await captureProcess({
      executable,
      args,
      cwd: toolRoot,
      timeoutMs: protocol.limits.timeoutMs,
      maxCapturedBytes: protocol.limits.maxCapturedBytes,
    });
    const inputAfterExecution = await hashFile(inputEvidence);
    if (inputAfterExecution.byteLength !== copiedInput.byteLength || inputAfterExecution.sha256 !== copiedInput.sha256) {
      throw new Error(`case ${item.id} input was mutated during tool execution; the run is invalid.`);
    }
    const endedAt = new Date().toISOString();
    await writeFile(stdoutFile, processResult.stdout, { flag: "wx" });
    await writeFile(stderrFile, processResult.stderr, { flag: "wx" });
    await cp(declaredGroundTruth, groundTruthEvidence, { errorOnExist: true, force: false });

    let output = null;
    try {
      if ((await stat(outputEvidence)).isFile()) output = { path: outputRelative, ...await hashFile(outputEvidence) };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const healthyNoChange = commandHealthyNoChange(tool, item, processResult, Boolean(output));
    const validationOutput = healthyNoChange
      ? { path: path.relative(runRoot, inputEvidence).split(path.sep).join("/"), ...inputAfterExecution }
      : output;
    const terminal = commandTerminalOutcome(tool, processResult, Boolean(output), healthyNoChange);

    const validation = validationOutput
      ? await validateCapturedOutput({
          validator: item.groundTruth.validator,
          outputPath: healthyNoChange ? inputEvidence : outputEvidence,
          output: validationOutput,
          groundTruthPath: groundTruthEvidence,
          groundTruth: item.groundTruth,
        })
      : missingOutputValidation(item.groundTruth.validator);
    const disposition = scoredDisposition(validation.pass, terminal);
    const result = {
      caseId: item.id,
      format: item.format,
      damageClass: item.damageClass,
      eligible: true,
      observation: {
        disposition: terminal.disposition,
        terminalOutcomeEligible: terminal.terminalOutcomeEligible,
        startedAt,
        endedAt,
        exitCode: processResult.exitCode,
        signal: processResult.signal,
        timedOut: processResult.timedOut,
        captureTruncated: processResult.captureTruncated,
        launchError: processResult.launchError,
        stdout: `cases/${item.id}/stdout.txt`,
        stderr: `cases/${item.id}/stderr.txt`,
        output,
        healthyNoChange,
      },
      validation,
      disposition,
    };
    await writeJson(path.join(caseRoot, "result.json"), result);
    caseResults.push(result);
  }

  return finalizeRun({ runRoot, protocol, corpus, tool, plan, caseResults });
}

export async function ingestGuidedBenchmark({ protocolPath, corpusPath, toolPath, observationsPath, workspaceRoot, runId }) {
  const protocol = await readJson(protocolPath);
  const corpus = await readJson(corpusPath);
  const tool = await readJson(toolPath);
  const observations = await readJson(observationsPath);
  validateProtocol(protocol);
  validateCorpus(corpus);
  validateTool(tool);
  if (tool.adapter.kind !== "guided") throw new Error("ingestGuidedBenchmark requires a guided adapter.");
  validateGuidedObservations(observations, corpus, tool);
  safeRunId(runId);
  const plan = makePlan(protocol, corpus, tool);
  const runRoot = path.resolve(workspaceRoot, runId);
  await mkdir(path.resolve(workspaceRoot), { recursive: true });
  await mkdir(runRoot, { recursive: false });
  await writeJson(path.join(runRoot, "plan.json"), plan);
  await writeJson(path.join(runRoot, "protocol.json"), protocol);
  await writeJson(path.join(runRoot, "corpus.json"), corpus);
  await writeJson(path.join(runRoot, "tool.json"), tool);
  await writeJson(path.join(runRoot, "guided-observations.json"), observations);
  const corpusRoot = path.dirname(path.resolve(corpusPath));
  const observationsRoot = path.dirname(path.resolve(observationsPath));
  const caseResults = [];

  for (const item of corpus.cases) {
    const recorded = observations.cases.find((candidate) => candidate.caseId === item.id);
    const caseRoot = path.join(runRoot, "cases", item.id);
    await mkdir(caseRoot, { recursive: true });
    const declaredInput = await assertDeclaredFile(corpusRoot, item.input, `case ${item.id} input`);
    const declaredGroundTruth = await assertDeclaredFile(corpusRoot, item.groundTruth, `case ${item.id} ground truth`);
    const inputEvidence = path.join(caseRoot, "input.bin");
    const groundTruthEvidence = path.join(caseRoot, "ground-truth.bin");
    await cp(declaredInput, inputEvidence, { errorOnExist: true, force: false });
    await cp(declaredGroundTruth, groundTruthEvidence, { errorOnExist: true, force: false });
    const returnedFiles = [];
    for (const [index, returnedDescriptor] of guidedReturnedFileDescriptors(recorded).entries()) {
      const declaredOutput = await resolveContainedFile(
        observationsRoot,
        returnedDescriptor.path,
        returnedDescriptor.legacy ? `case ${item.id} guided output` : `case ${item.id} guided returned file`,
      );
      const relativePath = returnedEvidencePath(item.id, returnedDescriptor.path, index);
      const outputEvidence = resolveContained(runRoot, relativePath, "guided returned-file evidence");
      await mkdir(path.dirname(outputEvidence), { recursive: true });
      await cp(declaredOutput, outputEvidence, { errorOnExist: true, force: false });
      returnedFiles.push({
        path: relativePath,
        ...await hashFile(outputEvidence),
        displayOrder: index + 1,
        recommended: returnedDescriptor.recommended,
        inputComparison: await filesEqual(inputEvidence, outputEvidence) ? "byte-identical" : "changed",
      });
    }
    const classification = classifyReturnedFiles(inputCondition(item), returnedFiles);
    const healthyNoChange = inputCondition(item) === "healthy-control"
      && returnedFiles.length === 0
      && ["success", "no-output"].includes(recorded.productOutcome);
    const output = healthyNoChange
      ? { path: `cases/${item.id}/input.bin`, ...await hashFile(inputEvidence) }
      : outputDescriptor(classification.selected);
    const outputSelection = healthyNoChange
      ? { strategy: "healthy-no-change", selectedReturnedFile: null }
      : classification.outputSelection;
    const attachments = [];
    for (const [index, attachmentPath] of (recorded.attachments ?? []).entries()) {
      const declaredAttachment = await resolveContainedFile(observationsRoot, attachmentPath, `case ${item.id} attachment`);
      const relativePath = `cases/${item.id}/attachments/${String(index + 1).padStart(2, "0")}${evidenceExtension(attachmentPath)}`;
      const evidenceFile = resolveContained(runRoot, relativePath, "guided attachment evidence");
      await mkdir(path.dirname(evidenceFile), { recursive: true });
      await cp(declaredAttachment, evidenceFile, { errorOnExist: true, force: false });
      attachments.push({ path: relativePath, ...await hashFile(evidenceFile) });
    }
    const inputAfterCapture = await hashFile(inputEvidence);
    if (inputAfterCapture.byteLength !== item.input.byteLength || inputAfterCapture.sha256 !== item.input.sha256) {
      throw new Error(`case ${item.id} input changed during guided evidence capture.`);
    }
    const validation = output
      ? await validateCapturedOutput({
          validator: item.groundTruth.validator,
          outputPath: resolveContained(runRoot, output.path, "guided output evidence"),
          output,
          groundTruthPath: groundTruthEvidence,
          groundTruth: item.groundTruth,
        })
      : missingOutputValidation(item.groundTruth.validator);
    const terminal = guidedTerminalOutcome(recorded.productOutcome, Boolean(output), healthyNoChange);
    const disposition = scoredDisposition(validation.pass, terminal);
    const result = {
      caseId: item.id,
      format: item.format,
      damageClass: item.damageClass,
      eligible: true,
      observation: {
        disposition: terminal.disposition,
        terminalOutcomeEligible: terminal.terminalOutcomeEligible,
        productOutcome: recorded.productOutcome,
        attemptedAt: recorded.attemptedAt,
        productMessage: recorded.productMessage ?? null,
        operatorNote: recorded.operatorNote ?? null,
        output,
        returnedFiles: classification.returnedFiles,
        outputSelection,
        attachments,
      },
      validation,
      disposition,
    };
    await writeJson(path.join(caseRoot, "result.json"), result);
    caseResults.push(result);
  }
  return finalizeRun({ runRoot, protocol, corpus, tool, plan, caseResults });
}

export async function verifyRun(runRoot) {
  const attestation = await readJson(path.join(runRoot, "attestation.json"));
  if (attestation.schemaVersion !== 1 || attestation.kind !== "benchmark-attestation") throw new Error("Unsupported attestation contract.");
  const expectedRoot = sha256(canonicalize(attestation.files));
  if (expectedRoot !== attestation.rootDigest) throw new Error("Attestation root digest does not match its inventory.");
  const actualInventory = await inventory(runRoot);
  const expectedPaths = attestation.files.map((item) => item.path);
  const actualPaths = actualInventory.map((item) => item.path);
  if (canonicalize(actualPaths) !== canonicalize(expectedPaths)) throw new Error("Evidence inventory contains missing or unexpected files.");
  for (const expected of attestation.files) {
    const actual = await hashFile(resolveContained(runRoot, expected.path, "attested evidence path"));
    if (actual.byteLength !== expected.byteLength || actual.sha256 !== expected.sha256) {
      throw new Error(`Evidence verification failed for ${expected.path}.`);
    }
  }
  const run = await readJson(path.join(runRoot, "run.json"));
  const protocol = await readJson(path.join(runRoot, "protocol.json"));
  const corpus = await readJson(path.join(runRoot, "corpus.json"));
  const tool = await readJson(path.join(runRoot, "tool.json"));
  const plan = await readJson(path.join(runRoot, "plan.json"));
  validateProtocol(protocol);
  validateCorpus(corpus);
  validateTool(tool);
  const expectedPlan = makePlan(protocol, corpus, tool, plan.environment, plan.harness);
  if (canonicalize(plan) !== canonicalize(expectedPlan)) throw new Error("Frozen plan does not match its protocol, corpus, tool, environment, and digest.");
  if (run.runId !== attestation.runId || run.planDigest !== plan.planDigest) throw new Error("Run identity does not match its plan and attestation.");
  if (run.protocol.digest !== plan.protocol.digest || run.corpus.digest !== plan.corpus.digest || run.tool.digest !== plan.tool.digest) {
    throw new Error("Run definition digests do not match the frozen plan.");
  }
  if (canonicalize(run.cases.map((item) => item.caseId)) !== canonicalize(plan.orderedCases)) {
    throw new Error("Run cases do not exactly match the frozen case order.");
  }
  if (canonicalize(run.summary) !== canonicalize(summarize(run.cases, tool))) throw new Error("Run summary does not match its case evidence.");
  const expectedClaimBoundary = tool.synthetic
    ? "Synthetic harness demonstration only; this run is not competitor performance evidence."
    : protocol.publicClaim;
  if (run.claimBoundary !== expectedClaimBoundary || canonicalize(run.tool) !== canonicalize(plan.tool)) {
    throw new Error("Run claim boundary or tool identity does not match the frozen definitions.");
  }
  let guidedObservations = null;
  if (tool.adapter.kind === "guided") {
    guidedObservations = await readJson(path.join(runRoot, "guided-observations.json"));
    validateGuidedObservations(guidedObservations, corpus, tool);
  } else if (expectedPaths.includes("guided-observations.json")) {
    throw new Error("Command runs may not contain guided observation records.");
  }
  for (const item of run.cases) {
    const frozenCase = corpus.cases.find((candidate) => candidate.id === item.caseId);
    if (!frozenCase || item.eligible !== true || item.format !== frozenCase.format || item.damageClass !== frozenCase.damageClass) {
      throw new Error(`Run case metadata does not match the frozen corpus for ${item.caseId}.`);
    }
    const inputEvidencePath = resolveContained(runRoot, `cases/${item.caseId}/input.bin`, "case input evidence");
    const groundTruthEvidencePath = resolveContained(runRoot, `cases/${item.caseId}/ground-truth.bin`, "case ground-truth evidence");
    const inputEvidence = await hashFile(inputEvidencePath);
    const groundTruthEvidence = await hashFile(groundTruthEvidencePath);
    if (inputEvidence.byteLength !== frozenCase.input.byteLength || inputEvidence.sha256 !== frozenCase.input.sha256
      || groundTruthEvidence.byteLength !== frozenCase.groundTruth.byteLength || groundTruthEvidence.sha256 !== frozenCase.groundTruth.sha256) {
      throw new Error(`Case input or ground truth does not match the frozen corpus for ${item.caseId}.`);
    }
    let guidedRecorded = null;
    let guidedClassification = null;
    if (tool.adapter.kind === "guided") {
      guidedRecorded = guidedObservations.cases.find((candidate) => candidate.caseId === item.caseId);
      if (!guidedRecorded || !guidedObservationMatchesRecorded(item.observation, guidedRecorded)) {
        throw new Error(`Guided case record does not match guided-observations.json for ${item.caseId}.`);
      }
      if (usesReturnedFileClassification(plan)) {
        guidedClassification = await expectedClassifiedGuidedObservation({
          runRoot,
          caseId: item.caseId,
          frozenCase,
          recorded: guidedRecorded,
          inputEvidencePath,
          inputEvidence,
        });
        if (canonicalize(item.observation.returnedFiles) !== canonicalize(guidedClassification.returnedFiles)
          || canonicalize(item.observation.outputSelection) !== canonicalize(guidedClassification.outputSelection)
          || canonicalize(item.observation.output) !== canonicalize(guidedClassification.output)) {
          throw new Error(`Guided returned-file classification is inconsistent for ${item.caseId}.`);
        }
      }
    }
    const expectedCommandHealthyNoChange = tool.adapter.kind === "command"
      && commandHealthyNoChange(tool, frozenCase, item.observation, Boolean(item.observation.output));
    let expectedValidation;
    if (item.observation.output) {
      const actualOutput = await hashFile(resolveContained(runRoot, item.observation.output.path, "case output evidence"));
      if (actualOutput.byteLength !== item.observation.output.byteLength || actualOutput.sha256 !== item.observation.output.sha256) {
        throw new Error(`Case output record does not match captured evidence for ${item.caseId}.`);
      }
      expectedValidation = await validateCapturedOutput({
        validator: frozenCase.groundTruth.validator,
        outputPath: resolveContained(runRoot, item.observation.output.path, "case output evidence"),
        output: actualOutput,
        groundTruthPath: groundTruthEvidencePath,
        groundTruth: frozenCase.groundTruth,
      });
    } else if (expectedCommandHealthyNoChange) {
      expectedValidation = await validateCapturedOutput({
        validator: frozenCase.groundTruth.validator,
        outputPath: inputEvidencePath,
        output: inputEvidence,
        groundTruthPath: groundTruthEvidencePath,
        groundTruth: frozenCase.groundTruth,
      });
    } else {
      expectedValidation = missingOutputValidation(frozenCase.groundTruth.validator);
    }
    if (canonicalize(item.validation) !== canonicalize(expectedValidation)) throw new Error(`Independent validation record is inconsistent for ${item.caseId}.`);
    let expectedTerminal;
    if (tool.adapter.kind === "command") {
      if (typeof item.observation.timedOut !== "boolean"
        || !(item.observation.exitCode === null || Number.isInteger(item.observation.exitCode))) {
        throw new Error(`Command timeout or exit semantics are invalid for ${item.caseId}.`);
      }
      if (item.observation.stdout !== `cases/${item.caseId}/stdout.txt` || item.observation.stderr !== `cases/${item.caseId}/stderr.txt`) {
        throw new Error(`Command logs are not tied to the case record for ${item.caseId}.`);
      }
      if ((item.observation.healthyNoChange ?? false) !== expectedCommandHealthyNoChange) {
        throw new Error(`Command healthy-control semantics are inconsistent for ${item.caseId}.`);
      }
      expectedTerminal = commandTerminalOutcome(tool, item.observation, Boolean(item.observation.output), expectedCommandHealthyNoChange);
    } else {
      if (!usesReturnedFileClassification(plan)
        && Boolean(item.observation.output) !== Boolean(guidedRecorded.outputPath)) {
        throw new Error(`Guided case record does not match guided-observations.json for ${item.caseId}.`);
      }
      const expectedAttachmentPaths = (guidedRecorded.attachments ?? []).map((attachmentPath, index) => {
        return `cases/${item.caseId}/attachments/${String(index + 1).padStart(2, "0")}${evidenceExtension(attachmentPath)}`;
      });
      if (canonicalize((item.observation.attachments ?? []).map((attachment) => attachment.path)) !== canonicalize(expectedAttachmentPaths)) {
        throw new Error(`Guided attachments do not match guided-observations.json for ${item.caseId}.`);
      }
      for (const attachment of item.observation.attachments ?? []) {
        const actualAttachment = await hashFile(resolveContained(runRoot, attachment.path, "guided attachment evidence"));
        if (actualAttachment.byteLength !== attachment.byteLength || actualAttachment.sha256 !== attachment.sha256) {
          throw new Error(`Guided attachment record does not match evidence for ${item.caseId}.`);
        }
      }
      expectedTerminal = guidedTerminalOutcome(
        guidedRecorded.productOutcome,
        Boolean(item.observation.output),
        guidedClassification?.healthyNoChange === true,
      );
    }
    if (item.observation.disposition !== expectedTerminal.disposition
      || item.observation.terminalOutcomeEligible !== expectedTerminal.terminalOutcomeEligible) {
      throw new Error(`Terminal outcome semantics are inconsistent for ${item.caseId}.`);
    }
    const expectedDisposition = scoredDisposition(expectedValidation.pass, expectedTerminal);
    if (item.disposition !== expectedDisposition) throw new Error(`Scored disposition is inconsistent for ${item.caseId}.`);
    const caseRecord = await readJson(resolveContained(runRoot, `cases/${item.caseId}/result.json`, "case result path"));
    if (canonicalize(item) !== canonicalize(caseRecord)) throw new Error(`Run summary record does not match case evidence for ${item.caseId}.`);
  }
  return { ok: true, runId: run.runId, rootDigest: attestation.rootDigest, filesVerified: attestation.files.length };
}

export { makePlan };
