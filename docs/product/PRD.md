---
title: "knowless — Product Requirements Document (PRD)"
description: "Entry page for the knowless PRD: summary, thesis, commitments, deployment modes, and the confirmed-scope sign-off, with links to the rest of the PRD."
---

# knowless — Product Requirements Document (PRD)

## Summary

`knowless` is a small, opinionated, full-stack passwordless authentication library for Node.js services that don't need to contact their users for anything other than authentication itself. (docs/archive/PRD.md:228-232)

**Thesis.** Most services have accreted ten layers of auth tooling where they need two. Magic links and a session cookie have always been sufficient for the kinds of services this library serves, and `knowless` is a return to that simpler answer, with the discipline to refuse the layers that don't earn their place. (docs/archive/PRD.md:233-238)

### What it commits to

- Stores no plaintext email, ever: email becomes a salted hash on the way in and is discarded. (docs/archive/PRD.md:240-242)
- Sends no email except the magic link (no welcome message, digest, or notification), by API shape. (docs/archive/PRD.md:243-244)
- Self-hostable end to end, with no vendor relationships and no telemetry. (docs/archive/PRD.md:245-245)
- Walks away at v1.0.0, with maintenance mode after that. (docs/archive/PRD.md:246-246)

### Two deployment modes, one codebase

- **Library mode:** import into a Node app and mount the handlers; six lines of operator code. (docs/archive/PRD.md:248-252)
- **Standalone server mode:** run `npx knowless-server` to spin up an auth-only HTTP service that integrates with reverse proxies (Caddy, nginx, Traefik) via forward-auth; zero lines of operator code. (docs/archive/PRD.md:253-257)

### Audience

It is for any service whose user interaction happens in-app, or that needs an auth gate in front of it (self-hosted services without good native auth). (docs/archive/PRD.md:258-261)

## Approval and sign-off

The PRD reflects consensus reached during the design conversation between the user (hamr0) and Claude. Items were explicitly debated and either added to scope or moved to non-goals with documented reasoning. (docs/archive/PRD.md:3012-3017)

**Confirmed scope as of v0.14 of this PRD** (docs/archive/PRD.md:3019-3061):

- Full opinionated library (not a primitives kit); six-line operator integration in library mode; standalone server mode via `npx knowless-server`; forward-auth support for reverse proxies.
- Built-in session management; hardcoded login HTML form with explicit confirmation message; plain HTML pages (no JS, no external resources).
- Plain-text email only with deliverability-friendly headers; localhost Postfix as the only mail transport; 7bit ASCII-only mail body with the magic link URL on its own line and quoted-printable forbidden (FR-17).
- Silent-on-miss with a timing test: silent in shape and timing, not in user-facing feedback, since the user always sees confirmation. The timing envelope is narrowed to the enumeration-vector contract, with rate-limit and honeypot paths exempt.
- Sham-work pattern on the silent-miss path mandated by FR-6; a practical-effect-size bar (delta_mean < 1ms) replaces the unattainable statistical-significance framing.
- Magic-link lifecycle: 256-bit entropy, 15-minute TTL, single-use, hashed at rest, swept on expiry.
- Session lifecycle: 30-day TTL, signed cookies, server-enforced expiry, logout endpoint.
- Last-login compromise hint: timestamp-only, appended to magic-link emails by default, no location/IP/UA tracking.
- Built-in cheap abuse protection (per-email, per-IP, honeypot) with safe adjustable defaults, all silent on rejection.
- Configuration via env vars only; CLI flags limited to inspection/validation; secrets never on the CLI; `.env` via Node's built-in `--env-file=`.
- Two production deps (`nodemailer`, `better-sqlite3`); audit-friendly source size with no LOC mandate.
- Forward-auth return URL via signed `?next=` param; account deletion via the store interface (GDPR).
- POC under `poc/` validated the round-trip, the verify hot path (p99 0.07ms vs 10ms target), and the sham-work timing pattern.
- Walk-away after v1.0.0.
- Audience: in-app services plus self-hosters gating no-auth services.

**Explicitly out of scope:** items in the §14 non-goals table, each individually considered and rejected with reasons. (docs/archive/PRD.md:3062-3064)

## Where the rest of the PRD lives

- [Problem, audience & goals](../wiki/problem-audience-goals.md): §2-6
- [Functional requirements](../wiki/functional-requirements.md): §7, FR-N
- [Architecture, stack, ops & threat model](../wiki/architecture-ops-threats.md): §8-13
- [Decisions log & non-goals](../wiki/decisions-log.md): §14-16. **§16 (the decisions log cited as "PRD §16.N") lives on this page**, with every 16.x heading kept.
- [Audit findings](../wiki/audit-findings.md): §17, AF-N

The full original text is archived byte-identical, and every `docs/archive/PRD.md:<start>-<end>` citation on this page resolves there.
