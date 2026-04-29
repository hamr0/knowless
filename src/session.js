import crypto from 'node:crypto';
import { secretBytes } from './handle.js';

/**
 * Domain-separation tag for session signatures. See SPEC §3.4 / §5.2.
 * The trailing 0x00 prevents prefix-collision with future HMAC uses
 * of the same secret.
 */
const SESS_TAG = Buffer.from('sess\x00');

/**
 * Generate a new session id: 32 random bytes, base64url-encoded.
 * @returns {string} 43-char base64url
 */
export function newSid() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * @param {string} sidB64u
 * @param {Buffer|string} secret
 * @returns {string} 64-char lowercase hex
 */
function signature(sidB64u, secret) {
  return crypto
    .createHmac('sha256', secretBytes(secret))
    .update(SESS_TAG)
    .update(sidB64u, 'utf8')
    .digest('hex');
}

/**
 * Sign a sid into a session cookie value per SPEC §5.1.
 * Cookie format: <sid_b64u>.<sig_hex> (108 chars total).
 *
 * @param {string} sidB64u 43-char base64url sid (typically from newSid())
 * @param {Buffer|string} secret operator HMAC secret
 * @returns {string} cookie value
 */
export function signSession(sidB64u, secret) {
  if (typeof sidB64u !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sidB64u)) {
    throw new Error('invalid sid');
  }
  return `${sidB64u}.${signature(sidB64u, secret)}`;
}

/**
 * Verify a cookie value's signature per SPEC §5.5.
 * Returns the sid_b64u string on success; null on any failure (bad
 * format, signature mismatch, malformed inputs). Caller does the
 * DB lookup that resolves sid → handle.
 *
 * Constant-time comparison via crypto.timingSafeEqual.
 *
 * @param {string} cookie cookie value: <sid>.<sig>
 * @param {Buffer|string} secret operator HMAC secret
 * @returns {string|null}
 */
export function verifySessionSignature(cookie, secret) {
  if (typeof cookie !== 'string' || cookie.length === 0) return null;
  const dot = cookie.indexOf('.');
  if (dot < 0) return null;
  const sidB64u = cookie.slice(0, dot);
  const sigHex = cookie.slice(dot + 1);
  if (sigHex.length !== 64) return null;
  if (!/^[a-f0-9]{64}$/.test(sigHex)) return null;
  if (sidB64u.length === 0 || !/^[A-Za-z0-9_-]+$/.test(sidB64u)) return null;
  const expected = signature(sidB64u, secret);
  const a = Buffer.from(sigHex, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (!crypto.timingSafeEqual(a, b)) return null;
  return sidB64u;
}
