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

test('cookieSecure=true (default): callback emits Secure flag (closes AF-4.4)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);
  const cbRes = await getCallback(h.handlers, token);
  const setCookie = cbRes._setCookies[0];
  assert.match(setCookie, /;\s*Secure/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  h.close();
});

test('cookieSecure=false: callback omits Secure (localhost dev) (AF-4.4)', async () => {
  const h = newHarness({ cookieSecure: false });
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);
  const cbRes = await getCallback(h.handlers, token);
  const setCookie = cbRes._setCookies[0];
  // No Secure (the only word that should be missing)
  assert.equal(/;\s*Secure/.test(setCookie), false);
  // HttpOnly + SameSite remain — those are always-on
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  h.close();
});

test('cookieSecure=false: logout-clear cookie also omits Secure (AF-4.4)', async () => {
  const h = newHarness({ cookieSecure: false });
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);
  const cbRes = await getCallback(h.handlers, token);
  const cookie = parseSetCookie(cbRes._setCookies[0]);

  const logoutReq = fakeReq({
    method: 'POST',
    url: '/logout',
    headers: { cookie: `knowless_session=${cookie.value}` },
  });
  const logoutRes = fakeRes();
  await h.handlers.logout(logoutReq, logoutRes);
  const cleared = logoutRes._setCookies[0];
  assert.equal(/;\s*Secure/.test(cleared), false);
  h.close();
});

async function postLoginWithOrigin(handlers, body, origin) {
  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (origin) headers.origin = origin;
  const req = fakeReq({ method: 'POST', url: '/login', headers, body });
  const res = fakeRes();
  await handlers.login(req, res);
  return res;
}

test('Origin absent: allowed (curl/programmatic) (closes AF-4.3)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  // No Origin header → ALLOW. Mail goes out.
  await postLoginWithOrigin(h.handlers, formBody({ email: REGISTERED }), null);
  assert.equal(h.sentMail.length, 1);
  h.close();
});

test('Origin same-domain: allowed (AF-4.3)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLoginWithOrigin(
    h.handlers,
    formBody({ email: REGISTERED }),
    'https://app.example.com',
  );
  assert.equal(h.sentMail.length, 1);
  h.close();
});

test('Origin subdomain of cookieDomain: allowed (AF-4.3)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLoginWithOrigin(
    h.handlers,
    formBody({ email: REGISTERED }),
    'https://kuma.app.example.com',
  );
  assert.equal(h.sentMail.length, 1);
  h.close();
});

test('Origin cross-domain: rejected silently (AF-4.3)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  // Foreign Origin: short-circuit before any DB write or mail send.
  const handle = deriveHandle(REGISTERED, TEST_SECRET);
  const beforeTokens = h.store.countActiveTokens(handle);
  const res = await postLoginWithOrigin(
    h.handlers,
    formBody({ email: REGISTERED }),
    'https://evil.example.org',
  );
  // Same response shape as a legitimate request — no signal to attacker.
  assert.equal(res.statusCode, 200);
  assert.match(res._headers['content-type'], /text\/html/);
  // No DB write, no mail.
  assert.equal(h.store.countActiveTokens(handle), beforeTokens);
  assert.equal(h.sentMail.length, 0);
  h.close();
});

test('Referer fallback when Origin absent: cross-domain rejected (AF-4.3)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  const req = fakeReq({
    method: 'POST',
    url: '/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: 'https://evil.example.org/some/page',
    },
    body: formBody({ email: REGISTERED }),
  });
  const res = fakeRes();
  await h.handlers.login(req, res);
  assert.equal(h.sentMail.length, 0);
  h.close();
});

test('Origin malformed: rejected (AF-4.3)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLoginWithOrigin(
    h.handlers,
    formBody({ email: REGISTERED }),
    'not-a-url',
  );
  assert.equal(h.sentMail.length, 0);
  h.close();
});

test('Origin javascript: scheme: rejected (no hostname) (AF-4.3)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLoginWithOrigin(
    h.handlers,
    formBody({ email: REGISTERED }),
    'javascript:alert(1)',
  );
  assert.equal(h.sentMail.length, 0);
  h.close();
});

test('concurrent issuance respects maxActive cap (closes AF-4.1)', async () => {
  const h = newHarness({ maxActiveTokensPerHandle: 3 });
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

  // Fire 10 parallel login submissions for the same handle. Each one
  // should attempt token insertion; the per-handle cap with eviction
  // (SPEC §4.7 BEGIN IMMEDIATE) must hold the active count at 3.
  await Promise.all(
    Array.from({ length: 10 }, () =>
      postLogin(h.handlers, formBody({ email: REGISTERED })),
    ),
  );

  const handle = deriveHandle(REGISTERED, TEST_SECRET);
  const active = h.store.countActiveTokens(handle);
  assert.equal(active, 3, 'cap must hold under contention');
  // 10 mails went out (every login submission triggered one — the cap
  // limits ACTIVE rows in the store, not mails-sent counts).
  assert.equal(h.sentMail.length, 10);
  h.close();
});

test('SMTP failure: response shape identical to success (closes AF-4.2)', async () => {
  // First, capture a known-good response shape.
  const ok = newHarness();
  ok.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  const okRes = await postLogin(ok.handlers, formBody({ email: REGISTERED }));
  ok.close();

  // Now build a harness with a failing mailer and re-issue.
  const fail = newHarness();
  fail.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  // Replace mailer.submit with a function that throws — same contract
  // a real Postfix-down or network-broken submission would hit.
  fail.handlers._config; // touch for parity
  const origSubmit = fail.mailer.submit;
  fail.mailer.submit = async () => {
    throw new Error('simulated SMTP failure: connection refused');
  };
  const failRes = await postLogin(fail.handlers, formBody({ email: REGISTERED }));

  // Per NFR-10: SMTP failure logged, never leaked. Status, content-type,
  // cache-control, and the structural body must match.
  assert.equal(failRes.statusCode, okRes.statusCode);
  assert.equal(
    failRes._headers['content-type'],
    okRes._headers['content-type'],
  );
  assert.equal(
    failRes._headers['cache-control'],
    okRes._headers['cache-control'],
  );
  // Body should still contain the confirmation message.
  assert.match(failRes._body, /sign-in link is on its way/);
  // No 500, no error visible in headers, no error body.
  assert.equal(/error|fail|smtp/i.test(failRes._headers['content-type']), false);

  fail.mailer.submit = origSubmit;
  fail.close();
});

test('cookie parser: edge cases all behave correctly (closes AF-5.2)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const token = extractToken(h.sentMail[0].raw);
  const cbRes = await getCallback(h.handlers, token);
  const cookie = parseSetCookie(cbRes._setCookies[0]);
  const v = cookie.value;

  // Baseline: bare cookie works.
  assert.ok(
    h.handlers.handleFromRequest(
      fakeReq({ headers: { cookie: `knowless_session=${v}` } }),
    ),
  );

  // Extra surrounding whitespace and trailing semicolon.
  assert.ok(
    h.handlers.handleFromRequest(
      fakeReq({ headers: { cookie: `  knowless_session=${v}  ;` } }),
    ),
  );

  // Cookie at non-first position — must still be found.
  assert.ok(
    h.handlers.handleFromRequest(
      fakeReq({
        headers: { cookie: `other=foo; knowless_session=${v}; another=bar` },
      }),
    ),
  );

  // Duplicate cookie names — first occurrence wins per RFC 6265 §5.3.
  // Second is junk; first is the valid one.
  assert.ok(
    h.handlers.handleFromRequest(
      fakeReq({
        headers: { cookie: `knowless_session=${v}; knowless_session=garbage` },
      }),
    ),
  );

  // Name confusion: 'knowless_session_extra' MUST NOT match 'knowless_session'.
  assert.equal(
    h.handlers.handleFromRequest(
      fakeReq({
        headers: { cookie: `knowless_session_extra=${v}` },
      }),
    ),
    null,
  );

  // Empty value: 'knowless_session=' returns the empty string, which
  // verifySessionSignature rejects (no dot found).
  assert.equal(
    h.handlers.handleFromRequest(
      fakeReq({ headers: { cookie: 'knowless_session=' } }),
    ),
    null,
  );

  // Cookie part with no '=': skip and continue.
  assert.ok(
    h.handlers.handleFromRequest(
      fakeReq({
        headers: { cookie: `bare-token; knowless_session=${v}` },
      }),
    ),
  );

  // Cookie with just '=value' (empty name): skip.
  assert.equal(
    h.handlers.handleFromRequest(
      fakeReq({ headers: { cookie: `=garbage; other=foo` } })
    ),
    null,
  );
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

// --- AF-6.1: revokeSessions ---

test('revokeSessions: drops every session for handle, keeps account (AF-6.1)', async () => {
  const h = newHarness();
  // Issue two sessions for alice by going through login/callback twice.
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  for (let i = 0; i < 2; i++) {
    const before = h.sentMail.length;
    await postLogin(h.handlers, formBody({ email: REGISTERED }));
    const tok = extractToken(h.sentMail[before].raw);
    await getCallback(h.handlers, tok);
  }
  const handle = deriveHandle(REGISTERED, TEST_SECRET);
  // Sanity: handle still exists.
  assert.equal(h.store.handleExists(handle), true);

  // Hand the public API a string handle and confirm rows go.
  const auth = { revokeSessions: (hd) => h.store.revokeSessions(hd) };
  const removed = auth.revokeSessions(handle);
  assert.equal(removed, 2);

  // Handle survives — this is "log out everywhere," not deleteHandle.
  assert.equal(h.store.handleExists(handle), true);
  // Calling again is a no-op.
  assert.equal(auth.revokeSessions(handle), 0);
  h.close();
});

// --- AF-6.4: POST /logout Origin validation ---

test('logout: cross-origin POST is rejected with 403 (AF-6.4)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  // Get a real session cookie first.
  await postLogin(h.handlers, formBody({ email: REGISTERED }));
  const tok = extractToken(h.sentMail[0].raw);
  const cb = await getCallback(h.handlers, tok);
  const sessionCookie = parseSetCookie(cb._headers['set-cookie']).value;
  const handle = deriveHandle(REGISTERED, TEST_SECRET);

  // Cross-origin POST /logout
  const evil = fakeReq({
    method: 'POST',
    url: '/logout',
    headers: { origin: 'https://evil.example.org', cookie: `knowless_session=${sessionCookie}` },
  });
  const evilRes = fakeRes();
  await h.handlers.logout(evil, evilRes);
  assert.equal(evilRes.statusCode, 403);
  // Session NOT killed.
  assert.match(h.handlers.handleFromRequest(
    fakeReq({ headers: { cookie: `knowless_session=${sessionCookie}` } }),
  ) ?? '', new RegExp(handle));

  // Same-origin POST works.
  const ok = fakeReq({
    method: 'POST',
    url: '/logout',
    headers: { origin: 'https://app.example.com', cookie: `knowless_session=${sessionCookie}` },
  });
  const okRes = fakeRes();
  await h.handlers.logout(ok, okRes);
  assert.equal(okRes.statusCode, 200);
  h.close();
});

// --- AF-6.5: confirmationMessage HTML escaping ---

test('renderLoginForm: confirmationMessage is HTML-escaped (AF-6.5)', () => {
  const h = newHarness({
    confirmationMessage: '<script>alert(1)</script>{email}',
  });
  // Trigger sameResponse via a POST to render the message branch.
  const req = fakeReq({
    method: 'POST',
    url: '/login',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://app.example.com',
    },
    body: formBody({ email: REGISTERED }),
  });
  const res = fakeRes();
  return h.handlers.login(req, res).then(() => {
    assert.equal(res.statusCode, 200);
    assert.equal(res._body.includes('<script>alert(1)</script>'), false);
    assert.match(res._body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    h.close();
  });
});

// --- AF-6.2: devLogMagicLinks ---

test('devLogMagicLinks: prints link to stderr only when SMTP fails AND opt-in (AF-6.2)', async () => {
  const stderrChunks = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  };
  try {
    // Build a harness whose mailer always throws on submit.
    const h = newHarness({
      openRegistration: true,
      devLogMagicLinks: true,
    });
    h.handlers._config.mailer = null;
    // Patch mailer.submit to throw — easier than rebuilding the harness.
    const realSubmit = h.mailer.submit;
    h.mailer.submit = async () => { throw new Error('connect ECONNREFUSED'); };

    await postLogin(
      h.handlers,
      formBody({ email: REGISTERED }),
      { origin: 'https://app.example.com' },
    );

    const printed = stderrChunks.join('');
    assert.match(printed, /\[knowless dev:auth@app\.example\.com\] magic link: https:\/\/app\.example\.com\/auth\/callback\?t=/);

    h.mailer.submit = realSubmit;
    h.close();
  } finally {
    process.stderr.write = origWrite;
  }
});

test('devLogMagicLinks: silent when opt-in is off (AF-6.2)', async () => {
  const stderrChunks = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  };
  try {
    const h = newHarness({ openRegistration: true });
    h.mailer.submit = async () => { throw new Error('boom'); };
    await postLogin(
      h.handlers,
      formBody({ email: REGISTERED }),
      { origin: 'https://app.example.com' },
    );
    const printed = stderrChunks.join('');
    assert.equal(printed.includes('magic link:'), false);
    h.close();
  } finally {
    process.stderr.write = origWrite;
  }
});

// --- AF-7.3: auth.startLogin programmatic entry ---

test('bodyFooter: appears in submitted mail end-to-end (AF-8.2)', async () => {
  const footer = 'feedback@addypin.com | privacy first';
  const h = newHarness({ bodyFooter: footer, openRegistration: true });
  await postLogin(
    h.handlers,
    formBody({ email: REGISTERED }),
    { origin: 'https://app.example.com' },
  );
  assert.equal(h.sentMail.length, 1);
  const wire = h.sentMail[0].raw;
  assert.match(wire, /\r\n-- \r\nfeedback@addypin\.com \| privacy first/);
  h.close();
});

test('startLogin: real path — registered handle gets a real magic-link mail (AF-7.3)', async () => {
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  // Build a thin auth-shaped wrapper for the test (the same wiring
  // index.js does)
  const auth = { startLogin: h.handlers.startLogin };
  const result = await auth.startLogin({
    email: REGISTERED,
    nextUrl: 'https://kuma.app.example.com/dash',
    sourceIp: '203.0.113.42',
  });
  assert.equal(result.submitted, true);
  assert.match(result.handle, /^[a-f0-9]{64}$/);
  assert.equal(result.handle, deriveHandle(REGISTERED, TEST_SECRET));
  // Real mail submitted (not sham).
  assert.equal(h.sentMail.length, 1);
  assert.equal(h.sentMail[0].envelope.to[0], REGISTERED);
  h.close();
});

test('startLogin: sham path — unknown email gets sham routing, same shape (AF-7.3)', async () => {
  const h = newHarness();
  const auth = { startLogin: h.handlers.startLogin };
  const result = await auth.startLogin({
    email: 'nobody@example.com',
    sourceIp: '203.0.113.42',
  });
  // Same shape: handle present, submitted true.
  assert.equal(result.submitted, true);
  assert.match(result.handle, /^[a-f0-9]{64}$/);
  // Sham routed to shamRecipient — DB row has is_sham=1 but NOT redeemable.
  assert.equal(h.sentMail.length, 1);
  assert.equal(h.sentMail[0].envelope.to[0], 'null@knowless.invalid');
  h.close();
});

test('startLogin: openRegistration auto-creates the handle (AF-7.3)', async () => {
  const h = newHarness({ openRegistration: true });
  const auth = { startLogin: h.handlers.startLogin };
  const result = await auth.startLogin({ email: 'fresh@example.com' });
  assert.equal(result.submitted, true);
  // Handle now exists.
  assert.equal(h.store.handleExists(result.handle), true);
  // Real mail (not sham).
  assert.equal(h.sentMail[0].envelope.to[0], 'fresh@example.com');
  h.close();
});

test('startLogin: rate-limit returns same shape (AF-7.3)', async () => {
  const h = newHarness({ maxLoginRequestsPerIpPerHour: 2 });
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  const auth = { startLogin: h.handlers.startLogin };
  await auth.startLogin({ email: REGISTERED, sourceIp: '1.2.3.4' });
  await auth.startLogin({ email: REGISTERED, sourceIp: '1.2.3.4' });
  const limited = await auth.startLogin({ email: REGISTERED, sourceIp: '1.2.3.4' });
  // Same return shape — caller cannot distinguish "rate-limited" from "sent."
  assert.equal(limited.submitted, true);
  assert.match(limited.handle ?? '', /^([a-f0-9]{64})?$/);
  // Only 2 mails actually went out.
  assert.equal(h.sentMail.length, 2);
  h.close();
});

test('startLogin: malformed email throws programmer error (AF-7.3)', async () => {
  const h = newHarness();
  await assert.rejects(() => h.handlers.startLogin({}));
  await assert.rejects(() => h.handlers.startLogin({ email: '' }));
  await assert.rejects(() => h.handlers.startLogin({ email: 123 }));
  await assert.rejects(() =>
    h.handlers.startLogin({ email: 'a@b.com', nextUrl: 99 }),
  );
  h.close();
});

test('startLogin: skips Origin check (server-side caller is trusted) (AF-7.3)', async () => {
  // No req object means no Origin header at all — startLogin doesn't
  // care because it's a programmatic API.
  const h = newHarness();
  h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));
  const r = await h.handlers.startLogin({ email: REGISTERED });
  assert.equal(r.submitted, true);
  assert.equal(h.sentMail.length, 1);
  h.close();
});

// --- AF-7.4: auth.deriveHandle convenience ---

test('deriveHandle (factory wrapper): uses configured secret (AF-7.4)', async () => {
  // We import the factory here to assert the wrapper exists and works
  // — bypasses the harness which uses createHandlers directly.
  const { knowless } = await import('../../src/index.js');
  const auth = knowless({
    secret: TEST_SECRET,
    baseUrl: 'https://app.example.com',
    from: 'auth@app.example.com',
    cookieDomain: 'app.example.com',
    dbPath: ':memory:',
    sweepIntervalMs: 60_000,
  });
  const h = auth.deriveHandle('alice@example.com');
  assert.equal(h, deriveHandle('alice@example.com', TEST_SECRET));
  // Different email → different handle.
  assert.notEqual(h, auth.deriveHandle('bob@example.com'));
  auth.close();
});

// --- AF-7.1: empty-body warning when a parser ate the stream ---

test('warnEmptyBodyOnce: fires when Content-Length>0 but body is empty (AF-7.1)', async () => {
  const captured = [];
  const orig = console.warn;
  console.warn = (...args) => captured.push(args.join(' '));
  try {
    const h = newHarness();
    // Simulate a parser that consumed the stream: body='' but
    // content-length claims data was present.
    const req = fakeReq({
      method: 'POST',
      url: '/login',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '24',
        origin: 'https://app.example.com',
      },
      body: '', // pre-consumed
    });
    const res = fakeRes();
    await h.handlers.login(req, res);
    const printed = captured.join('\n');
    assert.match(printed, /POST \/login received an empty body/);
    assert.match(printed, /body parser/);
    // Second time: still warns only once.
    captured.length = 0;
    const req2 = fakeReq({
      method: 'POST',
      url: '/login',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': '24',
        origin: 'https://app.example.com',
      },
      body: '',
    });
    await h.handlers.login(req2, fakeRes());
    assert.equal(captured.length, 0);
    h.close();
  } finally {
    console.warn = orig;
  }
});

test('warnEmptyBodyOnce: silent on a normal empty POST (no Content-Length) (AF-7.1)', async () => {
  const captured = [];
  const orig = console.warn;
  console.warn = (...args) => captured.push(args.join(' '));
  try {
    const h = newHarness();
    const req = fakeReq({
      method: 'POST',
      url: '/login',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://app.example.com',
      },
      body: '',
    });
    await h.handlers.login(req, fakeRes());
    assert.equal(captured.length, 0);
    h.close();
  } finally {
    console.warn = orig;
  }
});

// --- AF-7.5: transportOverride startup validation ---

test('createMailer: rejects transportOverride without sendMail (AF-7.5)', async () => {
  const { createMailer } = await import('../../src/mailer.js');
  assert.throws(
    () => createMailer({ from: 'a@b.com', transportOverride: { connectionTimeout: 500 } }),
    /sendMail/,
  );
  assert.throws(
    () => createMailer({ from: 'a@b.com', transportOverride: {} }),
    /sendMail/,
  );
});

// --- AF-7.6: devLogMagicLinks line includes from address ---

test('devLogMagicLinks: line is tagged with cfg.from (AF-7.6)', async () => {
  const captured = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  try {
    const h = newHarness({ devLogMagicLinks: true, openRegistration: true });
    h.mailer.submit = async () => { throw new Error('nope'); };
    await postLogin(
      h.handlers,
      formBody({ email: REGISTERED }),
      { origin: 'https://app.example.com' },
    );
    const printed = captured.join('');
    assert.match(printed, /\[knowless dev:auth@app\.example\.com\] magic link:/);
    h.close();
  } finally {
    process.stderr.write = orig;
  }
});

test('devLogMagicLinks: silent-miss hint also tagged (AF-7.2 dev hint, AF-7.6)', async () => {
  const captured = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  try {
    const h = newHarness({ devLogMagicLinks: true });
    h.mailer.submit = async () => { throw new Error('nope'); };
    await postLogin(
      h.handlers,
      formBody({ email: 'nobody@example.com' }),
      { origin: 'https://app.example.com' },
    );
    const printed = captured.join('');
    // Hint mentions silent-miss + the email + openRegistration state.
    assert.match(printed, /silent-miss/);
    assert.match(printed, /nobody@example\.com/);
    assert.match(printed, /openRegistration=false/);
    // Still no leaked magic link.
    assert.equal(printed.includes('magic link:'), false);
    h.close();
  } finally {
    process.stderr.write = orig;
  }
});

test('devLogMagicLinks: never prints for sham (silent-miss) submissions (AF-6.2)', async () => {
  const stderrChunks = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  };
  try {
    // Closed-reg + unregistered email → sham path. Mailer fails so the
    // dev-log code path is reached.
    const h = newHarness({ devLogMagicLinks: true });
    h.mailer.submit = async () => { throw new Error('boom'); };
    await postLogin(
      h.handlers,
      formBody({ email: 'unknown@example.com' }),
      { origin: 'https://app.example.com' },
    );
    const printed = stderrChunks.join('');
    assert.equal(printed.includes('magic link:'), false);
    h.close();
  } finally {
    process.stderr.write = origWrite;
  }
});
