# Practice benchmark rehearsal — 2026-08-11

This is an explicitly unofficial backend rehearsal. It is not Benchmark v1.0,
not a neutral corpus, and not eligible for a public competitor ranking.

The rehearsal answers narrower engineering questions:

- Can one protocol drive command-line and operator-guided products?
- Can the evidence bundle preserve successes, refusals, unsupported formats,
  maintenance, paywalls, and missing outputs without conflating them?
- Can independent validators measure exact PDF pages, decoded image pixels, and
  ZIP entry bytes for both full and partial recovery cases?
- What data will the future results UI need?

## Scope

The corpus contains eight small project-authored cases: one expected full and
one expected partial recovery for PDF, JPEG, PNG, and ZIP. It intentionally
omits healthy controls; the v1 protocol still needs explicit semantics for a
tool that correctly reports that a healthy file needs no repair.

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

The machine-readable snapshot is in `summary.json`. Every row points to a
content-addressed run under `work/`, and each run can be verified offline.

## Backend findings before Benchmark v1.0

1. Add healthy controls and define a correct "no repair needed" outcome before
   freezing the v1 protocol.
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
