# knowless -- Integration Guide

> For AI assistants and developers wiring knowless into a project.
> v0.1.0 | Node.js >= 20 | 2 deps (nodemailer, better-sqlite3) | Apache-2.0

## What this is

knowless is a passwordless auth library for Node.js services
(~1,500 lines src + ~1,800 lines tests). Email in, signed-cookie
session out. Magic-link round-trip + nothing else stored. The
library is opinionated about *not* sending non-auth email, *not*
storing plaintext identity, and *not* growing into a user-management
platform.

```
npm install knowless
```

Two integration paths:

1. **Library mode (v0.1.0):** `import { knowless } from 'knowless'` --
   mount five handlers on Express / Fastify / Hono / `node:http`
2. **Standalone server (v0.2.0, in development):** `npx knowless-server` --
   forward-auth gateway for Caddy / nginx / Traefik in front of
   no-auth services like Uptime Kuma, AdGuard, Pi-hole

This document is the dense reference. For the why, see
`docs/01-product/PRD.md`. For the wire formats, see
`docs/02-design/SPEC.md`. For an adopter walkthrough, see `GUIDE.md`.

## Which mode do I need?

| Mode | What it does | When to use |
|---|---|---|
| Library | Import + mount handlers on your existing Node app | You already run a Node service and want auth in front of it |
| Standalone (0.2.0) | `npx knowless-server` exposes /verify for forward-auth | Self-hosting Kuma / AdGuard / etc.; one auth subdomain, SSO across services |

## Minimal usage: library mode

```js
import express from 'express';
import { knowless } from 'knowless';

const app = express();
const auth = knowless({
  secret: process.env.KNOWLESS_SECRET,   // 64-char hex (32 bytes), required
  baseUrl: 'https://app.example.com',    // required
  from: 'auth@app.example.com',          // required
});

app.use(express.urlencoded({ extended: false }));
app.get('/login',          auth.loginForm);  // GET form, optional
app.post('/login',         auth.login);       // POST: triggers magic link
app.get('/auth/callback',  auth.callback);    // GET: redeems token, sets cookie
app.get('/verify',         auth.verify);      // GET: forward-auth check
app.post('/logout',        auth.logout);      // POST: clears session
app.listen(8080);
```

`auth.config` exposes the merged config (defaults + overrides) for
routing tables. `auth.deleteHandle(handle)` is GDPR right-to-erasure.
`auth.close()` shuts the sweeper and DB cleanly.

## All options

```js
const auth = knowless({
  // --- Required ---
  secret: '...',                      // 64-char hex; HMAC + cookie sig key
  baseUrl: 'https://app.example.com', // base for magic-link URL construction
  from: 'auth@app.example.com',       // sender address

  // --- Storage ---
  dbPath: './knowless.db',            // SQLite file; ':memory:' for tests

  // --- Cookie / session ---
  cookieDomain: 'app.example.com',    // default: hostname of baseUrl
  cookieName: 'knowless_session',     // default 'knowless_session'
  sessionTtlSeconds: 30 * 86400,      // 30 days

  // --- Token ---
  tokenTtlSeconds: 900,               // 15 min

  // --- Routing ---
  loginPath:  '/login',
  linkPath:   '/auth/callback',
  verifyPath: '/verify',
  logoutPath: '/logout',
  failureRedirect: null,              // null → loginPath

  // --- Mail / SMTP ---
  smtpHost: 'localhost',
  smtpPort: 25,
  subject: 'Sign in',                 // ASCII, ≤ 60 chars
  shamRecipient: 'null@knowless.invalid', // operator's MTA must discard this

  // --- Behavior ---
  openRegistration: false,            // first-email-wins handle creation
  includeLastLoginInEmail: true,      // append "Last sign-in: <ISO ts>" line
  confirmationMessage: 'Thanks. If <strong>{email}</strong>...',

  // --- Abuse defenses (FR-38..41) ---
  maxActiveTokensPerHandle: 5,        // 0 to disable
  maxLoginRequestsPerIpPerHour: 30,   // 0 to disable
  maxNewHandlesPerIpPerHour: 3,       // 0 to disable (open-reg only)
  honeypotFieldName: 'website',
  trustedProxies: ['127.0.0.1', '::1'],

  // --- Lifecycle ---
  sweepIntervalMs: 5 * 60 * 1000,     // periodic sweeper tick

  // --- Injection (tests / advanced) ---
  store: undefined,                   // bring your own store
  mailer: undefined,                  // bring your own mailer
  transportOverride: undefined,       // pass to nodemailer.createTransport
});
```

## Public API

`knowless(options)` returns:

| Method | Args | Returns | Notes |
|---|---|---|---|
| `login` | (req, res) | Promise\<void\> | POST handler: parses form, applies sham-work, sends magic link |
| `callback` | (req, res) | Promise\<void\> | GET handler: redeems `?t=<token>`, sets cookie, redirects to `next_url` or default |
| `verify` | (req, res) | void | GET handler (forward-auth): 200+`X-User-Handle` if cookie valid, else 401 |
| `logout` | (req, res) | Promise\<void\> | POST handler: clears session row + cookie |
| `loginForm` | (req, res) | void | GET handler: renders the hardcoded login HTML; preserves `?next=` |
| `deleteHandle` | (handle: string) | void | Atomic delete of handle + tokens + sessions (FR-37a, GDPR) |
| `config` | -- | object | Merged effective config; safe to read (do not mutate) |
| `close` | -- | void | Stops sweeper, closes mailer + store. Call on shutdown. |

Re-exports for advanced consumers:

```js
import {
  knowless,         // factory
  createStore,      // direct store access (admin scripts)
  createMailer,     // direct mailer access
  createHandlers,   // bring your own factory wiring
  composeBody,      // pure: build the mail body
  validateSubject,  // pure: validate operator-supplied subject
  renderLoginForm,  // pure: HTML5 page rendering
  normalize,        // pure: email normalization
  deriveHandle,     // pure: HMAC-SHA256(secret, email)
} from 'knowless';
```

## Handle / token / session lifecycles

```
       email                                    cookie
         |                                        |
         v                                        v
    normalize() ----> deriveHandle() -+   verifySessionSignature()
                                       |          |
                                       v          v
                                    handle    sid_b64u
                                       |          |
                                       v          v
                              [handles table]  [sessions table]
                                       |          |
                                       v          |
                                  issueToken()    |
                                       |          |
                                       v          |
                                   {raw, hash}    |
                                       |          |
                            +----------+          |
                            |                     |
                            v                     |
                       [tokens table] -- redeem ->+
                            |
                       sweep on
                       expiry/use
```

| Property | Default | Configurable | Notes |
|---|---|---|---|
| Token entropy | 256 bits | No | Floor, not target |
| Token TTL | 15 min | Yes | Single-use; expired ≡ replayed ≡ never-existed |
| Token at rest | SHA-256 hash | No | Raw never persisted |
| Session lifetime | 30 days | Yes | Server-enforced via stored expiry |
| Cookie format | `<sid_b64u>.<sig_hex>` | Name only | 108 chars total |
| Sweep interval | 5 min | Yes | Drops expired tokens, sessions, old rate-limit rows |

## The sham-work pattern (the thing that's special about knowless)

When an unregistered email submits to /login, the library does the
*same work* as a registered hit: derives the handle, looks it up,
inserts a token row (flagged `is_sham=1`), composes a mail, submits
it via SMTP. The difference: the mail's recipient is the configured
`shamRecipient` (default `null@knowless.invalid`) and your MTA's
`transport_maps` discards mail to that address.

Why: prevents email-enumeration via the login form. An attacker
submitting candidate emails cannot tell from response timing,
status, body, or "did the user receive a mail?" whether each
email is registered.

```
       POST /login (alice@registered.com)        POST /login (nobody@example.com)
                |                                            |
                v                                            v
        normalize → derive → exists                  normalize → derive → !exists
                |                                            |
                v                                            v
        issueToken (is_sham=0)                      issueToken (is_sham=1)
                |                                            |
                v                                            v
        compose mail to alice@registered.com        compose mail to null@knowless.invalid
                |                                            |
                v                                            v
        submit via SMTP                              submit via SMTP
                |                                            |
                v                                            v
        Postfix → delivers                          Postfix → discards (transport_maps)
                |                                            |
                v                                            v
        same 200 OK + same HTML body                same 200 OK + same HTML body
                                                          (timing within ~2μs)
```

The `is_sham=1` flag also makes sham tokens *un-redeemable*: even
if the discard misconfigured and a sham mail leaked, clicking
the link returns the same redirect as expired/replayed.

Operator setup for the null-route (Postfix):

```
# /etc/postfix/transport
knowless.invalid    discard:silently dropped by knowless null-route

# /etc/postfix/main.cf
transport_maps = hash:/etc/postfix/transport
```

```
postmap /etc/postfix/transport && systemctl reload postfix
```

## FR-6: timing equivalence (the testable property)

The library ships a CI test (`test/integration/timing.test.js`)
that asserts `|mean(hit_time) - mean(miss_time)| < 1ms` over 1000
interleaved iterations after a 200-iter warmup.

Local result on commodity hardware: `Δ_mean = 0.002ms` (500x under
the bar). The full sham-work pattern is achieving practically
perfect timing equivalence — better than the v0.11 POC measurement
of 260μs because production prepared statements and tighter
hot-path caching.

Why effect-size, not p-value: with N=10,000 and a Welch's t-test,
*any* constant offset above ~50μs registers as "statistically
significant" even though the offset is invisible across realistic
network jitter. The 1ms bar is what an attacker actually observes
through a connection. Detail in SPEC §14.

## Forward-auth `?next=` handling

When `/login` receives a `?next=<url>` form field (typical from
forward-auth proxies redirecting unauthenticated requests):

1. URL is validated against `cookieDomain` whitelist (host
   equals or `.endsWith` of the cookie domain). `https`/`http`
   only; `javascript:` etc. rejected.
2. Validated URL is stored on the token row as `next_url`.
3. On `/auth/callback` redemption, the redirect goes to
   `next_url` (or `baseUrl + '/'` if absent).

The magic link URL stays short (`?t=<43 chars>` only) — the bound
URL doesn't bloat it. Tamper-resistance comes from token opacity:
substituting a different `next_url` requires forging a token,
which requires the operator secret.

```
[unauth request to kuma.app.example.com]
        |
        v
[Caddy] -- 401 if no session cookie --> [redirect to auth.app.example.com/login?next=https://kuma.app.example.com/]
        |
        v
[user submits email; library binds next_url to token]
        |
        v
[email lands in inbox; user clicks magic link]
        |
        v
[GET /auth/callback?t=...]
        |
        v
[token redeemed, session created, cookie set on .app.example.com]
        |
        v
[302 Location: https://kuma.app.example.com/]
        |
        v
[Caddy verifies cookie via /verify, proxies to Uptime Kuma]
```

## Architecture

```
URL/email -> handlers.js (login: 12-step sham-work flow per SPEC §7.3)
          -> handle.js   (normalize ASCII-only, HMAC-SHA256)
          -> abuse.js    (per-IP rate limit, per-handle token cap, honeypot)
          -> token.js    (32 random bytes, base64url; SHA-256 at rest)
          -> store.js    (better-sqlite3, transactional, prepared statements)
          -> mailer.js   (raw RFC822 7bit; nodemailer for SMTP submission only)
          -> session.js  (HMAC-signed cookie with "sess\\0" domain tag)
          -> form.js     (hardcoded HTML5; no JS, no external resources)
          -> index.js    (factory + sweeper)
```

| Module | Lines | Purpose |
|---|---|---|
| `src/index.js` | ~140 | Public factory, sweeper, re-exports |
| `src/handlers.js` | ~310 | login (sham), callback, verify, logout, loginForm, validateNextUrl |
| `src/store.js` | ~210 | better-sqlite3 store; SPEC §13 interface |
| `src/mailer.js` | ~120 | RFC822 raw composition + nodemailer SMTP submission |
| `src/abuse.js` | ~95 | Source-IP determination, rate limits |
| `src/handle.js` | ~50 | Email normalization, handle derivation |
| `src/token.js` | ~40 | issueToken, hashToken |
| `src/session.js` | ~80 | Cookie signing/verification with constant-time compare |
| `src/form.js` | ~110 | Hardcoded login HTML |

## Threat model summary

**Defends well:** DB-only leaks (handles are HMAC-salted),
plaintext-email exfiltration (none persisted), password reuse
(no passwords), email enumeration via login form (timing
equivalent + same response shape), email-bombing (per-handle
cap), naive bot traffic (honeypot), high-volume floods (per-IP
cap), replay attacks (markTokenUsed atomic), open redirects
(`next_url` whitelist).

**Partial:** HMAC secret leak alone (allows targeted existence
checks but not session forgery), phishing (no password to
phish, but a phished mailbox still receives links).

**Does NOT defend against:** sophisticated bots that bypass the
honeypot, distributed floods, full server compromise,
compromised email accounts, social engineering, insider threat
at the operator. Layer-2 (Cloudflare / fail2ban / proxy
rate-limits) belongs above the library.

## Gotchas

1. **Closed-registration by default.** A handle must already
   exist before its email can request a link. Operators pre-seed
   via the re-exported `createStore` + `deriveHandle`, OR set
   `openRegistration: true`.

2. **Postfix on localhost is required.** No remote SMTP, no
   Mailgun / Postmark / SES. The localhost requirement is
   intentional (PRD §16.2): vendor mailers invite "while we're
   at it, let's send a welcome email," which contradicts the
   philosophy. If you can't run Postfix, knowless isn't your
   library.

3. **`shamRecipient` MUST be discarded by your MTA.** Default
   is `null@knowless.invalid`. If your MTA tries to deliver it,
   it'll bounce against an `.invalid` TLD that never resolves —
   noise in your mail logs, wasted DNS lookups. Add the
   `transport_maps` entry per Postfix snippet above.

4. **Cookie domain defaults to baseUrl's hostname.** This is the
   *narrow* default; for SSO across subdomains (forward-auth
   pattern), set `cookieDomain` to the parent eTLD+1 explicitly.
   The library does NOT compute eTLD+1 automatically (would
   require a public-suffix-list dep).

5. **`Secure` cookie attribute is non-negotiable.** All session
   cookies set `Secure`. HTTP-only origins won't receive them.
   Use HTTPS in production. Localhost development: use
   `--insecure-localhost-cookies` (not implemented yet — TASKS
   open question; works in Chrome with `--unsafely-treat-insecure-origin-as-secure`).

6. **Forward-auth needs the parent-domain cookie.** If your auth
   subdomain is `auth.example.com` and protected service is
   `kuma.example.com`, set `cookieDomain: 'example.com'` so the
   browser sends the cookie to both. Otherwise SSO doesn't work.

7. **Session cookies don't slide.** Each session has a fixed
   expiry (30 days default). User re-authenticates after expiry.
   Sliding sessions are SPEC §15 Q-3 (deferred to v0.2).

8. **Token replay is silent.** A second click on a magic link
   redirects to /login (same as expired/never-existed). Users
   sometimes double-click and wonder where they went. Mention
   this in your UX copy.

9. **Mail composition is a raw RFC822 string.** Nodemailer 8's
   default encoding picks base64 or QP for plain ASCII bodies,
   breaking the magic-link URL with QP soft-breaks (the v0.11
   POC finding). We sidestep by composing the message ourselves
   and using nodemailer only for SMTP. If you swap mailers, your
   replacement must handle this OR keep emitting raw RFC822.

10. **No JavaScript in any HTML page.** The login form, the
    confirmation page, error pages — all static HTML5. Works in
    text-mode browsers (Lynx, w3m). Operators wanting branding
    fork the project.

11. **Process cleanup matters.** `auth.close()` stops the
    sweeper and closes the SQLite handle. Without it, your
    process won't exit cleanly. The sweeper timer is `unref()`d
    so it won't *prevent* exit, but the SQLite handle held by
    `better-sqlite3` will leave a finalizer warning.

## Constraints

- **Node 20+** -- targeting LTS; tested on Node 22
- **Plain ES modules** -- no TypeScript source, no build step;
  ships JSDoc + (eventual) `.d.ts`
- **Two production deps** -- `nodemailer` (SMTP submission) and
  `better-sqlite3` (storage). No third dep without revisiting
  AGENT_RULES External Dependency Checklist.
- **Localhost MTA only** -- no remote SMTP, no vendor SDKs.
  Operators run their own Postfix / OpenSMTPD / Exim.
- **ASCII-only email addresses** in v0.1. IDN deferred to v0.2.
- **SQLite is the default store** -- swap-in stores must
  implement the SPEC §13 interface synchronously.
- **No telemetry of any kind.** No phone-home, no metrics
  endpoint, no analytics.
- **Walks away at v1.0.0.** Maintenance mode (security + bug
  fix) after that, by intent (PRD §6.3).
