import { isSupportedValidator } from "./validators.mjs";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const SHA_PATTERN = /^[a-f0-9]{64}$/;

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
}

function id(value, label) {
  text(value, label);
  if (!ID_PATTERN.test(value)) throw new Error(`${label} is not a portable identifier.`);
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
}

function contract(document, kind) {
  object(document, kind);
  if (document.schemaVersion !== 1) throw new Error(`${kind} uses an unsupported schemaVersion.`);
  if (document.kind !== kind) throw new Error(`Expected kind ${kind}.`);
  id(document.id, `${kind}.id`);
}

function inputCondition(item) {
  return item.inputCondition ?? "damaged";
}

export function validateProtocol(protocol) {
  contract(protocol, "benchmark-protocol");
  text(protocol.title, "benchmark-protocol.title");
  text(protocol.publicClaim, "benchmark-protocol.publicClaim");
  text(protocol.frozenAt, "benchmark-protocol.frozenAt");
  object(protocol.scoring, "benchmark-protocol.scoring");
  if (protocol.scoring.denominator !== "all-eligible-cases") throw new Error("Only the all-eligible-cases denominator is supported in schemaVersion 1.");
  if (protocol.scoring.passDisposition !== "verified-pass") throw new Error("The pass disposition must be verified-pass.");
  object(protocol.limits, "benchmark-protocol.limits");
  if (!Number.isInteger(protocol.limits.timeoutMs) || protocol.limits.timeoutMs < 100 || protocol.limits.timeoutMs > 3_600_000) {
    throw new Error("benchmark-protocol.limits.timeoutMs is outside the supported range.");
  }
  if (!Number.isInteger(protocol.limits.maxCapturedBytes) || protocol.limits.maxCapturedBytes < 1024) {
    throw new Error("benchmark-protocol.limits.maxCapturedBytes must be at least 1024.");
  }
}

export function validateCorpus(corpus) {
  contract(corpus, "benchmark-corpus");
  text(corpus.title, "benchmark-corpus.title");
  if (!Array.isArray(corpus.cases) || corpus.cases.length === 0) throw new Error("benchmark-corpus.cases must not be empty.");
  const ids = new Set();
  for (const [index, item] of corpus.cases.entries()) {
    const label = `benchmark-corpus.cases[${index}]`;
    object(item, label);
    id(item.id, `${label}.id`);
    if (ids.has(item.id)) throw new Error(`Duplicate case id ${item.id}.`);
    ids.add(item.id);
    text(item.format, `${label}.format`);
    text(item.damageClass, `${label}.damageClass`);
    if (!["damaged", "healthy-control"].includes(inputCondition(item))) {
      throw new Error(`${label}.inputCondition must be damaged or healthy-control.`);
    }
    object(item.input, `${label}.input`);
    text(item.input.path, `${label}.input.path`);
    digest(item.input.sha256, `${label}.input.sha256`);
    if (!Number.isInteger(item.input.byteLength) || item.input.byteLength < 0) throw new Error(`${label}.input.byteLength is invalid.`);
    object(item.groundTruth, `${label}.groundTruth`);
    if (!isSupportedValidator(item.groundTruth.validator)) throw new Error(`${label} uses an unsupported validator.`);
    text(item.groundTruth.path, `${label}.groundTruth.path`);
    digest(item.groundTruth.sha256, `${label}.groundTruth.sha256`);
    if (!Number.isInteger(item.groundTruth.byteLength) || item.groundTruth.byteLength < 0) throw new Error(`${label}.groundTruth.byteLength is invalid.`);
    object(item.provenance, `${label}.provenance`);
    text(item.provenance.source, `${label}.provenance.source`);
    text(item.provenance.license, `${label}.provenance.license`);
  }
}

export function validateTool(tool) {
  contract(tool, "benchmark-tool");
  text(tool.vendor, "benchmark-tool.vendor");
  text(tool.product, "benchmark-tool.product");
  text(tool.version, "benchmark-tool.version");
  text(tool.platform, "benchmark-tool.platform");
  if (typeof tool.synthetic !== "boolean") throw new Error("benchmark-tool.synthetic must be boolean.");
  object(tool.acquisition, "benchmark-tool.acquisition");
  text(tool.acquisition.source, "benchmark-tool.acquisition.source");
  object(tool.adapter, "benchmark-tool.adapter");
  if (tool.adapter.kind === "command") {
    text(tool.adapter.executable, "benchmark-tool.adapter.executable");
    if (!Array.isArray(tool.adapter.args) || !tool.adapter.args.every((arg) => typeof arg === "string")) {
      throw new Error("benchmark-tool.adapter.args must be an array of strings.");
    }
    text(tool.adapter.outputFile, "benchmark-tool.adapter.outputFile");
    if (tool.adapter.exitCodeDisposition) {
      object(tool.adapter.exitCodeDisposition, "benchmark-tool.adapter.exitCodeDisposition");
      const allowed = new Set(["refusal", "error", "unavailable", "paywalled", "no-output"]);
      for (const [exitCode, disposition] of Object.entries(tool.adapter.exitCodeDisposition)) {
        if (!/^-?\d+$/.test(exitCode) || !allowed.has(disposition)) throw new Error("benchmark-tool.adapter.exitCodeDisposition contains an unsafe mapping.");
      }
    }
    if (tool.adapter.successExitCodes !== undefined
      && (!Array.isArray(tool.adapter.successExitCodes)
        || tool.adapter.successExitCodes.length === 0
        || !tool.adapter.successExitCodes.every(Number.isInteger)
        || new Set(tool.adapter.successExitCodes).size !== tool.adapter.successExitCodes.length)) {
      throw new Error("benchmark-tool.adapter.successExitCodes must contain distinct integer exit codes.");
    }
    if (tool.adapter.healthyNoChangeExitCodes !== undefined
      && (!Array.isArray(tool.adapter.healthyNoChangeExitCodes)
        || tool.adapter.healthyNoChangeExitCodes.length === 0
        || !tool.adapter.healthyNoChangeExitCodes.every(Number.isInteger)
        || new Set(tool.adapter.healthyNoChangeExitCodes).size !== tool.adapter.healthyNoChangeExitCodes.length)) {
      throw new Error("benchmark-tool.adapter.healthyNoChangeExitCodes must contain distinct integer exit codes.");
    }
    const conflictingHealthyCodes = (tool.adapter.healthyNoChangeExitCodes ?? []).filter((exitCode) => {
      return (tool.adapter.successExitCodes ?? [0]).includes(exitCode)
        || tool.adapter.exitCodeDisposition?.[String(exitCode)] !== undefined;
    });
    if (conflictingHealthyCodes.length > 0) {
      throw new Error("benchmark-tool.adapter.healthyNoChangeExitCodes may not overlap success or mapped non-success exit codes.");
    }
  } else if (tool.adapter.kind === "guided") {
    if (!Array.isArray(tool.adapter.instructions) || tool.adapter.instructions.length === 0 || !tool.adapter.instructions.every((step) => typeof step === "string" && step.trim())) {
      throw new Error("benchmark-tool.adapter.instructions must contain operator steps.");
    }
  } else {
    throw new Error("benchmark-tool.adapter.kind must be command or guided.");
  }
}

const GUIDED_OUTCOMES = new Set(["success", "refusal", "error", "timeout", "unavailable", "paywalled", "no-output"]);

function guidedReturnedFiles(item, label) {
  if (item.outputPath !== undefined && item.returnedFiles !== undefined) {
    throw new Error(`${label} may not use outputPath and returnedFiles together.`);
  }
  if (item.outputPath !== undefined) {
    text(item.outputPath, `${label}.outputPath`);
    return [{ path: item.outputPath, recommended: false }];
  }
  if (item.returnedFiles === undefined) return [];
  if (!Array.isArray(item.returnedFiles) || item.returnedFiles.length === 0) {
    throw new Error(`${label}.returnedFiles must contain every returned file in display order.`);
  }
  const paths = new Set();
  let recommendedCount = 0;
  const returnedFiles = item.returnedFiles.map((returnedFile, returnedIndex) => {
    const returnedLabel = `${label}.returnedFiles[${returnedIndex}]`;
    object(returnedFile, returnedLabel);
    text(returnedFile.path, `${returnedLabel}.path`);
    if (paths.has(returnedFile.path)) throw new Error(`${returnedLabel}.path is duplicated.`);
    paths.add(returnedFile.path);
    if (returnedFile.recommended !== undefined && typeof returnedFile.recommended !== "boolean") {
      throw new Error(`${returnedLabel}.recommended must be boolean.`);
    }
    if (returnedFile.recommended) recommendedCount += 1;
    return { path: returnedFile.path, recommended: returnedFile.recommended === true };
  });
  if (recommendedCount > 1) throw new Error(`${label}.returnedFiles may identify at most one product-recommended/default result.`);
  return returnedFiles;
}

export function validateGuidedObservations(observations, corpus, tool) {
  contract(observations, "benchmark-guided-observations");
  if (observations.toolId !== tool.id) throw new Error("Guided observations toolId does not match the frozen tool definition.");
  if (!Array.isArray(observations.cases)) throw new Error("benchmark-guided-observations.cases must be an array.");
  const expectedIds = new Set(corpus.cases.map((item) => item.id));
  const seen = new Set();
  for (const [index, item] of observations.cases.entries()) {
    const label = `benchmark-guided-observations.cases[${index}]`;
    object(item, label);
    id(item.caseId, `${label}.caseId`);
    if (!expectedIds.has(item.caseId)) throw new Error(`${label}.caseId is not in the frozen corpus.`);
    if (seen.has(item.caseId)) throw new Error(`Duplicate guided observation for ${item.caseId}.`);
    seen.add(item.caseId);
    if (!GUIDED_OUTCOMES.has(item.productOutcome)) throw new Error(`${label}.productOutcome is unsupported.`);
    text(item.attemptedAt, `${label}.attemptedAt`);
    if (!Number.isFinite(Date.parse(item.attemptedAt))) throw new Error(`${label}.attemptedAt must be an ISO-compatible timestamp.`);
    const expectedCase = corpus.cases.find((candidate) => candidate.id === item.caseId);
    const returnedFiles = guidedReturnedFiles(item, label);
    if (item.productMessage !== undefined && typeof item.productMessage !== "string") throw new Error(`${label}.productMessage must be a string.`);
    if (item.operatorNote !== undefined && typeof item.operatorNote !== "string") throw new Error(`${label}.operatorNote must be a string.`);
    if (item.productOutcome === "success" && returnedFiles.length === 0 && inputCondition(expectedCase) !== "healthy-control") {
      throw new Error(`${label} reports success without a returned file.`);
    }
    if (item.attachments !== undefined && (!Array.isArray(item.attachments) || !item.attachments.every((value) => typeof value === "string" && value.trim()))) {
      throw new Error(`${label}.attachments must be relative paths.`);
    }
  }
  if (seen.size !== expectedIds.size) throw new Error("Guided observations must contain exactly one terminal observation for every frozen case.");
}
