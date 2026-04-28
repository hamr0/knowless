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
 * Derive the opaque handle for a normalized email using the operator secret.
 * HMAC-SHA256, lowercase hex output, 64 chars. See SPEC §3.
 *
 * The handle is grandfathered without a domain-separation tag. Any future
 * HMAC use of `secret` MUST add a tag prefix (see SPEC §3.4).
 *
 * @param {string} emailNormalized output of normalize()
 * @param {Buffer|string} secret operator HMAC secret
 * @returns {string} 64-char lowercase hex handle
 */
export function deriveHandle(emailNormalized, secret) {
  if (typeof emailNormalized !== 'string' || emailNormalized.length === 0) {
    throw new Error('emailNormalized required');
  }
  if (!secret || (typeof secret !== 'string' && !Buffer.isBuffer(secret))) {
    throw new Error('secret required');
  }
  return crypto
    .createHmac('sha256', secret)
    .update(emailNormalized, 'utf8')
    .digest('hex');
}
