import { createStore } from './store.js';
import { createMailer } from './mailer.js';
import { createHandlers } from './handlers.js';

/** Default sweeper tick: 5 minutes. Per FR-13. */
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Default rate-limit retention: 24 hours past window-start. */
const DEFAULT_RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

const REQUIRED_FIELDS = ['secret', 'baseUrl', 'from'];

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
 *   deleteHandle: (handle: string) => void,
 *   config: object,
 *   close: () => void,
 * }}
 */
export function knowless(options = {}) {
  for (const f of REQUIRED_FIELDS) {
    if (!options[f]) throw new Error(`knowless: ${f} is required`);
  }
  if (typeof options.secret !== 'string' || options.secret.length < 64) {
    throw new Error('knowless: secret must be at least 64 hex chars (32 bytes)');
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

  const handlers = createHandlers({ store, mailer, config: options });

  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const sweepTimer = setInterval(() => {
    try {
      const now = Date.now();
      store.sweepTokens(now);
      store.sweepSessions(now);
      store.sweepRateLimits(now - DEFAULT_RATE_LIMIT_RETENTION_MS);
    } catch (err) {
      console.error('[knowless] sweep failed:', err.message);
    }
  }, sweepIntervalMs);
  // Don't keep the event loop alive just for the sweeper.
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

  return {
    login: handlers.login,
    callback: handlers.callback,
    verify: handlers.verify,
    logout: handlers.logout,
    loginForm: handlers.loginForm,
    /** Delete a handle + all tokens + all sessions atomically (FR-37a). */
    deleteHandle: (handle) => store.deleteHandle(handle),
    /** Effective config (with defaults applied), useful for routing. */
    config: handlers._config,
    close() {
      clearInterval(sweepTimer);
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
export { createMailer, composeBody, validateSubject } from './mailer.js';
export { createHandlers } from './handlers.js';
export { renderLoginForm } from './form.js';
export { normalize, deriveHandle } from './handle.js';
