# knowless — Adopter Guide

> The "is this for me, and how do I wire it up" doc. For the dense
> AI-agent reference, see [`knowless.context.md`](knowless.context.md).
> For the product philosophy, see
> [`docs/01-product/PRD.md`](docs/01-product/PRD.md).

## Read this first: knowless walks away at v1.0.0

knowless commits to a small, audit-able surface and a *closed* feature
list. v1.0.0 is the **terminal release** for new functionality: only
security fixes ship after that. There will be no v2.0 with sessions+,
no plugin system, no second mailer, no SaaS counterpart.

What this means for you as an adopter:

- **You own integration breadth.** If knowless's defaults don't fit
  exactly, you patch around it (the API is small enough to do this) or
  fork it (Apache 2.0). We won't add a config knob to absorb your
  case.
- **You can pin and forget.** v1.0.0 will work the same way three
  years later. Security patches will land in v1.x.
- **Procurement signal.** A library that has explicitly committed to
  *not growing* is a different risk profile from a typical OSS
  package. Most reviews assume "still actively developed" is good;
  for an auth dependency, "still actively developed" is also "still
  changing in ways you'll have to track." knowless inverts that.

If you need a kitchen-sink auth library with active feature
development, this isn't the right tool. See
[Lucia](https://lucia-auth.com/), [Auth.js](https://authjs.dev/),
or commercial offerings.

## Who this is for

Three audiences, in order of fit:

### 1. In-app services where auth is the only legitimate email need

You're building something where users log in, do their work in the
app, leave. Email is purely the door opener — once they're in, the
app delivers value through its UI.

Good fits:
- Web apps and SaaS dashboards (occasional login, work in-app)
- Indie tools and side projects with infrequent users
- Small-business B2B internal tools (HR portals, ops dashboards)
- Member areas, paywalled forums, community sites
- Self-hosted apps your team uses

The disqualifier isn't service type — it's **email needs**. If you
genuinely need to send order confirmations, subscription renewals,
billing notifications, calendar invites, or any digest /
newsletter, knowless is the wrong choice. Use a vendor with
deliverability as their core business (Postmark, SES, Mailgun).

### 2. Self-hosters gating services without good native auth

You're running Uptime Kuma, AdGuard Home, Pi-hole, Sonarr, Jellyfin,
n8n, Homepage, Heimdall, Portainer, Paperless-ngx — and their
built-in auth is either missing or weak. The existing alternatives
(Authelia, Authentik, Keycloak, oauth2-proxy) are heavyweight for
the job: "redirect to login if no cookie, otherwise let through."

knowless's standalone server (`bin/knowless-server`, shipped in
v0.1.3) sits behind Caddy / nginx / Traefik via forward-auth. One auth subdomain, one
session cookie scoped to the parent eTLD+1, SSO across all your
services for free.

### 3. Privacy-skeptical developers building for clients

Small businesses, non-profits, EU operators, healthcare-adjacent,
legal, education. Where the privacy story is part of the sale.
knowless gives you a clean, defensible answer to "what data do you
store about your users?": *an opaque salted hash of their email,
nothing else*.

## Who this isn't for

- Apps that need to send any email beyond the sign-in link (order
  confirmations, billing, reminders, digests, newsletters,
  calendar invites)
- Apps that need OAuth / OIDC / SAML / federated identity
- Apps that need integrated 2FA / WebAuthn / TOTP (compose
  separately if needed)
- Teams without VPS ops capability — running your own Postfix is
  real work
- Anything where email deliverability problems would be
  catastrophic

## What knowless commits to (so you know what you're getting)

- **Plaintext email is never persisted.** It's salted-hashed
  (`HMAC-SHA256(secret, normalized_email)`) on the way in and
  discarded.
- **Only the magic link is ever sent.** No welcome email. No
  digest. No notification. The library has no API to send anything
  else.
- **All outbound mail goes via your localhost MTA.** No Postmark.
  No SES. No vendor credentials.
- **The login flow is timing-equivalent** between registered and
  unregistered emails — practical-effect-size delta under 1ms,
  measured by a CI test.
- **The library is self-contained.** Two npm deps. No build step.
  Plain ES modules with JSDoc.
- **Walks away at v1.0.0.** Maintenance mode (security patches +
  bug fixes) after that, by design.

### Stability commitments under walk-away

v1.x will accept:
- Documentation corrections and clarifications.
- Helper exports that pull existing mechanism back into the library
  (where adopters were re-implementing it inline).
- Bug fixes that don't change the API surface.
- Security fixes (CVEs in `nodemailer` or `node:sqlite` with
  user-visible impact).

v1.x will NOT accept:
- New flows, new methods on the auth instance, new constructor options.
- Generalisations toward token-issuance frameworks (see
  [`knowless.context.md`](knowless.context.md) § "What knowless is and
  is not").
- Per-adopter ergonomic shortcuts that the host can implement in ≤30
  LOC against the existing API.

The library being closed is a feature. Forks are encouraged for
requirements that don't fit.

## Walkthrough: library mode

The shape: import `knowless`, configure it, mount the handlers on
your HTTP framework.

### Step 1: Install

```
npm install knowless
```

Requires Node.js 20+ (LTS until April 2026).

### Step 2: Generate the secret

The HMAC secret is the keystone of the privacy model. It must be
≥32 random bytes (≥64 hex chars).

```
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Store it in your env vars / secret manager. **Never** commit it.
Rotating the secret invalidates every existing handle and session
— it's a one-way switch.

### Step 3: Set up Postfix on localhost

knowless submits SMTP to `localhost:25`. You need a localhost MTA.

On Ubuntu / Debian:
```
sudo apt install postfix
# Pick "Internet Site" when prompted
# System mail name: your sending domain (e.g. app.example.com)
```

Add the **null-route** for sham mail (this is the destination
knowless uses on silent-miss to keep timing equivalence without
delivering unsolicited mail to unregistered addresses):

```
# /etc/postfix/transport
knowless.invalid    discard:silently dropped by knowless null-route
```

```
# /etc/postfix/main.cf — add this line
transport_maps = hash:/etc/postfix/transport
```

```
sudo postmap /etc/postfix/transport
sudo systemctl reload postfix
```

**Verify the null-route is catching mail.** A misconfigured
null-route doesn't surface until the first sham submission — by
which point you're debugging a silent-202 from a real form post.
One-line check, no knowless code needed:

```
sudo apt install swaks   # one-time, if not present
swaks --to null@knowless.invalid --server localhost:25 --quit-after RCPT
sudo journalctl -u postfix --since '1 minute ago' | grep -i 'discard'
```

A `discard:` line in the postfix log confirms `transport_maps` is
applied. If you see `relay=` / `delivered` / a queue ID with no
discard, re-run `postmap` + `systemctl reload postfix` and try
again. (knowless deliberately does NOT ship a `--check-null-route`
CLI for this — operator MTA validation is operator-side, and adding
a wrapper for a one-line `swaks` invocation would carry maintenance
burden into the v1.0.0 walk-away window for no real value.)

Then the DNS records — set on your sending domain, **not** your
app's primary domain (typical setup: `auth.example.com` is the
sending domain):

- **SPF**: `v=spf1 ip4:<your-server-ip> -all`
- **DKIM**: generate via `opendkim-genkey` and publish the public
  key as a TXT record
- **PTR (reverse DNS)**: ask your VPS provider to set the PTR for
  your IP to your sending hostname

Without all three, Gmail / Outlook will silently drop your auth
mail. This is the operator commitment knowless asks of you.

> Full Postfix walkthrough lives in [`OPS.md`](OPS.md) — Postfix
> install, null-route, SPF/DKIM/PTR, systemd, reverse-proxy
> forward-auth examples, multi-process deployments.

### Step 4: Mount the handlers

Express:
```js
import express from 'express';
import { knowless } from 'knowless';

const app = express();
const auth = knowless({
  secret: process.env.KNOWLESS_SECRET,
  baseUrl: 'https://app.example.com',
  from: 'auth@app.example.com',
});

app.use(express.urlencoded({ extended: false }));
app.get('/login',          auth.loginForm);
app.post('/login',         auth.login);
app.get('/auth/callback',  auth.callback);
app.get('/verify',         auth.verify);
app.post('/logout',        auth.logout);

app.listen(8080);
```

Fastify, Hono, `node:http` — all work. Each handler is a plain
`(req, res) => Promise<void>` function. No framework hooks, no
middleware injection.

#### Trap: do NOT pre-parse the body

knowless reads `POST /login`'s body itself. If a body parser
middleware runs ahead of `auth.login` and consumes the stream,
knowless sees an empty body and silently null-routes the request
(as if no email was submitted). Symptoms: form posts return 200,
no magic link arrives, no error logged.

Express works in the example above because `express.urlencoded()`
is mounted as application middleware but doesn't intercept the
specific path. **On Hono / Fastify-without-body-plugin / raw
node:http, mount `auth.login` directly with no body parser in
front.** Same goes for `auth.logout` (it doesn't read a body, but
keep the symmetry).

knowless will emit a one-time `console.warn(...)` if it sees an
empty body where `Content-Length > 0` — that's the canary for this
bug.

#### Trap: non-browser callers need an Origin header

`POST /login` runs an Origin/Referer whitelist (CSRF defense, see
the FAQ below). Browsers always send `Origin` on cross-origin
POSTs, so the form path is fine. **Curl / scripts / server-to-
server callers must send no Origin header at all** (knowless
allows browser-absent requests) **or** an Origin matching your
`cookieDomain`. If you set a foreign Origin, the request silently
falls through to a sham send. For programmatic callers, prefer
[`auth.startLogin()`](#mode-a-use-first-claim-later) over POSTing
the form.

### Two adoption modes (Mode A vs Mode B)

In plain English: **"sign in, then do the thing"** (Mode B) and
**"do the thing, confirm by email"** (Mode A). knowless supports
both out of the box; pick per-action, not per-app — they coexist.
The Mode A/B labels are used here and in the CHANGELOG so
discussions across the docs stay unambiguous.

> ⚠ **Stop before you build a parallel activation system.** If
> you're considering writing pending rows to a custom tokens table,
> minting your own confirmation links, or calling into the sessions
> table directly to mark an account "activated by email" — that is
> Mode A, and it's already in this library. Use
> `auth.startLogin({ email, subjectOverride, bodyOverride })` and
> promote your pending resource in the callback handler. The
> wrong-shape integration is what every adopter has tried first; the
> right shape is the worked example below.

The wrong shape vs Mode A, side by side:

```
WRONG SHAPE                         MODE A (use auth.startLogin)
─────────────────────────────       ─────────────────────────────
your_tokens table                   (none — knowless owns the token)
your custom email composer          subjectOverride + bodyOverride
your /confirm/:token handler        auth.callback (already mounted)
manual session insert               handled by callback
your duplicate rate-limit code      knowless rate-limit applies
                                    sham-work + timing equivalence
                                    preserved automatically
```

**Mode B — "sign in, then do the thing" (register-first, the default, `auth.login`).**
User must log in before performing the action. Wire `auth.login` /
`auth.callback` as above; gate your action with
`auth.handleFromRequest(req)`. Use when the action requires a session
(account settings, paid features, anything you want tied to an
identity at the moment of the action).

```js
app.post('/api/comments', (req, res) => {
  const handle = auth.handleFromRequest(req);
  if (!handle) return res.status(401).end();
  // create comment owned by `handle`
});
```

**Mode A — "do the thing, confirm by email" (use-first, claim-later, `auth.startLogin`).**
User performs the action without logging in; you capture their email
and trigger a magic link. Clicking it opens a session and your
callback handler "promotes" the deferred resource. Use for "drop a
pin," "post a share link," "submit a paste" — patterns where forcing
a login *before* the action would harm the UX.

```js
app.post('/api/pins', async (req, res) => {
  const { email, lat, lng } = await readJsonBody(req);
  const owner = auth.deriveHandle(email);          // AF-7.4
  const shortcode = await db.insertPendingPin({ owner, lat, lng });
  await auth.startLogin({                          // AF-7.3
    email,
    nextUrl: 'https://app.example.com/manage',
    sourceIp: req.socket.remoteAddress,
    // Per-call subject so the user can tell at a glance this is a
    // pin-confirmation, not a routine login. AF-9.
    subjectOverride: `Confirm your pin: ${shortcode}`,
    // Per-call body so subject and body agree. AF-26 (v0.2.2).
    // knowless still composes the URL and validates the rendered
    // output (ASCII / URL on its own line / ≤2048 chars). bodyFooter
    // still appends; the lastLogin line does NOT auto-append on
    // overridden bodies — the template owns the content.
    bodyOverride: ({ url }) =>
      `Confirm your pin "${shortcode}":\n\n${url}\n\n` +
      `This link expires in 15 minutes. If you didn't request it, ignore.\n`,
  });
  res.status(202).end();  // "we'll email you the link"
});

// On callback, promote pending pins owned by the now-logged-in handle.
app.get('/manage', (req, res) => {
  const owner = auth.handleFromRequest(req);
  if (!owner) return res.redirect('/login');
  // db.promotePendingPinsFor(owner)
});
```

`startLogin` runs the same 12-step sham-work flow as the form
handler, so unknown emails, rate-limit hits, and real sends all
return identical shapes — the caller can't observe which happened.
This preserves FR-6 timing equivalence even for programmatic
callers. See SPEC §7.3a for the full contract.

If you need *operator* visibility (not per-call: aggregate counts and
real-send confirmation), wire the v0.2.1 hooks documented in
[Step 8](#step-8-optional-operator-monitoring-via-event-hooks-v021)
below — they emit without breaking the per-call silent-202 contract.

`auth.deriveHandle(email)` returns the same opaque HMAC handle
that the form path uses, without you having to import the helper
or pass the secret around. The instance method **normalizes the
email** (lowercase, trim) before HMAC (AF-13), so `Alice@X.com`
and `alice@x.com` produce the same handle — match what the form
and `startLogin` would compute. The bare `deriveHandle` re-export
takes pre-normalized input; use the instance method unless you
have a specific reason to call the lower-level primitive.

> **Mode-A heads-up: set `failureRedirect`.** If you only mount
> `auth.callback` (not `auth.loginForm`), the default
> `failureRedirect` cascade points at `/login` — a route you
> don't serve. An expired or replayed magic-link click will 302
> to a 404. Set `failureRedirect: '/'` (or any route you do
> serve) when wiring Mode A.

### Step 5: Pre-seed users (closed-registration mode, default)

By default, knowless is closed: a handle must already exist before
that email can request a magic link. To seed users:

```js
import { deriveHandle } from 'knowless';

// At admin setup time:
auth._handlers; // not the public path — use a custom admin script
                // that calls into the underlying store.
```

Actually the cleanest pattern: write a tiny admin script using the
re-exported primitives:

```js
import { knowless, deriveHandle, createStore } from 'knowless';

const SECRET = process.env.KNOWLESS_SECRET;
const store = createStore('./knowless.db');

const teamEmails = ['alice@example.com', 'bob@example.com'];
for (const email of teamEmails) {
  store.upsertHandle(deriveHandle(email, SECRET));
}
store.close();
```

Or run with `openRegistration: true` if you want first-email-wins:

```js
const auth = knowless({ ..., openRegistration: true });
```

Note that open registration adds a per-IP cap on new handles
(default 3/hour) to mitigate signup spam.

### Step 6: Use sessions in your app — `auth.handleFromRequest`

After `/auth/callback` succeeds, the user has a session cookie. To
gate your own protected endpoints, call `auth.handleFromRequest(req)`:
it returns the requesting session's opaque handle (64-char hex), or
`null` when the cookie is missing, malformed, or expired. **This is
the load-bearing primitive for adopter authorization.** The five
mounted handlers (`login`, `callback`, `verify`, `logout`, `loginForm`)
own the auth round-trip; everything *else* in your app uses
`handleFromRequest`.

```js
// Express-shaped middleware. Same pattern works in Hono / Fastify /
// node:http — handleFromRequest takes a node-shaped req and returns
// a string or null synchronously. No async, no DB hop beyond the
// session lookup.
function requireAuth(req, res, next) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    res.statusCode = 401;
    return res.end('unauthorized');
  }
  req.handle = handle;
  next();
}

// Then on every protected endpoint:
app.get('/api/pins', requireAuth, (req, res) => {
  const pins = db.findPinsByOwner(req.handle); // owner_handle = req.handle
  res.json(pins);
});

app.delete('/api/pins/:id', requireAuth, (req, res) => {
  const pin = db.getPin(req.params.id);
  if (pin.owner_handle !== req.handle) {
    res.statusCode = 403;
    return res.end('forbidden');
  }
  db.deletePin(req.params.id);
  res.end();
});
```

The `verify` handler is for **forward-auth deployments** (your
reverse proxy gates upstreams via `/verify` returning 200/401 +
`X-User-Handle`). For in-process middleware, prefer
`handleFromRequest` — same answer, no sub-request round-trip, no
header parsing.

### Local development setup

Production defaults are tuned to bite bots, not to be friendly to a
developer hammering the same address from `127.0.0.1` for the
hundredth time. Use a dedicated dev config:

```js
const auth = knowless({
  // ...required fields
  cookieSecure: false,             // localhost-only HTTP origins (AF-4.4)
  devLogMagicLinks: true,          // print magic links to stderr when SMTP fails (AF-6.2)
  maxLoginRequestsPerIpPerHour: 0, // disable per-IP login cap
  maxNewHandlesPerIpPerHour: 0,    // disable per-IP create cap
  openRegistration: true,          // skip the pre-seeding step in dev
});
```

Why each flag matters in dev:

- **`cookieSecure: false`** — without it, `http://localhost` browsers
  reject the session cookie silently. The library logs a stderr
  warning at startup so you can't accidentally ship this to prod.
- **`devLogMagicLinks: true`** — when SMTP is unreachable (no local
  Postfix yet), magic-link URLs print to stderr tagged
  `[knowless dev:<from>] magic link: ...`. Click straight from the
  terminal. **Bonus diagnostic** (AF-7.2): on a sham/silent-miss
  path, you get `[knowless dev:<from>] silent-miss: handle for
  "X" does not exist (openRegistration=false)` instead — surfaces
  the closed-reg gotcha that costs everyone the same 30 minutes
  the first time.
- **`maxLoginRequestsPerIpPerHour: 0` and `maxNewHandlesPerIpPerHour:
  0`** — disable per-IP rate caps. The defaults (30 / 3 per hour)
  are sane for prod but shoot you in the foot during repeated test
  runs. The counters **persist in the SQLite file** across process
  restarts, so even rebooting the dev server doesn't clear them —
  you'd have to delete the DB or wait an hour. Setting both to 0
  in dev avoids the surprise.
- **`openRegistration: true`** — saves you from manually pre-seeding
  every test email via `auth.deriveHandle` + your own store insert.

> **Don't ship this config.** Each of these flags weakens a specific
> defense. They are coupled to your environment, not to each other —
> intentionally. (We considered auto-disabling rate limits whenever
> `devLogMagicLinks` is true, but rejected: an operator turning on
> `devLogMagicLinks` to debug a single email in production should
> NOT have rate limits silently dropped at the same time.)

For end-to-end mail rendering checks (verify the `bodyFooter`,
inspect the magic-link line for QP soft-breaks, confirm the
right `subjectOverride` shipped), point dev knowless at MailHog
on `localhost:1025`. Setup walkthrough lives in
[`OPS.md` §11b](OPS.md).

### Step 7: GDPR right-to-erasure

The store interface exposes `deleteHandle(handle)` — atomic delete
of the handle row, all active tokens, and all active sessions.
Wire it to your "delete my account" UX:

```js
app.post('/account/delete', requireAuth, (req, res) => {
  const handle = /* read from session via auth.verify or cookie */;
  auth.deleteHandle(handle);
  res.redirect('/goodbye');
});
```

Library doesn't ship a built-in HTTP endpoint for this — operator
chooses the UX (admin CLI, in-app self-service, ticket-driven
support).

### Step 8 (optional): Operator monitoring via event hooks (v0.2.1+)

Three event hooks + one opt-in method. All optional, all opt-in. None
are required for correct operation; the library is fully functional
with zero hooks wired. They exist so an operator can wire knowless to
their existing observability stack (Prometheus, statsd, structured
logs, on-call paging) without knowless curating its own metrics shape.

```js
const auth = knowless({
  // ...required + existing options...

  onMailerSubmit: ({messageId, handle, timestamp}) => {
    log.info('knowless.dispatch', { messageId, handle, ts: timestamp });
  },
  onTransportFailure: ({error, timestamp}) => {
    log.error('knowless.smtp_failed', { err: error.message, ts: timestamp });
    pager.notify('SMTP transport failed');
  },
  onSuppressionWindow: ({sham, rateLimited, windowMs}) => {
    metrics.gauge('knowless.sham_count', sham);
    metrics.gauge('knowless.rate_limited', rateLimited);
    if (sham > BASELINE * 10) pager.notify('possible enumeration attack');
  },
  // suppressionWindowMs: 60_000,  // default; configurable
});

// Optional: explicit transport probe at boot. No auto-probe by design.
try {
  await auth.verifyTransport();
} catch (err) {
  console.error('SMTP unreachable at boot:', err);
  process.exit(1);
}
```

#### Why three hooks, not four

The two silent-202 branches — sham hits (handle does not exist) and
rate-limit hits (any of the three caps) — are bundled into one *windowed
aggregate* (`onSuppressionWindow`) rather than per-event hooks. Per-event
hooks would let a careless adopter log per-handle data, which is the
enumeration oracle that sham-work exists to prevent. The HTTP response
is silent on these branches; the log file must be silent too.

Operators still get the spike signal — a 10× jump in `sham` count over
the window is the enumeration-attack alarm. They don't get per-call
correlation to a specific handle, and they shouldn't have it.

`onMailerSubmit` is per-event because it fires *only* on real
submissions, where the handle was already disclosed by the form
input. `onTransportFailure` is per-event because it carries no
identity data.

> **Don't log `onSuppressionWindow` payloads in a way that distinguishes
> them from `onMailerSubmit` at the log-line level.** The aggregate
> count is fine; the line itself should be cleanly labeled as a periodic
> counter emission, not "a sham just happened." If your log shipper or
> dashboard groups them differently, you've put back the per-event
> distinguishability the bundling was meant to remove.

#### Why `verifyTransport()` is opt-in

No auto-on-boot variant exists by design. Deployments where knowless
starts before Postfix (docker-compose ordering, k8s readiness probes
that run knowless before the SMTP container is healthy) would fail
boot for the wrong reason. Adopters who want fail-fast call
`verifyTransport()` explicitly; everyone else gets eventually-consistent
SMTP startup.

## Custom mailer adapter (hosts with their own outbound stack)

The default mailer submits via nodemailer to localhost:25 (your Postfix).
If you already run outbound infrastructure with DKIM signing, a
transactional API, or a sendmail pipe, you can inject a mailer object:

```js
import { knowless, dropShamRecipient } from 'knowless';

// Timing-equivalence self-equalisation for subprocess-based mailers.
// Pre-measure your P95 delivery time, pad real sends to match.
const TRANSPORT_FLOOR_MS = 8; // example — calibrate for your stack

async function padToTransportFloor(startMs) {
  const elapsed = performance.now() - startMs;
  if (elapsed < TRANSPORT_FLOOR_MS) {
    await new Promise(r => setTimeout(r, TRANSPORT_FLOOR_MS - elapsed));
  }
}

const mailer = {
  async send(envelope, raw) {
    const t0 = performance.now();

    if (dropShamRecipient(envelope)) {
      // FR-6: no wire bytes, but burn the same wall time real delivery
      // would take so real-vs-sham timing stays within ≤1ms.
      await padToTransportFloor(t0);
      return;
    }

    // Example: pipe to sendmail (local MTA handles DKIM via opendkim milter)
    await new Promise((resolve, reject) => {
      const proc = spawn('sendmail', ['-t', '-oi'], { stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d; });
      proc.stdin.write(raw);
      proc.stdin.end();
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`sendmail exited ${code}: ${stderr}`));
      });
    });
    await padToTransportFloor(t0);
  },

  async verify() {
    // Optional — called once at factory construction.
    // Throw here to abort startup on misconfigured transport.
    // Example: probe that sendmail is available.
    await execFile('sendmail', ['-bv', 'root']).catch(err => {
      throw new Error(`sendmail probe failed: ${err.message}`);
    });
  },

  // close() is optional — call yourself on shutdown if you allocated resources.
};

const auth = knowless({ secret, baseUrl, from, mailer });
```

### Timing-equivalence CI smoke test

Add this to your integration tests to verify your adapter meets the
≤1ms FR-6 bar:

```js
// Run 200 warmup pairs, then 500 timed pairs.
// Assert |mean(real) - mean(sham)| < 1.0ms.
const WARMUP = 200, SAMPLES = 500;
const realTimes = [], shamTimes = [];

for (let i = 0; i < WARMUP + SAMPLES; i++) {
  const t0 = performance.now();
  await mailer.send({ to: 'alice@example.com' }, RAW_FIXTURE);
  const tReal = performance.now() - t0;

  const t1 = performance.now();
  await mailer.send({ to: 'null@knowless.invalid' }, RAW_FIXTURE);
  const tSham = performance.now() - t1;

  if (i >= WARMUP) { realTimes.push(tReal); shamTimes.push(tSham); }
}

const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const delta = Math.abs(mean(realTimes) - mean(shamTimes));
assert(delta < 1.0, `timing delta ${delta.toFixed(3)}ms exceeds 1ms FR-6 bar`);
```

### Postfix transport_maps fallback

If you don't want to write a custom mailer, the default nodemailer
path still works even with opendkim: configure Postfix to sign on the
way out (MTA-level DKIM via `milter_default_action`). You only need a
custom mailer if you want to bypass localhost submission entirely.

Whichever path you take, ensure the `transport_maps` null-route is in
place:

```
# /etc/postfix/transport
knowless.invalid    discard:silently dropped by knowless null-route
```

```
postmap /etc/postfix/transport && systemctl reload postfix
```

## Walkthrough: standalone server mode

Run `npx knowless-server`, point Caddy / nginx / Traefik at it for
forward-auth, protect any HTTP service behind magic-link login.

The deployment-shape pattern:
```
[browser] → [Caddy] → [knowless-server /verify]
                     ↓ 200 OK + X-User-Handle
                [Caddy proxies to Uptime Kuma]
                     -OR-
                     ↓ 401 Unauthorized
                [Caddy redirects to auth.example.com/login?next=...]
```

Sample Caddyfile (full setup including TLS/ACME + multiple gated
services lives in [`OPS.md`](OPS.md) §7):

```caddy
auth.example.com {
    reverse_proxy localhost:8080
}

kuma.example.com {
    forward_auth localhost:8080 {
        uri /verify
        copy_headers X-Knowless-Handle
    }
    reverse_proxy localhost:3001  # Uptime Kuma
}

adguard.example.com {
    forward_auth localhost:8080 {
        uri /verify
        copy_headers X-Knowless-Handle
    }
    reverse_proxy localhost:3000  # AdGuard Home
}
```

One auth subdomain, one cookie, SSO across all gated services
because the cookie is scoped to the parent eTLD+1.

Configuration is via `KNOWLESS_*` env vars — see
[`config.example.env`](config.example.env) and run
`knowless-server --help` for the full list. `knowless-server
--config-check` validates your env, SMTP reachability, and DB
write access; suitable for systemd `ExecStartPre`.

## Configuration reference

Full options table:

| Option | Required | Default | Purpose |
|---|---|---|---|
| `secret` | yes | — | HMAC key, ≥64 hex chars (32 bytes). FR-47, FR-48. |
| `baseUrl` | yes | — | Base URL for magic-link construction. |
| `from` | yes | — | Bare RFC 5321 sender (envelope MAIL FROM AND default From: header). |
| `fromName` | no | — | Optional RFC 5322 display name for the From: header (AF-27, v0.2.3+). When set, recipients see `addypin <noreply@addypin.com>` instead of bare `noreply@addypin.com` — most clients display the local-part as the sender name otherwise. ASCII, ≤60 chars, no CR/LF/<>". envelope.from stays bare always. |
| `dbPath` | no | `./knowless.db` | SQLite file path. |
| `cookieDomain` | no | (eTLD+1 of `baseUrl`) | Session cookie scope. |
| `cookieName` | no | `knowless_session` | Session cookie name. |
| `tokenTtlSeconds` | no | `900` | Magic-link expiry (15 min). |
| `sessionTtlSeconds` | no | `2592000` | Session lifetime (30 days). |
| `linkPath` | no | `/auth/callback` | Magic-link URL path. |
| `loginPath` | no | `/login` | Login form / submission path. |
| `verifyPath` | no | `/verify` | Forward-auth check. |
| `logoutPath` | no | `/logout` | Logout endpoint. |
| `smtpHost` | no | `localhost` | MTA host. |
| `smtpPort` | no | `25` | MTA port. |
| `openRegistration` | no | `false` | Allow new-handle creation on first email. |
| `subject` | no | `'Sign in'` | Mail subject. ASCII, ≤60 chars. |
| `confirmationMessage` | no | (default with `{email}` placeholder) | Shown after submission. |
| `includeLastLoginInEmail` | no | `true` | Append "Last sign-in" line for compromise hint. |
| `maxActiveTokensPerHandle` | no | `5` | Per-handle cap; 0 disables. |
| `maxLoginRequestsPerIpPerHour` | no | `30` | Per-IP login cap; 0 disables. |
| `maxNewHandlesPerIpPerHour` | no | `3` | Per-IP creation cap (open-reg only); 0 disables. |
| `honeypotFieldName` | no | `website` | Hidden form field name. |
| `trustedProxies` | no | `['127.0.0.1', '::1']` | IPs allowed to set `X-Forwarded-For`. |
| `shamRecipient` | no | `null@knowless.invalid` | Where sham mail goes (your MTA must discard it). |
| `sweepIntervalMs` | no | `300000` | Sweeper tick (5 min default). |
| `failureRedirect` | no | (= `loginPath`) | Where /auth/callback failures redirect. **Mode-A adopters:** if you don't mount `loginForm`, set this to a route you actually serve (e.g. `/`) — otherwise expired/replayed magic-link clicks 302 to a 404. |
| `store` | no | (built-in `node:sqlite`) | Inject your own store implementation. |
| `mailer` | no | (built-in nodemailer) | Inject your own mailer. |

## FAQ

### Is there an official knowless Docker image?

No. knowless does not ship a turnkey image with Postfix + null-route
+ the binary pre-baked. The reasoning: a Docker image bundling
Postfix wouldn't actually save the operator from the work that
matters (SPF / DKIM / PTR records on your sending domain, outbound
port 25 unblocked at your hosting provider, reverse DNS pointed at
your sending hostname — all done outside the container regardless),
and shipping a Postfix image would commit a walk-away library to a
permanent CVE-rebuild cadence. The OPS.md walkthrough is the
canonical install path; a fresh VPS to working forward-auth takes
30–60 minutes of one-time setup, and then it stays put.

If a community Dockerfile emerges (open invitation — knowless is
Apache-2.0), OPS.md will link to it. Until then, run
`knowless-server` as a systemd unit alongside Postfix as the OPS
walkthrough lays out.

### Why doesn't knowless block disposable email domains?

Disposable-domain blocking (mailinator.com, throwaway.email, etc.) is
adopter policy, not identity layer. The blocklist is a public GitHub
repo, the override list is operator-specific, and the cron to refresh
it lives in your ops layer. Putting the *mechanism* in knowless while
the *list curation* and *overrides* live in the adopter is the wrong
seam — both stay together in your form handler.

```js
// In your /login form handler, before calling auth.login:
import { DISPOSABLE_DOMAINS, ADOPTER_OVERRIDES } from './disposable-domains.js';

app.post('/login', async (req, res) => {
  const email = /* parse from body */;
  const domain = email.split('@')[1]?.toLowerCase();
  if (domain && DISPOSABLE_DOMAINS.has(domain) && !ADOPTER_OVERRIDES.has(domain)) {
    // Reply with the same shape as auth.login's success/sham response
    // to preserve FR-6-equivalent timing at your layer too. Match
    // status, headers, and body that auth.login would emit.
    return res.status(200).type('html').send(/* same confirmation HTML */);
  }
  return auth.login(req, res);
});
```

The same argument applies to per-IP hashcash / proof-of-work: if
`maxNewHandlesPerIpPerHour: 3` isn't enough for your threat model,
run hashcash at Caddy or your edge layer — knowless's login form
deliberately stays zero-JS.

### How do I check how old a handle / user is?

knowless deliberately doesn't expose handle creation dates. The reason:
"first time this email hit knowless" is rarely the trust signal you
actually want — you want "first time this user did something meaningful
in *my app*." A six-month-old knowless handle that has never posted
has zero application tenure.

Pattern: track `(handle, first_seen_at)` in your own table the first
time a handle performs the action you care about (first post, first
purchase, first non-trivial API call). Bucket by your tenure, not
knowless's.

```js
// On the action you care about:
const handle = auth.handleFromRequest(req);
db.recordFirstSeen(handle, Date.now());  // INSERT OR IGNORE
const age = db.ageBucketFor(handle);     // 'new' | '1mo' | '1y' | '5y+'
```

This is also safer: returning a `Date | null` keyed by handle is itself
an enumeration oracle (null leaks "this handle doesn't exist"). Bucket
on your side from a table that only knows about handles that have
already acted.

### My users say magic links land in spam.

This is operator infrastructure, not the library. The library
sends RFC-clean plain-text mail with whitelisted headers; what
mail providers do with it depends entirely on your sending
domain's reputation. Verify SPF, DKIM, and PTR records are all
set correctly. Test with [mail-tester.com](https://www.mail-tester.com/).

### Can I use Mailgun / Postmark / SES instead of localhost Postfix?

No, by design. The library refuses remote SMTP and vendor APIs.
The reasoning is in [`docs/01-product/PRD.md`](docs/01-product/PRD.md) §16.2: a
vendor relationship invites the operator to use the same mailer
for non-auth mail (welcome emails, digests), which contradicts
the philosophy. If you need a vendor mailer, you're not the
audience for knowless.

### How do I rotate the secret?

You can't, in practice. Rotating invalidates every existing handle
(they're salted by the secret) and every session (they're signed
by it). Treat the secret like a database master key: generate it
once, back it up safely, never expose it.

### Can I customise the login HTML?

The built-in form is hardcoded. Operators wanting branding fork the
project. Rationale in [`docs/01-product/PRD.md`](docs/01-product/PRD.md) §16.12: templating
is a slope ("let me put my logo" → "let me theme the page" →
"let me embed a JS framework"). The hardcoded form refuses to drift.

However, you can **skip mounting `loginForm`** entirely and serve your
own form, provided it satisfies the handler contract:

- POST to `loginPath` (default `/login`).
- Include an `email` field in the `application/x-www-form-urlencoded`
  body.
- Do **not** pre-parse the body upstream — knowless reads the request
  stream itself. A body-parser middleware mounted before `auth.login`
  will silently steal the data (see gotcha #15 in
  [`knowless.context.md`](knowless.context.md)).
- Optional: include a `next` field for the post-callback redirect URL
  (knowless validates `next` against `baseUrl` + `cookieDomain`).
- Optional but recommended: include the honeypot field using the name
  from `cfg.honeypotFieldName`.

### Branding the GET /login page (you almost certainly want to override it)

Knowless ships `auth.loginForm(req, res)` as a turnkey fallback so
adopters can wire `GET /login` in one line and have a working magic-link
form. The page is intentionally unstyled — it's the contract-minimal
renderer needed to make the flow demonstrable, not a UI you ship to
end users. Three reasons most adopters override it:

1. **Brand consistency.** The fallback page has no header, footer, nav,
   or styling, so users redirected here from elsewhere in your app land
   on what looks like a different site. That's especially jarring after
   a sham-token failure (a deliberate part of the silent-miss design —
   see "Silent miss" in [`knowless.context.md`](knowless.context.md)),
   where a user clicked a magic link and ended up on a "Sign in" page
   that looks unrelated to where they started.
2. **`/login` is load-bearing in the silent-miss contract.** Knowless
   redirects to `loginPath` on every failure mode that must be
   indistinguishable from success — used token, expired token, sham
   token, malformed token. That redirect is correct and required. But
   it means `/login` is the page users actually land on during
   anti-enumeration failures, not just the page they navigate to
   deliberately. It deserves first-class UI in your app.
3. **`auth.loginForm` is opt-in, not opt-out.** Adopters who never wire
   the GET route still get a working app — just without a friendly
   `/login` page. Override it whenever you want your app's chrome on
   the page. The POST handler can stay as-is (or also be wrapped — for
   example, plato wraps it for the "we sent a link" confirmation).

Override pattern (mount your own handler instead of `auth.loginForm`):

```js
app.get('/login', (req, res) => renderMyOwnLogin(req, res));
app.post('/login', auth.login);  // unchanged
```

The form just needs to satisfy the contract listed in the previous
question.

### How do I add 2FA / WebAuthn / TOTP?

Compose with a separate library. knowless does magic-link, full
stop. WebAuthn after login is a different layer.

### What about CSRF on POST /login?

Knowless validates the `Origin` (or `Referer`) header against
`cookieDomain` on both `POST /login` and `POST /logout`.

- **Failure mode:** 403 with a plain-text body `"Forbidden"`. No
  redirect, no JSON envelope.
- **Browser-absent callers** (curl, server-to-server): if neither
  `Origin` nor `Referer` is present, the check passes — the
  browser is the CSRF threat model, not API callers. Programmatic
  callers that do send an `Origin` header must ensure it matches
  `cookieDomain`.
- **The check is not disable-able.** Do not add an upstream
  exception; the Origin check is the CSRF defence (SPEC §7.3 Step
  0). Do NOT add a separate CSRF token — it would duplicate a
  defence already in place and complicate custom form integration.

### What are the rate-limit defaults, and what does a rate-limited response look like?

Defaults (all configurable at construction, no live tuning):

| Option | Default | Scope |
|---|---|---|
| `maxLoginRequestsPerIpPerHour` | 30 | Per source IP |
| `maxNewHandlesPerIpPerHour` | 3 | Per source IP (open-registration only) |
| `maxActiveTokensPerHandle` | 5 | Per handle (unexpired, unused) |

A rate-limited submission returns **202** with the same HTML body as a
successful send — identical to the sham and real-send responses. This
is intentional: distinct status or body would let an attacker enumerate
which IP is being throttled. Aggregate counts are surfaced via the
`onSuppressionWindow` hook (v0.2.1); individual rate-limit hits are
not exposed per-event by design (see [`knowless.context.md`](knowless.context.md)
§ "Why three hooks, not four").

### Can I run multiple instances behind a load balancer?

The default SQLite store is a single-process embedded engine. Knowless
is designed for single-process deployments. Contention shows up as
`SQLITE_BUSY` errors in logs; if you see them, your write rate exceeds
the single-process envelope. Benchmark in your own environment — the
answer depends on kernel, filesystem, SQLite version, and Node version,
and v1.x carries no numeric guarantee across upgrades.

For multi-process or multi-node deployments, implement the store
interface against Postgres, Redis, or any other backend. The interface
is documented in [`docs/02-design/SPEC.md`](docs/02-design/SPEC.md) §13.

### How do I see what's in the store?

```
sqlite3 knowless.db
sqlite> .schema
sqlite> SELECT count(*) FROM handles;
sqlite> SELECT count(*) FROM sessions WHERE expires_at > unixepoch() * 1000;
```

The schema is documented in [`docs/02-design/SPEC.md`](docs/02-design/SPEC.md) §6.

## Troubleshooting

### "config.secret must be ≥64 hex chars (32 bytes)"

You passed a secret shorter than 64 characters or not a string.
Run `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
and use the output.

### Magic link works but `/verify` returns 401

Common causes:
- Cookie domain mismatch. The cookie is set to the eTLD+1 of
  `baseUrl` by default; if your protected service is on a
  different parent domain, the browser won't send the cookie.
  Set `cookieDomain` explicitly.
- Cookie not surviving the redirect. The `Set-Cookie` from
  `/auth/callback` must be `Secure`, so HTTP-only origins won't
  receive it. Use HTTPS in production.

### "ERR_UNKNOWN_ENCODING: 7bit" or "Content-Transfer-Encoding: base64" in mail

Library bug — the mailer is supposed to compose 7bit raw RFC822.
Open an issue with the captured wire output.

### Tests fail intermittently in CI

The FR-6 timing test has a 1ms `delta_mean` bar. On extremely
noisy CI runners this can spuriously fail. Re-run; if persistent,
your runner is anomalous. Document the policy locally rather
than weakening the bar — see SPEC §14.5.

### "The link expires in 15 minutes" — can I make it longer?

Yes: `tokenTtlSeconds`. Don't set it absurdly high. Magic links
that linger in inboxes are a phishing-amplification risk if the
mail account is later compromised.

## Constraints / install footprint

- **One direct dependency.** `nodemailer` (SMTP submission). Storage
  is `node:sqlite` (Node stdlib, no native compile, no toolchain
  required on the host).
- **~2 transitive packages** in a typical install (down from ~40 in
  v0.1.x). No `prebuild-install`, no `gcc`, no `make`, no Python.
  `npm ci` works on stock RHEL 8 / Alma / Rocky / Amazon Linux 2
  with no extra packages. Self-hosters: `npm install knowless` is
  done.
- **Node ≥ 22.5.** `node:sqlite` requires this floor (introduced
  22.5, unflagged in 22.13+, fully stable in 24 LTS). Drops Node
  20 — about to EOL anyway.
- **No optional deps, no postinstall scripts.**

> `node:sqlite` may print one `ExperimentalWarning` to stderr on
> first import. Suppress with `--no-warnings` or by running on
> Node 24 LTS where the API is fully stable.
