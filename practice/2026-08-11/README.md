# Practice benchmark rehearsal — 2026-08-11

This is an explicitly unofficial backend rehearsal with a later healthy-control
addendum. It is not Benchmark v1.0, not a neutral corpus, and not eligible for a
public competitor ranking.

The rehearsal answers narrower engineering questions:

- Can one protocol drive command-line and operator-guided products?
- Can the evidence bundle preserve successes, refusals, unsupported formats,
  maintenance, paywalls, and missing outputs without conflating them?
- Can independent validators measure exact PDF pages, decoded image pixels, and
  ZIP entry bytes for both full and partial recovery cases?
- What data will the future results UI need?

## Scope

The original damaged-file corpus contains eight small project-authored cases:
one expected full and one expected partial recovery for PDF, JPEG, PNG, and ZIP.
It intentionally remains frozen without controls so the earlier competitor runs
are not rewritten. A separate four-case addendum now freezes healthy PDF, JPEG,
PNG, and ZIP semantics and a StillOpen control run.

## Healthy-control addendum

Harness 1.5 treats a healthy file as a preservation test rather than a recovery
request. An explicit `healthy-no-action` result with no output receives full
credit. A produced replacement passes only when its SHA-256 digest and byte
length exactly match the intact input. A generic refusal, silent no-output,
error, or changed replacement receives zero.

| Tool | Healthy controls | Explicit no-action | Changed outputs | Mean control score |
| --- | ---: | ---: | ---: | ---: |
| StillOpen | 4 / 4 | 4 | 0 | 1.000000 |

The controls and result are in `healthy-controls-corpus.json`,
`healthy-controls-protocol.json`, `healthy-controls-summary.json`, and
`work/stillopen-healthy-controls-1/`. The evidence root is
`e0ff00c1827de5dcfc4ec1334de249884a820ff26d14e2a938b0473f370f30cf`.
No browser competitor was rerun, so no competitor control result is implied.

The first attempted run exposed an adapter false positive: evidence copies are
named `input.bin`, and that temporary extension conflicted with the detected
format. The pinned adapter now classifies the scan using its byte-detected
format. The final four-case run produces no replacement downloads and verifies
offline. See [`docs/healthy-controls.md`](../../docs/healthy-controls.md).

Tools in the rehearsal:

- StillOpen WebAssembly recovery core at a pinned Git commit.
- zPDF Repair PDF.
- iLovePDF Repair PDF.
- EaseUS Online File Repair and its online photo path.
- Wondershare Repairit Online file and photo paths.

The browser products use guided capture. Unsupported formats are recorded as
`unavailable`; a result withheld behind payment is recorded as `paywalled` and
is unscored. Neither state is reported as a technical recovery failure.
Known access causes are also preserved as structured constraints, including
format scope, service maintenance, account requirements, and free-tier quotas.
The dated vendor-claim and operator-observation catalog is in
[`competitors/catalog.json`](competitors/catalog.json).

## Backend workflow

StillOpen uses the command adapter:

```sh
node benchmark-kit/cli.mjs run \
  --protocol practice/2026-08-11/protocol.json \
  --corpus practice/2026-08-11/corpus/corpus.json \
  --tool practice/2026-08-11/tools/stillopen.json \
  --workspace practice/2026-08-11/work \
  --run-id stillopen-practice-1
```

Browser observations are ingested after every case has one terminal outcome:

```sh
node benchmark-kit/cli.mjs ingest-guided \
  --protocol practice/2026-08-11/protocol.json \
  --corpus practice/2026-08-11/corpus/corpus.json \
  --tool practice/2026-08-11/tools/zpdf.json \
  --observations practice/2026-08-11/observations/zpdf/observations.json \
  --workspace practice/2026-08-11/work \
  --run-id zpdf-practice-1
```

Every generated run must pass `benchmark-kit/cli.mjs verify` before its summary
is used. No generated HTML is presented as a finished benchmark UI.

## Practice results

These are backend observations, not a ranking. Means use only scored cases, so
they cannot be compared without the coverage column.

| Tool | Scored / declared | Full | Partial | Eligible zero | Unscored | Mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| StillOpen | 8 / 8 | 4 | 3 | 1 | 0 | 0.648008 |
| zPDF | 2 / 8 | 1 | 0 | 1 refusal | 6 unsupported | 0.500000 |
| iLovePDF | 2 / 8 | 0 | 0 | 2 refusals | 6 unsupported | 0.000000 |
| EaseUS Online | 0 / 8 | 0 | 0 | 0 | 8 account-gated | — |
| Repairit Online | 3 / 8 | 2 | 0 | 1 changed output | 4 maintenance + 1 free-tier quota | 0.666667 |

StillOpen exactly recovered all four expected-full cases. Its three partial
credits were two of three PDF pages, half of the PNG pixels, and 65 of 3,736
verified ZIP entry bytes. The entropy-damaged JPEG remained readable but had no
exact matching pixels; visual similarity is retained as a diagnostic and does
not create recovery credit.

zPDF repaired the missing-EOF PDF and refused the truncated-content PDF.
iLovePDF refused both PDFs. EaseUS reported one PDF as repaired, but required an
account before releasing it and then gated further processing, so no EaseUS
output is scored. Repairit's file-repair path was under maintenance. Its photo
path returned two exact full recoveries and one altered entropy-damaged JPEG;
the fourth photo was not admitted after the free three-photo allowance.
Repairit's premium tier makes that allowance a commercial paywall, but the case
record says `free-tier-quota` because no fourth output was processed and then
withheld.

Repairit's surfaces must not be collapsed into one capability claim. Its
official online file page advertises PDF and Office formats, so the maintenance
page does not establish that Repairit cannot repair PDFs. The primary online
page does not list ZIP, while the separately downloaded desktop offer advertises
ZIP repair. Because this rehearsal installed no software and the online page was
unavailable before upload, its ZIP cases remain unscored rather than failed.

Repairit returned two candidates for each JPEG. Candidate 1 is the deterministic
primary output in this rehearsal; candidate 2 and the original Download All
archive are preserved as evidence. Both candidate pairs produced identical
independent scores, but Benchmark v1.0 still needs an explicit general rule for
products that return multiple alternatives.

## Healthy-file control addendum

The intact PDF, JPEG, PNG, and ZIP controls use stricter semantics than damaged
recovery cases: an explicit healthy/no-action result passes, and any generated
replacement must be byte-for-byte identical. Coverage is shown beside the mean.

| Tool surface | Scored / declared | Healthy passes | Eligible zero | Unscored | Mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| StillOpen | 4 / 4 | 4 | 0 | 0 | 1.000000 |
| zPDF Repair PDF | 1 / 4 | 0 | 1 changed output | 3 unsupported | 0.000000 |
| iLovePDF Repair PDF | 1 / 4 | 0 | 1 refusal | 3 unsupported | 0.000000 |
| EaseUS Online File Repair | 0 / 4 | 0 | 0 | 4 account-gated | — |
| Repairit Online Photo | 0 / 4 | 0 | 0 | 2 queued + 2 unsupported | — |

StillOpen left all four intact files alone. zPDF unnecessarily rewrote the
healthy PDF. iLovePDF rejected that healthy PDF as damaged. EaseUS diagnosed the
healthy PDF as damaged but required an account before processing, so no score is
claimed. Repairit's image cases remained unscored after its free path displayed
a 01:38:38 queue estimate; the session did not wait or install desktop software.

The machine-readable snapshot is `healthy-controls-summary.json`. The exact
rule and the adapter false positive caught by the first control attempt are
documented in `../../docs/healthy-controls.md`.

The machine-readable snapshot is in `summary.json`. Every row points to a
content-addressed run under `work/`, and each run can be verified offline.

## Backend findings before Benchmark v1.0

1. Integrate the verified healthy-control semantics into the eventual combined
   v1 corpus without rewriting the historical eight-case rehearsal.
2. Freeze a broader corpus with more damage classes and, where licensing allows,
   externally authored source material. Project-authored damage must remain a
   visible limitation rather than being disguised as neutral.
3. Formalize multi-output selection, free-tier quota handling, and account-only
   access as protocol rules.
4. Keep dated competitor facts current as each run reveals product scope,
   delivery mode, quotas, account gates, payment gates, and service outages.
5. Repeat guided runs at least twice and add signed operator attestations before
   treating browser-service evidence as an official release.
6. Defer the results UI until those backend contracts are frozen. Its eventual
   first view must show format coverage, scored denominator, access state,
   full/partial/zero counts, recovered units, and unexpected ZIP entries before
   showing any mean.
