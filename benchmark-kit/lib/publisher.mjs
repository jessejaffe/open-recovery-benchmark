import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalize, sha256 } from "./canonical.mjs";
import { hashFile, readJson, resolveContained, writeJson } from "./files.mjs";
import { verifyRun } from "./runner.mjs";

async function publicationInventory(root) {
  const relativePaths = [];
  async function walk(directory, relativeDirectory = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Publication may not contain symbolic links: ${relativePath}.`);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relativePath);
      else if (entry.isFile() && relativePath !== "publication-attestation.json") relativePaths.push(relativePath);
      else if (!entry.isFile()) throw new Error(`Unsupported publication item: ${relativePath}.`);
    }
  }
  await walk(root);
  const files = [];
  for (const relativePath of relativePaths.sort()) {
    files.push({ path: relativePath, ...await hashFile(resolveContained(root, relativePath, "publication path")) });
  }
  return files;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
  })[character]);
}

function caseMarkup(item) {
  const checks = Object.entries(item.validation.checks)
    .map(([name, value]) => `<li><span>${escapeHtml(name)}</span><code>${escapeHtml(value)}</code></li>`)
    .join("");
  const evidence = [
    item.observation.stdout,
    item.observation.stderr,
    item.observation.output?.path,
    ...(item.observation.attachments ?? []).map((attachment) => attachment.path),
  ].filter(Boolean);
  const evidenceMarkup = evidence.length > 0 ? evidence.map((reference) => `<code>${escapeHtml(reference)}</code>`).join(" · ") : "no output or attachment captured";
  return `<details class="case"><summary><span>${escapeHtml(item.caseId)}</span><strong class="${escapeHtml(item.disposition)}">${escapeHtml(item.disposition)}</strong></summary><div class="case-body"><p><b>Category:</b> ${escapeHtml(item.category)} · <b>Scoring eligibility:</b> ${item.eligible ? "scored" : "unscored"} · <b>Recovery score:</b> ${item.eligible ? escapeHtml(item.score) : "not applicable"}</p><p><b>Observed:</b> ${escapeHtml(item.observation.disposition)} · <b>Independent validator:</b> ${escapeHtml(item.validation.validator)}</p><ul>${checks}</ul><p class="evidence">Evidence: ${evidenceMarkup}</p></div></details>`;
}

function renderHtml(run, attestation, plan, protocol) {
  const cases = run.cases.map(caseMarkup).join("\n");
  const limitations = (protocol.exclusionRules ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const qualification = run.summary.competitiveSummaryEligible
    ? "Eligible for the frozen competitive summary"
    : "Protocol excludes this run from competitor performance summaries";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(run.protocol.title)} — verifiable benchmark</title><style>
:root{color-scheme:light;--ink:#162724;--muted:#60706b;--paper:#f4f0e8;--card:#fffdf8;--green:#164f43;--mint:#cfe6dc;--coral:#b94f38;--line:#cfc9bc}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 88% 4%,#cfe6dc 0,transparent 28rem),var(--paper);color:var(--ink);font:16px/1.55 system-ui,sans-serif}main{width:min(980px,calc(100% - 32px));margin:auto;padding:64px 0 90px}.eyebrow{color:var(--green);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{max-width:820px;margin:18px 0 16px;font:700 clamp(42px,7vw,78px)/.96 Georgia,serif;letter-spacing:-.045em}.lede{max-width:760px;color:var(--muted);font-size:19px}.boundary{margin:32px 0;padding:18px 20px;border-left:4px solid #d88a3d;background:#fff8e8}.identity{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:30px 0}.identity article,.digest{padding:20px;border:1px solid var(--line);border-radius:12px;background:rgba(255,253,248,.8)}.identity h2{margin:0 0 12px;font-size:18px}.identity p{margin:7px 0;color:var(--muted)}.qualification{color:var(--green)!important;font-weight:750}.digest{display:grid;grid-template-columns:1fr;gap:10px;margin:32px 0}code{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:30px 0}.stat{padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--card)}.stat strong{display:block;font-size:30px}.stat span{color:var(--muted);font-size:12px}.limitations{margin:30px 0;padding:20px 24px;border:1px solid var(--line);border-radius:12px;background:var(--card)}.case{margin:12px 0;border:1px solid var(--line);border-radius:12px;background:var(--card);overflow:hidden}.case summary{display:flex;justify-content:space-between;gap:16px;padding:18px 20px;cursor:pointer;font-weight:700}.case summary strong{font-size:12px;text-transform:uppercase}.verified-pass{color:var(--green)}.verified-partial{color:#a66a18}.changed-output,.refusal{color:var(--coral)}.case-body{padding:0 20px 20px;border-top:1px solid var(--line)}.case-body ul{padding:0;list-style:none}.case-body li{display:flex;justify-content:space-between;gap:20px;padding:7px 0;border-bottom:1px solid #ebe6dc}.evidence{color:var(--muted)}footer{margin-top:36px;color:var(--muted)}@media(max-width:700px){.identity,.stats{grid-template-columns:1fr}.case summary{align-items:flex-start;flex-direction:column}}
</style></head><body><main><p class="eyebrow">Open recovery benchmark · independently verified</p><h1>${escapeHtml(run.protocol.title)}</h1><p class="lede">${escapeHtml(run.protocol.publicClaim)}</p><div class="boundary"><strong>Claim boundary</strong><br>${escapeHtml(run.claimBoundary)}</div><section class="identity"><article><h2>Tool under test</h2><p><b>${escapeHtml(run.tool.vendor)} · ${escapeHtml(run.tool.product)}</b></p><p>Version ${escapeHtml(run.tool.version)} · ${escapeHtml(run.tool.platform)}</p><p class="qualification">${escapeHtml(qualification)}</p></article><article><h2>Frozen corpus</h2><p><b>${escapeHtml(run.corpus.title)}</b></p><p>ID <code>${escapeHtml(run.corpus.id)}</code></p><p>Digest <code>${escapeHtml(run.corpus.digest)}</code></p></article><article><h2>Frozen protocol</h2><p>ID <code>${escapeHtml(run.protocol.id)}</code> · frozen ${escapeHtml(protocol.frozenAt)}</p><p>Digest <code>${escapeHtml(run.protocol.digest)}</code></p><p>Score: ${escapeHtml(plan.scoring.scoreRange)} over ${escapeHtml(plan.scoring.denominator)}</p></article><article><h2>Execution limits</h2><p>${escapeHtml(plan.limits.timeoutMs)} ms per case timeout</p><p>${escapeHtml(plan.limits.maxCapturedBytes)} bytes maximum captured stdout/stderr</p><p>Harness ${escapeHtml(plan.harness.name)} ${escapeHtml(plan.harness.version)}</p></article></section><section class="digest"><div><b>Frozen plan</b><br><code>${escapeHtml(run.planDigest)}</code></div><div><b>Evidence root</b><br><code>${escapeHtml(attestation.rootDigest)}</code></div><div><b>Signature</b> ${escapeHtml(attestation.signatureStatus)}</div></section><section class="stats"><div class="stat"><strong>${run.summary.declaredCases}</strong><span>declared cases</span></div><div class="stat"><strong>${run.summary.eligibleCases}</strong><span>scored cases</span></div><div class="stat"><strong>${run.summary.unscoredCases}</strong><span>unscored coverage or access cases</span></div><div class="stat"><strong>${run.summary.verifiedPasses}</strong><span>verified full recoveries</span></div><div class="stat"><strong>${run.summary.verifiedPartials}</strong><span>verified partial recoveries</span></div><div class="stat"><strong>${escapeHtml(run.summary.meanRecoveryScore)}</strong><span>mean recovery score (0–1)</span></div><div class="stat"><strong>${run.summary.refusals}</strong><span>refusals</span></div><div class="stat"><strong>${run.summary.unavailable}</strong><span>unavailable or paywalled</span></div><div class="stat"><strong>${run.summary.errors}</strong><span>errors, timeouts, or no output</span></div></section><section class="limitations"><h2>Claim limitations</h2><p>${escapeHtml(run.claimBoundary)}</p><ul>${limitations}</ul></section><h2>Case evidence</h2>${cases}<footer>Verify the complete publication locally: <code>node benchmark-kit/cli.mjs verify-publication --publication .</code>. Product observations never determine a score; the benchmark-owned validator does.</footer></main></body></html>`;
}

export async function publishRun(runRoot, outputRoot) {
  await verifyRun(runRoot);
  const run = await readJson(path.join(runRoot, "run.json"));
  const attestation = await readJson(path.join(runRoot, "attestation.json"));
  const plan = await readJson(path.join(runRoot, "plan.json"));
  const protocol = await readJson(path.join(runRoot, "protocol.json"));
  await mkdir(path.dirname(path.resolve(outputRoot)), { recursive: true });
  await mkdir(outputRoot, { recursive: false });
  await cp(runRoot, path.join(outputRoot, "run"), { recursive: true, errorOnExist: true, force: false });
  await writeFile(path.join(outputRoot, "index.html"), renderHtml(run, attestation, plan, protocol), { flag: "wx" });
  await writeFile(path.join(outputRoot, "report.json"), await readFile(path.join(runRoot, "run.json")), { flag: "wx" });
  const files = await publicationInventory(outputRoot);
  const publicationAttestation = {
    schemaVersion: 1,
    kind: "benchmark-publication-attestation",
    runId: run.runId,
    algorithm: "sha256",
    files,
    rootDigest: sha256(canonicalize(files)),
  };
  await writeJson(path.join(outputRoot, "publication-attestation.json"), publicationAttestation);
  return { index: path.join(outputRoot, "index.html"), run, attestation, publicationAttestation };
}

export async function verifyPublication(outputRoot) {
  const attestation = await readJson(path.join(outputRoot, "publication-attestation.json"));
  if (attestation.schemaVersion !== 1 || attestation.kind !== "benchmark-publication-attestation") {
    throw new Error("Unsupported publication attestation contract.");
  }
  const expectedRoot = sha256(canonicalize(attestation.files));
  if (expectedRoot !== attestation.rootDigest) throw new Error("Publication root digest does not match its inventory.");
  const actualFiles = await publicationInventory(outputRoot);
  if (canonicalize(actualFiles) !== canonicalize(attestation.files)) throw new Error("Publication verification failed: a published file is missing, changed, or unexpected.");
  const report = await readJson(path.join(outputRoot, "report.json"));
  const nestedRun = await readJson(path.join(outputRoot, "run", "run.json"));
  if (canonicalize(report) !== canonicalize(nestedRun)) throw new Error("Published report JSON does not match the attested run record.");
  const nested = await verifyRun(path.join(outputRoot, "run"));
  return { ok: true, runId: nested.runId, rootDigest: attestation.rootDigest, filesVerified: attestation.files.length };
}
