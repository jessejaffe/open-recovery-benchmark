# Benchmark kit

The benchmark kit freezes a protocol, corpus, tool definition, environment,
case order, execution limits, and scoring policy into a deterministic plan.
It captures every terminal product outcome and stores inputs, outputs, logs,
guided attachments, validation records, and publication files in a hashed
evidence inventory.

Every corpus case belongs to exactly one of three categories:

- `damaged-full-restoration`: the complete healthy content is expected.
- `damaged-partial-restoration`: incomplete output is useful, but the recovered
  amount must be measured against frozen ground truth.
- `healthy-control`: unnecessary changes are visible and reduce the score.

Product messages never decide the score. A benchmark-owned validator compares
the captured output with frozen ground truth and reports a deterministic value
from 0 to 1 plus its numerator, denominator, and unit. Exact-byte validation is
all-or-nothing. Raster validation counts exact decoded pixels and also reports a
separate channel-similarity diagnostic. PDF validation counts pages whose render
and extracted text both match. ZIP validation independently opens the archive
and counts exact entry bytes, including a verified prefix of a partial entry.

A full pass or partial score also requires an eligible output-producing terminal
outcome. Refusals, errors, timeouts, unavailable products, paywalls, and missing
output remain distinct visible outcomes and receive a run score of zero even if
stray output bytes happen to match.

## Commands

```sh
node benchmark-kit/cli.mjs demo --workspace benchmark-work --run-id proof
node benchmark-kit/cli.mjs run --protocol protocol.json --corpus corpus.json \
  --tool tool.json --workspace benchmark-work --run-id product-run
node benchmark-kit/cli.mjs ingest-guided --protocol protocol.json \
  --corpus corpus.json --tool tool.json --observations observations.json \
  --workspace benchmark-work --run-id guided-run
node benchmark-kit/cli.mjs verify --run benchmark-work/product-run
node benchmark-kit/cli.mjs publish --run benchmark-work/product-run \
  --output benchmark-work/product-run-publication
node benchmark-kit/cli.mjs verify-publication \
  --publication benchmark-work/product-run-publication
```

The harness never downloads or installs vendor software. Command adapters are
launched directly without a shell, receive per-case input and output paths, and
run with time and output-capture limits. Guided captures ingest an operator's
structured observation and supporting files, then score the captured output
independently.

This repository currently publishes no product result bundles.
