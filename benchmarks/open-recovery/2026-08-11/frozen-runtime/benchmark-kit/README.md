# Open recovery benchmark kit

This filesystem-only sister application runs frozen recovery cases through an
explicitly configured tool, captures raw evidence, validates outputs independently,
and emits a hash-verifiable static report. It does not change or call the StillOpen
web application, and it does not require a database.

Run plans identify their benchmark harness contract version and bind the exact
protocol, corpus, tool, environment, case order, and limits into one digest. The
verifier reconstructs that plan and checks every per-case record before accepting
the evidence inventory. The released synthetic demonstration remains version
`1.0.0`.

New runs use harness `1.4.0`, which retains `raster-rgba-v1`,
`pdf-render-text-v1`, and guided returned-file classification while allowing a
command tool to declare documented nonzero success exit codes and explicit
healthy-control no-change exit codes. The verifier retains `1.0.0`, `1.1.0`,
`1.2.0`, and `1.3.0` support for released bundles. Raster scoring
compares decoded dimensions and every RGBA pixel. PDF scoring strictly reopens
both files and compares page count, page dimensions, rendered RGBA pixels, and
extracted text fingerprints.

## Synthetic proof run

```sh
npm run benchmark:demo -- --workspace benchmark-work --run-id local-proof
node benchmark-kit/cli.mjs verify --run benchmark-work/local-proof
```

The committed example is deliberately synthetic. Its exact-output, changed-output,
and refusal cases prove harness behavior; they are not competitor results and are
ineligible for a competitive summary.

## Run a command-line tool

Create version 1 protocol, corpus, and tool records using the schemas in `schemas/`,
then run:

```sh
node benchmark-kit/cli.mjs run \
  --protocol path/to/protocol.json \
  --corpus path/to/corpus.json \
  --tool path/to/tool.json \
  --workspace benchmark-work \
  --run-id vendor-product-version-run-1
```

Command arguments use `{node}`, `{caseId}`, `{input}`, and `{output}` placeholders.
The executable is launched directly with `shell: false`, a minimal environment,
bounded output capture, and the protocol timeout. The harness never downloads or
installs vendor software.

When a command-line product documents a nonzero warning exit that still means it
successfully wrote an output, list it in `adapter.successExitCodes`. For example,
qpdf uses exit code 3 for warnings while still producing a repaired PDF. Unlisted
exit codes remain non-passing terminal errors even when a file exists.

For a tool that explicitly reports an already-healthy input without returning a
copy, declare that documented code with `adapter.healthyNoChangeExitCodes`. It is
eligible only for a corpus case marked `healthy-control`; the harness validates
the unchanged captured input against its frozen ground truth.

## Capture a desktop or web product

For software that needs an operator, use a `guided` tool definition containing
the exact product identity, version, acquisition source, platform, and frozen
steps. Prepare a blinded operator packet that copies and rechecks the inputs but
deliberately omits ground truth:

```sh
node benchmark-kit/cli.mjs prepare-guided \
  --protocol path/to/protocol.json \
  --corpus path/to/corpus.json \
  --tool path/to/guided-tool.json \
  --output benchmark-work/operator-packet
```

Complete the packet's observation template, record one terminal outcome for every
corpus case, and place downloaded outputs or supporting attachments beside that
record. Then ingest and independently score the capture:

```sh
node benchmark-kit/cli.mjs ingest-guided \
  --protocol path/to/protocol.json \
  --corpus path/to/corpus.json \
  --tool path/to/guided-tool.json \
  --observations path/to/observations.json \
  --workspace benchmark-work \
  --run-id vendor-product-version-guided-1
```

The operator's `success` message remains an observation. It becomes a
`verified-pass` only when the benchmark-owned validator matches the frozen ground
truth. Refusals, timeouts, maintenance, paywalls, errors, and missing outputs stay
separate and visible. Observation paths must be relative and are copied into the
content-addressed evidence bundle. Remove secrets and personal paths from free-text
notes and attachments before ingestion; the harness does not capture environment
variable values.

For a product that returns more than one file, record every returned file in
display order with `returnedFiles`; set `recommended: true` only for the one result
that the product marks as its recommended or default choice. Do not combine this
with the older single-file `outputPath` shorthand.

```json
{
  "returnedFiles": [
    { "path": "downloads/uploaded-original.jpg" },
    { "path": "downloads/repaired.jpg", "recommended": true }
  ]
}
```

For damaged cases, the harness byte-compares every returned file with the captured
input, records byte-identical files as `original-returned`, and scores the sole
changed file. With multiple changed files, it selects the product-recommended
result or, if there is none, the first displayed changed result. Every returned
file is retained with its comparison and classification in the evidence bundle.
Mark a clean control case in the frozen corpus with
`"inputCondition": "healthy-control"`; an identical returned copy (or an explicit
successful no-change outcome) is then the desired output rather than an excluded
returned original.

For both adapter modes, an exact output is necessary but not sufficient (except a
healthy-control no-change outcome, which is checked against its unchanged input).
The run must also end in an eligible output-producing terminal state. Exact content
left behind by a timeout, non-success exit, refusal, error, paywall, or unavailable
state is preserved as that outcome and cannot become `verified-pass`.

Publish only after reviewing product identity, acquisition evidence, licensing,
case eligibility, and the claim boundary:

```sh
node benchmark-kit/cli.mjs publish \
  --run benchmark-work/vendor-product-version-run-1 \
  --output benchmark-work/publication
```

Anyone with the bundle can recalculate every evidence hash using `verify`. An
unsigned bundle is labeled unsigned; integrity verification is not identity
authentication.

Verify the complete publication—including its rendered HTML, public JSON, and
nested run evidence—with:

```sh
node benchmark-kit/cli.mjs verify-publication --publication benchmark-work/publication
```

## External-source StillOpen holdout

The first non-synthetic publication reruns the released StillOpen WebAssembly
core on the 18-case external-source holdout. Reproduce and verify its corpus and
bundle using the instructions in
`benchmarks/open-recovery/2026-08-10/README.md`. The committed public artifact is
`public/benchmarks/open-recovery-holdout/`; `npm run benchmark:holdout:verify`
recalculates all nested evidence hashes and reruns every independent validator.
