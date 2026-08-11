import { spawn } from "node:child_process";
import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonicalize, digestDocument, sha256 } from "./canonical.mjs";
import { hashFile, readJson, resolveContained, resolveContainedFile, writeJson } from "./files.mjs";
import { validateCorpus, validateGuidedObservations, validateProtocol, validateTool } from "./contracts.mjs";
import { missingOutputValidation, validateCapturedOutput } from "./validators.mjs";

const HARNESS = Object.freeze({
  name: "stillopen-open-recovery-benchmark-kit",
  version: "1.3.0",
});

const SUPPORTED_HARNESS_VERSIONS = new Set(["1.0.0", "1.1.0", "1.2.0", HARNESS.version]);
const CASE_CATEGORIES = [
  "damaged-full-restoration",
  "damaged-partial-restoration",
  "healthy-control",
];

function safeRunId(value) {
  if (!/^[a-z0-9][a-z0-9._-]{1,99}$/.test(value)) throw new Error("runId is not a portable identifier.");
  return value;
}

function substitute(value, replacements) {
  return value.replace(/\{(node|input|output|caseId)\}/g, (_, key) => replacements[key]);
}

function commandTerminalOutcome(tool, observation, hasOutput) {
  const mappedDisposition = tool.adapter.exitCodeDisposition?.[String(observation.exitCode)];
  let disposition = "error";
  if (observation.launchError) disposition = "launch-error";
  else if (observation.timedOut) disposition = "timeout";
  else if (mappedDisposition) disposition = mappedDisposition;
  else if (observation.exitCode === 0 && hasOutput) disposition = "output-produced";
  else if (observation.exitCode === 0) disposition = "no-output";
  return { disposition, terminalOutcomeEligible: disposition === "output-produced" };
}

function guidedTerminalOutcome(productOutcome, hasOutput) {
  const disposition = productOutcome === "success" && hasOutput ? "output-produced" : productOutcome === "success" ? "no-output" : productOutcome;
  return { disposition, terminalOutcomeEligible: disposition === "output-produced" };
}

function scoredDisposition(validation, terminal) {
  if (!terminal.terminalOutcomeEligible) return terminal.disposition;
  if (validation.pass) return "verified-pass";
  return validation.score > 0 ? "verified-partial" : "changed-output";
}

function scoringEligible(disposition) {
  return !["unavailable", "paywalled"].includes(disposition);
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

function summarize(caseResults, tool, protocol) {
  const categoryScores = Object.fromEntries(CASE_CATEGORIES.map((category) => {
    const cases = caseResults.filter((item) => item.category === category);
    const eligibleCases = cases.filter((item) => item.eligible);
    const total = eligibleCases.reduce((sum, item) => sum + item.score, 0);
    return [category, {
      cases: cases.length,
      eligibleCases: eligibleCases.length,
      unscoredCases: cases.length - eligibleCases.length,
      meanRecoveryScore: eligibleCases.length === 0 ? null : Number((total / eligibleCases.length).toFixed(6)),
      fullRecoveries: cases.filter((item) => item.disposition === "verified-pass").length,
      partialRecoveries: cases.filter((item) => item.disposition === "verified-partial").length,
      zeroRecoveries: eligibleCases.filter((item) => item.score === 0).length,
    }];
  }));
  const eligibleCases = caseResults.filter((item) => item.eligible);
  const totalScore = eligibleCases.reduce((sum, item) => sum + item.score, 0);
  return {
    declaredCases: caseResults.length,
    eligibleCases: eligibleCases.length,
    unscoredCases: caseResults.length - eligibleCases.length,
    verifiedPasses: caseResults.filter((item) => item.disposition === "verified-pass").length,
    verifiedPartials: caseResults.filter((item) => item.disposition === "verified-partial").length,
    changedOutputs: caseResults.filter((item) => item.disposition === "changed-output").length,
    refusals: caseResults.filter((item) => item.disposition === "refusal").length,
    unavailable: caseResults.filter((item) => ["unavailable", "paywalled"].includes(item.disposition)).length,
    errors: caseResults.filter((item) => ["error", "launch-error", "timeout", "no-output"].includes(item.disposition)).length,
    meanRecoveryScore: eligibleCases.length === 0 ? null : Number((totalScore / eligibleCases.length).toFixed(6)),
    categoryScores,
    competitiveSummaryEligible: !tool.synthetic && protocol.competitiveSummaryEligible !== false,
  };
}

async function finalizeRun({ runRoot, protocol, corpus, tool, plan, caseResults }) {
  const summary = summarize(caseResults, tool, protocol);
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
    const terminal = commandTerminalOutcome(tool, processResult, Boolean(output));

    const validation = output
      ? await validateCapturedOutput({
          validator: item.groundTruth.validator,
          outputPath: outputEvidence,
          output,
          groundTruthPath: groundTruthEvidence,
          groundTruth: item.groundTruth,
        })
      : missingOutputValidation(item.groundTruth.validator);
    const disposition = scoredDisposition(validation, terminal);
    const result = {
      caseId: item.id,
      category: item.category,
      format: item.format,
      damageClass: item.damageClass,
      eligible: scoringEligible(terminal.disposition),
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
      },
      validation,
      score: terminal.terminalOutcomeEligible ? validation.score : 0,
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
    let output = null;
    if (recorded.outputPath) {
      const declaredOutput = await resolveContainedFile(observationsRoot, recorded.outputPath, `case ${item.id} guided output`);
      const outputEvidence = path.join(caseRoot, "operator-output.bin");
      await cp(declaredOutput, outputEvidence, { errorOnExist: true, force: false });
      output = { path: `cases/${item.id}/operator-output.bin`, ...await hashFile(outputEvidence) };
    }
    const attachments = [];
    for (const [index, attachmentPath] of (recorded.attachments ?? []).entries()) {
      const declaredAttachment = await resolveContainedFile(observationsRoot, attachmentPath, `case ${item.id} attachment`);
      const extension = path.extname(attachmentPath).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
      const relativePath = `cases/${item.id}/attachments/${String(index + 1).padStart(2, "0")}${extension}`;
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
    const terminal = guidedTerminalOutcome(recorded.productOutcome, Boolean(output));
    const disposition = scoredDisposition(validation, terminal);
    const result = {
      caseId: item.id,
      category: item.category,
      format: item.format,
      damageClass: item.damageClass,
      eligible: scoringEligible(terminal.disposition),
      observation: {
        disposition: terminal.disposition,
        terminalOutcomeEligible: terminal.terminalOutcomeEligible,
        productOutcome: recorded.productOutcome,
        attemptedAt: recorded.attemptedAt,
        productMessage: recorded.productMessage ?? null,
        operatorNote: recorded.operatorNote ?? null,
        output,
        attachments,
      },
      validation,
      score: terminal.terminalOutcomeEligible ? validation.score : 0,
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
  if (canonicalize(run.summary) !== canonicalize(summarize(run.cases, tool, protocol))) throw new Error("Run summary does not match its case evidence.");
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
    if (!frozenCase || typeof item.eligible !== "boolean" || item.category !== frozenCase.category || item.format !== frozenCase.format || item.damageClass !== frozenCase.damageClass) {
      throw new Error(`Run case metadata does not match the frozen corpus for ${item.caseId}.`);
    }
    const inputEvidence = await hashFile(resolveContained(runRoot, `cases/${item.caseId}/input.bin`, "case input evidence"));
    const groundTruthEvidence = await hashFile(resolveContained(runRoot, `cases/${item.caseId}/ground-truth.bin`, "case ground-truth evidence"));
    if (inputEvidence.byteLength !== frozenCase.input.byteLength || inputEvidence.sha256 !== frozenCase.input.sha256
      || groundTruthEvidence.byteLength !== frozenCase.groundTruth.byteLength || groundTruthEvidence.sha256 !== frozenCase.groundTruth.sha256) {
      throw new Error(`Case input or ground truth does not match the frozen corpus for ${item.caseId}.`);
    }
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
        groundTruthPath: resolveContained(runRoot, `cases/${item.caseId}/ground-truth.bin`, "case ground-truth evidence"),
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
      expectedTerminal = commandTerminalOutcome(tool, item.observation, Boolean(item.observation.output));
    } else {
      const recorded = guidedObservations.cases.find((candidate) => candidate.caseId === item.caseId);
      if (!recorded
        || item.observation.productOutcome !== recorded.productOutcome
        || item.observation.attemptedAt !== recorded.attemptedAt
        || item.observation.productMessage !== (recorded.productMessage ?? null)
        || item.observation.operatorNote !== (recorded.operatorNote ?? null)
        || Boolean(item.observation.output) !== Boolean(recorded.outputPath)) {
        throw new Error(`Guided case record does not match guided-observations.json for ${item.caseId}.`);
      }
      const expectedAttachmentPaths = (recorded.attachments ?? []).map((attachmentPath, index) => {
        const extension = path.extname(attachmentPath).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
        return `cases/${item.caseId}/attachments/${String(index + 1).padStart(2, "0")}${extension}`;
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
      expectedTerminal = guidedTerminalOutcome(recorded.productOutcome, Boolean(item.observation.output));
    }
    if (item.observation.disposition !== expectedTerminal.disposition
      || item.observation.terminalOutcomeEligible !== expectedTerminal.terminalOutcomeEligible) {
      throw new Error(`Terminal outcome semantics are inconsistent for ${item.caseId}.`);
    }
    if (item.eligible !== scoringEligible(expectedTerminal.disposition)) {
      throw new Error(`Scoring eligibility is inconsistent for ${item.caseId}.`);
    }
    const expectedScore = expectedTerminal.terminalOutcomeEligible ? expectedValidation.score : 0;
    if (item.score !== expectedScore) throw new Error(`Recovery score is inconsistent for ${item.caseId}.`);
    const expectedDisposition = scoredDisposition(expectedValidation, expectedTerminal);
    if (item.disposition !== expectedDisposition) throw new Error(`Scored disposition is inconsistent for ${item.caseId}.`);
    const caseRecord = await readJson(resolveContained(runRoot, `cases/${item.caseId}/result.json`, "case result path"));
    if (canonicalize(item) !== canonicalize(caseRecord)) throw new Error(`Run summary record does not match case evidence for ${item.caseId}.`);
  }
  return { ok: true, runId: run.runId, rootDigest: attestation.rootDigest, filesVerified: attestation.files.length };
}

export { makePlan };
