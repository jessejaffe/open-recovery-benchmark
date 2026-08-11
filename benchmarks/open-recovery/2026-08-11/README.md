# Competitor-ready open recovery benchmark

This preregistered benchmark turns the 2026-08-10 external-source holdout into
format cohorts that named command, desktop, and browser tools can run under the
same independent validators. Each cohort adds the three untouched source files
for that format as healthy controls, so a product is penalized for damaging a
file that did not need repair.

## Frozen browser registration

[`registration-v2.json`](registration-v2.json) locks the named browser comparison before
the new guided runs. It records SHA-256 hashes for the protocol, each selected
corpus, every product definition, the harness implementation, dependency lock,
and the exact StillOpen runtime artifact. This public mirror includes those
artifacts under `frozen-runtime/`, where their registered hashes can be checked
without relying on the private application repository. Verify it with:

```sh
npm run verify:browser-competitors
```

The registered comparisons are deliberately format-specific:

| Cohort | Frozen products | Denominator per product |
| --- | --- | --- |
| PDF | StillOpen, PDF24, zPDF, PDF2Go | 6 damaged + 3 healthy controls = 9 |
| JPEG | StillOpen, ToolTea | 6 damaged + 3 healthy controls = 9 |
| PNG | StillOpen, ToolTea | 6 damaged + 3 healthy controls = 9 |

There is no cross-format overall recovery percentage. PDF-only products are not
assigned JPEG or PNG cases, and ToolTea is not assigned PDF cases. Product format
breadth is reported separately from repair accuracy. A frozen product remains in
its cohort if execution reveals a quota, sign-in, payment, refusal, error, or
missing output; the observed terminal outcome is evidence, not a reason to edit
the roster after seeing results.

## Published results

The registered browser runs are complete and published at
[`/benchmarks/open-recovery-competitors/`](../../../public/benchmarks/open-recovery-competitors/index.html).
The format-specific verified scores are:

| Cohort | Results |
| --- | --- |
| PDF | StillOpen 9/9; PDF24 6/9; zPDF 5/9; PDF2Go 3/9 |
| JPEG | StillOpen 9/9; ToolTea 9/9 |
| PNG | StillOpen 9/9; ToolTea 5/9 |

[`results-v2.json`](results-v2.json) records the run and publication evidence
digests. Verify the registration, every attested publication, roster membership,
and every reported score with:

```sh
npm run verify:browser-competitors
```

The original [`registration.json`](registration.json) and its local control
evidence are preserved as a superseded preflight. That control run correctly
recovered all six damaged cases per format but exposed that harness 1.3.0 treated
StillOpen's explicit healthy/no-action exit as a missing-output error. No
competitor had been run. Registration v2 freezes harness 1.4.0's explicit
healthy-control no-change semantics before competitor execution rather than
rewriting the v1 evidence.

Recovery capability and consumer product experience are reported separately.
See [`competitor-analysis.md`](competitor-analysis.md) for the browser-product
qualification rule, open-source engine baselines, the broader download/paywall
landscape, exclusion reasons, and the advertising-supported local-compute product
opportunity.

The proprietary installers are not committed. Their official filenames, byte
lengths, SHA-256 hashes, inspected versions, and platforms are frozen in the tool
definitions and in the companion provider access log. A different installed
version requires a new tool definition and run ID.

Prepare the deterministic corpora:

```sh
npm run benchmark:competitors:prepare
```

Prepare a blinded packet for a desktop or browser product:

```sh
node benchmark-kit/cli.mjs prepare-guided \
  --protocol benchmarks/open-recovery/2026-08-11/protocol.json \
  --corpus benchmarks/open-recovery/2026-08-11/corpus-pdf.json \
  --tool benchmarks/open-recovery/2026-08-11/tools/stellar-repair-for-pdf-macos-1.0.json \
  --output benchmark-work/stellar-pdf-1.0-packet
```

Use `corpus-all.json` for Repairit, Fixo, and 4DDiG; `corpus-pdf.json` for PDF
products and PDF command tools; `corpus-jpeg.json` or `corpus-png.json` for a
single raster format; and `corpus-raster.json` only for products that support
both JPEG and PNG.

The packet intentionally excludes ground truth. Save every returned file, record
the exact terminal outcome, and ingest only after the entire selected cohort has
one observation per case. The published named results above were added only
after every evidence bundle passed independent verification.

Recoverit, R-Studio, and Recuva remain documented in the adjacent disk/deleted-file
track. The direct-repair harness starts with an already-available damaged input,
whereas those products start with a disk, volume, or disk image and search for a
lost file. They need a separate storage-recovery corpus and denominator.

The main consumer cohort is browser-only, free of installation and paid export,
and capable of returning enough complete files to run its frozen format cohort.
Command-line tools remain independently scored engine baselines; desktop,
paywalled, quota-blocked, and unavailable products remain documented access
evidence rather than disappearing from the market analysis.
