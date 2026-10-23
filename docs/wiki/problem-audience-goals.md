---
title: Problem, audience, goals, user stories and success criteria
description: The problem knowless solves, who it serves, its goals, user stories, and success criteria, condensed from PRD sections 2-6.
---

# Problem, audience, goals

The full text is in the cited source lines of docs/archive/PRD.md (the original is archived byte-identical, and citations resolve there).

## 2. Problem statement

- **2.1 Most services have no business emailing users.** Most services email users mainly for retention marketing dressed up as "notifications", and SES/Postmark/Mailgun make adding email channels free once one exists (docs/archive/PRD.md:266-271). A service that wants not to email users beyond auth must resist the path of least resistance, and no library supports that by default (docs/archive/PRD.md:273-276). This is the primary problem; the rest follows from it (docs/archive/PRD.md:278-279).
- **2.2 Auth tooling normalises identity collection.** Auth0, Clerk, Magic and Firebase Auth default to maximum identity collection, including plaintext email, profile fields, recovery email and federation (docs/archive/PRD.md:283-287). Smaller alternatives do not exist as a complete package, so privacy-minded developers roll their own or accept big-provider tracking (docs/archive/PRD.md:289-291).
- **2.3 The auth industry oversells the difficulty.** For a small service, a magic link with a session cookie is sufficient; most threats (credential stuffing, phishing, password reuse) are solved by dropping passwords or are orthogonal to library choice (docs/archive/PRD.md:295-301). Federation, SSO and high-assurance needs are a different audience (docs/archive/PRD.md:301-303). knowless is a bet that the simple version, done with discipline, is enough (docs/archive/PRD.md:305-306).
- **2.4 Auth libraries leak identities by default.** Most magic-link implementations distinguish registered from unregistered addresses by status code, body or timing, which is real but secondary (docs/archive/PRD.md:310-314). knowless defaults to silent-on-miss because it costs almost nothing, not because it is the reason for existing (docs/archive/PRD.md:316-318).
- **2.5 Self-hosted is uphill.** Operators who want no mail, auth or analytics vendor face poorly documented, scattered setup; the boring answer (Postfix on localhost, simple SMTP submission, own auth) is rarely packaged (docs/archive/PRD.md:322-326).
- **2.6 In-app value delivery is underserved.** Many services deliver value in the app and need no out-of-band contact, yet no mainstream auth library treats this as a first-class deployment shape (docs/archive/PRD.md:330-334).
- **2.7 Self-hosters can't gate apps without auth.** Services such as Uptime Kuma, AdGuard Home, Pi-hole, Sonarr, n8n and others have no or weak auth, and Authelia, Authentik, Keycloak and oauth2-proxy are heavy and assume an external IdP or multi-component deployment (docs/archive/PRD.md:338-344). A simple single-binary forward-auth service with magic-link auth did not exist as an idiomatic option; knowless is that option (docs/archive/PRD.md:346-348).

## 3. Goals

### 3.1 Primary goals

- Ship a working passwordless flow integrable in under 10 minutes and 6 lines of code (library mode) or with a single command (standalone server mode) (docs/archive/PRD.md:354-356).
- Default to silent-on-miss with timing equivalence, verified by an automated test (docs/archive/PRD.md:357-358).
- Never store plaintext email anywhere in the library's data flow (docs/archive/PRD.md:359-360).
- Send the magic link via localhost Postfix as the only outbound mail channel, by design (docs/archive/PRD.md:361-362).
- Stay small enough to audit in an afternoon with at most two production dependencies; LOC is not a mandate, lightness is (docs/archive/PRD.md:363-364).
- Document the operational commitments (Postfix setup, deliverability, reverse proxy configuration) honestly upfront (docs/archive/PRD.md:365-366).

### 3.2 Secondary goals

- Cross-link with gitdone and addypin as the extracted auth primitive both benefit from (docs/archive/PRD.md:370-371).
- Establish a refusal-driven design pattern for future libraries in the same lineage (docs/archive/PRD.md:372-373).
- Produce a spec (`SPEC.md`) detailed enough for compatible reimplementations in other languages (docs/archive/PRD.md:374-375).
- Become the obvious answer for self-hosters gating no-auth services with a privacy-respecting login layer (docs/archive/PRD.md:376-377).

## 4. Target audience

- **4.1 Primary: in-app services where auth is the only legitimate email need.** Any service whose model is "log in, use the app, leave" (docs/archive/PRD.md:383-384): web apps and SaaS dashboards, indie tools, small-business B2B internal tools, member areas and forums, self-hosted apps, hermit utilities like addypin, and niche productivity tools (docs/archive/PRD.md:386-396). The app delivers the value, not email; email is only the door opener (docs/archive/PRD.md:398-402).
- **4.2 Primary: self-hosters gating services without good auth.** Standalone server mode serves self-hosters running services lacking acceptable native auth: monitoring, network admin, media, internal tools, dev tools, document management and one-off internal apps (docs/archive/PRD.md:406-419). The shape is reverse proxy plus forward-auth (Caddy/nginx/Traefik pointing at knowless) (docs/archive/PRD.md:421-424). It targets the niche held by heavyweight Authelia, Authentik, oauth2-proxy and Keycloak as the simple single-binary answer (docs/archive/PRD.md:426-428).
- **4.3 Secondary: privacy-skeptical developers building for clients.** Developers serving small businesses, non-profits or privacy-conscious clients where privacy is part of the sale, especially EU, healthcare-adjacent, legal and education (docs/archive/PRD.md:432-435).
- **4.4 Explicitly NOT for.** The disqualifier is email needs, not service type (docs/archive/PRD.md:439-441). Wrong for: order confirmations/shipping/receipts, subscription or billing notices, newsletter platforms, calendar invites/reminders, anything users opt into by email, and anything where deliverability problems would be catastrophic (docs/archive/PRD.md:443-450). Also not for teams without VPS ops capability, apps needing OAuth/SSO/federation/SAML, or apps wanting integrated 2FA/WebAuthn/TOTP (docs/archive/PRD.md:452-458). The honesty about who it isn't for is what makes it useful for who it is (docs/archive/PRD.md:460-461).
- **4.5 The questioning the audience needs to do.** Most operators email because infrastructure makes it free, not because users need it; the library is for operators who ask whether they need to email users beyond the sign-in link and accept the answer is usually no (docs/archive/PRD.md:465-470). If the answer is genuinely yes, they are not the audience (docs/archive/PRD.md:472-473).

## 5. User stories

- **5.1 The indie developer (library mode).** Wants passwordless login for ~200 occasional users, sending nothing but the sign-in link, installed in five minutes in an Express app (docs/archive/PRD.md:479-483). knowless provides a six-field config object and two HTTP handlers mounted on existing routing (docs/archive/PRD.md:485-487).
- **5.2 The privacy-skeptical user.** Asks why a small app stores plaintext email and sends welcome and digest mail (docs/archive/PRD.md:491-493). knowless makes both architecturally hard: email is never stored in plaintext and the only outbound mail is the magic link, so a "welcome email" requires installing something else (docs/archive/PRD.md:495-500).
- **5.3 The auditing client.** Needs to know what data is stored (docs/archive/PRD.md:504-505). The answer: an opaque hash derived with the deployment secret, no email stored, one email type (the requested sign-in link), and no tracking, analysis or sharing (docs/archive/PRD.md:507-511).
- **5.4 The compliance-burdened operator.** An EU operator uneasy about GDPR asks whether the email can simply not be stored (docs/archive/PRD.md:515-517). knowless says yes: the handle is a one-way derivation that, without the deployment secret, cannot be reversed, so data minimisation becomes cleaner (docs/archive/PRD.md:519-522).
- **5.5 The internal-tools operator.** A 25-person company wants an ops dashboard with email magic-link login and no provisioning, password resets or SSO bills (docs/archive/PRD.md:526-529). knowless is the entire auth layer: the operator seeds team emails as known handles, sessions last as configured, with no vendor or per-seat fee (docs/archive/PRD.md:531-534).
- **5.6 The self-hoster gating Kuma (standalone server mode).** Runs Uptime Kuma behind an SSH tunnel and wants a proper login layer without installing Authelia and five components (docs/archive/PRD.md:538-543). The operator installs `knowless-server`, points Caddy at it for forward-auth, and gets 30 days of access after a first magic link; the same pattern extends to AdGuard, Pi-hole and others with one Caddy block each, with single sign-on via a parent-domain-scoped session cookie (docs/archive/PRD.md:545-553).

## 6. Success criteria

### 6.1 v1.0.0 ship criteria

All items are checked off (docs/archive/PRD.md:559-589):

- All public APIs implemented per `SPEC.md` (docs/archive/PRD.md:559).
- Source small enough to audit in an afternoon, no hard LOC cap (docs/archive/PRD.md:560).
- Production dependency count is 1 (`nodemailer`); storage uses stdlib `node:sqlite` as of v0.2.0 (docs/archive/PRD.md:561-562).
- All tests pass on Node 22.5+ (docs/archive/PRD.md:563).
- Silent-on-miss timing test: delta_mean(hit, miss) < 1ms over at least 1000 iterations locally, per FR-6 (docs/archive/PRD.md:564-566).
- Token replay and token expiry tests pass (docs/archive/PRD.md:567-568).
- Full integration test (HTTP login, email via test Postfix, click, handle returned) passes (docs/archive/PRD.md:569-570).
- Forward-auth integration is covered by addypin running knowless behind Caddy in production; the docker-compose harness (TASKS 6.8) was cut because `forward-auth-next.test.js` and `cli.test.js` cover every hop and the contract is two HTTP responses plus one header (docs/archive/PRD.md:571-578).
- README example works copy-pasted, validated by addypin integration (~1,150 LOC removed, ~35 added) (docs/archive/PRD.md:579-581).
- OPS.md gives complete Postfix and reverse-proxy checklists for Ubuntu/Debian (docs/archive/PRD.md:582-583).
- `npx knowless-server` works from a fresh install, and the package is published to npm (docs/archive/PRD.md:584-585).
- Cross-linking moved out of repo scope: the README edits live in the addypin and gitdone repos and are not a knowless gate (docs/archive/PRD.md:586-589).

### 6.2 30-day post-launch criteria

- Done: at least one external service integrated and gave feedback; three adopters now: addypin (Mode A, drove AF-7 to AF-17), plato (Mode B, forum), gitdone (Mode A, drove the v1.1.1 wrong-shape-integration anti-pattern callout) (docs/archive/PRD.md:593-597).
- Open (unchecked): at least one external self-hoster deploying `knowless-server` for a real service; pending, the turnkey Docker image was cut 2026-04-29, and the OPS.md from-zero-VPS walkthrough remains the canonical path (docs/archive/PRD.md:598-603).
- Done: no unresolved security issues and no silent-on-miss regressions (docs/archive/PRD.md:604-605).
- Done: documentation answers the top 5 user questions without a GitHub issue; the addypin integration produced zero issues, only feedback rounds (docs/archive/PRD.md:606-608).

### 6.3 Walk-away criteria

After v1.0.0 ships and is stable for 60 days (docs/archive/PRD.md:612):

- Maintenance mode is entered: security patches and bug fixes only (docs/archive/PRD.md:614).
- Feature requests are deflected to the §14 non-goals table or to sibling projects (docs/archive/PRD.md:615-616).
- The library being "done" is documented as a feature (docs/archive/PRD.md:617).
