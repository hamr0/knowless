# knowless -- Integration Guide

> For AI assistants and developers wiring knowless into a project.
> v1.0.0 (walk-away release) | Node.js >= 22.5 | 1 dep (nodemailer) | Apache-2.0

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

1. **Library mode:** `import { knowless } from 'knowless'` --
   mount five handlers on Express / Fastify / Hono / `node:http`,
   gate your endpoints with `auth.handleFromRequest(req)`.
2. **Standalone server:** `npx knowless-server` -- forward-auth
   gateway for Caddy / nginx / Traefik in front of no-auth services
   like Uptime Kuma, AdGuard, Pi-hole. Configured via `KNOWLESS_*`
   env vars; see [`OPS.md`](OPS.md) for the full deployment guide.

This document is the dense reference. For the why, see
`docs/01-product/PRD.md`. For the wire formats, see
`docs/02-design/SPEC.md`. For an adopter walkthrough, see `GUIDE.md`.

## What knowless is and is not

Knowless is the substrate for **session-bearing logins**: prove control
of an email, get a session cookie, do work under that session. The mint
path is single-use, short-TTL, and exists to bootstrap the cookie — not
as a generic confirmation primitive.

If you need ad-hoc one-shot confirmation tokens with caller-chosen TTLs
(event activation that may sit in an inbox over a weekend, email-change
confirmation, magic-action links that aren't logins), **keep your own
token system for that step** and use knowless for the session that
follows. The walk-away release intentionally does not grow toward generic
token issuance — that's a different library with a different threat
model.

See § "What's NOT in knowless, and why" for the full lens.

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
  from: 'auth@app.example.com',       // bare RFC 5321 sender (envelope MAIL FROM
                                      //   AND default From: header value)

  // --- Optional sender display name (AF-27, v0.2.3) ---
  fromName: 'addypin',                // optional. When set, From: header is
                                      //   `<fromName> <from>` (e.g. `addypin
                                      //   <noreply@addypin.com>`); envelope.from
                                      //   stays bare. Validated at startup:
                                      //   ASCII, ≤60 chars, no CR/LF, no <>".

  // --- Storage ---
  dbPath: './knowless.db',            // SQLite file; ':memory:' for tests

  // --- Cookie / session ---
  cookieDomain: 'app.example.com',    // default: hostname of baseUrl
  cookieName: 'knowless_session',     // default 'knowless_session'
  cookieSecure: true,                 // default true; "false" only for localhost dev
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
  confirmationMessage: 'Thanks. If {email} is registered, a link is on its way.',
  // ^ NOTE: the message is HTML-escaped before render (AF-6.5).
  //         {email} placeholder still works. For HTML, pre-render upstream.

  // Operator footer on magic-link mail (AF-8.2). ASCII-only, ≤240
  // chars, ≤4 lines, NO URLs (would conflict with the magic-link line).
  // Validated at factory startup. Use | or - as separators (NOT · which
  // is non-ASCII).
  bodyFooter: 'feedback@example.com | privacy first',

  // --- Abuse defenses (FR-38..41) ---
  maxActiveTokensPerHandle: 5,        // 0 to disable
  maxLoginRequestsPerIpPerHour: 30,   // 0 to disable
  maxNewHandlesPerIpPerHour: 3,       // 0 to disable (open-reg only)
  honeypotFieldName: 'website',
  // Plain IPs and/or CIDR ranges (AF-6.3). Useful for k8s/docker/cgnat.
  trustedProxies: ['127.0.0.1', '::1', '10.0.0.0/8'],

  // --- Lifecycle ---
  sweepIntervalMs: 5 * 60 * 1000,     // periodic sweeper tick
  onSweepError: (err) => { /* alerting hook; errors are swallowed */ },

  // --- Operator visibility (v0.2.1, all opt-in) ---
  // Per-event hooks. Errors swallowed (matches onSweepError contract).
  onMailerSubmit:     ({messageId, handle, timestamp}) => { /* */ },
  onTransportFailure: ({error, timestamp})              => { /* */ },
  // Heartbeat aggregate. Default 60s; emits even when both counters
  // are zero. See "Operator visibility" section for the threat-model
  // reasoning behind aggregating sham + rate-limit branches here
  // rather than emitting per-event.
  onSuppressionWindow: ({sham, rateLimited, windowMs}) => { /* */ },
  suppressionWindowMs: 60_000,

  // --- Dev mode (AF-6.2) ---
  // When SMTP submission fails AND this flag is true, the magic link
  // is printed to stderr so a developer can click through. Off by
  // default. Never fires for sham (silent-miss) submissions.
  devLogMagicLinks: false,

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
| `handleFromRequest` | (req) | string \| null | Programmatic session resolver for in-process middleware. Returns the handle if the cookie is valid, else null. SPEC §9.4. |
| `deleteHandle` | (handle: string) | void | Atomic delete of handle + tokens + sessions (FR-37a, GDPR) |
| `revokeSessions` | (handle: string) | number | Drops every session for `handle` without deleting the account ("log out everywhere"). Returns rows removed. AF-6.1. |
| `startLogin` | ({email, nextUrl?, sourceIp?, subjectOverride?, bodyOverride?, bypassRateLimit?}) | Promise\<{handle, submitted: true}\> | Programmatic magic-link send for "use first, claim later" flows. Same 12-step sham-work as form. `subjectOverride` (AF-9) replaces `cfg.subject` per call. `bodyOverride` (AF-26, v0.2.2) is a `({url}) => string` template fn that replaces the default body — knowless still composes the URL and validates the rendered output (ASCII, URL on its own line, ≤2048 chars); `bodyFooter` still appends. `bypassRateLimit: true` (AF-10) opts trusted server-side callers (CLI, cron, worker) out of IP-rate-limit accounting. SPEC §7.3a. AF-7.3. |
| `deriveHandle` | (email: string) | string | `HMAC-SHA256(secret, normalize(email))` using the configured secret. Normalizes input (lowercase + trim) so `Alice@X.com` and `alice@x.com` produce the same handle. Match what `startLogin` and `POST /login` compute. AF-7.4 / AF-13. |
| `_sweep` | -- | void | Trigger one sweep tick on demand (tests, operator scripts). AF-5.3. |
| `verifyTransport` | -- | Promise\<true\> | Probe the configured SMTP transport (v0.2.1). Resolves true on success, rejects with the underlying error. Adopters call this explicitly when they want fail-fast on misconfigured SMTP at boot — no auto-on-boot variant by design (k8s readiness probes / docker-compose ordering would fail boot for the wrong reason). AF-20. |
| `config` | -- | object | Merged effective config; safe to read (do not mutate) |
| `close` | -- | void | Stops sweeper, closes mailer + store. Call on shutdown. |

### Post-callback handle resolution

There is no callback hook fired by knowless on confirmation. The host's
`nextUrl` route is the seam. Read the handle there:

```js
// In your post-callback landing route:
const handle = auth.handleFromRequest(req);
if (!handle) return res.writeHead(401).end();
// Now do host-side work keyed by handle.
```

This is deliberate: the host knows what "successful login means for me";
knowless does not. Both `auth.login` (form) and `auth.startLogin`
(programmatic) land here after the link is clicked — the post-callback
route is the single seam for all login modes.

Re-exports for advanced consumers:

```js
import {
  knowless,            // factory
  dropShamRecipient,   // pure: sham-address predicate for custom mailers
  createStore,         // direct store access (admin scripts)
  createMailer,        // direct mailer access
  createHandlers,      // bring your own factory wiring
  composeBody,         // pure: build the mail body
  validateSubject,     // pure: validate operator-supplied subject
  validateBodyFooter,  // pure: validate operator-supplied footer (AF-8.2)
  validateBodyOverride, // pure: validate per-call body override (AF-26)
  validateFromName,    // pure: validate operator-supplied From: display name (AF-27)
  renderLoginForm,     // pure: HTML5 page rendering
  normalize,           // pure: email normalization
  deriveHandle,        // pure: HMAC-SHA256(hex-decoded secret, email)
  secretBytes,         // pure: coerce hex string → 32-byte HMAC key
} from 'knowless';
```

## Operator visibility (v0.2.1)

Three event hooks + one opt-in method, shipped in v0.2.1. Future
contributors reading this section before extending the surface: do not
add a per-event `onShamHit`, do not add a per-handle `onRateLimitHit`,
do not add an auto-on-boot probe, do not add a `lookupMessageId()`
endpoint. Each was considered and deliberately rejected during the
forum + addypin negotiation that produced this surface (PRD §17.3,
v0.2.1) — see "What's NOT in knowless" below for the reasoning.

### Three hooks (factory options)

```js
const auth = knowless({
  // ...required + existing options...

  // Per-event, safe to log per-call.
  onMailerSubmit:     ({messageId, handle, timestamp}) => { /* */ },
  onTransportFailure: ({error, timestamp})              => { /* */ },

  // Batched aggregate. Fires every windowMs regardless of count
  // (heartbeat). Default cadence 60s.
  onSuppressionWindow: ({sham, rateLimited, windowMs}) => { /* */ },
  suppressionWindowMs: 60_000,
});
```

Field types:
- `messageId`: string — SMTP `Message-ID` returned by nodemailer
- `handle`: string — 64-char hex; only emitted on real (non-sham) submits
- `timestamp`: number — epoch ms
- `error`: Error
- `sham`, `rateLimited`: integer counters, count within the window
- `windowMs`: integer — the configured window length, echoed in the payload

Errors thrown from hooks are caught and swallowed (matches the existing
`onSweepError` contract); knowless does not depend on hook delivery for
correctness.

### Method

`auth.verifyTransport()` — wraps `transport.verify()` on the configured
SMTP transport. Returns `Promise<true>` on success, rejects with the
underlying error. Adopters call this explicitly when they want fail-fast
on misconfigured SMTP at boot. **No auto-on-boot variant** by design:
deployments where knowless starts before Postfix (docker-compose
ordering, k8s readiness probes) would fail boot for the wrong reason.

### Threat-model justification (the durable part)

The two silent-202 branches — sham (handle does not exist) and rate-limit
(any of the three caps) — are aggregated rather than per-event because
**NFR-10 timing equivalence applies at the log layer too**, not just the
HTTP response. A per-event `onShamHit({handle})` lets a careless adopter
log "sham detected for X" and the log file becomes an enumeration oracle
— the exact thing sham-work was designed to prevent. The response is
silent; the log must be silent too.

Knowless has three rate limits, and one of them is identity-tied:
- `maxLoginRequestsPerIpPerHour` — IP-keyed
- `maxNewHandlesPerIpPerHour` — IP-keyed
- `maxActiveTokensPerHandle` — **handle-keyed; per-event hits leak
  "this handle exists and has hit a token cap"**

Splitting per-event-IP from per-event-handle works in theory and fails
in practice — future contributor sees the asymmetry and adds the missing
handle variant for symmetry. Bundling all three into the windowed
aggregate forecloses that drift.

`onMailerSubmit` carries `handle` per-event because it fires *only on
real submissions*, where the handle was already disclosed to knowless
by the form input. Emitting it back to the adopter is not a new leak.
`onTransportFailure` carries no identity data, per-event safe.

### Why no `lookupMessageId()` endpoint

An earlier proposal added an authenticated `auth.lookupMessageId(id)`
behind an operator secret so operators could correlate maillog entries
to handles. Rejected: the same capability is achievable by the adopter
maintaining their own `(messageId → handle)` map, populated from
`onMailerSubmit`. Knowless never stores the mapping, never exposes a
new authenticated surface, never carries operator-secret rotation
burden. The hook is the mechanism; the correlation map is adopter
choice.

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

Verify the null-route is actually discarding (one-line operator
check, no knowless code involved):

```
swaks --to null@knowless.invalid --server localhost:25 --quit-after RCPT
journalctl -u postfix --since '1 minute ago' | grep 'discard'
```

A `discard:` line in the postfix log confirms the null-route caught
the message. If you see `relay=` or `delivered`, the
`transport_maps` entry isn't being applied — re-run `postmap` and
`systemctl reload postfix`. (No `--check-null-route` CLI in
knowless: an operator's MTA validation lives with the MTA, not
inside a walk-away library.)

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

## Custom mailer contract

When you inject `options.mailer`, knowless hands off five obligations.
The default localhost-SMTP mailer satisfies them all; custom mailers
must satisfy them deliberately.

**1. Sham-recipient handling.** Knowless addresses sham sends (FR-6
timing-equivalence sends for missed handles, rate-limit hits,
exempt-handle short-circuits) to `shamRecipient` (default
`null@knowless.invalid`). Custom mailers MUST drop these without
external delivery. Use the exported helper:

```js
import { dropShamRecipient } from 'knowless';

async function send(envelope, raw) {
  if (dropShamRecipient(envelope)) return; // no wire send, no error
  // ...actually deliver raw
}
```

Forgetting this lets sham mail bounce, distinguishing miss from hit on
the wire and reopening the enumeration oracle that FR-6 closes. If you
configured a custom `shamRecipient`, pass it as the second argument:
`dropShamRecipient(envelope, cfg.shamRecipient)`.

**2. Timing equivalence (≤1ms).** Real-vs-sham wire-time difference
must stay within ≤1ms, measured from the start of the mailer's
`send(envelope, raw)` call to its returned promise's resolution. The
host knows its transport's jitter; the library cannot equalise around an
opaque mailer. Mailers spawning a subprocess per send (e.g. `sendmail`
pipe) MUST self-equalise: pre-warm the subprocess,
parallel-spawn-then-discard, or measure-and-pad. See FR-6 above for
why the bar matters.

**3. RFC822 fidelity.** Ship the body knowless composes byte-for-byte.
No quoted-printable re-encoding, no header rewriting (other than
envelope routing your transport requires), no soft-break wrapping, no
charset transcoding. See gotcha #9.

**4. `verify()` semantics.** Optional. If present, knowless calls it
once at factory construction (synchronously awaited before `knowless()`
resolves). Throwing aborts startup; resolving with any value is success.
Knowless does not call `verify()` again on a per-send basis. Hosts
whose transports can fail-after-warm-up should monitor independently.

**5. `close()` lifecycle.** Optional. Knowless does not call it on
normal operation. Hosts that wire it up are responsible for calling it
on their own shutdown path. Knowless guarantees `close()` is safe to
call multiple times after the auth instance has stopped issuing sends.

## Architecture

```
URL/email -> handlers.js (login: 12-step sham-work flow per SPEC §7.3)
          -> handle.js   (normalize ASCII-only, HMAC-SHA256)
          -> abuse.js    (per-IP rate limit, per-handle token cap, honeypot)
          -> token.js    (32 random bytes, base64url; SHA-256 at rest)
          -> store.js    (node:sqlite, transactional, prepared statements)
          -> mailer.js   (raw RFC822 7bit; nodemailer for SMTP submission only)
          -> session.js  (HMAC-signed cookie with "sess\\0" domain tag)
          -> form.js     (hardcoded HTML5; no JS, no external resources)
          -> index.js    (factory + sweeper)
```

| Module | Lines | Purpose |
|---|---|---|
| `src/index.js` | ~140 | Public factory, sweeper, re-exports |
| `src/handlers.js` | ~310 | login (sham), callback, verify, logout, loginForm, validateNextUrl |
| `src/store.js` | ~240 | node:sqlite store + transaction adapter; SPEC §13 interface |
| `src/mailer.js` | ~120 | RFC822 raw composition + nodemailer SMTP submission |
| `src/abuse.js` | ~95 | Source-IP determination, rate limits |
| `src/handle.js` | ~50 | Email normalization, handle derivation |
| `src/token.js` | ~40 | issueToken, hashToken |
| `src/session.js` | ~80 | Cookie signing/verification with constant-time compare |
| `src/form.js` | ~110 | Hardcoded login HTML |

## What's NOT in knowless, and why

Three capabilities that look like they belong here but don't, listed
because the "why not" needs to outlast walk-away-at-v1.0.0. When future
contributors propose adding any of these back, point them here.

### Disposable-domain blocking — adopter / form handler

Reject `mailinator.com` etc. before knowless sees the submission.
Mechanism + list + override + weekly cron all live in the adopter's
form handler.

The argument for putting this in knowless was timing equivalence: if
the adopter rejects fast, an attacker times the response and learns
"this domain is on a public blocklist." Counter: the blocklist is a
public GitHub repo (`disposable-email-domains/disposable-email-domains`).
Anyone can fetch it directly. Timing-equivalence here protects information
that isn't secret. Knowless's sham-work protects against email
*enumeration* (is `alice@x.com` registered?), not domain *classification*
(is `x.com` on a public list?). Different threat, different defense.

Splitting mechanism (knowless) from policy + list curation (adopter) is
the wrong seam. Both stay in the adopter's form handler.

### App-tenure / account-age — adopter / first-seen tracking

Knowless's "handle creation date" is when this email first hit knowless.
The adopter's interesting question is "how long has this user been
participating in *my app*" — a different number, and the adopter's
number is the one that should drive trust decisions.

Concrete failure mode: a handle registered with knowless six months ago
but never posted has zero app-tenure. If the adopter reads knowless's
age, a brand-new spammer with an old handle gets unearned credibility.

Pattern: adopter stores `(handle, first_seen_at)` the first time it sees
a handle perform a meaningful action. App-tenure is app-derived. Knowless
doesn't expose age data — and wouldn't even if it could, because
returning `Date | null` keyed by handle is itself an enumeration leak.

### Per-IP hashcash / proof-of-work — Caddy / perimeter layer

`maxNewHandlesPerIpPerHour: 3` already covers the ground hashcash would
cover. A botnet that can't get past three signups per IP per hour needs
IP rotation regardless; once rotated, a 2s hashcash is rounding error
at botnet economics. Costs are real: breaks Lynx/w3m (gotcha #10),
requires JS in the login form (the only zero-JS exception we'd carry),
~2s UX delay for legit users on weak devices. If a deployment observes
per-IP signup actually saturating the cap, Caddy (or another perimeter
layer) can run hashcash off-the-shelf without making knowless carry it.

### The deciding lens

knowless walks away at v1.0.0 (PRD §6.3). Every config option carried
into v1.0.0 is something v1.x has to keep stable through the
maintenance window. The test for any proposed addition: does this
belong in the **identity layer** (who they are) or the **behavior
layer** (what they did)? Identity layer is in scope. Behavior layer is
out. When unsure, default out — less surface, less carrying cost.

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

3. **`shamRecipient` MUST be discarded without external delivery.**
   Default is `null@knowless.invalid`. With the default
   localhost-SMTP mailer, add the `transport_maps` entry per Postfix
   snippet above. With a custom injected mailer, call
   `dropShamRecipient(envelope)` and no-op the send; forgetting this
   bounces sham mail and reopens the enumeration oracle. See §
   "Custom mailer contract".

4. **Cookie domain defaults to baseUrl's hostname.** This is the
   *narrow* default; for SSO across subdomains (forward-auth
   pattern), set `cookieDomain` to the parent eTLD+1 explicitly.
   The library does NOT compute eTLD+1 automatically (would
   require a public-suffix-list dep).

5. **`Secure` cookie attribute toggles via `cookieSecure`.** Default
   is `true`. Set `cookieSecure: false` ONLY for `http://localhost`
   development; the library logs a stderr warning at startup (AF-4.4).
   Production deployments MUST use HTTPS and leave `cookieSecure: true`.

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
   and using nodemailer only for SMTP. If you inject a custom
   mailer, ship the body byte-for-byte — no QP re-encoding, no
   soft-break wrapping, no charset transcoding. See § "Custom
   mailer contract" obligation 3.

10. **No JavaScript in any HTML page.** The login form, the
    confirmation page, error pages — all static HTML5. Works in
    text-mode browsers (Lynx, w3m). Operators wanting branding
    fork the project — **or, more commonly, skip mounting
    `auth.loginForm` and serve their own `GET /login`**. The
    fallback is intentionally a contract-minimal renderer, not a
    UI to ship. `/login` is also where every silent-miss failure
    redirects (used / expired / sham / malformed token), so it
    deserves first-class chrome in the host app. See GUIDE.md
    § "Branding the GET /login page".

11. **Process cleanup matters.** `auth.close()` stops the
    sweeper and closes the SQLite handle. Without it, your
    process won't exit cleanly. The sweeper timer is `unref()`d
    so it won't *prevent* exit, but the SQLite handle held by
    `node:sqlite` will leave a finalizer warning.

12. **CSRF defense is the Origin/Referer whitelist, not a token.**
    Modern browsers always emit `Origin` on cross-origin POSTs;
    knowless validates host against `cookieDomain` on POST /login
    AND POST /logout. Browser-absent (curl / programmatic) is
    allowed. **Do NOT add a CSRF token upstream** — the Origin
    check is the defense. SPEC §7.3 Step 0.

13. **`confirmationMessage` is plain text + `{email}` placeholder.**
    The whole message is HTML-escaped before render (AF-6.5). If
    you want bold/italic/links in the confirmation copy, pre-render
    the HTML upstream and pass the escaped string — but understand
    you're then responsible for not interpolating user data.

14. **`devLogMagicLinks` is opt-in and dev-only.** When set true
    AND SMTP submission fails, the magic link is printed to stderr
    tagged `[knowless dev:<from>]`. Sham (silent-miss) submissions
    print a `silent-miss: ...` hint instead of a link — opt-in dev
    only, since this leaks closed-reg state. Don't enable in
    production.

15. **POST /login: don't pre-parse the body.** knowless reads the
    request stream itself. Any framework body parser mounted in
    front of `auth.login` will silently steal the form data and
    null-route the request. knowless emits a one-time
    `console.warn` if it sees `Content-Length > 0` with an empty
    body. AF-7.1.

16. **Two adoption modes — "sign in, then do" (Mode B) and "do
    then confirm by email" (Mode A).** Mode B is the form
    (`auth.login`). Mode A is `auth.startLogin({email, nextUrl,
    sourceIp})` for "drop a pin, claim by email click" patterns.
    Both run the identical 12-step sham-work flow; same FR-6
    guarantee. Pick per-action, not per-app.

17. **Secret is hex-decoded (AF-8.1, since v0.1.6).** Pass a
    64-char lowercase hex string; knowless decodes to 32 raw bytes
    before HMAC. If you're upgrading from 0.1.5 or earlier, all
    handles and session signatures change — re-seed handles, expect
    one user-visible logout. `Buffer` accepted directly for adopters
    who hold raw 32-byte keys.

18. **`bodyFooter` constraints (AF-8.2).** ASCII only — `·` is NOT
    ASCII, use `|` or `-`. ≤ 240 chars, ≤ 4 lines (a single trailing
    newline is allowed and not counted as an extra line), no
    `http(s)://` URLs (would conflict with the magic-link line).
    Validated at factory startup; fails fast. Goes after RFC 3676
    `"-- "` delimiter so mail clients strip it from quoted replies.

19. **`startLogin` is silent at every layer (FR-6).** Returns
    `{handle, submitted: true}` for *every* branch — real send, sham,
    rate-limited, missing-handle-with-`openRegistration:false`. Adopters
    cannot derive the branch from the return value, by design.
    Operator visibility comes from the v0.2.1 hooks (`onMailerSubmit`
    per-event, `onSuppressionWindow` aggregated) — *not* from the
    return shape. Don't wrap `startLogin` in something that surfaces
    the branch to the caller; that re-opens the enumeration oracle.

## Constraints

- **Node 20+** -- targeting LTS; tested on Node 22
- **Plain ES modules** -- no TypeScript source, no build step;
  ships JSDoc + (eventual) `.d.ts`
- **One production dep** -- `nodemailer` (SMTP submission). Storage
  uses `node:sqlite` (stdlib, no native compile). No second runtime
  dep without revisiting
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
