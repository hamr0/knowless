# knowless — Specification (SPEC.md)

**Status:** Draft v0.2 (post-PRD-v0.13, post-Phase-5)
**Companion:** [`docs/01-product/PRD.md`](../01-product/PRD.md)

This document pins the wire formats, byte layouts, and algorithms
that the PRD references but does not define. Where the PRD says
*what* and *why*, this says *exactly how*. An independent
reimplementation (Go, Rust, Python) following this spec MUST be
byte-compatible with the reference implementation.

> **For future Claude:** When the PRD and SPEC disagree, the PRD
> wins on intent and the SPEC wins on mechanism. If a SPEC choice
> conflicts with a PRD requirement, fix the SPEC. If a PRD claim
> turns out to be impossible to mechanise, raise it back to the
> design conversation — don't silently weaken the SPEC.

---

## 1. Scope and conventions

### 1.1 What this document covers

- Email normalization (§2)
- Handle derivation (§3)
- Token format and lifecycle (§4)
- Session cookie format and lifecycle (§5)
- Database schema (§6)
- HTTP request/response shapes for each handler (§7–§10)
- Sham-work pattern satisfying FR-6 (§7)
- Forward-auth return-URL mechanism (§11)
- Mail composition (§12)
- Store interface (§13)
- Test methodology for FR-6 (§14)
- Open questions (§15)

### 1.2 Conventions

- **MUST / MUST NOT / SHOULD / MAY** carry RFC 2119 weight.
- Byte counts assume UTF-8 unless otherwise stated.
- "Hex" means lowercase hexadecimal (RFC 4648 §8 with `a-f`,
  not `A-F`). Comparisons are case-sensitive.
- "Base64url" means URL-safe base64 without padding
  (RFC 4648 §5; alphabet `A-Z a-z 0-9 - _`; no `=`).
- Timestamps are integer **Unix milliseconds** (UTC). Stored as
  SQLite `INTEGER`.
- "Constant-time comparison" means `crypto.timingSafeEqual` with
  matched-length buffers. If lengths differ, return false
  *without* calling timingSafeEqual.
- All error paths that involve user-supplied input MUST log the
  failure to stdout (without leaking the input itself or any
  derived secret) and return the silent-on-miss response.

### 1.3 Cryptographic primitives

| Primitive | Algorithm | Notes |
|---|---|---|
| Keyed MAC | HMAC-SHA256 | All authentication of derived values. |
| Hash | SHA-256 | Token-at-rest, session-at-rest, NEVER for handles. |
| CSPRNG | `node:crypto.randomBytes(n)` | All secrets, IDs, tokens. |
| Compare | `node:crypto.timingSafeEqual` | All MAC and hash comparisons. |

The operator secret (config `secret`, env `KNOWLESS_SECRET`)
MUST be at least 32 bytes (64 hex chars), per FR-48. The library
MUST refuse to start otherwise.

---

## 2. Email normalization

### 2.1 Algorithm

```
normalize(input: string) -> string | error:
  1. If input is null, undefined, empty, or longer than 254
     bytes (RFC 5321 §4.5.3.1.3 max), return error.
  2. Strip leading/trailing ASCII whitespace (\t \n \r 0x20).
  3. Lowercase using ASCII case-folding ONLY — i.e. map
     0x41–0x5A to 0x61–0x7A. No Unicode case-folding.
  4. Validate the result against the regex:
        ^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$
     (deliberately strict: no quoted-locals, no IP-literal
     domains, no IDN). If it fails, return error.
  5. Reject if any byte is > 0x7F (non-ASCII), redundant with
     the regex but stated explicitly.
  6. Return the lowercased, validated string.
```

### 2.2 Why ASCII-only

International domain names (IDN) require Punycode + Unicode
case-folding, which is a nontrivial dependency surface and
expands the "normalize correctly" failure mode. v1 ships
ASCII-only and documents the limitation. IDN support is
explicitly v0.2-and-later, tracked in §15.

### 2.3 Why no plus-tag / dot stripping

Plus-tag (`alice+work@gmail.com`) and dot (`a.lice@gmail.com`)
behaviour is provider-specific. A library that strips them
would over-merge accounts on Gmail and incorrectly merge on
providers that treat them as distinct. The simpler, correct
behaviour is to treat them as distinct addresses and let the
operator's UX decide whether to merge.

### 2.4 Normalization is purely transient

Per FR-2, the normalized email MUST NOT be persisted. It exists
only as input to `deriveHandle` and as the recipient of the
outbound mail. The variable holding it MUST be cleared (or go
out of scope) immediately after the SMTP transaction.

---

## 3. Handle derivation

### 3.1 Algorithm

```
deriveHandle(email_normalized: string, secret: bytes) -> string:
  hmac = HMAC-SHA256(key=secret, message=email_normalized as UTF-8)
  return hex_encode_lowercase(hmac.digest())  // 64 chars
```

The handle is the lowercase hex of the HMAC output: 64 ASCII
characters. This is the value stored in the `handles` table
and used as a foreign key into `tokens` and `sessions`.

### 3.2 Why HMAC, not plain SHA-256

Plain SHA-256 of an email is reversible by dictionary attack
in seconds (the namespace of email addresses is small). HMAC
with the operator's secret makes the handle a *salted*
derivation: a leaked DB cannot be reversed without also
leaking the secret. This is the threat model in PRD §12.1
("DB-only leak").

### 3.3 Determinism

`deriveHandle` MUST be deterministic over `(email, secret)`:
the same input always produces the same handle. This is what
lets the silent lookup work without storing the email.

### 3.4 Domain separation

Future versions of this library MAY introduce additional HMAC
uses (e.g., `next` URL signing, see §11). All such uses MUST
prefix the message with a fixed ASCII tag and a separator byte
to prevent cross-domain confusion:

| Use | Tag | Message format |
|---|---|---|
| Handle | (none — historical) | UTF-8 email bytes |
| Session signature | `sess\x00` | sid base64url string |
| Next-URL signature (if ever used) | `next\x00` | URL bytes |

The handle case is grandfathered without a tag for
implementation simplicity; SHA-256 collision-resistance
guarantees make a missing prefix safe so long as no other use
shares the "no tag" key. Future uses MUST add tags.

---

## 4. Token

### 4.1 Generation

```
issueToken() -> {raw: string, hash: string}:
  bytes = randomBytes(32)               // 256 bits
  raw = base64url_encode_no_padding(bytes)  // 43 chars
  hash = hex_encode(sha256(bytes))      // 64 chars
  return {raw, hash}
```

### 4.2 Storage

Tokens MUST be stored as `hash` only (FR-13, FR-34). Raw
bytes MUST NOT touch persistent storage at any layer. The
`raw` value lives only in:
- The mail body (the magic link URL)
- The user's mail client / browser
- Memory of the request handler during issuance

### 4.3 URL placement

The magic link URL is constructed as:

```
<baseUrl><linkPath>?t=<raw>
```

For default config: `https://app.example.com/auth/callback?t=<43 chars>`.
The token is the only query parameter on the magic link
itself. The forward-auth return URL is bound to the token
in the DB (§11), not appended to the URL.

### 4.4 Lifecycle

| Stage | Trigger | Effect |
|---|---|---|
| Issued | `/login` POST with valid email | Row inserted with `expires_at = now + tokenTtlMs`, `used_at = NULL` |
| Redeemed | `/auth/callback?t=<raw>` GET, valid token | Row updated `used_at = now`; session created |
| Expired | `now > expires_at` | Sweep removes row (§4.6) |
| Replayed | `/auth/callback?t=<raw>` after redemption | Treated identically to "never existed" — null response |

### 4.5 Verification

```
verifyToken(raw: string) -> handle | null:
  if raw is missing or longer than 64 bytes: return null
  if not all chars in [A-Za-z0-9_-]: return null
  bytes = base64url_decode(raw)
  if bytes.length != 32: return null
  hash = hex_encode(sha256(bytes))
  row = store.getToken(hash)
  if row is null: return null
  if row.used_at is not null: return null      // replay
  if row.expires_at <= now(): return null      // expired
  store.markTokenUsed(hash, used_at=now())
  store.upsertLastLogin(row.handle, now())
  return row.handle
```

The function MUST return `null` (no further information) for
every failure mode. The caller distinguishes "session
established" from "fail" by `null` vs handle, never by a
typed error.

### 4.6 Sweeper

A background sweeper MUST run on a fixed interval (default
every 5 minutes per FR-13). On each tick:

```sql
DELETE FROM tokens
 WHERE expires_at <= ?  -- now in ms
    OR used_at IS NOT NULL AND used_at <= ?  -- now - 1 day
```

The "used_at <= now - 1 day" clause keeps redeemed tokens
around for 24h so an audit log can correlate "this token was
redeemed at this time" with operator-side metrics; after that,
the row is cleared. Tweakable via `tokenSweepGraceMs`.

### 4.7 Concurrency

Token issuance MUST be transactional with the FR-38 per-handle
cap check:

```sql
BEGIN IMMEDIATE;
SELECT COUNT(*) FROM tokens WHERE handle = ? AND used_at IS NULL AND expires_at > ?;
-- if count >= maxActiveTokensPerHandle:
--   DELETE oldest by expires_at ASC, LIMIT (count - max + 1)
INSERT INTO tokens (token_hash, handle, expires_at, used_at, next_url)
       VALUES (?, ?, ?, NULL, ?);
COMMIT;
```

`BEGIN IMMEDIATE` (not deferred) acquires the SQLite write
lock up front, preventing two concurrent logins from racing
past the cap.

---

## 5. Session

### 5.1 Cookie format

```
<sid_b64u>.<sig_hex>
```

- `sid_b64u`: base64url-encoded 32 random bytes (43 chars)
- `sig_hex`: hex-encoded HMAC-SHA256 signature (64 chars)
- Total cookie value length: 108 chars (43 + 1 + 64)

The dot is a literal `.` (0x2E). It is the only separator;
parsers MUST split on the *first* `.` to allow future format
extension.

### 5.2 Signature

```
sig = hex_encode_lowercase(
  HMAC-SHA256(key=secret, message="sess\x00" || sid_b64u)
)
```

The `"sess\x00"` prefix (5 bytes: 's','e','s','s',0x00) is
domain separation per §3.4. `||` denotes byte concatenation.

The signature is over the **base64url string of sid**, not the
raw sid bytes. This makes verification a string compare without
a base64 decode step, which is the hot path (§9).

### 5.3 Storage

```
sid_hash = hex_encode(sha256(base64url_decode(sid_b64u)))  // 64 chars
```

Sessions are stored by `sid_hash` (PK), not by the cookie
value. A DB leak does not yield usable cookies (FR-36).

### 5.4 Cookie attributes

Set-Cookie header on `/auth/callback` success:

```
Set-Cookie: knowless_session=<value>; Domain=<cookieDomain>; Path=/;
            Max-Age=<sessionTtlSeconds>; Secure; HttpOnly; SameSite=Lax
```

- `Secure` — set by default (FR-30); cookie not sent over HTTP.
  MAY be omitted via the `cookieSecure: false` config option, but
  ONLY for development on `http://localhost`. Operators MUST NOT
  set `cookieSecure: false` in production. The library SHOULD log
  a stderr warning at startup when `cookieSecure: false` is
  configured. (Closes AF-4.4.)
- `HttpOnly` — required (FR-30); not visible to JS.
- `SameSite=Lax` — required (FR-30); blocks cross-site POSTs
  but allows top-level navigations from email clicks (which is
  exactly our flow).
- `Domain` — defaults to eTLD+1 of `baseUrl`; configurable.
- `Max-Age` — same value as the server-side `expires_at`.

Cookie name (`knowless_session`) is configurable via
`cookieName`, default as shown.

### 5.5 Verification

```
verifySession(cookie: string) -> handle | null:
  if cookie is missing or empty: return null
  dot = cookie.indexOf('.')
  if dot < 0: return null
  sid_b64u = cookie.slice(0, dot)
  sig_hex = cookie.slice(dot + 1)
  if sig_hex.length != 64: return null
  expected = hex_encode_lowercase(
    HMAC-SHA256(secret, "sess\x00" || sid_b64u)
  )
  if not timingSafeEqual(sig_hex bytes, expected bytes): return null
  sid_bytes = base64url_decode(sid_b64u)
  if sid_bytes.length != 32: return null
  sid_hash = hex_encode(sha256(sid_bytes))
  row = store.getSession(sid_hash)
  if row is null: return null
  if row.expires_at <= now(): return null
  return row.handle
```

NFR-3 requires this completes in <10ms p99. The POC measured
0.07ms p99 against `:memory:` SQLite — 100× headroom.

### 5.6 Lifecycle

| Stage | Trigger | Effect |
|---|---|---|
| Created | `/auth/callback` redeemed valid token | Row inserted with `expires_at = now + sessionTtlMs` |
| Verified | `/verify` request with cookie | Row read, expiry checked |
| Revoked | `/logout` request | Row deleted, cookie cleared with `Max-Age=0` |
| Expired | `now > expires_at` | Sweeper removes row |

---

## 6. Database schema

### 6.1 DDL (better-sqlite3)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;     -- WAL + NORMAL is durable enough; FULL is overkill
PRAGMA foreign_keys = OFF;       -- we don't enforce, app-layer keys
PRAGMA temp_store = MEMORY;

CREATE TABLE handles (
  handle         TEXT    PRIMARY KEY,    -- 64-char hex
  last_login_at  INTEGER                 -- nullable
);

CREATE TABLE tokens (
  token_hash   TEXT    PRIMARY KEY,      -- 64-char hex
  handle       TEXT    NOT NULL,         -- references handles.handle
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER,                  -- nullable
  next_url     TEXT,                     -- nullable; validated forward-auth return URL
  is_sham      INTEGER NOT NULL DEFAULT 0  -- 0 | 1
);
CREATE INDEX idx_tokens_expires ON tokens(expires_at);
CREATE INDEX idx_tokens_handle  ON tokens(handle);

CREATE TABLE sessions (
  sid_hash    TEXT    PRIMARY KEY,       -- 64-char hex
  handle      TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE rate_limits (
  scope         TEXT    NOT NULL,        -- 'login_ip' | 'create_ip' | 'tokens_handle'
  key           TEXT    NOT NULL,        -- IP string, or handle hex
  window_start  INTEGER NOT NULL,        -- ms; bucket start (rounded down)
  count         INTEGER NOT NULL,
  PRIMARY KEY (scope, key, window_start)
);
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta(key, value) VALUES ('schema_version', '1');
```

### 6.2 The `is_sham` column

Sham token rows (§7.4) are inserted with `is_sham = 1`.
`verifyToken` MUST refuse to redeem any row where `is_sham = 1`,
returning null. This makes the sham row inert even if an
attacker somehow obtains a sham token (e.g., snooping mail in
transit when the mail was — by misconfiguration — actually
delivered).

### 6.3 Migrations

v1 ships schema_version = 1. The store interface includes a
`migrate(currentVersion)` hook for future schema changes.
Forward migration policy: each version applies its own DDL,
records the version in `meta`, never reverses. Operators
back up the SQLite file before upgrading; the library does
not do automatic backups.

---

## 7. Login flow (`POST /login`)

### 7.1 Request shape

```
POST <loginPath>            (default /login)
Content-Type: application/x-www-form-urlencoded
              or  application/json

Body fields:
  email             — string, required
  <honeypotName>    — string, MUST be empty (default name: 'website')
  next              — string, optional, forward-auth return URL
```

The library MUST accept both form-encoded and JSON bodies.
Frameworks may parse on its behalf; standalone server parses
both natively.

### 7.2 Response shape (uniform across all outcomes)

```
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Cache-Control: no-store

<full HTML page per FR-22, body containing the FR-7
 confirmation message with the submitted email
 HTML-escaped into the visible text>
```

The library MUST return `200 OK` with the same body for every
internal outcome (registered hit, silent miss, rate limit
hit, honeypot triggered, IP cap exceeded, SMTP delivery
failure). FR-5 indistinguishability.

The HTML is also `Cache-Control: no-store` to prevent
intermediate proxies from caching responses that vary by
internal state.

### 7.3 Flow with sham-work pattern

The flow has THREE early-exits (Origin mismatch, honeypot,
rate-limit) that are exempt from FR-6 timing equivalence per
§16.20 of the PRD. After those, the registered-hit and
silent-miss paths MUST perform equivalent work.

```
POST /login arrives.

Step 0 — Origin / Referer validation (CSRF defense, AF-4.3)
  Read the `Origin` header (preferred) or `Referer` header
  (fallback) from the request.

  - If both are absent: ALLOW (curl / programmatic clients).
  - If present: parse the URL and extract `host`. The host MUST
    equal `cookieDomain` or be a subdomain of it (same rule as
    the `next` URL whitelist in §11.2).
  - If present and the host fails the whitelist: silently
    short-circuit (return same_response, no sham work).

  This blocks browser-side cross-origin POST attacks where a
  malicious page autosubmits a form to /login with a known
  email. SameSite=Lax does not protect /login because the form
  itself is unauthenticated. The Origin check is exempt from
  timing equivalence: an attacker submitting from a foreign
  origin already knows their request shape; timing leaks
  nothing the request itself didn't expose.

  **Adopter note (re: CSRF tokens):** the Origin / Referer
  whitelist IS knowless's CSRF defense. Modern browsers always
  emit `Origin` on cross-origin POSTs, so a CSRF token would
  add complexity for negligible additional defense (the only
  scenarios where Origin is missing are header-stripping
  proxies and pre-2017 browsers, neither of which can safely
  log a user in regardless). knowless deliberately does NOT
  emit a CSRF token in `renderLoginForm`. Don't reinvent it
  upstream.

Step 1 — Parse and validate input
  email_raw = body.email
  honeypot  = body[honeypotName]
  next_raw  = body.next or query.next

  if email_raw is malformed or normalize(email_raw) errors:
    return same_response()  # silent

  email_norm = normalize(email_raw)

Step 2 — Honeypot check (exempt from timing eq.)
  if honeypot is non-empty:
    return same_response()  # short-circuit, no sham work

Step 3 — Per-IP rate limit on /login (exempt from timing eq.)
  ip = determineSourceIp(request, trustedProxies)
  if rateLimitExceeded(ip, scope='login_ip',
                       limit=maxLoginRequestsPerIpPerHour,
                       window=1h):
    return same_response()  # short-circuit, no sham work

Step 4 — Derive handle (begin equivalent-work region)
  handle = deriveHandle(email_norm, secret)

Step 5 — Validate next URL if present
  if next_raw is present:
    next_validated = validateNextUrl(next_raw, cookieDomain)
    if next_validated is null:
      next_validated = null  # silently drop bad next; not a hard fail
  else:
    next_validated = null

Step 6 — Lookup
  exists = store.handleExists(handle)
  is_creating = (not exists) and openRegistration

Step 7 — Open-registration cap (when applicable)
  if is_creating:
    if rateLimitExceeded(ip, scope='create_ip',
                         limit=maxNewHandlesPerIpPerHour,
                         window=1h):
      is_creating = false
      # fall through to sham; do NOT short-circuit (we already
      # passed the timing-equivalent boundary at Step 4)

Step 8 — Per-handle token cap with eviction
  active_count = store.countActiveTokens(handle)
  if active_count >= maxActiveTokensPerHandle:
    store.evictOldestActiveToken(handle)

Step 9 — Issue token (real or sham)
  token = issueToken()
  if exists or is_creating:
    if is_creating:
      store.upsertHandle(handle)
    store.insertToken(token.hash, handle,
                      expires_at = now + tokenTtlMs,
                      next_url = next_validated,
                      is_sham = 0)
    last_login = store.getLastLogin(handle)  # nullable
    target_address = email_norm
  else:
    store.insertToken(token.hash, handle,
                      expires_at = now + tokenTtlMs,
                      next_url = next_validated,
                      is_sham = 1)
    last_login = null
    target_address = shamRecipient   # configured null-route

Step 10 — Compose and submit mail
  body = composeMailBody(token.raw, last_login)
  mail.submit(to=target_address, subject=subject, body=body)

Step 11 — Increment rate-limit counters
  rateLimitIncrement(ip, scope='login_ip')
  if is_creating:
    rateLimitIncrement(ip, scope='create_ip')

Step 12 — Respond
  return same_response()
```

### 7.3a Programmatic entry: `auth.startLogin()` (AF-7.3)

knowless supports two adopter UX modes for magic-link login. Both
share the same 12-step sham-work flow; they differ only in **where
the email arrives from**.

**Mode B — register-first (form-driven).** The browser POSTs the
form to `/login`. This is §7.3 above. Use when the user is at a
keyboard and the action they want to take requires a session
first.

**Mode A — use-first, claim-later (programmatic).** The user does
something on your service (drops a pin, posts a comment, generates
a share link) without being logged in. Your handler captures their
email along with the action, calls `auth.startLogin({email,
nextUrl, sourceIp})`, and the user receives the magic link by
email. Clicking it opens a session and your `next` handler
promotes the deferred resource to claimed. Use for "deferred-claim
disposable resource" patterns.

**Signature.**

```js
const { handle, submitted } = await auth.startLogin({
  email,            // required, normalized internally
  nextUrl,          // optional; same whitelist as the form's `next`
  sourceIp,         // optional; counted against per-IP rate limit
  subjectOverride,  // optional; replaces cfg.subject for this call only (AF-9)
});
```

**`subjectOverride` (AF-9).** Adopters who use magic links for
multiple intents (login, action-confirmation, expiry warning,
account-recovery) need recognizable subjects per intent. Override
is validated by the same rules as the factory subject (ASCII,
≤ 60 chars, no CR/LF) and throws on invalid — programmer error,
not a silent miss. The subject is decided **before** the hit/miss
branch, so sham and real submissions carry the same subject and
no observer (including someone watching the operator's outbound
mail queue) can distinguish outcomes by subject. Spam-trigger
warnings (`!!`, `FREE`, etc.) do NOT throw; the caller has more
context than knowless about what's appropriate.

**Behavioural contract.**

- Runs **steps 1, 3, 4–12** of §7.3 verbatim.
- **Skips step 0 (Origin / Referer).** The caller is trusted
  server-side code; there is no browser context to validate.
- **Skips step 2 (honeypot).** No form context.
- **Throws** only on programmer error (missing email, invalid
  argument types). Rate-limit, sham, normalize-failure are
  silent same-shape outcomes.
- **Returns** `{handle, submitted: true}` on every non-throw
  path. `handle` is `null` only when the email failed to
  normalize (also the form's silent path). `submitted: true`
  is the lie that preserves FR-6 timing equivalence — an
  external observer cannot distinguish "real send,"
  "sham send," or "rate-limited drop" from the return value
  alone.

**Why skipping Origin / honeypot doesn't weaken FR-6.** The
timing-equivalence guarantee is about hit/miss observability
through the **email channel** and **HTTP response shape**.
A programmatic caller has neither: it has the return value of a
local function call. Origin and honeypot exist to protect the
form path; they have no semantic meaning for in-process code.
The 12-step sham work that produces the timing equivalence
(steps 4–12) is identical for both entries.

**Rate limits still apply.** A buggy adopter calling
`startLogin` in a loop will trip `maxLoginRequestsPerIpPerHour`
exactly as a buggy form would. The default IP-string for
programmatic callers is `''` (empty); supply a real `sourceIp`
to make the limit meaningful per actual user.

### 7.4 Sham-mail destination (RESOLUTION OF OPEN QUESTION)

**Decision:** the silent-miss path submits the mail to a
configured null-route address; operator's MTA discards.

**Configuration:**
- `shamRecipient` config option, default
  `null@knowless.invalid`. The operator MAY override.
- Operator MUST configure their localhost MTA to discard
  mail destined for the chosen address. For Postfix:
  ```
  # /etc/postfix/transport
  knowless.invalid    discard:silently dropped by knowless null-route
  ```
  ```
  # /etc/postfix/main.cf
  transport_maps = hash:/etc/postfix/transport
  ```
  Then `postmap /etc/postfix/transport && systemctl reload postfix`.
- Documented in OPS.md as a required setup step.

**Rationale:**
- Real, unregistered users do NOT receive unsolicited mail
  (which would be the alternative if we sent the sham mail
  to `email_norm`).
- Timing matches hit closely because the SMTP submission
  to localhost happens identically; Postfix decides to
  discard *after* receiving, which is invisible to the
  library's response time.
- The `is_sham` flag in the DB row makes the inserted token
  inert: even if the mail somehow leaked, the token cannot
  be redeemed (§6.2).
- An attacker can no longer harvest "is alice@x registered"
  by submitting alice@x and observing whether alice receives
  the mail — the silent-miss mail is destroyed at the MTA,
  not delivered.

**Trade-off:** the `.invalid` TLD (RFC 2606 §2) is reserved
for guaranteed-non-functional addresses; it never resolves.
This is intentional. Some MTA configurations may try to
look up MX for `.invalid` and fail with NXDOMAIN before
applying the transport rule. Operators MUST configure
`transport_maps` to apply *before* MX lookup, which is the
default Postfix order. Documented in OPS.md.

### 7.5 Confirmation message and HTML escaping

Per FR-7, the response body contains the confirmation message:

```
Thanks. If <ESCAPED_EMAIL> is registered, a sign-in link is
on its way. Check your inbox in a few minutes.
```

The submitted email is HTML-escaped via:
- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`
- `'` → `&#x27;`

Per FR-7, echoing is permitted because the user provided the
input. Escaping prevents reflected XSS.

### 7.6 What gets logged

Per NFR-12 and NFR-13, the library logs to stdout in plain
text. On `/login`:

```
[<ISO 8601 timestamp>] login: ip=<ip>  hash=<first-8-of-handle>
```

NEVER logged:
- Plaintext email
- Full handle
- Token (any form)
- Whether the hit / miss path was taken (would defeat
  silent-on-miss for an operator-side observer)

The first 8 hex chars of the handle is sufficient for
correlating with rate-limit logs and store inspection
without enabling cross-deployment correlation (different
secrets ⇒ different handles).

---

## 8. Callback flow (`GET /auth/callback`)

### 8.1 Request shape

```
GET <linkPath>?t=<raw-token>     (default /auth/callback)
```

### 8.2 Flow

```
Step 1 — Parse
  raw = query.t
  if raw is missing or malformed: see Step 5 (failure)

Step 2 — Verify token
  result = verifyToken(raw)
  // verifyToken refuses is_sham rows (§6.2)
  if result is null: see Step 5

Step 3 — Read next URL (bound to token)
  next_url = result.next_url   // null if not provided at /login

Step 4 — Create session and set cookie
  cookie = createSession(result.handle)
  set Set-Cookie header per §5.4
  if next_url:
    return 302 Found, Location: <next_url>
  else:
    return 302 Found, Location: <baseUrl>/   (or configured default)

Step 5 — Failure path
  return 302 Found, Location: <loginPath>
  Do NOT set a cookie.
  Do NOT distinguish "expired" from "replayed" from "never existed".
```

### 8.3 Why redirect on failure, not show an error

Per FR-25, all verification failures produce the same
response shape. The simplest indistinguishable response is a
redirect back to `/login`. The user sees "click failed,
please try again" implicitly. The library MAY support a
configurable `failureRedirect` if the operator wants a
specific page; default is `loginPath`.

### 8.4 Replay protection

Step 2 (`verifyToken`) sets `used_at = now` atomically with
the lookup. A second request with the same token sees
`used_at != null` and returns null per §4.5. The same
"failure path" (Step 5) runs.

---

## 9. Verify flow (`GET /verify`) — forward-auth hot path

### 9.1 Request shape

```
GET <verifyPath>     (default /verify)
Cookie: knowless_session=<value>
```

The reverse proxy (Caddy / nginx / Traefik) forwards the
original request's cookies via standard forward-auth
mechanisms.

### 9.2 Response shape

**Success:**
```
HTTP/1.1 200 OK
X-User-Handle: <64-char hex handle>
```

**Failure (no cookie, bad cookie, expired, no row):**
```
HTTP/1.1 401 Unauthorized
```

No body in either case. Forward-auth middleware reads
`X-User-Handle` and propagates it (or the proxy's normalized
form like `Remote-User`) to the protected service. Operator
configures whether to expose the handle to the protected
service or not.

### 9.3 Performance contract

Per NFR-3, p99 < 10ms. The hot path:

```
verifySession(cookie)  // ~70μs in POC, 137× headroom
```

Implementations MUST cache the prepared SQLite statement for
`SELECT ... FROM sessions WHERE sid_hash = ?` to avoid the
per-call parse cost. better-sqlite3 caches prepared
statements transparently when reused via the same
`db.prepare(...)` object — pin it once at module load.

### 9.4 Programmatic session resolution (`handleFromRequest`)

Library-mode adopters frequently need to resolve "who is this
authenticated user?" from a request object without going through
HTTP. The `verifyHandler` is HTTP-shaped (writes 200 + header
or 401 to the response); a programmatic equivalent is more
ergonomic for in-process middleware.

```
handleFromRequest(req: HttpRequest) -> handle | null:
  cookie = parseCookieHeader(req.headers.cookie, cookieName)
  return verifySession(cookie)   // §5.5
```

Returns the authenticated handle string on success, or `null`
on any failure (no cookie, malformed cookie, signature mismatch,
expired session, no row). Callers treat `null` as "no
authenticated user" — same semantic as the 401 from
`verifyHandler`.

The function MUST be synchronous or microtask-resolvable; it
shares the verify hot path's <10ms p99 budget when
operator-mounted as a per-request middleware.

This closes audit finding AF-2.8 and is the recommended
integration point for Express / Fastify / Hono middleware that
needs `req.handle` populated.

### 9.5 What's NOT done in /verify

- No token issuance, no mail sends, no rate limit checks.
  The reverse proxy provides DoS protection at its layer.
- No `last_login_at` write. That's only on `verifyToken`
  redemption (§4.5). /verify is purely a read.
- No session refresh / sliding expiry. Session has a fixed
  expiry; user re-authenticates on expiry. Sliding sessions
  are §15 open question Q-3.

---

## 10. Logout flow (`POST /logout`)

### 10.1 Request shape

```
POST <logoutPath>     (default /logout)
Cookie: knowless_session=<value>
```

### 10.2 Flow

```
Step 0 — Origin / Referer validation (CSRF defense, AF-6.4)
  Same algorithm as POST /login (§7.3 Step 0). If the request
  carries an Origin or Referer whose hostname is not
  cookieDomain or a subdomain, return 403. Browser-absent
  (curl/programmatic) is allowed. SameSite=Lax alone does not
  fully protect /logout against form POSTs from same-eTLD+1
  attacker subdomains; the explicit Origin check closes that.

verify cookie via verifySession (same as /verify)
if valid:
  store.deleteSession(sid_hash)
clear cookie:
  Set-Cookie: knowless_session=; Domain=<cookieDomain>; Path=/;
              Max-Age=0; Secure; HttpOnly; SameSite=Lax
return 200 OK with empty body
```

### 10.3 Why POST, not GET, plus Origin validation

GET-triggered logout enables CSRF: a malicious page embeds
`<img src="https://auth.example.com/logout">` and silently
logs the user out. POST is the first defense; explicit
Origin / Referer validation is the second. POST + Origin
check + SameSite=Lax cookie is the safe combination.

The library MAY also accept POSTs without a body. Operators
who prefer a logout link in their UI should use a small
form: `<form method="POST" action="/logout"><button>Log out</button></form>`.

---

## 11. Forward-auth return URL (signed `?next=`)

### 11.1 Mechanism (deviation from PRD FR-27a)

**This SPEC implements forward-auth return URL via DB-bound
`next` rather than HMAC-signed `next` in the URL.** The PRD
FR-27a wording ("HMAC-sign the `next` value... and embed it
in the magic link itself") is the intent; the byte-level
mechanism is simpler:

- At `/login`, the `next` URL is validated against the cookie
  domain whitelist.
- The validated URL is stored in `tokens.next_url` alongside
  the token row.
- The magic link URL contains *only* `?t=<raw>` — short and
  ASCII-clean per FR-17.
- At `/auth/callback` redemption, the callback reads
  `next_url` from the redeemed token row and redirects there.

The token's opacity already provides the security property
(an attacker cannot guess or substitute the token, so they
cannot tamper with the bound `next_url`). HMAC-signing the
URL is redundant when the URL lives in our trusted DB.

The PRD will be revised in v0.12 to make FR-27a
mechanism-agnostic. Tracked in §15 Q-1.

### 11.2 Validation of `next`

```
validateNextUrl(raw: string, cookieDomain: string) -> string | null:
  if raw is null or empty: return null
  if raw is longer than 2048 bytes: return null
  try:
    parsed = new URL(raw, baseUrl)   // base URL anchors relative inputs
  except: return null
  if parsed.protocol != 'https:' and parsed.protocol != 'http:':
    return null   // refuse javascript:, data:, etc.
  // Whitelist: host must equal cookieDomain or be a subdomain of it
  host = parsed.hostname.toLowerCase()
  if host == cookieDomain or host.endsWith('.' + cookieDomain):
    return parsed.toString()
  return null
```

### 11.3 What the URL can contain

After validation, the stored `next_url` is the canonical URL
form. The query string and fragment are preserved (so a
deep-link like `https://kuma.example.com/dashboard?from=mail`
survives). The path, query, and fragment are operator-trusted
because the host is whitelisted.

---

## 12. Mail composition

### 12.1 Headers

```
From: <fromAddress>
To: <recipient>
Subject: <subject>          (default 'Sign in', max 60 chars)
Date: <RFC 5322 date>
Message-ID: <<random>@<fromDomain>>
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: 7bit
```

`recipient`:
- Hit path: the normalized email
- Sham path: the configured `shamRecipient` (default
  `null@knowless.invalid`)

`Message-ID`:
- Generated as `<` + base64url(randomBytes(16)) + `@` +
  fromDomain + `>`. fromDomain extracted from `from`
  config (post-`@` portion).

NEVER set: `List-Unsubscribe`, `Return-Receipt-To`,
`Disposition-Notification-To`, `X-Campaign-*`, or any custom
`X-` header (FR-17).

### 12.2 Body (default)

```
Click to sign in:

<magic link URL>

This link expires in 15 minutes. If you didn't request this,
ignore this email.
```

If `last_login_at` is set for the handle (and
`includeLastLoginInEmail = true`, the default), append:

```

Last sign-in: <ISO 8601 UTC timestamp>.
If that wasn't you, do not click the link above.
```

### 12.3 Body constraints

- ASCII only: every byte `<= 0x7F`. The library MUST
  validate operator-overridden body templates for this and
  refuse to start if the configured body contains non-ASCII.
- The magic link URL MUST be on a line by itself, with no
  leading or trailing text on that line. The default
  template puts a blank line before and after.
- Total body MUST be no more than 8 KB. (Auth mail should
  be tiny; this is a sanity bound.)

### 12.4 Why not quoted-printable

Per the v0.11 PRD update and POC findings: nodemailer's
default quoted-printable encoding wraps lines at 76 chars,
which breaks the magic link with `=\n` soft breaks and
`=3D` for `=`. Mail clients decode this correctly, but the
user's "paste URL into browser" recovery path receives the
broken form. 7bit ASCII with the URL on its own line avoids
this entirely.

The library MUST configure nodemailer with
`encoding: '7bit'` (or equivalent — nodemailer's
`textEncoding: 'quoted-printable'` is the default and MUST
be overridden). Implementation:

```js
mailer.sendMail({
  from, to, subject,
  text: body,
  textEncoding: '7bit',  // explicit override
});
```

### 12.5 Subject validation

Operator-overridden subjects MUST be:
- ASCII only
- ≤ 60 chars
- Free of common spam triggers (warn, don't fail). The
  library SHOULD warn on startup if the subject contains
  any of: `!!`, `$$`, `FREE`, `URGENT`, `WINNER`, emoji.
  Warning is to stderr; the configured subject is still
  used.

---

## 13. Store interface

The library ships a default `better-sqlite3` implementation.
Operators wanting Postgres / Redis / in-memory implement
this interface and pass it to `knowless({store: myStore, ...})`.

```ts
interface Store {
  // --- Handle ---
  handleExists(handle: string): boolean;
  upsertHandle(handle: string): void;
  deleteHandle(handle: string): void;
    // FR-37a: removes handle row + all tokens + all sessions +
    // last_login_at, in one transaction.

  // --- Token ---
  insertToken(args: {
    tokenHash: string;
    handle: string;
    expiresAt: number;
    nextUrl: string | null;
    isSham: boolean;
  }): void;
  getToken(tokenHash: string):
    | { handle: string; expiresAt: number; usedAt: number | null;
        nextUrl: string | null; isSham: boolean }
    | null;
  markTokenUsed(tokenHash: string, usedAt: number): void;
  countActiveTokens(handle: string): number;
  evictOldestActiveToken(handle: string): void;
  sweepTokens(now: number, graceMs: number): number;  // returns rows deleted

  // --- Last login ---
  upsertLastLogin(handle: string, at: number): void;
  getLastLogin(handle: string): number | null;

  // --- Session ---
  insertSession(sidHash: string, handle: string, expiresAt: number): void;
  getSession(sidHash: string):
    | { handle: string; expiresAt: number }
    | null;
  deleteSession(sidHash: string): void;
  sweepSessions(now: number): number;

  // --- Rate limiting ---
  rateLimitIncrement(scope: string, key: string, windowStart: number): number;
    // returns new count
  rateLimitGet(scope: string, key: string, windowStart: number): number;
  sweepRateLimits(olderThan: number): number;

  // --- Lifecycle ---
  migrate(): void;     // run any pending DDL
  close(): void;
}
```

All methods are synchronous. `better-sqlite3` is synchronous
by design, and the POC confirmed this is fast enough at our
scale. Async store implementations MAY wrap with a sync facade
or implement their own scheduling.

### 13.1 Method semantics

- `insertToken` MUST be transactional with `evictOldestActiveToken`
  per §4.7. The store implementation handles the BEGIN/COMMIT.
- `markTokenUsed` MUST be a no-op if `used_at` is already set
  (idempotent).
- `deleteHandle` MUST clear all rows in one transaction and
  MUST NOT leave orphans.

---

## 14. Test methodology — FR-6 1ms bar

### 14.1 What the test measures

The CI test for FR-6 measures `delta_mean` (in milliseconds)
between the registered-hit and silent-miss login paths over
≥1000 iterations each, after a warm-up of ≥200 iterations
per path.

### 14.2 Pass criterion

**`delta_mean < 1.0 ms`** — i.e., the absolute value of the
difference in mean response times is under 1 millisecond.

### 14.3 Why effect size, not p-value

A Welch's t-test with N=10,000 will report "statistically
significant" for any constant offset > ~50μs, even though
that offset is invisible across realistic network jitter.
The 1ms bar reflects what an attacker can actually detect
through a network connection (typical jitter: 5-50ms).

### 14.4 Test harness

```js
// test/timing.test.js
import { newHarness } from './helpers/harness.js';

it('FR-6: hit and miss paths have delta_mean < 1ms', async () => {
  const h = newHarness();
  await h.registerHandle('alice@example.com');

  // Warm up
  for (let i = 0; i < 200; i++) {
    await h.login('alice@example.com');
    await h.login('bob@example.com');
  }

  // Measure
  const hit = [];
  const miss = [];
  for (let i = 0; i < 1000; i++) {
    const t1 = process.hrtime.bigint();
    await h.login('alice@example.com');
    hit.push(Number(process.hrtime.bigint() - t1) / 1e6);

    const t2 = process.hrtime.bigint();
    await h.login('bob@example.com');
    miss.push(Number(process.hrtime.bigint() - t2) / 1e6);
  }

  const meanHit = hit.reduce((s, x) => s + x, 0) / hit.length;
  const meanMiss = miss.reduce((s, x) => s + x, 0) / miss.length;
  const delta = Math.abs(meanHit - meanMiss);

  console.log(`hit mean=${meanHit.toFixed(3)}ms  miss mean=${meanMiss.toFixed(3)}ms  Δ=${delta.toFixed(3)}ms`);
  assert(delta < 1.0, `delta_mean ${delta}ms exceeds 1ms bar`);
});
```

### 14.5 CI considerations

CI runners have variable performance. The test is robust to
this because both paths run on the same runner under the
same conditions; the *delta* is what matters, not absolute
times. The test SHOULD run on every PR and on every push to
main.

If a CI runner exhibits anomalous noise (rare), the test
documents this is a known false-positive class. The fix is
re-running, not weakening the bar.

### 14.6 Mailer harness

Tests use nodemailer's `streamTransport` so no MTA is
required. SMTP submission to a real Postfix is verified
manually as part of the v1 release-gate (per OPS.md), not
in unit/integration tests.

---

## 15. Open questions

These are deliberately surfaced for resolution during
implementation, not silently decided.

### Q-1. PRD FR-27a wording

The PRD's "HMAC-sign the `next` value... embed it in the
magic link itself" is more prescriptive about mechanism
than necessary. SPEC §11 implements DB-bound `next` instead,
which is simpler and equally secure. The PRD will be revised
to v0.12 to make FR-27a mechanism-agnostic. **Action:** patch
PRD before SPEC v0.2.

### Q-2. Schema migration policy

v1 ships `schema_version = 1`. Future schema changes need a
forward-only migration mechanism. **Proposed policy:** each
version applies its DDL idempotently (`CREATE TABLE IF NOT
EXISTS`, `ALTER TABLE` guarded by version check), records
the new version in `meta`, never reverses. Operators back up
the SQLite file before upgrading. Defer to v0.2.

### Q-3. Sliding session expiry

Sessions currently have fixed expiry (created at T, expire at
T + sessionTtlSeconds). Some adopters want sliding expiry
(every successful `/verify` extends the expiry by some delta).
Defer to v0.2. v1 ships fixed expiry only.

### Q-4. CSRF on `POST /login`

The login form is unauthenticated; SameSite=Lax doesn't help
on a form submission to a different origin. We could add
Origin / Referer header validation to /login, but that breaks
operators who `curl` the endpoint for testing. Probably the
right answer is: validate Origin if present, allow if absent.
Defer to v0.2.

### Q-5. IDN support

v1 is ASCII-only. International domain names need Punycode
(domain) and Unicode case-folding (local part). Defer to v0.2.

### Q-6. Standalone server `/login` form rendering

When standalone-server mode receives `?next=https://kuma...`,
the `/login` GET form needs to carry it through to the POST
(usually as a hidden form field). SPEC §11 covers the data
model but not the form-rendering detail. **Action:**
implementation pins this; it's mechanical (hidden input).

### Q-7. Database lock contention under high concurrency

`BEGIN IMMEDIATE` for token issuance (§4.7) serializes
issuance system-wide. At expected loads (≤200 logins/sec
per NFR-4) this is fine. At unexpected loads, contention
could spike. Worth measuring during integration tests; if
problematic, switch the per-handle cap check to optimistic
(insert + count + evict-if-over-cap-via-trigger). Defer
unless measured.

---

## 16. Document conventions

- Updates to this spec MUST bump the version in the header.
- Each version SHOULD include a changelog entry summarizing
  what changed and why.
- Breaking changes to wire formats (token encoding, cookie
  format, schema) require a corresponding library major
  version bump.
- This file is the canonical wire-format reference.
  Implementation details that aren't wire-format-affecting
  belong in source comments, not here.

---

## Changelog

- **v0.2** (post-Phase-5): Three behavioral additions for first
  real-customer use (the webrevival forum):
  - §5.4 — `cookieSecure` config option (default `true`).
    Operators MAY disable for `http://localhost` development;
    MUST NOT in production. Closes AF-4.4.
  - §7.3 Step 0 — Origin / Referer validation as the new
    first short-circuit on POST /login. Closes AF-4.3.
  - §9.4 — `handleFromRequest(req)` programmatic API for
    library-mode middleware. Closes AF-2.8.
- **v0.1** (post-PRD-v0.11): Initial spec. Pinned all wire
  formats. Resolved sham-mail destination (null-route via
  Postfix). Deviated from PRD FR-27a on mechanism (DB-bound
  rather than URL-signed). Open questions in §15.
