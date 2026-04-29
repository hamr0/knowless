// v0.2.1 operator-visibility hooks. Three event hooks + one opt-in
// method, all optional. Tests cover: per-event hook payloads,
// suppression-window aggregation semantics, hook-error containment,
// and the verifyTransport() probe.
//
// Threat-model invariants tested here (NFR-10):
//   - sham branches do NOT fire `onMailerSubmit` (would let careless
//     adopter log per-handle data → enumeration oracle)
//   - sham + rate-limit only emerge through the windowed aggregate

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import nodemailer from 'nodemailer';
import { knowless } from '../../src/index.js';
import { fakeReq, fakeRes, formBody } from '../helpers/harness.js';
import { deriveHandle } from '../../src/handle.js';

const SECRET = 'a'.repeat(64);
const REGISTERED = 'alice@example.com';
const UNREGISTERED = 'bob@example.com';

function newAuth(overrides = {}) {
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  return knowless({
    secret: SECRET,
    baseUrl: 'https://app.example.com',
    from: 'auth@app.example.com',
    cookieDomain: 'app.example.com',
    dbPath: ':memory:',
    transportOverride: transport,
    sweepIntervalMs: 60_000,
    ...overrides,
  });
}

async function postLogin(auth, body) {
  const req = fakeReq({
    method: 'POST',
    url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const res = fakeRes();
  await auth.login(req, res);
  return res;
}

// --- onMailerSubmit ---------------------------------------------------------

test('onMailerSubmit: fires on real submission with {messageId, handle, timestamp}', async () => {
  const calls = [];
  const auth = newAuth({
    onMailerSubmit: (payload) => calls.push(payload),
  });
  // Pre-seed REGISTERED so the form-side path goes "real" not sham
  const handle = auth.deriveHandle(REGISTERED);
  // Reach into the store via deriveHandle pattern: use startLogin which
  // requires existing handle in closed-reg, but we've defaulted to
  // closed-reg, so seed first via a back-door:
  // (cleanest path: open-reg + first-hit creates the handle)
  auth.close();

  const auth2 = newAuth({
    openRegistration: true,
    onMailerSubmit: (p) => calls.push(p),
  });
  await postLogin(auth2, formBody({ email: REGISTERED }));

  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(typeof c.messageId, 'string');
  assert.match(c.messageId, /^<.*>$/);
  assert.equal(c.handle, deriveHandle(REGISTERED, SECRET));
  // unused: original handle var
  void handle;
  assert.equal(typeof c.timestamp, 'number');
  assert.ok(c.timestamp > 0);
  auth2.close();
});

test('onMailerSubmit: does NOT fire on sham (closed-reg unknown email)', async () => {
  // Closed registration → unknown email goes sham. No real submission
  // means no per-event onMailerSubmit. This is the load-bearing
  // invariant: the per-event hook must not leak the existence-vs-sham
  // distinction.
  const calls = [];
  const auth = newAuth({
    onMailerSubmit: (p) => calls.push(p),
  });
  await postLogin(auth, formBody({ email: UNREGISTERED }));
  assert.equal(calls.length, 0);
  auth.close();
});

test('onMailerSubmit: hook errors are swallowed', async () => {
  const auth = newAuth({
    openRegistration: true,
    onMailerSubmit: () => {
      throw new Error('boom');
    },
  });
  // Should not throw — hook errors are caught.
  await postLogin(auth, formBody({ email: REGISTERED }));
  auth.close();
});

// --- onTransportFailure -----------------------------------------------------

test('onTransportFailure: fires on SMTP rejection', async () => {
  const calls = [];
  // Build a transport that rejects on sendMail
  const failingTransport = {
    sendMail: async () => {
      throw new Error('connection refused');
    },
    close: () => {},
  };
  const auth = knowless({
    secret: SECRET,
    baseUrl: 'https://app.example.com',
    from: 'auth@app.example.com',
    cookieDomain: 'app.example.com',
    dbPath: ':memory:',
    openRegistration: true,
    transportOverride: failingTransport,
    sweepIntervalMs: 60_000,
    onTransportFailure: (p) => calls.push(p),
  });
  await postLogin(auth, formBody({ email: REGISTERED }));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].error instanceof Error);
  assert.match(calls[0].error.message, /connection refused/);
  assert.equal(typeof calls[0].timestamp, 'number');
  auth.close();
});

// --- onSuppressionWindow ----------------------------------------------------

test('onSuppressionWindow: aggregates sham hits across the window', async () => {
  const calls = [];
  const auth = newAuth({
    onSuppressionWindow: (p) => calls.push(p),
    suppressionWindowMs: 80,
  });
  // Three unknown-email submissions → three sham hits
  await postLogin(auth, formBody({ email: 'a@example.com' }));
  await postLogin(auth, formBody({ email: 'b@example.com' }));
  await postLogin(auth, formBody({ email: 'c@example.com' }));
  // Wait for at least one window emission
  await sleep(120);
  // First emission should report sham=3
  assert.ok(calls.length >= 1, 'expected at least one window emission');
  assert.equal(calls[0].sham, 3);
  assert.equal(calls[0].rateLimited, 0);
  assert.equal(calls[0].windowMs, 80);
  auth.close();
});

test('onSuppressionWindow: aggregates rate-limit hits (login_ip cap)', async () => {
  const calls = [];
  const auth = newAuth({
    openRegistration: true,
    maxLoginRequestsPerIpPerHour: 2,
    onSuppressionWindow: (p) => calls.push(p),
    suppressionWindowMs: 80,
  });
  // Three submissions from same IP — the third should hit the cap
  await postLogin(auth, formBody({ email: 'a@example.com' }));
  await postLogin(auth, formBody({ email: 'b@example.com' }));
  await postLogin(auth, formBody({ email: 'c@example.com' }));
  await sleep(120);
  assert.ok(calls.length >= 1);
  assert.equal(calls[0].rateLimited, 1, 'expected one rate-limit hit on the third request');
  auth.close();
});

test('onSuppressionWindow: heartbeat — fires even when both counters are zero', async () => {
  const calls = [];
  const auth = newAuth({
    onSuppressionWindow: (p) => calls.push(p),
    suppressionWindowMs: 60,
  });
  await sleep(150); // long enough for ~2 windows
  assert.ok(calls.length >= 1, 'heartbeat should emit even with no traffic');
  assert.equal(calls[0].sham, 0);
  assert.equal(calls[0].rateLimited, 0);
  auth.close();
});

test('onSuppressionWindow: counters reset after each emission', async () => {
  const calls = [];
  const auth = newAuth({
    onSuppressionWindow: (p) => calls.push(p),
    suppressionWindowMs: 70,
  });
  await postLogin(auth, formBody({ email: 'first@example.com' }));
  await sleep(100);
  // After first emission, send another sham, wait for second emission
  await postLogin(auth, formBody({ email: 'second@example.com' }));
  await sleep(100);
  assert.ok(calls.length >= 2);
  assert.equal(calls[0].sham, 1);
  // Second window saw exactly one sham, not 1 + 1
  const second = calls[1];
  assert.equal(second.sham, 1, 'counter should reset between windows');
  auth.close();
});

test('onSuppressionWindow: rate-limit + sham co-fire when create_ip cap forces fall-through', async () => {
  // openRegistration true, create_ip cap = 1 → second new-handle attempt
  // hits the create_ip cap, falls through to sham. Both counters tick.
  const calls = [];
  const auth = newAuth({
    openRegistration: true,
    maxNewHandlesPerIpPerHour: 1,
    onSuppressionWindow: (p) => calls.push(p),
    suppressionWindowMs: 80,
  });
  await postLogin(auth, formBody({ email: 'first@example.com' })); // creates
  await postLogin(auth, formBody({ email: 'second@example.com' })); // create_ip → sham
  await sleep(120);
  assert.ok(calls.length >= 1);
  // The second request should have hit BOTH the create_ip rate-limit
  // (counted 1) AND the sham branch (counted 1).
  assert.equal(calls[0].rateLimited, 1);
  assert.equal(calls[0].sham, 1);
  auth.close();
});

test('onSuppressionWindow: per-handle token cap rotation counts as rate-limited', async () => {
  // A real user requesting many tokens for the same handle: each
  // rotation past the per-handle cap counts. Operators see
  // "someone is hammering one handle" without per-event identity leak.
  const calls = [];
  const auth = newAuth({
    openRegistration: true,
    maxActiveTokensPerHandle: 2,
    onSuppressionWindow: (p) => calls.push(p),
    suppressionWindowMs: 80,
  });
  // Same email three times → on the third, oldest token is evicted
  await postLogin(auth, formBody({ email: REGISTERED }));
  await postLogin(auth, formBody({ email: REGISTERED }));
  await postLogin(auth, formBody({ email: REGISTERED }));
  await sleep(120);
  assert.ok(calls.length >= 1);
  assert.equal(calls[0].rateLimited, 1, 'third request should rotate (count as rate-limited)');
  // sham=0 because the email is "registered" (open-reg first-hit
  // created the handle on attempt #1)
  assert.equal(calls[0].sham, 0);
  auth.close();
});

test('onSuppressionWindow: hook errors are swallowed (timer keeps running)', async () => {
  let calls = 0;
  const auth = newAuth({
    onSuppressionWindow: () => {
      calls++;
      throw new Error('boom');
    },
    suppressionWindowMs: 60,
  });
  await sleep(200); // ~3 windows
  assert.ok(calls >= 2, 'timer must keep firing despite hook throws');
  auth.close();
});

test('onSuppressionWindow: timer not started when hook is unwired', async () => {
  // When no onSuppressionWindow is provided, no setInterval slot is
  // spent. Indirect check: close() should not error and there are no
  // emissions to observe (we'd see them via leaked unhandled rejections
  // if anything went wrong).
  const auth = newAuth();
  await sleep(50);
  auth.close();
});

// --- verifyTransport() ------------------------------------------------------

test('verifyTransport: resolves on stream transport (no SMTP session)', async () => {
  const auth = newAuth();
  const result = await auth.verifyTransport();
  assert.equal(result, true);
  auth.close();
});

test('verifyTransport: rejects on transport error', async () => {
  const failingTransport = {
    sendMail: async () => {},
    verify: async () => {
      throw new Error('connection refused');
    },
    close: () => {},
  };
  const auth = knowless({
    secret: SECRET,
    baseUrl: 'https://app.example.com',
    from: 'auth@app.example.com',
    cookieDomain: 'app.example.com',
    dbPath: ':memory:',
    transportOverride: failingTransport,
    sweepIntervalMs: 60_000,
  });
  await assert.rejects(auth.verifyTransport(), /connection refused/);
  auth.close();
});

// --- option validation ------------------------------------------------------

test('factory throws when hook option is not a function', () => {
  assert.throws(
    () =>
      knowless({
        secret: SECRET,
        baseUrl: 'https://x.com',
        from: 'a@x.com',
        onMailerSubmit: 'not a function',
      }),
    /onMailerSubmit must be a function/,
  );
  assert.throws(
    () =>
      knowless({
        secret: SECRET,
        baseUrl: 'https://x.com',
        from: 'a@x.com',
        onSuppressionWindow: 42,
      }),
    /onSuppressionWindow must be a function/,
  );
});

test('factory throws on invalid suppressionWindowMs', () => {
  assert.throws(
    () =>
      knowless({
        secret: SECRET,
        baseUrl: 'https://x.com',
        from: 'a@x.com',
        suppressionWindowMs: -1,
      }),
    /suppressionWindowMs must be a positive number/,
  );
  assert.throws(
    () =>
      knowless({
        secret: SECRET,
        baseUrl: 'https://x.com',
        from: 'a@x.com',
        suppressionWindowMs: 'sixty',
      }),
    /suppressionWindowMs must be a positive number/,
  );
});
