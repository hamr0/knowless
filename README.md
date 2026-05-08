# knowless

Small, opinionated, full-stack passwordless auth for Node.js services
that don't need to email their users for anything but the sign-in link.

```
npm install knowless
```

> v1.0.0 (walk-away release) | Node.js >= 22.5 | **1 production dep (nodemailer)** | Apache-2.0

## Required reading (before integrating or filing an issue)

This README is the front door, not the manual. Most "missing feature"
questions about knowless turn out to be answered in the docs below —
hooks that already exist, refusals that are deliberate, operator
setup steps already documented. **Read these before assuming a gap.**

| Read this | Why you need it |
|---|---|
| [`GUIDE.md`](GUIDE.md) | Integration walkthrough, **observability hooks** (`onMailerSubmit` / `onTransportFailure` / `onSuppressionWindow`), edge cases, FAQ, troubleshooting. |
| [`OPS.md`](OPS.md) | Operator setup — Postfix install, **SPF / DKIM / PTR / DMARC at your domain registrar** (§5), null-route, systemd, Caddy/nginx/Traefik forward-auth, MailHog dev, fail2ban. |
| [`docs/01-product/PRD.md`](docs/01-product/PRD.md) §16 | Why knowless refuses what it refuses. Decisions log — read §16.2 before asking for vendor SMTP, §16.7 before asking for built-in DKIM, §16.12 before asking for a templatable login form. |
| [`knowless.context.md`](knowless.context.md) | Dense single-file reference for AI agents and quick lookups. Public API table, every option with defaults, 19 gotchas, threat model. Fits one context window. |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history. |

## What it does

The simpler answer that always worked: **magic link in, session
cookie out, nothing else stored.** Email is HMAC-hashed at the
boundary and discarded. The library refuses, by API shape, to send
anything but the sign-in link or store anything identifying.

Most auth libraries default to maximum identity collection: full email
in plaintext, profile fields, recovery email, federation. Even
nominally privacy-focused options store enough that a breach is
materially harmful. knowless inverts the default.

The thesis: most services have ten layers of auth tooling where they
need two.

## How it works

```
email  →  HMAC-SHA256(secret, normalize(email))  →  opaque handle
            |                                         |
            v                                         v
       magic-link token (256-bit, single-use)    sessions, tokens
            |                                         |
            v                                         v
       submitted via localhost SMTP             stored as SHA-256 hashes
            |
            v
       user clicks  →  handle resolved  →  signed cookie set
```

- **Plaintext email is never persisted.** Only the salted hash
  (`HMAC-SHA256(secret, normalized_email)`).
- **Only the magic link is ever sent.** No welcome, no digest, no
  notification. There is no API to send anything else.
- **All outbound mail goes via your localhost MTA.** No vendor SDKs,
  no API tokens.
- **Tokens are SHA-256 at rest, single-use, 15-min TTL.** Raw token
  never persisted.
- **Session cookies are HMAC-signed.** No JWT, no algorithm confusion.
- **Sham work on every miss.** Unknown emails do the same work as
  registered ones (compose, submit, log) but the SMTP recipient is a
  null-route. Times equivalent within 1ms — measured in CI.

## Two modes

Same library, two flows. They coexist in one app — pick per action.

- **"Sign in, then do the thing"** — a normal login.
- **"Do the thing, confirm by email"** — drop a pin, post a comment,
  share a link without an account, and the email confirmation creates
  the account in the background.

The same sham-work flow runs underneath either mode, so unknown
emails, rate-limit hits, and real sends look identical to an external
observer.

Worked code for both in [`GUIDE.md`](GUIDE.md).

## Two deployment shapes

| Shape | When |
|---|---|
| **Library mode** | Mount the five handlers (`login`, `callback`, `verify`, `logout`, `loginForm`) in your existing Node app. |
| **Standalone server** (`npx knowless-server`) | Forward-auth gateway behind Caddy / nginx / Traefik for self-hosters gating Uptime Kuma / AdGuard / Pi-hole / Sonarr / Jellyfin / etc. One auth subdomain, SSO across services via the parent-domain cookie. |

## What knowless refuses (by design)

These are closed doors, not omissions. Don't file feature requests
for them — the reasoning is locked in
[`docs/01-product/PRD.md`](docs/01-product/PRD.md) §16. If any
break your case, knowless isn't the right tool — look at
[Lucia](https://lucia-auth.com/), [Auth.js](https://authjs.dev/),
or commercial offerings.

- **Localhost SMTP only.** No Mailgun / Postmark / SES / Resend.
  Reasoning: PRD §16.2 — vendor relationships invite reusing the
  mailer for non-auth mail, which collapses the "one mail purpose"
  invariant.
- **One mail purpose: the sign-in link.** No `sendNotification()` to
  be tempted by.
- **Plain-text 7-bit email.** No HTML, no tracking pixels, no
  click-rewriting, no read-receipts.
- **No DKIM/SPF in the library.** PRD §16.7 — that's the MTA's job;
  knowless emits clean RFC822 and your Postfix + opendkim signs it.
  Setup steps in [`OPS.md`](OPS.md) §5.
- **No OAuth / OIDC / SAML.** Different audience.
- **No 2FA / WebAuthn / TOTP / passkeys.** Compose with a separate
  library if you need them.
- **No admin UI.** `sqlite3 knowless.db` is the admin UI.
- **Hardcoded login form.** No template overrides — PRD §16.12.
  Fork, override the route entirely, or live with it.
- **No telemetry, analytics, or error reporting.** No phone-home of
  any kind. (Operator-side observability is opt-in via hooks — see
  below.)
- **Walks away at v1.0.0.** Maintenance mode after that — only
  security fixes.

## Observability (wire it or be silent)

knowless emits **three operator-visibility hooks** on the mail-send
path. They're the only API for SMTP outcomes — there is no internal
logging the library does on your behalf beyond an unwired-default
stderr line on transport failure. If you want metrics, alerting, or
an admin UI showing send results, you wire these.

```js
const auth = knowless({
  secret, baseUrl, from,

  onMailerSubmit: ({ messageId, handle, timestamp }) => {
    // Real (non-sham) submission succeeded. Safe per-event — fires
    // ONLY on registered handles, so no enumeration oracle.
  },
  onTransportFailure: ({ error, timestamp }) => {
    // SMTP submission failed. Carries no identity data. Wire to
    // your alerting / admin "last 10 sends" panel.
  },
  onSuppressionWindow: ({ sham, rateLimited, windowMs }) => {
    // Aggregate counters for the silent-202 branches (sham + rate-
    // limit hits). Windowed, NOT per-event — per-event would reopen
    // the enumeration oracle that sham-work exists to prevent.
  },
});
```

Threat-model reasoning for why three hooks (and not a fourth
per-event sham hook) lives in [`GUIDE.md`](GUIDE.md) Step 8 and
`knowless.context.md` § "Why three hooks, not four". **Read it
before logging payloads** — careless aggregation can leak handles
into log lines.

## Operator commitments

By choosing knowless, you commit to running:

- **Postfix** (or another MTA) on the same host, outbound-only
- **SPF, DKIM, PTR** records for your sending domain
- **Outbound port 25** open (some clouds block it)
- A **null-route** for the configured `shamRecipient` so silent-miss
  sham mail drops, not bounces

Step-by-step in [`OPS.md`](OPS.md).

## Threat model — one paragraph

**Defends well:** DB-only leaks (handles are HMAC-salted),
plaintext-email exfiltration (none persisted), password reuse (no
passwords), silent email enumeration via the login form (timing-
equivalent + same response shape), email-bombing a target (per-handle
token cap), naive bots (honeypot), account-creation spam (per-IP
caps), replay attacks (atomic mark-token-used), open redirects
(`next_url` whitelist), CSRF on POST endpoints (Origin/Referer
whitelist).

**Partially:** HMAC-secret-only leak (allows targeted existence
checks but not session forgery), phishing (no password to type into a
fake site, but a phished mailbox still receives links).

**Does NOT defend against:** sophisticated bots that bypass the
honeypot, distributed floods from many IPs, full server compromise,
compromised email accounts, social engineering, insider threat at the
operator. Layer-2 defences (Cloudflare, fail2ban, reverse-proxy
rate-limits) belong above the library — patterns in
[`OPS.md`](OPS.md).

Full detail in [`knowless.context.md`](knowless.context.md) §
"Threat model summary."

## Adopters

Production users of knowless, in adoption order:

- [`addypin`](https://github.com/hamr0/addypin) — pin-drop location
  sharing. First knowless adopter; Mode A (drop-pin-then-confirm).
- [`plato`](https://github.com/hamr0/plato) — forum (Reddit-shaped,
  one fingerprint per site). Mode B (sign-in-then-do).
- [`gitdone`](https://github.com/hamr0/gitdone) — multi-party email
  workflows verified via DKIM/SPF inbound. Mode A
  (start-workflow-then-confirm).

If you're picking knowless up: the addypin and gitdone callsites are
both Mode A and good worked references for the use-first / claim-later
shape.

## License

[Apache 2.0](LICENSE) with [`NOTICE`](NOTICE) preservation. Forks
must keep the NOTICE file.
