import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const kitRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.dirname(kitRoot);
const adapter = path.join(kitRoot, "adapters", "stillopen-recovery.mjs");

function runAdapter(input, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [adapter, "--input", input, "--output", output], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({
      exitCode,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

test("benchmark adapter leaves healthy PDF, JPEG, PNG, and ZIP files untouched", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stillopen-healthy-adapter-"));
  const fixtures = [
    ["pdf", "tests/fixtures/damage-lab/pdf/source/three-page-basic.pdf"],
    ["jpeg", "tests/fixtures/damage-lab/jpeg/source/baseline-24x16.jpg"],
    ["png", "tests/fixtures/damage-lab/png/source/rgb-32x16.png"],
    ["zip", "tests/fixtures/damage-lab/zip/source/two-entry.zip"],
  ];

  for (const [format, relativeInput] of fixtures) {
    const input = path.join(root, `${format}.bin`);
    await cp(path.join(repositoryRoot, relativeInput), input);
    const output = path.join(root, `${format}.out`);
    const result = await runAdapter(input, output);
    assert.equal(result.exitCode, 3, `${format}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), {
      outcome: "healthy-no-action",
      status: "healthy",
      format,
      outputByteLength: 0,
    });
    await assert.rejects(stat(output), { code: "ENOENT" });
  }
});
