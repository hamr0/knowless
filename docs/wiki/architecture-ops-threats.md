---
title: Architecture, operations and threats
description: Non-functional requirements, architecture, tech stack, operator duties, threat model and open questions for knowless (PRD sections 8-13).
---

# Architecture, operations and threats

The full text is in the cited source lines (the original is archived byte-identical, and citations resolve there).

## 8. Non-functional requirements

### 8.1 Performance

- **NFR-1.** Handle derivation MUST complete in under 1ms on commodity hardware. (docs/archive/PRD.md:1206-1209)
- **NFR-2.** Login handler end to end, excluding SMTP delivery time, MUST complete in under 100ms. (docs/archive/PRD.md:1211-1213)
- **NFR-3.** Verify handler (forward-auth check, the hot path for every authenticated request) MUST complete in under 10ms. (docs/archive/PRD.md:1215-1217)
- **NFR-4.** The library MUST sustain at least 200 verify-handler requests per second on a single VPS instance, since forward-auth load dominates login load. (docs/archive/PRD.md:1219-1221)

### 8.2 Security

- **NFR-5.** All token comparisons MUST use constant-time comparison via `node:crypto.timingSafeEqual`. (docs/archive/PRD.md:1225-1227)
- **NFR-6.** All random values (tokens, session IDs) MUST come from `node:crypto.randomBytes` (CSPRNG). (docs/archive/PRD.md:1229-1230)
- **NFR-7.** The library MUST NOT log the operator secret, raw tokens, raw session IDs or any plaintext email, including in debug or verbose modes. (docs/archive/PRD.md:1232-1235)
- **NFR-8.** The silent-on-miss contract has no opt-out; even debug modes MUST NOT leak registration status. (docs/archive/PRD.md:1237-1239)
- **NFR-9.** Redirect-after-login MUST whitelist redirect targets to the configured cookie domain to prevent open-redirect abuse. (docs/archive/PRD.md:1241-1243)

### 8.3 Reliability

- **NFR-10.** SMTP delivery failures MUST be logged but MUST NOT make the login handler leak whether the email was registered; the user sees the same response, the operator sees the failure in logs. (docs/archive/PRD.md:1247-1250)
- **NFR-11.** The store interface MUST be transactional: a token write followed by a delivery failure MUST roll back the write so a retry generates a fresh token. (docs/archive/PRD.md:1252-1254)

### 8.4 Observability

- **NFR-12.** Logs go to stdout in plain text (12-factor); no structured logging required. (docs/archive/PRD.md:1258-1259)
- **NFR-13.** Logs MUST NOT include plaintext emails, secrets, raw tokens or raw session IDs. (docs/archive/PRD.md:1261-1262)
- **NFR-14.** No telemetry, metrics or external phone-home of any kind. (docs/archive/PRD.md:1264-1265)

### 8.5 Maintainability

- **NFR-15.** Source MUST be plain JavaScript (ESM) with JSDoc type annotations; no TypeScript, no transpilation. (docs/archive/PRD.md:1269-1270)
- **NFR-16.** The public API MUST be documented in `SPEC.md` in enough detail that a compatible reimplementation in another language is straightforward. (docs/archive/PRD.md:1272-1273)
- **NFR-17.** Every public function MUST have unit tests; the silent-on-miss contract MUST have a dedicated timing test; the forward-auth flow MUST have an end-to-end test using a real reverse proxy in a container. (docs/archive/PRD.md:1275-1276)

## 9. Architecture overview

The repository layout (docs/archive/PRD.md:1278-1322):

- `src/`: `handle.js` (deriveHandle: HMAC-SHA256 plus email normalisation), `token.js` (issue, verify, expire, replay-reject), `session.js` (signed cookie session, server-side expiry), `store.js` (SQLite default, defines the swap interface), `mailer.js` (nodemailer to localhost Postfix), `abuse.js` (per-email and per-IP rate limits, honeypot, IP detection), `handlers.js` (loginHandler, callbackHandler, verifyHandler, logoutHandler), `form.js` (hardcoded login HTML including honeypot), `index.js` (public `knowless()` factory). (docs/archive/PRD.md:1280-1289)
- `bin/knowless-server`: standalone CLI server. (docs/archive/PRD.md:1290-1291)
- `test/`: unit tests (handle, token, session, abuse), integration tests (full-flow, forward-auth with Caddy, abuse-flow), `timing.test.js` for silent-on-miss timing equivalence, and spec test vectors under `fixtures/vectors`. (docs/archive/PRD.md:1292-1306)
- Top-level files: `package.json`, `config.example.env` (documented sample env file, FR-56), `README.md`, `DESIGN.md`, `PRD.md`, `SPEC.md`, `POC.md`, `OPS.md`, `CLAUDE.md`, `CHANGELOG.md`. (docs/archive/PRD.md:1307-1317)

### 9.1 Deployment patterns

- **Pattern A, library mode.** The operator imports `knowless` into an existing Node app and mounts the handlers on their framework; two endpoints are exposed, `loginHandler` (POST) and `callbackHandler` (GET). (docs/archive/PRD.md:1321-1325)
- **Pattern B, standalone server plus reverse-proxy forward-auth.** The operator runs `npx knowless-server`; a reverse proxy (Caddy/nginx/Traefik) in front of one or more protected services consults knowless for auth decisions, and the operator writes no application code. (docs/archive/PRD.md:1327-1331)
- Both patterns share the same library code; Pattern B is the new path for v1 and Pattern A the original use case. (docs/archive/PRD.md:1333-1334)

### 9.2 Data flow (login)

- The user submits an email to `loginHandler`, which normalises it and derives the handle, deleting the plaintext email, then does a silent lookup in the store. (docs/archive/PRD.md:1338-1349)
- If found: issue a token, send via Postfix, return 200 OK. If not found: discard the write, send nothing, return 200 OK. Same code path and same time either way. (docs/archive/PRD.md:1352-1357)
- When the user clicks the link, `callbackHandler` verifies the token in the store. If valid: mark used, create a session, set the cookie and redirect; if not valid: 401. (docs/archive/PRD.md:1359-1371)

### 9.3 Data flow (forward-auth, Pattern B)

- The browser request goes through Caddy/nginx to knowless `/verify`, which checks the session cookie. (docs/archive/PRD.md:1375-1381)
- Valid returns 200 OK with an `X-User-Handle` header and the proxy forwards to the protected service; invalid returns 401 Unauthorized, and the proxy redirects to `/login` on the auth domain. (docs/archive/PRD.md:1383-1388)
- After the magic-link dance (see 9.2) the user is redirected back to the original URL. (docs/archive/PRD.md:1389-1397)

## 10. Technology stack

The complete stack, consolidated for one-glance reference. (docs/archive/PRD.md:1401-1401)

### 10.1 Runtime and language

- Runtime is Node.js 22.5 or later, the `node:sqlite` (`DatabaseSync`) floor (see section 16.4 of the PRD), with modern crypto and SEA support. (docs/archive/PRD.md:1407-1407)
- Plain JavaScript, ESM only (`"type": "module"`); no TypeScript source, JSDoc plus a shipped `.d.ts`; no build step. (docs/archive/PRD.md:1408-1410)

### 10.2 Production dependencies

- One production dependency: `nodemailer` (MIT, maintainer Andris Reinman) for SMTP composition and delivery to the localhost MTA. It abstracts MTA response-quirk variance across Postfix/Exim/OpenSMTPD/sendmail, header folding, line-ending tolerance and dot-stuffing edge cases, applying the AGENT_RULES security-aware-parsing carve-out loosely. (docs/archive/PRD.md:1414-1416)
- Total is 1 production dependency as of v0.2.0. Storage uses `node:sqlite` (stdlib, no native compile); `better-sqlite3` was the backend in v0.1.x (see 16.4 for the v0.15 revisit). (docs/archive/PRD.md:1418-1420)

### 10.3 Stdlib usage

- `node:crypto` for HMAC-SHA256, randomBytes, createHash and timingSafeEqual; `node:http` for the standalone server (the library is framework-agnostic); `node:test` plus `node:assert` as the test framework; `node:fs/promises` for SQLite path resolution; `node:util` `parseArgs` for CLI arguments. (docs/archive/PRD.md:1424-1430)

### 10.4 Operational stack

- Mail transport is Postfix on `localhost:25`, installed and configured by the operator; Ubuntu/Debian recommended. (docs/archive/PRD.md:1436-1437)
- DNS (SPF, DKIM, PTR) and reverse DNS are the operator's and VPS provider's, required for deliverability. (docs/archive/PRD.md:1438-1439)
- Reverse proxy for Pattern B: Caddy recommended, nginx/Traefik supported, sample configs in OPS.md. (docs/archive/PRD.md:1440-1440)
- Outbound mail TLS is Postfix-managed (the library connects unencrypted to localhost); HTTP TLS is the reverse proxy's or external terminator's, as the library does not terminate TLS. (docs/archive/PRD.md:1441-1442)
- Process management is the operator's choice (systemd, pm2, docker). (docs/archive/PRD.md:1443-1443)

### 10.5 Distribution

- Library and CLI ship on npm in the same package (`bin/knowless-server`); source is on GitHub under Apache 2.0; docs are in-repo Markdown only with no external docs site; versioning is SemVer. (docs/archive/PRD.md:1447-1453)

### 10.6 What's not in the stack

- No framework (Express, Fastify, Hono, NestJS), no ORM (direct SQLite), no logger library (`console.log` to stdout), no validator library (manual checks). (docs/archive/PRD.md:1459-1465)
- No test framework beyond `node:test`, no HTTP client (no outbound HTTP), no mail vendor SDK (by design), no telemetry or analytics (by design), no CLI parsing library (`parseArgs` suffices). (docs/archive/PRD.md:1466-1472)

## 11. Operational requirements

### 11.1 Operator commitments

- Run their own server with Postfix installed and configured for outbound mail. (docs/archive/PRD.md:1480-1481)
- Set up SPF, DKIM and PTR records for the sending domain (one-time, documented in `OPS.md`). (docs/archive/PRD.md:1482-1483)
- Verify outbound port 25 is open, since some clouds block it. (docs/archive/PRD.md:1484-1484)
- Accept that this is the only email their service ever sends. (docs/archive/PRD.md:1485-1486)
- Pattern A: the source carries a self-correcting note that sessions are now in the library, so the operator does not manage them. (docs/archive/PRD.md:1487-1488)
- Pattern B: configure a reverse proxy for forward-auth, documented in `OPS.md`. (docs/archive/PRD.md:1489-1490)
- These commitments are documented prominently in `README.md` and `OPS.md`; the library does not pretend to be turnkey for operators uncomfortable with them. (docs/archive/PRD.md:1492-1494)

### 11.2 OPS.md scope

`OPS.md` MUST cover, for Ubuntu/Debian (docs/archive/PRD.md:1498-1498):

- Postfix install and minimal outbound-only config, plus a test command for SMTP submission to localhost. (docs/archive/PRD.md:1500-1501)
- SPF record format, DKIM key generation and DNS record, and PTR (reverse DNS) via the cloud provider. (docs/archive/PRD.md:1502-1504)
- Port 25 verification and the alternative if blocked; running `knowless-server` under systemd. (docs/archive/PRD.md:1505-1506)
- Caddy forward-auth (example protecting a service like Uptime Kuma), nginx `auth_request` and Traefik `forwardAuth` alternatives. (docs/archive/PRD.md:1507-1510)
- Tailscale/WireGuard pattern for connecting a VPS-hosted `knowless-server` back to home-server services. (docs/archive/PRD.md:1511-1512)
- Reverse-proxy rate limiting: sample Caddy and nginx configs for stricter abuse limits, as the place for layer-2 defences beyond the library's cheap baseline. (docs/archive/PRD.md:1513-1517)
- fail2ban / Cloudflare Turnstile setup as options for serious bot traffic, with honest caveats (accessibility, third-party dependency). (docs/archive/PRD.md:1518-1521)
- Optional: forward-confirmed reverse DNS, DMARC. (docs/archive/PRD.md:1522-1522)
- `OPS.md` contains no automation scripts; the operator does the ops, the project supplies checklist and sample configs. (docs/archive/PRD.md:1524-1525)

## 12. Threat model and risks

### 12.1 Honest threat model

The section is deliberately specific about what is and is not defended, because auth libraries tend to oversell. (docs/archive/PRD.md:1531-1533)

**Defends well against:**

- Database-only leaks: the DB holds opaque handles (HMAC outputs), hashed token IDs and session IDs; a read-only attacker learns user count, creation times and last-session times but cannot identify a user, replay a session or log in. (docs/archive/PRD.md:1537-1543)
- Plaintext exfiltration of email lists: emails are never stored in plaintext, so a dump cannot become a mailing list. (docs/archive/PRD.md:1545-1547)
- Password reuse, credential stuffing and weak passwords: there are no passwords. (docs/archive/PRD.md:1549-1553)
- Silent email enumeration via the login form: silent-on-miss with timing equivalence. (docs/archive/PRD.md:1555-1557)
- Email-bombing a target: the per-handle limit caps concurrent active magic links (default 5, newest replaces oldest). (docs/archive/PRD.md:1559-1563)
- Naive bot traffic: the honeypot field; bots that respect CSS hiding will not be caught. (docs/archive/PRD.md:1565-1568)
- Mild high-volume floods: per-IP login limit (default 30/hour); serious abuse should also be limited at the reverse proxy (OPS.md). (docs/archive/PRD.md:1570-1573)
- Account creation spam in open-registration mode: per-IP cap on new handles (default 3/hour). (docs/archive/PRD.md:1575-1577)

**Defends partially against:**

- HMAC secret leak alone: the attacker can confirm whether a specific email is registered but cannot enumerate all users or forge sessions without DB write access. (docs/archive/PRD.md:1581-1585)
- Phishing: not directly defended, but there is no password to type into a fake site, and a phished address still needs the magic link from the user's real inbox; this is a side-effect of the model. (docs/archive/PRD.md:1587-1592)

**Does NOT defend against:**

- Sophisticated bots that bypass the honeypot (CSS-parsing or headless browsers); needs CAPTCHA or bot management at the proxy. (docs/archive/PRD.md:1596-1599)
- Distributed floods from many IPs; needs broader reverse-proxy rate limiting (Cloudflare, fail2ban). (docs/archive/PRD.md:1601-1605)
- Full server compromise: root has the secret, DB and process and can forge any session. (docs/archive/PRD.md:1607-1611)
- Compromised email account: the attacker receives the magic links; the defence is the user's mail provider. (docs/archive/PRD.md:1613-1616)
- Social engineering such as forwarding or clicking a fake link. (docs/archive/PRD.md:1618-1619)
- Insider threat at the operator, who can read the DB and secret; mitigation is organizational. (docs/archive/PRD.md:1621-1624)
- DNS hijacking, MITM and BGP attacks: defended by HTTPS (which the library requires) and the operator's network hygiene. (docs/archive/PRD.md:1626-1628)

### 12.2 Specific risks

Each row gives likelihood, impact and mitigation. (docs/archive/PRD.md:1632-1644)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Magic links land in spam from poor operator mail setup (docs/archive/PRD.md:1634-1634) | High | Auth unreliable | Comprehensive OPS.md; README warning that deliverability is the operator's job |
| Silent-on-miss timing leak via subtle code change (docs/archive/PRD.md:1635-1635) | Medium | Identity enumeration | Automated timing test in CI; CLAUDE.md non-negotiable |
| Operator wants out-of-scope features and forks badly (docs/archive/PRD.md:1636-1636) | Medium | Fragmentation, security regressions in forks | Prominent NO-GO table; sibling-projects framing |
| Open redirect in redirect-after-login (docs/archive/PRD.md:1637-1637) | Medium | Phishing | Whitelist targets to cookie domain; security test |
| Session cookie scope misconfigured (docs/archive/PRD.md:1638-1638) | Medium | No SSO, or cookie sent to unexpected domains | Safe default (eTLD+1 of baseUrl); documented example |
| `nodemailer` vulnerability (docs/archive/PRD.md:1639-1639) | Low | Library inherits it | Single, well-maintained dep; monitor advisories |
| `node:sqlite` API changes between Node versions (docs/archive/PRD.md:1640-1640) | Low | Default store breaks | Pin Node 22+ minimum; document fallback |
| HMAC secret leaks without DB access (docs/archive/PRD.md:1641-1641) | Low | Email enumeration by guessing; sessions still safe | Document secret handling; env-var-only storage |
| HMAC secret AND DB both leak (docs/archive/PRD.md:1642-1642) | Low | Full identity exposure for known emails; session forgery | Defence in depth: keep secret out of DB, monitor both |
| Forward-auth misconfig allows unauthenticated access (docs/archive/PRD.md:1643-1643) | Medium | Protected service exposed | Sample configs in OPS.md; warnings about `error_pages` / fallback paths |
| Timing test statistically flawed, passes despite leak (docs/archive/PRD.md:1644-1644) | Low | False sense of security | Established statistical test; methodology documented in test file |

## 13. Open questions

These are deliberately surfaced for resolution before or during implementation, not silently decided. (docs/archive/PRD.md:1648-1649)

- **Q1.** Resolved (v0.10): the store interface exposes `deleteHandle(handle)` for GDPR right-to-erasure, not exposed as an HTTP handler so the operator chooses the UX; codified as FR-37a. (docs/archive/PRD.md:1651-1654)
- **Q2.** Should the library error when constructed without Postfix on localhost? A startup connection error is loud, lazy connection is silent until the first login; probably fail-fast at startup. (docs/archive/PRD.md:1655-1659)
- **Q3.** Should pending tokens per handle be capped to prevent inbox flooding? Probably yes: default 5, newest replacing oldest. (docs/archive/PRD.md:1660-1662)
- **Q4.** Should the `from` address support a display name (`"YourApp <noreply@yourapp.com>"`)? Probably yes, passed through to nodemailer. (docs/archive/PRD.md:1663-1665)
- **Q5.** Should the standalone server expose an admin endpoint for listing or revoking sessions? Probably no for v1; the operator can manage SQLite directly, and a `bin/knowless-admin` CLI in v0.2 is possible if requested. (docs/archive/PRD.md:1666-1670)
- **Q6.** Should the login form be customisable? Strictly hardcoded for v1; a single optional template file in v0.2 is possible if requested, but resisted as scope creep. (docs/archive/PRD.md:1671-1675)
