import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../frozen-runtime/benchmark-kit/lib/canonical.mjs";
import {
  validateCorpus,
  validateProtocol,
  validateTool,
} from "../frozen-runtime/benchmark-kit/lib/contracts.mjs";
import {
  hashFile,
  readJson,
  resolveContainedFile,
} from "../frozen-runtime/benchmark-kit/lib/files.mjs";
import { verifyPublication } from "../frozen-runtime/benchmark-kit/lib/publisher.mjs";

const benchmarkRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(benchmarkRoot, "../../..");
const frozenRuntimeRoot = path.join(benchmarkRoot, "frozen-runtime");
const comparisonRoot = path.join(repositoryRoot, "public", "benchmarks", "open-recovery-competitors");

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

const results = await readJson(await resolveContainedFile(benchmarkRoot, "results-v2.json", "results"));
assert(results.schemaVersion === 1, "Results schema version is unsupported.");
assert(results.kind === "competitor-benchmark-results", "Results kind is invalid.");
assert(results.id === "browser-competitor-2026-08-11-v2-results", "Results ID is invalid.");
assert(Array.isArray(results.cohorts) && results.cohorts.length === 3, "Results must contain PDF, JPEG, and PNG cohorts.");

const registrationPath = await resolveContainedFile(benchmarkRoot, results.registration.path, "registration");
const registrationHash = await hashFile(registrationPath);
assert(registrationHash.sha256 === results.registration.sha256, "Frozen registration hash does not match the published results.");
const registration = await readJson(registrationPath);
assert(registration.schemaVersion === 1, "Registration schema version is unsupported.");
assert(registration.kind === "competitor-benchmark-registration", "Registration kind is invalid.");
assert(registration.id === results.registration.id, "Registration ID does not match the published results.");
assert(registration.state === "frozen-pre-execution", "Registration is not frozen pre-execution.");
assert(registration.expectedHarness?.name === "stillopen-open-recovery-benchmark-kit", "Expected harness name is invalid.");
assert(registration.expectedHarness?.version === "1.4.0", "Expected harness version is invalid.");

await readFrozen(registration.protocol, "protocol", validateProtocol);

assert(Array.isArray(registration.runtimeArtifacts) && registration.runtimeArtifacts.length > 0, "Runtime artifacts are not registered.");
for (const descriptor of registration.runtimeArtifacts) {
  assert(typeof descriptor.pathFromRepositoryRoot === "string", "Runtime artifact path is missing.");
  assert(/^[a-f0-9]{64}$/.test(descriptor.sha256), "Runtime artifact SHA-256 is invalid.");
  const absolutePath = await resolveContainedFile(frozenRuntimeRoot, descriptor.pathFromRepositoryRoot, "runtime artifact");
  const actual = await hashFile(absolutePath);
  assert(actual.sha256 === descriptor.sha256, `Frozen runtime artifact ${descriptor.pathFromRepositoryRoot} does not match its registered SHA-256.`);
}

const frozenCohorts = new Map();
for (const cohort of registration.cohorts) {
  const corpus = await readFrozen(cohort.corpus, `${cohort.id} corpus`, validateCorpus);
  assert(corpus.cases.length === cohort.denominator, `${cohort.id} corpus denominator changed.`);
  const frozenProducts = [];
  for (const product of cohort.products) {
    const tool = await readFrozen(product.tool, `${cohort.id}/${product.id} tool`, validateTool);
    frozenProducts.push({ ...product, toolDocument: tool });
  }
  frozenCohorts.set(cohort.id, { ...cohort, products: frozenProducts });
}

const publicSummary = await readJson(await resolveContainedFile(comparisonRoot, "summary.json", "public summary"));
assert(canonicalize(publicSummary) === canonicalize(results), "Public summary does not match results-v2.json.");
const comparisonHtml = await readFile(await resolveContainedFile(comparisonRoot, "index.html", "comparison page"), "utf8");
assert(comparisonHtml.includes(`data-results-id="${results.id}"`), "Comparison page does not identify the published results record.");

let verifiedProducts = 0;
for (const cohort of results.cohorts) {
  const frozenCohort = frozenCohorts.get(cohort.id);
  assert(frozenCohort, `Cohort ${cohort.id} was not preregistered.`);
  assert(cohort.denominator === frozenCohort.denominator, `Cohort ${cohort.id} denominator changed after registration.`);
  assert(cohort.damagedCases === frozenCohort.damagedCases, `Cohort ${cohort.id} damaged-case count changed after registration.`);
  assert(cohort.healthyControls === frozenCohort.healthyControls, `Cohort ${cohort.id} healthy-control count changed after registration.`);
  assert(cohort.products.length === frozenCohort.products.length, `Cohort ${cohort.id} product roster changed after registration.`);

  for (const [index, product] of cohort.products.entries()) {
    const frozenProduct = frozenCohort.products[index];
    assert(product.role === frozenProduct.role, `${cohort.id}/${product.id} role changed after registration.`);

    const publicRelativePath = product.publicationPath.replace(/^\/+|\/+$/gu, "");
    const reportPath = await resolveContainedFile(
      repositoryRoot,
      path.join("public", publicRelativePath, "report.json"),
      `${cohort.id}/${product.id} publication`,
    );
    const publicationDirectory = path.dirname(reportPath);
    const verification = await verifyPublication(publicationDirectory);
    const report = await readJson(reportPath);
    const publicationAttestation = await readJson(path.join(publicationDirectory, "publication-attestation.json"));
    const runAttestation = await readJson(path.join(publicationDirectory, "run", "attestation.json"));

    assert(verification.runId === product.runId, `${cohort.id}/${product.id} run ID does not match.`);
    assert(report.runId === product.runId, `${cohort.id}/${product.id} report run ID does not match.`);
    assert(report.tool.id === frozenProduct.toolDocument.id, `${cohort.id}/${product.id} tool does not match the preregistered definition.`);
    assert(report.summary.eligibleCases === cohort.denominator, `${cohort.id}/${product.id} denominator does not match its run.`);
    assert(report.summary.verifiedPasses === product.verifiedPasses, `${cohort.id}/${product.id} verified-pass score does not match its run.`);
    assert(report.summary.changedOutputs === product.changedOutputs, `${cohort.id}/${product.id} changed-output count does not match its run.`);
    assert(report.summary.errors === product.errors, `${cohort.id}/${product.id} error count does not match its run.`);
    assert(runAttestation.rootDigest === product.runEvidenceRootDigest, `${cohort.id}/${product.id} run evidence digest does not match.`);
    assert(publicationAttestation.rootDigest === product.publicationRootDigest, `${cohort.id}/${product.id} publication digest does not match.`);
    assert(comparisonHtml.includes(`./${product.runId}/index.html`), `${cohort.id}/${product.id} evidence link is missing from the comparison page.`);
    verifiedProducts += 1;
  }
}

assert(verifiedProducts === 8, "The publication must contain exactly eight preregistered product/cohort runs.");

process.stdout.write(`${JSON.stringify({
  ok: true,
  resultsId: results.id,
  registrationSha256: registrationHash.sha256,
  frozenRuntimeArtifactsVerified: registration.runtimeArtifacts.length,
  cohortsVerified: results.cohorts.length,
  productsVerified: verifiedProducts,
}, null, 2)}\n`);
