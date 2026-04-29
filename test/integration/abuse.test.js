import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/store.js';
import {
  determineSourceIp,
  rateLimitExceeded,
  rateLimitIncrement,
  windowStart,
} from '../../src/abuse.js';

const HOUR = 3600_000;

const fakeReq = (peer, headers = {}) => ({
  socket: { remoteAddress: peer },
  headers,
});

test('determineSourceIp: untrusted peer ignores X-Forwarded-For', () => {
  const req = fakeReq('203.0.113.5', { 'x-forwarded-for': '1.2.3.4' });
  assert.equal(determineSourceIp(req, ['127.0.0.1']), '203.0.113.5');
});

test('determineSourceIp: trusted peer honours X-Forwarded-For (first hop)', () => {
  const req = fakeReq('127.0.0.1', { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' });
  assert.equal(determineSourceIp(req, ['127.0.0.1']), '1.2.3.4');
});

test('determineSourceIp: trusted peer honours X-Real-IP when XFF absent', () => {
  const req = fakeReq('127.0.0.1', { 'x-real-ip': '198.51.100.7' });
  assert.equal(determineSourceIp(req, ['127.0.0.1']), '198.51.100.7');
});

test('determineSourceIp: trusted peer with no proxy headers falls back to peer', () => {
  const req = fakeReq('127.0.0.1', {});
  assert.equal(determineSourceIp(req, ['127.0.0.1']), '127.0.0.1');
});

test('determineSourceIp: empty trusted-proxies list refuses all spoofing', () => {
  const req = fakeReq('127.0.0.1', { 'x-forwarded-for': 'evil' });
  assert.equal(determineSourceIp(req, []), '127.0.0.1');
});

test('determineSourceIp: undeterminable peer returns empty string', () => {
  assert.equal(determineSourceIp({}, []), '');
  assert.equal(determineSourceIp({ socket: {} }, []), '');
});

// --- AF-6.3: CIDR support in trustedProxies ---

test('determineSourceIp: CIDR range honoured for trusted peer (AF-6.3)', () => {
  const req = fakeReq('10.0.0.5', { 'x-forwarded-for': '203.0.113.7' });
  // 10.0.0.0/8 covers the peer.
  assert.equal(determineSourceIp(req, ['10.0.0.0/8']), '203.0.113.7');
});

test('determineSourceIp: CIDR miss falls back to peer (AF-6.3)', () => {
  const req = fakeReq('11.0.0.5', { 'x-forwarded-for': '203.0.113.7' });
  // 10.0.0.0/8 does NOT cover 11.0.0.5 — peer is not trusted, XFF ignored.
  assert.equal(determineSourceIp(req, ['10.0.0.0/8']), '11.0.0.5');
});

test('determineSourceIp: mixed plain IPs + CIDRs (AF-6.3)', () => {
  const list = ['127.0.0.1', '10.0.0.0/8', 'fd00::/8'];
  // Plain hit
  assert.equal(
    determineSourceIp(fakeReq('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' }), list),
    '1.2.3.4',
  );
  // CIDR hit (v4)
  assert.equal(
    determineSourceIp(fakeReq('10.99.99.99', { 'x-forwarded-for': '1.2.3.4' }), list),
    '1.2.3.4',
  );
  // CIDR hit (v6)
  assert.equal(
    determineSourceIp(fakeReq('fd00::1', { 'x-forwarded-for': '1.2.3.4' }), list),
    '1.2.3.4',
  );
  // Miss
  assert.equal(
    determineSourceIp(fakeReq('8.8.8.8', { 'x-forwarded-for': '1.2.3.4' }), list),
    '8.8.8.8',
  );
});

test('determineSourceIp: malformed CIDR is skipped, others still work (AF-6.3)', () => {
  const list = ['nope/garbage', '10.0.0.0/8'];
  assert.equal(
    determineSourceIp(fakeReq('10.0.0.5', { 'x-forwarded-for': '1.2.3.4' }), list),
    '1.2.3.4',
  );
});

test('windowStart: rounds down to window boundary', () => {
  assert.equal(windowStart(0, HOUR), 0);
  assert.equal(windowStart(HOUR - 1, HOUR), 0);
  assert.equal(windowStart(HOUR, HOUR), HOUR);
  assert.equal(windowStart(HOUR + 1, HOUR), HOUR);
  assert.equal(windowStart(2 * HOUR + 500, HOUR), 2 * HOUR);
});

test('rateLimit: increment + get + exceeded threshold', () => {
  const s = createStore(':memory:');
  const now = HOUR * 100; // a stable time inside one window

  for (let i = 1; i <= 5; i++) {
    rateLimitIncrement(s, 'login_ip', '1.2.3.4', HOUR, now);
  }
  // 5 hits, limit 5: NOT exceeded yet (>=  is the test, so 5 >= 5 = exceeded)
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, HOUR, now), true);
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 6, HOUR, now), false);
  s.close();
});

test('rateLimit: limit=0 disables the check', () => {
  const s = createStore(':memory:');
  const now = HOUR * 100;
  rateLimitIncrement(s, 'login_ip', '1.2.3.4', HOUR, now);
  rateLimitIncrement(s, 'login_ip', '1.2.3.4', HOUR, now);
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 0, HOUR, now), false);
  s.close();
});

test('rateLimit: window roll-over resets the count', () => {
  const s = createStore(':memory:');
  const now1 = HOUR * 100;
  const now2 = HOUR * 101 + 1; // next window

  for (let i = 0; i < 5; i++) rateLimitIncrement(s, 'login_ip', '1.2.3.4', HOUR, now1);
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, HOUR, now1), true);
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, HOUR, now2), false);
  rateLimitIncrement(s, 'login_ip', '1.2.3.4', HOUR, now2);
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 1, HOUR, now2), true);
  s.close();
});

test('rateLimit: window boundary is exact — last ms of N is limited, first ms of N+1 is fresh (closes AF-5.1)', () => {
  const s = createStore(':memory:');
  const W = 60_000;
  const t0 = 100 * W; // window-aligned start time

  // Saturate the window: 5 hits at t0 (start of window N).
  for (let i = 0; i < 5; i++) {
    rateLimitIncrement(s, 'login_ip', '1.2.3.4', W, t0);
  }

  // Anywhere inside window N: rate-limited.
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, W, t0), true);
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, W, t0 + 1), true);
  // Last ms of window N (exclusive boundary): still N, still limited.
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, W, t0 + W - 1), true);

  // Exactly at t0 + W: this is windowStart of window N+1 — fresh counter.
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, W, t0 + W), false);

  // First increment of window N+1 makes count=1, still under limit.
  rateLimitIncrement(s, 'login_ip', '1.2.3.4', W, t0 + W);
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, W, t0 + W), false);

  // Last ms before window N+2: still in N+1, still under limit (count=1).
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, W, t0 + 2 * W - 1), false);
  s.close();
});

test('rateLimit: limit semantics — exceeded triggers AT limit, not strictly above (AF-5.1)', () => {
  const s = createStore(':memory:');
  const W = 60_000;
  const t0 = 100 * W;

  // 4 hits: count=4, under limit of 5.
  for (let i = 0; i < 4; i++) rateLimitIncrement(s, 'login_ip', '1.2.3.4', W, t0);
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, W, t0), false);

  // 5th hit: count=5, "exceeded" per >= limit semantics.
  rateLimitIncrement(s, 'login_ip', '1.2.3.4', W, t0);
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, W, t0), true);

  // 6th, 7th: counter still rises (no cap on increment), still limited.
  rateLimitIncrement(s, 'login_ip', '1.2.3.4', W, t0);
  rateLimitIncrement(s, 'login_ip', '1.2.3.4', W, t0);
  assert.equal(rateLimitExceeded(s, 'login_ip', '1.2.3.4', 5, W, t0), true);
  s.close();
});

test('rateLimit: distinct keys / scopes are independent', () => {
  const s = createStore(':memory:');
  const now = HOUR * 100;

  for (let i = 0; i < 3; i++) rateLimitIncrement(s, 'login_ip', 'A', HOUR, now);
  assert.equal(rateLimitExceeded(s, 'login_ip', 'A', 3, HOUR, now), true);
  assert.equal(rateLimitExceeded(s, 'login_ip', 'B', 3, HOUR, now), false);
  assert.equal(rateLimitExceeded(s, 'create_ip', 'A', 3, HOUR, now), false);
  s.close();
});
