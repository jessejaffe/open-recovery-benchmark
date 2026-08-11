import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

export async function hashFile(file) {
  const handle = await open(file, "r");
  try {
    const hash = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk);
      byteLength += chunk.byteLength;
    }
    return { byteLength, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

export function resolveContained(root, relativePath, label = "path") {
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its declared root.`);
  }
  return resolved;
}

export async function assertRegularFile(file, label) {
  const linkDetails = await lstat(file);
  if (linkDetails.isSymbolicLink()) throw new Error(`${label} may not be a symbolic link.`);
  const details = await stat(file);
  if (!details.isFile()) throw new Error(`${label} must resolve to a regular file.`);
}

export async function resolveContainedFile(root, relativePath, label) {
  const file = resolveContained(root, relativePath, label);
  await assertRegularFile(file, label);
  const [physicalRoot, physicalFile] = await Promise.all([realpath(root), realpath(file)]);
  if (physicalFile === physicalRoot || !physicalFile.startsWith(`${physicalRoot}${path.sep}`)) {
    throw new Error(`${label} resolves outside its declared root through a symbolic link.`);
  }
  return file;
}
