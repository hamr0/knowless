---
title: Audit findings (v0.1 hardening backlog)
description: Every audit finding (AF-numbered) from PRD section 17, grouped by subsection, with one-line statements, status and source citations.
---

# Audit findings (v0.1 hardening backlog)

Full text is in the cited source lines; the original is archived byte-identical and the citations resolve there.

Findings came from the Phase 4-5 self-audit prompted by "did you really pass all tests or make them pass?". They are distinct from open questions (§13) and non-goals (§14): gaps between "the implementation passes tests" and "the tests verify the contract", plus some real defense-in-depth code gaps (docs/archive/PRD.md:2573-2579).

## 17.1 Test-quality findings

Several tests would pass against broken implementations because they check self-round-trips rather than known algorithmic output, the AGENT_RULES "tests that mirror implementation" anti-pattern (docs/archive/PRD.md:2583-2587).

- AF-1.1: `deriveHandle` determinism tests would pass with a broken HMAC (docs/archive/PRD.md:2591-2591).
- AF-1.2: Session signature round-trip/tamper tests would pass with SHA-1, a missing `sess\0` tag, or wrong bytes (docs/archive/PRD.md:2592-2592).
- AF-1.3: No test exercises `expiresAt <= now` rejection in the `verify` handler (docs/archive/PRD.md:2593-2593).
- AF-1.4: Replay protection tested serially; no test that exactly one of N parallel redemptions wins (docs/archive/PRD.md:2594-2594).
- AF-1.5: SPEC §4.7 BEGIN IMMEDIATE serialization for concurrent issuance under cap is not tested (docs/archive/PRD.md:2595-2595).
- AF-1.6: Rate-limit window rollover instant (off-by-one in `windowStart`) is untested (docs/archive/PRD.md:2596-2596).
- AF-1.7: NFR-10 SMTP-failure uniformity has no test comparing response bytes for mail success vs failure (docs/archive/PRD.md:2597-2597).
- AF-1.8: FR-6 timing test (1ms delta-mean bar) is gameable, e.g. by `await sleep(100ms)`; it catches regressions but does not prove the design (docs/archive/PRD.md:2598-2598).

## 17.2 Code-level defense-in-depth gaps

Tests cannot catch these because the production code itself lacks the defense (docs/archive/PRD.md:2602-2603). Table columns are Gap and Severity, but the rows give prose rather than a severity label.

- AF-2.1: `composeRaw` should reject CR/LF in `to` as defense in depth, since `normalize()` only rejects upstream (docs/archive/PRD.md:2607-2607).
- AF-2.2: No CSRF-equivalent on `POST /login`; noise, not session compromise; SPEC §15 Q-4 deferral, resolution is Origin validation (docs/archive/PRD.md:2608-2608).
- AF-2.3: Cookie `Secure` flag breaks HTTP localhost dev; needs a `cookieSecure` option, default `true` (docs/archive/PRD.md:2609-2609).
- AF-2.4: Naive cookie parser (`header.split(';')`) mishandles quoted values with embedded `;` (docs/archive/PRD.md:2610-2610).
- AF-2.5: `store.upsertHandle()` accepts any string; no stored-handle integrity check (docs/archive/PRD.md:2611-2611).
- AF-2.6: Repeated `sweepTokens` failure only logs to stderr; no alerting hook, tables grow silently (docs/archive/PRD.md:2612-2612).
- AF-2.7: `verify` accepts a valid cookie regardless of the request Host header; reverse proxies typically prevent this (docs/archive/PRD.md:2613-2613).
- AF-2.8: No programmatic `handleFromRequest(req)` API; surfaced by the first-customer (webrevival forum) scope review (docs/archive/PRD.md:2614-2614).
- AF-2.9: No `revokeSessions(handle)` API for "log out everywhere"; surfaced by the addypin spike (docs/archive/PRD.md:2615-2615).
- AF-2.10: `POST /logout` had no Origin/Referer check; SameSite=Lax does not cover same-eTLD+1 subdomains (docs/archive/PRD.md:2616-2616).
- AF-2.11: `confirmationMessage` rendered as raw HTML; reflected-XSS footgun if misused (docs/archive/PRD.md:2617-2617).
- AF-2.12: `trustedProxies` accepted only exact IPs; CIDR support needed (docs/archive/PRD.md:2618-2618).
- AF-2.13: No SMTP-down dev fallback to obtain the magic link locally (docs/archive/PRD.md:2619-2619).
- AF-2.14: No programmatic magic-link entry for "use first, claim later" flows without losing the FR-6 timing guarantee; addypin POC (docs/archive/PRD.md:2620-2620).
- AF-2.15: No `auth.deriveHandle` instance method; adopters import the helper and pass the secret manually (docs/archive/PRD.md:2621-2621).
- AF-2.16: A pre-parsed body silently null-routes `/login` on non-Express stacks, with no diagnostic (docs/archive/PRD.md:2622-2622).
- AF-2.17: `transportOverride` accepts malformed config silently and fails at first submission (docs/archive/PRD.md:2623-2623).
- AF-2.18: Secret used as ASCII bytes rather than hex-decoded for HMAC; migration/interoperability footgun (docs/archive/PRD.md:2624-2624).
- AF-2.19: No operator-controllable footer on auth mail (docs/archive/PRD.md:2625-2625).
- AF-2.20: One factory subject for every magic-link mail; per-call subjects needed (docs/archive/PRD.md:2626-2626).
- AF-2.21: Trusted server-side callers cannot opt out of the IP rate limit; multi-process adopters share the `127.0.0.1` bucket (docs/archive/PRD.md:2627-2627).
- AF-2.22: `handleFromRequest` is absent from GUIDE's protected-endpoint examples (docs/archive/PRD.md:2628-2628).
- AF-2.23: Multi-process adopter pattern (WAL-safe) is undocumented (docs/archive/PRD.md:2629-2629).
- AF-2.24: `auth.deriveHandle(email)` did not normalize, causing silent handle mismatches on email casing (docs/archive/PRD.md:2630-2630).
- AF-2.25: `failureRedirect` default cascades to `/login`, a route Mode-A adopters do not serve (docs/archive/PRD.md:2631-2631).
- AF-2.26: No documented dev-time mail inspection workflow beyond `devLogMagicLinks` (docs/archive/PRD.md:2632-2632).
- AF-2.27: Default per-IP caps (30 login requests/hour, 3 new handles/hour) cripple local dev, and counters persist in SQLite (docs/archive/PRD.md:2633-2633).
- AF-2.28: The `silent-miss` stderr debug line (from AF-7.2) is not documented as a feature in the GUIDE (docs/archive/PRD.md:2634-2634).
- AF-2.29: `better-sqlite3` forces a C++20 toolchain on every install, failing on long-LTS distros such as RHEL 8/9 (docs/archive/PRD.md:2635-2635).

## 17.3 Priority-ranked hardening backlog

### P0, shipped in v0.1.0 (docs/archive/PRD.md:2639-2645)

- AF-3.1: HMAC-SHA256 known-vector test for `deriveHandle`; closes AF-1.1; done (docs/archive/PRD.md:2641-2641).
- AF-3.2: Session signature known-vector test pinning `sess\0` + HMAC-SHA256; closes AF-1.2; done (docs/archive/PRD.md:2642-2642).
- AF-3.3: Session-expiry test in the `verify` path; closes AF-1.3; done (docs/archive/PRD.md:2643-2643).
- AF-3.4: CR/LF rejection guard in `composeRaw`; closes AF-2.1; done (docs/archive/PRD.md:2644-2644).
- AF-3.5: Concurrent redemption exactly-one-wins test; closes AF-1.4; done (docs/archive/PRD.md:2645-2645).

### P1, shipping in v0.1.1 (first-customer scope, webrevival forum) (docs/archive/PRD.md:2647-2653)

- AF-4.0: `handleFromRequest(req)` programmatic API; closes AF-2.8; SPEC §9.4 (docs/archive/PRD.md:2649-2649).
- AF-4.1: Concurrent issuance test under cap contention; closes AF-1.5 (docs/archive/PRD.md:2650-2650).
- AF-4.2: SMTP-failure response-uniformity test; closes AF-1.7 (docs/archive/PRD.md:2651-2651).
- AF-4.3: Origin-header CSRF validation on `POST /login`; closes AF-2.2, resolves SPEC §15 Q-4; SPEC §7.3 Step 0 (docs/archive/PRD.md:2652-2652).
- AF-4.4: `cookieSecure` config option; closes AF-2.3; SPEC §5.4, FR-30 revised (docs/archive/PRD.md:2653-2653).

### P2, shipped in v0.1.2 (docs/archive/PRD.md:2655-2660)

- AF-5.1: Rate-limit window-boundary precision test; closes AF-1.6; done (docs/archive/PRD.md:2657-2657).
- AF-5.2: Cookie parser hardening plus boundary tests; closes AF-2.4; done (docs/archive/PRD.md:2658-2658).
- AF-5.3: Sweeper-failure alerting hook; closes AF-2.6; done (docs/archive/PRD.md:2659-2659).
- AF-5.4: Stored-handle integrity check; closes AF-2.5; done (docs/archive/PRD.md:2660-2660).

### v0.1.4, first-adopter feedback (addypin spike)

AF-6.4 and AF-6.5 were genuine bugs; the rest were ergonomics (docs/archive/PRD.md:2662-2666).

- AF-6.1: `auth.revokeSessions(handle)`; closes AF-2.9; done (docs/archive/PRD.md:2668-2668).
- AF-6.2: `devLogMagicLinks` opt-in; closes AF-2.13; done (docs/archive/PRD.md:2669-2669).
- AF-6.3: CIDR support in `trustedProxies`; closes AF-2.12; done (docs/archive/PRD.md:2670-2670).
- AF-6.4: `POST /logout` Origin validation; closes AF-2.10; done (docs/archive/PRD.md:2671-2671).
- AF-6.5: `confirmationMessage` HTML-escaped; closes AF-2.11; done (docs/archive/PRD.md:2672-2672).
- AF-6.6: SPEC §7.3 Step 0 "no CSRF token upstream" guidance; done (docs/archive/PRD.md:2673-2673).
- AF-6.7: GUIDE front-matter stating the v1.0.0 walks-away commitment; done (docs/archive/PRD.md:2674-2674).

### v0.1.5, addypin POC findings

One mode-A blocker (no programmatic entry) plus four ergonomics; addypin pins to this release (docs/archive/PRD.md:2676-2680).

- AF-7.1: Empty-body warning when a body parser ate the stream; closes AF-2.16; done (docs/archive/PRD.md:2682-2683).
- AF-7.2: GUIDE clarifies non-browser caller behavior on `POST /login`, plus dev-mode silent-miss hint with `devLogMagicLinks`; done (docs/archive/PRD.md:2684-2685).
- AF-7.3: `auth.startLogin({email, nextUrl, sourceIp})` programmatic entry; closes AF-2.14; SPEC §7.3a; done (docs/archive/PRD.md:2686-2688).
- AF-7.4: `auth.deriveHandle(email)` instance method; closes AF-2.15; done (docs/archive/PRD.md:2689-2690).
- AF-7.5: `transportOverride` validated at startup; closes AF-2.17; done (docs/archive/PRD.md:2691-2692).
- AF-7.6: `devLogMagicLinks` line tagged with `cfg.from` for multi-instance disambiguation; done (docs/archive/PRD.md:2693-2694).
- AF-7.7: GUIDE "Constraints / install footprint" section; done (docs/archive/PRD.md:2695-2695).

### v0.1.6, addypin integration round 2

One correctness fix and one feature, with a breaking secret-semantics change locked in before v1.0 (docs/archive/PRD.md:2697-2700).

- AF-8.1: Hex-decode `secret` before HMAC; closes AF-2.18; breaking (handle and session-signature outputs change), no prod users yet; done (docs/archive/PRD.md:2702-2704).
- AF-8.2: `bodyFooter: string` option; closes AF-2.19; ASCII only, at most 240 chars, at most 4 lines, no URLs; done (docs/archive/PRD.md:2705-2707).

### v0.1.7, addypin integration round 3

- AF-9.1: `subjectOverride` arg on `auth.startLogin`; closes AF-2.20; same validation as the factory subject, applied identically to sham and real paths so it cannot leak hit/miss; SPEC §7.3a; done (docs/archive/PRD.md:2711-2714).

### v0.1.8, addypin integration round 4 (low-priority polish)

- AF-10: `bypassRateLimit: true` on `auth.startLogin` for trusted callers; closes AF-2.21; skips IP buckets, per-handle token cap still enforced; done (docs/archive/PRD.md:2718-2720).
- AF-11: GUIDE Step 6 promotes `auth.handleFromRequest` for protected-endpoint authorization; closes AF-2.22; done (docs/archive/PRD.md:2721-2723).
- AF-12: OPS.md §11a documents the multi-process adopter pattern; closes AF-2.23; done (docs/archive/PRD.md:2724-2725).

### v0.1.9, addypin manual smoke

- AF-13: `auth.deriveHandle(email)` now normalizes before HMAC; closes AF-2.24; bare `deriveHandle(emailNormalized, secret)` keeps the pre-normalized contract; done (docs/archive/PRD.md:2729-2732).
- AF-14: GUIDE flags the `failureRedirect` Mode-A footgun; closes AF-2.25; default unchanged to avoid breaking Mode-B users; done (docs/archive/PRD.md:2733-2735).
- AF-15: OPS.md §11b covers the MailHog dev workflow; closes AF-2.26; done (docs/archive/PRD.md:2736-2737).

### v0.1.10, addypin manual smoke continued (pure docs)

- AF-16: GUIDE "Local development setup" section; closes AF-2.27; auto-coupling rate-limit-off to `devLogMagicLinks` was considered and rejected; done (docs/archive/PRD.md:2743-2747).
- AF-17: Silent-miss debug line promoted in the dev section; closes AF-2.28; done (docs/archive/PRD.md:2748-2750).

### v0.2.0, no native compile

- AF-18: Migrate storage to `node:sqlite`; closes AF-2.29; Node floor 20 to 22.5+; one production dep (`nodemailer`); public API identical, all 192 tests pass; done (docs/archive/PRD.md:2752-2763).

### v0.2.1, operator visibility (forum + addypin negotiation)

Nine candidate items were negotiated down: five shipped and four moved to adopter or perimeter code. Two durable design tests were set: identity-layer vs behavior-layer, and mechanism-lives-with-policy (docs/archive/PRD.md:2765-2776).

- AF-19: Three event hooks: `onMailerSubmit`, `onTransportFailure`, and the `onSuppressionWindow` heartbeat aggregate. Sham deliberately does not fire per-event (NFR-10 invariant); done (docs/archive/PRD.md:2778-2788).
- AF-20: `auth.verifyTransport()` opt-in SMTP probe; done (docs/archive/PRD.md:2789-2790).
- AF-21: No auto-on-boot transport probe; considered and rejected (k8s/compose ordering); done (docs/archive/PRD.md:2791-2794).
- AF-22: `startLogin` silent-202 semantics documented (gotcha #19); returns `{handle, submitted: true}` on every branch (FR-6); done (docs/archive/PRD.md:2795-2798).

### v0.2.2, last feature add before walk-away (2026-04-29)

- AF-26 (extends the AF-9 `subjectOverride`): Per-call `bodyOverride: ({url}) => string` on `auth.startLogin`; knowless composes the URL and validates output (ASCII, URL once on its own line, at most 2048 chars, no CR); `lastLogin` line is not auto-appended; passes the lens because the mechanism cannot live with the adopter; done (docs/archive/PRD.md:2802-2823).

### v1.0.0, walk-away tag (2026-04-29)

Promotion release with no new API surface versus v0.2.3. 12/12 PRD §6.1 graduation criteria met; walk-away discipline absorbed four legitimate gaps (AF-19/20/21, AF-26, AF-27) and rejected three speculative additions (AF-23/24/25); v1.x is patch-only by design (docs/archive/PRD.md:2827-2842).

### v0.2.3, From: display name and bodyOverride docs (2026-04-29)

- AF-27: Optional `fromName` factory option; From: header becomes `${fromName} <${from}>` while envelope.from stays bare; new `validateFromName()` (ASCII, at most 60 chars, no CR/LF, no `<>"`); done (docs/archive/PRD.md:2855-2862).
- AF-26 docs nit: JSDoc on `validateBodyOverride` gains a typographic-punctuation paragraph; docs only; done (docs/archive/PRD.md:2863-2867).
- Shipping AF-27 as v1.1.0 was proposed by addypin and rejected; the precedent is to ship as v0.2.x and freeze at v1.0.0 (docs/archive/PRD.md:2869-2872).

### v0.2.1 post-release scope cull (walk-away stress-test, 2026-04-29)

Three items failed the walk-away discipline and were cut from tracking (docs/archive/PRD.md:2874-2879).

- AF-23: Caddy forward-auth Docker integration test (TASKS 6.8); CUT; addypin production use is the integration test (docs/archive/PRD.md:2881-2884).
- AF-24: `knowless-server --check-null-route` CLI probe; CUT; operator-side MTA check, documented in GUIDE.md Step 3 (docs/archive/PRD.md:2885-2889).
- AF-25: Turnkey Docker image; CUT; Postfix CVE cadence would commit the library to forever-rebuilds (docs/archive/PRD.md:2890-2895).

Also rejected during AF-19/20 design: disposable-domain blocking, account-age accessor / `getHandleAgeBucket()`, per-IP hashcash / proof-of-work, and `auth.lookupMessageId(messageId)` (docs/archive/PRD.md:2897-2921).

### Post-v1.0.0 bug fixes (maintenance window)

Found in a post-release code review (2026-05-01); all are v1.x eligible per PRD §6.3 (docs/archive/PRD.md:2923-2926).

- AF-28: XFF/X-Real-IP never honored via the handler path; `createHandlers` pre-built `trustedProxies` into a `{ has }` object that `determineSourceIp` did not recognize; fixed by passing `cfg.trustedProxies` directly; done (docs/archive/PRD.md:2928-2936).
- AF-29: `validateSubject` allowed CR/LF through the public re-export; fixed with an explicit `/[\r\n]/` check; done (docs/archive/PRD.md:2938-2943).
- AF-30: Factory `subject` not validated at startup; fixed by `validateSubject(cfg.subject)` in `createHandlers` config validation; done (docs/archive/PRD.md:2945-2949).
- AF-31: `validateBodyFooter` rejected 4-line footers with a trailing newline; fixed by stripping one trailing newline before counting; done (docs/archive/PRD.md:2951-2954).
- AF-32: `runSendLink` JSDoc misstated when `handle` is null (per-IP rate-limit early return also yields null); docs only; done (docs/archive/PRD.md:2956-2959).
- AF-33: `determineSourceIp` was unreachable for `startLogin` callers and the GUIDE Mode A example used the proxy address, globalizing per-IP caps (surfaced by plato); fixed by a doc correction plus making `determineSourceIp` a public export; done (docs/archive/PRD.md:2961-2975).
  - Follow-up: the resolver trusts the leftmost `X-Forwarded-For`, so the proxy must overwrite it with the real peer; appending or omitting the header is unsafe; proven against real nginx; doc-only; done (docs/archive/PRD.md:2976-2991).

## 17.4 Note on FR-6 timing test (AF-1.8)

- The FR-6 test is a regression detector, not a property prover; a `sleep(100ms)` implementation would pass the 1ms bar (docs/archive/PRD.md:2995-2998).
- The proof of timing equivalence is code review (no sleeps), identical operations in identical order on hit and miss paths, and measured delta-mean of about 0.002ms (docs/archive/PRD.md:2998-3005).
- Contributors must not add artificial sleeps to make timing pass; the PRD records this norm and tests cannot enforce it (docs/archive/PRD.md:3007-3010).
