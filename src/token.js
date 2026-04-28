import crypto from 'node:crypto';

/**
 * Issue a magic-link token per SPEC §4.1.
 *
 * Returns the raw token (for embedding in the email URL) and the hash
 * (for storage). Raw bytes never touch persistent storage; only the
 * hash does. See FR-13, FR-34.
 *
 * @returns {{ raw: string, hash: string }}
 *   raw  — 43-char base64url (32 bytes, no padding)
 *   hash — 64-char lowercase hex (SHA-256 of the 32 raw bytes)
 */
export function issueToken() {
  const bytes = crypto.randomBytes(32);
  return {
    raw: bytes.toString('base64url'),
    hash: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * Hash a raw token for store lookup per SPEC §4.5.
 *
 * Returns null on malformed input (wrong length, wrong alphabet, decode
 * fail). Caller treats null exactly like "no row found" — the silent
 * failure path of verifyToken.
 *
 * @param {string} raw 43-char base64url token from a magic link
 * @returns {string|null} 64-char lowercase hex hash, or null
 */
export function hashToken(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 64) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const bytes = Buffer.from(raw, 'base64url');
  if (bytes.length !== 32) return null;
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
