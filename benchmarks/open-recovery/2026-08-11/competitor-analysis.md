# Competitor landscape and benchmark qualification

Captured 2026-08-11. This document separates recovery capability from consumer
product experience. The evidence inventory remains in
[`../../external-holdout/2026-08-10/provider-roster.json`](../../external-holdout/2026-08-10/provider-roster.json);
this analysis explains which products belong in a customer-facing comparison and
why the broader products were not admitted.

## Decision summary

StillOpen should publish three distinct layers instead of presenting every repair
program in one undifferentiated ranking:

1. **Browser-product competitors** are products a Mac user can open in a normal
   browser, use without installing software or paying, and receive a complete
   repaired file from often enough to run the frozen cohort.
2. **Recovery-engine baselines** are open-source command-line tools tested on the
   same damage and validators. They are comparable on repair capability, but not
   on consumer access, privacy, installation friction, or workflow.
3. **Access and category exclusions** document products that require a download,
   sign-in, payment, preview-only trial, unsupported operating system, or a
   different recovery task. Exclusion is evidence about the market, not a failed
   recovery score.

This structure keeps the technical benchmark honest while preserving the product
finding: none of the products documented in this sweep combines a no-install
browser experience, local processing, unrestricted full-file export, and a
single interface spanning the benchmark's PDF, JPEG, and PNG formats.

## Why command-line tools are not the same consumer experience

qpdf, MuPDF, Ghostscript, pngfix, and WhatsApp JPEG Image Repair are real repair
implementations. Their outputs can and should be scored with the same independent
validators as StillOpen. They are not equivalent consumer products because the
user must obtain a binary or source tree, install or compile it, open a terminal,
learn the command and flags, manage input/output paths, and interpret warnings or
exit codes. MuPDF and Ghostscript also require license review before their AGPL
code is embedded in a distributed proprietary product.

The distinction is therefore not "real competitor" versus "irrelevant tool." It
is two valid questions:

- **Capability:** which engine recovers the correct content from the same damaged
  bytes?
- **Experience:** can an ordinary user repair the file immediately in a browser,
  without installation, payment, an account, or surrendering the file to a
  server?

The recovery-quality tables may include both layers. The product-experience table
must label command tools as engine baselines rather than consumer peers.

## Browser-product qualification rule

A product qualifies for the main consumer benchmark only when the observed path:

- directly accepts an already-available damaged file;
- works in a normal browser on macOS without a desktop download;
- does not require payment, a credit card, or a paid export;
- returns a complete downloadable result, not a preview, watermark, sample, or
  placeholder;
- offers enough repeatable free use to complete the nine-case format cohort;
- supports at least one format in the frozen PDF, JPEG, or PNG cohorts; and
- permits the returned file to be captured and independently validated.

Single-file processing is allowed if it can be repeated without a quota or
paywall. Throughput remains a measured experience difference. A service that
offers one free repair per month does not qualify merely because its first output
may be free.

## Core and candidate browser competitors

| Product | Formats | Execution and free-access claim | Current disposition |
| --- | --- | --- | --- |
| **StillOpen** | PDF, JPEG, PNG in this frozen benchmark | Browser-local recovery; no file upload, account, installation, quota, or paid export | Control product; independently verified 9/9 in PDF, 9/9 in JPEG, and 9/9 in PNG |
| [PDF24 Repair PDF](https://tools.pdf24.org/en/repair-pdf) | PDF | Browser UI with server processing; official page states no registration, no limits, no forced premium version, and advertising-funded operation; uploaded files are deleted after one hour | Core competitor; independently verified 6/9 in PDF |
| [zPDF Repair PDF](https://zpdf.app/en/tools/repair-pdf) | PDF | qpdf compiled to WebAssembly; local processing, no upload or account, and up to ten files per session | Core competitor; independently verified 5/9 in PDF |
| [PDF2Go Repair PDF](https://www.pdf2go.com/repair-pdf) | PDF | Browser upload and server processing; the observed anonymous session provided eight credits with a maximum of three files per free task | Core competitor; the nine-case cohort completed in three free tasks and independently verified 3/9 in PDF |
| [ToolTea Image Repair](https://tooltea.com/image/repair-jpeg) | JPEG, PNG | Browser-local structural diagnosis and repair with direct download; page states the files never leave the device | Core competitor; independently verified 9/9 in JPEG and 5/9 in PNG |

## Published browser benchmark results

The preregistered runs are complete. [`results-v2.json`](results-v2.json) binds
every score to the frozen registration, run evidence digest, and publication
digest. The public comparison and all eight case-level evidence bundles are at
[`/benchmarks/open-recovery-competitors/`](../../../public/benchmarks/open-recovery-competitors/index.html).

| Format | StillOpen | PDF24 | zPDF | PDF2Go | ToolTea |
| --- | ---: | ---: | ---: | ---: | ---: |
| PDF | **9/9** | 6/9 | 5/9 | 3/9 | Not supported |
| JPEG | **9/9** | Not supported | Not supported | Not supported | **9/9** |
| PNG | **9/9** | Not supported | Not supported | Not supported | 5/9 |

There is deliberately no overall percentage. PDF24 reported success for all nine
inputs, but its three qpdf form outputs failed exact render/text validation. zPDF
returned five valid outputs and four explicit errors. PDF2Go returned seven
files, but only three preserved the frozen content; four changed the content and
two cases produced explicit errors. ToolTea's JPEG outputs all passed. In PNG,
its missing-IEND repairs and three healthy controls passed; three CRC-damaged
inputs were returned unchanged and therefore classified as no output, while the
corrupt-IHDR case produced an explicit no-download error.

PDF24 is particularly important business-model evidence. It explicitly says
advertising pays for unrestricted use, but it bears server-processing and upload
storage costs. StillOpen's local-compute design can pursue the same free,
advertising-supported access while also avoiding repair compute, file retention,
and content-upload infrastructure.

zPDF and ToolTea prevent an unsupported "only local browser repair" claim. Their
scope is narrow: zPDF is a PDF/qpdf experience, while ToolTea targets structural
JPEG and PNG damage. StillOpen's defensible product direction is a single private
repair surface that continually adds formats, not a claim that local WebAssembly
repair has never existed.

## Browser services that do not qualify

These remain in the market analysis because their friction and gates explain the
opportunity. They are not assigned a recovery percentage beside unrestricted
browser products.

| Product | Observed or published gate | Reason it is outside the main benchmark |
| --- | --- | --- |
| [iLovePDF Repair PDF](https://www.ilovepdf.com/repair-pdf) | Free Basic allocation is one repair; larger allocation is Premium | Cannot run the cohort under repeatable free access. Existing evidence recorded two downloads, 0/6 exact validations, and four refusals. |
| [Stellar Online PDF Repair](https://repair.stellarinfo.com/pdf/) | One PDF up to 10 MB per month for free; paid plan begins with five files. The observed Google sign-in popup rendered black while Stellar reported an HTTP error. | Quota cannot cover the cohort and the observed authentication path was unavailable. No further login troubleshooting is required for qualification. |
| [Recovery Toolbox Online](https://online.recoverytoolbox.com/) | Upload-first flow; its [price page](https://recoverytoolbox.com/prices.html) states $5 per 1 GB of original file size | Full result is paywalled, so the service is access evidence rather than a free competitor. |
| [All Recovery Online](https://online.all-recovery-inc.com/) | Email-gated and complete free-output entitlement remains unconfirmed | Excluded unless a disposable access check proves a complete, repeatable free output. |
| [OfficeRecovery Online](https://online.officerecovery.com/pdf) | Downloadable demo contains placeholders; full recovery requires purchase | Preview/demo output is not independently scoreable recovery. |
| [EaseUS Online File Repair](https://repair.easeus.com/document_repair/) | Prior access check produced no complete output | Excluded unless a later stable, repeatable free workflow is proven. |
| [Repairit Online File Repair](https://repairit.wondershare.com/app/file-repair) | Prior access check encountered maintenance/unavailability | Excluded unless a later stable, repeatable free workflow is proven. |
| [PDF Repair](https://www.pdfrepair.io/) | Discovered but not yet access-qualified | Research candidate only; do not imply qualification or performance. |

Authentication failures, maintenance, quotas, and paywalls are recorded as access
outcomes. They are not converted into zero repair scores because no complete
output existed for the independent validator to judge.

## Desktop, downloadable, and Windows-only products

The following products can remain in the broad landscape but do not belong in
the main consumer benchmark. Their download/install workflow is materially
different from StillOpen, and most trials withhold a complete saved result.

| Product | Access boundary | Disposition |
| --- | --- | --- |
| Wondershare Repairit | macOS/Windows desktop download; trial repairs or previews but requires purchase to save | Excluded: installation plus paid export |
| EaseUS Fixo | macOS/Windows desktop download; installed trial requires Pro to save repaired output | Excluded: installation plus paid export |
| Tenorshare 4DDiG File Repair | macOS/Windows desktop download; preview/export license gate | Excluded: installation and full-output entitlement not free |
| Stellar Repair for PDF | Desktop download; trial preview does not save a complete result | Excluded: installation plus paid export |
| Stellar Repair for Photo | Desktop product, observed candidate is Windows-oriented | Excluded: different platform/workflow and export gate pending |
| SysTools PDF Recovery | Desktop installer; trial is preview-only. The observed Mac package also triggered a macOS security warning, which was not bypassed. | Excluded: installation, security friction, and paid export |
| Kernel for PDF Repair | Windows `.exe`; trial output is watermarked | Excluded: Windows-only download and non-scoreable trial output |
| Kernel Photo Repair | Windows desktop download with unresolved full-export entitlement | Excluded: Windows-only download and paid/export gate pending |
| PDF Recovery Kit | Windows desktop download with preview/license gate | Excluded: Windows-only download and paid export |
| Recovery Toolbox for Excel and related utilities | Download links provide Windows `.exe` applications; personal licenses are sold separately | Excluded: Windows-only desktop experience and purchase boundary |
| PDF24 Creator | Free Windows desktop application | Useful adjacent implementation, but the no-install PDF24 Online service is the comparable consumer product |
| 3-Heights PDF Analysis & Repair | Specialist desktop/SDK product with commercial distribution considerations | Excluded from consumer experience; retain only for technical discovery |

The installer hashes and versions already captured in the provider roster remain
useful provenance. No additional purchase, Gatekeeper bypass, Windows machine, or
desktop test is needed for the browser-product comparison.

## Open-source recovery-engine baselines

| Engine | Format and access | Qualification evidence | Reporting role |
| --- | --- | --- | --- |
| [qpdf](https://github.com/qpdf/qpdf) | PDF command line; Apache-2.0 | 6/6 complete exact outputs in the disposable external-source access run | Engine baseline and zPDF lineage disclosure |
| [MuPDF `mutool clean`](https://github.com/ArtifexSoftware/mupdf) | PDF command line; AGPL or commercial license | 6/6 complete exact outputs | Engine baseline |
| [Ghostscript `pdfwrite`](https://github.com/ArtifexSoftware/ghostpdl) | PDF command line; AGPL or commercial license | 6/6 complete outputs, 4/6 exact validations | Engine baseline |
| [libpng `pngfix`](https://github.com/pnggroup/libpng) | PNG command/build tool | 4/6 complete exact outputs; two unusable outputs | Narrow engine baseline |
| [WhatsApp JPEG Image Repair](https://github.com/cdefgah/whatsapp-jpeg-repair) | JPEG command tool | 2/6 complete outputs, 0/6 exact validations | Narrow engine baseline |

These figures are engine access-qualification evidence, not part of the published
consumer-browser score table. A future engine publication must use the frozen
nine-case cohort, record all healthy controls, and disclose shared engine
families so a qpdf command and a qpdf-based web wrapper are not portrayed as
independent algorithmic discoveries.

## Adjacent products, not supplied-file repair

Wondershare Recoverit, R-Studio, and Recuva scan a disk, partition, volume, or
image for deleted or lost files. They solve a different problem from accepting a
damaged file that the user already possesses. They require a separate storage-
recovery corpus, ground truth, and denominator and must not be mixed into this
benchmark.

## Product opportunity and claim boundary

The observed market supports this product thesis:

> Free, private file repair in your browser. No installation, account, upload,
> quota, or paid export.

The current proof should append the supported formats rather than promise every
file type. The product can expand that list over time while keeping the same
local-first experience.

Strong, supportable differentiators for this evidence set are:

- one consistent browser product across PDF, JPEG, and PNG instead of a separate
  single-format site or installer;
- local compute and no content upload across those supported formats;
- complete free export rather than a preview-to-payment funnel;
- repeatable use without accounts or quotas; and
- transparent repair reports and independently reproducible benchmarks.

Avoid "the only browser repair tool" or "the first local repair tool." zPDF and
ToolTea are contrary evidence. A narrower statement such as "private, local
repair for multiple major file types in one free browser experience" remains
subject to continuing market review but matches the opportunity identified here.

## Publication structure and completed tests

The browser comparison was registered before the new runs in
[`registration-v2.json`](registration-v2.json). It freezes three separate score tables:
PDF (StillOpen, PDF24, zPDF, and PDF2Go), JPEG (StillOpen and ToolTea), and PNG
(StillOpen and ToolTea). Every product has nine cases only within a supported
format: six damaged inputs and three healthy controls. No cross-format overall
recovery percentage is permitted.

The public comparison contains:

1. a **verified recovery table** for StillOpen, PDF24, zPDF, PDF2Go, and ToolTea,
   separated by supported format;
2. a **consumer-experience matrix** for installation, sign-in, payment, quota,
   batch size, local versus server processing, retention, and supported formats;
3. an **engine-baseline appendix** for qpdf, MuPDF, Ghostscript, pngfix, and
   WhatsApp JPEG Image Repair; and
4. an **excluded-provider appendix** containing every product above and the exact
   qualification failure without assigning an invented recovery percentage.

PDF24, zPDF, PDF2Go, and ToolTea have now completed their preregistered format
cohorts, including healthy controls. Verify the complete result set with
`npm run verify:browser-competitors`. Excluded products require no
more installation, login, or purchase work unless their access model materially
changes. The next useful benchmark work is broader externally sourced damage,
additional formats, and a separately registered storage-recovery track—not more
effort forcing preview-only or paid products into this denominator.
