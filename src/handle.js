import crypto from 'node:crypto';

/**
 * Email syntax accepted by knowless. Strict ASCII-only; no quoted-locals,
 * no IP-literal domains, no IDN. See SPEC §2.1.
 */
const EMAIL_REGEX = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;

/**
 * Normalize an email address per SPEC §2.1. Trim, ASCII-lowercase, reject
 * non-ASCII, validate against the strict regex.
 *
 * @param {string} input
 * @returns {string} normalized, validated, lowercase ASCII email
 * @throws {Error} on any invalid input — caller treats as silent miss
 */
export function normalize(input) {
  if (typeof input !== 'string') throw new Error('invalid email');
  const trimmed = input.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
  if (trimmed.length === 0 || trimmed.length > 254) throw new Error('invalid email');
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charCodeAt(i) > 0x7f) throw new Error('invalid email');
  }
  const lowered = trimmed.toLowerCase();
  if (!EMAIL_REGEX.test(lowered)) throw new Error('invalid email');
  return lowered;
}

/**
 * Coerce an operator-supplied secret to the raw bytes used as HMAC key.
 *
 * AF-8.1: knowless requires `secret` to be a 64-char lowercase hex
 * string (32 bytes). Prior versions passed it to `createHmac` as an
 * ASCII string — same 256 bits of entropy, but a different HMAC
 * output than systems that hex-decode first. That meant adopters
 * with existing HMAC-keyed identifiers couldn't interoperate. The
 * fix is to hex-decode at the boundary so HMAC uses 32 raw bytes.
 *
 * @param {Buffer|string} secret
 * @returns {Buffer} 32 raw bytes
 */
export function secretBytes(secret) {
  if (Buffer.isBuffer(secret)) return secret;
  if (typeof secret !== 'string') throw new Error('secret required');
  if (!/^[a-f0-9]{64,}$/i.test(secret)) {
    throw new Error('secret must be ≥64 hex chars (lowercase a-f, 0-9)');
  }
  return Buffer.from(secret, 'hex');
}

/**
 * Derive the opaque handle for a normalized email using the operator secret.
 * HMAC-SHA256, lowercase hex output, 64 chars. See SPEC §3.
 *
 * The handle is grandfathered without a domain-separation tag. Any future
 * HMAC use of `secret` MUST add a tag prefix (see SPEC §3.4).
 *
 * @param {string} emailNormalized output of normalize()
 * @param {Buffer|string} secret operator HMAC secret (32+ raw bytes or ≥64 hex chars)
 * @returns {string} 64-char lowercase hex handle
 */
export function deriveHandle(emailNormalized, secret) {
  if (typeof emailNormalized !== 'string' || emailNormalized.length === 0) {
    throw new Error('emailNormalized required');
  }
  return crypto
    .createHmac('sha256', secretBytes(secret))
    .update(emailNormalized, 'utf8')
    .digest('hex');
}
