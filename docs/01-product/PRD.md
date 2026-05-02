# knowless — Product Requirements Document (PRD)

**Status:** v0.15 (v1.0.0 shipped 2026-04-29 — walk-away active)
**Owner:** hamr0
**Last updated:** 2026-04-28

> **First customer integration: DONE.** addypin merged its
> `try/knowless` branch and runs knowless as its auth+mail layer.
> Net delta: ~1,150 LOC of bespoke auth/mail code removed, ~35 LOC
> of knowless wiring added (~33× reduction). The integration drove
> 11 audit findings (AF-7 → AF-17) all shipped in v0.1.5–v0.1.10.
> See §17.3 for the closed backlog.
>
> **Three adopters in production (2026-05-02):** addypin (Mode A),
> plato (Mode B, forum), gitdone (Mode A, multi-party email
> workflows). gitdone's pre-merge review surfaced the wrong-shape
> integration failure mode (parallel tokens table built alongside
> knowless instead of using `auth.startLogin`); patched into the
> GUIDE anti-pattern callout in v1.1.1, no API change.

> **For future Claude:** This PRD is the canonical source of truth
> for what `knowless` is and what it isn't. Section 16 captures
> decisions made during the design conversation that should not be
> re-litigated unless the user explicitly asks. Section 14 is the
> non-goals table — every entry was discussed and rejected with
> reasoning. When a feature request comes in, check §14 first; if
> it's there, point at the rationale rather than reopening the
> discussion.
>
> **v0.4 update:** Rebalanced framing to be more honest. Earlier
> drafts overweighted email-enumeration defence (silent-on-miss)
> as the library's identity. The actual identity is the *refusal*
> posture — refusing to send anything but the magic link, refusing
> to store anything reversible, refusing to grow. Silent-on-miss
> remains a property the library maintains, but it is one
> expression of the philosophy, not the philosophy itself. The
> threat model in §12.1 is also more honest about what the library
> does and doesn't defend against.
>
> **v0.5 update:** Added cheap abuse-protection layer with safe
> defaults — per-email rate limit, per-IP rate limit (login and
> account creation), honeypot field. All baked in by default,
> adjustable by operators. See §7.10 and §16.15. Hashcash, CAPTCHA,
> and behavioural fingerprinting are explicitly NO-GO (§14.25–27);
> heavyweight bot defence belongs at the reverse-proxy layer,
> documented in OPS.md.
>
> **v0.6 update:** Clarified the silent-on-miss UX. The login
> response shows a confirmation message ("Thanks. If `<email>` is
> registered, a sign-in link is on its way.") regardless of
> internal outcome. "Silent" means the response shape doesn't leak
> information about lookup result, rate limit, honeypot, or SMTP
> failure — *not* that the user receives no feedback at all.
> Rate-limit hits are uniformly silent (no "you've been rate-
> limited" message), consistent with the silent-on-miss contract.
> See FR-7 and FR-43.
>
> **v0.7 update:** Locked down email and HTML page content to
> plain text / minimal HTML for deliverability and privacy. All
> outbound mail is `text/plain` only — no HTML alternative, no
> tracking pixels, no shortened URLs, no marketing-style
> headers. All HTML pages are self-contained — no JavaScript, no
> external resources (fonts, images, analytics), no third-party
> widgets. See §7.5 (FR-16 through FR-20), §7.6 (FR-22 and
> FR-23), and §16.17. This formalizes constraints that were
> implicit elsewhere; the library refuses fancy email/HTML by
> design because fancy means filtered, tracked, or both.
>
> **v0.8 update:** Two consolidations:
>
> 1. **Token and session lifecycles** consolidated into their own
>    dedicated subsections (§7.3 Magic link lifecycle and §7.4
>    Session lifecycle) with at-a-glance tables. The lifecycle
>    rules — 256-bit entropy, 15-minute token TTL, single-use,
>    30-day session — were already specified across various FRs
>    but scattered. They're now in one place. See FR-10 through
>    FR-13 (token) and FR-30 through FR-31 (session). Also added
>    FR-13 (token storage hygiene including periodic sweeping of
>    expired tokens).
>
> 2. **Configuration mechanism formalized as env-vars-only.** The
>    CLI offers only inspection/validation flags (`--help`,
>    `--version`, `--print-config`, `--config-check`); no flags
>    set or override config. No JSON / YAML / TOML support.
>    Secrets cannot flow through CLI. `.env` files use Node 22+'s
>    built-in `--env-file=`. `config.example.env` ships as a
>    documentation artifact. See §7.12 (FR-49 through FR-56) and
>    §16.18. Reasoning: secrets-in-files is a footgun, 12-factor
>    consistency, suite consistency, scope creep avoidance.
>
> **v0.9 update:** Added last-login compromise hint as a default
> feature. The library tracks `last_login_at` per handle (one
> timestamp, that's it) and appends "Last sign-in: <ISO 8601 UTC
> timestamp>" to the magic-link email body. This gives users a
> free signal to detect compromise — if they see a recent login
> they don't remember, they ignore the email. See FR-22 (email
> body), FR-37 (storage), and §16.19. Geolocation, IP storage,
> user agent, and login history are all explicitly NO-GO
> (§14.38–14.42); the line is "timestamp is a security signal,
> location is surveillance."
>
> **v0.10 update (superseded by v0.15 — see below):** Six
> decisions consolidated after the dependency / store / timing
> review:
>
> 1. ~~**Storage simplified.** `better-sqlite3` is the only store~~
>    ~~backend.~~ **Reverted in v0.2.0 (PRD v0.15).** Storage moves
>    to `node:sqlite` (stdlib). `--experimental-sqlite` was
>    unflagged in Node 22.13 (Jan 2025); the C++20-toolchain cost
>    that `better-sqlite3` imposed on RHEL 8/9 self-hosters was the
>    blocking concern (AF-2.29). See §16.4 (rewritten v0.15).
>
> 2. ~~**Node version dropped to 20+**~~ **Bumped to 22.5+ in v0.2.0**
>    so `node:sqlite` is available unflagged. Node 20 EOLs April
>    2026 anyway.
>
> 3. **`nodemailer` retained.** Considered dropping for vanilla
>    `node:net` SMTP submission, but homeserver MTAs vary
>    (Postfix / Exim / OpenSMTPD / sendmail) and nodemailer
>    absorbs the response-quirk variance across them. The
>    AGENT_RULES "security-aware / vetted-library-for-parsing"
>    carve-out applies — loosely — to wire-format reliability.
>    Production dep count (v0.2.0+): **one** (`nodemailer`).
>
> 4. **Timing envelope narrowed (FR-6).** Strict equivalence now
>    applies only to registered-vs-unregistered (the enumeration
>    vector). Rate-limit and honeypot short-circuits are exempt —
>    their timing channels are redundant with the volume / behavior
>    signals already visible to the attacker, and forcing sham
>    work just to match the envelope punishes legitimate users on
>    shared NAT for nothing. See §16.20.
>
> 5. **Forward-auth return URL specified (FR-27a).** Signed
>    `?next=<url>` parameter survives the magic-link round-trip;
>    HMAC'd with the operator secret, validated against
>    `cookieDomain` whitelist on redemption. Closes the gap
>    between "Caddy redirected the user to /login" and
>    "post-auth, send the user to where they came from."
>
> 6. **Account deletion specified (FR-37a, closes Q1).** Store
>    interface exposes `deleteHandle(handle)`. No HTTP endpoint
>    in the library — operator chooses UX. Supports GDPR
>    right-to-erasure for the EU operator audience in §5.4.
>
> Source-line target dropped as a hard ceiling; replaced with
> "small enough to audit in an afternoon" framing per AGENT_RULES
> spirit (lightness is the goal, LOC isn't a mandate).
>
> **v0.11 update:** POC results turned three implicit assumptions
> into explicit requirements:
>
> 1. **Sham work on silent-miss is mandatory (FR-6).** POC showed
>    that a bare lookup-only miss path returns ~25× faster than a
>    full hit (~30μs vs ~720μs) — exploitable enumeration signal.
>    Full sham work (token insert + mail compose + submit to MTA)
>    closes the gap to ~260μs, well below realistic network
>    jitter. The library MUST do the sham work; FR-6 now mandates
>    it explicitly.
>
> 2. **Statistical-significance framing replaced by
>    practical-effect-size threshold (FR-6).** Earlier wording
>    ("statistically indistinguishable at p ≥ 0.95 on 10,000
>    iterations") is unattainable — with enough samples any
>    constant offset shows "significance." The new bar is
>    `delta_mean < 1ms` measured locally over ≥1000 iterations.
>    That's the threshold that matches what an attacker can
>    actually observe through real network jitter.
>
> 3. **`7bit` ASCII-only body, URL on its own line (FR-17).** POC
>    surfaced that nodemailer's default quoted-printable encoding
>    line-wraps the body at 76 chars, breaking the magic-link URL
>    with `=\n` soft breaks and `=3D` artifacts. Mail clients
>    decode it correctly, but the user's "paste URL into browser"
>    recovery path gets the broken form. Forcing 7bit + ASCII +
>    standalone URL line avoids the problem entirely. FR-17 now
>    requires 7bit; quoted-printable is forbidden.
>
> **v0.12 update:** FR-27a (forward-auth return URL) rewritten to
> be mechanism-agnostic. Earlier wording prescribed
> "HMAC-sign the `next` value... embed in the magic link itself,"
> which is one valid implementation but not the only one.
> SPEC.md §11 specifies a simpler DB-bound mechanism: the
> validated `next` URL is stored on the token row and read back
> at redemption, so the magic link URL stays short (no extra
> query params beyond `?t=`) and tampering is prevented by the
> token's opacity rather than a separate signature. The PRD
> contract — "validated at receipt, bound to the token,
> surviving the round-trip, untamperable except by the token
> holder" — is unchanged; only the mechanism is. Future SPEC
> revisions MAY change mechanism without re-amending the PRD.
>
> **v0.13 update:** Post-Phase-5 self-audit surfaced gaps
> between "tests pass" and "tests verify the contract." Several
> determinism / round-trip tests would pass against broken
> implementations — they verify "what I sign, I can verify"
> rather than pinning the algorithm + domain-tag combination.
> A handful of real concurrency, expiry, and header-injection
> defenses are also untested. Findings + priority-ranked
> hardening backlog tracked in §17 (new). v0.13 doesn't change
> any FR or non-goal — it just makes the v0.1 hardening
> backlog explicit.
>
> **v0.14 update:** First-customer scope (the webrevival forum)
> identified one new ergonomic gap that's blocking for
> library-mode adopters and elevated three previously-P1 items
> to "ship before first use." Together they become v0.1.1:
>
> - **New AF-2.8:** `handleFromRequest(req)` programmatic
>   session resolution. The HTTP-shaped `verifyHandler`
>   forces middleware authors to copy code or do
>   sub-request hacks. SPEC §9.4 specifies the contract;
>   library exposes via `auth.handleFromRequest(req)`.
> - **AF-4.3 promoted to v0.1.1:** Origin / Referer
>   validation on POST /login (CSRF defense). New SPEC §7.3
>   Step 0.
> - **AF-4.4 promoted to v0.1.1:** `cookieSecure` config
>   option (default `true`). Adopters can't dev-test on
>   `http://localhost` without this. SPEC §5.4 updated.
> - **AF-4.1, AF-4.2 promoted to v0.1.1** (defensive tests
>   only, no FR change).
>
> FR-30 revised in this version to allow the cookieSecure
> opt-out (production still defaults to MUST). FR table is
> otherwise unchanged.

---

## 1. Summary

`knowless` is a small, opinionated, full-stack passwordless
authentication library for Node.js services that don't need to
contact their users for anything other than authentication itself.

The thesis: **most services have accreted ten layers of auth
tooling where they need two**. Magic links and a session cookie
have always been sufficient for the kinds of services this library
serves. `knowless` is a return to that simpler answer, with the
discipline to refuse the layers that don't earn their place.

What it commits to:

- Stores no plaintext email, ever. Email becomes a salted hash on
  the way in and is discarded.
- Sends no email except the magic link. Not a welcome message,
  not a digest, not a notification. By API shape.
- Self-hostable end to end. No vendor relationships. No telemetry.
- Walks away at v1.0.0. Maintenance mode after that.

It ships in two deployment modes from a single codebase:

- **Library mode:** import into a Node app, mount the handlers,
  done. Six lines of operator code.
- **Standalone server mode:** run `npx knowless-server` to spin
  up an auth-only HTTP service that integrates with reverse
  proxies (Caddy, nginx, Traefik) via forward-auth. Zero lines
  of operator code.

It is for any service whose user interaction happens *in-app* OR
that needs an auth gate in front of it (self-hosted services
without good native auth).

## 2. Problem statement

### 2.1 Most services have no business emailing users

A scan of typical SaaS, indie tools, and small-business services
reveals that the majority email their users primarily for retention
marketing dressed up as "notifications" — not because the user
needs the message. The infrastructure for this (SES, Postmark,
Mailgun) makes it free and frictionless to add more email channels
once one exists for transactional purposes.

A service that wants to genuinely *not* email users (beyond what
auth requires) currently has to actively resist the path of least
resistance. There is no library that supports that intention by
default.

This is the primary problem. Everything else in this section
follows from it.

### 2.2 Auth tooling normalises identity collection

The current ecosystem (Auth0, Clerk, Magic, Firebase Auth) defaults
to maximum identity collection: full email address stored in
plaintext, profile fields, recovery email, federation across
services. Even nominally privacy-focused alternatives store enough
that a breach is materially harmful.

Smaller, more thoughtful alternatives don't exist as a complete
package. Privacy-minded developers either roll their own (badly) or
accept the tracking surface of the big providers.

### 2.3 The auth industry oversells the difficulty

For a small service, "magic link with a session cookie" is
genuinely sufficient. The industry's framing of auth as a hard,
distinct, expert-only problem largely serves auth vendors who
charge per seat. Most threats a small service actually faces
(credential stuffing, phishing, password reuse) are either solved
by removing passwords entirely (which magic links do) or are
orthogonal to which auth library you chose. The remaining genuine
auth complexity (federation, SSO, high-assurance) is a different
audience entirely.

`knowless` is an explicit bet that the simple version, done with
discipline, is enough for the audience this library serves.

### 2.4 Auth libraries leak identities by default

Most magic-link auth implementations distinguish registered from
unregistered email addresses by HTTP status code, response body, or
response timing. This is a real-but-secondary concern: it enables
targeted phishing and account-existence confirmation, but doesn't
break authentication itself.

`knowless` defaults to silent-on-miss because it costs almost
nothing and is the right behaviour for a privacy-first library —
not because it's the library's reason for existing.

### 2.5 Self-hosted is uphill

Operators who would prefer to self-host their entire stack — no
mail vendor, no auth vendor, no analytics vendor — face a setup
burden that's poorly documented and scattered. The boring answer
(Postfix on localhost, simple SMTP submission, run your own auth)
is rarely packaged for them.

### 2.6 In-app value delivery is underserved

Auth tooling assumes services need to contact users out-of-band for
ongoing engagement. Many services don't — the user logs in, gets
value in the app, leaves. For these services, ongoing email contact
is unnecessary baggage. No mainstream auth library treats this as a
first-class deployment shape.

### 2.7 Self-hosters can't gate apps without auth

Self-hosters running services like Uptime Kuma, AdGuard Home,
Pi-hole, Sonarr, Jellyfin admin, n8n, Homepage, Heimdall, and
dozens of others face a recurring problem: these services have no
auth, weak auth, or auth that's awkward to manage. The existing
solutions — Authelia, Authentik, Keycloak, oauth2-proxy — are
heavy, complex, and assume an external IdP or a multi-component
deployment.

A simple, single-binary forward-auth service that adds magic-link
auth in front of any HTTP service doesn't exist as an idiomatic
option. `knowless` is that option.

## 3. Goals

### 3.1 Primary goals

- **Ship a working passwordless auth flow** that an operator can
  integrate in under 10 minutes and 6 lines of code (library mode)
  OR with a single command (standalone server mode).
- **Default to silent-on-miss** with timing equivalence, verified
  by an automated test in the test suite.
- **Never store plaintext email** anywhere in the library's data
  flow.
- **Send the magic link via localhost Postfix** as the only
  outbound mail channel, by design.
- **Stay small enough to audit in an afternoon** with at most two
  production dependencies. (LOC is not a mandate; lightness is.)
- **Document the operational commitments** (Postfix setup,
  deliverability, reverse proxy configuration) honestly upfront.

### 3.2 Secondary goals

- Cross-link with [gitdone] and [addypin] as the extracted auth
  primitive both projects benefit from.
- Establish a refusal-driven design pattern that other future
  libraries in the same philosophical lineage can follow.
- Produce a spec (`SPEC.md`) detailed enough that compatible
  reimplementations in other languages are straightforward.
- Become the obvious answer for self-hosters wanting to gate their
  no-auth services with a privacy-respecting login layer.

## 4. Target audience

### 4.1 Primary: in-app services where auth is the only legitimate email need

The library serves any service whose user interaction model is "log
in, use the app, leave." Examples:

- **Web apps and SaaS dashboards** where users log in occasionally
  to do work in the app
- **Indie tools and side projects** with infrequent users
- **Small-business B2B internal tools** (HR portals, ticketing,
  ops dashboards)
- **Member areas, paywalled content, community forums** where
  posts and reading happen in-app
- **Self-hosted apps** (Plex-style "your own server")
- **Hermit utilities** like addypin — visit, do a thing, leave
- **Niche productivity tools** that don't need email contact but
  do need login

The common thread: **the app delivers the value, not email**. Once
the user is signed in, the operator can show them anything, accept
their inputs, deliver in-app notifications — the whole product
experience lives behind the auth gate. Email is purely the door
opener.

### 4.2 Primary: self-hosters gating services without good auth

The standalone server mode serves self-hosters running services
that lack acceptable native authentication. Examples:

- **Monitoring**: Uptime Kuma, Netdata, Prometheus, sometimes
  Grafana
- **Network admin**: AdGuard Home, Pi-hole, OPNsense web UIs,
  router admin UIs
- **Self-hosted media**: Jellyfin admin, Sonarr/Radarr/Lidarr,
  qBittorrent web UI
- **Internal tools**: n8n, Homepage, Heimdall, Dashy
- **Dev tools**: Portainer, self-hosted CI dashboards
- **Document management**: Paperless-ngx, BookStack admin
- **One-off internal apps**: anything someone built for their team
  that has no auth

The deployment shape is reverse proxy + forward-auth: the operator
runs Caddy/nginx/Traefik, points it at `knowless` for auth checks,
and `knowless` decides who's allowed through to the protected
service.

This is the niche currently occupied by Authelia, Authentik,
oauth2-proxy, and Keycloak — but those are heavyweight. `knowless`
is the simple, opinionated, single-binary answer.

### 4.3 Secondary: privacy-skeptical developers building for clients

Developers building for small businesses, non-profits, or
privacy-conscious clients where the privacy story is part of the
sale (especially EU contexts, healthcare-adjacent, legal,
education).

### 4.4 Explicitly NOT for

The disqualifier is **email needs**, not service type. This library
is wrong for any service that genuinely needs to send email beyond
the magic link:

- Apps with order confirmations, shipping updates, receipts
- Apps with subscription renewals or billing notifications
- Newsletter or digest platforms (the email IS the product)
- Calendar/scheduling tools that send invites or reminders
- Anything users opt into receiving regularly via email
- Anything where email deliverability problems would be
  catastrophic (use a vendor with deliverability expertise as
  their core business)

Also not for:
- Teams without VPS ops capability — the Postfix requirement is
  real
- Apps needing OAuth, SSO, federation, or SAML — different
  category
- Apps wanting integrated 2FA / WebAuthn / TOTP — compose with
  separate libraries

The library is honest about who it isn't for. That honesty is what
makes it useful for the audience it *is* for.

### 4.5 The questioning the audience needs to do

Most operators who think they need ongoing email contact actually
don't — they email because the infrastructure makes it free, not
because the user needs the message. The library is for operators
willing to ask "do I genuinely need to email my users for anything
other than the sign-in link?" and accept that the answer is usually
no.

If they answer yes (genuinely), they are not the audience. That's
fine.

## 5. User stories

### 5.1 The indie developer (library mode)

> "I'm building a small tool that 200 people use occasionally. I
> want them to log in without a password but I refuse to send them
> anything other than the sign-in link. I have a VPS. I want to
> install one library, add it to my Express app in five minutes,
> and never think about auth again."

**knowless solves this** by being installable, configurable in a
six-field config object, and providing two HTTP handlers the
developer mounts on their existing routing.

### 5.2 The privacy-skeptical user

> "Why does this small app I just signed up for have my email
> stored in plaintext, and why are they sending me a 'welcome'
> email and a 'monthly digest' I never asked for?"

**knowless prevents this** by making it architecturally hard for
the operator to do either thing. The email is never stored in
plaintext, and the only outbound mail the library can send is the
magic link itself. The operator who wants to send a "welcome
email" has to install something else — and explain to themselves
why.

### 5.3 The auditing client

> "I want to use your tool but I need to know what data you store
> about me and what you do with my email."

**knowless gives the operator a clean answer:** "We store an
opaque hash of your email address, derived with our deployment
secret. We do not store your email itself. We send you exactly one
type of email — the sign-in link, only when you request it. We do
not track, analyse, or share anything else."

### 5.4 The compliance-burdened operator

> "I run a service in the EU. GDPR makes me uncomfortable about
> every piece of personal data I store. Can I just... not store
> the email?"

**knowless says yes.** The handle is not personal data in the GDPR
sense (it's a one-way derivation that, without the deployment
secret, cannot be reversed to identify a person). The operator's
data minimisation story becomes meaningfully cleaner.

### 5.5 The internal-tools operator

> "We're a 25-person company. Our VPN auth is a mess. I want a
> tiny dashboard for our ops team where people log in via email
> magic link, and after that they're just... in. No accounts to
> provision, no passwords to reset, no SSO bills."

**knowless solves this** by being the entire auth layer. Operator
seeds the team's emails as known handles; users get magic links to
their work email; sessions last as long as the operator configures.
No vendor, no monthly fee, no per-seat charges.

### 5.6 The self-hoster gating Kuma (standalone server mode)

> "I run Uptime Kuma on my home server. It's behind an SSH tunnel
> right now because Kuma's built-in auth is barely there and I
> don't trust it on the open internet. I want to expose it
> properly with a real login layer, but I don't want to install
> Authelia and configure five components. I just want a
> bookmark-able URL that asks me to log in once a month."

**knowless solves this** with the standalone server. Operator
installs `knowless-server` on a small VPS, points Caddy at it for
forward-auth, and Kuma sits behind it on a stable subdomain.
Operator bookmarks `https://kuma.theirdomain.com`, gets a magic-
link prompt the first time, then 30 days of friction-free access.
Same setup extends to AdGuard, Pi-hole, or any other no-auth
service with one extra Caddy config block per service. Single
sign-on across all gated services because the session cookie is
parent-domain scoped.

## 6. Success criteria

### 6.1 v1.0.0 ship criteria

- [x] All public APIs implemented per `SPEC.md`
- [x] Source small enough to audit in an afternoon (no hard LOC cap)
- [x] Production dependency count = 1 (`nodemailer`; storage uses
      `node:sqlite` from stdlib as of v0.2.0)
- [x] All tests pass on Node 22.5+
- [x] Silent-on-miss timing test passes the practical-effect-size
      bar: delta_mean(hit, miss) < 1ms over ≥1000 iterations
      locally (per FR-6)
- [x] Token replay test passes
- [x] Token expiry test passes
- [x] Full integration test (HTTP login → email send via test
      Postfix → click → handle returned) passes
- [x] Forward-auth integration covered — addypin runs knowless
      behind Caddy in production. Per the 2026-04-29 walk-away
      stress-test (CHANGELOG.md "Cut from v0.2.x backlog"), real
      adopter use is stronger evidence than a docker-compose CI
      test would be. The previously-deferred TASKS 6.8 docker-
      compose harness was cut — every hop is already covered by
      `forward-auth-next.test.js` + `cli.test.js`, and the
      Caddy↔knowless contract is two HTTP responses + one header.
- [x] README example works copy-pasted by an external developer
      (validated by addypin integration: ~1,150 LOC removed,
      ~35 added)
- [x] OPS.md provides complete Postfix and reverse-proxy setup
      checklists for Ubuntu/Debian
- [x] `npx knowless-server` works from a fresh install
- [x] Published to npm
- [x] Cross-linking moved out of knowless-repo scope — the README
      edits live in the addypin and gitdone repos (not editable
      from here). Tracked in those repos' TODO; not a knowless
      gate. (Per the 2026-04-29 stress-test.)

### 6.2 30-day post-launch criteria

- [x] At least one external service has integrated and provided
      feedback (library mode) — **three adopters now: addypin
      (Mode A, drove AF-7 → AF-17), plato (Mode B, forum),
      gitdone (Mode A, drove the v1.1.1 wrong-shape-integration
      anti-pattern callout)**
- [ ] At least one external self-hoster has deployed
      `knowless-server` for a real service (standalone mode) —
      pending. Originally expected to be accelerated by a turnkey
      Docker image (cut 2026-04-29 — see CHANGELOG.md "Cut from
      v0.2.x backlog"); the OPS.md from-zero-VPS walkthrough
      remains the canonical path.
- [x] No unresolved security issues
- [x] No silent-on-miss regressions
- [x] Documentation answers the top 5 user questions without
      requiring a GitHub issue (addypin integration produced zero
      issues, only feedback rounds)

### 6.3 Walk-away criteria

After v1.0.0 ships and is stable for 60 days:

- Maintenance mode entered: security patches and bug fixes only
- Feature requests deflected to the §14 non-goals table or to
  sibling projects
- The library being "done" is documented as a feature

## 7. Functional requirements

### 7.1 Email handling

**FR-1.** The library MUST accept email addresses as input strings
and normalise them per `SPEC.md §1` before any other processing.

**FR-2.** The library MUST NOT persist any email address in
plaintext at any point in the data flow.

**FR-3.** The library MUST derive a stable opaque handle from the
normalised email plus the operator's secret per `SPEC.md §2`.

### 7.2 Login flow

**FR-4.** The library MUST expose a `loginHandler(req, res)` that
accepts a POST request with an email field, performs the silent
lookup, issues a token if appropriate, sends the magic link via
Postfix, and returns a response that does not leak whether the
email was registered.

**FR-5.** The login response MUST be identical in body, status
code, and headers regardless of internal outcome (registered hit,
silent miss, rate limit hit, honeypot triggered, IP cap exceeded,
SMTP delivery failure). There is no error response distinct from
the success response.

**FR-6.** The wall-clock time of the login response MUST be
*practically indistinguishable* between matched (registered) and
unmatched (silent-miss) cases. Practical indistinguishability is
defined as: **the delta in mean response time between the two
paths MUST be less than 1 millisecond when measured locally over
≥1000 iterations.** This bar reflects the network and system
jitter an attacker realistically observes in production — sub-
millisecond local-bench differences are invisible across a real
connection.

Statistical-significance framing (e.g., "p < 0.05 on Welch's t")
is rejected as the test bar: with enough samples, any
constant-offset implementation shows "significance" even when the
practical effect is far below detectable network jitter. The bar
is **effect size**, not p-value. The POC under `poc/` measured
hit and full-sham-miss paths at ~720μs and ~460μs respectively —
a 260μs delta, well within the 1ms bar.

To meet this bar, the silent-miss path MUST perform sham work
equivalent to the registered-hit path:

1. Derive the handle the same way.
2. Perform the store lookup.
3. Insert a token row using the unregistered handle. The row has
   no owner and will never be redeemed; the expired-token sweeper
   per FR-13 drops it within the normal TTL window.
4. Compose and submit the mail to the local MTA the same way.
   The MTA attempts delivery to the (unregistered) address; the
   bounce or non-delivery is logged at the MTA layer and is not
   visible to the library.

The cost of sham work on miss is bounded by per-IP rate limiting
(FR-39): an attacker probing the silent-miss path is capped at
30 attempts per IP per hour by default. The brief tokens-table
growth from sham inserts is bounded the same way and is reaped
by the FR-13 sweeper.

Rate-limit and honeypot paths MAY short-circuit faster than the
matched/unmatched envelope. They are explicitly exempt from
timing equivalence: an attacker who triggers them already learned
what they could learn from request volume or from having filled
the honeypot field. See §16.20.

The shape-and-message equivalence in FR-5 still applies to all
paths — every outcome returns the same body, status, and headers.
Only the timing envelope is narrowed.

**FR-7.** The login response MUST include a confirmation message
informing the user the submission was received and that a sign-in
link is on its way *if* the email is registered. The default
message is: "Thanks. If `<echoed-email>` is registered, a sign-in
link is on its way. Check your inbox in a few minutes." The
message text MAY be overridden via configuration. The echoed
email MUST be HTML-escaped to prevent injection. Echoing the
email back is permitted because the user already supplied it; an
attacker submitting third-party emails learns nothing they
didn't provide.

**FR-8.** The library MUST support an option to allow new-handle
creation on first email submission (open registration mode), with
the default being closed (handles must be pre-created or matched).

**FR-9.** The library MUST serve a hardcoded HTML login form at a
configurable path (default `/login`) so operators using standalone
server mode don't need to provide their own.

### 7.3 Magic link lifecycle

The lifecycle of every magic link is fully specified by three rules.
All three are non-negotiable:

| Property | Default | Configurable | Notes |
|---|---|---|---|
| Entropy | 256 bits | No | Minimum, not target |
| TTL (max age) | 15 minutes | Yes (`tokenTtlSeconds`) | After this, cannot be redeemed |
| Use count | 1 (single-use) | No | Replay MUST fail silently |

**FR-10. Token entropy.** Each issued link MUST contain a token of
at least 256 bits of entropy from a CSPRNG (`node:crypto.randomBytes`).
This is a floor, not a target — the library uses 256 bits and does
not expose a knob to weaken it.

**FR-11. Token TTL.** Each token MUST expire after a configurable
window (default: 15 minutes). After expiry, `verifyClick` MUST
return null without distinguishing "expired" from "never existed."
The TTL is enforced server-side via the stored `expires_at`
timestamp; client-side cookie or URL expiry hints are not trusted.

**FR-12. Single-use.** Each token MUST be redeemable exactly once.
On successful verification, `used_at` is set; subsequent attempts
to redeem the same token MUST fail silently with the same null
response. Replay is treated identically to "never existed" or
"expired" — no distinguishable error.

**FR-13. Token storage.** Tokens are stored as `SHA-256(token)`,
not as raw bytes. A store leak MUST NOT yield usable tokens. Token
records MUST be deleted (or marked obsolete) after expiry; the
library MUST sweep expired tokens on a schedule (every 5 minutes
by default) to keep the store from growing unboundedly.

### 7.4 Session lifecycle

Sessions are issued after successful magic-link redemption and live
considerably longer than tokens. The lifecycle:

| Property | Default | Configurable | Notes |
|---|---|---|---|
| Lifetime | 30 days | Yes (`sessionTtlSeconds`) | Server-enforced |
| Storage | Hashed session ID + handle + expiry | No | Plus signed cookie on client |
| Revocation | Logout endpoint, store-side delete | No | Operator can clear store rows directly |

The session FRs (signing, cookie flags, server-side expiry, logout
endpoint) are in §7.8 below. They're separated because session is
a different primitive than token — one is an authenticated user's
recurring access, the other is a one-time auth proof.

### 7.5 Email delivery

**FR-14.** The library MUST send the magic link via SMTP to
`localhost:25` (configurable port for testing).

**FR-15.** The library MUST NOT support remote SMTP, SMTP
authentication, or vendor APIs (Postmark, SES, Mailgun, etc.).

**FR-16. Plain text only.** The magic link email MUST be sent as
`Content-Type: text/plain; charset=utf-8` with no HTML
alternative, no multipart structure, no attachments, no inline
images, and no embedded resources. The body MUST contain the
plain magic link URL (not a wrapped or shortened URL) and an
expiry note. The default body is:

```
Click to sign in:

<magic link URL>

This link expires in 15 minutes. If you didn't request this,
ignore this email.

Last sign-in: <ISO 8601 timestamp UTC>.
If that wasn't you, do not click the link above.
```

The "Last sign-in" line is appended automatically when a previous
successful login exists for this handle (per FR-21). On a user's
first-ever login, the line is omitted (no prior login to report).

Operators MAY override the body text via configuration but the
link itself MUST appear unmodified, and HTML MUST NOT be
introduced. The default body is what ships.

**FR-17. Standard headers, nothing fancy.** Outbound mail MUST
include `From`, `To`, `Subject`, `Date`, `Message-ID`, and
`Content-Type` headers. It MUST NOT include `List-Unsubscribe`,
`Return-Receipt-To`, `Disposition-Notification-To`, custom
`X-` headers, or any header that would mark the message as
mass mail or trigger filters.

**Encoding (revised v0.11):** `Content-Transfer-Encoding` MUST be
`7bit`. The body MUST be ASCII-only (no characters above 0x7F)
so no encoding transformation is required. The magic link URL
MUST appear on its own line, with no leading or trailing text
on that line.

`quoted-printable` and `base64` are explicitly forbidden:
quoted-printable line-wraps the body at 76 chars and breaks
long URLs across lines with soft-break and `=3D` artifacts —
mail clients decode this correctly, but the user's "paste URL
into browser" recovery path receives the broken form. base64
looks suspicious for short plain-text mail and reduces
deliverability. 7bit ASCII with the URL on its own line avoids
both issues. The POC under `poc/` confirmed the
quoted-printable wrap problem with the default nodemailer
configuration; the library MUST configure nodemailer to emit
7bit and MUST validate that operator-overridden subjects and
bodies remain ASCII.

**FR-18. No tracking, no shortening, no rewriting.** The library
MUST NOT add tracking pixels (impossible since plain text), URL
shorteners, click-through redirects, analytics injection, or
unsubscribe links. The link in the email is the literal
`baseUrl + linkPath + ?t=<token>`.

**FR-19. Subject line is short and plain.** Default Subject:
`Sign in`. Operator MAY override but MUST keep it short
(≤ 60 chars), free of marketing punctuation (no `!!`, no
emoji unless explicitly opted in), and free of words spam
filters score against. The library SHOULD warn if the
configured subject contains common spam triggers.

**FR-20. The library MUST discard the recipient address from
memory after the SMTP transaction completes.**

**FR-21. Last-login compromise hint.** The library MUST track
`last_login_at` per handle (timestamp of the most recent
successful `verifyClick`) and append a "Last sign-in: <ISO 8601
UTC timestamp>" line to the magic-link email body when issuing a
new link. This gives the user a free signal to detect compromise:
if they see a recent login they don't remember, they ignore the
email. The feature MUST be enabled by default and MAY be disabled
via the `includeLastLoginInEmail` config option.

The library MUST NOT track, store, or include in the email any
geolocation information, IP address, user agent, device
fingerprint, or other identifying metadata. Timestamp only. See
§14.38 for why location is excluded.

The library MUST update `last_login_at` only on successful
session establishment (after `verifyClick` returns a handle), not
on every link issuance, so the timestamp reflects actual sign-in
events rather than attempted ones.

### 7.6 HTML pages (login form, confirmation, errors)

**FR-22. Plain HTML, no external resources.** All HTML pages
served by the library (login form at `/login`, confirmation
after submission, callback errors) MUST be self-contained
plain HTML5 with:

- No JavaScript (script tags forbidden)
- No external stylesheets, fonts, or images
- No embedded base64 images or fonts
- Inline minimal styling only if needed (a few CSS rules in a
  `<style>` block; default rendering preferred)
- No analytics, no telemetry, no third-party widgets
- No forms beyond the login form itself

The pages MUST work in text-mode browsers (Lynx, w3m), MUST be
keyboard-navigable, and MUST be readable by screen readers.
Accessibility is a side-effect of being simple, but it's a
required side-effect.

**FR-23. The login form MUST contain only:** an email input
(`type="email" required`), a submit button, and the honeypot
field per FR-41. No "remember me" checkbox, no terms-of-service
links, no third-party login buttons, no marketing copy, no
captchas. Operators wanting any of those build their own form
and submit to the library's POST endpoint.

### 7.7 Click verification

**FR-24.** The library MUST expose a `callbackHandler(req, res)`
that accepts a GET request with a token query parameter, verifies
the token, and either establishes a session or signals failure.

**FR-25.** Verification failures (invalid, expired, replayed,
malformed) MUST all produce the same response shape to the client.

**FR-26.** On successful verification, the library MUST set a
session cookie (per §7.8) and either redirect to a configured
destination or hand the handle to a developer-provided callback in
library mode.

**FR-27.** When a `redirect` query parameter is present on the
login flow, the library MUST validate it against the configured
cookie domain (whitelist check) before redirecting after auth, to
prevent open-redirect vulnerabilities.

**FR-27a. Forward-auth return URL (revised v0.12).** When a
request arrives at `/login` with a `?next=<url>` query parameter
(typical for forward-auth deployments where the reverse proxy
redirects unauthenticated requests), the library MUST:

1. **Validate at receipt.** The `next` URL MUST be validated
   against the configured `cookieDomain` whitelist (per FR-27)
   *before* any token is issued. Whitelist failure: silently
   drop the `next` (the login flow proceeds without it; user
   ends up at the default destination).
2. **Bind to the token.** The validated URL MUST be bound to
   the magic-link token such that the destination survives the
   email round-trip and cannot be tampered with by anyone except
   the holder of the token.
3. **Redirect on redemption.** On `callbackHandler` redemption,
   the library MUST redirect to the bound URL after setting the
   session cookie. If no `next` was provided or it failed
   validation, redirect to the configured default destination
   (or `/` if none).

The mechanism by which "bind to the token" is achieved is a
SPEC-level decision (signed-in-URL, DB-bound row, or
otherwise). SPEC.md §11 currently specifies DB-bound: the
validated URL is stored on the token row and read back on
redemption, keeping the magic link URL short (per FR-17) and
relying on the token's opacity for tamper-resistance.

This bridges forward-auth's "user requested
kuma.example.com" and post-login's "send the user to
kuma.example.com." The PRD contract is the four properties
above (validated at receipt, bound, surviving round-trip,
untamperable). Implementation mechanism is SPEC's job.

### 7.8 Forward-auth and session

**FR-28.** The library MUST expose a `verifyHandler(req, res)`
endpoint (default path `/verify`) that returns 200 OK with an
`X-User-Handle` header if the request carries a valid session
cookie, or 401 Unauthorized otherwise.

**FR-29.** The library MUST expose a `logoutHandler(req, res)`
endpoint (default path `/logout`) that clears the session cookie
and returns 200 OK.

**FR-30 (revised v0.14).** Session cookies MUST be signed with
the operator secret (HMAC-SHA256), set with `HttpOnly` and
`SameSite=Lax` flags, scoped to the configured cookie domain
(default: the eTLD+1 of `baseUrl`), and set with `Secure` *by
default*. The `Secure` flag MAY be omitted via the
`cookieSecure: false` config option for local development on
`http://localhost`. Operators MUST NOT set `cookieSecure: false`
in production. The library SHOULD log a stderr warning at
startup when `cookieSecure: false` is configured. SPEC §5.4
specifies the wire-level behavior.

**FR-31.** Session cookie lifetime MUST be configurable (default:
30 days, see §7.4) and MUST be enforced server-side via a stored
expiry, not just relied on the client cookie expiry.

### 7.9 Storage

**FR-32.** The library MUST ship a default SQLite-backed store.
As of v0.2.0 the implementation uses `node:sqlite` (Node stdlib);
prior versions used `better-sqlite3`. No alternate built-in
backend. Operators wanting a different store implement the store
interface (FR-33).

**FR-33.** The store interface MUST be defined and documented to
allow operator-provided alternatives (Postgres, Redis, in-memory,
etc.) without modifying library code.

**FR-34.** The store MUST persist hashed tokens (not raw tokens)
so a store leak does not yield usable tokens.

**FR-35.** The store MUST persist handles in their hashed form
(the HMAC output), not any reversible representation.

**FR-36.** The store MUST persist active sessions with handle,
expiry, and a server-side session ID; a store leak MUST NOT yield
usable sessions without the operator secret.

**FR-37.** The store MUST persist `last_login_at` per handle
(timestamp of the most recent successful `verifyClick`) for the
last-login compromise hint feature (FR-21). This is the only
per-user metadata the library tracks beyond the handle itself.
No `created_at`, no `last_active_at`, no `login_count`, no IP
addresses, no user agents — just the timestamp of the most
recent successful sign-in. See §16.19 for why timestamp-only.

**FR-37a. Account deletion (right-to-erasure).** The store MUST
expose a `deleteHandle(handle)` method that, in a single
transaction, removes:

- the handle row
- all active (unredeemed, unexpired) tokens for that handle
- all active sessions for that handle
- the `last_login_at` record for that handle

The library MUST NOT ship an HTTP endpoint that calls
`deleteHandle`. The operator chooses the UX — admin CLI, in-app
self-service deletion button, ticket-driven support process — and
wires it to the store method directly. This keeps the library out
of the user-management business while giving the EU operator
audience (§5.4) a clean GDPR right-to-erasure story.

### 7.10 Abuse protection (built-in defaults)

The library MUST ship cheap, safe defaults for the most common
abuse vectors against magic-link auth endpoints. These are
enabled by default with sensible thresholds; operators can adjust
or disable individually via configuration.

The principle: **make the easy attacks cheap to defeat, document
clearly that more sophisticated attacks need reverse-proxy or
operator-side defences.**

**FR-38. Per-email rate limiting.** The library MUST cap the
number of active (unexpired, unused) magic-link tokens per
handle. Default: 5 active tokens. When the cap is reached, new
requests for that email MUST silently replace the oldest active
token (newest-replaces-oldest), not generate additional emails.
This defends against email-bombing a target via repeated login
submissions.

**FR-39. Per-IP rate limiting on the login endpoint.** The
library MUST track recent submission counts per source IP and
silently rate-limit at a configurable threshold. Default: 30
requests per IP per hour to the login endpoint. Over the
threshold, requests return the same generic response as a normal
silent-miss (no distinct error) and no email is sent. This
defends against high-volume request floods.

**FR-40. Per-IP rate limiting on account creation
(open-registration mode only).** When `openRegistration` is
true, the library MUST additionally cap new-handle creation per
source IP. Default: 3 new handles per IP per hour. Above the
threshold, the silent-miss path is taken regardless of email.
This defends against account-creation spam in services that
allow open signup.

**FR-41. Honeypot field in the login form.** The hardcoded login
form MUST include an off-screen honeypot input named in a way
that attracts dumb form-fillers (e.g., `website`, `url`, or
`phone`). If the honeypot field is non-empty in a submission,
the request MUST take the silent-miss path. The honeypot field
MUST be marked `aria-hidden="true"` and `tabindex="-1"` to avoid
trapping screen-reader users.

**FR-42. Source IP determination.** The library MUST determine
client IP from `X-Forwarded-For` or `X-Real-IP` headers when
behind a reverse proxy, falling back to the connection's remote
address. The set of trusted proxy IPs MUST be configurable; in
standalone server mode the operator MUST explicitly configure
trusted proxies (default: localhost only). This prevents IP
spoofing from clients while supporting forward-auth deployments.

**FR-43. Failures all look the same.** All abuse-protection
rejection paths (rate limit hit, honeypot triggered, IP cap
exceeded) MUST produce the same response shape and timing as a
normal silent-miss — including the standard confirmation message
from FR-7. The attacker cannot distinguish "your email isn't
registered" from "you've been rate-limited" from "you filled the
honeypot." There is NO rate-limit-specific message; rate limits
are silent. Consistent with §7.2 silent-on-miss contract.

**FR-44. Operator can adjust or disable.** All abuse-protection
parameters (cap values, time windows, honeypot field name,
trusted proxy list) MUST be configurable via the options object.
Setting any cap to `0` MUST disable that specific check.
Operators with their own abuse-protection layer (e.g.,
Cloudflare, fail2ban, custom middleware) can disable individual
checks without disabling others.

**FR-45. Rate-limit state in the store.** Per-IP counters MUST
be persisted in the same store as tokens and sessions, with
automatic expiry of old entries. The library MUST NOT keep
abuse-protection state in process memory only (would not survive
restarts and would not work across multiple instances).

### 7.11 Configuration

**FR-46.** The library MUST be configured via a single options
object passed to the `knowless()` factory:

| Field | Required | Default | Purpose |
|---|---|---|---|
| `secret` | yes | — | HMAC secret for handle derivation and session signing (≥32 bytes hex) |
| `baseUrl` | yes | — | Base URL for constructing magic link URLs |
| `from` | yes | — | Sender address for outgoing mail |
| `dbPath` | no | `./knowless.db` | SQLite database path |
| `tokenTtlSeconds` | no | `900` | Token expiry window |
| `sessionTtlSeconds` | no | `2592000` | Session lifetime (30 days) |
| `cookieDomain` | no | (eTLD+1 of baseUrl) | Session cookie scope |
| `linkPath` | no | `/auth/callback` | Path appended to baseUrl for the magic link |
| `loginPath` | no | `/login` | Path for the hardcoded login form |
| `verifyPath` | no | `/verify` | Path for forward-auth check |
| `logoutPath` | no | `/logout` | Path for logout endpoint |
| `smtpHost` | no | `localhost` | SMTP host (config-only for testing) |
| `smtpPort` | no | `25` | SMTP port |
| `openRegistration` | no | `false` | Allow new-handle creation on first email |
| `subject` | no | `'Sign in'` | Email subject line |
| `confirmationMessage` | no | (see FR-7) | Text shown after login submission; uniform regardless of internal outcome |
| `includeLastLoginInEmail` | no | `true` | Append "Last sign-in: <timestamp>" to magic-link emails for compromise detection (FR-22) |
| `maxActiveTokensPerHandle` | no | `5` | Cap on concurrent magic links per email; 0 disables |
| `maxLoginRequestsPerIpPerHour` | no | `30` | Per-IP login submission cap; 0 disables |
| `maxNewHandlesPerIpPerHour` | no | `3` | Per-IP account-creation cap (open-registration only); 0 disables |
| `honeypotFieldName` | no | `website` | Name of the honeypot field in the login form |
| `trustedProxies` | no | `['127.0.0.1', '::1']` | IPs trusted to set `X-Forwarded-For` |

**FR-47.** The library MUST refuse to start if `secret`,
`baseUrl`, or `from` are missing or empty.

**FR-48.** The library MUST refuse to start if `secret` is
shorter than 32 bytes (64 hex characters).

### 7.12 Standalone server (CLI)

**FR-49. Configuration is via environment variables.** The
canonical mechanism for configuring `knowless-server` is
environment variables prefixed `KNOWLESS_` (e.g.,
`KNOWLESS_SECRET`, `KNOWLESS_BASE_URL`). Every config option in
FR-46 MUST be settable via env var. This is consistent with
12-factor application practice and with how secrets are handled
across modern deployment platforms (systemd, Docker, Kubernetes,
PaaS providers).

**FR-50. The library MUST ship a `bin/knowless-server`
executable** that runs the auth-only HTTP server using all the
same primitives. The CLI MUST be runnable via `npx
knowless-server` without prior `npm install`.

**FR-51. CLI flags are limited to inspection and validation.**
The CLI MUST accept exactly the following flags. None of them
override or set configuration values; configuration always comes
from env vars.

| Flag | Behaviour |
|---|---|
| `--help` | Print usage summary listing all `KNOWLESS_*` env vars with their defaults and purposes; exit 0. |
| `--version` | Print package version; exit 0. |
| `--print-config` | Load configuration the same way the running server would, print effective config as `KEY=VALUE` lines with secrets replaced by `<set>` or `<unset>`, then exit 0. Used to verify what the deployment will do. |
| `--config-check` | Same as `--print-config`, plus validate required values are present, validate the SMTP host is reachable on the configured port, validate the database path is writable. Exits 0 if all checks pass, non-zero with a clear error message otherwise. Suitable for systemd `ExecStartPre`. |

**FR-52. Secrets MUST NOT be settable via CLI flags.** Command-
line arguments appear in `ps` output and shell history; secrets
in those locations would be a footgun. The library MUST NOT
accept `--secret`, `--hmac-secret`, or any equivalent flag.
Secrets only flow through env vars.

**FR-53. `.env` file support is via Node's built-in mechanism,
not a library feature.** Operators wanting to load a `.env` file
during development can use Node 22+'s built-in `--env-file=`
runtime flag (`node --env-file=.env bin/knowless-server`). The
library MUST NOT bundle or implement its own `.env` loader.

**FR-54. The CLI MUST log effective configuration on startup.**
On successful startup, the library MUST emit a single log block
to stdout listing every effective config value (with secrets
redacted as `<set>`), the SMTP connection check result, and the
listening port. The operator's first run should make obvious
exactly what was loaded.

**FR-55. The CLI MUST refuse to start with a clear error message**
if any required configuration is missing or invalid. The error
output MUST point at the specific env var that's missing or
malformed (e.g., `KNOWLESS_SECRET is missing` rather than just
`config error`). Exit code MUST be non-zero.

**FR-56. The repository MUST ship `config.example.env`.** A
documented sample env file listing every `KNOWLESS_*` variable
with its default and a short comment explaining what it does.
Operators copy this, fill in their secrets, and use it via
`node --env-file=...` or systemd `EnvironmentFile=`. The file
MUST NOT be loaded automatically by the library; it is a
documentation artifact, not a runtime feature.

## 8. Non-functional requirements

### 8.1 Performance

**NFR-1.** Handle derivation MUST complete in < 1ms on commodity
hardware.

**NFR-2.** Login handler end-to-end (excluding actual SMTP
delivery time) MUST complete in < 100ms.

**NFR-3.** Verify handler (forward-auth check) MUST complete in
< 10ms — this is the hot path for every authenticated request.

**NFR-4.** The library MUST sustain at least 200 verify-handler
requests per second on a single VPS instance (forward-auth load
will dominate over login load).

### 8.2 Security

**NFR-5.** All token comparisons MUST use constant-time comparison
via `node:crypto.timingSafeEqual`.

**NFR-6.** All random values (tokens, session IDs) MUST come from
`node:crypto.randomBytes` (CSPRNG).

**NFR-7.** The library MUST NOT log the operator secret, raw
tokens, raw session IDs, or any plaintext email under any
circumstance, including debug or verbose modes.

**NFR-8.** The library MUST follow the silent-on-miss contract
without any opt-out mechanism. Even debug modes MUST NOT leak
registration status.

**NFR-9.** The redirect-after-login flow MUST whitelist redirect
targets to the configured cookie domain to prevent open-redirect
abuse.

### 8.3 Reliability

**NFR-10.** SMTP delivery failures MUST be logged but MUST NOT
cause the login handler to leak whether the email was registered.
The user gets the same response either way; the operator sees the
failure in logs.

**NFR-11.** The store interface MUST be transactional: a token
write followed by a delivery failure MUST roll back the token
write so a retry generates a fresh token.

### 8.4 Observability

**NFR-12.** The library MUST emit logs to stdout in plain text
(12-factor compliant). No structured logging required.

**NFR-13.** Logs MUST NOT include plaintext emails, secrets, raw
tokens, or raw session IDs.

**NFR-14.** No telemetry, metrics, or external phone-home of any
kind.

### 8.5 Maintainability

**NFR-15.** Source MUST be plain JavaScript (ESM modules) with
JSDoc type annotations. No TypeScript, no transpilation.

**NFR-16.** Public API MUST be documented in `SPEC.md` with
sufficient detail that a compatible reimplementation in another
language is straightforward.

**NFR-17.** Every public function MUST have unit tests; the
silent-on-miss contract MUST have its own dedicated timing test;
the forward-auth flow MUST have an end-to-end test using a real
reverse proxy in a container.

## 9. Architecture overview

```
knowless/
├── src/
│   ├── handle.js        # deriveHandle: HMAC-SHA256 + email normalisation
│   ├── token.js         # issue, verify, expire, replay-reject
│   ├── session.js       # signed cookie session, server-side expiry
│   ├── store.js         # SQLite default; defines interface for swaps
│   ├── mailer.js        # nodemailer to localhost Postfix
│   ├── abuse.js         # rate limits (per-email, per-IP), honeypot, IP detection
│   ├── handlers.js      # loginHandler, callbackHandler, verifyHandler, logoutHandler
│   ├── form.js          # hardcoded login HTML page (incl. honeypot)
│   └── index.js         # public knowless() factory
├── bin/
│   └── knowless-server  # standalone CLI server
├── test/
│   ├── unit/
│   │   ├── handle.test.js     # determinism, normalisation
│   │   ├── token.test.js      # lifecycle, replay, expiry
│   │   ├── session.test.js    # cookie signing, expiry, validation
│   │   └── abuse.test.js      # rate limits, honeypot, IP detection
│   ├── integration/
│   │   ├── full-flow.test.js     # HTTP -> SMTP -> click round-trip
│   │   ├── forward-auth.test.js  # Caddy + server + mock protected service
│   │   └── abuse-flow.test.js    # rate limits actually trigger as expected
│   ├── timing.test.js            # silent-on-miss timing equivalence
│   └── fixtures/
│       └── vectors/              # spec test vectors
├── package.json
├── config.example.env  # documented sample env file (FR-56)
├── README.md
├── DESIGN.md
├── PRD.md (this file)
├── SPEC.md
├── POC.md
├── OPS.md
├── CLAUDE.md
└── CHANGELOG.md
```

### 9.1 Deployment patterns

**Pattern A: Library mode** — operator imports `knowless` into
their existing Node app and mounts the handlers on their
preferred framework. Two endpoints to expose: `loginHandler`
(POST) and `callbackHandler` (GET).

**Pattern B: Standalone server + reverse-proxy forward-auth** —
operator runs `npx knowless-server` as a standalone HTTP service.
A reverse proxy (Caddy/nginx/Traefik) sits in front of one or more
protected services and consults `knowless` for auth decisions.
Operator writes zero application code.

Both patterns use the same library code under the hood. Pattern B
is the new path for v1; Pattern A is the original use case.

### 9.2 Data flow (login)

```
[user submits email]
        |
        v
[loginHandler]
        |
        v
[normalise + derive handle]   <-- deletes plaintext email
        |
        v
[silent lookup in store]
        |
   +----+----+
   | found?  |
   +----+----+
        |
        +- yes -> [issue token] -> [send via Postfix] -> [200 OK]
        |
        +- no  -> [discard write] -> [no send]         -> [200 OK]
                       ^
              same code path, same time

[user clicks link]
        |
        v
[callbackHandler]
        |
        v
[verify token in store]
        |
   +----+----+
   | valid?  |
   +----+----+
        |
        +- yes -> [mark used] -> [create session] -> [set cookie] -> [redirect]
        |
        +- no  -> [401]
```

### 9.3 Data flow (forward-auth, Pattern B)

```
[browser request] --> [Caddy/nginx] --> [knowless /verify]
                                              |
                                       check session cookie
                                              |
                                          +---+---+
                                          | valid?|
                                          +---+---+
                                              |
                          200 OK + X-User-Handle  -OR-  401 Unauthorized
                                              |
                          [Caddy proxies to protected service]
                                  -OR-
                          [Caddy redirects to /login on auth domain]
                                              |
                                              v
                          [magic-link dance, see §9.2]
                                              |
                                              v
                          [redirect back to original URL]
```

## 10. Technology stack

The complete stack, consolidated for one-glance reference.

### 10.1 Runtime and language

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js ≥ 20 | LTS until April 2026; widens homeserver audience; modern crypto; SEA support |
| Language | Plain JavaScript (ESM) | No TypeScript source; JSDoc + shipped `.d.ts` |
| Module system | ESM only | `"type": "module"` in package.json |
| Build step | None | Code that ships is code that runs |

### 10.2 Production dependencies

| Package | Why | License | Maintainer |
|---|---|---|---|
| `nodemailer` | SMTP composition + delivery to localhost MTA. Per AGENT_RULES security-aware-parsing carve-out applied loosely — abstracts MTA response-quirk variance across Postfix / Exim / OpenSMTPD / sendmail, header folding, line-ending tolerance, dot-stuffing edge cases. | MIT | Andris Reinman |

**Total: 1 production dependency** (as of v0.2.0). Storage uses
`node:sqlite` (Node stdlib, no native compile). `better-sqlite3` was
the storage backend in v0.1.x — see §16.4 for the v0.15 revisit.

### 10.3 Stdlib usage

| Module | Used for |
|---|---|
| `node:crypto` | HMAC-SHA256, randomBytes, createHash, timingSafeEqual |
| `node:http` | Standalone server in `bin/knowless-server`; library is framework-agnostic |
| `node:test` + `node:assert` | Test framework — no Jest, no Vitest |
| `node:fs/promises` | Filesystem I/O for SQLite path resolution |
| `node:util` | `parseArgs` for CLI argument parsing |

### 10.4 Operational stack

| Layer | Choice | Notes |
|---|---|---|
| Mail transport | Postfix on `localhost:25` | The operator installs and configures |
| OS | Ubuntu/Debian recommended | Postfix install paths documented for these |
| DNS | Operator's existing DNS provider | SPF, DKIM, PTR records required for deliverability |
| Reverse DNS | Operator's VPS provider | Required for deliverability |
| Reverse proxy (Pattern B) | Caddy recommended; nginx/Traefik supported | Sample configs in OPS.md |
| TLS for outbound mail | Postfix-managed | Library connects unencrypted to localhost |
| TLS for HTTP | Reverse proxy or external terminator | Library does not terminate TLS |
| Process management | Operator's choice | systemd, pm2, docker — library is process-agnostic |

### 10.5 Distribution

| Artifact | Where |
|---|---|
| Library | npm |
| CLI | npm (same package, `bin/knowless-server`) |
| Source | GitHub (Apache 2.0) |
| Docs | In-repo Markdown only — no external docs site |
| Versioning | SemVer |

### 10.6 What's not in the stack

Explicit absences worth naming:

- **No framework** (Express, Fastify, Hono, NestJS) — handlers
  are framework-agnostic; standalone server uses `node:http`
- **No ORM** (Prisma, TypeORM, Sequelize) — direct SQLite
- **No logger library** (Winston, Pino, Bunyan) — `console.log`
  to stdout
- **No validator library** (Zod, Joi, Yup) — manual checks
  against the handful of inputs
- **No test framework beyond stdlib** (Jest, Vitest, Mocha) —
  `node:test`
- **No HTTP client** — the library doesn't make outbound HTTP
- **No mail vendor SDK** (Postmark, SES, Mailgun) — by design
- **No telemetry / analytics** — by design
- **No CLI parsing library** (yargs, commander) — `node:util`
  `parseArgs` covers it

## 11. Operational requirements

### 11.1 Operator commitments

By choosing `knowless`, the operator commits to:

- Running their own server with Postfix installed and configured
  for outbound mail
- Setting up SPF, DKIM, and PTR records for the sending domain
  (one-time setup, documented in `OPS.md`)
- Verifying outbound port 25 is open (some clouds block it)
- Accepting that this is the *only* email their service ever
  sends
- (Pattern A) Issuing and managing their own sessions after auth
  succeeds — actually no, sessions are now in the library
- (Pattern B) Configuring a reverse proxy (Caddy/nginx/Traefik)
  for forward-auth, documented in `OPS.md`

These commitments are documented prominently in `README.md` and
`OPS.md`. The library does not pretend to be a turnkey solution
for operators uncomfortable with these.

### 11.2 OPS.md scope

The `OPS.md` document MUST cover, for Ubuntu/Debian:

- Postfix install command and minimal config for outbound-only
- Test command to verify SMTP submission to localhost works
- SPF record format and where to put it
- DKIM key generation and DNS record format
- PTR record (reverse DNS) — how to request from cloud provider
- Port 25 verification (and alternative if blocked)
- Running `knowless-server` under systemd
- Caddy forward-auth configuration with example for protecting a
  service like Uptime Kuma
- nginx `auth_request` configuration as alternative
- Traefik `forwardAuth` middleware configuration as alternative
- Tailscale/WireGuard pattern for connecting a VPS-hosted
  `knowless-server` back to home-server services
- **Reverse-proxy rate limiting** — sample Caddy and nginx
  configs for adding stricter abuse limits at the proxy layer,
  for operators expecting elevated abuse profiles. Documented
  as the right place for layer-2 defences beyond the library's
  cheap baseline.
- **fail2ban / Cloudflare Turnstile setup** — referenced as
  options for operators with serious bot-traffic problems, with
  honest caveats about their trade-offs (accessibility,
  third-party dependency).
- Optional: forward-confirmed reverse DNS, DMARC

`OPS.md` does NOT include automation scripts. The operator does
the ops; we provide the checklist and sample configs.

## 12. Threat model and risks

### 12.1 Honest threat model

This section is deliberately specific about what `knowless`
defends against and what it doesn't. Auth libraries tend to
oversell their security properties; this one tries not to.

**What `knowless` defends well against:**

- **Database-only leaks.** The DB contains opaque handles
  (HMAC outputs), hashed token IDs, and session IDs. Without the
  HMAC secret, none of these reverse to anything useful. An
  attacker with read-only DB access learns: how many users you
  have, when they were created, when they last had active
  sessions. They cannot identify a specific user, replay a
  session, or log in as anyone.

- **Plaintext exfiltration of email lists.** Because emails are
  never stored in plaintext, there is nothing to exfiltrate. A
  full database dump cannot be turned into a mailing list.

- **Password reuse and credential stuffing.** There are no
  passwords. The attack surface is empty.

- **Weak passwords.** Same reason. There are no passwords to be
  weak.

- **Silent email enumeration via the login form.** Silent-on-miss
  with timing equivalence prevents attackers from confirming
  which emails are registered by polling the login endpoint.

- **Email-bombing a target.** Per-handle rate limit caps
  concurrent active magic links per email (default 5,
  newest-replaces-oldest). An attacker cannot flood a target's
  inbox by repeatedly submitting their email; only the most
  recent N requests produce mails.

- **Naive bot traffic.** Honeypot field in the login form catches
  unsophisticated form-fillers. Sophisticated bots that respect
  CSS hiding will not be caught, but those typically aren't the
  ones spamming login forms in volume.

- **High-volume request floods (mild).** Per-IP rate limiting on
  the login endpoint (default 30/hour) provides cheap baseline
  defence. Operators expecting serious abuse should additionally
  rate-limit at the reverse-proxy layer (documented in OPS.md).

- **Account creation spam (open-registration mode).** Per-IP cap
  on new-handle creation (default 3/hour) limits cost to an
  attacker creating fake accounts at scale.

**What `knowless` defends partially against:**

- **HMAC secret leak alone.** With the secret but not the DB,
  an attacker can confirm whether a *specific* email is
  registered (compute its handle, observe whether the login flow
  can target it). They cannot enumerate all users. They cannot
  forge sessions without DB write access.

- **Phishing.** The library doesn't directly defend against
  phishing, but the magic-link model means users don't have a
  password to type into a fake site. An attacker who phishes the
  email address still needs to receive the magic link in the
  user's actual inbox to authenticate. This is a happy
  side-effect of the model, not something the library does.

**What `knowless` does NOT defend against:**

- **Sophisticated bots that bypass the honeypot.** Bots that
  parse CSS or use real headless browsers will not be caught by
  the hidden field. Operators expecting this need a CAPTCHA or
  bot-management service at the reverse-proxy layer.

- **Distributed floods from many IPs.** Per-IP rate limiting
  caps single-source abuse but doesn't help against botnets or
  distributed attackers. Operators expecting this need
  reverse-proxy rate-limiting with broader heuristics
  (Cloudflare, fail2ban, etc.).

- **Full server compromise.** An attacker with root on the box
  has the secret, the DB, and the running process. They can
  derive any user's handle, forge sessions, and impersonate any
  user. No auth library defends against this — the operator
  is, by definition, able to do anything.

- **Compromised email account.** If an attacker controls the
  user's mailbox, they receive the magic links and can log in.
  This is the inherent trade-off of email-based auth. The
  defence is the user's mail provider, not us.

- **Social engineering.** Convincing a user to forward a magic
  link or click on a fake one is outside this library's scope.

- **Insider threat at the operator.** Whoever runs the service
  can read the DB and the secret. They can sign as any user.
  This is a property of any auth system; mitigation is
  organizational, not cryptographic.

- **DNS hijacking, MITM, BGP attacks.** Standard internet-scale
  threats. Defended by HTTPS (which the library requires) and
  the operator's network hygiene.

### 12.2 Specific risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Magic links land in spam due to operator's poor mail setup | High | Auth becomes unreliable | Comprehensive OPS.md; clear warning in README that deliverability is the operator's responsibility |
| Silent-on-miss timing leak via subtle code change | Medium | Identity enumeration possible | Automated timing test in CI; CLAUDE.md non-negotiable |
| Operator wants features outside scope and forks badly | Medium | Fragmentation, security regressions in forks | NO-GO table documented prominently; sibling projects framing for genuinely new features |
| Open-redirect vulnerability in the redirect-after-login flow | Medium | Phishing attacks | Whitelist redirect targets to cookie domain; security test |
| Session cookie scope misconfigured by operator | Medium | Either no SSO across services, or cookie sent to unexpected domains | Default to safe value (eTLD+1 of baseUrl); document with example |
| `nodemailer` introduces vulnerability | Low | Library inherits the issue | Single dep, well-maintained, monitor advisories |
| `node:sqlite` API changes between Node versions | Low | Default store breaks | Pin Node 22+ as minimum; document fallback |
| Operator's HMAC secret leaks (without DB access) | Low | Email enumeration via guessing becomes possible; sessions still safe | Document secret handling clearly; recommend env-var-only storage |
| Operator's HMAC secret AND DB both leak | Low | Full identity exposure for known emails; session forgery possible | Document defence-in-depth: keep secret out of DB, monitor for both |
| Forward-auth misconfig allows unauthenticated access | Medium | Protected service exposed | Sample configs in OPS.md; clear warnings about `error_pages` / fallback paths |
| Timing test is statistically flawed and passes despite leak | Low | False sense of security | Use a well-established statistical test; document methodology in test file |

## 13. Open questions

These are deliberately surfaced for resolution before or during
implementation, not silently decided.

- **Q1.** ~~Open~~ **Resolved (v0.10):** The store interface
  exposes `deleteHandle(handle)`, supporting GDPR right-to-erasure.
  Not exposed as an HTTP handler — the operator chooses their UX.
  Codified as FR-37a.
- **Q2.** Should the library return an error when the operator
  attempts to construct it without Postfix running on localhost?
  Connection error at startup is loud; lazy connection at first
  send is silent until the first user tries to log in. Probably
  fail-fast at startup.
- **Q3.** Should we cap the number of pending tokens per handle
  to prevent inbox flooding via repeated login attempts? Probably
  yes; default of 5 pending tokens, with newest replacing oldest.
- **Q4.** Should the library's `from` address support display
  name (`"YourApp <noreply@yourapp.com>"`)? Cosmetic but improves
  inbox UX. Probably yes; passes through to nodemailer.
- **Q5.** Should the standalone server expose any admin endpoint
  for listing or revoking sessions? Probably no for v1; the
  operator can manage the SQLite database directly if needed. If
  this becomes a common request, consider a `bin/knowless-admin`
  CLI in v0.2.
- **Q6.** Should the login HTML form be customisable (logo,
  colours, copy) or strictly hardcoded? Strictly hardcoded for
  v1. If customisation becomes a common request, consider a
  single optional template file in v0.2 — but resist as it
  invites scope creep.

## 14. Non-goals (the NO-GO table)

Recorded explicitly and unconditionally. **Re-litigating these is
the single biggest scope creep risk and they are written here to
prevent that.** When a feature request comes in, point at this
table.

| # | Non-goal | Reason |
|---|---|---|
| 14.1 | Remote SMTP / mail vendor support | Forces credential management and invites the operator to use the same mailer for non-auth mail. Localhost Postfix is the only transport. |
| 14.2 | Email templating, HTML email, branding | Magic link body is a fixed plain-text format. Operators wanting custom branding fork or live with it. |
| 14.3 | Multiple recipients, broadcast, marketing list | API shape (single recipient per send) makes this impossible by construction. |
| 14.4 | Bounce handling, click tracking, open analytics | None. Send and forget. Tracking would contradict the philosophy. |
| 14.5 | Postfix install/configuration helpers | Out of scope for v1 (and probably ever). Operator runs Postfix; we document what they need. |
| 14.6 | OAuth / OIDC / SAML provider modes | Different audience, different surface area. |
| 14.7 | 2FA, WebAuthn, TOTP, biometrics | Compose with `simplewebauthn`, `speakeasy`, etc. |
| 14.8 | Account recovery flows beyond "request a new link" | No password to recover. The recovery is auth itself. |
| 14.9 | Account TTL, expiry, deactivation as built-in fields | Operator metadata table, not library state. Six lines of operator code on top. Adding it opens the door to `created_at`, `last_active_at`, `display_name` — a slope to a user model. |
| 14.10 | Allowlists / denylists with admin UI | Recipe in README. Operator wraps `loginHandler` with their own check. |
| 14.11 | Federated identity across deployments | Each deployment is sealed. Different secret = different handles. By design. |
| 14.12 | Telemetry, analytics, error reporting | Never. No phone-home of any kind. |
| 14.13 | Hosted SaaS version | Contradicts the philosophy. |
| 14.14 | Magic codes (numeric one-time codes) | Not in the borrowed pattern. Stay narrow. |
| 14.15 | DKIM/SPF verification for inbound mail | Different problem. Belongs in a sibling library or in [gitdone] directly. |
| 14.16 | Cross-device auth flow | Real need but different problem family. |
| 14.17 | TypeScript source | JSDoc + shipped `.d.ts` is sufficient. No build step. |
| 14.18 | Pin commitments / password equivalents | Anything brute-forceable from a database leak undermines the privacy-by-architecture story. Magic-link round-trip is the only auth mechanism. |
| 14.19 | Customisable login form (templates, themes) | Hardcoded HTML form. Operators wanting branding fork or live with it. |
| 14.20 | "Welcome email" / onboarding email / any non-magic-link email | Library cannot send anything else. By API shape. |
| 14.21 | Group-based ACLs ("alice can access kuma, bob can access adguard") | Slope to a user model. If genuinely needed, separate sibling library `knowless-rbac` later. v1 is "you're authenticated or you aren't." |
| 14.22 | OAuth/OIDC compatibility for forward-auth | Self-hosters who want OIDC have Authelia/Authentik. We're the simpler-than-that option. |
| 14.23 | Admin UI for managing handles or sessions | SQLite database is the admin UI. Operator can `sqlite3 knowless.db` if needed. |
| 14.24 | Customisable email body / subject beyond simple text replacement | Subject is configurable via `subject` option. Body is fixed. Branding belongs elsewhere. |
| 14.25 | Hashcash / proof-of-work challenges on the login form | Punishes weak-hardware users more than dedicated attackers; adds JS to a deliberately JS-free form; doesn't actually solve email-bombing (per-handle rate limit does). The cost-benefit is wrong for this threat model. |
| 14.26 | CAPTCHAs (hCaptcha, reCAPTCHA, Cloudflare Turnstile) | Third-party dependency, accessibility-hostile, contradicts the no-vendor philosophy. Operators expecting bot abuse should put a CAPTCHA at the reverse-proxy layer, not in the library. |
| 14.27 | Behavioural / fingerprint-based bot detection | Tracking surface that contradicts the privacy stance. The honeypot + per-IP cap is the cheap defence we're willing to ship; anything more belongs at a different layer. |
| 14.28 | Email validation beyond syntactic check | We don't verify MX records, don't check disposable-email lists, don't probe for deliverability before sending. The magic-link round-trip is the validation. |
| 14.29 | HTML email / multipart / inline images | All outbound is `text/plain` UTF-8. HTML email reduces deliverability, enables tracking, and adds complexity for zero benefit on a sign-in link. |
| 14.30 | External resources on the login form / confirmation page (web fonts, CDN images, analytics scripts) | Loading anything from an external host leaks information about the user to that host. Pages are self-contained. |
| 14.31 | Tracking pixels, click-rewriting URLs, open/click analytics | Privacy-hostile. Also impossible in plain-text email anyway. |
| 14.32 | Mail headers that signal "mass mail" (`List-Unsubscribe`, `X-Campaign`, etc.) | Not appropriate for transactional auth mail; reduces deliverability when present incorrectly. The library sends standard transactional headers only. |
| 14.33 | JSON / YAML / TOML config file support | Env vars are canonical (12-factor). Adding file-based config invites secrets-in-files footguns and adds parsing surface. Operators wanting "one place to see everything" use `--print-config`. |
| 14.34 | Hot-reload of config without restart | Auth secret changes invalidate all sessions anyway. Restart is the boundary. |
| 14.35 | Multiple named config profiles (dev/staging/prod) | Each environment is a separate deployment with its own env. Don't reinvent deployment management. |
| 14.36 | `--secret` or other CLI flags that accept secret values | Secrets in CLI args appear in `ps` and shell history. Forbidden by FR-52. Env vars only. |
| 14.37 | Bundled `.env` file loader | Node 22+ has `--env-file=` built in. Don't reinvent the runtime. |
| 14.38 | Geolocation (city, country, region) in last-login hint or anywhere else | Requires GeoIP database (extra dep + data file), accuracy is mediocre, creates a "we know where you log in from" property that contradicts the privacy stance. Timestamp alone (FR-22) gives the user the compromise signal they need. Operators who genuinely want location can override the email body and inject their own. |
| 14.39 | IP address logging or storage per handle | Same reasoning as 14.38 — the hot path of `verifyHandler` should not write IP to the store on every authenticated request. IP is used transiently for rate limiting (in-memory or short-lived counters per FR-43) but is never persisted alongside the handle. |
| 14.40 | User agent / device fingerprint storage | Tracking surface. Doesn't add real security value (UA strings are easily spoofed). |
| 14.41 | Login history beyond the most recent successful sign-in | `last_login_at` is one timestamp, not a journal. Storing a history of logins becomes a tracking artefact and grows unboundedly. If the operator needs login history for compliance, they instrument it themselves at their layer. |
| 14.42 | Per-handle metadata fields beyond `last_login_at` | No `created_at`, `display_name`, `email_changed_count`, `tos_accepted_at`, etc. The library refuses to grow a user model. Operators store their own metadata in their own table keyed by handle. |

## 15. Sibling project candidates (NOT v1 commitments)

Recorded so we don't accidentally absorb their scope into knowless.
None of these are commitments; they're markers of related work
that might happen elsewhere.

- **DKIM/SPF inbound verification library** extracted from
  [gitdone] — for "verified email actions" use cases (workflow
  replies, attestations). Different problem family.
- **Forgetful-form library** applying the same philosophy to
  contact forms, signups, comment fields — accept input, store
  the minimum, never retain identifying info.
- **`bareprofile`-style minimal user metadata store** — for
  operators who genuinely need to store some user metadata but
  want the same architecture (encrypted at rest, salted lookups,
  forgets defaults).
- **`knowless-rbac`** — if group-based access control becomes a
  recurring request from the self-hoster audience, a thin sibling
  that adds "this handle can access these services" rules without
  bloating `knowless` itself.
- **`bareletter`** — minimal one-shot SMTP sender for operators
  who want the same hermit philosophy applied to whatever
  occasional non-auth mail they have to send.

These are explicitly OUT of `knowless`'s scope. If they exist,
they exist as separate libraries with separate scopes. Don't
absorb them.

## 16. Decisions log (for future Claude)

> **This section captures the design conversation's key
> decisions and their reasoning.** Future Claude sessions
> working on this project should read this section before
> proposing changes that touch any of these decisions. If the
> user asks for something that contradicts a decision here,
> push back first by referencing the recorded reasoning; only
> change if the user provides a new reason that wasn't
> considered originally.

### 16.1 Why magic-link, not pin commitments

**Decision:** No pin commitments, no password equivalents. Auth
is exclusively magic-link round-trip.

**Reasoning:** Pin commitments (the addypin pin, repurposed as an
auth factor) recreate the password problem in disguise. A
commitment in a database is brute-forceable; users reuse pins
across services; a leaked commitment table is a leaked password
table with extra steps. The whole "we hold no secrets that
matter" story collapses. Magic-link round-trip means there is
*nothing* on our side that, if leaked, could be used to log in as
a user.

This was reconsidered mid-design and explicitly rejected. Don't
revisit unless the user produces a fundamentally new argument.

### 16.2 Why Postfix on localhost, not nodemailer-to-anything

**Decision:** The bundled mailer connects exclusively to
`localhost:25`. No remote SMTP, no auth, no vendor APIs.

**Reasoning:** A remote SMTP / vendor configuration would require
holding credentials, would invite using the same mailer for
non-auth mail, and would add a vendor relationship. Localhost
Postfix means: no credentials, no vendor, no second-mail
temptation because there's no convenient way to reuse the
connection for a mailing list. The operator commits to "this is
the only mail we send" by *not having infrastructure that makes
other mail easy*.

The trade-off is that the operator must run Postfix and handle
deliverability themselves. That filter is intentional — it's the
right adopter audience.

### 16.3 Why bundled, not primitive

**Decision:** The library is full-stack — handles the HTTP
endpoints, the mailer, the storage. Six-line integration. Not a
primitives kit the operator composes.

**Reasoning:** A primitives kit would force every adopter to wire
up the mailer themselves, which is the part most likely to go
wrong. Bundling means the privacy-preserving choices are *in the
library*, not contingent on the operator making correct choices.
The library makes the safe path the easy path.

This was the major late-stage shift in the design conversation.
The earlier "primitive + bring your own mailer" version was
philosophically purer but practically weaker.

### 16.4 Why Node 22.5+ and `node:sqlite` (revised v0.15)

**Decision (v0.2.0):** Target Node 22.5+. Use `node:sqlite` (Node
stdlib) as the only store backend. Drops `better-sqlite3`.

**Reasoning (revised v0.15):** The v0.10 decision to target Node 20
+ `better-sqlite3` cited two reasons: (1) `node:sqlite` was
flag-gated in early Node 22 with a stderr experimental warning
on every invocation, (2) Node 20 was the widest LTS floor.

Both have aged out:

- `node:sqlite` was unflagged in Node 22.13 (Jan 2025) and is
  fully stable in Node 24 LTS (Oct 2025). The remaining friction
  is one experimental warning at first import on 22.x, suppressible
  with `--no-warnings` and absent on 24+. Persistent operator
  friction has gone to ~zero.
- Node 20 reaches EOL in April 2026 (i.e. essentially now). The
  "widest LTS floor" argument flips: 22.5+ IS the widest LTS floor
  going forward.
- The cost of `better-sqlite3` turned out to be substantial: it
  requires a C++20 toolchain on every install. The PRD §4.2
  self-hoster audience disproportionately runs RHEL 8/9 / Alma /
  Rocky / Amazon Linux 2 — distros that ship gcc 8 or 11 by
  default. addypin's M11 deploy hit this on a stock RHEL 8 host.
  AGENT_RULES "vanilla > stdlib > external" was being violated for
  what turned out to be migration-period concerns, not durable
  ones.

The v0.2.0 swap closes AF-2.29: zero native compile, one production
dep (`nodemailer`), ~40 → ~2 transitive packages, no `gcc` / `make`
/ Python during `npm install`. Public `Store` interface (SPEC §13)
is byte-for-byte identical so the change is internal-only.

> **Pre-v0.2.0 history (v0.10 reasoning, archived):** Earlier
> drafts targeted Node 22+ specifically to use the built-in
> `node:sqlite`. In Node 22 it was gated on `--experimental-sqlite`
> with a stderr warning and a runtime flag in every invocation,
> so v0.10 decided one stable external dep beat one flag-gated
> stdlib module and dropped to Node 20 + `better-sqlite3`. v0.15
> revisits this once the flag-gate dropped and the C++20-toolchain
> cost became visible.

### 16.5 Why JavaScript, not TypeScript

**Decision:** Plain JavaScript with JSDoc annotations. Ship
`.d.ts` for TS consumers. No build step.

**Reasoning:** Aligns with the `bare` suite ethos. Easier to
audit. Lower install footprint. TS users get types via JSDoc-
generated `.d.ts`. The library is small enough that TS's
ergonomic benefits don't outweigh the build-step cost.

### 16.6 Why silent-on-miss with timing equivalence (revised v0.4)

**Decision:** Same response, same timing, registered or not.
Enforced by automated test. No opt-out, even in debug mode.

**Reasoning:** Silent-on-miss is the right default for a privacy-
first library because it costs almost nothing in implementation
complexity and is what most magic-link libraries get wrong. It
prevents email enumeration via the login form.

**Honest scoping (revised v0.4):** Earlier drafts of this PRD
treated silent-on-miss as the library's *defining* feature.
That overstates it. Email enumeration is a real-but-secondary
concern; the library's actual identity is the broader refusal
posture (no plaintext storage, no non-auth mail, no growth
beyond v1). Silent-on-miss is one expression of that posture, not
its core.

We still keep the property and the timing test — it's good
hygiene and removing it weakens the privacy story — but it is
not the reason the library exists. If a future change makes the
timing equivalence harder to maintain perfectly, that's a
discussion to have, not an automatic veto.

The non-negotiable is the *philosophy* (refuse to store
identifiable data, refuse to send non-auth mail, refuse to
grow). The timing equivalence is an implementation property
that supports that philosophy, not the philosophy itself.

### 16.7 Why no DKIM in this library

**Decision:** No DKIM verification, no SPF verification, no
inbound mail handling. That's gitdone's territory.

**Reasoning:** DKIM solves a different problem (inbound message
authenticity) and has different ergonomics, deployment
requirements, and operational complexity. Bundling it would
force every adopter to accept mail-receiving infrastructure even
when they only want auth. If a use case combines auth with
verified inbound, the operator composes `knowless` with gitdone-
extracted verification — they don't get one library that does
both badly.

### 16.8 Why no allowlist code in the library

**Decision:** Allowlist + TTL pattern is a README recipe (~6
lines of operator code), not library code.

**Reasoning:** Adding allowlist tables to the library means the
library knows about handle metadata, which means the schema
grows, which means more surface to maintain. The slippery slope
ends in a user model. The recipe is small enough that the
operator can write it without our help.

### 16.9 Why walk-away after v1

**Decision:** v1.0.0 is the target. After that, maintenance mode
only — security patches, bug fixes. Feature requests are
deflected.

**Reasoning:** The library's value comes from being small,
focused, and finished. A library that keeps growing will end up
as another Auth0 in five years. Walking away is what makes
"complete and correct" possible. The OSS-because-it's-easier
framing only works if the project can be walked away from
without becoming bad software.

### 16.10 Why ship the standalone server (forward-auth)

**Decision:** Ship `bin/knowless-server` as a CLI binary in v1
that runs the auth-only HTTP service for forward-auth deployments.
Not just an example in docs — actual shipped code.

**Reasoning:** The self-hoster audience (gating Kuma, AdGuard,
etc.) is large, identifiable, and underserved. The existing
options (Authelia, Authentik, oauth2-proxy, Keycloak) are all
heavyweight relative to the simplicity of the actual problem
("redirect to login if no cookie, otherwise let through").

The marginal cost in code is small (~50 lines of CLI + standalone
server wiring on top of the library that already exists). The
marginal value is large: an operator can deploy `knowless` for
this use case without writing any code, just config. That's a
materially different product than "library you import." Both
shapes from the same codebase is the right answer.

The decision was made by comparing two options:

- **Option A:** Document the standalone-server pattern as an
  example in README; operator copies and runs it themselves.
  Simpler from library-author perspective.
- **Option B:** Ship the binary in the package so operator can
  `npx knowless-server`. Slightly more code; meaningfully
  simpler for the operator.

Chose B because the audience that wants this is the same
audience that should have the lowest possible friction: they're
already wrestling with reverse-proxy config and Postfix, they
shouldn't also have to write Node code.

### 16.11 Why session management belongs in the library

**Decision:** Sessions (signed cookies, configurable lifetime,
forward-auth verify endpoint, logout) are part of the library,
not delegated to the operator.

**Reasoning:** Earlier design said "library hands back a handle;
operator manages sessions." That works for Pattern A (library
mode in a Node app where the operator already has session
infra). It does not work for Pattern B (standalone server) where
there's no host application to do session management.

For consistency and because Pattern B is a first-class
deployment mode, sessions move into the library. Library mode
operators can ignore the cookies and use their own session
library if they prefer; the handle is still returned for that
case via a callback.

### 16.12 Why hardcoded login HTML

**Decision:** The login form is a single hardcoded HTML page in
the library source, not a template.

**Reasoning:** Templating is a slope. Today it's "let me put my
logo." Tomorrow it's "let me theme the whole page." Eventually
it's "let me embed a JavaScript framework." The hardcoded form
is one form, looks fine, refuses to drift. Operators wanting
branding fork or live with it.

This is consistent with §14.2 (no email templating) — branding
is not the library's job.

### 16.13 Why we don't oversell auth as a hard problem

**Decision:** The library's marketing, README, and docs frame
auth as a problem the industry has overcomplicated, not as a
hard distinct expert-only domain.

**Reasoning:** For the audience this library serves — small
services, indie tools, internal dashboards, self-hosters — auth
is genuinely not that hard. Magic links + a session cookie cover
the realistic threat model. The industry's framing of auth as
expert-only serves auth vendors (who charge per seat) more than
it serves users.

`knowless` is, fundamentally, a return to a simpler answer that
always worked. The library shouldn't pretend to be a clever new
architecture; it should be honest about being a refusal of
unnecessary layers. The "fisherman by the river" framing —
sometimes the simpler version is enough, and the elaborate
version exists because we forgot the simpler one was an option.

This decision was made when the user pushed back on Claude's
tendency to over-stress auth-enumeration as a defining concern.
The library still has good security properties (see §12.1) but
they're not the headline. The headline is the philosophical
stance.

### 16.14 Why we publish an honest threat model

**Decision:** §12.1 specifies what `knowless` defends against
and what it doesn't, in plain language, including its
limitations.

**Reasoning:** Most auth libraries hide behind vague claims
("enterprise-grade security," "zero-trust architecture") that
don't survive scrutiny. The library is small, the audience is
sophisticated, and they deserve to know exactly what they're
buying.

In particular, being honest about what `knowless` doesn't defend
against (full server compromise, compromised email accounts,
social engineering) prevents operators from trusting the library
to do things it can't. False security is worse than acknowledged
limitations.

If a feature request would require expanding the threat model
in a way the library can't honestly defend, the answer is: tell
the operator that's outside the threat model, point them at
sibling libraries or other tools, and don't add the feature.

### 16.15 Why cheap abuse protection is built-in by default

**Decision:** Per-email rate limit, per-IP rate limit, honeypot
field, and per-IP account-creation cap (when open registration
is on) are all baked into the library with safe defaults.
Operators can adjust thresholds or disable individual checks but
get sensible protection out of the box.

**Reasoning:** The library serves operators who don't want to
think about auth. If "set up rate limiting yourself" is required
homework, most won't do it, and the library leaves them exposed
to the easiest abuses (email-bombing a target, naive bot spam,
account-creation flooding in open-reg mode). These defences are
genuinely cheap — a few rows in the existing store, one
honeypot input — and catch the cheapest attacks without operator
effort.

The defaults aim at the right ratio: high enough that legitimate
users won't hit them in normal use (5 active tokens per email is
generous; 30 logins per IP per hour easily covers a household);
low enough to make the relevant abuse uneconomical.

The principle: **build in the cheap, automatic defences. Document
clearly what serious abuse profiles need (reverse-proxy rate
limits, fail2ban, CAPTCHA at the edge). Refuse to build the
heavyweight defences in the library itself** — that's what §14.25
through §14.27 cover.

Operators who run on a public internet with active abuse should
add a reverse-proxy rate-limiter (Caddy, nginx, Cloudflare) on
top. The library's built-ins are a baseline, not a complete
defence. OPS.md documents the layer-2 setup.

This is consistent with the "not for everyone" framing: if your
threat profile genuinely needs CAPTCHA-grade bot defence,
`knowless` is one piece of your stack, not the whole stack. The
library refuses to grow into the bot-management space.

### 16.16 What "silent on miss" actually means

**Decision:** "Silent on miss" means the response *shape and
timing* are uniform regardless of internal outcome. It does NOT
mean the user receives no feedback. The user always sees a
confirmation: "Thanks. If `<email>` is registered, a sign-in
link is on its way." This message is shown for every submission —
registered hit, silent miss, rate limit, honeypot trigger,
SMTP failure — without distinction.

Rate-limit hits in particular are uniformly silent. There is no
"you've requested too many links, try again later" message.
That message would tell an attacker (a) the email is registered
and (b) their abuse is being noticed, both of which leak
information.

**Reasoning:** Without this clarification, "silent on miss"
could be read as "give the user no feedback at all," which is
hostile UX and would invite operators to add their own
informative error responses (defeating the whole point). Being
explicit here prevents future drift.

The cost is real but accepted: a legitimate user who hits the
per-IP cap by accident (shared NAT, etc.) gets silent failure
with no clear remedy. The mitigation is generous defaults
tuned for legitimate use; operators in unusual NAT environments
adjust the threshold up. Privacy of registered/non-registered
status is worth the trade-off.

The per-handle policy is "newest replaces oldest" rather than
"reject," so users mashing the submit button still get fresh
working links rather than an angry empty-handed silence.

This was added in v0.6 after the user pointed out that the
silent-on-miss spec didn't explicitly cover the UX side and
could be misread.

### 16.17 Why everything is plain text and minimal HTML

**Decision:** All emails are `text/plain; charset=utf-8` only.
All HTML pages (login form, confirmation, error) are
self-contained plain HTML5 with no JavaScript, no external
resources (fonts, images, stylesheets), no analytics, no
third-party widgets. Inline minimal CSS only if any.

**Reasoning:** Three converging concerns:

1. **Deliverability.** Self-hosted Postfix on a fresh VPS IP
   already starts with poor sender reputation. HTML email,
   tracking pixels, complex MIME structures, and unusual
   headers all push messages further toward spam folders. A
   short plain-text email with the link, standard headers,
   and 7bit/quoted-printable encoding is what mail providers
   are most willing to deliver. Each "fancy" feature is a
   reason to filter.

2. **Privacy.** Tracking pixels, click-rewriting URLs, and
   external resource loads (web fonts, images on the
   confirmation page) all leak information about the user.
   An email with a tracking pixel reports "user opened the
   email" back to the sender. A login page that loads Google
   Fonts tells Google about the user. None of this is
   acceptable for a library whose whole purpose is privacy.

3. **Simplicity.** Adding HTML email means templating, MIME
   multipart handling, image embedding, dark-mode handling,
   and a long tail of email-client compatibility issues. The
   library refuses all of that by refusing to send HTML at
   all. The login page being plain HTML means it works in
   any browser, in any locale, with any assistive tech, with
   no JavaScript engine.

The default email body and login-page markup ship as part of
the library. Operators who want branding or richer
presentation can fork the project — but the defaults are
deliberately bare-bones, and that's a feature.

This decision was made when the user emphasized that
deliverability and "passing spam" mattered as a first-order
concern. It also formalizes constraints that were implicit
elsewhere (no tracking, no templates, no JS).

### 16.18 Why env vars, not config files

**Decision:** Configuration is via environment variables
exclusively. CLI flags are limited to inspection and
validation (`--help`, `--version`, `--print-config`,
`--config-check`). No JSON / YAML / TOML config file support.
Secrets cannot be set via CLI flags. `.env` file loading uses
Node 22+'s built-in `--env-file=` rather than a library
feature.

**Reasoning:** Four concerns, in order of weight:

1. **Secrets in files is a footgun.** JSON config files end
   up committed to git, backed up to insecure locations,
   readable by other processes, and pasted into Slack
   during debugging. Env vars have decades of tooling
   convention around redaction and deployment-platform
   integration. The HMAC secret is the keystone of the
   library's security model; the path of least resistance
   for storing it should be the safe path.

2. **12-factor consistency.** The Twelve-Factor App
   methodology specifies env-vars-for-config for good
   reasons. Switching to file-based config would be a
   regression in deployment hygiene.

3. **Suite consistency.** Other `bare` projects use env
   vars and CLI flags. Adding a config-file mechanism here
   would be an inconsistent surprise.

4. **Scope creep avoidance.** Config-file support invites
   precedence-chain logic, hot-reload requests, multiple
   profiles, validation schemas, etc. — all of which are
   features of a configuration-management subsystem, not
   of a 400-line auth library.

**The instinct that drove the question** ("operator wants one
place to see everything this instance is configured to do") is
real and worth solving. The answer is `knowless-server
--print-config`, which loads config the same way the running
server would, prints every effective value with secrets
redacted, and exits. Operators get inspectability without the
risks of file-based config.

`config.example.env` ships in the repo as a documentation
artifact: a documented sample with every option, its default,
and a short explanation. Operators copy it, fill in secrets,
load it via Node's `--env-file=` or systemd `EnvironmentFile=`.
The file is a template, not a library-loaded source of truth.

This decision was made when the user asked whether one
config.json was the right choice. After weighing the
alternatives, env vars + a `--print-config` command was the
better answer for security, consistency, and scope discipline.

### 16.19 Why last-login timestamp yes, location no

**Decision:** The library tracks `last_login_at` per handle and
appends "Last sign-in: <timestamp>" to outgoing magic-link
emails by default. It does NOT track or expose location, IP,
user agent, or any other identifying metadata.

**Reasoning:** A short timestamp in the email gives the user a
free signal to detect compromise: if they see a recent login
they don't remember, they ignore the email and possibly act on
it. This is genuinely valuable security UX — banks have done
this for years and it works.

But location is where the slope begins. Adding location requires:

- A GeoIP database (extra dep or large data file)
- Periodic updates of that database
- Storing IP per login event (or geocoding on the fly with the
  same GeoIP database from a transient IP)
- Accuracy is mediocre; misattribution confuses users ("you
  logged in from Belgium" when the user is in Germany behind a
  VPN)
- Creates a "we know roughly where you live and where you log
  in from" property that contradicts the privacy stance

Timestamp is operationally useful and not directly identifying.
Location is operationally marginal and meaningfully identifying.
The line is drawn between them.

The library refuses location even as an opt-in feature. Operators
who genuinely want location can override the default email body
template and inject their own (the magic link itself is preserved
per FR-16); the library will not provide a hook for "look up the
user's location and add it to the body" because the library
shouldn't have GeoIP dependencies and shouldn't normalize
location-tracking even as an opt-in.

This is also why §14.39 forbids storing IP per handle. IPs go
into transient rate-limit counters (per FR-43) and nowhere else.
The hot path of `verifyHandler` MUST NOT write IP to persistent
storage on every authenticated request.

The line: **timestamp is a security signal, location is
surveillance**. They feel similar but they're different in
substance, and the library treats them differently for that
reason.

This decision was made when the user proposed adding "last
successful login time and place" to the email. Time was accepted
as a useful security feature; place was rejected because it
crosses from security into tracking.

### 16.20 Why timing envelope narrowed in v0.10

**Decision:** FR-6 was narrowed in v0.10. Strict timing
equivalence applies only to the registered-vs-unregistered
(silent-on-miss) path. Rate-limit and honeypot short-circuits
are explicitly exempt.

**Reasoning:** Earlier drafts of FR-6 required all four paths
(registered hit, silent miss, rate-limit hit, honeypot trigger)
to fall within the same timing envelope. Implementing this
strictly requires *sham* work — fake DB writes on the
short-circuit paths, deliberate sleeps, work-mirroring — to
match the envelope of the real-work paths.

The narrower contract reflects what each timing channel actually
leaks:

- **Registered vs unregistered timing** is the enumeration
  vector. An attacker submitting candidate emails learns from
  response timing whether each email is in the database. This
  is the one that matters; it's the contract the timing test
  enforces.

- **Rate-limit timing** would leak "you are being rate-limited."
  But the attacker who triggered the limit already learned this
  from the request volume — they sent enough requests to hit
  the threshold. The timing channel is redundant with the
  volume signal.

- **Honeypot timing** would leak "you filled the honeypot
  field." But the attacker is a bot that *did* fill the
  honeypot field. They already know what they did.

So the strict envelope was protecting nothing the volume /
behavior signals didn't already expose. Meanwhile it imposed
real costs: legitimate users on shared NAT who hit the per-IP
cap by accident would be held in artificial multi-second delays
just so the response shape matched. That's the wrong trade for
a library that wants to be friendly to humans on weird networks
(Craigslist's lesson: fight bots in ways that don't make life
worse for ordinary users — safe defaults without manufactured
friction).

The pragmatic version keeps the contract that matters and drops
the one that doesn't. §16.16 still applies — rate-limit hits
MUST still be silent in *response shape*: same confirmation
message, same status code, no "you've been rate-limited" leak.
Only the timing envelope is narrowed.

§14.27 (no behavioural fingerprinting) still rules. This is
about right-sizing the timing test, not loosening the
philosophy.

## 17. Audit findings (v0.1 hardening backlog)

> Discovered during the Phase 4-5 self-audit triggered by the
> question "did you really pass all tests or make them pass?"
> These items distinguish from §13 (open questions deferred
> by choice) and §14 (non-goals deliberately out of scope).
> They are gaps between "the implementation passes tests" and
> "the tests verify the contract" — plus a handful of real
> defense-in-depth code gaps.

### 17.1 Test-quality findings

Several existing tests would pass against broken
implementations, because they verify "the function round-trips
with itself" instead of "the function matches a known
algorithmic output." This is the AGENT_RULES "tests that
mirror implementation" anti-pattern.

| ID | What's weak | Why it matters |
|---|---|---|
| AF-1.1 | `deriveHandle` determinism + different-input-different-output tests | A broken HMAC (wrong algorithm, missing key, hash other than SHA-256) would still produce deterministic varied output; tests would still pass. |
| AF-1.2 | Session signature round-trip and tamper-rejection | Substituting SHA-1, omitting the `sess\0` domain tag, or HMAC'ing the wrong byte sequence would still round-trip cleanly inside the library. |
| AF-1.3 | Session expiry behavior in `verify` handler | No test exercises `expiresAt <= now` rejection; off-by-one or always-true bugs in the expiry check are uncaught. |
| AF-1.4 | Concurrent token redemption | Replay protection is exercised serially; no test asserts that of N parallel redemptions exactly one wins. |
| AF-1.5 | Concurrent token issuance under cap | SPEC §4.7 BEGIN IMMEDIATE serialization is asserted by spec but not by test. Cap could be bypassed under contention. |
| AF-1.6 | Rate-limit window-boundary precision | "Different windows have different counts" is tested; the precise rollover instant (off-by-one in `windowStart` math) is not. |
| AF-1.7 | SMTP-failure response uniformity | NFR-10 ("SMTP failure logged, never leaked") has handler code but no test that compares response bytes between mail-success and mail-failure paths. |
| AF-1.8 | FR-6 timing test gameability | The 1ms-Δ_mean bar would be passed by a pathological `await sleep(100ms)` implementation. The test catches *regressions* in the sham-work design but doesn't *prove* the design — proof comes from code review. |

### 17.2 Code-level defense-in-depth gaps

The tests can't catch these because the production code itself
is missing the defense.

| ID | Gap | Severity |
|---|---|---|
| AF-2.1 | Email header-injection guard in `composeRaw` | The `to` field is interpolated into raw RFC822. `normalize()` rejects `\r\n` upstream, but `composeRaw` should also reject — defense in depth. |
| AF-2.2 | No CSRF-equivalent on `POST /login` | An attacker page can autosubmit a form to trigger a magic-link send to a known email. Doesn't compromise sessions, but is noise. SPEC §15 Q-4 deferral; resolution is Origin-header validation. |
| AF-2.3 | Cookie `Secure` flag breaks HTTP localhost dev | New adopters can't test locally without TLS. Need a `cookieSecure` config option (default `true`). |
| AF-2.4 | Naive cookie parser | `header.split(';')` doesn't handle quoted values with embedded `;`. Our values don't contain `;` but malicious injected cookies could confuse. |
| AF-2.5 | No stored-handle integrity check | `store.upsertHandle()` accepts any string. A bug elsewhere passing a wrong format wouldn't be caught at the store boundary. |
| AF-2.6 | Sweeper failure has no alerting hook | If `sweepTokens` throws repeatedly, we log to stderr and continue. Tables grow silently. No metric, no alert. |
| AF-2.7 | Cookie domain mismatch with request Host header | `verify` accepts a valid cookie value regardless of which Host the request claims. Reverse proxies typically prevent this in practice; not a vuln in deployment, but the library trusts. |
| AF-2.8 | No programmatic `handleFromRequest(req)` API | The HTTP-shaped `verifyHandler` is awkward for in-process middleware. Library-mode adopters end up copying code or doing sub-request hacks. New finding from the first-customer (webrevival forum) scope review. |
| AF-2.9 | No `revokeSessions(handle)` API | "Log out everywhere" without deleting the account is a common operator action (suspected compromise). `deleteHandle` is the only adjacent primitive but nukes the handle too. Surfaced by addypin spike. |
| AF-2.10 | `POST /logout` had no Origin/Referer check | A cross-origin page could force-logout an authenticated victim. POST + SameSite=Lax doesn't cover same-eTLD+1 attacker subdomains. Surfaced by addypin spike audit. |
| AF-2.11 | `confirmationMessage` rendered as raw HTML | Operator-config string interpolated unescaped; if the operator naively passed user-controlled data through it, reflected XSS. Footgun, not direct vuln. Surfaced by addypin spike. |
| AF-2.12 | `trustedProxies` accepted only exact IPs | k8s/docker/cgnat deployments can't enumerate every peer IP. CIDR support needed. Surfaced by addypin spike. |
| AF-2.13 | No SMTP-down dev fallback | Local development without a real Postfix has no way to obtain the magic link. Operators end up stubbing the mailer. Surfaced by addypin spike. |
| AF-2.14 | No programmatic magic-link entry | Adopters building "use first, claim later" UX (deferred-claim disposable resources, e.g. drop-a-pin-then-confirm) can't reproduce the FR-6 timing-equivalence guarantee without reaching into private exports. Surfaced by addypin POC. |
| AF-2.15 | No `auth.deriveHandle` instance method | Adopters needing the handle outside HTTP context import the helper directly and pass the secret manually, spreading secret-handling surface. Surfaced by addypin POC. |
| AF-2.16 | Pre-parsed body silently null-routes /login | On non-Express stacks, any body-reader middleware in front of `auth.login` consumes the stream; knowless sees empty body, falls through to sham. No diagnostic. Cost the addypin POC ~30min. |
| AF-2.17 | `transportOverride` accepts malformed config silently | A bare options bag passed where a transport is expected constructs successfully but throws "sendMail is not a function" at first submission — possibly hours after startup. |
| AF-2.18 | Secret used as ASCII bytes, not hex-decoded | `crypto.createHmac('sha256', secret)` was passed the 64-char hex string directly. Same 256-bit entropy, but a different HMAC output than systems that hex-decode first. Migration footgun: adopters with existing HMAC-keyed identifiers cannot interoperate. PRD already implied 32 bytes. Surfaced by addypin POC round 2. |
| AF-2.19 | No operator-controllable footer on auth mail | Adopters with brand/legal/feedback text in their non-auth mail want the same footer on the magic-link email for consistency. Today they'd need to inject a custom mailer and call `composeBody` themselves, defeating the encapsulation. Surfaced by addypin POC round 2. |
| AF-2.20 | Single factory subject for every magic-link mail | Any adopter that uses magic links for multiple intents (sign-in, action-confirmation, expiry warning, account-recovery) needs recognizable subjects per call. Today knowless sets one factory `subject` that applies uniformly — confirmation, login, and reminder mail are indistinguishable in the inbox. Surfaced by addypin POC round 3 (3 magic-link variants). |
| AF-2.21 | Trusted server-side callers can't opt out of IP rate-limit | Multi-process adopters (web + CLI / web + worker on the same host) hit the same per-IP bucket from `127.0.0.1`. Setting the cap to 0 at instance level forces config divergence between processes. Surfaced by addypin POC round 4 (Postfix-piped CLI). |
| AF-2.22 | `handleFromRequest` under-documented | The load-bearing primitive for adopter authorization is in the public API but absent from GUIDE's protected-endpoint examples. New adopters dig source. Surfaced by addypin POC round 4. |
| AF-2.23 | Multi-process adopter pattern undocumented | better-sqlite3 WAL handles cross-process correctness fine, but no docs explicitly say "multi-process is supported," when it's safe, and what each subsystem does under sharing. Surfaced by addypin POC round 4. |
| AF-2.24 | `auth.deriveHandle(email)` did not normalize | The instance method passed raw email to HMAC while `auth.startLogin` and `POST /login` normalize first. Adopters using `deriveHandle` to compute owner-keyed lookups got silent handle mismatches whenever email casing varied between create-time and click-time. Hard-to-debug "user's records disappear" failure mode. Surfaced by addypin manual smoke. |
| AF-2.25 | `failureRedirect` default cascades to a route Mode-A adopters don't serve | Default `failureRedirect = loginPath = /login`. Mode-A adopters who don't mount `loginForm` get expired/replayed magic-link clicks 302'd to a 404. Adopter-side fix is one-line config but the discovery cost is high. Surfaced by addypin manual smoke. |
| AF-2.26 | No documented dev-time mail inspection workflow | `devLogMagicLinks` covers the URL but not subject/body/footer rendering. New adopters wiring `bodyFooter` or `subjectOverride` re-derive the same MailHog-on-1025 trick. Surfaced by addypin manual smoke. |
| AF-2.27 | Default per-IP rate-limit caps cripple local dev | `maxLoginRequestsPerIpPerHour: 30` and `maxNewHandlesPerIpPerHour: 3` are tuned for prod but trip in minutes during local dev from `127.0.0.1`. The counters persist in SQLite across restarts, so the operator can't even reboot out of it. No GUIDE mention of the dev workaround. Surfaced by addypin manual smoke. |
| AF-2.28 | Silent-miss debug line undocumented as a feature | The `[knowless dev:<from>] silent-miss: ...` stderr hint introduced in AF-7.2 is excellent at surfacing the closed-reg-no-handle case but is buried in the changelog. Adopters hit closed-reg friction once and benefit forever; promoting it in the GUIDE turns 30-min debug sessions into 30-second ones. |
| AF-2.29 | `better-sqlite3` forces a C++20 toolchain on every install | The PRD §4.2 self-hoster audience disproportionately runs long-LTS distros (RHEL 8/9, Alma, Rocky, Amazon Linux 2) that ship gcc 8 / 11 by default. `npm install knowless` fails on stock images. The native compile gives marginal performance for knowless's workload while violating AGENT_RULES "vanilla > stdlib > external" — `node:sqlite` covers our surface area as of Node 22.5. Surfaced by addypin M11 deploy. |

### 17.3 Priority-ranked hardening backlog

**P0 — shipped in v0.1.0:**

- **AF-3.1:** Add HMAC-SHA256 known vector test for `deriveHandle` (closes AF-1.1). ✓
- **AF-3.2:** Add session signature known vector test pinning `sess\0` + HMAC-SHA256 (closes AF-1.2). ✓
- **AF-3.3:** Add session-expiry test in the `verify` handler path (closes AF-1.3). ✓
- **AF-3.4:** Add `\r\n` rejection guard in `composeRaw` (closes AF-2.1). ✓
- **AF-3.5:** Add concurrent token redemption test verifying exactly-one-wins (closes AF-1.4). ✓

**P1 — shipping in v0.1.1 (first-customer scope, webrevival forum):**

- **AF-4.0:** New ergonomic — `handleFromRequest(req)` programmatic API (closes AF-2.8). SPEC §9.4.
- **AF-4.1:** Concurrent token issuance test under cap contention (closes AF-1.5).
- **AF-4.2:** SMTP-failure response-uniformity test (closes AF-1.7).
- **AF-4.3:** CSRF Origin-header validation on `POST /login` (closes AF-2.2; resolves SPEC §15 Q-4). SPEC §7.3 Step 0.
- **AF-4.4:** `cookieSecure` config option (closes AF-2.3). SPEC §5.4. FR-30 revised.

**P2 — shipped in v0.1.2:**

- **AF-5.1:** Rate-limit window-boundary precision test (closes AF-1.6). ✓
- **AF-5.2:** Cookie parser hardening + boundary tests (closes AF-2.4). ✓
- **AF-5.3:** Sweeper-failure alerting hook (closes AF-2.6). ✓
- **AF-5.4:** Stored-handle integrity check (closes AF-2.5). ✓

**v0.1.4 — first-adopter feedback (addypin spike):**

Real-world integration findings from the addypin team's spike on
v0.1.3. Two were genuine bugs (AF-6.4, AF-6.5); the rest are
ergonomics that surfaced once a real client tried to integrate.

- **AF-6.1:** `auth.revokeSessions(handle)` (closes AF-2.9). ✓
- **AF-6.2:** `devLogMagicLinks` opt-in (closes AF-2.13). ✓
- **AF-6.3:** CIDR support in `trustedProxies` (closes AF-2.12). ✓
- **AF-6.4:** `POST /logout` Origin validation (closes AF-2.10). ✓
- **AF-6.5:** `confirmationMessage` HTML-escaped (closes AF-2.11). ✓
- **AF-6.6:** SPEC §7.3 Step 0 "no CSRF token upstream" guidance. ✓
- **AF-6.7:** GUIDE front-matter — v1.0.0 walks-away commitment. ✓

**v0.1.5 — addypin POC findings:**

addypin completed a node:http POC against v0.1.4 and surfaced a
mode-A blocker (no programmatic entry) plus four ergonomics. v0.1.5
closes them; addypin pins to it.

- **AF-7.1:** Empty-body warning when a body parser ate the stream
  (closes AF-2.16). ✓
- **AF-7.2:** GUIDE clarifies non-browser caller behavior on POST
  /login + dev-mode silent-miss hint when devLogMagicLinks is on. ✓
- **AF-7.3:** `auth.startLogin({email, nextUrl, sourceIp})` —
  programmatic entry for use-first-claim-later flows (closes
  AF-2.14). SPEC §7.3a. ✓
- **AF-7.4:** `auth.deriveHandle(email)` instance method (closes
  AF-2.15). ✓
- **AF-7.5:** `transportOverride` validated at startup (closes
  AF-2.17). ✓
- **AF-7.6:** `devLogMagicLinks` line tagged with `cfg.from` for
  multi-instance disambiguation. ✓
- **AF-7.7:** GUIDE "Constraints / install footprint" section. ✓

**v0.1.6 — addypin integration round 2:**

One correctness fix and one feature; both small, both adopter-driven.
Breaking change re: secret semantics, locked in before v1.0.

- **AF-8.1:** Hex-decode `secret` before HMAC (closes AF-2.18).
  Breaking: handle and session-signature outputs change. No prod
  users yet — done now to avoid carrying the bug into v1.0. ✓
- **AF-8.2:** `bodyFooter: string` config option for operator brand/
  legal text (closes AF-2.19). Strict validation: ASCII only, ≤240
  chars, ≤4 lines, no URLs. ✓

**v0.1.7 — addypin integration round 3:**

- **AF-9.1:** `subjectOverride` arg on `auth.startLogin` (closes
  AF-2.20). Validated by the same rules as the factory subject;
  applied identically to sham and real paths so subject can't leak
  hit/miss outcome. SPEC §7.3a. ✓

**v0.1.8 — addypin integration round 4 (low-priority polish):**

- **AF-10:** `bypassRateLimit: true` arg on `auth.startLogin` for
  trusted server-side callers (closes AF-2.21). Skips IP-based
  buckets entirely; per-handle token cap still enforced. ✓
- **AF-11:** GUIDE Step 6 promotes `auth.handleFromRequest` as the
  load-bearing primitive for protected-endpoint authorization
  (closes AF-2.22). ✓
- **AF-12:** OPS.md §11a documents the multi-process adopter
  pattern (closes AF-2.23). ✓

**v0.1.9 — addypin manual smoke (post-integration):**

- **AF-13:** `auth.deriveHandle(email)` instance method now
  normalizes the email before HMAC (closes AF-2.24). Bare
  `deriveHandle(emailNormalized, secret)` re-export keeps the
  pre-normalized contract. ✓
- **AF-14:** GUIDE flags the `failureRedirect` Mode-A footgun
  prominently (closes AF-2.25). Default unchanged to avoid
  breaking Mode-B users with custom paths. ✓
- **AF-15:** OPS.md §11b covers MailHog dev workflow for
  inspecting subject/body/footer (closes AF-2.26). ✓

**v0.1.10 — addypin manual smoke continued:**

Both pure docs.

- **AF-16:** GUIDE adds a "Local development setup" section with
  copy-pasteable dev config and explanation of why each flag
  matters (closes AF-2.27). Considered auto-coupling rate-limit-
  off to `devLogMagicLinks` but rejected — production-debug
  scenarios shouldn't silently drop other defenses. ✓
- **AF-17:** Silent-miss debug line promoted in the dev section
  as the "30-second-instead-of-30-minute closed-reg debugger"
  (closes AF-2.28). ✓

**v0.2.0 — no native compile:**

Headline release. Drops `better-sqlite3` for `node:sqlite` (stdlib).
Removes the C++20 toolchain requirement that blocked addypin's M11
deploy on RHEL 8 and would have blocked every future self-hoster on
long-LTS distros.

- **AF-18:** Migrate storage to `node:sqlite` (closes AF-2.29).
  Bumps Node floor 20 → 22.5+. One production dep (`nodemailer`).
  ~40 transitive packages → ~2. No native compile, no gcc, no
  make, no Python during install. Public API byte-for-byte
  identical; all 192 tests pass on first run after the swap. ✓

**v0.2.1 — operator visibility (forum + addypin negotiation):**

Joint output of the addypin M11 retro and the forum-integration
spec design pass (2026-04-29). The starting list was nine items;
five shipped after a multi-round negotiation against the
walk-away-at-v1.0.0 lens. Four moved to adopter or perimeter code.
Two design tests were established as durable: identity-layer vs
behavior-layer (knowless owns *who*, adopter owns *what they did*),
and mechanism-lives-with-policy (if curation lives in adopter, the
mechanism does too). Documented in knowless.context.md §
"What's NOT in knowless, and why" so future contributors see the
worked reasoning, not just the conclusions.

- **AF-19:** Three event hooks for operator visibility:
  `onMailerSubmit({messageId, handle, timestamp})` per-event for
  real (non-sham) submits; `onTransportFailure({error, timestamp})`
  per-event for SMTP errors; `onSuppressionWindow({sham, rateLimited,
  windowMs})` heartbeat aggregate (default 60s) covering all
  silent-202 branches. Sham deliberately does NOT fire per-event —
  load-bearing NFR-10 invariant against per-handle log leakage.
  Replaces a four-hook design that would have shipped `onShamHit`
  + `onRateLimitHit` per-event; the symmetry would have invited a
  future contributor to add the per-handle variant for the
  identity-tied `maxActiveTokensPerHandle` cap. ✓
- **AF-20:** `auth.verifyTransport()` opt-in SMTP probe. Resolves
  `Promise<true>` on non-rejection, rejects on failure. ✓
- **AF-21:** No auto-on-boot transport probe. Considered and
  rejected — k8s readiness probes / docker-compose ordering would
  fail boot for the wrong reason. Adopters who want fail-fast call
  `verifyTransport()` explicitly. ✓
- **AF-22:** `startLogin` silent-202 semantics documented (gotcha
  #19). Returns `{handle, submitted: true}` for every branch by
  design (FR-6); operator visibility lives in AF-19's hooks, never
  in the per-call return shape. ✓

**v0.2.2 — last feature add before walk-away (2026-04-29):**

addypin returned with one more genuine gap that closed cleanly under
the lens: `auth.startLogin` accepted `subjectOverride` per call
(AF-9) but the body was hardcoded to the "Click to sign in" template.
With three distinct Mode-A flows (pin confirmation, login, expiry
warning), subject and body disagreed in the user's inbox. The body
has to be composed after token mint (URL contains the token), so the
adopter can't sidestep knowless without re-implementing most of it.

- **AF-26:** Per-call `bodyOverride: ({url}) => string` template fn
  on `auth.startLogin`. knowless still composes the URL (preserves
  the v0.11 POC 7bit URL-line invariant) and validates the rendered
  output (ASCII, URL exactly once on its own line, ≤2048 chars, no
  CR). `bodyFooter` continues to append; `lastLogin` line does NOT
  auto-append on overrides — the template owns content. ✓

This passes the lens cleanly: identity-layer concern (magic-link
delivery payload), and the mechanism (URL composition + sham-work
timing + 7bit invariants) cannot live with the adopter without
forking. Contrast with the AF-23/24/25 cuts: each of those failed
the "could the adopter do this themselves?" test, and so were
relocated to adopter / perimeter / operator code. AF-26 fails that
same test in the *library's* favor — knowless has to own this.

**v1.0.0 — walk-away tag (2026-04-29):**

Promotion release. No new API surface vs v0.2.3 — v1.0.0 marks the
library as feature-complete and walk-away (PRD §6.3) as active.

addypin validated the full v0.2.x cycle end-to-end before the cut:
v0.2.2's `bodyOverride` wired into pin-confirmation + login +
resend@ flows; v0.2.3's `fromName` wired into both factories (web +
inbound CLI). Pin R61E3P confirmed: inbox preview shows "addypin"
as sender, body matches subject, footer reads complete. Surface
validated by use, not by spec. addypin's signal: "no more validation
we can do that v1.0.1 wouldn't also catch."

12/12 PRD §6.1 graduation criteria met. Walk-away discipline through
the v0.1.x → v0.2.x cycle absorbed all four legitimate identity-
layer gaps adopters surfaced (AF-19/20/21 observability, AF-26 body,
AF-27 fromName) and rejected three speculative additions
(AF-23/24/25). v1.x is patch-only by design.

**v0.2.3 — From: display name + bodyOverride docs (2026-04-29):**

addypin's first live send with the new bodyOverride template
surfaced two issues. One was an em-dash trap (ASCII validator
threw — fix was one commit on their side; knowless side was a JSDoc
clarification). The other was a real conflation gap: knowless used
the same string for both the RFC 5321 envelope sender (bare address
required) and the RFC 5322 From: header (display name allowed),
preventing adopters from rendering "addypin <noreply@addypin.com>"
without forking the mailer.

- **AF-27:** Optional `fromName` factory option. When set, the
  From: header becomes `${fromName} <${from}>`; envelope.from stays
  bare always. New `validateFromName()` validator: ASCII, ≤60 chars,
  no CR/LF, no `<>"`. Re-exported alongside the other validate*
  helpers. Cosmetic in the user's inbox (most clients show local-
  part as sender name when display name is absent), but identity-
  layer because the From: header is part of what knowless emits over
  SMTP. ✓
- **AF-26 docs nit:** JSDoc on `validateBodyOverride` extended with
  a typographic-punctuation paragraph (em/en dashes, smart quotes,
  ellipses, middle dots — and their ASCII alternatives). Same trap
  surface applies to the `fromName` validator. Pure documentation;
  no API change. ✓

addypin briefly proposed shipping AF-27 as v1.1.0 (additive,
non-breaking after walk-away). That was rejected — additive v1.x
feature releases would empty the walk-away promise. The right
pattern is the AF-26 precedent: ship as v0.2.x, freeze at v1.0.0.

**v0.2.1 post-release scope cull (walk-away stress-test, 2026-04-29):**

After v0.2.1 shipped, the v0.2.x Unreleased backlog was stress-tested
against the same walk-away discipline that produced AF-19 through
AF-22. All three items failed and were cut from tracking. Recorded
here so future contributors don't re-propose them.

- **AF-23: Caddy forward-auth Docker integration test (TASKS 6.8) —
  CUT.** addypin runs knowless behind Caddy in production; that is
  the integration test, with adopter signal stronger than any
  docker-compose CI. Removed from PRD §6.1 graduation criteria.
- **AF-24: `knowless-server --check-null-route` CLI probe — CUT.**
  Operator-side MTA setup-correctness check, not identity layer.
  Same probe is achievable in three lines of `swaks` + `tail
  /var/log/maillog`; documented in GUIDE.md Step 3 instead of
  shipped as a CLI feature.
- **AF-25: Turnkey Docker image (`knowless/knowless-server:0.2.x`) —
  CUT.** Doesn't solve the actual operator problem (DNS / port-25
  work still required), saves only ~5 minutes of `apt install`. Cost
  side is permanent: Postfix CVE cadence would commit a walk-away
  library to forever-rebuilds. If a community Dockerfile emerges,
  OPS.md will link to it; knowless does not ship one.

**Rejected during AF-19/20 design (kept here for the record):**

- **Disposable-domain blocking** — adopter form-handler concern.
  The blocklist is a public GitHub repo; timing-equivalence on
  rejection protects information that isn't secret. Putting the
  *mechanism* in knowless while the *list curation* and *override*
  live in the adopter is the wrong seam.
- **Account-age accessor / `getHandleAgeBucket()`** — adopter
  first-seen tracking concern. Knowless's "handle creation date"
  is when this email first hit knowless; the adopter's interesting
  question is "how long has this user been participating in *my
  app*." A six-month-old knowless handle that has never posted
  has zero application tenure. Returning a `Date | null` keyed by
  handle would also be an enumeration oracle.
- **Per-IP hashcash / proof-of-work in the login form** — Caddy /
  perimeter-layer concern. `maxNewHandlesPerIpPerHour: 3` already
  covers the threat model; adding hashcash would break Lynx/w3m
  (gotcha #10), require JS in the login form (the only zero-JS
  exception we'd carry), and impose a 2s UX delay. Off-the-shelf
  hashcash modules at the perimeter cover the rare case where the
  built-in cap saturates.
- **`auth.lookupMessageId(messageId)` behind operator secret** —
  achievable by adopter via `onMailerSubmit` payload + their own
  `(messageId → handle)` map. Knowless never stores the mapping,
  never carries operator-secret rotation burden.

**Post-v1.0.0 bug fixes (maintenance window):**

Found during a post-release code review (2026-05-01). All are v1.x
eligible per PRD §6.3 (bug fixes that don't change the API surface).

- **AF-28:** XFF/X-Real-IP never honored through handler path. Root
  cause: `createHandlers` pre-built `trustedProxies` into a `{ has }`
  object, then passed it to `determineSourceIp`, which re-called
  `buildTrustedPeers` internally. The pre-built object isn't recognized
  as a `BlockList`, array, or `Set` — peer list fell through to `[]`,
  making trusted-proxy matching silently empty. Abuse unit tests passed
  because they call `determineSourceIp` directly with raw arrays. Fix:
  removed the pre-build; `createHandlers` passes `cfg.trustedProxies`
  directly to `determineSourceIp`. ✓

- **AF-29:** `validateSubject` allowed CR/LF, enabling header injection
  through the public re-export. ASCII regex `/^[\x00-\x7f]*$/` matched
  0x0D and 0x0A. `composeRaw` caught it downstream, but the validator
  is the authoritative public boundary (re-exported since v0.1.7 /
  AF-9.1). Fix: added explicit `/[\r\n]/` check, consistent with
  `validateFromName` and `validateBodyOverride`. ✓

- **AF-30:** Factory `subject` not validated at startup, breaking the
  fail-fast contract that `bodyFooter` and `fromName` already follow.
  A non-ASCII or empty operator subject would silently pass config time
  and fail at first `mailer.submit()`. Fix: `validateSubject(cfg.subject)`
  added to the config-validation block in `createHandlers`. ✓

- **AF-31:** `validateBodyFooter` rejected 4-line footers with a
  trailing newline. `split('\n').length > 4` counted 5 parts for
  `"a\nb\nc\nd\n"` (4 logical lines + trailing LF). Fix: strip a
  single trailing newline before counting. ✓

- **AF-32:** `runSendLink` JSDoc misstated that `handle` is null only
  on malformed email. The per-IP rate-limit early-return path also
  returns `handle: null` (before `deriveHandle` runs). Documentation
  only; no behavior change. ✓

### 17.4 Note on FR-6 timing test (AF-1.8)

The FR-6 test is a *regression detector*, not a *property
prover*. A pathological implementation (e.g.,
`await sleep(100ms)` on every path) would pass the 1ms Δ_mean
bar trivially. The proof that knowless's sham-work pattern
actually achieves timing equivalence comes from:

1. Code review (the production code does not sleep).
2. The architectural property that hit and miss paths
   execute the same operations in the same order.
3. The measured Δ_mean ≈ 0.002ms, far below what synthetic
   delay would produce.

Hardening here is mostly architectural discipline, not
test additions. Future contributors MUST not introduce
artificial sleeps to "make timing pass" — that defeats the
property. The PRD records this norm; tests cannot enforce it.

## 18. Approval and sign-off

This PRD reflects the consensus reached during the design
conversation between the user (hamr0) and Claude. Items were
explicitly debated and either added to scope or moved to non-goals
with documented reasoning.

**Confirmed scope as of v0.14 of this PRD:**

- Full opinionated library (not primitives kit) ✓
- Six-line operator integration in library mode ✓
- Standalone server mode via `npx knowless-server` ✓
- Forward-auth support for reverse proxies ✓
- Built-in session management ✓
- Hardcoded login HTML form with explicit confirmation message ✓
- Plain HTML pages (no JS, no external resources) ✓
- Plain-text email only, deliverability-friendly headers ✓
- Localhost Postfix as only mail transport ✓
- Silent-on-miss with timing test (silent in shape and timing,
  *not* in user-facing feedback — user always sees confirmation) ✓
- Magic-link lifecycle: 256-bit entropy, 15-minute TTL,
  single-use, hashed at rest, swept on expiry ✓
- Session lifecycle: 30-day TTL, signed cookies, server-enforced
  expiry, logout endpoint ✓
- Last-login compromise hint: timestamp-only, appended to magic-
  link emails by default, no location/IP/UA tracking ✓
- Built-in cheap abuse protection (per-email, per-IP,
  honeypot) with safe defaults, adjustable, all silent on
  rejection ✓
- Configuration via env vars only; CLI flags limited to
  inspection/validation; secrets never on CLI; `.env` via
  Node's built-in `--env-file=` ✓
- Two production deps (`nodemailer`, `better-sqlite3`) ✓
- Audit-friendly source size; no LOC mandate ✓
- Forward-auth return URL via signed `?next=` param ✓
- Account deletion via store interface (GDPR) ✓
- Timing envelope narrowed to enumeration-vector contract;
  rate-limit / honeypot paths exempt ✓
- Sham-work pattern on silent-miss path mandated by FR-6;
  practical-effect-size bar (delta_mean < 1ms) replaces the
  unattainable statistical-significance framing ✓
- 7bit ASCII-only mail body; magic link URL on its own line;
  quoted-printable forbidden (FR-17) ✓
- POC under `poc/` validated round-trip, verify hot path
  (p99 0.07ms vs 10ms target), and the sham-work timing
  pattern ✓
- Walk-away after v1.0.0 ✓
- Audience: in-app services + self-hosters gating no-auth services ✓

**Explicitly out of scope:**

See §14 non-goals table. Items there have been individually
considered and rejected with reasons.

[gitdone]: https://github.com/hamr0/gitdone
[addypin]: https://github.com/hamr0/addypin
