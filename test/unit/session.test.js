import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSid, signSession, verifySessionSignature } from '../../src/session.js';

const SECRET = 'a'.repeat(64);

test('newSid: 43-char base64url', () => {
  const sid = newSid();
  assert.equal(sid.length, 43);
  assert.match(sid, /^[A-Za-z0-9_-]+$/);
});

test('newSid: two calls return different sids', () => {
  assert.notEqual(newSid(), newSid());
});

test('signSession: format is <sid>.<sig>, sig is 64-char hex', () => {
  const sid = newSid();
  const cookie = signSession(sid, SECRET);
  const dot = cookie.indexOf('.');
  assert.ok(dot > 0);
  assert.equal(cookie.slice(0, dot), sid);
  assert.match(cookie.slice(dot + 1), /^[a-f0-9]{64}$/);
});

test('signSession: deterministic over (sid, secret)', () => {
  const sid = newSid();
  assert.equal(signSession(sid, SECRET), signSession(sid, SECRET));
});

test('signSession: different secrets produce different signatures', () => {
  const sid = newSid();
  assert.notEqual(signSession(sid, 'a'.repeat(64)), signSession(sid, 'b'.repeat(64)));
});

test('signSession: rejects malformed sid', () => {
  assert.throws(() => signSession('', SECRET));
  assert.throws(() => signSession(null, SECRET));
  assert.throws(() => signSession('has dots.in.it', SECRET));
  assert.throws(() => signSession('has=padding', SECRET));
});

test('signSession: rejects missing secret', () => {
  assert.throws(() => signSession(newSid(), null));
  assert.throws(() => signSession(newSid(), 42));
});

test('verifySessionSignature: round-trips a freshly signed cookie', () => {
  const sid = newSid();
  const cookie = signSession(sid, SECRET);
  assert.equal(verifySessionSignature(cookie, SECRET), sid);
});

test('verifySessionSignature: tampered sid -> null', () => {
  const sid = newSid();
  const cookie = signSession(sid, SECRET);
  const dot = cookie.indexOf('.');
  const tampered = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' + cookie.slice(dot);
  assert.equal(verifySessionSignature(tampered, SECRET), null);
});

test('verifySessionSignature: tampered signature -> null', () => {
  const sid = newSid();
  const cookie = signSession(sid, SECRET);
  // flip the last hex char
  const flipped = cookie.slice(0, -1) + (cookie.slice(-1) === '0' ? '1' : '0');
  assert.equal(verifySessionSignature(flipped, SECRET), null);
});

test('verifySessionSignature: wrong secret -> null', () => {
  const sid = newSid();
  const cookie = signSession(sid, 'a'.repeat(64));
  assert.equal(verifySessionSignature(cookie, 'b'.repeat(64)), null);
});

test('verifySessionSignature: malformed cookies -> null', () => {
  assert.equal(verifySessionSignature(null, SECRET), null);
  assert.equal(verifySessionSignature('', SECRET), null);
  assert.equal(verifySessionSignature('no-dot-in-here', SECRET), null);
  assert.equal(verifySessionSignature('.signature-only', SECRET), null);
  assert.equal(verifySessionSignature('sid-only.', SECRET), null);
  assert.equal(verifySessionSignature('sid.short-sig', SECRET), null);
  assert.equal(
    verifySessionSignature('sid.' + 'g'.repeat(64), SECRET), // non-hex chars
    null,
  );
  assert.equal(verifySessionSignature(42, SECRET), null);
});

test('verifySessionSignature: empty sid before dot -> null', () => {
  // Cookie of the shape ".<valid-sig>" — sid is empty
  const fakeSig = 'a'.repeat(64);
  assert.equal(verifySessionSignature('.' + fakeSig, SECRET), null);
});

test('signSession: known vector pins HMAC-SHA256 + sess\\0 domain tag (closes AF-1.2)', () => {
  // Vector computed externally:
  //   const tag = Buffer.from('sess\x00');
  //   const h = crypto.createHmac('sha256', 'a'.repeat(64));
  //   h.update(tag);
  //   h.update('A'.repeat(43), 'utf8');
  //   h.digest('hex')  // -> 7d394fde...
  //
  // A broken impl (SHA-1 instead of SHA-256, missing tag, wrong tag bytes,
  // tag appended instead of prepended, signing the decoded sid bytes
  // instead of the base64url string) would fail this even if all the
  // round-trip and tamper tests above still pass.
  const cookie = signSession('A'.repeat(43), 'a'.repeat(64));
  assert.equal(
    cookie,
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.' +
      '7d394fde31d230ad8efa52cde7a783b0258b236eaa592a655f9b7f93d92c5e5b',
  );
});
