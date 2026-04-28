import crypto from 'node:crypto';
import { normalize, deriveHandle } from './handle.js';
import { issueToken, hashToken } from './token.js';
import { newSid, signSession, verifySessionSignature } from './session.js';
import { composeBody } from './mailer.js';
import { renderLoginForm } from './form.js';
import {
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
export function createHandlers({ store, mailer, config }) {
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

  const trustedProxies = new Set(cfg.trustedProxies);

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

  async function login(req, res) {
    let raw;
    try {
      raw = await readBody(req);
    } catch {
      sameResponse(res, '', '');
      return;
    }
    const body = parseBody(raw, req.headers['content-type']);
    const emailRaw = typeof body.email === 'string' ? body.email : '';
    const honeypot = body[cfg.honeypotFieldName];
    const nextRaw = body.next;

    // Step 1: parse + normalize
    let emailNorm;
    try {
      emailNorm = normalize(emailRaw);
    } catch {
      sameResponse(res, emailRaw, nextRaw);
      return;
    }

    // Step 2: honeypot — exempt short-circuit (no sham work)
    if (typeof honeypot === 'string' && honeypot.length > 0) {
      sameResponse(res, emailNorm, nextRaw);
      return;
    }

    // Step 3: per-IP rate limit on /login — exempt short-circuit
    const ip = determineSourceIp(req, trustedProxies);
    if (
      rateLimitExceeded(
        store,
        'login_ip',
        ip,
        cfg.maxLoginRequestsPerIpPerHour,
        HOUR_MS,
      )
    ) {
      sameResponse(res, emailNorm, nextRaw);
      return;
    }

    // ---- Equivalent-work region begins (SPEC §7.3 step 4) ----
    const handle = deriveHandle(emailNorm, cfg.secret);
    const nextValidated = validateNextUrl(nextRaw, cfg.baseUrl, cfg.cookieDomain);
    const exists = store.handleExists(handle);
    let isCreating = !exists && cfg.openRegistration;

    if (isCreating) {
      if (
        rateLimitExceeded(
          store,
          'create_ip',
          ip,
          cfg.maxNewHandlesPerIpPerHour,
          HOUR_MS,
        )
      ) {
        // Cap exceeded — fall through to sham, do NOT short-circuit.
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
    }

    store.insertToken({
      tokenHash: token.hash,
      handle,
      expiresAt,
      nextUrl: nextValidated,
      isSham,
      maxActive: cfg.maxActiveTokensPerHandle,
    });

    const mailBody = composeBody({
      tokenRaw: token.raw,
      baseUrl: cfg.baseUrl,
      linkPath: cfg.linkPath,
      lastLoginAt,
    });

    try {
      await mailer.submit({ to: toAddress, subject: cfg.subject, body: mailBody });
    } catch (err) {
      // Per NFR-10: SMTP failure logged, NEVER leaked to response shape.
      console.error('[knowless] mail submit failed:', err.message);
    }

    rateLimitIncrement(store, 'login_ip', ip, HOUR_MS);
    if (isCreating) rateLimitIncrement(store, 'create_ip', ip, HOUR_MS);

    sameResponse(res, emailNorm, nextValidated ?? '');
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
    validateNextUrl: (raw) => validateNextUrl(raw, cfg.baseUrl, cfg.cookieDomain),
    // exposed for tests
    _config: cfg,
  };
}
