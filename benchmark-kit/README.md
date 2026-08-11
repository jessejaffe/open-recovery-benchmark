# Benchmark kit

The benchmark kit freezes a protocol, corpus, tool definition, environment,
case order, execution limits, and scoring policy into a deterministic plan.
It captures every terminal product outcome and stores inputs, outputs, logs,
guided attachments, validation records, and publication files in a hashed
evidence inventory.

Product messages never decide whether recovery passed. A benchmark-owned
validator scores the captured output, and a pass also requires an eligible
output-producing terminal outcome. Refusals, errors, timeouts, unavailable
products, paywalls, and missing output remain distinct visible outcomes.

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
