import crypto from 'node:crypto';
import { normalize, deriveHandle } from './handle.js';
import { issueToken, hashToken } from './token.js';
import { newSid, signSession, verifySessionSignature } from './session.js';
import { composeBody, validateSubject, validateBodyOverride } from './mailer.js';
import { renderLoginForm } from './form.js';
import {
  buildTrustedPeers,
  determineSourceIp,
  rateLimitExceeded,
  rateLimitIncrement,
} from './abuse.js';

const HOUR_MS = 60 * 60 * 1000;

const DEFAULTS = {
  cookieName: 'knowless_session',
  linkPath: '/auth/callback',
  loginPath: '/login',
  verifyPath: '/verify',
  logoutPath: '/logout',
  tokenTtlSeconds: 900,
  sessionTtlSeconds: 30 * 24 * 60 * 60,
  subject: 'Sign in',
  confirmationMessage:
    'Thanks. If <strong>{email}</strong> is registered, a sign-in link is on its way. Check your inbox in a few minutes.',
  includeLastLoginInEmail: true,
  openRegistration: false,
  maxActiveTokensPerHandle: 5,
  maxLoginRequestsPerIpPerHour: 30,
  maxNewHandlesPerIpPerHour: 3,
  honeypotFieldName: 'website',
  shamRecipient: 'null@knowless.invalid',
  trustedProxies: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
  failureRedirect: null,
  cookieSecure: true,
};

/**
 * Read a request body up to maxBytes. Returns the UTF-8 string.
 * Resolves with '' if the request never sent any data and ended.
 */
function readBody(req, maxBytes = 65_536) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        req.destroy(new Error('body too large'));
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseBody(raw, contentType) {
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  if (ct === 'application/json') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (ct === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return {};
}

function getCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

/**
 * Validate the request's Origin/Referer header against the cookie
 * domain whitelist per SPEC §7.3 Step 0 (AF-4.3, CSRF defense).
 *
 * - Both headers absent → allow (curl, fetch without CORS, programmatic
 *   clients). Browsers always send Origin on cross-origin POST.
 * - Either present → parse and require host == cookieDomain or
 *   .endsWith('.' + cookieDomain). Same whitelist as the next-URL
 *   check in §11.2.
 * - Unparseable URL or non-matching host → reject.
 *
 * Origin is preferred when both are present (it's harder to spoof and
 * more reliably set by browsers on POST).
 */
function validateOrigin(req, cookieDomain) {
  const origin = req.headers?.origin;
  const referer = req.headers?.referer ?? req.headers?.referrer;
  const candidate = origin ?? referer;
  if (!candidate) return true;
  if (typeof candidate !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) return false;
  const dom = cookieDomain.toLowerCase();
  return host === dom || host.endsWith('.' + dom);
}

/**
 * Validate the `next` URL per SPEC §11.2.
 * @param {string|null|undefined} rawNext
 * @param {string} baseUrl
 * @param {string} cookieDomain
 * @returns {string|null} canonical URL string, or null
 */
export function validateNextUrl(rawNext, baseUrl, cookieDomain) {
  if (typeof rawNext !== 'string' || rawNext.length === 0 || rawNext.length > 2048) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(rawNext, baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  const dom = cookieDomain.toLowerCase();
  if (host === dom || host.endsWith('.' + dom)) return parsed.toString();
  return null;
}

function sidHashOf(sid) {
  return crypto.createHash('sha256').update(Buffer.from(sid, 'base64url')).digest('hex');
}

/**
 * Build the knowless HTTP handlers. Each handler is framework-agnostic:
 * (req, res) => Promise<void> | void, where req/res match node:http.
 *
 * @param {object} args
 * @param {object} args.store    knowless store (from createStore)
 * @param {object} args.mailer   knowless mailer (from createMailer)
 * @param {object} args.config   merged config; see DEFAULTS for missing keys
 * @returns {{
 *   login: (req:any,res:any)=>Promise<void>,
 *   callback: (req:any,res:any)=>Promise<void>,
 *   verify: (req:any,res:any)=>void,
 *   logout: (req:any,res:any)=>Promise<void>,
 *   loginForm: (req:any,res:any)=>void,
 *   validateNextUrl: (raw:string)=>string|null
 * }}
 */
export function createHandlers({ store, mailer, config, events }) {
  // v0.2.1 operator-visibility hooks. All optional; treat missing as
  // no-ops so the handler hot path is identical for adopters who don't
  // wire them. The factory passes a fully-populated `events` object;
  // direct callers of createHandlers (tests / advanced wiring) may omit
  // it entirely.
  const noop = () => {};
  const ev = {
    shamHit: events?.shamHit ?? noop,
    rateLimitHit: events?.rateLimitHit ?? noop,
    onMailerSubmit: events?.onMailerSubmit ?? noop,
    onTransportFailure: events?.onTransportFailure ?? noop,
  };

  const cfg = { ...DEFAULTS, ...config };
  if (!cfg.secret) throw new Error('config.secret required');
  if (typeof cfg.secret !== 'string' || cfg.secret.length < 64) {
    throw new Error('config.secret must be ≥64 hex chars (32 bytes)');
  }
  if (!cfg.baseUrl) throw new Error('config.baseUrl required');
  if (!cfg.from) throw new Error('config.from required');
  if (!cfg.cookieDomain) {
    try {
      cfg.cookieDomain = new URL(cfg.baseUrl).hostname;
    } catch {
      throw new Error('config.baseUrl invalid');
    }
  }

  // Build once at handler creation; supports plain IPs and CIDRs (AF-6.3).
  const trustedProxies = buildTrustedPeers(cfg.trustedProxies);

  // AF-7.1: emit at most one warning per handler instance about an
  // upstream body parser swallowing the request body. Loud enough to
  // notice in dev, quiet enough not to spam.
  let emptyBodyWarned = false;
  function warnEmptyBodyOnce() {
    if (emptyBodyWarned) return;
    emptyBodyWarned = true;
    console.warn(
      '[knowless] POST /login received an empty body but Content-Length > 0. ' +
        'A body parser running ahead of this handler likely consumed the stream. ' +
        'knowless reads req itself; do not mount express.urlencoded() / express.json() / ' +
        'similar middleware in front of POST /login. (Warned once per instance.)',
    );
  }

  // SPEC §5.4 / FR-30: build the cookie-attribute suffix once. Secure is
  // emitted by default and omitted only when cookieSecure: false (localhost
  // dev). HttpOnly + SameSite=Lax are always set.
  const secureAttr = cfg.cookieSecure ? '; Secure' : '';
  const setCookieAttrs = `Domain=${cfg.cookieDomain}; Path=/; HttpOnly; SameSite=Lax`;

  function sameResponse(res, echoedEmail, next) {
    const html = renderLoginForm({
      loginPath: cfg.loginPath,
      honeypotName: cfg.honeypotFieldName,
      confirmationMessage: cfg.confirmationMessage,
      echoedEmail: echoedEmail ?? '',
      next: typeof next === 'string' ? next : '',
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(html);
  }

  function failureRedirect(res) {
    res.statusCode = 302;
    res.setHeader('Location', cfg.failureRedirect ?? cfg.loginPath);
    res.end();
  }

  /**
   * The 12-step sham-work flow, reusable by both POST /login and the
   * programmatic auth.startLogin() entry. Returns {handle, isSham} so
   * the form handler can drive its same-response and the programmatic
   * caller can return the handle to its caller. See SPEC §7.3 (form)
   * and §7.3a (programmatic). AF-7.3.
   *
   * Steps skipped depending on the entry point:
   *   - Origin (§7.3 Step 0): form-only; programmatic callers are
   *     trusted server-side code.
   *   - Honeypot (§7.3 Step 2): form-only; no form context.
   *
   * Both entries run steps 1, 3, 4–12 identically — so the timing-
   * equivalence guarantee (FR-6) holds for either.
   *
   * @returns {Promise<{handle: string|null, isSham: boolean,
   *                    emailNorm: string, nextValidated: string|null}>}
   *   handle is null only when the email failed to normalize (programmer
   *   bug for startLogin; same-shape silent for /login).
   */
  async function runSendLink({
    emailRaw,
    nextRaw,
    sourceIp,
    subject,
    bodyOverride,
    bypassRateLimit = false,
  }) {
    // Step 1: parse + normalize
    let emailNorm;
    try {
      emailNorm = normalize(emailRaw);
    } catch {
      return { handle: null, isSham: false, emailNorm: emailRaw, nextValidated: null };
    }

    // Step 3: per-IP rate limit on /login — exempt short-circuit.
    // AF-10: trusted server-side callers (CLI, cron, worker) opt out
    // of IP-based rate-limit accounting entirely — neither check nor
    // increment. Per-handle token cap (insertToken's maxActive) still
    // applies; only the IP buckets are bypassed.
    if (
      !bypassRateLimit &&
      rateLimitExceeded(
        store,
        'login_ip',
        sourceIp,
        cfg.maxLoginRequestsPerIpPerHour,
        HOUR_MS,
      )
    ) {
      ev.rateLimitHit();
      return { handle: null, isSham: false, emailNorm, nextValidated: null };
    }

    // ---- Equivalent-work region begins (SPEC §7.3 step 4) ----
    const handle = deriveHandle(emailNorm, cfg.secret);
    const nextValidated = validateNextUrl(nextRaw, cfg.baseUrl, cfg.cookieDomain);
    const exists = store.handleExists(handle);
    let isCreating = !exists && cfg.openRegistration;

    if (isCreating && !bypassRateLimit) {
      if (
        rateLimitExceeded(
          store,
          'create_ip',
          sourceIp,
          cfg.maxNewHandlesPerIpPerHour,
          HOUR_MS,
        )
      ) {
        // Cap exceeded — fall through to sham, do NOT short-circuit.
        // The fall-through becomes a sham-hit too; both counters
        // increment because they're independent dimensions (operator
        // can correlate from `rateLimited` jumping in lockstep with
        // `sham`).
        ev.rateLimitHit();
        isCreating = false;
      }
    }

    const expiresAt = Date.now() + cfg.tokenTtlSeconds * 1000;
    const token = issueToken();

    let toAddress;
    let lastLoginAt = null;
    let isSham;

    if (exists || isCreating) {
      if (isCreating) store.upsertHandle(handle);
      isSham = false;
      toAddress = emailNorm;
      if (cfg.includeLastLoginInEmail) {
        lastLoginAt = store.getLastLogin(handle);
      }
    } else {
      isSham = true;
      toAddress = cfg.shamRecipient;
      ev.shamHit();
    }

    const evicted = store.insertToken({
      tokenHash: token.hash,
      handle,
      expiresAt,
      nextUrl: nextValidated,
      isSham,
      maxActive: cfg.maxActiveTokensPerHandle,
    });
    // Per-handle token cap rotation is the third rate limit. Counted
    // here in the aggregate `rateLimited` window so operators see
    // hammering of a single handle without per-event identity leakage.
    if (evicted > 0) ev.rateLimitHit();

    // AF-26: per-call body override for startLogin (Mode A). When
    // provided, the adopter's template function receives the composed
    // magic-link URL and returns the full body text. Same submit path,
    // same sham work, same FR-6 timing equivalence — just lets adopters
    // phrase the body to match per-call subjects (pin confirmation,
    // login, expiry warning). bodyFooter still appends; lastLogin line
    // does not (override is full-content replacement).
    let mailBody;
    if (typeof bodyOverride === 'function') {
      const url = `${cfg.baseUrl}${cfg.linkPath}?t=${token.raw}`;
      const rendered = bodyOverride({ url });
      validateBodyOverride(rendered, url); // throws on invalid
      mailBody = rendered;
      if (cfg.bodyFooter) {
        mailBody += `\n-- \n${cfg.bodyFooter}\n`;
      }
    } else {
      mailBody = composeBody({
        tokenRaw: token.raw,
        baseUrl: cfg.baseUrl,
        linkPath: cfg.linkPath,
        lastLoginAt,
        bodyFooter: cfg.bodyFooter,
      });
    }

    // AF-9: programmatic callers may override the subject per call
    // (addypin sends confirmation / login / expiry-warning all via
    // magic links and needs distinct subjects). Decision happens
    // BEFORE the hit/miss branch — same subject for sham and real,
    // so timing equivalence is preserved.
    const effectiveSubject = subject ?? cfg.subject;
    try {
      const info = await mailer.submit({
        to: toAddress,
        subject: effectiveSubject,
        body: mailBody,
      });
      // v0.2.1: per-event hook on real (non-sham) submissions only.
      // Sham branches go through the windowed aggregate; emitting them
      // per-event here would let a careless adopter log per-handle
      // data and reopen the enumeration oracle that sham-work exists
      // to prevent.
      if (!isSham) {
        ev.onMailerSubmit({
          messageId: info?.messageId ?? null,
          handle,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      // Per NFR-10: SMTP failure logged, NEVER leaked to response shape.
      console.error('[knowless] mail submit failed:', err.message);
      // v0.2.1: per-event hook for SMTP failures. Carries no identity
      // data, safe per-event. Operator wires this to alerting.
      ev.onTransportFailure({ error: err, timestamp: Date.now() });
      // AF-6.2: dev-mode fallback. When SMTP is unreachable in local
      // development the operator otherwise has no way to obtain the magic
      // link. Print it to stderr only when explicitly opted in.
      if (cfg.devLogMagicLinks) {
        // AF-7.6: include `from` to disambiguate multi-instance logs.
        const tag = `[knowless dev:${cfg.from}]`;
        if (isSham) {
          // AF-7.2 dev hint: silent-miss is by-design but in dev mode
          // operators repeatedly debug "why no link?" — surface the
          // reason. Only fires on opt-in dev mode + SMTP failure.
          process.stderr.write(
            `${tag} silent-miss: handle for "${emailNorm}" does not exist (openRegistration=${cfg.openRegistration})\n`,
          );
        } else {
          const link = `${cfg.baseUrl}${cfg.linkPath}?t=${token.raw}`;
          process.stderr.write(`${tag} magic link: ${link}\n`);
        }
      }
    }

    if (!bypassRateLimit) {
      rateLimitIncrement(store, 'login_ip', sourceIp, HOUR_MS);
      if (isCreating) rateLimitIncrement(store, 'create_ip', sourceIp, HOUR_MS);
    }

    return { handle, isSham, emailNorm, nextValidated };
  }

  async function login(req, res) {
    // Step 0 — Origin / Referer validation (SPEC §7.3 Step 0, AF-4.3).
    if (!validateOrigin(req, cfg.cookieDomain)) {
      sameResponse(res, '', '');
      return;
    }

    let raw;
    try {
      raw = await readBody(req);
    } catch {
      sameResponse(res, '', '');
      return;
    }
    // AF-7.1: warn when a body parser ahead of us has consumed the stream.
    // POST /login with Content-Length > 0 but empty raw body is the
    // signature; without this, the request silently null-routes and the
    // adopter loses 30 minutes wondering why magic links never arrive.
    if (raw.length === 0) {
      const cl = Number(req.headers?.['content-length']);
      if (Number.isFinite(cl) && cl > 0) {
        warnEmptyBodyOnce();
      }
    }
    const body = parseBody(raw, req.headers['content-type']);
    const emailRaw = typeof body.email === 'string' ? body.email : '';
    const honeypot = body[cfg.honeypotFieldName];
    const nextRaw = body.next;

    // Step 2: honeypot — exempt short-circuit (no sham work)
    if (typeof honeypot === 'string' && honeypot.length > 0) {
      sameResponse(res, emailRaw, nextRaw);
      return;
    }

    const sourceIp = determineSourceIp(req, trustedProxies);
    const result = await runSendLink({ emailRaw, nextRaw, sourceIp });
    sameResponse(res, result.emailNorm, result.nextValidated ?? '');
  }

  async function startLogin({
    email,
    nextUrl,
    sourceIp = '',
    subjectOverride,
    bodyOverride,
    bypassRateLimit = false,
  } = {}) {
    // Programmer-error guards (AF-7.3). These DO throw; they're not
    // silent-miss conditions, they're "you called the API wrong."
    if (typeof email !== 'string' || email.length === 0) {
      throw new Error('startLogin: email is required (string)');
    }
    if (nextUrl !== undefined && nextUrl !== null && typeof nextUrl !== 'string') {
      throw new Error('startLogin: nextUrl must be a string when provided');
    }
    if (typeof sourceIp !== 'string') {
      throw new Error('startLogin: sourceIp must be a string when provided');
    }
    if (typeof bypassRateLimit !== 'boolean') {
      throw new Error('startLogin: bypassRateLimit must be a boolean when provided');
    }
    // AF-9: per-call subject override. Validated with the same rules as
    // the factory subject (ASCII, ≤60 chars, no CR/LF). Throws on
    // invalid — same "programmer-error" treatment as other startLogin
    // arg validation. Spam-trigger warnings are NOT thrown for; the
    // caller has more context than knowless about what's appropriate.
    let subject;
    if (subjectOverride !== undefined && subjectOverride !== null) {
      validateSubject(subjectOverride); // throws on invalid
      subject = subjectOverride;
    }
    // AF-26: per-call body override. The function is called inside
    // runSendLink with the composed magic-link URL; its return value
    // is validated by validateBodyOverride(). The arg-type check
    // happens here at the API edge so a non-function bodyOverride
    // fails fast, before any token is minted.
    if (bodyOverride !== undefined && bodyOverride !== null && typeof bodyOverride !== 'function') {
      throw new Error('startLogin: bodyOverride must be a function when provided');
    }
    const { handle } = await runSendLink({
      emailRaw: email,
      nextRaw: nextUrl ?? null,
      sourceIp,
      subject,
      bodyOverride,
      bypassRateLimit,
    });
    // Same-shape return: rate-limit / sham / real all collapse here.
    // `handle` is the HMAC of the normalized email (or null if email
    // was malformed). It leaks nothing about existence per FR-6.
    return { handle, submitted: true };
  }

  async function callback(req, res) {
    const url = new URL(req.url, cfg.baseUrl);
    const rawToken = url.searchParams.get('t');
    const hash = hashToken(rawToken);
    if (!hash) {
      failureRedirect(res);
      return;
    }
    const row = store.getToken(hash);
    if (
      !row ||
      row.usedAt != null ||
      row.expiresAt <= Date.now() ||
      row.isSham === true
    ) {
      failureRedirect(res);
      return;
    }
    if (!store.markTokenUsed(hash, Date.now())) {
      // Lost a race with a concurrent redemption.
      failureRedirect(res);
      return;
    }
    store.upsertLastLogin(row.handle, Date.now());

    const sid = newSid();
    const expiresAt = Date.now() + cfg.sessionTtlSeconds * 1000;
    store.insertSession(sidHashOf(sid), row.handle, expiresAt);
    const cookie = signSession(sid, cfg.secret);

    res.statusCode = 302;
    res.setHeader(
      'Set-Cookie',
      `${cfg.cookieName}=${cookie}; ${setCookieAttrs}; Max-Age=${cfg.sessionTtlSeconds}${secureAttr}`,
    );
    res.setHeader('Location', row.nextUrl ?? `${cfg.baseUrl}/`);
    res.end();
  }

  /**
   * Programmatic session resolution per SPEC §9.4. Reads the
   * configured cookie from the request, validates its signature,
   * looks up the session row, and returns the handle. Returns
   * null on any failure (missing/malformed cookie, signature
   * mismatch, expired session, no row). Recommended integration
   * point for in-process middleware. Closes AF-2.8.
   *
   * @param {{ headers?: { cookie?: string } }} req
   * @returns {string | null}
   */
  function handleFromRequest(req) {
    const cookie = getCookie(req, cfg.cookieName);
    if (!cookie) return null;
    const sid = verifySessionSignature(cookie, cfg.secret);
    if (!sid) return null;
    const row = store.getSession(sidHashOf(sid));
    if (!row || row.expiresAt <= Date.now()) return null;
    return row.handle;
  }

  function verify(req, res) {
    const handle = handleFromRequest(req);
    if (!handle) {
      res.statusCode = 401;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('X-User-Handle', handle);
    res.end();
  }

  async function logout(req, res) {
    // CSRF defense — same Origin/Referer check as POST /login (AF-4.3).
    // Without this, a third-party page can force-logout a victim. Closes
    // AF-6.4. Browser-absent (curl/programmatic) is allowed.
    if (!validateOrigin(req, cfg.cookieDomain)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('forbidden\n');
      return;
    }
    const cookie = getCookie(req, cfg.cookieName);
    if (cookie) {
      const sid = verifySessionSignature(cookie, cfg.secret);
      if (sid) store.deleteSession(sidHashOf(sid));
    }
    res.statusCode = 200;
    res.setHeader(
      'Set-Cookie',
      `${cfg.cookieName}=; ${setCookieAttrs}; Max-Age=0${secureAttr}`,
    );
    res.end();
  }

  function loginForm(req, res) {
    const url = new URL(req.url || '/', cfg.baseUrl);
    const next = url.searchParams.get('next');
    const html = renderLoginForm({
      loginPath: cfg.loginPath,
      honeypotName: cfg.honeypotFieldName,
      next: next ?? undefined,
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(html);
  }

  return {
    login,
    callback,
    verify,
    logout,
    loginForm,
    handleFromRequest,
    startLogin,
    validateNextUrl: (raw) => validateNextUrl(raw, cfg.baseUrl, cfg.cookieDomain),
    // exposed for tests
    _config: cfg,
  };
}
