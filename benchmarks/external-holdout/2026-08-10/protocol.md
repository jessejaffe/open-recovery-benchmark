# External-source blind holdout protocol

Date frozen: 2026-08-10
Generator: `external-holdout-v1`

## Purpose

Test whether StillOpen generalizes beyond the small deterministic source files used during development. This holdout uses upstream files that were created by qpdf, the Independent JPEG Group/libjpeg-turbo, and PngSuite—not by StillOpen.

## Blindness rule

The nine source files, their upstream commit IDs, licenses, SHA-256 fingerprints, independent rendering or pixel fingerprints, and all 18 mutation assignments are frozen in `manifest.json` before StillOpen or any competitor is run on this holdout. Results may not be used to replace a difficult source, change a mutation, or redefine ground truth.

## Source set

- Three qpdf PDFs under Apache-2.0: a three-page form, an 11-page document, and a one-page PDF 1.7 bookmark regression file.
- Three IJG test JPEGs from libjpeg-turbo: a baseline image, a restart-interval image, and an arithmetic-coded image.
- Three PngSuite images with an explicit permission grant: 8-bit RGB, 8-bit palette, and 16-bit RGBA.

The exact upstream paths, commits, source URLs, license files, hashes, sizes, and ground-truth fingerprints are recorded in `manifest.json`.

## Mutation scope

Every mutation changes only structural metadata or file termination, not intended page or pixel content:

- PDF: missing EOF, corrupt/missing/nonnumeric/out-of-range `startxref`, and bytes after EOF.
- JPEG: missing/corrupt EOI and bytes after EOI.
- PNG: missing IEND and corrupt IHDR/IDAT/IEND CRCs.

## Pass criteria

- Every untouched source must retain its frozen SHA-256 and independent content fingerprint, and StillOpen must classify it as healthy. The allowed false-positive count is zero.
- Every damaged input must retain its frozen SHA-256 and StillOpen must classify all 18 cases as damaged.
- PDF: repaired output must reopen in strict PDF.js mode, retain the exact page count, and match the untouched source page-by-page for rendered RGBA and extracted text fingerprints.
- JPEG/PNG: repaired output must decode and match the untouched source exactly in width, height, and every RGBA pixel.
- A complete PNG pixel stream with only a checksum or end-marker fault must use lossless structure repair, preserving the source metadata and compressed pixel stream byte for byte.
- A refusal, thrown recovery error, changed dimensions, changed pixels, changed PDF page count, or changed PDF rendering is not a pass.
- Self-reported product success is evidence only after the independent comparison passes.

## Interpretation limit

This is a frozen external-source generalization test, but the damage operations remain benchmark-authored and intentionally target content-preserving structural faults. It is stronger than the original home-field corpus, yet still not equivalent to a third party independently collecting naturally corrupted real-world files.
