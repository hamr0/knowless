import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueToken, hashToken } from '../../src/token.js';

test('issueToken: raw is 43-char base64url', () => {
  const { raw } = issueToken();
  assert.equal(raw.length, 43);
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
});

test('issueToken: hash is 64-char lowercase hex', () => {
  const { hash } = issueToken();
  assert.equal(hash.length, 64);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('issueToken: raw and hash are correlated (hashToken round-trips)', () => {
  const { raw, hash } = issueToken();
  assert.equal(hashToken(raw), hash);
});

test('issueToken: two calls produce different raw and different hash', () => {
  const a = issueToken();
  const b = issueToken();
  assert.notEqual(a.raw, b.raw);
  assert.notEqual(a.hash, b.hash);
});

test('hashToken: malformed inputs return null (not throw)', () => {
  assert.equal(hashToken(null), null);
  assert.equal(hashToken(undefined), null);
  assert.equal(hashToken(42), null);
  assert.equal(hashToken(''), null);
  assert.equal(hashToken('a'.repeat(65)), null);
  assert.equal(hashToken('not!base64url'), null);
  assert.equal(hashToken('aaa'), null); // valid alphabet but decodes to too few bytes
  assert.equal(hashToken('A'.repeat(40)), null); // too short to be 32 bytes
});

test('hashToken: padding-stripped base64url accepted but base64 with padding rejected', () => {
  // We MUST refuse '=' padding per SPEC §1.2 (base64url no padding).
  assert.equal(hashToken('A'.repeat(43) + '='), null);
});

test('hashToken: known vector', () => {
  // Token of all zeros: raw = 'AAAA...' (43 chars), hash = SHA256(0x00 * 32).
  // Pre-computed: SHA256(\x00 * 32) =
  //   66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925
  const raw = 'A'.repeat(43);
  // 32 zero bytes encoded as base64url with no padding
  // 0x00 * 32 → "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" (43 chars)
  assert.equal(
    hashToken(raw),
    '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
  );
});
