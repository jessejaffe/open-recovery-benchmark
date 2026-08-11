# Open Recovery Benchmark

An open, filesystem-only harness for defining repeatable file-recovery tests,
capturing raw evidence, independently validating outputs, and verifying result
bundles offline.

## Status

**Foundation only. No StillOpen report, competitor result, product ranking, or
production benchmark publication is included in this repository.**

The setup releases establish the public source and license trust anchor. Future
benchmark definitions and results can identify the exact public
Git commit that defined their runner, schemas, fixtures, and scoring behavior.

## Included

- Versioned JSON contracts for protocols, corpora, tools, and guided captures.
- Command and operator-guided execution paths.
- Independent exact-byte, raster RGBA, and PDF render/text validators.
- Three required case categories: damaged files expected to be fully restored,
  damaged files where partial restoration must be measured, and healthy
  controls that expose unnecessary changes.
- Deterministic 0–1 recovery scores with visible recovered-unit counts: exact
  decoded pixels for raster images, exact render-and-text pages for PDFs, and
  verified entry bytes for ZIP archives. Similarity diagnostics are reported
  separately and cannot turn altered content into exact recovery credit.
- ZIP and ZIP64 output validation that independently opens entries, checks
  sizes and CRC-32 values, and credits exact files or verified byte prefixes.
- Content-addressed evidence inventories and offline verification.
- Synthetic fixtures proving exact, changed, refusal, timeout, tamper, and
  path-containment behavior.
- A static report generator for future reviewed result bundles.

The synthetic fixtures exercise the harness. They are not product evidence and
cannot appear in a competitive summary.

## Competitor inclusion policy

Competitive panels are limited to tools with a free mode or a freemium path
that can reasonably be tested without purchasing a license. Paid-only products
are outside the scored panel.

If a freemium product accepts a case but withholds the complete recovered output
behind a paywall, the attempt remains visible as `paywalled`. Its evidence may be
published, but it is unscored and must not be represented as a technical failure.
Maintenance, unavailable services, and workflows that produce no downloadable
output are likewise reported separately from recovery performance.

## Verify the setup

Requires Node.js 22.13 or newer.

```sh
npm ci
npm test
npm run demo -- --workspace benchmark-work --run-id local-proof
node benchmark-kit/cli.mjs verify-publication \
  --publication benchmark-work/local-proof-publication
```

The demo writes only to the ignored local `benchmark-work/` directory. CI runs
the same workflow but does not publish its generated report.

## Trust model

A future report should name the exact public repository commit used for its
test definition. The committed protocol, corpus, scoring code, raw outputs, and
evidence inventory then give independent reviewers everything needed to
recalculate the result. A rerun creates a new bundle rather than replacing an
earlier one.

Hashes demonstrate bundle integrity; they do not authenticate an operator.
Unsigned bundles must remain visibly labeled as unsigned.

## License

Harness source and project-authored synthetic fixtures are available under the
[MIT License](LICENSE). Future third-party corpus material must retain its own
source and license metadata in the corpus contract.
