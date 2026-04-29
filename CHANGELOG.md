# Changelog

All notable changes to `knowless` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning is [SemVer](https://semver.org/).

## [Unreleased]

- Caddy forward-auth Docker integration test (TASKS.md 6.8).

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
