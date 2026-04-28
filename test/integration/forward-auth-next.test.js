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

async function postLoginWithNext(handlers, email, next) {
  const req = fakeReq({
    method: 'POST',
    url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ email, next: next ?? '' }),
  });
  const res = fakeRes();
  await handlers.login(req, res);
  return res;
}

test('valid same-domain next: token row carries it, callback redirects there', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLoginWithNext(
    h.handlers,
    REGISTERED,
    'https://kuma.app.example.com/dashboard?from=mail',
  );

  const token = extractToken(h.sentMail[0].raw);
  const row = h.store.getToken(hashToken(token));
  assert.equal(row.nextUrl, 'https://kuma.app.example.com/dashboard?from=mail');

  // Redeem
  const req = fakeReq({ method: 'GET', url: `/auth/callback?t=${token}` });
  const res = fakeRes();
  await h.handlers.callback(req, res);

  assert.equal(res.statusCode, 302);
  assert.equal(res._headers['location'], 'https://kuma.app.example.com/dashboard?from=mail');
  h.close();
});

test('valid same-eTLD subdomain next is accepted', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLoginWithNext(h.handlers, REGISTERED, 'https://adguard.app.example.com/');

  const token = extractToken(h.sentMail[0].raw);
  const row = h.store.getToken(hashToken(token));
  assert.equal(row.nextUrl, 'https://adguard.app.example.com/');
  h.close();
});

test('cross-domain next is silently dropped (token has no nextUrl)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLoginWithNext(h.handlers, REGISTERED, 'https://evil.example.org/steal');

  const token = extractToken(h.sentMail[0].raw);
  const row = h.store.getToken(hashToken(token));
  assert.equal(row.nextUrl, null);

  // Redemption uses the default destination (baseUrl/)
  const req = fakeReq({ method: 'GET', url: `/auth/callback?t=${token}` });
  const res = fakeRes();
  await h.handlers.callback(req, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res._headers['location'], 'https://app.example.com/');
  h.close();
});

test('javascript: URL next is rejected', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLoginWithNext(h.handlers, REGISTERED, 'javascript:alert(1)');

  const token = extractToken(h.sentMail[0].raw);
  const row = h.store.getToken(hashToken(token));
  assert.equal(row.nextUrl, null);
  h.close();
});

test('overlong next is rejected', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  const huge = 'https://app.example.com/' + 'a'.repeat(2100);
  await postLoginWithNext(h.handlers, REGISTERED, huge);

  const token = extractToken(h.sentMail[0].raw);
  const row = h.store.getToken(hashToken(token));
  assert.equal(row.nextUrl, null);
  h.close();
});

test('validateNextUrl: spec helper exposes the same logic', () => {
  const h = newHarness();
  assert.equal(
    h.handlers.validateNextUrl('https://kuma.app.example.com/x'),
    'https://kuma.app.example.com/x',
  );
  assert.equal(h.handlers.validateNextUrl('https://evil.example.org/'), null);
  assert.equal(h.handlers.validateNextUrl('javascript:alert(1)'), null);
  assert.equal(h.handlers.validateNextUrl(''), null);
  assert.equal(h.handlers.validateNextUrl(null), null);
  h.close();
});
