import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/store.js';

const HANDLE_A = 'a'.repeat(64);
const HANDLE_B = 'b'.repeat(64);
const TOKEN_HASH_1 = '1'.repeat(64);
const TOKEN_HASH_2 = '2'.repeat(64);
const TOKEN_HASH_3 = '3'.repeat(64);
const SID_HASH_1 = '11'.repeat(32);

const fresh = () => createStore(':memory:');

test('handles: upsert + exists + delete clears all related rows', () => {
  const s = fresh();
  assert.equal(s.handleExists(HANDLE_A), false);
  s.upsertHandle(HANDLE_A);
  assert.equal(s.handleExists(HANDLE_A), true);

  // upsert is idempotent
  s.upsertHandle(HANDLE_A);
  assert.equal(s.handleExists(HANDLE_A), true);

  // attach token + session
  s.insertToken({
    tokenHash: TOKEN_HASH_1,
    handle: HANDLE_A,
    expiresAt: Date.now() + 60_000,
    isSham: false,
  });
  s.insertSession(SID_HASH_1, HANDLE_A, Date.now() + 60_000);

  // deleteHandle removes everything
  s.deleteHandle(HANDLE_A);
  assert.equal(s.handleExists(HANDLE_A), false);
  assert.equal(s.getToken(TOKEN_HASH_1), null);
  assert.equal(s.getSession(SID_HASH_1), null);
  s.close();
});

test('tokens: insert + get + markUsed + replay-safe', () => {
  const s = fresh();
  s.upsertHandle(HANDLE_A);
  const expiresAt = Date.now() + 60_000;
  s.insertToken({
    tokenHash: TOKEN_HASH_1,
    handle: HANDLE_A,
    expiresAt,
    nextUrl: 'https://kuma.example.com/dash',
    isSham: false,
  });
  const row = s.getToken(TOKEN_HASH_1);
  assert.equal(row.handle, HANDLE_A);
  assert.equal(row.expiresAt, expiresAt);
  assert.equal(row.usedAt, null);
  assert.equal(row.nextUrl, 'https://kuma.example.com/dash');
  assert.equal(row.isSham, false);

  // First markUsed succeeds
  assert.equal(s.markTokenUsed(TOKEN_HASH_1, Date.now()), true);
  // Replay: markUsed returns false (already used)
  assert.equal(s.markTokenUsed(TOKEN_HASH_1, Date.now()), false);
  s.close();
});

test('tokens: getToken returns isSham=true for sham rows', () => {
  const s = fresh();
  s.upsertHandle(HANDLE_A);
  s.insertToken({
    tokenHash: TOKEN_HASH_1,
    handle: HANDLE_A,
    expiresAt: Date.now() + 60_000,
    isSham: true,
  });
  assert.equal(s.getToken(TOKEN_HASH_1).isSham, true);
  s.close();
});

test('tokens: cap enforcement evicts oldest when maxActive reached', () => {
  const s = fresh();
  s.upsertHandle(HANDLE_A);
  const base = Date.now();

  s.insertToken({ tokenHash: TOKEN_HASH_1, handle: HANDLE_A, expiresAt: base + 100, maxActive: 2 });
  s.insertToken({ tokenHash: TOKEN_HASH_2, handle: HANDLE_A, expiresAt: base + 200, maxActive: 2 });
  // At cap. Inserting a third evicts oldest (the one with the soonest expires_at).
  s.insertToken({ tokenHash: TOKEN_HASH_3, handle: HANDLE_A, expiresAt: base + 300, maxActive: 2 });

  assert.equal(s.getToken(TOKEN_HASH_1), null, 'oldest evicted');
  assert.ok(s.getToken(TOKEN_HASH_2));
  assert.ok(s.getToken(TOKEN_HASH_3));
  assert.equal(s.countActiveTokens(HANDLE_A, base), 2);
  s.close();
});

test('tokens: maxActive=0 disables cap', () => {
  const s = fresh();
  s.upsertHandle(HANDLE_A);
  for (let i = 0; i < 10; i++) {
    s.insertToken({
      tokenHash: String(i).padStart(64, '0'),
      handle: HANDLE_A,
      expiresAt: Date.now() + 60_000,
      maxActive: 0,
    });
  }
  assert.equal(s.countActiveTokens(HANDLE_A), 10);
  s.close();
});

test('tokens: sweep deletes expired and used-with-grace', () => {
  const s = fresh();
  s.upsertHandle(HANDLE_A);
  const now = Date.now();

  // expired
  s.insertToken({ tokenHash: TOKEN_HASH_1, handle: HANDLE_A, expiresAt: now - 1000 });
  // used 2 days ago (past 24h grace)
  s.insertToken({ tokenHash: TOKEN_HASH_2, handle: HANDLE_A, expiresAt: now + 60_000 });
  s.markTokenUsed(TOKEN_HASH_2, now - 2 * 24 * 3600_000);
  // active and unused
  s.insertToken({ tokenHash: TOKEN_HASH_3, handle: HANDLE_A, expiresAt: now + 60_000 });

  const removed = s.sweepTokens(now);
  assert.equal(removed, 2);
  assert.equal(s.getToken(TOKEN_HASH_1), null);
  assert.equal(s.getToken(TOKEN_HASH_2), null);
  assert.ok(s.getToken(TOKEN_HASH_3));
  s.close();
});

test('lastLogin: upsert and read', () => {
  const s = fresh();
  s.upsertHandle(HANDLE_A);
  assert.equal(s.getLastLogin(HANDLE_A), null);
  s.upsertLastLogin(HANDLE_A, 12345);
  assert.equal(s.getLastLogin(HANDLE_A), 12345);
  s.upsertLastLogin(HANDLE_A, 99999);
  assert.equal(s.getLastLogin(HANDLE_A), 99999);
  s.close();
});

test('sessions: insert + get + delete + sweep', () => {
  const s = fresh();
  const now = Date.now();

  s.insertSession(SID_HASH_1, HANDLE_A, now + 60_000);
  const row = s.getSession(SID_HASH_1);
  assert.equal(row.handle, HANDLE_A);
  assert.equal(row.expiresAt, now + 60_000);

  assert.equal(s.deleteSession(SID_HASH_1), true);
  assert.equal(s.getSession(SID_HASH_1), null);
  // Idempotent delete returns false
  assert.equal(s.deleteSession(SID_HASH_1), false);

  // sweep
  s.insertSession('22'.repeat(32), HANDLE_A, now - 1000); // expired
  s.insertSession('33'.repeat(32), HANDLE_B, now + 60_000); // active
  assert.equal(s.sweepSessions(now), 1);
  assert.equal(s.getSession('22'.repeat(32)), null);
  assert.ok(s.getSession('33'.repeat(32)));
  s.close();
});

test('rate limits: increment, get, distinct windows, sweep', () => {
  const s = fresh();
  const ws1 = 1_000_000;
  const ws2 = 2_000_000;

  assert.equal(s.rateLimitIncrement('login_ip', '1.2.3.4', ws1), 1);
  assert.equal(s.rateLimitIncrement('login_ip', '1.2.3.4', ws1), 2);
  assert.equal(s.rateLimitIncrement('login_ip', '1.2.3.4', ws1), 3);
  assert.equal(s.rateLimitGet('login_ip', '1.2.3.4', ws1), 3);

  // Different window: counter starts fresh
  assert.equal(s.rateLimitIncrement('login_ip', '1.2.3.4', ws2), 1);

  // Different scope or key: independent
  assert.equal(s.rateLimitIncrement('create_ip', '1.2.3.4', ws1), 1);
  assert.equal(s.rateLimitIncrement('login_ip', '5.6.7.8', ws1), 1);

  // sweep removes older windows. ws1 has 3 distinct rows:
  // (login_ip,1.2.3.4), (create_ip,1.2.3.4), (login_ip,5.6.7.8).
  assert.equal(s.sweepRateLimits(ws2), 3);
  assert.equal(s.rateLimitGet('login_ip', '1.2.3.4', ws1), 0);
  assert.equal(s.rateLimitGet('login_ip', '1.2.3.4', ws2), 1);
  s.close();
});

test('schema_version: re-opening the same DB succeeds', () => {
  // Use a real file to test re-open behaviour.
  const path = `/tmp/knowless-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`;
  const a = createStore(path);
  a.upsertHandle(HANDLE_A);
  a.close();
  const b = createStore(path);
  assert.equal(b.handleExists(HANDLE_A), true);
  b.close();
});
