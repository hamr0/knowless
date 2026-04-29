# knowless — Implementation task list

**Source documents:** [`docs/01-product/PRD.md`](../01-product/PRD.md), [`docs/02-design/SPEC.md`](../02-design/SPEC.md)

## Status (current)

> **Phases 0 through 7 are shipped in v0.1.0 → v0.1.8.** The unchecked
> boxes below are the original implementation plan, preserved as a
> historical reference. For shipped scope, read [`CHANGELOG.md`](../../CHANGELOG.md).
> For audit-finding status, read PRD §17.3.

**addypin integration: DONE.** addypin merged its `try/knowless`
branch — knowless is its auth+mail layer in production. Net delta:
~1,150 LOC removed (custom mailer, inbound CLI, login plumbing,
pin-confirmation state machine, fingerprint helpers, matching tests),
~35 LOC added. ~33× reduction on the auth/mail surface. The
integration drove audit findings AF-7 → AF-17, all shipped in
v0.1.5–v0.1.10. See PRD §17 for the closed backlog.

**No open items. v0.2.1 is feature-complete.**

Three items previously tracked here as "open" were stress-tested
against walk-away-at-v1.0.0 (2026-04-29) and cut. Closures recorded
here for posterity:

1. **6.8 — Caddy forward-auth Docker integration test — CLOSED.**
   The contract is two HTTP responses + one header (`/verify` →
   200+`X-User-Handle` or 401). Every hop is already covered by
   `forward-auth-next.test.js` + `cli.test.js`. addypin runs
   knowless behind Caddy in production — that is the integration
   test, stronger adopter signal than any docker-compose CI. Removed
   as a v1.0.0 graduation criterion (PRD §6.1).
2. **7.6 — Cross-link from sibling-project READMEs — MOVED.** Not a
   knowless task; the README edits live in the addypin and gitdone
   repos. Tracked there now, not here.
3. **v0.2.x backlog (turnkey Docker image + `--check-null-route`
   CLI) — CUT.** Both fail the walk-away discipline. Docker image
   doesn't solve the actual operator problem (DNS / port-25 work
   still required) and commits the library to forever-rebuilds on
   Postfix CVEs. `--check-null-route` is achievable in three lines
   of `swaks` + `tail` — documented in GUIDE.md Step 3 instead.
   Full rationale in CHANGELOG.md "Cut from v0.2.x backlog".

**v1.0.0 graduation status:** 12/12 (post-cut). All shippable
criteria met. addypin runs knowless in production. Standalone-server
adoption (the open §6.2 item) is tracked outside this repo and does
not gate v1.0.0 — that's a 30-day post-launch criterion, not a
graduation gate.

## A note on Docker

Docker is mentioned in this repo as **deployment shape only** — a
self-hoster may choose to containerize knowless-server alongside
their own Postfix, with their own Dockerfile or docker-compose.
Knowless does not ship an official image. Postfix CVE cadence makes
shipping a bundled image incompatible with walk-away-at-v1.0.0.
If community Dockerfiles emerge, OPS.md will link to them.

---

## Ground rules (carry across all phases)

- **POC has graduated.** `poc/` is throwaway reference. Do not
  copy code from it; reimplement cleanly per SPEC. Delete `poc/`
  at the end of Phase 5 unless retained as a benchmark.
- **Vanilla → stdlib → external, strictly.** Two production
  deps are baselined: `nodemailer`, `better-sqlite3`. No third
  dep without explicit justification revisited at AGENT_RULES
  External Dependency Checklist.
- **Build incrementally.** One module at a time. Each MUST work
  on its own (with tests) before integrating with the next.
- **Tests after design stabilises, not during.** Do NOT TDD
  unstable interfaces. Each module: implement → make it work →
  freeze the public surface → write tests against that surface.
  The Testing Trophy applies (few unit, many integration, some
  e2e).
- **No speculative code.** Every line earns its place. No
  "might need this later." If a feature is in §14 of the PRD
  (NO-GO), refuse politely and move on.
- **Plain JS + JSDoc, no TypeScript source, no build step.**
  Per PRD NFR-15. JSDoc is the type system.
- **Docs are deliverables.** Each phase's "ship-it" gate
  includes the docs delta, not just the code.

---

## Phase 0 — Project skeleton

**Goal:** A minimal, runnable repo layout that the rest of the
phases drop into without rework.

**Tasks:**
- [ ] 0.1 — Create `package.json` at repo root: name `knowless`,
      version `0.1.0`, type `module`, `engines.node >= 20`,
      bin entry `bin/knowless-server`, deps `nodemailer` +
      `better-sqlite3`, devDeps empty (we use `node:test`).
- [ ] 0.2 — Create directory skeleton: `src/`, `test/unit/`,
      `test/integration/`, `bin/`. Empty `.gitkeep` files where
      needed.
- [ ] 0.3 — Add `npm test` script that runs `node --test
      'test/**/*.test.js'`.
- [ ] 0.4 — Add `npm run lint` script — one-line stdlib check,
      e.g. `node --check src/**/*.js`. (No external linter for
      now; if one earns its place later, add then.)
- [ ] 0.5 — Update root `.gitignore` if needed (it already
      excludes node_modules and SQLite artifacts).

**Deliverable:** `npm install && npm test` runs cleanly with
zero tests.

**Estimated effort:** ~30 min.

---

## Phase 1 — Foundation: pure crypto modules

**Goal:** Three small, pure modules with no I/O. Each does one
thing, has unit tests, and is reviewable in isolation.

**Tasks:**
- [ ] 1.1 — `src/handle.js`: implement `normalize(email)` and
      `deriveHandle(email, secret)` per SPEC §2 and §3. Export
      both. JSDoc the public surface.
- [ ] 1.2 — `test/unit/handle.test.js`: cover the determinism
      property, the normalization rules (whitespace, case,
      ASCII rejection, regex acceptance/rejection cases), and
      that different secrets produce different handles for the
      same email.
- [ ] 1.3 — `src/token.js`: implement `issueToken()` (returns
      `{raw, hash}`) and the helper `hashToken(raw)` per SPEC
      §4.1. Pure; no DB.
- [ ] 1.4 — `test/unit/token.test.js`: hash determinism, raw
      length (43 base64url chars), hash length (64 hex chars),
      no two `issueToken()` calls collide.
- [ ] 1.5 — `src/session.js`: implement `signSession(sid_b64u,
      secret)`, `verifySessionSignature(cookie, secret)` (returns
      `sid_b64u | null`) per SPEC §5.2. The session-DB lookup
      lives in handlers; this file is pure crypto only.
- [ ] 1.6 — `test/unit/session.test.js`: signature verifies,
      tampered cookies rejected (timing-safe compare), wrong
      secret rejects, malformed inputs return null cleanly.

**Acceptance:**
- All three modules pass `npm run lint`.
- All three test files pass `npm test`.
- No I/O, no global state, no async. Pure functions only.
- Public surface ≤ 8 exported symbols across the three files.

**Estimated effort:** ~2 hours.

---

## Phase 2 — Storage and abuse-protection logic

**Goal:** The `store.js` interface implementation plus the
non-HTTP rate-limit / honeypot logic. Both can be tested in
integration with `:memory:` SQLite without touching HTTP.

**Tasks:**
- [ ] 2.1 — `src/store.js`: implement the `createStore(dbPath)`
      factory returning the full Store interface per SPEC §13.
      Includes DDL (SPEC §6.1), prepared-statement caching, and
      transactional `insertToken` per SPEC §4.7.
- [ ] 2.2 — `src/store.js` migration plumbing: read meta.schema_version,
      apply DDL idempotently if missing. v1 = schema_version 1.
- [ ] 2.3 — `test/integration/store.test.js`: cover every public
      method. Use `:memory:` dbs for speed. Critical paths:
      handle CRUD, token insert+evict transaction, sham-token
      refusal in `verifyToken` flow (Phase 4 will cross-test
      this), session lifecycle, rate-limit window roll-over,
      `deleteHandle` cleans tokens + sessions + last_login in
      one transaction.
- [ ] 2.4 — `src/abuse.js`: `determineSourceIp(req,
      trustedProxies)` (SPEC §7.6 conventions, FR-42),
      `rateLimitExceeded(store, scope, key, limit, windowMs)`,
      `rateLimitIncrement(store, scope, key, windowMs)`. Pure
      functions over the store; no HTTP knowledge.
- [ ] 2.5 — `test/integration/abuse.test.js`: rate-limit window
      semantics (count rolls when window changes), trusted-proxy
      IP determination correctness, IP spoof rejection when
      caller is not in `trustedProxies`.

**Acceptance:**
- `:memory:` integration tests pass, no flakes.
- Sweeper methods (`sweepTokens`, `sweepSessions`,
  `sweepRateLimits`) prove they actually delete what they claim.
- `BEGIN IMMEDIATE` transaction in `insertToken` is verified to
  serialize concurrent inserts (smoke test with a few
  setImmediate-loop simultaneous inserts).

**Estimated effort:** ~4 hours.

---

## Phase 3 — Mail composition + form HTML

**Goal:** Two more pure modules: composing the outbound mail and
serving the hardcoded HTML pages. Validates that we hit the
SPEC §12 byte-for-byte requirements (7bit ASCII, URL on own
line, header whitelist).

**Tasks:**
- [ ] 3.1 — `src/mailer.js`: `createMailer({smtpHost, smtpPort,
      from})` returns `{ submit({to, subject, body}) }`.
      Internally configures nodemailer with `textEncoding:
      '7bit'` per SPEC §12.4. Validates body is ASCII before
      submission; throws if non-ASCII slipped past config
      validation.
- [ ] 3.2 — `src/mailer.js`: `composeBody({tokenRaw, baseUrl,
      linkPath, lastLoginAt})` returns the plain-text body per
      SPEC §12.2. Pure, no I/O. The mailer module re-exports
      this for handlers to call directly.
- [ ] 3.3 — `test/integration/mailer.test.js`: use
      `streamTransport` to capture raw bytes. Assert: header
      set is exactly the SPEC §12.1 whitelist (no extras),
      `Content-Transfer-Encoding: 7bit`, body is ASCII-only,
      magic link URL appears on its own line, last-login line
      appended only when timestamp is set.
- [ ] 3.4 — `src/form.js`: `renderLoginForm({loginPath,
      honeypotName, confirmationMessage, echoedEmail})` returns
      a complete HTML page string per SPEC §7.5 and FR-22 / FR-23.
      Pure string-building.
- [ ] 3.5 — `test/unit/form.test.js`: HTML escapes the echoed
      email; honeypot has `aria-hidden="true"` and
      `tabindex="-1"`; no `<script>` anywhere; no external URLs
      anywhere.

**Acceptance:**
- A captured `streamTransport` message round-trips through a
  trivial QP-decoder and the URL extracts cleanly without
  modification (the v0.11 POC finding stays fixed).
- Form HTML validates as HTML5 with a stdlib check (or a
  one-line external if needed — but try stdlib first).

**Estimated effort:** ~2 hours.

---

## Phase 4 — HTTP handlers (the integration piece)

**Goal:** Wire up the six handlers (login, callback, verify,
logout, plus the GET /login form and the optional GET /verify
healthcheck). This is the phase where the sham-work pattern
goes in for real.

**Tasks:**
- [ ] 4.1 — `src/handlers.js`: `createHandlers({store, mailer,
      config})` returns `{ login, callback, verify, logout,
      loginForm }`. Handlers are framework-agnostic
      `(req, res) => Promise<void>`.
- [ ] 4.2 — Implement `login` per SPEC §7.3 — all 12 numbered
      steps, including the equivalent-work region from step 4
      onward and the `is_sham` token insertion on miss.
- [ ] 4.3 — Implement `validateNextUrl(raw, cookieDomain)` per
      SPEC §11.2.
- [ ] 4.4 — Implement `callback` per SPEC §8.2, including the
      uniform-failure redirect to `loginPath`.
- [ ] 4.5 — Implement `verify` per SPEC §9 (forward-auth hot
      path).
- [ ] 4.6 — Implement `logout` per SPEC §10.
- [ ] 4.7 — `test/integration/full-flow.test.js`: end-to-end
      against `:memory:` SQLite + `streamTransport` mailer.
      - happy path: POST /login → extract token from captured
        mail → GET /auth/callback → assert Set-Cookie set →
        GET /verify with cookie → 200 + X-User-Handle
      - replay: same token a second time → 302 to /login,
        no cookie
      - expired token: fast-forward `Date.now()` past TTL →
        same as replay
      - bad cookie: garbled, missing dot, wrong sig, expired →
        all return 401 silently
      - logout: POST /logout → cookie cleared, subsequent
        /verify returns 401
- [ ] 4.8 — `test/integration/sham-work.test.js`:
      - silent-miss path inserts a token row with `is_sham = 1`
      - `verifyToken` of a sham token returns null
      - sham mail's recipient is the configured `shamRecipient`,
        not `email_norm`
- [ ] 4.9 — `test/integration/forward-auth-next.test.js`:
      - POST /login with valid `?next=https://kuma.example.com/x`
        when cookieDomain=`example.com` → token row has
        `next_url` set
      - GET /auth/callback redeeming that token → 302 Location
        is the bound URL
      - POST /login with cross-domain `next` → silently dropped,
        token row has `next_url = null`, redirect on redeem is
        the configured default
- [ ] 4.10 — `test/integration/timing.test.js`: the FR-6 1ms
      bar test per SPEC §14. Runs as part of `npm test` but
      with a marker that allows skipping in noisy CI runners
      (rare; document the policy).

**Acceptance:**
- All integration tests pass.
- The timing test passes locally (CI skip is allowed only with
  a documented environmental reason; the test exists and is
  green on the dev machine).
- No handler reads or writes outside of (`store`, `mailer`,
  `config`, `req`, `res`). No global state.

**Estimated effort:** ~6–8 hours. The longest phase.

---

## Phase 5 — Library factory + sweeper

**Goal:** The public `knowless({ ... })` factory that wires
everything together. The user-facing 6-line integration.

**Tasks:**
- [ ] 5.1 — `src/index.js`: `knowless(options)` factory.
      Validates required config (FR-47, FR-48). Constructs
      store, mailer, handlers; returns the public API surface
      (login handler, callback handler, verify handler, logout
      handler, loginForm handler, plus `deleteHandle(handle)`
      passthrough for FR-37a).
- [ ] 5.2 — `src/index.js`: starts the periodic sweeper per
      FR-13 (every 5 min default; configurable). On `close()`,
      sweeper is stopped. `unref()` the timer so a parent app
      can exit.
- [ ] 5.3 — `test/integration/library-mode.test.js`: the
      README-quality six-line example from PRD §5.1 works
      against a built knowless instance: spin up an Express
      app, mount the handlers, run the full flow.
- [ ] 5.4 — Delete `poc/` directory unless retained as a
      benchmarked reference. If retained, add a top-of-file
      banner in each POC file: "POC artefact, not part of
      runtime; see src/." Update `poc/README.md` accordingly.

**Acceptance:**
- A new project can `npm install <local-knowless>`, write the
  example from PRD §5.1, and have it work end-to-end.
- Closing the library cleanly stops the sweeper (no zombie
  timers).

**Estimated effort:** ~2 hours.

---

## Phase 6 — Standalone server (CLI)

**Goal:** `npx knowless-server` works as a self-contained
forward-auth service. This is the deployment shape PRD §4.2
targets (self-hosters gating Kuma / AdGuard / etc.).

**Tasks:**
- [x] 6.1 — `bin/knowless-server`: shebang + ESM. Uses
      `node:util parseArgs`. Implements exactly the four
      flags from FR-51 (`--help`, `--version`, `--print-config`,
      `--config-check`). Refuses any other flag.
- [x] 6.2 — Env-var loader: read every `KNOWLESS_*` var per
      FR-49, map to the options object, refuse to start with a
      clear error pointing at the missing var (FR-55).
- [x] 6.3 — `--print-config` and `--config-check`: load config
      same way as runtime, redact secrets as `<set>`, validate
      SMTP host reachable + DB path writable.
- [x] 6.4 — `node:http` server: route POST /login → loginHandler,
      GET /login → loginForm, GET /auth/callback → callback,
      GET /verify → verify, POST /logout → logout. Default
      port from env `KNOWLESS_PORT` or 8080.
- [x] 6.5 — Startup log block per FR-54: effective config
      (with secrets redacted), SMTP connection check result,
      listening port — single block to stdout.
- [x] 6.6 — `config.example.env`: ship at repo root with every
      `KNOWLESS_*` var, its default, and a one-line comment
      per FR-56.
- [x] 6.7 — `test/integration/cli.test.js`: spawn the binary
      as a subprocess, hit it with curl-equivalent (node:http
      requests), validate the responses match SPEC §7–§10.
- [ ] 6.8 — `test/integration/forward-auth-caddy.test.js`
      (optional, gated on `docker` available): run the server
      in a container plus a Caddy container with `forward_auth`
      configured, verify the round-trip from "request to
      protected service → 401 → /login → magic link click →
      303 → protected service serves request." If Docker isn't
      available, skip with a clear message. (Stub-skip placeholder
      added in cli.test.js; full Docker harness deferred.)

**Acceptance:**
- `npx knowless-server --help` prints all env vars and exits 0.
- `npx knowless-server --config-check` with bad config exits
  non-zero with a useful message.
- The cli integration test passes.
- The Caddy integration test passes locally (skip-on-no-docker
  is acceptable for CI but test exists for manual run).

**Estimated effort:** ~4 hours.

---

## Phase 7 — Docs and ship

**Goal:** The library is discoverable, the operator commitments
are documented, the package is on npm.

**Tasks:**
- [ ] 7.1 — `README.md`: audience framing per PRD §4, the
      six-line library-mode example, the standalone-server
      command, the operator-commitment paragraph (Postfix,
      DKIM, SPF, PTR), the §14 NO-GO summary, link to PRD and
      SPEC for depth.
- [x] 7.2 — `OPS.md` per PRD §11.2:
      - Postfix install + minimal outbound-only config
      - **null-route setup** for sham mail (`transport_maps`
        entry for `knowless.invalid → discard:`) — required
        per SPEC §7.4
      - SPF / DKIM / PTR setup
      - Port 25 verification
      - systemd unit example
      - Caddy `forward_auth` example
      - nginx `auth_request` example
      - Traefik `forwardAuth` example
      - reverse-proxy rate-limiting samples (FR-39 backstop)
      - fail2ban / Cloudflare Turnstile references
- [ ] 7.3 — `CHANGELOG.md`: 0.1.0 entry summarising scope.
- [ ] 7.4 — `npm publish` dry-run, then real publish to
      `knowless` package.
- [ ] 7.5 — GitHub release: tag `v0.1.0`, link to CHANGELOG.
- [ ] 7.6 — Cross-link from gitdone and addypin READMEs (manual,
      on those repos; tracked here for reminder).

**Acceptance:**
- `npm install knowless` from a fresh project works.
- The README's six-line example, copy-pasted, runs.
- OPS.md walks an operator from "fresh Ubuntu VPS" to "knowless
  is delivering mail to Gmail's inbox folder" without
  improvisation.
- v1.0.0 graduation criteria from PRD §6.1 are tracked here as
  a follow-on task; v0.1.0 is the public-soft-launch.

**Estimated effort:** ~4 hours, with most of the time on
OPS.md.

---

## Out of phase: graduation to v1.0.0

Per PRD §6.1, v1.0.0 ships when:

- [ ] All public APIs implemented per SPEC.md
- [ ] Source small enough to audit in an afternoon
- [ ] Production deps = 2 (`nodemailer`, `better-sqlite3`)
- [ ] All tests pass on Node 20+
- [ ] Silent-on-miss timing test passes the 1ms bar
- [ ] Token replay test passes
- [ ] Token expiry test passes
- [ ] Full integration test (HTTP → SMTP → click → handle) passes
- [ ] Forward-auth integration test passes (Caddy + standalone)
- [ ] README example works copy-pasted by an external developer
- [ ] OPS.md complete for Ubuntu/Debian
- [ ] `npx knowless-server` works from fresh install
- [ ] Published to npm
- [ ] Cross-linked from gitdone and addypin

After v0.1.0 ships and is stable for 60 days under real adopter
load, graduate to v1.0.0 per PRD §6.3 walk-away criteria.

---

## Phase ordering and dependencies

```
0 (skeleton)
↓
1 (handle, token, session) ─── 3 (mailer, form)
↓                              ↓
2 (store, abuse) ──────────────┤
                               ↓
                               4 (handlers)
                               ↓
                               5 (factory)
                               ↓
                               6 (CLI)
                               ↓
                               7 (docs + ship)
```

Phases 1, 2, 3 can run in parallel after Phase 0. Phases 4
through 7 are strictly sequential. In practice for one
implementer, sequential 1 → 2 → 3 is fine and avoids
context-switching cost.

---

## Open questions in TASKS

- **T-1.** Should we ship `engines.node = ">=20.0.0"` or
  `">=20"`? The latter is the convention for major-version
  pinning; the former is more explicit. Probably `">=20.0.0"`
  for clarity. Decide at Phase 0.1.

- **T-2.** Should `npm audit` failures block CI? With
  `nodemailer` having a transitive `prebuild-install` deprecation
  showing as "1 high severity," we may need to either downgrade
  to a clean version range or accept-and-document. Decide at
  Phase 0.1.

- **T-3.** `bin/knowless-server` shebang: `#!/usr/bin/env node`
  is the convention but doesn't easily support
  `--experimental-*` flags. Since we're not on `node:sqlite`
  anymore (SPEC v0.10 decision), no flag is needed. Confirm.

- **T-4.** Should we include `examples/` directory with a
  reference Express integration and a reference Caddyfile?
  Useful but invites maintenance. Probably yes, gated to
  Phase 7. Reference-only, no tests.

- **T-5.** SPEC §13 declares the store interface as
  TypeScript-style. Implementation is plain JS + JSDoc per
  NFR-15. Operator-supplied store implementations may be in
  TS — should we ship a `.d.ts`? Probably yes, hand-written
  one-shot in Phase 5. (No build step; just a checked-in
  declaration file.)
