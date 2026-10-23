---
title: Decisions log and non-goals
description: Recorded knowless decisions (PRD section 16), the NO-GO non-goals table (section 14) and sibling-project candidates (section 15) that are not to be relitigated.
---

# Decisions log and non-goals

This is the pointer page for "do not relitigate" decisions. Full long-form reasoning is in the cited source lines; the original is archived byte-identical and the citations resolve there.

Protocol: if a request contradicts a decision here, push back by referencing the recorded reasoning, and change only if the user gives a new reason not considered originally (docs/archive/PRD.md:1757-1766).

## 14. Non-goals (the NO-GO table)

Recorded unconditionally; re-litigating these is called the biggest scope-creep risk, so point at this table for feature requests (docs/archive/PRD.md:1677-1683).

| # | Non-goal | Reason (short) |
|---|---|---|
| 14.1 | Remote SMTP / mail vendor support | Forces credentials; invites non-auth mail. Localhost Postfix only. (docs/archive/PRD.md:1686-1686) |
| 14.2 | Email templating, HTML email, branding | Fixed plain-text body; fork to brand. (docs/archive/PRD.md:1687-1687) |
| 14.3 | Multiple recipients, broadcast, marketing list | Single recipient per send, impossible by construction. (docs/archive/PRD.md:1688-1688) |
| 14.4 | Bounce handling, click tracking, open analytics | Send and forget; tracking contradicts philosophy. (docs/archive/PRD.md:1689-1689) |
| 14.5 | Postfix install/configuration helpers | Out of scope; operator runs Postfix. (docs/archive/PRD.md:1690-1690) |
| 14.6 | OAuth / OIDC / SAML provider modes | Different audience and surface. (docs/archive/PRD.md:1691-1691) |
| 14.7 | 2FA, WebAuthn, TOTP, biometrics | Compose with other libraries. (docs/archive/PRD.md:1692-1692) |
| 14.8 | Account recovery beyond "request a new link" | No password; recovery is auth itself. (docs/archive/PRD.md:1693-1693) |
| 14.9 | Account TTL, expiry, deactivation fields | Operator metadata table; slope to a user model. (docs/archive/PRD.md:1694-1694) |
| 14.10 | Allowlists / denylists with admin UI | README recipe; operator wraps `loginHandler`. (docs/archive/PRD.md:1695-1695) |
| 14.11 | Federated identity across deployments | Each deployment sealed; different secret, different handles. (docs/archive/PRD.md:1696-1696) |
| 14.12 | Telemetry, analytics, error reporting | Never; no phone-home. (docs/archive/PRD.md:1697-1697) |
| 14.13 | Hosted SaaS version | Contradicts the philosophy. (docs/archive/PRD.md:1698-1698) |
| 14.14 | Magic codes (numeric one-time codes) | Not in the borrowed pattern; stay narrow. (docs/archive/PRD.md:1699-1699) |
| 14.15 | DKIM/SPF verification for inbound mail | Different problem; sibling library or gitdone. (docs/archive/PRD.md:1700-1700) |
| 14.16 | Cross-device auth flow | Real need, different problem family. (docs/archive/PRD.md:1701-1701) |
| 14.17 | TypeScript source | JSDoc plus shipped `.d.ts` suffices; no build step. (docs/archive/PRD.md:1702-1702) |
| 14.18 | Pin commitments / password equivalents | Brute-forceable from a leak; magic link is the only auth. (docs/archive/PRD.md:1703-1703) |
| 14.19 | Customisable login form (templates, themes) | Hardcoded HTML; fork to brand. (docs/archive/PRD.md:1704-1704) |
| 14.20 | Welcome / onboarding / any non-magic-link email | Library cannot send anything else, by API shape. (docs/archive/PRD.md:1705-1705) |
| 14.21 | Group-based ACLs | Slope to a user model; possible sibling `knowless-rbac`. (docs/archive/PRD.md:1706-1706) |
| 14.22 | OAuth/OIDC compatibility for forward-auth | Use Authelia/Authentik; knowless is the simpler option. (docs/archive/PRD.md:1707-1707) |
| 14.23 | Admin UI for handles or sessions | The SQLite database is the admin UI. (docs/archive/PRD.md:1708-1708) |
| 14.24 | Customisable email body/subject beyond simple replacement | Subject configurable; body fixed. (docs/archive/PRD.md:1709-1709) |
| 14.25 | Hashcash / proof-of-work on the login form | Punishes weak hardware, adds JS, does not stop email-bombing. (docs/archive/PRD.md:1710-1710) |
| 14.26 | CAPTCHAs | Third-party, accessibility-hostile; put at the reverse proxy. (docs/archive/PRD.md:1711-1711) |
| 14.27 | Behavioural / fingerprint bot detection | Tracking surface; honeypot plus per-IP cap is the limit. (docs/archive/PRD.md:1712-1712) |
| 14.28 | Email validation beyond syntactic check | No MX / disposable-list checks; the round-trip is the validation. (docs/archive/PRD.md:1713-1713) |
| 14.29 | HTML email / multipart / inline images | All outbound is `text/plain` UTF-8. (docs/archive/PRD.md:1714-1714) |
| 14.30 | External resources on login/confirmation pages | External hosts leak user information; pages self-contained. (docs/archive/PRD.md:1715-1715) |
| 14.31 | Tracking pixels, click-rewriting, open/click analytics | Privacy-hostile. (docs/archive/PRD.md:1716-1716) |
| 14.32 | "Mass mail" headers (`List-Unsubscribe`, `X-Campaign`) | Transactional mail only; standard headers. (docs/archive/PRD.md:1717-1717) |
| 14.33 | JSON / YAML / TOML config files | Env vars canonical; use `--print-config`. (docs/archive/PRD.md:1718-1718) |
| 14.34 | Hot-reload of config | Secret change invalidates sessions; restart is the boundary. (docs/archive/PRD.md:1719-1719) |
| 14.35 | Multiple named config profiles | Each environment is its own deployment. (docs/archive/PRD.md:1720-1720) |
| 14.36 | `--secret` or other CLI flags taking secrets | Visible in `ps`/history; forbidden by FR-52. (docs/archive/PRD.md:1721-1721) |
| 14.37 | Bundled `.env` loader | Node 22+ has `--env-file=`. (docs/archive/PRD.md:1722-1722) |
| 14.38 | Geolocation in last-login hint or elsewhere | Extra dep, poor accuracy, contradicts privacy stance. (docs/archive/PRD.md:1723-1723) |
| 14.39 | IP address logging/storage per handle | IP only transient for rate limiting, never persisted with handle. (docs/archive/PRD.md:1724-1724) |
| 14.40 | User agent / device fingerprint storage | Tracking surface, little security value. (docs/archive/PRD.md:1725-1725) |
| 14.41 | Login history beyond the most recent sign-in | `last_login_at` is one timestamp, not a journal. (docs/archive/PRD.md:1726-1726) |
| 14.42 | Per-handle metadata beyond `last_login_at` | Library refuses to grow a user model. (docs/archive/PRD.md:1727-1727) |

## 15. Sibling project candidates (NOT v1 commitments)

Recorded so their scope is not absorbed into knowless; none are commitments, and they would be separate libraries with separate scopes (docs/archive/PRD.md:1729-1756).

- DKIM/SPF inbound verification library extracted from gitdone (docs/archive/PRD.md:1733-1735).
- Forgetful-form library for contact forms, signups and comment fields (docs/archive/PRD.md:1736-1738).
- `bareprofile`-style minimal user metadata store (docs/archive/PRD.md:1739-1742).
- `knowless-rbac`, a thin sibling for group-based access if it becomes a recurring request (docs/archive/PRD.md:1743-1746).
- `bareletter`, a minimal one-shot SMTP sender for occasional non-auth mail (docs/archive/PRD.md:1747-1749).

## 16. Decisions log (for future Claude)

### 16.1 Why magic-link, not pin commitments

No pin commitments or password equivalents; auth is exclusively the magic-link round-trip (docs/archive/PRD.md:1770-1771). A commitment in a database is brute-forceable and a leaked table is a leaked password table, whereas magic links leave nothing on our side usable to log in (docs/archive/PRD.md:1773-1781). Reconsidered mid-design and rejected; revisit only on a fundamentally new argument (docs/archive/PRD.md:1782-1784).

### 16.2 Why Postfix on localhost, not nodemailer-to-anything

The bundled mailer connects only to `localhost:25`: no remote SMTP, no auth, no vendor APIs (docs/archive/PRD.md:1787-1788). Remote config would mean credentials, a vendor, and an invitation to reuse the mailer for non-auth mail (docs/archive/PRD.md:1790-1797). The operator must run Postfix and handle deliverability; that filter is intentional (docs/archive/PRD.md:1799-1801).

### 16.3 Why bundled, not primitive

The library is full-stack (HTTP endpoints, mailer, storage) with a six-line integration, not a primitives kit (docs/archive/PRD.md:1805-1807). Bundling puts the privacy-preserving choices in the library so the safe path is the easy path (docs/archive/PRD.md:1809-1813).

### 16.4 Why Node 22.5+ and `node:sqlite` (revised v0.15)

Target Node 22.5+ with `node:sqlite` as the only store backend, dropping `better-sqlite3` (docs/archive/PRD.md:1821-1823). The earlier reasons aged out: `node:sqlite` was unflagged in 22.13 and is stable in Node 24, Node 20 reaches EOL April 2026, and `better-sqlite3` needed a C++20 toolchain that hurt RHEL-family self-hosters (docs/archive/PRD.md:1825-1850). Result: zero native compile, one production dep (`nodemailer`), and an identical public `Store` interface (docs/archive/PRD.md:1852-1856).

### 16.5 Why JavaScript, not TypeScript

Plain JavaScript with JSDoc and a shipped `.d.ts`, no build step (docs/archive/PRD.md:1864-1865). Fits the `bare` suite ethos, is easier to audit, and the library is too small to justify a build step (docs/archive/PRD.md:1867-1870). See also 16.24.

### 16.6 Why silent-on-miss with timing equivalence (revised v0.4)

Same response and timing whether registered or not, enforced by an automated test, with no opt-out (docs/archive/PRD.md:1874-1875). It prevents email enumeration via the login form at almost no complexity cost (docs/archive/PRD.md:1877-1880). Revised scoping: it is not the library's defining feature; the philosophy (refuse to store identifiable data, send non-auth mail, or grow) is, and timing equivalence supports it (docs/archive/PRD.md:1882-1899).

### 16.7 Why no DKIM in this library

No DKIM/SPF verification and no inbound mail handling; that is gitdone's territory (docs/archive/PRD.md:1903-1904). It solves a different problem and would force mail-receiving infrastructure on every adopter; compose with gitdone-extracted verification instead (docs/archive/PRD.md:1906-1913).

### 16.8 Why no allowlist code in the library

The allowlist plus TTL pattern is a README recipe of about 6 lines, not library code (docs/archive/PRD.md:1917-1918). Allowlist tables make the library know handle metadata, so the schema grows toward a user model (docs/archive/PRD.md:1920-1924).

### 16.9 Why walk-away after v1

v1.0.0 is the target; afterwards only security patches and bug fixes, and feature requests are deflected (docs/archive/PRD.md:1928-1930). Its value comes from being small, focused and finished; a library that keeps growing becomes "another Auth0" (docs/archive/PRD.md:1932-1937).

### 16.10 Why ship the standalone server (forward-auth)

Ship `bin/knowless-server` as a real CLI binary for forward-auth deployments, not just a docs example (docs/archive/PRD.md:1941-1943). The self-hoster audience is large and underserved by heavyweight options, the marginal code is about 50 lines, and the operator needs config rather than code (docs/archive/PRD.md:1945-1957). Option B (ship the binary) was chosen over Option A (documented example) to minimise operator friction (docs/archive/PRD.md:1959-1970).

### 16.11 Why session management belongs in the library

Sessions (signed cookies, lifetime, forward-auth verify endpoint, logout) are in the library (docs/archive/PRD.md:1974-1976). The standalone server has no host app to manage sessions; library-mode operators may ignore the cookies and use their own (docs/archive/PRD.md:1978-1988).

### 16.12 Why hardcoded login HTML

The login form is one hardcoded HTML page, not a template (docs/archive/PRD.md:1992-1993). Templating is a slope from "my logo" to "embed a JavaScript framework"; operators wanting branding fork or live with it, consistent with 14.2 (docs/archive/PRD.md:1995-2002).

### 16.13 Why we don't oversell auth as a hard problem

Marketing, README and docs frame auth as an overcomplicated problem, not an expert-only domain (docs/archive/PRD.md:2006-2008). For small services and self-hosters, magic links plus a session cookie cover the realistic threat model, and knowless should be honest about being a refusal of unnecessary layers (docs/archive/PRD.md:2010-2028).

### 16.14 Why we publish an honest threat model

§12.1 states what knowless does and does not defend against, including limitations (docs/archive/PRD.md:2032-2034). Honesty about what is not defended (server compromise, compromised email accounts, social engineering) avoids false security; features needing a wider threat model are declined (docs/archive/PRD.md:2036-2051).

### 16.15 Why cheap abuse protection is built-in by default

Per-email and per-IP rate limits, a honeypot, and a per-IP account-creation cap (open registration) ship with safe defaults that operators may tune or disable (docs/archive/PRD.md:2055-2059). Cheap automatic defences catch the cheapest abuse; heavyweight defences are refused (14.25 to 14.27) and left to the reverse proxy, fail2ban or edge CAPTCHA (docs/archive/PRD.md:2061-2090).

### 16.16 What "silent on miss" actually means

Response shape and timing are uniform, but the user always sees the confirmation "Thanks. If `<email>` is registered, a sign-in link is on its way." for every outcome including rate limit, honeypot and SMTP failure (docs/archive/PRD.md:2093-2099). Rate-limit hits are silent because a message would leak that the email is registered and that abuse is noticed (docs/archive/PRD.md:2100-2103). Accepted cost: an accidental per-IP cap hit gets silent failure; per-handle policy is "newest replaces oldest" (docs/archive/PRD.md:2105-2125).

### 16.17 Why everything is plain text and minimal HTML

All email is `text/plain; charset=utf-8`; all pages are self-contained HTML5 with no JavaScript, external resources or analytics (docs/archive/PRD.md:2130-2134). Three converging reasons: deliverability, privacy, and simplicity (docs/archive/PRD.md:2136-2166). Defaults are deliberately bare-bones; operators fork for branding (docs/archive/PRD.md:2168-2172).

### 16.18 Why env vars, not config files

Configuration is via env vars only; CLI flags are limited to `--help`, `--version`, `--print-config`, `--config-check`; no config files; secrets never via flags; `.env` via Node's `--env-file=` (docs/archive/PRD.md:2175-2181). Reasons in order: secrets in files is a footgun, 12-factor consistency, suite consistency, and scope creep avoidance (docs/archive/PRD.md:2183-2205). The "one place to see everything" need is met by `knowless-server --print-config`, and `config.example.env` is a documentation template only (docs/archive/PRD.md:2207-2221).

### 16.19 Why last-login timestamp yes, location no

Track `last_login_at` and append "Last sign-in: <timestamp>" to magic-link emails; never track or expose location, IP, user agent or other identifying metadata (docs/archive/PRD.md:2230-2233). The timestamp is a free compromise signal; location needs GeoIP, IP storage and is inaccurate and surveillance-like, so it is refused even as opt-in (docs/archive/PRD.md:2235-2271). The line: "timestamp is a security signal, location is surveillance" (docs/archive/PRD.md:2273-2275). Related to 14.39 (docs/archive/PRD.md:2266-2271).

### 16.20 Why timing envelope narrowed in v0.10

FR-6 strict timing equivalence applies only to the registered-vs-unregistered path; rate-limit and honeypot short-circuits are exempt (docs/archive/PRD.md:2282-2284). Strictness needed sham work and would hold legitimate shared-NAT users in artificial delays while protecting nothing the volume signal did not already expose (docs/archive/PRD.md:2286-2322). Response shape from 16.16 stays uniform, and 14.27 still rules (docs/archive/PRD.md:2324-2331).

### 16.21 Why no same-browser binding for magic links

The magic link stays a bearer token and is not bound to the requesting browser; an adopter recipe lives in `knowless.context.md` (docs/archive/PRD.md:2335-2339). Reasons: it would defend a threat 16.14 records as out of scope, it breaks cross-device flows, and it fails the walk-away test (docs/archive/PRD.md:2349-2388). Mechanism is generic, policy is per-app, so it belongs in adopter code (docs/archive/PRD.md:2390-2397).

### 16.22 Why `from` is validated for wire-safety, not address validity

`createMailer` rejects `from` containing `<`, `>` or CR/LF at startup (v1.1.9) but does not otherwise validate address shape; display names go to `fromName` (docs/archive/PRD.md:2401-2406). The sender is operator config whose valid shape is the MTA's business; the recipient `to` is validated strictly (docs/archive/PRD.md:2408-2431). The line: "validate the invariants knowless's own machinery depends on; do not become an RFC address validator" (docs/archive/PRD.md:2433-2436).

### 16.23 Why the email body is ASCII-only (anti-spoofing, not just encoding)

The rendered mail body MUST be 7-bit ASCII, validated on output including operator-overridden subjects and bodies; Unicode bodies are unsupported (docs/archive/PRD.md:2446-2450). The load-bearing reason is anti-spoofing: it kills bidi/RTL override, homoglyph spoofing and zero-width injection (docs/archive/PRD.md:2452-2466). Allowing Unicode would need bidi handling, normalization, a confusables policy and zero-width stripping for little payoff (docs/archive/PRD.md:2468-2486). Do not reopen without a new argument that defeats the spoofing concern (docs/archive/PRD.md:2488-2492).

### 16.24 Why ship generated TypeScript types (and strictNullChecks, not full strict)

Ship `.d.ts` generated from JSDoc by `tsc`, git-ignored and built on publish; typecheck uses `checkJs` plus `strictNullChecks`; additive, dev-dependencies only, and within the documentation-corrections carve-out (docs/archive/PRD.md:2495-2504). The `.d.ts` is the only thing that crosses the npm boundary, and generation avoids drift (docs/archive/PRD.md:2506-2513). Full `strict` was rejected: 135 findings, only 8 genuine, 126 `noImplicitAny` on framework-agnostic handler params (docs/archive/PRD.md:2515-2522).

### 16.25 Why the `startLogin` throttle seam is docs, and the XFF-misconfig warning stays prose

Of three gitdone review items, two shipped as documentation only (a `GUIDE.md` throttle recipe for `bypassRateLimit: true`, and a README/context threat-model clause that per-IP caps bound one address, not aggregate volume); the third, a one-time `X-Forwarded-For` warning in `determineSourceIp`, was rejected (docs/archive/PRD.md:2534-2547). The warning adds code and state outside walk-away, and multiple XFF elements are normal for legitimate multi-hop chains, so it would false-positive (docs/archive/PRD.md:2549-2569). Do not relitigate without a fundamentally new argument (docs/archive/PRD.md:2569-2570).
