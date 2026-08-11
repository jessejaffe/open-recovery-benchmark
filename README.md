# Open Recovery Benchmark

An open, filesystem-only harness for defining repeatable file-recovery tests,
capturing raw evidence, independently validating outputs, and verifying result
bundles offline.

## Status

**Foundation plus a frozen, format-specific consumer-browser benchmark, one
explicitly unofficial backend rehearsal, and a four-format healthy-control
addendum.**

The [2026-08-11 consumer-browser publication](benchmarks/open-recovery/2026-08-11/README.md)
contains the preregistration, protocol, corpora, product definitions, broader
competitor analysis, exact frozen harness snapshot, aggregate results, and all
eight content-addressed evidence packages. Its score tables are deliberately
separate by supported format: PDF, JPEG, and PNG. It does not calculate a
cross-format overall score.

The [2026-08-11 practice bundle](practice/2026-08-11/README.md) contains a
project-authored eight-case corpus, guided browser observations, recovered
outputs, screenshots, five damaged-file runs, and five healthy-control runs.
Its protocols mark every result ineligible for a competitive summary.

The same practice directory also contains a
[`healthy-control addendum`](practice/2026-08-11/healthy-controls-summary.json)
for intact PDF, JPEG, PNG, and ZIP inputs. Its scoring contract is documented in
[`docs/healthy-controls.md`](docs/healthy-controls.md). The addendum includes
StillOpen plus four free or freemium browser surfaces, with coverage shown beside
every mean and account, queue, and unsupported-format cases left unscored.

The setup releases establish the public source and license trust anchor. The
2026-08-11 publication was initially executed from the application repository;
this repository preserves the exact registered files and runtime artifacts by
their preregistered SHA-256 hashes, along with an offline verifier for the public
mirror. Future registrations should identify this public repository's exact Git
commit before execution.

## Included

- Versioned JSON contracts for protocols, corpora, tools, and guided captures.
- Structured competitor facts and access constraints that keep vendor claims,
  operator observations, account gates, payment gates, quotas, maintenance, and
  unsupported formats distinct.
- Command and operator-guided execution paths.
- Independent exact-byte, raster RGBA, and PDF render/text validators.
- Three required case categories: damaged files expected to be fully restored,
  damaged files where partial restoration must be measured, and healthy
  controls that expose unnecessary changes.
- Strict healthy-control scoring that rewards an explicit no-action diagnosis or
  a byte-identical output and rejects unnecessary replacements.
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

Every aggregate must show declared-case coverage beside its scored denominator.
`unavailable` and `paywalled` cases remain in the evidence bundle but do not enter
the mean recovery score. A refusal, changed output, timeout, or processing error
on an eligible case remains a zero.

## Verify the setup

Requires Node.js 22.13 or newer.

```sh
npm ci
npm test
npm run verify:browser-competitors
npm run demo -- --workspace benchmark-work --run-id local-proof
node benchmark-kit/cli.mjs verify-publication \
  --publication benchmark-work/local-proof-publication
```

The browser-competitor verifier checks the frozen registration and runtime
hashes, all eight publication attestations, every cohort denominator and score,
and the aggregate summary. The demo writes only to the ignored local
`benchmark-work/` directory. CI runs the same verification workflow but does not
publish its generated report.

## Trust model

A report should name the exact public repository commit used for its test
definition. The committed protocol, corpus, scoring code, raw outputs, and
evidence inventory then give independent reviewers everything needed to
recalculate the result. A rerun creates a new bundle rather than replacing an
earlier one.

Hashes demonstrate bundle integrity; they do not authenticate an operator.
Unsigned bundles must remain visibly labeled as unsigned.

The proposed official signing workflow uses a digital signature over the
evidence root, run identity, operator identity, and signing time. See
[`docs/operator-signatures.md`](docs/operator-signatures.md). A signature proves
attribution and integrity; it does not by itself prove that the manual browser
steps were performed honestly.

## License

Harness source and project-authored synthetic fixtures are available under the
[MIT License](LICENSE). Future third-party corpus material must retain its own
source and license metadata in the corpus contract.
