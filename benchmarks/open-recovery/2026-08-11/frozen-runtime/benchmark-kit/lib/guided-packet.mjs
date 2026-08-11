import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { digestDocument } from "./canonical.mjs";
import { hashFile, readJson, resolveContainedFile, writeJson } from "./files.mjs";
import { validateCorpus, validateProtocol, validateTool } from "./contracts.mjs";

function inputCondition(item) {
  return item.inputCondition ?? "damaged";
}

function portableObservationId(toolId) {
  return `${toolId.slice(0, 60).replace(/[._-]+$/u, "")}-observations`;
}

async function declaredInput(corpusRoot, item) {
  const input = await resolveContainedFile(corpusRoot, item.input.path, `case ${item.id} input`);
  const actual = await hashFile(input);
  if (actual.byteLength !== item.input.byteLength || actual.sha256 !== item.input.sha256) {
    throw new Error(`case ${item.id} input no longer matches its frozen byte length and SHA-256.`);
  }
  return input;
}

function packetReadme(tool) {
  return `# ${tool.vendor} ${tool.product} guided capture packet

This packet contains only frozen benchmark inputs. Ground-truth files are
deliberately omitted so the operator cannot use them as repair samples or inspect
them during capture.

## Capture

1. Confirm the product identity and version match \`${tool.id}\`.
2. Follow every instruction in \`packet.json\` in order.
3. For each case, save every returned file in display order under that case's
   \`results/\` directory. Never overwrite the packet input.
4. Copy \`observations.template.json\` to \`observations.json\`, replace every
   placeholder, and record one terminal outcome for every case.
5. Ingest the completed record with the repository-owned protocol, corpus, and
   tool definition. The independent validator—not the product message—assigns a
   pass.

Do not add credentials, personal email addresses, license keys, or other secrets
to notes or attachments.
`;
}

export async function prepareGuidedPacket({ protocolPath, corpusPath, toolPath, outputRoot, preparedAt = new Date().toISOString() }) {
  const [protocol, corpus, tool] = await Promise.all([
    readJson(protocolPath),
    readJson(corpusPath),
    readJson(toolPath),
  ]);
  validateProtocol(protocol);
  validateCorpus(corpus);
  validateTool(tool);
  if (tool.adapter.kind !== "guided") throw new Error("prepareGuidedPacket requires a guided adapter.");
  if (!Number.isFinite(Date.parse(preparedAt))) throw new Error("preparedAt must be an ISO-compatible timestamp.");

  const resolvedOutputRoot = path.resolve(outputRoot);
  const corpusRoot = path.dirname(path.resolve(corpusPath));
  const declaredCases = [];
  for (const item of corpus.cases) {
    declaredCases.push({ item, source: await declaredInput(corpusRoot, item) });
  }
  await mkdir(path.dirname(resolvedOutputRoot), { recursive: true });
  await mkdir(resolvedOutputRoot, { recursive: false });
  const cases = [];

  for (const { item, source } of declaredCases) {
    const extension = path.extname(item.input.path).toLowerCase().replace(/[^a-z0-9.]/gu, "").slice(0, 12);
    const inputPath = `cases/${item.id}/input${extension}`;
    const inputTarget = path.join(resolvedOutputRoot, ...inputPath.split("/"));
    await mkdir(path.dirname(inputTarget), { recursive: true });
    await cp(source, inputTarget, { errorOnExist: true, force: false });
    await mkdir(path.join(resolvedOutputRoot, "cases", item.id, "results"));
    cases.push({
      caseId: item.id,
      format: item.format,
      damageClass: item.damageClass,
      inputCondition: inputCondition(item),
      inputPath,
      resultsDirectory: `cases/${item.id}/results`,
      input: { ...await hashFile(inputTarget) },
    });
  }

  const packet = {
    schemaVersion: 1,
    kind: "benchmark-guided-packet",
    id: `${tool.id.slice(0, 66).replace(/[._-]+$/u, "")}-packet`,
    preparedAt,
    protocol: { id: protocol.id, digest: digestDocument(protocol) },
    corpus: { id: corpus.id, digest: digestDocument(corpus) },
    tool: { id: tool.id, digest: digestDocument(tool), vendor: tool.vendor, product: tool.product, version: tool.version, platform: tool.platform },
    instructions: tool.adapter.instructions,
    cases,
    groundTruthIncluded: false,
  };
  const observations = {
    $schema: "https://stillopen.org/benchmark-kit/schemas/guided-observations.schema.json",
    schemaVersion: 1,
    kind: "benchmark-guided-observations",
    id: portableObservationId(tool.id),
    toolId: tool.id,
    cases: cases.map((item) => ({
      caseId: item.caseId,
      productOutcome: "REPLACE_WITH_success_refusal_error_timeout_unavailable_paywalled_or_no-output",
      attemptedAt: "REPLACE_WITH_ISO_8601_TIMESTAMP",
      operatorNote: `Save every returned file under ${item.resultsDirectory} and list it with returnedFiles.`,
    })),
  };

  await writeJson(path.join(resolvedOutputRoot, "protocol.json"), protocol);
  await writeJson(path.join(resolvedOutputRoot, "tool.json"), tool);
  await writeJson(path.join(resolvedOutputRoot, "packet.json"), packet);
  await writeJson(path.join(resolvedOutputRoot, "observations.template.json"), observations);
  await writeFile(path.join(resolvedOutputRoot, "README.md"), packetReadme(tool), { flag: "wx" });
  return { outputRoot: resolvedOutputRoot, packet };
}
