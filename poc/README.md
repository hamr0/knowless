# knowless POC

Throwaway. Validates three open questions before SPEC.md:

- **Q1** Can registered/unregistered login paths be made timing-indistinguishable, and is sham work needed?
- **Q2** Does the magic-link round-trip work end-to-end (login → mail → callback → session → replay-reject)?
- **Q3** Is `verifySession` (the forward-auth hot path) fast enough for NFR-3 (<10ms)?

## Run

```
cd poc
npm install
node poc-test.js
```

Mail is captured via `nodemailer` `streamTransport` — no MTA required. Real Postfix is a v1 release-gate concern (OPS.md), not a design-validation concern.

Per AGENT_RULES: never ship the POC. Rewrite for v0.1.
