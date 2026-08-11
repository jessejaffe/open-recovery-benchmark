# Signed operator attestations

An operator signature is a digital signature, not a typed name or screenshot.
The proposed official workflow is:

1. Freeze the protocol, corpus, tool definition, and case order.
2. Capture a complete guided run and hash every input, output, observation, and
   attachment into the evidence root already produced by the harness.
3. Sign the evidence root together with the run ID, operator identity, and UTC
   signing time using an operator-controlled signing key.
4. Publish the signature, signer identity, and public verification key beside
   the evidence bundle; never publish the private signing key.
5. Repeat the browser run in a fresh session on a later occasion, preferably
   with a second operator, and publish a separate signed bundle.

The recommended signature algorithm is Ed25519 because it is widely supported,
small, and deterministic. Exact key custody, identity proof, and revocation rules
must be frozen before Benchmark v1.0.

A valid signature proves that the named key signed that exact evidence root and
that the bundle has not changed since signing. It does **not** prove that the
operator followed the browser steps honestly, that a screenshot is truthful, or
that the vendor will behave the same way tomorrow. Repeated independent runs,
raw downloadable evidence, and third-party review address those different risks.

Current practice attestations are intentionally marked `unsigned`; no signature
claim should be displayed for them.
