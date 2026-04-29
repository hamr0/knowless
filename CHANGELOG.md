# Changelog

All notable changes to `knowless` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is [SemVer](https://semver.org/).

## Milestones

- **2026-04-28 — First customer integration shipped.** addypin
  merged its `try/knowless` branch and runs knowless as its
  auth+mail layer. ~1,150 LOC of bespoke auth/mail code removed,
  ~35 LOC of knowless wiring added (~33× reduction). Drove audit
  findings AF-7 → AF-17 across v0.1.5–v0.1.10.

## [Unreleased]

- **Turnkey Docker image** (`knowless/knowless-server:0.2.x`)
  bundling Postfix + null-route + the binary. Now meaningfully
  smaller and faster to build because v0.2.0 dropped the native
  compile dep.
- Caddy forward-auth Docker integration test (TASKS.md 6.8).
- `knowless-server --check-null-route`: CLI probe that submits a
  test message to `shamRecipient` and confirms the local MTA
  discarded it.

## [0.2.1] — 2026-04-29

**Operator visibility, opt-in.** Three event hooks + one method,
the full surface forum + addypin asked for during the v0.2.0
integration spike. The shape was negotiated against
`walk-away-at-v1.0.0` (PRD §6.3): every "obvious" addition was
deliberately rejected if it could be done in adopter or perimeter
code. See `knowless.context.md` § "What's NOT in knowless, and why"
for the rejected-by-design list (disposable-domain check, account-age
accessor, hashcash, `lookupMessageId()`, `onShamHit`).

### Added

- **`onMailerSubmit({messageId, handle, timestamp})` (AF-19).**
  Per-event hook fired on successful SMTP submission for *real*
  (non-sham) sends only. Adopters log it, build msg_id ↔ handle
  correlation maps, or pipe to structured logging. Knowless never
  stores the mapping. Sham branches deliberately do NOT fire this
  hook — that's the load-bearing NFR-10 invariant (would let a
  careless adopter log per-handle data and reopen the enumeration
  oracle that sham-work was designed to prevent).
- **`onTransportFailure({error, timestamp}) (AF-19).** Per-event
  hook fired on SMTP errors. No identity data — safe per-event,
  safe to alert on.
- **`onSuppressionWindow({sham, rateLimited, windowMs})` (AF-19).**
  Heartbeat hook fired every `suppressionWindowMs` (default 60s)
  with aggregate counters across all silent-202 branches: sham
  hits, `login_ip` cap, `create_ip` cap (counted both as sham and
  rate-limited when fall-through happens), and per-handle token-cap
  rotation. Heartbeats fire even when both counters are zero — a
  missing emission is itself diagnostic. Replaces a per-event
  `onShamHit` / `onRateLimitHit` design that would have leaked
  per-handle data through log lines; the windowed aggregate
  preserves the spike signal without per-call distinguishability.
- **`auth.verifyTransport()` method (AF-20).** Wraps
  `transport.verify()`. Resolves `Promise<true>` on non-rejection,
  rejects with the underlying error. Adopters call this explicitly
  when they want fail-fast on misconfigured SMTP at boot. **No
  auto-on-boot variant by design (AF-21).** Deployments where
  knowless starts before Postfix (docker-compose ordering, k8s
  readiness probes) would fail boot for the wrong reason.
- **`startLogin` silent-202 documented (AF-22).** New gotcha #19 in
  `knowless.context.md` and a Mode-A pointer in GUIDE.md make
  explicit that `startLogin` returns `{handle, submitted: true}`
  for every branch (real, sham, rate-limited, missing handle) by
  design. Operators who need branch visibility wire the v0.2.1
  hooks; the per-call return shape never reveals which branch ran.

### Changed

- **`store.insertToken` returns the eviction count.** Internal
  store-interface change: `insertToken` now returns the number of
  tokens evicted to make room for the new one (always `0` when
  `maxActive` is `0`). Used by `runSendLink` to count per-handle
  cap rotation events into the `rateLimited` counter. Adopters
  with custom stores implementing the SPEC §13 interface should
  update accordingly; the change is forward-compatible (returning
  `undefined` is treated as zero evictions).

### Documentation (forum + addypin negotiation outcome)

- **knowless.context.md § "What's NOT in knowless, and why"** —
  permanent record of three rejected-by-design additions
  (disposable-domain check, account-age accessor, per-IP hashcash)
  with the seam argument and walk-away-at-v1.0.0 framing. Future
  contributors evaluating "should X go in knowless?" run two tests
  before answering yes: identity layer vs behavior layer; mechanism
  living with policy.
- **GUIDE.md FAQ** — "Why doesn't knowless block disposable email
  domains?" + "How do I check how old a user is?" with adopter-side
  code patterns for both. Closes the most likely "but-can-it" requests.

### Internal

- Hook errors are caught and swallowed via a single `safeHook()`
  wrapper, matching the existing `onSweepError` contract. Knowless
  never crashes because an operator's observability sink threw.
- Suppression-window timer is `unref()`'d and only started when
  `onSuppressionWindow` is wired — adopters not using the hook
  spend zero `setInterval` slots on it.
- 16 new tests in `test/integration/v021-hooks.test.js` covering
  payload shapes, the sham-no-fire invariant, aggregation
  semantics, heartbeat behavior, counter reset, hook-error
  containment, and `verifyTransport()` resolve/reject paths.
  Test count: 192 → 207.

## [0.2.0] — 2026-04-28

**No native compile. One production dep.** Drops `better-sqlite3`
in favour of `node:sqlite` (Node stdlib). Adopters on long-LTS
distros (RHEL 8/9, Alma, Rocky, Amazon Linux 2) no longer need a
C++20 toolchain to `npm install knowless`.

### Breaking

- **Node floor bumped: `>=20.0.0` → `>=22.5.0`.** `node:sqlite`
  requires Node 22.5+; unflagged stable on Node 24 LTS. Node 20
  reaches EOL April 2026.
- **`better-sqlite3` removed from `dependencies`.** Down to one
  production dep (`nodemailer`). Transitive package count goes
  from ~40 to ~2. No `prebuild-install`, no `gcc`, no `make`,
  no Python during install.
- **Storage internals changed**, public API unchanged. The
  `createStore()` interface (SPEC §13) is byte-for-byte identical.
  All 192 tests pass on first run after the swap.

### Migration

- **For knowless library adopters:** ensure your runtime is
  Node 22.5+. If you pinned `better-sqlite3` somewhere yourself
  for unrelated reasons, that's now your call. Otherwise:
  ```sh
  npm install knowless@0.2.0
  ```
  No code changes on your side. Existing SQLite databases
  continue to work — same schema, same WAL mode, same
  prepared statements. Sessions and handles persist across
  the upgrade.
- **For `knowless-server` operators:** ensure the host runs
  Node 22.5+. If you ran `dnf install gcc-toolset-13` to get
  v0.1.x to compile, you can remove it after the upgrade —
  v0.2.0 doesn't need it. The systemd unit and env-var config
  are unchanged.
- **You may see one `ExperimentalWarning` from `node:sqlite`
  at first import** on Node 22.x. Suppress with `--no-warnings`
  or run on Node 24 LTS where the API is fully stable.

### Internal

- New `makeTransaction(db, fn)` adapter in `src/store.js`
  replaces `better-sqlite3`'s `db.transaction()` wrapper. Uses
  `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` directly — same
  serialisation guarantee for the transactional cap-check
  (SPEC §4.7) and account-deletion paths (FR-37a).
- Closes AF-18 (the addypin RHEL 8 deployment trap).

## [0.1.10] — 2026-04-28

addypin manual smoke continued. Two DX docs improvements; no code
changes.

### Documentation

- **GUIDE: "Local development setup" section (AF-16).** Covers the
  five flags that turn knowless from "production-tuned, defensive"
  to "developer-friendly, get-out-of-my-way" — `cookieSecure: false`,
  `devLogMagicLinks: true`, `maxLoginRequestsPerIpPerHour: 0`,
  `maxNewHandlesPerIpPerHour: 0`, `openRegistration: true`. Each
  flag explained with what it solves and a sharp warning about
  shipping it. Considered auto-disabling rate limits whenever
  `devLogMagicLinks: true` to save typing, but rejected the
  coupling — operators turning on `devLogMagicLinks` briefly to
  debug a single email in prod should NOT have rate limits silently
  dropped at the same time.
- **GUIDE: silent-miss debug line is now promoted as a feature
  (AF-17).** The `[knowless dev:<from>] silent-miss: handle for
  "X" does not exist (openRegistration=false)` stderr hint
  introduced in AF-7.2 was buried in the CHANGELOG; it now leads
  the dev-setup section. First-time closed-reg friction was costing
  every adopter the same ~30 min; the hint cuts that to seconds
  but only if you know it exists.

## [0.1.9] — 2026-04-28

addypin manual smoke turned up one real bug, one defaults footgun,
and one DX gap.

### Fixed

- **`auth.deriveHandle(email)` now normalizes the email before
  HMAC (AF-13).** Prior versions skipped `normalize()` while
  `auth.startLogin` and `POST /login` ran it — adopters using
  `deriveHandle` to precompute owner-keyed lookups got silent
  handle mismatches whenever email casing varied between
  create-time and click-time. Symptom was "user's records
  disappear after login," which is awful to debug. The bare
  `deriveHandle(emailNormalized, secret)` re-export still
  expects pre-normalized input — that contract is unchanged.

### Documentation

- **GUIDE flags the `failureRedirect` Mode-A footgun (AF-14).**
  Adopters running programmatic-only (`startLogin` without
  mounting `loginForm`) hit a default `failureRedirect = /login`
  pointing at a route they don't serve — expired/replayed
  magic-link clicks 302 to a 404. The GUIDE now leads with this
  in the Mode-A walkthrough and adds a callout in the config
  table. Default unchanged to avoid breaking Mode-B users with
  custom paths.
- **OPS.md §11b — MailHog dev workflow (AF-15).** `docker run
  mailhog/mailhog`, point knowless at port 1025, inspect every
  outgoing mail (including sham submissions) in a UI at port
  8025. Verifies `bodyFooter`, `subjectOverride`, and the
  URL-line-isn't-QP-soft-broken invariant without spinning up
  real Postfix.

## [0.1.8] — 2026-04-28

addypin round 4 — one small API addition + documentation polish.

### Added

- **`bypassRateLimit: true` arg on `auth.startLogin` (AF-10).**
  Trusted server-side callers (CLI workers, cron jobs, internal
  services on the same host as the web process) opt out of IP-
  based rate-limit accounting entirely — neither check nor
  increment for the `login_ip` and `create_ip` buckets. The per-
  handle token cap (`maxActiveTokensPerHandle`) is still enforced.
  Solves the "web + CLI sharing 127.0.0.1" starvation problem
  without requiring config divergence between processes. Throws
  on non-boolean. Do NOT plumb this from unauthenticated user
  input.

### Documentation

- **GUIDE Step 6 rewrite (AF-11).** `auth.handleFromRequest(req)`
  is now front-and-centre as the load-bearing primitive for
  adopter authorization. Worked Express-style examples for
  `requireAuth` middleware and per-handle CRUD gating. Replaces
  the previous "(coming in v0.2.0)" placeholder with the v0.1.1
  reality.
- **OPS.md §11a "Multi-process deployments" (AF-12).** Half-page
  guide covering when sharing one DB across processes is safe
  (WAL mode, default), sweeper redundancy semantics, rate-limit
  enforcement-vs-accounting under sharing (and why AF-10
  matters), `auth.close()` behavior, and the cross-machine no-go.

## [0.1.7] — 2026-04-28

addypin integration round 3 — one small API addition.

### Added

- **`subjectOverride` arg on `auth.startLogin`.** Per-call subject
  replaces the factory `subject` for that one mail. Validated by
  the same rules (ASCII, ≤60 chars, no CR/LF) and throws on invalid
  — programmer error, not silent miss. The subject is decided
  before the hit/miss branch, so sham and real submissions carry
  the same subject and no observer can distinguish outcomes by
  subject. Spam-trigger warnings (`!!`, `FREE`, etc.) do not throw;
  the caller has more context. Closes AF-9.1.

  Example: addypin sends three magic-link variants with distinct
  subjects:

  ```js
  await auth.startLogin({
    email, nextUrl, sourceIp,
    subjectOverride: `Confirm your pin: ${shortcode}`,
  });
  ```

## [0.1.6] — 2026-04-28

addypin integration round 2 — one correctness fix (HMAC key handling)
and one common-want feature (operator footer on auth mail).

### Breaking

- **The `secret` is now hex-decoded before being used as the HMAC
  key.** Prior versions passed the 64-char hex string to
  `crypto.createHmac` as ASCII bytes — same 256 bits of entropy, but
  a different HMAC output than systems that hex-decode first. The
  PRD already implied 32 bytes ("≥64 hex chars (32 bytes)"); the
  implementation matched the spec on key length but used the wrong
  key bytes. **Effect:** every handle and session signature changes
  on upgrade. Existing sessions invalidate (users re-login); existing
  pre-seeded handles must be re-derived. There are no production
  knowless deployments yet (addypin and webrevival are both pre-prod),
  so we lock the correct semantics in before v1.0 freezes. Closes
  AF-8.1.
- The startup secret check now also validates that the secret is
  64-char lowercase hex (`/^[a-f0-9]{64,}$/i`). Mixed-case secrets
  must be lowercased.
- `deriveHandle()` and `signSession()` accept `Buffer` directly for
  adopters who already hold raw 32-byte keys.

### Added

- **`bodyFooter: string`** config option — append a constant operator
  footer to every magic-link email after the standard `"-- "` (RFC
  3676) signature delimiter. Constraints (deliberately strict to
  preserve the URL-line invariant and 7bit body encoding):
  - ASCII only (no unicode middle-dot — use `|` or `-`)
  - ≤ 240 chars, ≤ 4 lines
  - No CR
  - No `http://` / `https://` substrings (would conflict with the
    magic-link line and trigger MTA URL-rewriting heuristics)
  Validated at factory startup; fails fast on misconfiguration.
  Closes AF-8.2.
- `validateBodyFooter()` exported alongside `composeBody` for adopters
  who want to validate operator-supplied footers themselves.
- `secretBytes()` exported from `./handle.js` (and via the package
  root) for adopters who want to coerce a hex string to raw 32-byte
  HMAC key on their own boundaries.

### Migration from 0.1.5

- **Pre-seeded handles must be re-derived.** `deriveHandle('alice@x',
  SECRET)` returns a different value in 0.1.6. If you stored handles
  in any external system, recompute them. Closed-registration users
  must re-seed.
- **Active sessions invalidate.** Users will need to log in again
  after the upgrade. Plan for a single-shot user-visible logout.
- **Magic links in flight at upgrade time** become invalid (token
  hashes are stored as HMAC outputs and the key changes). 15 min
  TTL by default; a brief read-only window during deploy is enough.
- `knowless-server --check-null-route`: CLI probe that submits a
  test message to `shamRecipient` and confirms the local MTA
  discarded it. Honest answer to "does the operator's null-route
  actually work?" — the library can know what it submitted but
  not what the MTA did, so this is the closest we can get.
  Targeted for v0.2.0.

## [0.1.5] — 2026-04-28

addypin POC findings round. Adds programmatic magic-link entry
(unblocks "use first, claim later" UX patterns), one ergonomic
helper, two safety/diagnostic fixes, and three doc updates.

### Added

- **`auth.startLogin({email, nextUrl?, sourceIp?})`** — programmatic
  entry that runs the same 12-step sham-work flow as `POST /login`
  but skips Origin/honeypot (no browser context). Returns
  `{handle, submitted: true}` — same shape on rate-limit / sham /
  real to preserve FR-6 timing equivalence. Throws only on
  programmer error. SPEC §7.3a. Closes AF-7.3.
- **`auth.deriveHandle(email)`** — instance method that uses the
  configured secret. Lets adopters compute owner-handles outside
  HTTP context without spreading the secret across modules. Closes
  AF-7.4.
- **GUIDE.md "Two adoption modes" section** — Mode B (register-
  first, the form) and Mode A (use-first-claim-later, programmatic).
  Both supported, pickable per-action.
- **GUIDE.md "Constraints / install footprint" section** — direct
  deps, transitive count, deprecation-warning context. Closes AF-7.7.

### Changed

- **`devLogMagicLinks` lines now tagged with `cfg.from`** —
  `[knowless dev:auth@app.example.com] magic link: ...`. Disambiguates
  multi-instance dev logs. Closes AF-7.6.
- **`devLogMagicLinks` + sham + SMTP-fail now prints a one-line
  silent-miss hint** instead of staying silent. Surfaces the
  closed-registration-is-on case that previously cost adopters
  ~30min of debugging. Strictly opt-in dev mode. Closes AF-7.2.

### Safety / diagnostics

- **`createMailer` validates `transportOverride` at startup.** A
  malformed override (e.g. an options bag mistaken for a transport)
  throws fast with a pointed error instead of failing at first
  submission. Closes AF-7.5.
- **`POST /login` warns once on stderr when `Content-Length > 0`
  but body is empty.** Catches the common non-Express trap of
  mounting `express.urlencoded()` or similar body parsers ahead of
  `auth.login` (which consumes the stream itself). One warning per
  handler instance. Closes AF-7.1.

### Documentation

- **SPEC §7.3a** specifies the programmatic entry's contract: which
  steps it skips (Origin, honeypot), why FR-6 still holds, and
  what programmer-error throws look like.
- **GUIDE.md** adds two traps for non-Express integrators (body-
  parser conflict, Origin requirement) and a worked Mode-A example.
- **knowless.context.md** lists `startLogin` + `deriveHandle` in the
  public API table and adds gotchas 15–16.

## [0.1.4] — 2026-04-28

First real-world integration release. Bugs and ergonomics surfaced
by the addypin team's spike on v0.1.3, plus two minor security
hardenings that fell out of the audit.

### Added

- **`auth.revokeSessions(handle)`** — log out everywhere without
  deleting the account. Returns the number of sessions removed.
  Closes AF-6.1.
- **`devLogMagicLinks: true`** opt-in — when SMTP fails AND this
  flag is set, prints the magic link to stderr so a developer can
  click through. Off by default; never fires for sham (silent-miss)
  submissions; never replaces real SMTP delivery on success. Closes
  AF-6.2.
- **CIDR support in `trustedProxies`** — accept `10.0.0.0/8`,
  `fd00::/8`, etc. in addition to plain IPs. Uses `node:net`
  `BlockList`, no new dep. Closes AF-6.3.

### Security

- **CSRF on `POST /logout`.** Origin/Referer validation now mirrors
  `POST /login` (AF-4.3). Without this, a malicious page could
  force-logout an authenticated victim. Closes AF-6.4.
- **`confirmationMessage` is HTML-escaped before rendering.** The
  message is operator-config (not user input), but a careless
  operator interpolating user data into it would have produced an
  XSS. The whole message is now escaped before `{email}` substitution
  (which was already escaped). Operators who want HTML in the
  confirmation message must pre-render upstream. Closes AF-6.5.

### Documentation

- **SPEC §10.2** documents the new logout Origin check.
- **SPEC §7.3 Step 0** adds an explicit "do NOT add a CSRF token
  upstream — the Origin/Referer whitelist IS the CSRF defense"
  note for adopters. Closes AF-6.6.
- **GUIDE.md** front-matter now leads with the v1.0.0 walks-away
  commitment. Procurement signal: a library that has explicitly
  committed to *not growing* is a different risk profile from a
  typical OSS package. Closes AF-6.7.

## [0.1.3] — 2026-04-28

Standalone-deployment release. The library could already be embedded
in a Node service since v0.1.0; v0.1.3 closes the operator-side story
so a self-hoster can `npx knowless-server` and have a working
forward-auth gate in front of arbitrary services.

### Added

- **Standalone server** — `bin/knowless-server` ships a self-contained
  HTTP server for forward-auth deployments. Configuration is via
  `KNOWLESS_*` env vars (PRD FR-49 to FR-56); CLI flags are inspection-
  only:
  - `--help` lists every env var with default and purpose
  - `--version` prints the package version
  - `--print-config` prints effective config with secrets redacted as
    `<set>` / `<unset>`
  - `--config-check` validates required vars are present, the secret
    is ≥64 hex chars, the SMTP host is reachable, and the DB path is
    writable. Suitable for systemd `ExecStartPre`.
- `config.example.env` — documented sample env file at repo root.
  Operators copy this and load via `node --env-file=...` or systemd
  `EnvironmentFile=`. Library does not auto-load it (FR-56).
- Startup log block (FR-54) with effective config, SMTP check result,
  and listening address.
- **`OPS.md`** — full operator setup walkthrough: Postfix
  outbound-only install, **required** null-route for sham mail,
  SPF / DKIM / PTR / DMARC, port-25 verification, hardened systemd
  unit, Caddy / nginx / Traefik forward-auth examples, Tailscale
  pattern, reverse-proxy rate limiting, fail2ban / Turnstile
  references, backup guidance.

## [0.1.2] — 2026-04-28

P2 hardening sprint — completes the audit-finding backlog opened during
the v0.1.0 self-review. Defense-in-depth and test-strength improvements;
no behavior changes for correct callers.

### Added

- `onSweepError(err)` config hook — invoked when the periodic sweeper
  catches an exception (DB corruption, disk full, etc.). Best-effort:
  hook errors are swallowed and the sweeper keeps running. `auth._sweep()`
  is now exposed for tests and operator scripts to trigger a sweep on
  demand. Closes AF-5.3.

### Security

- **Stored-hash integrity check.** All `handle` / `tokenHash` / `sidHash`
  arguments are validated as 64-char lowercase hex at the store boundary
  before any DB read or write. A bug elsewhere passing a wrong-format
  value now fails fast with an actionable error instead of silently
  corrupting the table. Closes AF-5.4.

### Tests

- Rate-limit window-boundary precision: last ms of window N is still
  limited; first ms of N+1 is fresh. Limit semantics: "exceeded" fires
  AT the limit, not strictly above. Closes AF-5.1.
- Cookie parser hardening: 8 edge-case scenarios (whitespace,
  duplicates, malformed pairs, RFC 6265 cases) verifying the existing
  parser is robust. Closes AF-5.2.

## [0.1.1] — 2026-04-29

First-customer scope (the webrevival forum) review identified one
ergonomic gap and elevated three P1 hardening items to "must ship
before first real use." All five closed in this release.

### Added

- `auth.handleFromRequest(req)` — programmatic session resolution
  for in-process middleware. Returns `string | null` (handle on
  valid session, null on any failure). Recommended integration
  point for Express / Fastify / Hono `requireAuth` middleware. SPEC
  §9.4. Closes AF-2.8.
- `cookieSecure` config option (default `true`). Operators MAY set
  `false` for `http://localhost` development; the library emits a
  stderr warning at startup. MUST NOT be `false` in production.
  SPEC §5.4. PRD FR-30 revised. Closes AF-4.4.

### Security

- **CSRF defense on `POST /login`.** New Origin/Referer header
  validation as Step 0 of the login flow. Both headers absent →
  allow (curl, programmatic). Either present → host must equal
  `cookieDomain` or be a subdomain. Cross-origin / unparseable →
  silent short-circuit, no DB write, no mail. Same response shape
  as a legitimate hit, so the attacker's measurement learns
  nothing the request shape didn't already expose. SPEC §7.3 Step
  0. Closes AF-4.3, resolves SPEC §15 Q-4.

### Tests

- AF-4.1: concurrent token issuance under cap contention.
  10-parallel logins with `maxActiveTokensPerHandle=3` must end at
  exactly 3 active rows. Pins the SPEC §4.7 BEGIN IMMEDIATE
  contract.
- AF-4.2: SMTP-failure response-uniformity test. Stubs
  `mailer.submit` to throw and asserts the response shape is
  identical to a successful login. Pins NFR-10.
- 12 new tests total. 122 tests passing on Node 20+.

### Notes

The published `0.1.0` does not have these. Adopters who installed
`0.1.0` should `npm update knowless` to pick up the CSRF defense
and the localhost-dev-friendly cookieSecure option.

[0.1.1]: https://github.com/hamr0/knowless/releases/tag/v0.1.1

## [0.1.0] — 2026-04-28

First public release. Library-mode auth flow is complete and
production-grounded; standalone-server deployment shape ships in 0.2.0.

### Added — library

- `knowless({ secret, baseUrl, from, ... })` factory wires store,
  mailer, handlers, and a periodic sweeper.
- Five framework-agnostic HTTP handlers: `login`, `callback`, `verify`,
  `logout`, `loginForm`. Each is `(req, res) => Promise<void>`,
  mountable on Express / Fastify / Hono / `node:http`.
- `deleteHandle(handle)` for GDPR right-to-erasure (FR-37a). Removes
  the handle, all active tokens, all active sessions, and the
  `last_login_at` row in one transaction.
- `close()` stops the sweeper and the SQLite handle for graceful
  shutdown.

### Added — privacy / security

- **Silent-on-miss with practical timing equivalence (FR-6).** The
  registered-hit and silent-miss paths are practically
  indistinguishable: the in-tree timing test (SPEC §14, 1ms
  delta-mean bar) measures `Δ_mean = 0.002ms` on commodity hardware
  — 500× under the bar. Achieved via the four-step sham-work
  pattern in SPEC §7.3.
- **Sham mail goes to a configurable null-route address** (default
  `null@knowless.invalid`), not to the unregistered email. Real
  users never receive unsolicited mail. Operator's MTA discards via
  `transport_maps`. Documented in OPS.md (forthcoming) and SPEC §7.4.
- **Plaintext email never persisted.** Handle is `HMAC-SHA256(secret,
  normalized_email)` per SPEC §3. DB-only leak yields opaque hashes,
  not a mailing list.
- **Plain-text 7bit ASCII mail** with the magic-link URL on its own
  line (FR-17). Sidesteps the v0.11 POC finding that nodemailer's
  default quoted-printable encoding wraps the URL with `=\n` soft
  breaks. Implemented by composing the RFC822 message ourselves and
  using nodemailer only as the SMTP submission transport.
- **Tokens stored as SHA-256 hashes** at rest (FR-13). 256-bit
  entropy from `node:crypto.randomBytes`, base64url-encoded raw
  (43 chars). Single-use; used / expired tokens are swept on a
  schedule.
- **Session cookies are signed** with HMAC-SHA256 (`sess\0`
  domain-separated), `Secure; HttpOnly; SameSite=Lax`. Server-side
  expiry enforced via stored row; cookie expiry is advisory.
- **Replay protection** via atomic `markTokenUsed`. Replays return
  the same response as expired or never-existed.
- **Forward-auth return URL** via DB-bound `next_url` on the token
  row (SPEC §11). Same security as URL-signing without bloating the
  magic link. Cross-domain `next` is silently dropped per the
  cookie-domain whitelist; `javascript:` and other schemes
  rejected.
- **Per-IP and per-handle rate limiting** with safe defaults
  (FR-38, FR-39, FR-40). Per-IP login cap: 30/hour. Per-handle
  active token cap: 5 (newest replaces oldest). Per-IP
  account-creation cap (open-registration only): 3/hour.
- **Honeypot field** in the login form (FR-41), `aria-hidden="true"`
  and `tabindex="-1"` so screen-reader users aren't trapped.
- **No JS, no external resources** in any HTML page (FR-22). Inline
  CSS only. Login form works in text-mode browsers.

### Added — storage

- `better-sqlite3`-backed store implementing the SPEC §13 interface.
  WAL journal mode, prepared-statement caching, transactional
  token issuance with cap-eviction, transactional `deleteHandle`.
- Periodic sweeper (default 5 min) deletes expired tokens (with
  24h grace for redeemed ones), expired sessions, and rate-limit
  rows older than 24h.

### Added — docs

- `docs/01-product/PRD.md` (v0.12) — product requirements.
- `docs/02-design/SPEC.md` (v0.1) — wire formats, byte layouts,
  algorithms.
- `docs/03-tasks/TASKS.md` (v0.1) — 8-phase implementation plan.
- `README.md`, `GUIDE.md`, `knowless.context.md`, `CHANGELOG.md`.

### Tests

- 102 tests passing on Node 20+ and Node 22+.
- Testing Trophy: ~50 unit tests (handle, token, session, form,
  abuse), ~50 integration tests (store, mailer, full-flow,
  sham-work, forward-auth-next, library-mode), 1 timing test
  (FR-6 acceptance gate).

### Production deps

- `nodemailer` ^8.0.7 — SMTP submission to localhost MTA.
- `better-sqlite3` ^11.0.0 — synchronous SQLite via N-API.

Two deps total. Both stable, MIT-licensed, well-maintained.

### Audience

Two primary audiences (PRD §4):

1. **In-app services where auth is the only legitimate email need.**
   Indie tools, side projects, internal dashboards, member areas,
   self-hosted apps. Library mode.
2. **Self-hosters gating services without good auth.** Uptime Kuma,
   AdGuard Home, Pi-hole, Sonarr, Jellyfin admin, etc. Standalone
   server mode (ships in 0.2.0).

### Known limitations (deliberate)

- **ASCII-only email addresses** in v0.1. IDN support deferred to
  0.2 (SPEC §15 Q-5).
- **Standalone server not yet shipped.** v0.1.0 is library-mode
  only. Use as `import { knowless } from 'knowless'` and mount
  the handlers on your existing HTTP framework.
- **No standalone server `bin/knowless-server`** — that's 0.2.0.
  Forward-auth deployments wait for 0.2.0 unless you write a small
  `node:http` wrapper yourself; see GUIDE.md for the ~30-line
  pattern.
- **Postfix on localhost is the only outbound mail transport.**
  No remote SMTP, no Mailgun / Postmark / SES (intentional, see
  PRD §16.2).

### License

Apache 2.0 with NOTICE preservation. See `LICENSE` and `NOTICE`.

[Unreleased]: https://github.com/hamr0/knowless/compare/v0.1.1...HEAD
[0.1.0]: https://github.com/hamr0/knowless/releases/tag/v0.1.0
