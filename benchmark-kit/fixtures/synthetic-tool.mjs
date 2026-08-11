import { readFile, writeFile } from "node:fs/promises";

const flags = Object.fromEntries(Array.from({ length: Math.floor(process.argv.slice(2).length / 2) }, (_, index) => {
  const offset = index * 2 + 2;
  return [process.argv[offset]?.replace(/^--/, ""), process.argv[offset + 1]];
}));

if (!flags.mode || !flags.input || !flags.output) throw new Error("mode, input, and output are required.");
if (flags.mode === "healthy-output") {
  await writeFile(flags.output, await readFile(flags.input), { flag: "wx" });
  process.stdout.write("Fixture product incorrectly reports no action after creating an output.\n");
  process.exitCode = 3;
} else if (flags.mode === "healthy-case") {
  process.stdout.write("Fixture product reports that the healthy input needs no action.\n");
  process.exitCode = 3;
} else if (flags.mode === "refusal-case") {
  process.stderr.write("Fixture product refused the input and produced no output.\n");
  process.exitCode = 2;
} else {
  const input = await readFile(flags.input, "utf8");
  const recovered = input.replace(/DAMAGE:truncated-directory\n$/, "");
  if (flags.mode === "mutate-input") await writeFile(flags.input, `${input}MUTATED\n`);
  const output = flags.mode === "changed-case" ? recovered.replace("bravo", "BRAVO") : recovered;
  await writeFile(flags.output, output, { flag: "wx" });
  process.stdout.write("Fixture product reports recovery success. Independent validation is still required.\n");
  if (flags.mode === "exact-timeout") await new Promise((resolve) => setTimeout(resolve, 60_000));
  if (flags.mode === "exact-nonzero") process.exitCode = 2;
}
