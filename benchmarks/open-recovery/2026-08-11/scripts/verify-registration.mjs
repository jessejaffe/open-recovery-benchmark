import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCorpus, validateProtocol, validateTool } from "../../../../benchmark-kit/lib/contracts.mjs";
import { hashFile, readJson, resolveContainedFile } from "../../../../benchmark-kit/lib/files.mjs";

const benchmarkRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(benchmarkRoot, "../../..");
const registrationFilename = process.argv[2] ?? "registration.json";
const registrationPath = await resolveContainedFile(benchmarkRoot, registrationFilename, "registration");
const registration = await readJson(registrationPath);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readFrozen(descriptor, label, validator) {
  assert(descriptor && typeof descriptor.path === "string", `${label} path is missing.`);
  assert(/^[a-f0-9]{64}$/.test(descriptor.sha256), `${label} SHA-256 is invalid.`);
  const absolutePath = await resolveContainedFile(benchmarkRoot, descriptor.path, label);
  const actual = await hashFile(absolutePath);
  assert(actual.sha256 === descriptor.sha256, `${label} no longer matches the frozen SHA-256.`);
  const document = await readJson(absolutePath);
  validator(document);
  return document;
}

assert(registration.schemaVersion === 1, "Registration schemaVersion is unsupported.");
assert(registration.kind === "competitor-benchmark-registration", "Registration kind is invalid.");
assert(registration.state === "frozen-pre-execution", "Registration is not frozen pre-execution.");
assert(Number.isFinite(Date.parse(registration.frozenAt)), "Registration frozenAt is invalid.");
if (registration.expectedHarness !== undefined) {
  assert(registration.expectedHarness.name === "stillopen-open-recovery-benchmark-kit", "Expected harness name is invalid.");
  assert(registration.expectedHarness.version === "1.4.0", "Expected harness version is invalid.");
}
assert(Array.isArray(registration.cohorts) && registration.cohorts.length === 3, "Exactly three format cohorts are required.");

await readFrozen(registration.protocol, "protocol", validateProtocol);

assert(Array.isArray(registration.runtimeArtifacts) && registration.runtimeArtifacts.length > 0, "Runtime artifacts are not registered.");
for (const descriptor of registration.runtimeArtifacts) {
  assert(typeof descriptor.pathFromRepositoryRoot === "string", "Runtime artifact path is missing.");
  assert(/^[a-f0-9]{64}$/.test(descriptor.sha256), "Runtime artifact SHA-256 is invalid.");
  const absolutePath = await resolveContainedFile(repositoryRoot, descriptor.pathFromRepositoryRoot, "runtime artifact");
  const actual = await hashFile(absolutePath);
  assert(actual.sha256 === descriptor.sha256, `Runtime artifact ${descriptor.pathFromRepositoryRoot} no longer matches the frozen SHA-256.`);
}

const expectedFormats = new Set(["pdf", "jpeg", "png"]);
for (const cohort of registration.cohorts) {
  assert(expectedFormats.delete(cohort.id), `Unexpected or duplicate cohort ${cohort.id}.`);
  assert(Array.isArray(cohort.formats) && cohort.formats.length === 1 && cohort.formats[0] === cohort.id, `${cohort.id} must be a single-format cohort.`);
  assert(cohort.denominator === 9 && cohort.damagedCases === 6 && cohort.healthyControls === 3, `${cohort.id} must freeze six damaged cases and three healthy controls.`);
  const corpus = await readFrozen(cohort.corpus, `${cohort.id} corpus`, validateCorpus);
  assert(corpus.cases.length === cohort.denominator, `${cohort.id} corpus denominator changed.`);
  assert(corpus.cases.every((item) => item.format === cohort.id), `${cohort.id} corpus contains another format.`);
  assert(corpus.cases.filter((item) => item.inputCondition === "healthy-control").length === cohort.healthyControls, `${cohort.id} healthy-control count changed.`);
  assert(corpus.cases.filter((item) => item.inputCondition !== "healthy-control").length === cohort.damagedCases, `${cohort.id} damaged-case count changed.`);
  assert(Array.isArray(cohort.products) && cohort.products.length >= 2, `${cohort.id} product roster is incomplete.`);
  const toolIds = new Set();
  for (const product of cohort.products) {
    assert(["control", "consumer-browser-competitor"].includes(product.role), `${cohort.id} has an invalid product role.`);
    const tool = await readFrozen(product.tool, `${cohort.id} tool`, validateTool);
    assert(!toolIds.has(tool.id), `${cohort.id} contains duplicate tool ${tool.id}.`);
    toolIds.add(tool.id);
  }
}

assert(expectedFormats.size === 0, "PDF, JPEG, and PNG must all be registered.");
assert(registration.reportingRules.some((rule) => rule.includes("Do not calculate an overall repair percentage")), "Cross-format aggregation prohibition is missing.");

process.stdout.write(`Verified frozen pre-execution registration ${registration.id}: PDF 4 products × 9 cases; JPEG 2 × 9; PNG 2 × 9.\n`);
