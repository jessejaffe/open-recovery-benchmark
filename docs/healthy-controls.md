# Healthy-file controls

Healthy controls measure whether a recovery tool avoids changing files that do
not need repair. They are not ordinary recovery cases, and a missing output is
not automatically a failure.

Harness 1.5 freezes the following rules:

1. The control input and ground truth must have the same byte length and SHA-256
   digest, and the ground-truth validator must be `exact-sha256-v1`.
2. An explicit `healthy-no-action` outcome with no generated output receives a
   score of 1. The product must specifically identify that no action is needed;
   a generic refusal, error, or silent no-output receives 0.
3. If the tool generates a replacement, the output receives 1 only when it is
   byte-for-byte identical to the healthy input. Re-encoding, metadata changes,
   recompression, added reports, or any other unnecessary byte change receives
   0 even if the file remains readable.
4. Account gates, payment gates, maintenance, and unsupported formats remain
   unscored access or coverage facts under the existing rules.

The strict byte rule is intentional. A healthy control asks whether the tool can
leave a known-good original alone, not whether it can create a visually or
semantically similar derivative.

## Practice addendum

The first addendum uses one intact PDF, JPEG, PNG, and ZIP already present as
ground truth in the project-authored practice corpus. Coverage remains beside
every mean because each web surface supports or admits a different subset.

| Tool surface | Scored / declared | Healthy passes | Eligible zero | Unscored | Mean |
| --- | ---: | ---: | ---: | ---: | ---: |
| StillOpen | 4 / 4 | 4 | 0 | 0 | 1.000000 |
| zPDF Repair PDF | 1 / 4 | 0 | 1 changed output | 3 unsupported | 0.000000 |
| iLovePDF Repair PDF | 1 / 4 | 0 | 1 refusal | 3 unsupported | 0.000000 |
| EaseUS Online File Repair | 0 / 4 | 0 | 0 | 4 account-gated | — |
| Repairit Online Photo | 0 / 4 | 0 | 0 | 2 queued + 2 unsupported | — |

StillOpen identified all four inputs as healthy and created no output. zPDF
accepted the healthy PDF but rewrote the 1,208-byte input into a different
1,347-byte file, so the exact-identity control scored zero. iLovePDF accepted
the same PDF but refused it as damaged or unreadable, also scoring zero.

EaseUS labeled the intact PDF `Damaged file detected`, then required an account
before processing. That diagnosis is preserved as an operator observation, but
the access gate keeps the case unscored. Repairit admitted the intact JPEG and
PNG, then placed the free batch at position 1,643 with a displayed 01:38:38
estimate. The bounded session ended without treating the queue as a recovery
failure or payment gate.

The initial pre-fix execution also demonstrated the value of controls. The
benchmark stores copied inputs under the neutral evidence name `input.bin`.
StillOpen's first adapter version passed that temporary name into the scan,
which created an extension-versus-content warning and led the adapter to invoke
recovery unnecessarily. The pinned adapter now supplies a scan filename derived
from the byte-detected format. The final run verifies that the product engine—not
the temporary benchmark filename—determines health.

All five run bundles and their screenshots or outputs are preserved beneath
`practice/2026-08-11/work/` and `practice/2026-08-11/observations/`. This remains
an unsigned, unofficial backend rehearsal rather than a competitive release.
