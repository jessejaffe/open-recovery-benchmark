#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeBenchmark, ingestGuidedBenchmark, verifyRun } from "./lib/runner.mjs";
import { publishRun, verifyPublication } from "./lib/publisher.mjs";
import { prepareGuidedPacket } from "./lib/guided-packet.mjs";

const kitRoot = path.dirname(fileURLToPath(import.meta.url));

function options(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith("--") || values[index + 1] === undefined) throw new Error(`Invalid option ${key ?? "<missing>"}.`);
    result[key.slice(2)] = values[index + 1];
  }
  return result;
}

function required(value, label) {
  if (!value) throw new Error(`Missing --${label}.`);
  return path.resolve(value);
}

async function run() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = options(rest);
  if (command === "verify") {
    const verification = await verifyRun(required(flags.run, "run"));
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    return;
  }
  if (command === "verify-publication") {
    const verification = await verifyPublication(required(flags.publication, "publication"));
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    return;
  }
  if (command === "run") {
    const result = await executeBenchmark({
      protocolPath: required(flags.protocol, "protocol"),
      corpusPath: required(flags.corpus, "corpus"),
      toolPath: required(flags.tool, "tool"),
      workspaceRoot: required(flags.workspace, "workspace"),
      runId: flags["run-id"] ?? "benchmark-run",
    });
    process.stdout.write(`${JSON.stringify({ runRoot: result.runRoot, planDigest: result.run.planDigest, summary: result.run.summary }, null, 2)}\n`);
    return;
  }
  if (command === "ingest-guided") {
    const result = await ingestGuidedBenchmark({
      protocolPath: required(flags.protocol, "protocol"),
      corpusPath: required(flags.corpus, "corpus"),
      toolPath: required(flags.tool, "tool"),
      observationsPath: required(flags.observations, "observations"),
      workspaceRoot: required(flags.workspace, "workspace"),
      runId: flags["run-id"] ?? "guided-benchmark-run",
    });
    process.stdout.write(`${JSON.stringify({ runRoot: result.runRoot, planDigest: result.run.planDigest, summary: result.run.summary }, null, 2)}\n`);
    return;
  }
  if (command === "prepare-guided") {
    const result = await prepareGuidedPacket({
      protocolPath: required(flags.protocol, "protocol"),
      corpusPath: required(flags.corpus, "corpus"),
      toolPath: required(flags.tool, "tool"),
      outputRoot: required(flags.output, "output"),
    });
    process.stdout.write(`${JSON.stringify({ outputRoot: result.outputRoot, packetId: result.packet.id, cases: result.packet.cases.length }, null, 2)}\n`);
    return;
  }
  if (command === "publish") {
    const publication = await publishRun(required(flags.run, "run"), required(flags.output, "output"));
    process.stdout.write(`${JSON.stringify({
      index: publication.index,
      runEvidenceRootDigest: publication.attestation.rootDigest,
      publicationRootDigest: publication.publicationAttestation.rootDigest,
    }, null, 2)}\n`);
    return;
  }
  if (command === "demo") {
    const workspaceRoot = path.resolve(flags.workspace ?? "benchmark-work");
    const runId = flags["run-id"] ?? `synthetic-${Date.now()}`;
    const result = await executeBenchmark({
      protocolPath: path.join(kitRoot, "examples", "synthetic", "protocol.json"),
      corpusPath: path.join(kitRoot, "examples", "synthetic", "corpus.json"),
      toolPath: path.join(kitRoot, "examples", "synthetic", "tools", "synthetic-command.json"),
      workspaceRoot,
      runId,
    });
    const outputRoot = path.resolve(flags.output ?? path.join(workspaceRoot, `${runId}-publication`));
    const publication = await publishRun(result.runRoot, outputRoot);
    process.stdout.write(`${JSON.stringify({
      runRoot: result.runRoot,
      report: publication.index,
      planDigest: result.run.planDigest,
      runEvidenceRootDigest: result.attestation.rootDigest,
      publicationRootDigest: publication.publicationAttestation.rootDigest,
      summary: result.run.summary,
    }, null, 2)}\n`);
    return;
  }
  throw new Error("Usage: benchmark <demo|run|prepare-guided|ingest-guided|verify|verify-publication|publish> [--name value ...]");
}

run().catch((error) => {
  process.stderr.write(`benchmark: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
