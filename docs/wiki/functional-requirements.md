---
title: Functional requirements
description: The FR-1 to FR-56 functional requirements knowless must meet, grouped by PRD section 7.1-7.12, one line each with source citations.
---

# Functional requirements

The full normative text is in the cited source lines; the original is archived byte-identical and the citations resolve there. This page keeps every FR identifier with a short statement. MUST/SHOULD wording is as in the source.

## 7.1 Email handling

- **FR-1.** MUST accept email addresses as input strings and normalise them per `SPEC.md §1` before any other processing. (docs/archive/PRD.md:623-625)
- **FR-2.** MUST NOT persist any email address in plaintext at any point in the data flow. (docs/archive/PRD.md:626-628)
- **FR-3.** MUST derive a stable opaque handle from the normalised email plus the operator's secret per `SPEC.md §2`. (docs/archive/PRD.md:629-631)

## 7.2 Login flow

- **FR-4.** MUST expose `loginHandler(req, res)`: accepts a POST with an email field, does the silent lookup, issues a token if appropriate, sends the magic link via Postfix, and returns a response that does not leak whether the email was registered. (docs/archive/PRD.md:634-639)
- **FR-5.** The login response MUST be identical in body, status code and headers for every internal outcome (hit, silent miss, rate limit, honeypot, IP cap, SMTP failure); there is no distinct error response. (docs/archive/PRD.md:640-645)
- **FR-6.** Response time MUST be practically indistinguishable between registered and unregistered cases: the delta in mean response time MUST be under 1 millisecond, measured locally over at least 1000 iterations. The bar is effect size, not a p-value; the POC measured about 720us (hit) vs about 460us (miss). (docs/archive/PRD.md:646-663)
  - The silent-miss path MUST do equivalent sham work: derive the handle the same way, do the store lookup, insert a token row for the unregistered handle (reaped by the FR-13 sweeper), and compose and submit the mail to the local MTA the same way. (docs/archive/PRD.md:664-673)
  - Sham-work cost is bounded by per-IP limiting (FR-39), 30 attempts per IP per hour by default. (docs/archive/PRD.md:674-678)
  - Rate-limit and honeypot paths MAY short-circuit faster and are exempt from timing equivalence; FR-5 shape equivalence still applies. (docs/archive/PRD.md:679-692)
- **FR-7.** The response MUST include a confirmation message saying a sign-in link is on its way if the email is registered. Default: "Thanks. If `<echoed-email>` is registered, a sign-in link is on its way. Check your inbox in a few minutes." The text MAY be overridden; the echoed email MUST be HTML-escaped. (docs/archive/PRD.md:693-703)
- **FR-8.** MUST support an option allowing new-handle creation on first submission (open registration); default is closed. (docs/archive/PRD.md:704-707)
- **FR-9.** MUST serve a hardcoded HTML login form at a configurable path (default `/login`) for standalone server mode. (docs/archive/PRD.md:708-711)

## 7.3 Magic link lifecycle

Three non-negotiable rules: 256-bit entropy (not configurable), 15-minute TTL by default (`tokenTtlSeconds`), single use (replay fails silently). (docs/archive/PRD.md:712-722)

- **FR-10. Token entropy.** Each token MUST have at least 256 bits from a CSPRNG (`node:crypto.randomBytes`); a floor, with no knob to weaken it. (docs/archive/PRD.md:723-727)
- **FR-11. Token TTL.** Each token MUST expire after a configurable window (default 15 minutes). After expiry `verifyClick` MUST return null without distinguishing "expired" from "never existed"; TTL is enforced server-side via `expires_at`. (docs/archive/PRD.md:728-733)
- **FR-12. Single-use.** Each token MUST be redeemable exactly once; `used_at` is set on success and replay MUST fail silently with the same null response. (docs/archive/PRD.md:734-739)
- **FR-13. Token storage.** Tokens are stored as `SHA-256(token)`; a store leak MUST NOT yield usable tokens. Expired tokens MUST be deleted or marked obsolete, with a sweep on a schedule (every 5 minutes by default). (docs/archive/PRD.md:740-745)

## 7.4 Session lifecycle

No FR ids here. Defaults: lifetime 30 days (`sessionTtlSeconds`, server-enforced); storage is hashed session ID + handle + expiry plus a signed client cookie; revocation via logout endpoint or store-side delete. Session FRs live in 7.8. (docs/archive/PRD.md:746-761)

## 7.5 Email delivery

- **FR-14.** MUST send the magic link via SMTP to `localhost:25` (port configurable for testing). (docs/archive/PRD.md:764-766)
- **FR-15.** MUST NOT support remote SMTP, SMTP authentication, or vendor APIs (Postmark, SES, Mailgun, etc.). (docs/archive/PRD.md:767-769)
- **FR-16. Plain text only.** MUST send `Content-Type: text/plain; charset=utf-8` with no HTML alternative, multipart, attachments, inline images or embedded resources. The body MUST contain the plain magic link URL (not wrapped or shortened) and an expiry note. A "Last sign-in" line is appended only when a prior login exists (FR-21). Operators MAY override the body text, but the link MUST appear unmodified and HTML MUST NOT be introduced. (docs/archive/PRD.md:770-796)
- **FR-17. Standard headers, nothing fancy.** MUST include `From`, `To`, `Subject`, `Date`, `Message-ID`, `Content-Type`; MUST NOT include `List-Unsubscribe`, `Return-Receipt-To`, `Disposition-Notification-To`, custom `X-` headers, or anything marking mass mail. Encoding (revised v0.11): `Content-Transfer-Encoding` MUST be `7bit`, body ASCII-only, URL on its own line; quoted-printable and base64 are forbidden; nodemailer MUST be configured for 7bit and operator-overridden subjects and bodies MUST remain ASCII. (docs/archive/PRD.md:797-822)
- **FR-18. No tracking, no shortening, no rewriting.** MUST NOT add tracking pixels, URL shorteners, click-through redirects, analytics injection or unsubscribe links; the link is literally `baseUrl + linkPath + ?t=<token>`. (docs/archive/PRD.md:823-828)
- **FR-19. Subject line is short and plain.** Default `Sign in`. Overrides MUST be 60 chars or fewer, with no marketing punctuation and no spam-trigger words; the library SHOULD warn on common spam triggers. (docs/archive/PRD.md:829-835)
- **FR-20.** MUST discard the recipient address from memory after the SMTP transaction completes. (docs/archive/PRD.md:836-838)
- **FR-21. Last-login compromise hint.** MUST track `last_login_at` per handle and append "Last sign-in: <ISO 8601 UTC timestamp>" to the email body; enabled by default, MAY be disabled via `includeLastLoginInEmail`. MUST NOT track or include geolocation, IP, user agent, device fingerprint or other metadata. `last_login_at` MUST be updated only on successful session establishment, not on link issuance. (docs/archive/PRD.md:839-857)

## 7.6 HTML pages (login form, confirmation, errors)

- **FR-22. Plain HTML, no external resources.** All library-served pages MUST be self-contained HTML5: no JavaScript, no external stylesheets/fonts/images, no embedded base64 assets, minimal inline styling only, no analytics or third-party widgets, no forms beyond the login form. Pages MUST work in text-mode browsers, be keyboard-navigable and screen-reader readable. (docs/archive/PRD.md:860-877)
- **FR-23.** The login form MUST contain only an email input (`type="email" required`), a submit button, and the honeypot field per FR-41: no remember-me, ToS links, third-party login buttons, marketing copy or captchas. (docs/archive/PRD.md:878-884)

## 7.7 Click verification

- **FR-24.** MUST expose `callbackHandler(req, res)`: accepts a GET with a token query parameter, verifies it, and either establishes a session or signals failure. (docs/archive/PRD.md:887-890)
- **FR-25.** All verification failures (invalid, expired, replayed, malformed) MUST produce the same response shape. (docs/archive/PRD.md:891-893)
- **FR-26.** On success MUST set a session cookie (per 7.8) and either redirect to a configured destination or hand the handle to a developer callback in library mode. (docs/archive/PRD.md:894-898)
- **FR-27.** When a `redirect` query parameter is present, MUST validate it against the configured cookie domain (whitelist) before redirecting, to prevent open redirects. (docs/archive/PRD.md:899-903)
- **FR-27a. Forward-auth return URL (revised v0.12).** For `/login?next=<url>` the library MUST: (1) validate `next` against the `cookieDomain` whitelist before any token is issued, silently dropping it on failure; (2) bind the validated URL to the magic-link token so it survives the email round-trip and cannot be tampered with; (3) redirect to the bound URL after setting the cookie on redemption, else to the default destination (or `/`). The mechanism is SPEC's job; SPEC.md §11 currently uses a DB-bound row. (docs/archive/PRD.md:904-936)

## 7.8 Forward-auth and session

- **FR-28.** MUST expose `verifyHandler(req, res)` (default `/verify`): 200 OK with an `X-User-Handle` header for a valid session cookie, else 401. (docs/archive/PRD.md:939-943)
- **FR-29.** MUST expose `logoutHandler(req, res)` (default `/logout`): clears the session cookie and returns 200 OK. (docs/archive/PRD.md:944-947)
- **FR-30 (revised v0.14).** Session cookies MUST be signed with the operator secret (HMAC-SHA256), `HttpOnly`, `SameSite=Lax`, scoped to the cookie domain (default eTLD+1 of `baseUrl`), and `Secure` by default. `cookieSecure: false` is allowed for local `http://localhost` only; operators MUST NOT set it in production, and the library SHOULD log a stderr warning at startup when it is set. (docs/archive/PRD.md:948-958)
- **FR-31.** Session lifetime MUST be configurable (default 30 days) and enforced server-side via a stored expiry, not just the client cookie. (docs/archive/PRD.md:959-962)

## 7.9 Storage

- **FR-32.** MUST ship a default SQLite-backed store; since v0.2.0 it uses `node:sqlite` (previously `better-sqlite3`). No alternate built-in backend. (docs/archive/PRD.md:965-970)
- **FR-33.** The store interface MUST be defined and documented so operators can supply alternatives (Postgres, Redis, in-memory) without modifying library code. (docs/archive/PRD.md:971-974)
- **FR-34.** The store MUST persist hashed tokens, not raw ones. (docs/archive/PRD.md:975-977)
- **FR-35.** The store MUST persist handles in hashed (HMAC output) form, not any reversible representation. (docs/archive/PRD.md:978-980)
- **FR-36.** The store MUST persist active sessions with handle, expiry and a server-side session ID; a store leak MUST NOT yield usable sessions without the operator secret. (docs/archive/PRD.md:981-984)
- **FR-37.** The store MUST persist `last_login_at` per handle for FR-21; it is the only per-user metadata beyond the handle (no `created_at`, `last_active_at`, `login_count`, IPs or user agents). (docs/archive/PRD.md:985-992)
- **FR-37a. Account deletion (right-to-erasure).** The store MUST expose `deleteHandle(handle)`, which in a single transaction removes the handle row, its active tokens, its active sessions and its `last_login_at`. The library MUST NOT ship an HTTP endpoint that calls it; the operator wires the UX. (docs/archive/PRD.md:993-1008)

## 7.10 Abuse protection (built-in defaults)

Cheap, safe defaults are enabled out of the box; operators can adjust or disable each. More sophisticated attacks need reverse-proxy or operator-side defences. (docs/archive/PRD.md:1009-1019)

- **FR-38. Per-email rate limiting.** MUST cap active (unexpired, unused) tokens per handle, default 5; at the cap, new requests silently replace the oldest active token. (docs/archive/PRD.md:1020-1027)
- **FR-39. Per-IP rate limiting on the login endpoint.** MUST track submissions per source IP and silently limit, default 30 per IP per hour; over the limit the generic silent-miss response is returned and no email is sent. (docs/archive/PRD.md:1028-1035)
- **FR-40. Per-IP rate limiting on account creation (open-registration only).** When `openRegistration` is true, MUST also cap new handles per IP, default 3 per hour; above it the silent-miss path is taken. The handle row is created at first redemption, not at send, so an address that has never redeemed a link is "new" on every request and keeps counting against this cap. (docs/archive/PRD.md:1036-1043)
- **FR-41. Honeypot field in the login form.** The form MUST include an off-screen honeypot input (e.g. `website`, `url`, `phone`); if non-empty the request MUST take the silent-miss path. It MUST have `aria-hidden="true"` and `tabindex="-1"`. (docs/archive/PRD.md:1044-1051)
- **FR-42. Source IP determination.** MUST take the client IP from `X-Forwarded-For` or `X-Real-IP` behind a reverse proxy, else the connection's remote address. Trusted proxy IPs MUST be configurable; in standalone mode the operator MUST configure them explicitly (default localhost only). Operator precondition: a CDN silently defeats FR-42 (the proxy sees a CDN edge as its peer, so FR-39/FR-40 either over-throttle or are bypassed depending on the `X-Forwarded-For` directive); the library cannot detect this, and the operator MUST restore the true client IP at the edge-most proxy, scoped to the CDN's published ranges. (docs/archive/PRD.md:1052-1083)
- **FR-43. Failures all look the same.** All abuse-protection rejections (rate limit, honeypot, IP cap) MUST match a normal silent-miss in response shape and timing, including the FR-7 message. There is NO rate-limit-specific message. (docs/archive/PRD.md:1084-1092)
- **FR-44. Operator can adjust or disable.** All abuse parameters (caps, windows, honeypot name, trusted proxies) MUST be configurable; setting any cap to `0` MUST disable that check. (docs/archive/PRD.md:1093-1100)
- **FR-45. Rate-limit state in the store.** Per-IP counters MUST be persisted in the same store as tokens and sessions with automatic expiry; the library MUST NOT keep abuse state in process memory only. (docs/archive/PRD.md:1101-1106)

## 7.11 Configuration

- **FR-46.** MUST be configured via a single options object passed to the `knowless()` factory. Required: `secret` (HMAC secret, at least 32 bytes hex), `baseUrl`, `from`. Optional fields with defaults include `dbPath` (`./knowless.db`), `tokenTtlSeconds` (900), `sessionTtlSeconds` (2592000), `cookieDomain`, `linkPath` (`/auth/callback`), `loginPath` (`/login`), `verifyPath` (`/verify`), `logoutPath` (`/logout`), `smtpHost` (`localhost`), `smtpPort` (25), `openRegistration` (false), `subject` (`'Sign in'`), `confirmationMessage`, `includeLastLoginInEmail` (true), `maxActiveTokensPerHandle` (5), `maxLoginRequestsPerIpPerHour` (30), `maxNewHandlesPerIpPerHour` (3), `honeypotFieldName` (`website`), `trustedProxies` (`['127.0.0.1', '::1']`). (docs/archive/PRD.md:1109-1136)
- **FR-47.** MUST refuse to start if `secret`, `baseUrl` or `from` is missing or empty. (docs/archive/PRD.md:1137-1139)
- **FR-48.** MUST refuse to start if `secret` is shorter than 32 bytes (64 hex characters). (docs/archive/PRD.md:1140-1142)

## 7.12 Standalone server (CLI)

- **FR-49. Configuration is via environment variables.** `knowless-server` is configured through `KNOWLESS_`-prefixed env vars; every FR-46 option MUST be settable that way. (docs/archive/PRD.md:1145-1153)
- **FR-50.** MUST ship a `bin/knowless-server` executable running the auth-only HTTP server, runnable via `npx knowless-server` without prior install. (docs/archive/PRD.md:1154-1158)
- **FR-51. CLI flags are limited to inspection and validation.** Exactly four flags, none of which set config: `--help` (usage and `KNOWLESS_*` vars, exit 0), `--version`, `--print-config` (effective config as `KEY=VALUE`, secrets as `<set>`/`<unset>`), `--config-check` (also checks required values, SMTP reachability and DB path writability; non-zero on failure; suited to systemd `ExecStartPre`). (docs/archive/PRD.md:1159-1170)
- **FR-52.** Secrets MUST NOT be settable via CLI flags; no `--secret`, `--hmac-secret` or equivalent. (docs/archive/PRD.md:1171-1176)
- **FR-53.** `.env` support is Node's built-in `--env-file=` (Node 22+); the library MUST NOT bundle its own `.env` loader. (docs/archive/PRD.md:1177-1182)
- **FR-54.** The CLI MUST log effective configuration on startup in a single stdout block (secrets as `<set>`, SMTP check result, listening port). (docs/archive/PRD.md:1183-1189)
- **FR-55.** The CLI MUST refuse to start with a clear error naming the specific missing or malformed env var (e.g. `KNOWLESS_SECRET is missing`), exiting non-zero. (docs/archive/PRD.md:1190-1195)
- **FR-56.** The repository MUST ship `config.example.env`, a documented sample listing every `KNOWLESS_*` variable with default and comment; it MUST NOT be loaded automatically. (docs/archive/PRD.md:1196-1203)
