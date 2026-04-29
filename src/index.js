import { createStore } from './store.js';
import { createMailer, validateBodyFooter } from './mailer.js';
import { createHandlers } from './handlers.js';
import { deriveHandle as deriveHandleRaw, normalize } from './handle.js';

/** Default sweeper tick: 5 minutes. Per FR-13. */
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Default rate-limit retention: 24 hours past window-start. */
const DEFAULT_RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Default suppression-window cadence: 60 seconds. v0.2.1. */
const DEFAULT_SUPPRESSION_WINDOW_MS = 60 * 1000;

const REQUIRED_FIELDS = ['secret', 'baseUrl', 'from'];

/**
 * Wrap a user-supplied hook so its errors are caught and swallowed.
 * Matches the `onSweepError` contract: knowless never crashes because
 * an operator's observability sink threw.
 */
function safeHook(fn, label) {
  if (typeof fn !== 'function') return () => {};
  return (arg) => {
    try {
      fn(arg);
    } catch (err) {
      console.error(`[knowless] ${label} hook threw:`, err?.message ?? err);
    }
  };
}

/**
 * @typedef {Object} KnowlessOptions
 * @property {string} secret           HMAC secret, ≥64 hex chars (32 bytes). FR-47, FR-48.
 * @property {string} baseUrl          Public base URL for magic links.
 * @property {string} from             Sender email address.
 * @property {string} [dbPath='./knowless.db']
 * @property {string} [cookieDomain]   Defaults to baseUrl's hostname.
 * @property {number} [tokenTtlSeconds=900]
 * @property {number} [sessionTtlSeconds=2592000]
 * @property {string} [linkPath='/auth/callback']
 * @property {string} [loginPath='/login']
 * @property {string} [verifyPath='/verify']
 * @property {string} [logoutPath='/logout']
 * @property {string} [smtpHost='localhost']
 * @property {number} [smtpPort=25]
 * @property {boolean} [openRegistration=false]
 * @property {string} [subject='Sign in']
 * @property {string} [confirmationMessage]
 * @property {boolean} [includeLastLoginInEmail=true]
 * @property {number} [maxActiveTokensPerHandle=5]
 * @property {number} [maxLoginRequestsPerIpPerHour=30]
 * @property {number} [maxNewHandlesPerIpPerHour=3]
 * @property {string} [honeypotFieldName='website']
 * @property {string[]} [trustedProxies]
 * @property {string} [shamRecipient='null@knowless.invalid']  See SPEC §7.4.
 * @property {number} [sweepIntervalMs]    Sweeper tick; defaults to 5 minutes.
 * @property {function} [onSweepError]     Optional alerting hook for sweep failures.
 * @property {function} [onMailerSubmit]   v0.2.1. Per-event hook fired on
 *   successful mail submission for *real* (non-sham) sends only. Payload:
 *   `{messageId, handle, timestamp}`. Errors are caught and swallowed.
 * @property {function} [onTransportFailure]  v0.2.1. Per-event hook fired
 *   on SMTP errors. Payload: `{error, timestamp}`. Errors swallowed.
 * @property {function} [onSuppressionWindow] v0.2.1. Heartbeat hook fired
 *   every `suppressionWindowMs` with aggregate counters. Payload:
 *   `{sham, rateLimited, windowMs}`. Aggregates the silent-202 branches
 *   (sham + rate-limit hits) without per-event identity disclosure;
 *   see knowless.context.md § "v0.2.1 design" for the threat-model
 *   reasoning. Fires even when both counters are zero (heartbeat).
 *   Errors swallowed.
 * @property {number} [suppressionWindowMs=60000]  v0.2.1. Cadence of
 *   `onSuppressionWindow` emissions. Default 60 seconds.
 * @property {object} [store]              Inject your own store implementation.
 * @property {object} [mailer]             Inject your own mailer.
 * @property {object} [transportOverride]  Pass to nodemailer.createTransport (tests).
 */

/**
 * The knowless factory. Call once at startup, mount the returned handlers
 * on your HTTP framework, and call .close() at shutdown.
 *
 * Six-line library-mode example:
 * ```js
 * import { knowless } from 'knowless';
 * const auth = knowless({ secret, baseUrl, from });
 * app.get(auth.config.loginPath, auth.loginForm);
 * app.post(auth.config.loginPath, auth.login);
 * app.get(auth.config.linkPath, auth.callback);
 * app.get(auth.config.verifyPath, auth.verify);
 * app.post(auth.config.logoutPath, auth.logout);
 * ```
 *
 * @param {KnowlessOptions} options
 * @returns {{
 *   login: Function,
 *   callback: Function,
 *   verify: Function,
 *   logout: Function,
 *   loginForm: Function,
 *   handleFromRequest: (req: any) => string | null,
 *   deleteHandle: (handle: string) => void,
 *   revokeSessions: (handle: string) => number,
 *   startLogin: (args: object) => Promise<{handle: string|null, submitted: true}>,
 *   deriveHandle: (email: string) => string,
 *   verifyTransport: () => Promise<true>,
 *   config: object,
 *   close: () => void,
 * }}
 */
export function knowless(options = {}) {
  for (const f of REQUIRED_FIELDS) {
    if (!options[f]) throw new Error(`knowless: ${f} is required`);
  }
  if (typeof options.secret !== 'string' || !/^[a-f0-9]{64,}$/i.test(options.secret)) {
    throw new Error('knowless: secret must be at least 64 hex chars (32 bytes, lowercase a-f, 0-9)');
  }
  // Validate operator-supplied body footer at startup (AF-8.2).
  if (options.bodyFooter !== undefined && options.bodyFooter !== null) {
    validateBodyFooter(options.bodyFooter);
  }

  // SPEC §5.4: cookieSecure: false is allowed only for localhost dev.
  // The library can't tell whether the operator is in production, but a
  // visible warning makes it harder to ship by accident.
  if (options.cookieSecure === false) {
    console.warn(
      '[knowless] WARNING: cookieSecure is false. Session cookies will be set without the Secure flag. ' +
        'This is only safe for http://localhost development. Never deploy with cookieSecure: false.',
    );
  }

  const store = options.store ?? createStore(options.dbPath ?? './knowless.db');

  const mailer =
    options.mailer ??
    createMailer({
      from: options.from,
      smtpHost: options.smtpHost,
      smtpPort: options.smtpPort,
      transportOverride: options.transportOverride,
    });

  // v0.2.1 operator-visibility hooks. All optional. Validate types up
  // front so a typo is caught at startup, not on the first hit.
  for (const k of ['onMailerSubmit', 'onTransportFailure', 'onSuppressionWindow']) {
    if (options[k] !== undefined && typeof options[k] !== 'function') {
      throw new Error(`knowless: ${k} must be a function when provided`);
    }
  }
  const suppressionWindowMs =
    options.suppressionWindowMs ?? DEFAULT_SUPPRESSION_WINDOW_MS;
  if (
    typeof suppressionWindowMs !== 'number' ||
    !Number.isFinite(suppressionWindowMs) ||
    suppressionWindowMs <= 0
  ) {
    throw new Error('knowless: suppressionWindowMs must be a positive number');
  }

  // Counters reset every windowMs. Aggregating sham + rate-limit
  // branches behind a windowed counter (rather than per-event hooks)
  // is the deliberate design — see knowless.context.md § "Why three
  // hooks, not four" for the threat-model justification.
  let shamCount = 0;
  let rateLimitedCount = 0;
  const onMailerSubmit = safeHook(options.onMailerSubmit, 'onMailerSubmit');
  const onTransportFailure = safeHook(options.onTransportFailure, 'onTransportFailure');
  const onSuppressionWindow = safeHook(options.onSuppressionWindow, 'onSuppressionWindow');

  const events = {
    shamHit: () => { shamCount++; },
    rateLimitHit: () => { rateLimitedCount++; },
    onMailerSubmit,
    onTransportFailure,
  };

  const handlers = createHandlers({ store, mailer, config: options, events });

  // The window timer fires every windowMs as a heartbeat — emits even
  // when both counters are zero. Operators rely on the heartbeat as a
  // liveness signal ("knowless is processing"); a missing emission is
  // itself diagnostic. Only run the timer when the hook is wired so we
  // don't spend a setInterval slot on adopters who don't use it.
  let suppressionTimer = null;
  if (typeof options.onSuppressionWindow === 'function') {
    suppressionTimer = setInterval(() => {
      const sham = shamCount;
      const rateLimited = rateLimitedCount;
      shamCount = 0;
      rateLimitedCount = 0;
      onSuppressionWindow({ sham, rateLimited, windowMs: suppressionWindowMs });
    }, suppressionWindowMs);
    if (typeof suppressionTimer.unref === 'function') suppressionTimer.unref();
  }

  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const onSweepError = options.onSweepError;
  // Extract the sweep body so tests / operators can trigger it without
  // waiting for the interval. Closes AF-5.3.
  function runSweep() {
    try {
      const now = Date.now();
      store.sweepTokens(now);
      store.sweepSessions(now);
      store.sweepRateLimits(now - DEFAULT_RATE_LIMIT_RETENTION_MS);
    } catch (err) {
      console.error('[knowless] sweep failed:', err.message);
      if (typeof onSweepError === 'function') {
        // Hook errors are swallowed — alerting is best-effort and MUST
        // NOT crash the sweep loop. Operator's hook can fail; sweeper
        // continues.
        try {
          onSweepError(err);
        } catch {
          /* intentional */
        }
      }
    }
  }
  const sweepTimer = setInterval(runSweep, sweepIntervalMs);
  // Don't keep the event loop alive just for the sweeper.
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

  return {
    login: handlers.login,
    callback: handlers.callback,
    verify: handlers.verify,
    logout: handlers.logout,
    loginForm: handlers.loginForm,
    /** Resolve handle from request cookie programmatically (SPEC §9.4). */
    handleFromRequest: handlers.handleFromRequest,
    /** Delete a handle + all tokens + all sessions atomically (FR-37a). */
    deleteHandle: (handle) => store.deleteHandle(handle),
    /** Revoke every session for `handle` without deleting the handle.
     *  "Log out everywhere." Returns the number of sessions removed.
     *  AF-6.1. */
    revokeSessions: (handle) => store.revokeSessions(handle),
    /** Programmatic magic-link send. Use this for "use first, claim
     *  later" UX flows (drop a pin, post a comment, then confirm via
     *  email). Returns `{handle, submitted: true}` — same shape on
     *  rate-limit / sham / real to preserve FR-6 timing equivalence.
     *  See SPEC §7.3a. AF-7.3. */
    startLogin: handlers.startLogin,
    /** Derive the opaque handle for an email using the configured
     *  secret. Normalizes the email first (AF-13) so handles match
     *  what `auth.startLogin` and `POST /login` would compute for the
     *  same address typed with different casing or surrounding
     *  whitespace. Adopters should treat this as the canonical handle
     *  derivation. AF-7.4 / AF-13. */
    deriveHandle: (email) => deriveHandleRaw(normalize(email), options.secret),
    /** Effective config (with defaults applied), useful for routing. */
    config: handlers._config,
    /** Run a sweep tick on demand. Useful for tests and operator scripts. */
    _sweep: runSweep,
    /** Probe the configured SMTP transport (v0.2.1). Resolves true on
     *  success, rejects with the underlying error. Opt-in fail-fast for
     *  adopters who want to validate SMTP at boot; no auto-on-boot
     *  variant by design — k8s readiness probes / docker-compose
     *  ordering would fail boot for the wrong reason. */
    verifyTransport: () => mailer.verify(),
    close() {
      clearInterval(sweepTimer);
      if (suppressionTimer !== null) clearInterval(suppressionTimer);
      try {
        mailer.close?.();
      } catch {
        /* tolerate already-closed transports */
      }
      store.close();
    },
  };
}

export { createStore } from './store.js';
export {
  createMailer,
  composeBody,
  validateSubject,
  validateBodyFooter,
  validateBodyOverride,
} from './mailer.js';
export { createHandlers } from './handlers.js';
export { renderLoginForm } from './form.js';
export { normalize, deriveHandle, secretBytes } from './handle.js';
