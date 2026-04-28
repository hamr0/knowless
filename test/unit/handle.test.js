import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, deriveHandle } from '../../src/handle.js';

const SECRET = 'a'.repeat(64);

test('normalize: trims, lowercases, accepts valid inputs', () => {
  assert.equal(normalize('Alice@Example.com'), 'alice@example.com');
  assert.equal(normalize('  bob@x.io  '), 'bob@x.io');
  assert.equal(normalize('\talice+work@ex.co\n'), 'alice+work@ex.co');
  assert.equal(normalize('a.b.c@x.example.com'), 'a.b.c@x.example.com');
  assert.equal(normalize('user_42@host-name.io'), 'user_42@host-name.io');
});

test('normalize: throws on non-string / empty / oversize', () => {
  assert.throws(() => normalize(null));
  assert.throws(() => normalize(undefined));
  assert.throws(() => normalize(42));
  assert.throws(() => normalize(''));
  assert.throws(() => normalize('   '));
  assert.throws(() => normalize('a'.repeat(255) + '@x.com'));
});

test('normalize: rejects non-ASCII', () => {
  assert.throws(() => normalize('café@example.com'));
  assert.throws(() => normalize('alice@münchen.de'));
  assert.throws(() => normalize('user@example.中国'));
});

test('normalize: rejects malformed addresses', () => {
  assert.throws(() => normalize('no-at-sign'));
  assert.throws(() => normalize('@no-local.com'));
  assert.throws(() => normalize('no-domain@'));
  assert.throws(() => normalize('two@@example.com'));
  assert.throws(() => normalize('alice@nodot'));
  assert.throws(() => normalize('alice@.com'));
  assert.throws(() => normalize('alice@x.c'));
  assert.throws(() => normalize('alice <alice@example.com>'));
});

test('deriveHandle: deterministic over (email, secret)', () => {
  const h1 = deriveHandle('alice@example.com', SECRET);
  const h2 = deriveHandle('alice@example.com', SECRET);
  assert.equal(h1, h2);
});

test('deriveHandle: returns 64-char lowercase hex', () => {
  const h = deriveHandle('alice@example.com', SECRET);
  assert.equal(h.length, 64);
  assert.match(h, /^[a-f0-9]{64}$/);
});

test('deriveHandle: different emails produce different handles', () => {
  const a = deriveHandle('alice@example.com', SECRET);
  const b = deriveHandle('bob@example.com', SECRET);
  assert.notEqual(a, b);
});

test('deriveHandle: different secrets produce different handles', () => {
  const a = deriveHandle('alice@example.com', 'a'.repeat(64));
  const b = deriveHandle('alice@example.com', 'b'.repeat(64));
  assert.notEqual(a, b);
});

test('deriveHandle: rejects missing inputs', () => {
  assert.throws(() => deriveHandle('', SECRET));
  assert.throws(() => deriveHandle(null, SECRET));
  assert.throws(() => deriveHandle('alice@x.com', null));
  assert.throws(() => deriveHandle('alice@x.com', 42));
});

test('deriveHandle: same normalized email from different surface forms gives same handle', () => {
  const a = deriveHandle(normalize('Alice@Example.com'), SECRET);
  const b = deriveHandle(normalize('  alice@example.com  '), SECRET);
  assert.equal(a, b);
});
