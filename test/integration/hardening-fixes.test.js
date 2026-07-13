// Regression tests for the v1.3.4 hardening batch (code-review findings).
// Each test targets one defect and is written to fail against the
// pre-fix code and pass after the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newHarness,
  fakeReq,
  fakeRes,
  formBody,
  TEST_SECRET,
} from '../helpers/harness.js';
import { createHandlers } from '../../src/handlers.js';
import { deriveHandle } from '../../src/handle.js';

const REGISTERED = 'alice@example.com';

async function postLogin(handlers, body, headers) {
  const req = fakeReq({
    method: 'POST',
    url: '/login',
    headers: headers ?? { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const res = fakeRes();
  await handlers.login(req, res);
  return res;
}

// Finding: per-IP cap is checked before the awaited mailer.submit() but
// incremented only after it, so concurrent requests from one IP all read a
// stale count and the cap never binds.
test('rate-limit race: concurrent requests from one IP cannot exceed the cap', async () => {
  const h = newHarness({ maxLoginRequestsPerIpPerHour: 3 });
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  // Fire 8 requests concurrently from the same IP. With the check-then-
  // increment race, all 8 pass the check and 8 mails go out. With the
  // reserve-before-send fix, only the cap (3) may send.
  await Promise.all(
    Array.from({ length: 8 }, () =>
      postLogin(h.handlers, formBody({ email: REGISTERED })),
    ),
  );

  assert.equal(h.sentMail.length, 3);
  h.close();
});

// Finding: default confirmationMessage carried <strong> markup, but the form
// HTML-escapes the whole message (AF-6.5), so the default rendered literal
// angle-bracket tags as visible text.
test('default confirmation message renders without literal escaped tags', async () => {
  const h = newHarness();
  const res = await postLogin(h.handlers, formBody({ email: REGISTERED }));

  assert.equal(res.statusCode, 200);
  // No literal &lt;strong&gt; leaking into the page.
  assert.ok(!res._body.includes('&lt;strong&gt;'), 'must not show escaped <strong> tags');
  assert.ok(!res._body.includes('&lt;/strong&gt;'));
  // The confirmation text still renders and echoes the email.
  assert.match(res._body, /is registered/);
  assert.match(res._body, /alice@example\.com/);
  h.close();
});

// Finding: honeypot short-circuit only fired for a non-empty STRING, so a
// JSON body with a non-string honeypot value (true/number/array) skipped the
// trap and proceeded through the full send path.
test('honeypot trips on a non-string JSON value', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  await postLogin(
    h.handlers,
    JSON.stringify({ email: REGISTERED, website: true }),
    { 'content-type': 'application/json' },
  );

  // Trap sprung: no mail, no send path.
  assert.equal(h.sentMail.length, 0);
  h.close();
});

test('honeypot does NOT trip on an empty value (legitimate submission)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  await postLogin(
    h.handlers,
    JSON.stringify({ email: REGISTERED, website: '' }),
    { 'content-type': 'application/json' },
  );

  // Empty honeypot is what a real browser sends — must go through.
  assert.equal(h.sentMail.length, 1);
  assert.equal(h.sentMail[0].envelope.to[0], REGISTERED);
  h.close();
});

// Finding (9a): inside the FR-6 "equivalent-work region" the real-handle path
// did an extra store.getLastLogin() lookup that the sham path did not, so hit
// and miss were not work-equivalent — a faint timing/enumeration oracle. Both
// paths must now perform the same indexed lookup.
test('FR-6 equivalence: hit and miss both perform the getLastLogin lookup', async () => {
  const h = newHarness(); // includeLastLoginInEmail defaults to true
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  const calls = [];
  const orig = h.store.getLastLogin.bind(h.store);
  h.store.getLastLogin = (handle) => {
    calls.push(handle);
    return orig(handle);
  };

  // Real (registered) path.
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const afterHit = calls.length;
  assert.equal(afterHit, 1, 'registered path reads getLastLogin once');

  // Sham (unregistered) path must do the same lookup.
  await postLogin(h.handlers, formBody({ email: 'nobody@example.com' }));
  assert.equal(
    calls.length - afterHit,
    1,
    'unregistered (sham) path must also read getLastLogin once',
  );
  h.close();
});

// Finding: createHandlers validated only the LENGTH of config.secret, not
// that it is hex — a non-hex 64-char secret constructed successfully and blew
// up at the first login instead of at startup. Align with knowless()/index.js.
test('createHandlers rejects a non-hex secret at construction', () => {
  const h = newHarness();
  assert.throws(
    () =>
      createHandlers({
        store: h.store,
        mailer: h.mailer,
        config: { ...h.config, secret: 'z'.repeat(64) },
      }),
    /hex/,
  );
  h.close();
});
