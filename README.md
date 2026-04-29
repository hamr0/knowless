# knowless

Small, opinionated, full-stack passwordless auth for Node.js services
that don't need to email their users for anything but the sign-in link.

```
npm install knowless
```

> v0.2.3 | Node.js >= 22.5 | **1 production dep (nodemailer)** | Apache-2.0

## Where to go next

Two docs live alongside this README. They serve different readers; pick
the one that matches yours.

| You are | Read this | What's there |
|---|---|---|
| **A human integrating for the first time** | [`GUIDE.md`](GUIDE.md) | Step-by-step walkthrough — install, generate the secret, set up Postfix, mount handlers, both modes worked end-to-end. Configuration reference, FAQ, troubleshooting. |
| **An AI agent, or reading in a hurry** | [`knowless.context.md`](knowless.context.md) | Dense single-file reference. Public API table, every option with defaults, 19 gotchas, lifecycle diagrams, the sham-work pattern, threat model, "what's NOT in knowless and why." Designed to fit one context window. |
| **Deploying to a real server** | [`OPS.md`](OPS.md) | Postfix install, SPF/DKIM/PTR/DMARC, null-route, systemd, Caddy/nginx/Traefik forward-auth, MailHog dev, fail2ban, multi-process. |
| **Tracking what changed** | [`CHANGELOG.md`](CHANGELOG.md) | Version history. |

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

## What's opinionated (locked by design)

Deliberate trade-offs. The library refuses, by API shape, to grow
into them.

- **Localhost SMTP only.** No Mailgun / Postmark / SES / Resend.
- **One mail purpose: the sign-in link.** No `sendNotification()` to
  be tempted by.
- **Plain-text 7-bit email.** No HTML, no tracking pixels, no
  click-rewriting, no read-receipts.
- **No OAuth / OIDC / SAML.** Different audience.
- **No 2FA / WebAuthn / TOTP / passkeys.** Compose with a separate
  library if you need them.
- **No admin UI.** `sqlite3 knowless.db` is the admin UI.
- **Hardcoded login form.** No template overrides; fork or live with
  it.
- **No telemetry, analytics, or error reporting.** No phone-home of
  any kind.
- **Walks away at v1.0.0.** Maintenance mode after that — only
  security fixes.

If any of those break your case, knowless isn't the right tool. Look
at [Lucia](https://lucia-auth.com/), [Auth.js](https://authjs.dev/),
or commercial offerings.

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

## Sibling projects

- [`addypin`](https://github.com/hamr0/addypin) — location sharing,
  first knowless adopter
- [`gitdone`](https://github.com/hamr0/gitdone) — verified email
  actions via DKIM/SPF inbound

## License

[Apache 2.0](LICENSE) with [`NOTICE`](NOTICE) preservation. Forks
must keep the NOTICE file.
