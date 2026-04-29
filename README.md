# knowless

Small, opinionated, full-stack passwordless auth for Node.js services
that don't need to email their users for anything but the sign-in link.

```
npm install knowless
```

> v0.2.1 | Node.js >= 22.5 | **1 production dep (nodemailer)** | Apache-2.0

## Why this exists

Most auth libraries (Auth0, Clerk, Magic, Firebase Auth) default to
maximum identity collection: full email stored in plaintext, profile
fields, recovery email, federation. Even nominally privacy-focused
options store enough that a breach is materially harmful.

knowless is the simpler answer that always worked: **magic link in,
session cookie out, nothing else stored.** Email is HMAC-hashed at the
boundary and discarded. The library refuses, by API shape, to send
anything but the sign-in link or store anything identifying.

The thesis: most services have ten layers of auth tooling where they
need two.

## Two modes — pick per action

Same library, two flows. They coexist in one app; choose per-endpoint
based on whether forcing a login *before* the action would harm UX.

### Mode B — register-first (the form)

User must log in before performing the action. Standard "sign in to
continue" flow.

- User hits `/login`, types email
- Magic link arrives, click → session cookie
- Your protected endpoints call `auth.handleFromRequest(req)` to gate
  access

Use for: account settings, paid features, anything that requires an
identified user at the moment of the action.

### Mode A — use-first, claim-later (programmatic)

User performs the action *without* being logged in. You capture their
email along with the action, fire a magic link via
`auth.startLogin({email, nextUrl, ...})`, and clicking it opens a
session and "promotes" the deferred resource.

Use for: drop-a-pin / submit-a-paste / share-a-link / disposable
resources / anywhere logging in first kills the UX.

The same 12-step sham-work flow runs underneath either mode, so
unknown emails, rate-limit hits, and real sends look identical to an
external observer (the FR-6 timing-equivalence guarantee). Pick per
action; the two coexist.

Worked code for both modes is in [`GUIDE.md`](GUIDE.md). The dense
API reference is [`knowless.context.md`](knowless.context.md).

## What's opinionated (locked by design)

These are deliberate trade-offs, documented as `NO-GO` in
[`docs/01-product/PRD.md`](docs/01-product/PRD.md) §14.
The library refuses, by API shape, to grow into them.

- **Localhost SMTP only.** No Mailgun/Postmark/SES/Resend. The
  operator runs Postfix (or another MTA) on the same host, in
  outbound-only mode.
- **One mail purpose: the sign-in link.** No welcome message, no
  digest, no notification. There is no `sendNotification()` to be
  tempted by.
- **Plain-text 7-bit email.** No HTML, no tracking pixels, no
  click-rewriting, no read-receipts.
- **No OAuth / OIDC / SAML.** Different audience.
- **No 2FA / WebAuthn / TOTP / passkeys.** Compose with a separate
  library if you need them.
- **No admin UI.** `sqlite3 knowless.db` is the admin UI.
- **Hardcoded login form.** No template overrides; fork or live
  with it.
- **No telemetry, analytics, or error reporting.** Self-hostable end
  to end. No phone-home of any kind.
- **Walks away at v1.0.0.** Maintenance mode after that — only
  security fixes.

## What's swappable

Everything that *isn't* identity-shape or threat-model essential is
config or injection.

| Knob | Default | Common reasons to change |
|---|---|---|
| `dbPath` | `./knowless.db` | Move to `/var/lib/knowless/...` for systemd; share across processes |
| `smtpHost`, `smtpPort` | `localhost`, `25` | Point at MailHog (`localhost:1025`) for dev mail inspection |
| `cookieDomain` | hostname of `baseUrl` | Set to your eTLD+1 for SSO across subdomains |
| `cookieSecure` | `true` | `false` only for `http://localhost` dev (logs a warning) |
| `tokenTtlSeconds`, `sessionTtlSeconds` | `900`, `2592000` | Tighten for high-security uses; loosen at your peril |
| `openRegistration` | `false` | `true` to let any new email auto-register on first link |
| `subject` | `Sign in` | Match your brand; per-call override on `startLogin` (`subjectOverride`) |
| `bodyFooter` | none | Append a constant brand/legal/feedback line to every magic-link mail |
| `confirmationMessage` | (default copy) | Replace the post-submit "we'll email you" text |
| `maxLoginRequestsPerIpPerHour`, `maxNewHandlesPerIpPerHour` | `30`, `3` | Raise for genuinely shared NATs; `0` to disable in dev |
| `trustedProxies` | `[127.0.0.1, ::1]` | Plain IPs **and** CIDRs (`10.0.0.0/8`) for k8s/docker/cgnat |
| `bypassRateLimit` (per-call) | `false` | Trusted CLI/cron callers via `auth.startLogin` |
| `store` | built-in `node:sqlite` | Inject your own store (Postgres, etc.) |
| `mailer` | built-in nodemailer | Inject your own mailer |
| `transportOverride` | none | Pass a custom `nodemailer.createTransport` |
| `onSweepError(err)` | none | Operator alerting hook for sweeper failures |
| `devLogMagicLinks` | `false` | `true` in dev: print magic-link URLs (or silent-miss hints) to stderr when SMTP fails |

Full table with defaults, types, and validation rules:
[`GUIDE.md`](GUIDE.md) → "Configuration reference."

## Two deployment shapes (one codebase)

| Mode | Status | When |
|---|---|---|
| **Library mode** | shipped (v0.1.0) | Mount handlers in your existing Node app |
| **Standalone server** (forward-auth) | shipped (v0.1.3) | Self-hosters gating Uptime Kuma / AdGuard / Pi-hole / Sonarr / etc. behind Caddy / nginx / Traefik |

Library mode is the six-line example in [`GUIDE.md`](GUIDE.md).
Standalone server is `npx knowless-server` — full Postfix + DNS +
reverse-proxy walkthrough in [`OPS.md`](OPS.md).

## First customer: addypin

[`addypin`](https://github.com/hamr0/addypin) — location-sharing
service in the same hermit-architecture lineage — adopted knowless
as its auth+mail layer. The integration delta:

- **~1,150 lines of bespoke auth/mail code removed** (custom mailer,
  inbound CLI, login plumbing, pin-confirmation state machine, email
  fingerprinting helpers, the matching test files)
- **~35 lines of knowless wiring added**
- **~33× reduction** on the auth/mail surface
- **One production dep** (`nodemailer` only; v0.2.0 dropped
  `better-sqlite3` for `node:sqlite`, the stdlib SQLite driver — no
  C++ toolchain, no native compile, ~40 transitive packages → 2)

The integration round produced the audit findings AF-7 through AF-17
that drove v0.1.5 → v0.1.10. See [`docs/01-product/PRD.md`](docs/01-product/PRD.md)
§17 for the full backlog.

## Operator commitments

By choosing knowless, you commit to:

- Running your own server with **Postfix** (or another MTA) installed
  for outbound-only mail
- Setting up **SPF, DKIM, and PTR** for your sending domain
- Verifying **outbound port 25** is open (some clouds block it)
- A **null-route entry** for the configured `shamRecipient` so
  silent-miss sham mail is dropped, not bounced
- Accepting that the magic link is the **only email** your service
  ever sends

Step-by-step in [`OPS.md`](OPS.md): Postfix install, null-route,
SPF/DKIM/PTR/DMARC, systemd unit, Caddy / nginx / Traefik
forward-auth examples, Tailscale pattern, reverse-proxy rate
limiting, fail2ban / Turnstile, multi-process deployments, MailHog
dev workflow, backups.

## Documentation

- [**`GUIDE.md`**](GUIDE.md) — start here. Adopter walkthrough,
  install, six-line example, both modes worked end-to-end,
  configuration reference, FAQ, troubleshooting.
- [**`knowless.context.md`**](knowless.context.md) — dense reference
  for AI agents and humans-in-a-hurry. Public API table, all options,
  18 gotchas, lifecycles, the sham-work pattern, threat model
  summary.
- [`OPS.md`](OPS.md) — operator setup, fresh VPS to working forward-auth.
- [`CHANGELOG.md`](CHANGELOG.md) — version history.
- [`docs/01-product/PRD.md`](docs/01-product/PRD.md) — product
  requirements, threat model, decisions log, NO-GO table, audit
  findings backlog.
- [`docs/02-design/SPEC.md`](docs/02-design/SPEC.md) — wire formats,
  algorithms, byte layouts (reimplementation-grade).

## Threat model (one-paragraph)

Honest version (full detail in [PRD §12](docs/01-product/PRD.md)):

**Defends well:** DB-only leaks, plaintext-email exfiltration, password
reuse / credential stuffing, silent email enumeration (timing-
equivalent within 1ms locally), email-bombing a target, naive bot
traffic, account-creation spam, replay attacks, open redirects, CSRF
on `POST /login` / `POST /logout` (Origin/Referer whitelist).

**Defends partially:** HMAC-secret-only leak (allows targeted
existence checks but not session forgery), phishing (no password to
type into a fake site, but a phished mailbox still receives links).

**Does NOT defend against:** sophisticated bots that bypass the
honeypot, distributed floods from many IPs, full server compromise,
compromised email accounts, social engineering, insider threat at
the operator. Layer-2 defences (Cloudflare, fail2ban, reverse-proxy
rate-limits) belong above the library; [`OPS.md`](OPS.md) §9–§10
covers the patterns.

## Sibling projects

- [`addypin`](https://github.com/hamr0/addypin) — location sharing,
  first knowless adopter
- [`gitdone`](https://github.com/hamr0/gitdone) — verified email
  actions via DKIM/SPF inbound

## Contributing

Issues and PRs welcome at <https://github.com/hamr0/knowless>.

Per the v1.0.0 walk-away framing in PRD §6.3: feature requests after
v1.0.0 ships will be deflected to the [§14 NO-GO table](docs/01-product/PRD.md)
or to sibling projects. The library being "done" is a feature.

## License

[Apache 2.0](LICENSE) with [`NOTICE`](NOTICE) preservation. Forks
must keep the NOTICE file.
