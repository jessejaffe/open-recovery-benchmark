# Competitor observation policy

Competitor research and recovery performance are related records, not the same
claim. Every browser-service run should preserve three separate layers:

1. **Vendor claim:** what a dated official product page advertises for a named
   browser, desktop, free, or paid surface.
2. **Operator observation:** what the product actually accepted, displayed, and
   released during a dated run, with screenshots or downloads when available.
3. **Benchmark interpretation:** whether the case was scored, refused,
   technically unsuccessful, or left unscored by an access constraint.

The record must not infer that a whole product lacks a capability merely because
one surface was under maintenance, required an account, exhausted a quota, or
directed the operator to downloadable software. Online and desktop products are
separate test surfaces even when the vendor uses one brand name.

## Access constraints

New guided observations should use `accessConstraint` to state the cause, stage,
and scope of an unscored access case. The current vocabulary distinguishes:

- `format-not-supported`
- `service-maintenance`
- `free-tier-quota`
- `account-required`
- `payment-required`
- `software-install-required`
- `region-restricted`
- `unknown-unavailable`

A payment gate after successful processing is not a recovery failure. A free
quota reached before another file can be admitted is not a refusal. An account
gate is not a payment gate unless the product actually demands payment. All
three affect practical coverage and remain visible in the evidence.

Repairit's premium tier is a commercial paywall after the free photo allowance.
The fourth practice image is nevertheless recorded as `free-tier-quota`, not as
`paywalled`, because the service did not admit or process that file and then
withhold a completed output. This keeps the commercial limitation visible
without inventing a technical recovery result.

## Current practice findings

The structured catalog is
[`practice/2026-08-11/competitors/catalog.json`](../practice/2026-08-11/competitors/catalog.json).
It records the following time-bound findings:

| Product surface | Advertised or observed scope | Practice access finding |
| --- | --- | --- |
| zPDF Repair PDF web | PDF-only path | Two PDFs tested; six non-PDF cases outside scope |
| iLovePDF Repair PDF web | PDF-only path | Two PDFs tested; six non-PDF cases outside scope |
| EaseUS document and photo web paths | Documents, archives, and photos were accepted in the observed paths | Account required before outputs were available; no payment demand established |
| Repairit Online Photo | Vendor advertises three free photos and 300 monthly on premium | Three images admitted; fourth image blocked after the free allowance |
| Repairit Online File | Vendor advertises PDF, DOCX, PPTX, and XLSX | Path was under maintenance before upload |
| Repairit desktop file repair | Vendor advertises Office, Adobe, and ZIP repair | Not installed or tested in this browser-only rehearsal |

These facts must be rechecked on later runs because web products, limits, and
prices can change without notice. A new observation appends a new dated record;
it does not silently rewrite the historical run.
