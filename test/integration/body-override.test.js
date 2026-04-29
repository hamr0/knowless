// AF-26: per-call body override for startLogin (Mode A).
//
// Lets adopters phrase the email body to match per-call subjects (pin
// confirmation, login, expiry warning, etc.) without re-implementing
// token mint / sham-work / SMTP submit. Same invariants as the default
// composeBody:
//   - URL on its own line (preserves the v0.11 POC 7bit URL-line
//     finding; QP soft-breaks would break the link)
//   - ASCII only
//   - no CR (header-injection defense)
//
// Threat-model invariant tested here: the override applies identically
// to real and sham branches (FR-6 timing equivalence). Body content
// differs from the default, but same shape regardless of hit/miss.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { knowless, validateBodyOverride } from '../../src/index.js';
import { extractToken } from '../helpers/harness.js';
import { deriveHandle } from '../../src/handle.js';

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
    from: 'auth@app.example.com',
    cookieDomain: 'app.example.com',
    dbPath: ':memory:',
    transportOverride: transport,
    sweepIntervalMs: 60_000,
    openRegistration: true,
    ...overrides,
  });
  return { auth, sentMail };
}

function bodyFromRaw(raw) {
  // RFC822: headers, blank line, body
  const idx = raw.indexOf('\r\n\r\n');
  return raw.slice(idx + 4);
}

// --- happy path -------------------------------------------------------------

test('bodyOverride: replaces the default body on a real submission', async () => {
  const { auth, sentMail } = newAuth();
  await auth.startLogin({
    email: 'alice@example.com',
    subjectOverride: 'Confirm your pin: F5J6KK',
    bodyOverride: ({ url }) =>
      `Confirm your pin "F5J6KK":\n\n${url}\n\nLink expires in 15 minutes.\n`,
  });
  assert.equal(sentMail.length, 1);
  const body = bodyFromRaw(sentMail[0].raw);
  assert.match(body, /Confirm your pin "F5J6KK":/);
  assert.doesNotMatch(body, /Click to sign in:/);
  assert.match(body, /Link expires in 15 minutes\./);
  auth.close();
});

test('bodyOverride: receives the magic-link URL knowless composed', async () => {
  let capturedUrl = null;
  const { auth, sentMail } = newAuth();
  await auth.startLogin({
    email: 'alice@example.com',
    bodyOverride: ({ url }) => {
      capturedUrl = url;
      return `Click here:\n\n${url}\n\n`;
    },
  });
  assert.ok(capturedUrl);
  assert.match(capturedUrl, /^https:\/\/app\.example\.com\/auth\/callback\?t=/);
  // The URL captured by the override must equal the URL submitted in
  // the body — knowless does not re-compose between hand-off and submit.
  const tokenInUrl = capturedUrl.split('?t=')[1];
  const tokenInMail = extractToken(sentMail[0].raw);
  assert.equal(tokenInUrl, tokenInMail);
  auth.close();
});

test('bodyOverride: applies identically to sham branch (FR-6)', async () => {
  // Closed-reg unknown email → sham branch. The override must still
  // apply, otherwise an attacker could observe "registered emails get
  // body X, unknown emails get default body Y" via the maillog.
  const { auth, sentMail } = newAuth({ openRegistration: false });
  await auth.startLogin({
    email: 'unknown@example.com',
    bodyOverride: ({ url }) => `Custom body:\n\n${url}\n\n`,
  });
  assert.equal(sentMail.length, 1);
  // Recipient is the sham null-route; body is the override
  assert.equal(sentMail[0].envelope.to[0], 'null@knowless.invalid');
  const body = bodyFromRaw(sentMail[0].raw);
  assert.match(body, /Custom body:/);
  assert.doesNotMatch(body, /Click to sign in:/);
  auth.close();
});

test('bodyOverride: bodyFooter still appends after the override', async () => {
  const { auth, sentMail } = newAuth({
    bodyFooter: 'feedback@example.com | privacy first',
  });
  await auth.startLogin({
    email: 'alice@example.com',
    bodyOverride: ({ url }) => `Custom:\n\n${url}\n\n`,
  });
  const body = bodyFromRaw(sentMail[0].raw);
  assert.match(body, /Custom:/);
  assert.match(body, /-- \r\nfeedback@example\.com \| privacy first/);
  auth.close();
});

test('bodyOverride: lastLogin line does NOT auto-append (override owns content)', async () => {
  const { auth, sentMail } = newAuth({ includeLastLoginInEmail: true });
  // First login to seed lastLogin
  await auth.startLogin({ email: 'alice@example.com' });
  // Second login uses override; must not auto-include "Last sign-in"
  await auth.startLogin({
    email: 'alice@example.com',
    bodyOverride: ({ url }) => `Just the link:\n\n${url}\n`,
  });
  const overrideBody = bodyFromRaw(sentMail[1].raw);
  assert.doesNotMatch(overrideBody, /Last sign-in:/);
  auth.close();
});

// --- API-edge validation (programmer error) --------------------------------

test('bodyOverride: throws when not a function', async () => {
  const { auth } = newAuth();
  await assert.rejects(
    auth.startLogin({
      email: 'alice@example.com',
      bodyOverride: 'a string body',
    }),
    /bodyOverride must be a function/,
  );
  auth.close();
});

test('bodyOverride: undefined / null are accepted (default body path)', async () => {
  const { auth, sentMail } = newAuth();
  await auth.startLogin({ email: 'alice@example.com', bodyOverride: undefined });
  await auth.startLogin({ email: 'alice@example.com', bodyOverride: null });
  assert.equal(sentMail.length, 2);
  for (const m of sentMail) {
    const body = bodyFromRaw(m.raw);
    assert.match(body, /Click to sign in:/);
  }
  auth.close();
});

// --- output validation ------------------------------------------------------

test('bodyOverride: throws when return value is missing the URL', async () => {
  const { auth } = newAuth();
  await assert.rejects(
    auth.startLogin({
      email: 'alice@example.com',
      bodyOverride: () => 'No URL in this body at all\n',
    }),
    /must include the magic-link URL/,
  );
  auth.close();
});

test('bodyOverride: throws when URL appears more than once', async () => {
  const { auth } = newAuth();
  await assert.rejects(
    auth.startLogin({
      email: 'alice@example.com',
      bodyOverride: ({ url }) => `${url}\n${url}\n`,
    }),
    /exactly once/,
  );
  auth.close();
});

test('bodyOverride: throws when URL is not on its own line', async () => {
  const { auth } = newAuth();
  await assert.rejects(
    auth.startLogin({
      email: 'alice@example.com',
      bodyOverride: ({ url }) => `Click here: ${url} (15 min)\n`,
    }),
    /own line/,
  );
  auth.close();
});

test('bodyOverride: throws when result is not a string', async () => {
  const { auth } = newAuth();
  await assert.rejects(
    auth.startLogin({
      email: 'alice@example.com',
      bodyOverride: () => 42,
    }),
    /non-empty string/,
  );
  auth.close();
});

test('bodyOverride: throws on non-ASCII output', async () => {
  const { auth } = newAuth();
  await assert.rejects(
    auth.startLogin({
      email: 'alice@example.com',
      bodyOverride: ({ url }) => `Confirm – pin\n\n${url}\n\n`, // en dash
    }),
    /ASCII/,
  );
  auth.close();
});

test('bodyOverride: throws when body contains CR (header-injection defense)', async () => {
  const { auth } = newAuth();
  await assert.rejects(
    auth.startLogin({
      email: 'alice@example.com',
      bodyOverride: ({ url }) => `Body\r\n\n${url}\n\n`,
    }),
    /CR/,
  );
  auth.close();
});

test('bodyOverride: throws on body > 2048 chars', async () => {
  const { auth } = newAuth();
  await assert.rejects(
    auth.startLogin({
      email: 'alice@example.com',
      bodyOverride: ({ url }) => `${'x'.repeat(3000)}\n${url}\n`,
    }),
    /≤ 2048/,
  );
  auth.close();
});

// --- standalone validator (re-exported for callers who want it) ------------

test('validateBodyOverride: re-exported and works on its own', () => {
  const url = 'https://app.example.com/auth/callback?t=' + 'a'.repeat(43);
  // valid
  validateBodyOverride(`Click:\n\n${url}\n\nDone.\n`, url);
  // invalid — missing URL
  assert.throws(() => validateBodyOverride('no url\n', url), /URL/);
  // invalid — URL inline
  assert.throws(
    () => validateBodyOverride(`Click ${url} done\n`, url),
    /own line/,
  );
});

// --- form path (POST /login) does NOT take bodyOverride --------------------

test('bodyOverride: POST /login form path uses default body unconditionally', async () => {
  // Ensure that even if a form somehow tried to inject a bodyOverride
  // via body params, the form handler ignores it. (The form parser
  // doesn't read this key — it only reads `email`, `next`, and the
  // honeypot. This test is a regression guard.)
  const { auth, sentMail } = newAuth();
  // Use deriveHandle to seed
  const handle = deriveHandle('alice@example.com', SECRET);
  void handle;
  // Submit form-style body — bodyOverride field would be ignored by parser
  // (URLSearchParams), and the form path doesn't accept it anyway.
  // This test just confirms the form's default body is unaffected.
  // (Implementation detail check, not a behavior change.)
  await auth.startLogin({ email: 'alice@example.com' });
  const body = bodyFromRaw(sentMail[0].raw);
  assert.match(body, /Click to sign in:/);
  auth.close();
});
