/**
 * Determine the source IP of a request per FR-42 and SPEC §7.6.
 *
 * If the request's connection peer is in `trustedProxies`, honour the
 * `X-Forwarded-For` (first element) or `X-Real-IP` header. Otherwise
 * fall back to the connection's remote address. This prevents IP
 * spoofing from clients while supporting forward-auth deployments.
 *
 * @param {{
 *   socket?: { remoteAddress?: string },
 *   connection?: { remoteAddress?: string },
 *   headers?: Record<string, string|string[]|undefined>
 * }} req a node:http request (or shape-compatible)
 * @param {Set<string>|string[]} trustedProxies set or array of trusted peer IPs
 * @returns {string} the determined IP, or '' if undeterminable
 */
export function determineSourceIp(req, trustedProxies) {
  const peer =
    req?.socket?.remoteAddress ?? req?.connection?.remoteAddress ?? '';
  const trusted =
    trustedProxies instanceof Set ? trustedProxies : new Set(trustedProxies ?? []);
  if (!trusted.has(peer)) {
    return peer;
  }
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    // First element is the original client; subsequent are proxy chain.
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  const xri = req.headers?.['x-real-ip'];
  if (typeof xri === 'string' && xri.length > 0) return xri.trim();
  return peer;
}

/**
 * Compute the window-start timestamp (ms) for a given now and window size.
 * Buckets are aligned to epoch — every `windowMs` slice has a stable start.
 *
 * @param {number} now Unix ms
 * @param {number} windowMs window size in ms (e.g. 3_600_000 for 1h)
 * @returns {number}
 */
export function windowStart(now, windowMs) {
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Check whether the given (scope, key) has exceeded `limit` events in the
 * current window.
 *
 * @param {object} store knowless store
 * @param {string} scope e.g. 'login_ip'
 * @param {string} key the value being limited (IP, handle hex)
 * @param {number} limit threshold; if 0, the check is disabled (returns false)
 * @param {number} windowMs
 * @param {number} [now] override for testing
 * @returns {boolean}
 */
export function rateLimitExceeded(store, scope, key, limit, windowMs, now = Date.now()) {
  if (limit <= 0) return false;
  const ws = windowStart(now, windowMs);
  return store.rateLimitGet(scope, key, ws) >= limit;
}

/**
 * Increment the counter for (scope, key) in the current window. Returns the
 * new count.
 *
 * @param {object} store
 * @param {string} scope
 * @param {string} key
 * @param {number} windowMs
 * @param {number} [now]
 * @returns {number}
 */
export function rateLimitIncrement(store, scope, key, windowMs, now = Date.now()) {
  const ws = windowStart(now, windowMs);
  return store.rateLimitIncrement(scope, key, ws);
}
