import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCorpus } from "../../../../benchmark-kit/lib/contracts.mjs";
import { hashFile, readJson, resolveContainedFile } from "../../../../benchmark-kit/lib/files.mjs";

const targetRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const baseRoot = path.resolve(targetRoot, "../2026-08-10");
const baseCorpus = await readJson(path.join(baseRoot, "corpus.json"));
validateCorpus(baseCorpus);

async function copyDeclared(descriptor, label) {
  const source = await resolveContainedFile(baseRoot, descriptor.path, label);
  const actual = await hashFile(source);
  if (actual.byteLength !== descriptor.byteLength || actual.sha256 !== descriptor.sha256) {
    throw new Error(`${label} no longer matches the frozen descriptor.`);
  }
  const target = path.join(targetRoot, ...descriptor.path.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { force: true });
}

for (const item of baseCorpus.cases) {
  await copyDeclared(item.input, `case ${item.id} input`);
  await copyDeclared(item.groundTruth, `case ${item.id} ground truth`);
}

const formats = ["pdf", "jpeg", "png"];
const cohorts = {};
for (const format of formats) {
  const damaged = baseCorpus.cases.filter((item) => item.format === format);
  const controlsByPath = new Map();
  for (const item of damaged) {
    if (!controlsByPath.has(item.groundTruth.path)) {
      const stem = path.basename(item.groundTruth.path, path.extname(item.groundTruth.path));
      controlsByPath.set(item.groundTruth.path, {
        id: `healthy-${stem}`,
        format,
        damageClass: "none",
        inputCondition: "healthy-control",
        input: { ...item.groundTruth },
        groundTruth: { ...item.groundTruth },
        provenance: { ...item.provenance },
      });
    }
  }
  cohorts[format] = [...damaged, ...controlsByPath.values()];
}

function corpus(id, title, cases) {
  return {
    $schema: "../../../benchmark-kit/schemas/corpus.schema.json",
    schemaVersion: 1,
    kind: "benchmark-corpus",
    id,
    title,
    cases,
  };
}

const documents = {
  "corpus-pdf.json": corpus("external-source-pdf-competitor-2026-08-11-v1", "Nine-case PDF direct-repair cohort with healthy controls", cohorts.pdf),
  "corpus-jpeg.json": corpus("external-source-jpeg-competitor-2026-08-11-v1", "Nine-case JPEG direct-repair cohort with healthy controls", cohorts.jpeg),
  "corpus-png.json": corpus("external-source-png-competitor-2026-08-11-v1", "Nine-case PNG direct-repair cohort with healthy controls", cohorts.png),
  "corpus-raster.json": corpus("external-source-raster-competitor-2026-08-11-v1", "Eighteen-case JPEG and PNG direct-repair cohort with healthy controls", [...cohorts.jpeg, ...cohorts.png]),
  "corpus-all.json": corpus("external-source-all-format-competitor-2026-08-11-v1", "Twenty-seven-case PDF, JPEG, and PNG direct-repair cohort with healthy controls", [...cohorts.pdf, ...cohorts.jpeg, ...cohorts.png]),
};

for (const [filename, document] of Object.entries(documents)) {
  validateCorpus(document);
  await writeFile(path.join(targetRoot, filename), `${JSON.stringify(document, null, 2)}\n`);
}

process.stdout.write(`Materialized ${Object.keys(documents).length} competitor corpora with ${documents["corpus-all.json"].cases.length} total cases.\n`);
