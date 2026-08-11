# StillOpen external-source blind holdout

The corpus and StillOpen run were frozen and executed on 2026-08-10. The separate
browser-product comparison was registered before its new guided runs on
2026-08-11. Its exact format cohorts, tool definitions, file hashes, denominators,
and reporting boundaries are frozen in
[`../../open-recovery/2026-08-11/registration-v2.json`](../../open-recovery/2026-08-11/registration-v2.json).

## Result

- Current release gate: 18/18 exact-content recoveries — PDF 6/6, JPEG 6/6, PNG 6/6 — with 0/9 false positives on the untouched upstream sources.
- The pre-gate baseline was 12/18: the six PNG cases exposed four pixel-changing re-encodes and two safe refusals. Those failures led to lossless structure-only PNG repair.
- Comparable external PDF subset: StillOpen 6/6, zpdf 2/6, iLovePDF 0/6.
- iLovePDF reported success on two PDFs, but both downloads changed rendered page pixels and therefore failed the frozen exact-content rule.

## Release thresholds

`npm run test:holdout` exits unsuccessfully unless all of these remain true:

- Every frozen source and damaged-case SHA-256 matches the manifest.
- All nine untouched upstream sources independently match their frozen content fingerprints and scan as healthy.
- All 18 damaged cases scan as damaged.
- All 18 recoveries report success and independently match the untouched source exactly.
- All six complete-stream PNG cases use lossless structure repair rather than pixel re-encoding.

## What makes this stronger than the internal benchmark

The nine clean source files came from upstream qpdf, libjpeg-turbo, and libpng/PngSuite repositories at frozen commits. Source selection, hashes, mutations, and untouched-source content fingerprints were recorded in `manifest.json` before StillOpen or competitors were run.

This is an external-source generalization test, not a claim that the corruption itself was independently collected: the 18 structural mutations were benchmark-authored and content-preserving. See `protocol.md` for the exact claim boundary.

## Reproduce

```sh
npm run test:holdout
node benchmarks/external-holdout/2026-08-10/scripts/generate-holdout.mjs
node benchmarks/external-holdout/2026-08-10/scripts/run-stillopen-holdout.mjs
node benchmarks/external-holdout/2026-08-10/scripts/validate-competitors.mjs
```

Competitor UI attempts are manual browser runs; `validate-competitors.mjs` independently revalidates the downloaded outputs already captured in `outputs/`.

## Repair versus deleted-file recovery

This benchmark starts with an already-available damaged file and asks a product to
return a repaired copy. A deleted-file or disk-recovery product instead scans a
volume, partition, or image to locate lost data. Recoverit, R-Studio, and Recuva
are therefore documented in `provider-roster.json` as adjacent products, not
silently mixed into the direct PDF/JPEG/PNG comparison.

The open-source entries are repair-capability competitors and explicit engine
baselines, not hidden implementation aids. qpdf, Ghostscript, MuPDF `mutool`,
libpng `pngfix`, and WhatsApp JPEG Image Repair each have a public source
repository and a documented native access path. They enter recovery-quality
tables only after producing a complete output that passes the same independent
validator as every commercial or cloud product. Because they require a command
line, installation or compilation, and manual path/output management, they are
not presented as equivalent consumer browser experiences. The current product
taxonomy and exclusion analysis are documented in
[`../../open-recovery/2026-08-11/competitor-analysis.md`](../../open-recovery/2026-08-11/competitor-analysis.md).

The macOS access-qualification capture is in `open-source-access-results.json`:
qpdf and MuPDF produced six exact PDF outputs, Ghostscript produced six complete
outputs with four exact validations, pngfix produced four exact PNG outputs and
two unusable outputs, and WhatsApp JPEG Repair produced no exact JPEG output.
Those results are disposable qualification evidence, not a replacement for the
frozen six-case scored protocol.

The public Recovery Toolbox URL currently loads its own supplied-file repair
service with PDF support and a 30-day automatic-deletion notice. It is retained
as a direct-repair candidate pending a disposable browser upload. All Recovery
remains a separately attributed candidate; neither service is treated as an
alias without current redirect evidence. R-Studio and Recoverit remain adjacent
disk/deleted-file recovery products unless a distinct supplied-file repair
module is demonstrated.

## Evidence map

- `protocol.md` — preregistered rules and limitations.
- `provider-roster.json` — frozen browser cohort assignments, open-source repository links, category boundary, access checks, and pending execution fields for PDF, JPEG, and PNG tools.
- `open-source-access-results.json` — reproducible macOS versions, commands, installer hashes, per-case output hashes, and independent access-validation results for the open-source engine baselines.
- `manifest.json` — frozen provenance, hashes, mutations, and exact ground truth.
- `stillopen-results.json` — per-case StillOpen reports and independent validation.
- `competitor-results.json` — per-case zpdf/iLovePDF UI outcomes and independent validation.
- `sources/` and `licenses/` — upstream inputs and permission evidence.
- `cases/` — frozen damaged inputs.
- `outputs/` — captured product and competitor outputs.
- `scripts/` — corpus generator, runner, and validators.
