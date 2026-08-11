import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../../../../benchmark-kit/lib/canonical.mjs";
import { verifyPublication } from "../../../../benchmark-kit/lib/publisher.mjs";
import { hashFile, readJson, resolveContainedFile } from "../../../../benchmark-kit/lib/files.mjs";

const benchmarkRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(benchmarkRoot, "../../..");
const resultsPath = await resolveContainedFile(benchmarkRoot, "results-v2.json", "results");
const results = await readJson(resultsPath);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(results.schemaVersion === 1, "Results schema version is unsupported.");
assert(results.kind === "competitor-benchmark-results", "Results kind is invalid.");
assert(results.id === "browser-competitor-2026-08-11-v2-results", "Results ID is invalid.");
assert(Array.isArray(results.cohorts) && results.cohorts.length === 3, "Results must contain PDF, JPEG, and PNG cohorts.");

const registrationPath = await resolveContainedFile(benchmarkRoot, results.registration.path, "registration");
const registrationHash = await hashFile(registrationPath);
assert(registrationHash.sha256 === results.registration.sha256, "Frozen registration hash does not match the published results.");
const registration = await readJson(registrationPath);
assert(registration.id === results.registration.id, "Frozen registration ID does not match the published results.");

const comparisonRoot = path.join(repositoryRoot, "public", "benchmarks", "open-recovery-competitors");
const publicSummary = await readJson(await resolveContainedFile(comparisonRoot, "summary.json", "public summary"));
assert(canonicalize(publicSummary) === canonicalize(results), "Public summary does not match results-v2.json.");
const comparisonHtml = await readFile(await resolveContainedFile(comparisonRoot, "index.html", "comparison page"), "utf8");
assert(comparisonHtml.includes(`data-results-id="${results.id}"`), "Comparison page does not identify the published results record.");

let verifiedProducts = 0;
for (const cohort of results.cohorts) {
  const frozenCohort = registration.cohorts.find((candidate) => candidate.id === cohort.id);
  assert(frozenCohort, `Cohort ${cohort.id} was not preregistered.`);
  assert(cohort.denominator === frozenCohort.denominator, `Cohort ${cohort.id} denominator changed after registration.`);
  assert(cohort.damagedCases === frozenCohort.damagedCases, `Cohort ${cohort.id} damaged-case count changed after registration.`);
  assert(cohort.healthyControls === frozenCohort.healthyControls, `Cohort ${cohort.id} healthy-control count changed after registration.`);
  assert(cohort.products.length === frozenCohort.products.length, `Cohort ${cohort.id} product roster changed after registration.`);

  for (const [index, product] of cohort.products.entries()) {
    const frozenProduct = frozenCohort.products[index];
    assert(product.role === frozenProduct.role, `${cohort.id}/${product.id} role changed after registration.`);
    const frozenToolPath = await resolveContainedFile(benchmarkRoot, frozenProduct.tool.path, `${cohort.id}/${product.id} tool`);
    const frozenToolHash = await hashFile(frozenToolPath);
    assert(frozenToolHash.sha256 === frozenProduct.tool.sha256, `${cohort.id}/${product.id} frozen tool hash is invalid.`);
    const frozenTool = await readJson(frozenToolPath);

    const publicRelativePath = product.publicationPath.replace(/^\/+|\/+$/gu, "");
    const publicationRoot = await resolveContainedFile(repositoryRoot, path.join("public", publicRelativePath, "report.json"), `${cohort.id}/${product.id} publication`);
    const publicationDirectory = path.dirname(publicationRoot);
    const verification = await verifyPublication(publicationDirectory);
    const report = await readJson(path.join(publicationDirectory, "report.json"));
    const publicationAttestation = await readJson(path.join(publicationDirectory, "publication-attestation.json"));
    const runAttestation = await readJson(path.join(publicationDirectory, "run", "attestation.json"));

    assert(verification.runId === product.runId, `${cohort.id}/${product.id} run ID does not match.`);
    assert(report.runId === product.runId, `${cohort.id}/${product.id} report run ID does not match.`);
    assert(report.tool.id === frozenTool.id, `${cohort.id}/${product.id} tool does not match the preregistered definition.`);
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

process.stdout.write(`${JSON.stringify({
  ok: true,
  resultsId: results.id,
  registrationSha256: registrationHash.sha256,
  cohortsVerified: results.cohorts.length,
  productsVerified: verifiedProducts,
}, null, 2)}\n`);
