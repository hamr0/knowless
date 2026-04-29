import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { createMailer, composeBody, validateSubject, validateBodyFooter } from '../../src/mailer.js';

const captureTransport = () =>
  nodemailer.createTransport({ streamTransport: true, buffer: true });

const RAW_TOKEN = 'A'.repeat(43);
const BASE = 'https://app.example.com';
const PATH = '/auth/callback';

const newCapturingMailer = () => {
  const transport = captureTransport();
  const mailer = createMailer({
    from: 'auth@app.example.com',
    transportOverride: transport,
  });
  return { mailer, transport };
};

test('composeBody: URL on its own line, ASCII, includes the token', () => {
  const body = composeBody({ tokenRaw: RAW_TOKEN, baseUrl: BASE, linkPath: PATH });
  assert.match(body, /^Click to sign in:\n\n/);
  // URL line: bracketed by blank lines, no leading/trailing text on it.
  const lines = body.split('\n');
  const urlLineIdx = lines.findIndex((l) => l.startsWith('https://'));
  assert.ok(urlLineIdx > 0);
  assert.equal(lines[urlLineIdx], `${BASE}${PATH}?t=${RAW_TOKEN}`);
  assert.equal(lines[urlLineIdx - 1], '');
  assert.equal(lines[urlLineIdx + 1], '');
});

test('composeBody: appends last-login when timestamp set', () => {
  const ts = Date.UTC(2026, 3, 28, 10, 0, 0);
  const body = composeBody({
    tokenRaw: RAW_TOKEN,
    baseUrl: BASE,
    linkPath: PATH,
    lastLoginAt: ts,
  });
  assert.match(body, /Last sign-in: 2026-04-28T10:00:00\.000Z/);
});

test('composeBody: omits last-login when timestamp absent', () => {
  const body = composeBody({ tokenRaw: RAW_TOKEN, baseUrl: BASE, linkPath: PATH });
  assert.equal(body.includes('Last sign-in:'), false);
});

test('composeBody: rejects non-ASCII URL', () => {
  assert.throws(() =>
    composeBody({ tokenRaw: RAW_TOKEN, baseUrl: 'https://münchen.de', linkPath: PATH }),
  );
});

test('validateSubject: accepts plain, rejects oversize / non-ASCII', () => {
  assert.deepEqual(validateSubject('Sign in'), []);
  assert.throws(() => validateSubject(''));
  assert.throws(() => validateSubject('a'.repeat(61)));
  assert.throws(() => validateSubject('Café'));
});

test('validateSubject: warns on spam triggers (does not throw)', () => {
  const w = validateSubject('FREE WINNER!!');
  assert.ok(w.some((m) => m.includes('FREE')));
  assert.ok(w.some((m) => m.includes('WINNER')));
  assert.ok(w.some((m) => m.includes('!!')));
});

test('mailer: emits 7bit ASCII mail with whitelist headers only', async () => {
  const { mailer, transport } = newCapturingMailer();
  const body = composeBody({ tokenRaw: RAW_TOKEN, baseUrl: BASE, linkPath: PATH });
  const info = await mailer.submit({
    to: 'alice@example.com',
    subject: 'Sign in',
    body,
  });
  const wire = info.message.toString();

  // Whitelist headers present
  assert.match(wire, /^From: auth@app\.example\.com$/m);
  assert.match(wire, /^To: alice@example\.com$/m);
  assert.match(wire, /^Subject: Sign in$/m);
  assert.match(wire, /^Date: /m);
  assert.match(wire, /^Message-ID: /m);
  assert.match(wire, /^MIME-Version: 1\.0$/m);
  assert.match(wire, /^Content-Type: text\/plain; charset=utf-8$/m);
  assert.match(wire, /^Content-Transfer-Encoding: 7bit$/m);

  // Forbidden headers absent
  assert.equal(/^X-Mailer:/m.test(wire), false);
  assert.equal(/^List-Unsubscribe:/m.test(wire), false);
  assert.equal(/^Return-Receipt-To:/m.test(wire), false);
  assert.equal(/^Disposition-Notification-To:/m.test(wire), false);

  // No multipart / no HTML alternative
  assert.equal(/multipart\/alternative/i.test(wire), false);

  // Body is ASCII and the URL is intact (no QP wrap with =)
  const bodyStart = wire.indexOf('\r\n\r\n');
  assert.ok(bodyStart > 0);
  const wireBody = wire.slice(bodyStart + 4);
  for (let i = 0; i < wireBody.length; i++) {
    assert.ok(wireBody.charCodeAt(i) <= 0x7f, 'body must be ASCII');
  }
  assert.match(wireBody, /https:\/\/app\.example\.com\/auth\/callback\?t=A{43}/);
  // No quoted-printable artifacts on the URL line
  assert.equal(/=\r?\n[a-zA-Z]/.test(wireBody), false, 'no QP soft breaks');
  assert.equal(/=3D/.test(wireBody), false, 'no QP-escaped =');

  mailer.close();
});

test('mailer: refuses non-ASCII recipient', async () => {
  const { mailer } = newCapturingMailer();
  await assert.rejects(
    mailer.submit({
      to: 'café@example.com',
      subject: 'Sign in',
      body: 'plain ascii',
    }),
  );
  mailer.close();
});

test('mailer: refuses non-ASCII body (defence-in-depth on operator override)', async () => {
  const { mailer } = newCapturingMailer();
  await assert.rejects(
    mailer.submit({
      to: 'alice@example.com',
      subject: 'Sign in',
      body: 'fancy é',
    }),
  );
  mailer.close();
});

test('mailer: rejects CR/LF in to/from/subject — header-injection defense (closes AF-2.1)', async () => {
  const { mailer } = newCapturingMailer();
  // Newline-in-to: classic header injection attempt.
  await assert.rejects(
    mailer.submit({
      to: 'alice@example.com\r\nBcc: attacker@evil.com',
      subject: 'Sign in',
      body: 'plain ascii',
    }),
    /header injection/,
  );
  // Bare \n is also dangerous (some MTAs accept it as line terminator).
  await assert.rejects(
    mailer.submit({
      to: 'alice@example.com\nBcc: attacker@evil.com',
      subject: 'Sign in',
      body: 'plain ascii',
    }),
    /header injection/,
  );
  // Subject with embedded newline — could inject body separator.
  await assert.rejects(
    mailer.submit({
      to: 'alice@example.com',
      subject: 'Sign in\r\n\r\nFake body',
      body: 'plain ascii',
    }),
    /header injection/,
  );
  mailer.close();
});

// --- AF-8.2: bodyFooter ---

test('validateBodyFooter: null/empty/undefined → null', () => {
  assert.equal(validateBodyFooter(null), null);
  assert.equal(validateBodyFooter(undefined), null);
  assert.equal(validateBodyFooter(''), null);
});

test('validateBodyFooter: accepts a normal ASCII single-line footer (AF-8.2)', () => {
  const f = 'feedback@addypin.com | we do not keep your email';
  assert.equal(validateBodyFooter(f), f);
});

test('validateBodyFooter: rejects non-string', () => {
  assert.throws(() => validateBodyFooter(123), /string/);
});

test('validateBodyFooter: rejects > 240 chars', () => {
  assert.throws(() => validateBodyFooter('a'.repeat(241)), /240/);
});

test('validateBodyFooter: rejects non-ASCII (the · gotcha)', () => {
  // Unicode middle-dot is a common separator choice but it would
  // force 8bit encoding; reject and have adopters use | or - instead.
  assert.throws(() => validateBodyFooter('feedback@x.com · privacy'), /ASCII/);
});

test('validateBodyFooter: rejects CR', () => {
  assert.throws(() => validateBodyFooter('line1\r\nline2'), /CR/);
});

test('validateBodyFooter: rejects > 4 lines', () => {
  assert.throws(() => validateBodyFooter('1\n2\n3\n4\n5'), /4 lines/);
});

test('validateBodyFooter: rejects URL substrings', () => {
  assert.throws(
    () => validateBodyFooter('see https://addypin.com/privacy'),
    /URLs/,
  );
  assert.throws(() => validateBodyFooter('http://x'), /URLs/);
});

test('composeBody: appends bodyFooter after a "-- " sig delimiter (AF-8.2)', () => {
  const footer = 'feedback@addypin.com | privacy first';
  const body = composeBody({
    tokenRaw: RAW_TOKEN,
    baseUrl: BASE,
    linkPath: PATH,
    bodyFooter: footer,
  });
  // Standard signature delimiter: "-- " on its own line, then footer.
  assert.match(body, /\n-- \nfeedback@addypin\.com \| privacy first\n$/);
  // URL line is still bracketed by blank lines (URL-line invariant
  // preserved).
  const lines = body.split('\n');
  const urlIdx = lines.findIndex((l) => l.startsWith('https://'));
  assert.equal(lines[urlIdx - 1], '');
  assert.equal(lines[urlIdx + 1], '');
});

test('composeBody: bodyFooter null/undefined → no footer block (AF-8.2)', () => {
  const body = composeBody({
    tokenRaw: RAW_TOKEN,
    baseUrl: BASE,
    linkPath: PATH,
  });
  assert.equal(body.includes('-- '), false);
});

test('composeBody: lastLoginAt + bodyFooter both render in order (AF-8.2)', () => {
  const body = composeBody({
    tokenRaw: RAW_TOKEN,
    baseUrl: BASE,
    linkPath: PATH,
    lastLoginAt: Date.UTC(2026, 3, 28),
    bodyFooter: 'team@x.com',
  });
  const lastIdx = body.indexOf('Last sign-in');
  const sigIdx = body.indexOf('-- ');
  assert.ok(lastIdx > 0 && sigIdx > lastIdx);
});
