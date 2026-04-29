# knowless

Small, opinionated, full-stack passwordless auth for Node.js services
that don't need to email their users for anything but the sign-in link.

```
npm install knowless
```

> v0.1.7 | Node.js >= 20 | 2 deps (nodemailer, better-sqlite3) | Apache-2.0

## What this is

Magic-link auth + session cookie + nothing else. Six lines of
operator code:

```js
import express from 'express';
import { knowless } from 'knowless';

const app = express();
const auth = knowless({
  secret: process.env.KNOWLESS_SECRET,   // 64-char hex (32 bytes)
  baseUrl: 'https://app.example.com',
  from: 'auth@app.example.com',
});

app.use(express.urlencoded({ extended: false }));
app.get('/login',          auth.loginForm);
app.post('/login',         auth.login);
app.get('/auth/callback',  auth.callback);
app.get('/verify',         auth.verify);
app.post('/logout',        auth.logout);
```

That's the entire integration. Users hit `/login`, type their email,
click the magic link in their inbox, and are logged in for 30 days
via a signed session cookie.

## Why this exists

Most auth libraries (Auth0, Clerk, Magic, Firebase Auth) default to
maximum identity collection: full email stored in plaintext, profile
fields, recovery email, federation. Even nominally privacy-focused
options store enough that a breach is materially harmful.

`knowless` is the simpler answer that always worked: magic link in,
session cookie out, nothing else stored. The library refuses, by API
shape, to send anything but the sign-in link or store anything
identifying.

The thesis: most services have ten layers of auth tooling where they
need two.

## What it commits to

- **Stores no plaintext email, ever.** Email is salted-hashed on the
  way in (`HMAC-SHA256(secret, normalized_email)`) and discarded.
- **Sends no email except the magic link.** Not a welcome message,
  not a digest, not a notification. By API shape — there is no
  `sendNotification()` method to be tempted by.
- **Self-hostable end to end.** No vendor relationships. No
  telemetry. No phone-home of any kind.
- **Walks away at v1.0.0.** Maintenance mode after that.

## What it deliberately doesn't do

A short list (full table in [`docs/01-product/PRD.md`](docs/01-product/PRD.md) §14):

- No remote SMTP / mail vendor support — localhost Postfix is the
  only transport
- No HTML email, no tracking pixels, no click-rewriting
- No OAuth / OIDC / SAML — different audience
- No 2FA / WebAuthn / TOTP — compose with a separate library if
  needed
- No admin UI for handles or sessions — `sqlite3 knowless.db` is
  the admin UI
- No customisable login form templates — the page is hardcoded;
  fork or live with it
- No telemetry, analytics, or error reporting

## Two deployment shapes (one codebase)

| Mode | Status | When |
|---|---|---|
| **Library mode** | shipped (v0.1.0) | Mount handlers in your existing Node app |
| **Standalone server** (forward-auth) | shipped (v0.1.3) | Self-hosters gating Uptime Kuma / AdGuard / Pi-hole / Sonarr / etc. via Caddy or nginx |

Library mode is the six-line example above. Standalone server is
`npx knowless-server` — see [`OPS.md`](OPS.md) for the full Postfix +
DNS + reverse-proxy walkthrough.

## Operator commitments

By choosing knowless, you commit to:

- Running your own server with **Postfix installed and configured**
  for outbound-only mail (or another localhost MTA)
- Setting up **SPF, DKIM, and PTR records** for your sending domain
  (one-time DNS setup)
- Verifying **outbound port 25** is open (some clouds block it)
- A **null-route entry** in your MTA's `transport_maps` for the
  configured `shamRecipient` (default `null@knowless.invalid`) — so
  silent-miss sham mail is dropped, not delivered to NXDOMAIN
- Accepting that this is the **only email** your service ever sends

These are documented in [`OPS.md`](OPS.md): Postfix install,
null-route, SPF/DKIM/PTR, systemd unit, Caddy / nginx / Traefik
forward-auth examples, Tailscale pattern, reverse-proxy rate limiting,
and fail2ban / Turnstile references.

## Documentation

- [`README.md`](README.md) (this file) — project pitch, six-line example
- [`GUIDE.md`](GUIDE.md) — adopter walkthrough: who it's for, who it
  isn't, how to integrate, configuration reference, FAQ
- [`OPS.md`](OPS.md) — operator setup: Postfix, null-route, DNS,
  systemd, reverse-proxy forward-auth examples
- [`knowless.context.md`](knowless.context.md) — dense AI-agent
  integration guide (tables, gotchas, public API at a glance)
- [`docs/01-product/PRD.md`](docs/01-product/PRD.md) — product
  requirements: scope, threat model, decisions log, NO-GO table
- [`docs/02-design/SPEC.md`](docs/02-design/SPEC.md) — wire formats,
  byte layouts, algorithms (reimplementation-grade)
- [`docs/03-tasks/TASKS.md`](docs/03-tasks/TASKS.md) — implementation
  task list and phase plan
- [`CHANGELOG.md`](CHANGELOG.md) — version history

## Threat model — what this defends and what it doesn't

Honest version (full detail in [`docs/01-product/PRD.md`](docs/01-product/PRD.md) §12):

**Defends well:** database-only leaks, plaintext email exfiltration,
password reuse / credential stuffing, silent email enumeration
(timing-equivalent within 1ms locally), email-bombing a target,
naive bot traffic, account-creation spam, replay attacks, open
redirects.

**Defends partially:** HMAC-secret-only leak (allows targeted
existence-checks but not session forgery), phishing (no password
to type into a fake site, but a phished mailbox can still receive
links).

**Does NOT defend against:** sophisticated bots that bypass the
honeypot, distributed floods from many IPs, full server compromise,
compromised email accounts, social engineering, insider threat at
the operator. Layer-2 defences (Cloudflare, fail2ban, reverse-proxy
rate-limits) belong above the library; OPS.md will document the
common patterns.

## Sibling projects

- [`addypin`](https://github.com/hamr0/addypin) — location sharing
  with the same hermit philosophy
- [`gitdone`](https://github.com/hamr0/gitdone) — verified email
  actions via DKIM/SPF inbound

## Contributing

Issues and PRs welcome at <https://github.com/hamr0/knowless>.

Per the v1.0.0 walk-away framing in PRD §6.3: feature requests after
v1.0.0 ships will be deflected to the §14 NO-GO table or to sibling
projects. The library being "done" is a feature.

## License

[Apache 2.0](LICENSE) with [`NOTICE`](NOTICE) preservation. Forks
must keep the NOTICE file.
