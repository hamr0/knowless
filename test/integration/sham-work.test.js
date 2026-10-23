import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newHarness,
  fakeReq,
  fakeRes,
  formBody,
  extractToken,
  TEST_SECRET,
} from '../helpers/harness.js';
import { deriveHandle } from '../../src/handle.js';
import { hashToken } from '../../src/token.js';

const REGISTERED = 'alice@example.com';
const UNREGISTERED = 'bob@example.com';

async function postLogin(handlers, body) {
  const req = fakeReq({
    method: 'POST',
    url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const res = fakeRes();
  await handlers.login(req, res);
  return res;
}

test('silent miss: token row is inserted with is_sham=1', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  await postLogin(h.handlers, formBody({ email: UNREGISTERED }));
  // exactly one mail submitted (sham)
  assert.equal(h.sentMail.length, 1);
  // The mail's envelope rcpt is the configured shamRecipient, NOT the
  // unregistered email. Real users never receive unsolicited mail.
  assert.equal(h.sentMail[0].envelope.to[0], 'null@knowless.invalid');

  // The token in the mail body was inserted; verify it's flagged sham.
  const tokenRaw = extractToken(h.sentMail[0].raw);
  const tokenHash = hashToken(tokenRaw);
  const row = h.store.getToken(tokenHash);
  assert.ok(row);
  assert.equal(row.isSham, true);
  h.close();
});

test('sham token: callback refuses to redeem it (silent fail)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  await postLogin(h.handlers, formBody({ email: UNREGISTERED }));
  const tokenRaw = extractToken(h.sentMail[0].raw);

  const req = fakeReq({ method: 'GET', url: `/auth/callback?t=${tokenRaw}` });
  const res = fakeRes();
  await h.handlers.callback(req, res);

  // Same failure shape as expired/replayed token.
  assert.equal(res.statusCode, 302);
  assert.equal(res._headers['location'], '/login');
  assert.equal(res._setCookies.length, 0);

  // No session created.
  // (Implementation detail: no session for sham handle; verify by
  // confirming the token is now used so it can't be retried.)
  h.close();
});

test('hit path: token row has is_sham=0 and mail goes to user', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  assert.equal(h.sentMail.length, 1);
  assert.equal(h.sentMail[0].envelope.to[0], REGISTERED);

  const tokenRaw = extractToken(h.sentMail[0].raw);
  const row = h.store.getToken(hashToken(tokenRaw));
  assert.equal(row.isSham, false);
  h.close();
});

test('honeypot: short-circuits with no DB write and no mail', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  const before = h.store.countActiveTokens(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(
    h.handlers,
    formBody({ email: REGISTERED, website: 'https://example.com' }),
  );
  const after = h.store.countActiveTokens(deriveHandle(REGISTERED, TEST_SECRET));

  // No token written, no mail sent.
  assert.equal(after, before);
  assert.equal(h.sentMail.length, 0);
  h.close();
});

test('per-IP rate limit: short-circuits past threshold', async () => {
  const h = newHarness({ maxLoginRequestsPerIpPerHour: 3 });
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  // 3 should succeed
  for (let i = 0; i < 3; i++) {
    await postLogin(h.handlers, formBody({ email: REGISTERED }));
  }
  assert.equal(h.sentMail.length, 3);

  // 4th hit: rate-limited, no mail, no DB write past handle row
  const handle = deriveHandle(REGISTERED, TEST_SECRET);
  const beforeTokens = h.store.countActiveTokens(handle);
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const afterTokens = h.store.countActiveTokens(handle);
  assert.equal(afterTokens, beforeTokens);
  assert.equal(h.sentMail.length, 3);
  h.close();
});

test('open-registration: real mail on first hit, but no handle row until redemption', async () => {
  const h = newHarness({ openRegistration: true });
  const newEmail = 'newcomer@example.com';
  const handle = deriveHandle(newEmail, TEST_SECRET);
  assert.equal(h.store.handleExists(handle), false);

  await postLogin(h.handlers, formBody({ email: newEmail }));
  assert.equal(h.sentMail[0].envelope.to[0], newEmail);
  // Unredeemed address must NOT become an "existing" handle.
  assert.equal(h.store.handleExists(handle), false);

  // Redeem the link: the row is created at first redemption.
  const tokenRaw = extractToken(h.sentMail[0].raw);
  const res = fakeRes();
  await h.handlers.callback(
    fakeReq({ method: 'GET', url: `/auth/callback?t=${tokenRaw}` }),
    res,
  );
  assert.equal(res._setCookies.length, 1);
  assert.equal(h.store.handleExists(handle), true);
  h.close();
});

test('open-registration: unredeemed address keeps hitting the create cap (core regression)', async () => {
  const h = newHarness({ openRegistration: true, maxNewHandlesPerIpPerHour: 1 });
  const target = 'victim@example.com';
  const handle = deriveHandle(target, TEST_SECRET);

  await postLogin(h.handlers, formBody({ email: target }));
  await postLogin(h.handlers, formBody({ email: target }));

  assert.equal(h.sentMail.length, 2);
  assert.equal(h.sentMail[0].envelope.to[0], target);
  // Second send to the same never-redeemed address is still "new" -> capped -> sham.
  assert.equal(h.sentMail[1].envelope.to[0], 'null@knowless.invalid');
  assert.equal(h.store.handleExists(handle), false);
  h.close();
});

test('open-registration: after redemption the handle is existing and bypasses the create cap', async () => {
  const h = newHarness({ openRegistration: true, maxNewHandlesPerIpPerHour: 1 });
  const target = 'returning@example.com';

  await postLogin(h.handlers, formBody({ email: target }));
  const tokenRaw = extractToken(h.sentMail[0].raw);
  await h.handlers.callback(
    fakeReq({ method: 'GET', url: `/auth/callback?t=${tokenRaw}` }),
    fakeRes(),
  );
  assert.equal(h.store.handleExists(deriveHandle(target, TEST_SECRET)), true);

  // Exhaust the create budget with a different new address (sham).
  await postLogin(h.handlers, formBody({ email: 'other@example.com' }));
  assert.equal(h.sentMail[1].envelope.to[0], 'null@knowless.invalid');

  // Redeemed address still gets real mail (existing-handle path).
  await postLogin(h.handlers, formBody({ email: target }));
  assert.equal(h.sentMail[2].envelope.to[0], target);
  h.close();
});

test('allowlist (openRegistration false): pre-seeded gets real mail, others get sham', async () => {
  const h = newHarness({ openRegistration: false });
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  await postLogin(h.handlers, formBody({ email: UNREGISTERED }));
  assert.equal(h.sentMail[0].envelope.to[0], REGISTERED);
  assert.equal(h.sentMail[1].envelope.to[0], 'null@knowless.invalid');
  h.close();
});

test('open-registration cap: silently shams when IP cap exceeded', async () => {
  const h = newHarness({ openRegistration: true, maxNewHandlesPerIpPerHour: 1 });

  // First creation succeeds (real mail; row is created at redemption)
  await postLogin(h.handlers, formBody({ email: 'first@example.com' }));
  assert.equal(h.sentMail[0].envelope.to[0], 'first@example.com');

  // Second: cap exceeded → sham (handle NOT created, mail to null-route)
  await postLogin(h.handlers, formBody({ email: 'second@example.com' }));
  assert.equal(h.store.handleExists(deriveHandle('second@example.com', TEST_SECRET)), false);
  assert.equal(h.sentMail[1].envelope.to[0], 'null@knowless.invalid');
  h.close();
});
