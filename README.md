# knowless

<p align="center">
  <a href="https://github.com/hamr0/knowless/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/hamr0/knowless/ci.yml?label=CI" alt="CI"></a>
  <img src="https://img.shields.io/github/package-json/v/hamr0/knowless?label=version&color=2a4f8c" alt="version (auto from package.json)">
  <img src="https://img.shields.io/badge/license-Apache%202.0-2a4f8c" alt="license: Apache 2.0">
</p>

Small, opinionated, full-stack passwordless auth for Node.js services
that don't need to email their users for anything but the sign-in link.

```
npm install knowless
```

> v1.0.0 (walk-away release) | Node.js >= 22.5 | **1 production dep (nodemailer)**

## What it does

The simpler answer that always worked: **magic link in, session
cookie out, nothing else stored.** Email is HMAC-hashed at the
boundary and discarded. The library refuses, by API shape, to send
anything but the sign-in link or store anything identifying.

Most auth libraries default to maximum identity collection: full
email in plaintext, profile fields, recovery email, federation. Even
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

## Two deployment shapes

| Shape | When |
|---|---|
| **Library mode** | Mount the five handlers (`login`, `callback`, `verify`, `logout`, `loginForm`) in your existing Node app. |
| **Standalone server** (`npx knowless-server`) | Forward-auth gateway behind Caddy / nginx / Traefik for self-hosters gating Uptime Kuma / AdGuard / Pi-hole / Sonarr / Jellyfin / etc. One auth subdomain, SSO across services via the parent-domain cookie. |

## What knowless refuses (by design)

These are closed doors, not omissions. If any break your case,
knowless isn't the right tool — look at
[Lucia](https://lucia-auth.com/), [Auth.js](https://authjs.dev/),
or commercial offerings.

- **Localhost SMTP only.** No Mailgun / Postmark / SES / Resend.
  Vendor relationships invite reusing the mailer for non-auth mail,
  which collapses the "one mail purpose" invariant.
- **One mail purpose: the sign-in link.** No `sendNotification()` to
  be tempted by.
- **Plain-text 7-bit email.** No HTML, no tracking pixels, no
  click-rewriting, no read-receipts.
- **No DKIM/SPF in the library.** That's the MTA's job; knowless
  emits clean RFC822 and your Postfix + opendkim signs it.
- **No OAuth / OIDC / SAML.** Different audience.
- **No 2FA / WebAuthn / TOTP / passkeys.** Compose with a separate
  library if you need them.
- **No admin UI.** `sqlite3 knowless.db` is the admin UI.
- **Hardcoded login form.** Templating is a slope — today "let me
  put my logo," tomorrow "let me theme the page," eventually "let me
  embed a JS framework." Fork, override the route entirely, or live
  with it.
- **No telemetry, analytics, or error reporting.** No phone-home of
  any kind. Operator-side observability is opt-in via three hooks
  (`onMailerSubmit` / `onTransportFailure` / `onSuppressionWindow`) —
  wire them or be silent.
- **Walks away at v1.0.0.** Maintenance mode after that — security
  fixes, bug fixes that don't change the API surface, doc fixes,
  helper exports.

## Operator commitments

By choosing knowless, you commit to running:

- **Postfix** (or another MTA) on the same host, outbound-only
- **SPF, DKIM, PTR** records for your sending domain
- **Outbound port 25** open (some clouds block it)
- A **null-route** for the configured `shamRecipient` so silent-miss
  sham mail drops, not bounces

## Threat model — one paragraph

Email-based magic links are exactly as strong as the user's mailbox.
knowless can harden the auth flow; it cannot harden an inbox the user
has already lost. The list below reflects that boundary.

**Defends well:** DB-only leaks (handles are HMAC-salted),
plaintext-email exfiltration (none persisted), password reuse (no
passwords), silent email enumeration via the login form (timing-
equivalent + same response shape), email-bombing a target (per-handle
token cap), naive bots (honeypot), account-creation spam (per-IP
caps), replay attacks (atomic mark-token-used), open redirects
(`next_url` whitelist), CSRF on POST endpoints (Origin/Referer
whitelist).

*The per-IP defences key on the client IP. Behind a reverse proxy you
must forward the real client IP, or they collapse to a single bucket
and stop biting per-attacker — see GUIDE (proxies / `startLogin`) and
OPS (nginx).*

*⚠️ **Behind a CDN (Cloudflare, Fastly, Akamai) that is necessary but
not sufficient.** The CDN terminates TLS at its edge, so the "real
client IP" your proxy dutifully forwards is a **CDN edge address, not
the visitor** — every layer behaves correctly and still passes on the
wrong IP. The per-IP caps then bucket per-CDN-colo, shared across
unrelated visitors. It doesn't look broken (you see many distinct IPs,
just not your users'), and it fails toward **over-throttling rather
than bypass** — real signups rejected because a stranger in the same
region spent the budget. Restore the true client at the edge-most proxy
(`set_real_ip_from <cdn ranges>` + `real_ip_header CF-Connecting-IP`),
scoped to the CDN's published ranges. See GUIDE (proxies /
`startLogin`).*

**Partially:** HMAC-secret-only leak (allows targeted existence
checks but not session forgery), phishing (no password to type into a
fake site, but a phished mailbox still receives links).

**Does NOT defend against:** compromised email accounts (the magic
link is a bearer token — anyone who can read the inbox can use it;
defense lives at the email provider, not in this library),
sophisticated bots that bypass the honeypot, distributed floods from
many IPs, full server compromise, social engineering, insider threat
at the operator. Layer-2 defences (Cloudflare, fail2ban, reverse-proxy
rate-limits) belong above the library — but note the irony: an
unconfigured Cloudflare in front of you *disables* the per-IP layer
below it (see the CDN warning above). Note the per-IP caps bound a
*single* address, not aggregate outbound volume — under a distributed
flood (many IPs, each under the cap) your sender-domain reputation, the
asset this auth channel depends on, is the perimeter's responsibility,
not the library's.

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

## Going further

- [`GUIDE.md`](GUIDE.md) — integration walkthrough, observability
  hooks, edge cases, FAQ, troubleshooting.
- [`OPS.md`](OPS.md) — operator setup (Postfix install, SPF/DKIM/PTR/
  DMARC at your registrar, null-route, systemd, forward-auth wiring,
  fail2ban).
- [`CHANGELOG.md`](CHANGELOG.md) — version history.

## License

[Apache 2.0](LICENSE) with [`NOTICE`](NOTICE) preservation. Forks
must keep the NOTICE file.
