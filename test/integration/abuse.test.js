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

test('rateLimit: distinct keys / scopes are independent', () => {
  const s = createStore(':memory:');
  const now = HOUR * 100;

  for (let i = 0; i < 3; i++) rateLimitIncrement(s, 'login_ip', 'A', HOUR, now);
  assert.equal(rateLimitExceeded(s, 'login_ip', 'A', 3, HOUR, now), true);
  assert.equal(rateLimitExceeded(s, 'login_ip', 'B', 3, HOUR, now), false);
  assert.equal(rateLimitExceeded(s, 'create_ip', 'A', 3, HOUR, now), false);
  s.close();
});
