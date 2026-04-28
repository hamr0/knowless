// POC driver. Answers Q1, Q2, Q3.
import {
  newDb, deriveHandle, issueToken, verifyToken, createSession, verifySession, sendLink,
  loginHit, loginMissNoSham, loginMissShamMail, loginMissShamFull,
} from './poc.js';

const N = 1000;
const REGISTERED = 'alice@example.com';
const UNREGISTERED = 'bob@example.com';

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const sum = s.reduce((a, x) => a + x, 0);
  return {
    n: s.length,
    mean: (sum / s.length).toFixed(3),
    p50: s[Math.floor(s.length * 0.50)].toFixed(3),
    p95: s[Math.floor(s.length * 0.95)].toFixed(3),
    p99: s[Math.floor(s.length * 0.99)].toFixed(3),
    min: s[0].toFixed(3),
    max: s[s.length - 1].toFixed(3),
  };
}

async function timeIt(fn, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    out[i] = Number(process.hrtime.bigint() - t0) / 1e6; // ms
  }
  return out;
}

// Welch's t-test (two-tailed). Returns the t statistic; |t| < ~2 means
// distributions are not statistically distinguishable at p~0.05 for large N.
// Not meant to be the SPEC's final test — just a sanity gauge for the POC.
function welch(a, b) {
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = (xs, m) => xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  const ma = mean(a), mb = mean(b);
  const va = variance(a, ma), vb = variance(b, mb);
  const t = (ma - mb) / Math.sqrt(va / a.length + vb / b.length);
  return { t: t.toFixed(3), delta_mean: (ma - mb).toFixed(3) };
}

async function q1() {
  console.log('\n=== Q1: timing — registered vs unregistered ===');
  const db = newDb();
  db.prepare('INSERT INTO handles (handle, last_login_at) VALUES (?, NULL)').run(deriveHandle(REGISTERED));

  // warm up JIT, sqlite cache, mailer
  for (let i = 0; i < 200; i++) await loginHit(db, REGISTERED);
  for (let i = 0; i < 200; i++) await loginMissNoSham(db, UNREGISTERED);

  const hit       = await timeIt(() => loginHit(db, REGISTERED), N);
  const missNo    = await timeIt(() => loginMissNoSham(db, UNREGISTERED), N);
  const missMail  = await timeIt(() => loginMissShamMail(db, UNREGISTERED), N);
  const missFull  = await timeIt(() => loginMissShamFull(db, UNREGISTERED), N);

  console.log('hit (registered):   ', stats(hit));
  console.log('miss A (no sham):   ', stats(missNo),  'vs hit:', welch(hit, missNo));
  console.log('miss B (sham mail): ', stats(missMail),'vs hit:', welch(hit, missMail));
  console.log('miss C (full sham): ', stats(missFull),'vs hit:', welch(hit, missFull));

  console.log('\nVerdict heuristic: |t| < ~2 means hit/miss are not statistically distinguishable.');
}

async function q2() {
  console.log('\n=== Q2: round-trip (login → extract token from mail → callback → session) ===');
  const db = newDb();
  const handle = deriveHandle(REGISTERED);
  db.prepare('INSERT INTO handles (handle, last_login_at) VALUES (?, NULL)').run(handle);

  const t0 = process.hrtime.bigint();
  const token = issueToken(db, handle);
  const info = await sendLink(REGISTERED, token);
  const tSend = Number(process.hrtime.bigint() - t0) / 1e6;

  // Nodemailer applies quoted-printable encoding by default; line-wraps at 76
  // chars and breaks the URL with `=\n` soft breaks plus `=3D` for `=`. Mail
  // clients decode this correctly, but a real "paste into browser" fallback
  // would not. SPEC.md note: force 7bit encoding or shorten the URL.
  function qpDecode(s) {
    return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  const body = qpDecode(info.message.toString());
  const m = body.match(/\?t=([a-f0-9]+)/);
  if (!m) throw new Error('no token in mail body after QP-decode');
  const extracted = m[1];
  if (extracted !== token) throw new Error('token mismatch in mail body');

  const verified = verifyToken(db, extracted);
  if (verified !== handle) throw new Error('verifyToken failed');

  const cookie = createSession(db, verified);
  const sessHandle = verifySession(db, cookie);
  if (sessHandle !== handle) throw new Error('verifySession failed');

  // Replay: redeeming the same token a second time MUST fail
  const replay = verifyToken(db, extracted);
  if (replay !== null) throw new Error('replay protection broken');

  const tTotal = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  send compose: ${tSend.toFixed(2)}ms    full round-trip: ${tTotal.toFixed(2)}ms`);
  console.log('  ✓ token round-trip preserves handle');
  console.log('  ✓ session cookie verifies');
  console.log('  ✓ replay rejected');
}

async function q3() {
  console.log('\n=== Q3: verifySession hot path ===');
  const db = newDb();
  const handle = deriveHandle(REGISTERED);
  db.prepare('INSERT INTO handles (handle, last_login_at) VALUES (?, NULL)').run(handle);
  const cookie = createSession(db, handle);

  for (let i = 0; i < 500; i++) verifySession(db, cookie);

  const samples = await timeIt(async () => verifySession(db, cookie), N);
  console.log('  ', stats(samples));
  console.log('  Target NFR-3: <10ms. (P99 above is the number that matters.)');
}

await q1();
await q2();
await q3();
console.log('\n=== POC complete ===');
