import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newHarness,
  fakeReq,
  fakeRes,
  formBody,
  parseSetCookie,
  extractToken,
  TEST_SECRET,
} from '../helpers/harness.js';
import { deriveHandle } from '../../src/handle.js';

const REGISTERED = 'alice@example.com';

async function postLogin(handlers, body, headers = {}) {
  const req = fakeReq({
    method: 'POST',
    url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body,
  });
  const res = fakeRes();
  await handlers.login(req, res);
  return res;
}

async function getCallback(handlers, token) {
  const req = fakeReq({ method: 'GET', url: `/auth/callback?t=${token}` });
  const res = fakeRes();
  await handlers.callback(req, res);
  return res;
}

function getVerify(handlers, cookieValue) {
  const req = fakeReq({
    method: 'GET',
    url: '/verify',
    headers: { cookie: `knowless_session=${cookieValue}` },
  });
  const res = fakeRes();
  handlers.verify(req, res);
  return res;
}

async function postLogout(handlers, cookieValue) {
  const req = fakeReq({
    method: 'POST',
    url: '/logout',
    headers: { cookie: `knowless_session=${cookieValue}` },
  });
  const res = fakeRes();
  await handlers.logout(req, res);
  return res;
}

test('full flow: register handle → login → click → session → verify', async () => {
  const h = newHarness();
  // pre-register alice
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  // POST /login
  const loginRes = await postLogin(h.handlers, formBody({ email: REGISTERED }));
  assert.equal(loginRes.statusCode, 200);
  assert.match(loginRes._headers['content-type'], /text\/html/);
  assert.equal(h.sentMail.length, 1);
  assert.equal(h.sentMail[0].envelope.to[0], REGISTERED);

  // Extract token, hit callback
  const token = extractToken(h.sentMail[0].raw);
  assert.ok(token);
  const cbRes = await getCallback(h.handlers, token);
  assert.equal(cbRes.statusCode, 302);
  const cookie = parseSetCookie(cbRes._setCookies[0]);
  assert.equal(cookie.name, 'knowless_session');
  assert.ok(cookie.value);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.httponly, true);
  assert.equal(cookie.samesite, 'Lax');
  assert.equal(cookie.domain, 'app.example.com');

  // /verify with the cookie returns 200 + handle
  const vRes = getVerify(h.handlers, cookie.value);
  assert.equal(vRes.statusCode, 200);
  assert.equal(vRes._headers['x-user-handle'], deriveHandle(REGISTERED, TEST_SECRET));

  h.close();
});

test('replay: redeeming the same token a second time fails silently', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);

  const first = await getCallback(h.handlers, token);
  assert.equal(first.statusCode, 302);
  assert.ok(first._setCookies.length === 1);

  const replay = await getCallback(h.handlers, token);
  assert.equal(replay.statusCode, 302);
  assert.equal(replay._headers['location'], '/login');
  assert.equal(replay._setCookies.length, 0);
  h.close();
});

test('verify: bad / missing / malformed cookie returns 401', () => {
  const h = newHarness();
  // no cookie
  const r1 = fakeRes();
  h.handlers.verify(fakeReq({ url: '/verify' }), r1);
  assert.equal(r1.statusCode, 401);

  // garbled
  assert.equal(getVerify(h.handlers, 'garbage').statusCode, 401);
  // tampered: fresh cookie with last char flipped
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  // (use a synthetic cookie shape we know is tamperable)
  assert.equal(
    getVerify(h.handlers, 'sid.' + 'a'.repeat(64)).statusCode,
    401,
  );
  h.close();
});

test('logout: clears the session row and the client cookie', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);
  const cbRes = await getCallback(h.handlers, token);
  const cookie = parseSetCookie(cbRes._setCookies[0]);

  const logoutRes = await postLogout(h.handlers, cookie.value);
  assert.equal(logoutRes.statusCode, 200);
  const cleared = parseSetCookie(logoutRes._setCookies[0]);
  assert.equal(cleared.value, '');
  assert.equal(cleared['max-age'], '0');

  // Subsequent verify with the same cookie now fails (session row deleted)
  assert.equal(getVerify(h.handlers, cookie.value).statusCode, 401);
  h.close();
});

test('expired token: redemption fails silently', async () => {
  const h = newHarness({ tokenTtlSeconds: 0 }); // immediate expiry
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);
  // Wait a tick to ensure expires_at <= now
  await new Promise((r) => setTimeout(r, 1));
  const cbRes = await getCallback(h.handlers, token);
  assert.equal(cbRes.statusCode, 302);
  assert.equal(cbRes._headers['location'], '/login');
  assert.equal(cbRes._setCookies.length, 0);
  h.close();
});

test('login response: same shape (200 OK text/html) for hit and miss', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  const hitRes = await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const missRes = await postLogin(h.handlers, formBody({ email: 'nobody@example.com' }));

  assert.equal(hitRes.statusCode, missRes.statusCode);
  assert.equal(hitRes._headers['content-type'], missRes._headers['content-type']);
  assert.equal(hitRes._headers['cache-control'], missRes._headers['cache-control']);
  // Both responses contain the confirmation message
  assert.match(hitRes._body, /sign-in link is on its way/);
  assert.match(missRes._body, /sign-in link is on its way/);
  h.close();
});

test('concurrent redemption: exactly one of N parallel callbacks wins (closes AF-1.4)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);

  // Fire 8 callback redemptions in parallel. better-sqlite3 is
  // synchronous so JavaScript runs them serially — but we still
  // assert the contract: markTokenUsed's atomic transition means
  // exactly one redemption sees usedAt=NULL and creates a session;
  // the rest see usedAt != NULL and redirect to /login.
  //
  // If anyone changes the order of the dual checks (read-side
  // `row.usedAt != null` AND write-side `markTokenUsed` returns
  // false on already-used) such that a race window opens, this
  // test catches it under any future async path the callback
  // might gain (e.g., if we ever made store calls async).
  const results = await Promise.all(
    Array.from({ length: 8 }, () => getCallback(h.handlers, token)),
  );

  const wins = results.filter((r) => r._setCookies.length === 1);
  const losses = results.filter((r) => r._setCookies.length === 0);

  assert.equal(wins.length, 1, 'exactly one redemption must succeed');
  assert.equal(losses.length, 7, 'all other redemptions must fail silently');

  // Loser shape: 302 to /login, no cookie (same as expired/never-existed)
  for (const loss of losses) {
    assert.equal(loss.statusCode, 302);
    assert.equal(loss._headers['location'], '/login');
  }

  // Winner shape: 302 with cookie set
  assert.equal(wins[0].statusCode, 302);
  h.close();
});

test('expired session: verify returns 401 (closes AF-1.3)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);
  const cbRes = await getCallback(h.handlers, token);
  const cookie = parseSetCookie(cbRes._setCookies[0]);

  // Sanity: the cookie works right now
  assert.equal(getVerify(h.handlers, cookie.value).statusCode, 200);

  // Force-expire the session row by rewriting expires_at to the past.
  // SPEC §9 verify path checks `expiresAt <= now()`; this is the branch
  // we need to exercise but never could with a freshly-created session.
  const allSessions = h.store.sweepSessions(0); // no-op count read
  void allSessions;
  // Use the underlying DB by manually opening a row and updating.
  // The store doesn't expose a mutate-expiry method (and shouldn't —
  // it's a test concern); we go through the only exposed knob: delete
  // and re-insert with a past expiry.
  // The handle is the same as derived; sid_hash is opaque, so we
  // recompute it from the cookie value.
  const sid = cookie.value.split('.')[0];
  const crypto = await import('node:crypto');
  const sidHash = crypto
    .createHash('sha256')
    .update(Buffer.from(sid, 'base64url'))
    .digest('hex');
  h.store.deleteSession(sidHash);
  h.store.insertSession(sidHash, deriveHandle(REGISTERED, TEST_SECRET), Date.now() - 1000);

  // Now the verify path's expiry branch should fire.
  assert.equal(getVerify(h.handlers, cookie.value).statusCode, 401);
  h.close();
});

test('handleFromRequest: returns handle for valid cookie (closes AF-2.8)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);
  const cbRes = await getCallback(h.handlers, token);
  const cookie = parseSetCookie(cbRes._setCookies[0]);

  const req = fakeReq({
    url: '/anywhere',
    headers: { cookie: `knowless_session=${cookie.value}` },
  });
  const handle = h.handlers.handleFromRequest(req);
  assert.equal(handle, deriveHandle(REGISTERED, TEST_SECRET));
  h.close();
});

test('handleFromRequest: returns null on no/malformed/expired/wrong-sig cookies (AF-2.8)', async () => {
  const h = newHarness();
  // No cookie at all
  assert.equal(h.handlers.handleFromRequest(fakeReq({})), null);
  // Empty cookie header
  assert.equal(
    h.handlers.handleFromRequest(fakeReq({ headers: { cookie: '' } })),
    null,
  );
  // Cookie present but no knowless_session
  assert.equal(
    h.handlers.handleFromRequest(fakeReq({ headers: { cookie: 'other=foo' } })),
    null,
  );
  // Malformed (no dot)
  assert.equal(
    h.handlers.handleFromRequest(
      fakeReq({ headers: { cookie: 'knowless_session=garbage' } }),
    ),
    null,
  );
  // Wrong signature on a valid-looking sid
  assert.equal(
    h.handlers.handleFromRequest(
      fakeReq({
        headers: {
          cookie: `knowless_session=${'A'.repeat(43)}.${'a'.repeat(64)}`,
        },
      }),
    ),
    null,
  );
  h.close();
});

test('handleFromRequest: returns null when session row is expired (AF-2.8 + AF-1.3)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);
  const cbRes = await getCallback(h.handlers, token);
  const cookie = parseSetCookie(cbRes._setCookies[0]);

  // Force-expire the session row.
  const sid = cookie.value.split('.')[0];
  const crypto = await import('node:crypto');
  const sidHash = crypto
    .createHash('sha256')
    .update(Buffer.from(sid, 'base64url'))
    .digest('hex');
  h.store.deleteSession(sidHash);
  h.store.insertSession(sidHash, deriveHandle(REGISTERED, TEST_SECRET), Date.now() - 1000);

  const req = fakeReq({ headers: { cookie: `knowless_session=${cookie.value}` } });
  assert.equal(h.handlers.handleFromRequest(req), null);
  h.close();
});

test('login form GET: renders the bare form with hidden next', () => {
  const h = newHarness();
  const req = fakeReq({ url: '/login?next=https://kuma.app.example.com/dash' });
  const res = fakeRes();
  h.handlers.loginForm(req, res);
  assert.equal(res.statusCode, 200);
  assert.match(res._body, /<form/);
  assert.match(
    res._body,
    /<input type="hidden" name="next" value="https:\/\/kuma\.app\.example\.com\/dash"/,
  );
  h.close();
});
