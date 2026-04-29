// AF-27: optional `fromName` factory option for the RFC 5322 From: header
// display name. Splits the bare envelope sender (RFC 5321 MAIL FROM)
// from the From: header value so adopters can ship `addypin
// <noreply@addypin.com>` instead of bare `noreply@addypin.com` (which
// most clients display as the local-part "noreply").
//
// Invariants tested:
//   - From: header gets `name <addr>` when fromName is set
//   - From: header is bare `addr` when fromName is unset
//   - envelope.from stays bare regardless (SMTP MAIL FROM doesn't allow
//     display names)
//   - validation throws on the four trap shapes (CR/LF, <>", non-ASCII,
//     too long, non-string)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { knowless, validateFromName } from '../../src/index.js';

const SECRET = 'a'.repeat(64);

function newAuth(overrides = {}) {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  const sentMail = [];
  const orig = transport.sendMail.bind(transport);
  transport.sendMail = async (opts) => {
    const info = await orig(opts);
    sentMail.push({ envelope: info.envelope, raw: info.message.toString() });
    return info;
  };
  const auth = knowless({
    secret: SECRET,
    baseUrl: 'https://app.example.com',
    from: 'noreply@addypin.com',
    cookieDomain: 'app.example.com',
    dbPath: ':memory:',
    transportOverride: transport,
    sweepIntervalMs: 60_000,
    openRegistration: true,
    ...overrides,
  });
  return { auth, sentMail };
}

function fromHeaderOf(raw) {
  const m = raw.match(/^From: (.+)$/m);
  return m ? m[1].trim() : null;
}

// --- happy path -------------------------------------------------------------

test('fromName: produces "name <addr>" From: header when set', async () => {
  const { auth, sentMail } = newAuth({ fromName: 'addypin' });
  await auth.startLogin({ email: 'alice@example.com' });
  assert.equal(sentMail.length, 1);
  assert.equal(fromHeaderOf(sentMail[0].raw), 'addypin <noreply@addypin.com>');
  auth.close();
});

test('fromName unset: produces bare "addr" From: header (existing behavior)', async () => {
  const { auth, sentMail } = newAuth();
  await auth.startLogin({ email: 'alice@example.com' });
  assert.equal(fromHeaderOf(sentMail[0].raw), 'noreply@addypin.com');
  auth.close();
});

test('fromName: envelope.from stays bare regardless of fromName', async () => {
  const { auth, sentMail } = newAuth({ fromName: 'addypin' });
  await auth.startLogin({ email: 'alice@example.com' });
  // SMTP MAIL FROM (RFC 5321) does NOT allow display names. The
  // envelope must be the bare address even when From: header has the
  // display name. Conflating these would break SMTP submission.
  assert.equal(sentMail[0].envelope.from, 'noreply@addypin.com');
  auth.close();
});

test('fromName: applies on sham branch too (FR-6)', async () => {
  // Closed-reg unknown email → sham branch. From: header must use the
  // configured fromName regardless of hit/miss; otherwise the maillog
  // would distinguish real from sham via header shape.
  const { auth, sentMail } = newAuth({
    openRegistration: false,
    fromName: 'addypin',
  });
  await auth.startLogin({ email: 'unknown@example.com' });
  assert.equal(sentMail[0].envelope.to[0], 'null@knowless.invalid');
  assert.equal(fromHeaderOf(sentMail[0].raw), 'addypin <noreply@addypin.com>');
  auth.close();
});

test('fromName: passes through whitespace within name (rendered as-is)', async () => {
  const { auth, sentMail } = newAuth({ fromName: 'My App Name' });
  await auth.startLogin({ email: 'alice@example.com' });
  assert.equal(fromHeaderOf(sentMail[0].raw), 'My App Name <noreply@addypin.com>');
  auth.close();
});

// --- factory-time validation (fail-fast) -----------------------------------

test('fromName: factory throws on non-string', () => {
  assert.throws(
    () =>
      knowless({
        secret: SECRET,
        baseUrl: 'https://x.com',
        from: 'a@x.com',
        fromName: 42,
      }),
    /fromName must be a string/,
  );
});

test('fromName: factory throws on non-ASCII (em-dash trap)', () => {
  assert.throws(
    () =>
      knowless({
        secret: SECRET,
        baseUrl: 'https://x.com',
        from: 'a@x.com',
        fromName: 'addypin — auth',
      }),
    /ASCII/,
  );
});

test('fromName: factory throws on CR/LF (header injection)', () => {
  assert.throws(
    () =>
      knowless({
        secret: SECRET,
        baseUrl: 'https://x.com',
        from: 'a@x.com',
        fromName: 'addypin\r\nBcc: attacker@evil.com',
      }),
    /CR\/LF/,
  );
});

test('fromName: factory throws on < > or " (would break header quoting)', () => {
  for (const bad of ['evil<addr>', 'evil>x', 'evil"name']) {
    assert.throws(
      () =>
        knowless({
          secret: SECRET,
          baseUrl: 'https://x.com',
          from: 'a@x.com',
          fromName: bad,
        }),
      /< > or "/,
    );
  }
});

test('fromName: factory throws on > 60 chars', () => {
  assert.throws(
    () =>
      knowless({
        secret: SECRET,
        baseUrl: 'https://x.com',
        from: 'a@x.com',
        fromName: 'x'.repeat(61),
      }),
    /≤ 60 chars/,
  );
});

test('fromName: undefined / null / empty string produce bare From:', async () => {
  for (const value of [undefined, null, '']) {
    const { auth, sentMail } = newAuth({ fromName: value });
    await auth.startLogin({ email: 'alice@example.com' });
    assert.equal(fromHeaderOf(sentMail[0].raw), 'noreply@addypin.com');
    auth.close();
  }
});

// --- standalone validator (re-exported) ------------------------------------

test('validateFromName: re-exported and works on its own', () => {
  // valid
  assert.equal(validateFromName('addypin'), 'addypin');
  assert.equal(validateFromName('My App'), 'My App');
  // null/empty pass-through
  assert.equal(validateFromName(null), null);
  assert.equal(validateFromName(''), null);
  assert.equal(validateFromName(undefined), null);
  // invalid
  assert.throws(() => validateFromName('em — dash'), /ASCII/);
  assert.throws(() => validateFromName('smart ‘quote’'), /ASCII/);
  assert.throws(() => validateFromName('a\nb'), /CR\/LF/);
  assert.throws(() => validateFromName('a<b>'), /< > or "/);
  assert.throws(() => validateFromName('x'.repeat(61)), /≤ 60/);
  assert.throws(() => validateFromName(123), /must be a string/);
});
