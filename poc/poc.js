// POC for knowless. Hardcoded values, no error handling, no tests.
// Validates: (Q1) timing equivalence, (Q2) round-trip, (Q3) verify hot path.
// Per AGENT_RULES: this is throwaway. Do not ship.

import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import nodemailer from 'nodemailer';

const SECRET = 'a'.repeat(64);
const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function newDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE handles (handle TEXT PRIMARY KEY, last_login_at INTEGER);
    CREATE TABLE tokens  (token_hash TEXT PRIMARY KEY, handle TEXT, expires_at INTEGER, used_at INTEGER);
    CREATE TABLE sessions(sid_hash TEXT PRIMARY KEY, handle TEXT, expires_at INTEGER);
  `);
  return db;
}

const normalize = (email) => email.trim().toLowerCase();

export function deriveHandle(email) {
  return crypto.createHmac('sha256', SECRET).update(normalize(email)).digest('hex');
}

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function issueToken(db, handle) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO tokens (token_hash, handle, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), handle, Date.now() + TOKEN_TTL_MS);
  return token;
}

export function verifyToken(db, token) {
  const th = hashToken(token);
  const row = db.prepare('SELECT handle, expires_at, used_at FROM tokens WHERE token_hash = ?').get(th);
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  db.prepare('UPDATE tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), th);
  db.prepare('INSERT OR REPLACE INTO handles (handle, last_login_at) VALUES (?, ?)').run(row.handle, Date.now());
  return row.handle;
}

export function createSession(db, handle) {
  const sid = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (sid_hash, handle, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(sid), handle, Date.now() + SESSION_TTL_MS);
  const sig = crypto.createHmac('sha256', SECRET).update(sid).digest('hex');
  return `${sid}.${sig}`;
}

export function verifySession(db, cookie) {
  if (!cookie) return null;
  const dot = cookie.indexOf('.');
  if (dot < 0) return null;
  const sid = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(sid).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const row = db.prepare('SELECT handle, expires_at FROM sessions WHERE sid_hash = ?').get(hashToken(sid));
  if (!row || row.expires_at < Date.now()) return null;
  return row.handle;
}

const mailer = nodemailer.createTransport({ streamTransport: true, buffer: true });

export async function sendLink(email, token) {
  return mailer.sendMail({
    from: 'auth@example.test',
    to: email,
    subject: 'Sign in',
    text: `Click to sign in:\n\nhttps://example.test/auth/callback?t=${token}\n\nThis link expires in 15 minutes.\nIf you didn't request this, ignore this email.\n`,
  });
}

// --- The three login-path variants for Q1 ---

// Hit path: real work. Lookup, issue token, send mail.
export async function loginHit(db, email) {
  const handle = deriveHandle(email);
  const row = db.prepare('SELECT handle FROM handles WHERE handle = ?').get(handle);
  if (row) {
    const token = issueToken(db, handle);
    await sendLink(email, token);
  }
}

// Miss-A: pure miss. Lookup only, nothing else. (Cheapest implementation.)
export async function loginMissNoSham(db, email) {
  const handle = deriveHandle(email);
  db.prepare('SELECT handle FROM handles WHERE handle = ?').get(handle);
}

// Miss-B: sham mail send only (no DB write). Mirrors hit's mail compose cost.
export async function loginMissShamMail(db, email) {
  const handle = deriveHandle(email);
  db.prepare('SELECT handle FROM handles WHERE handle = ?').get(handle);
  const fakeToken = crypto.randomBytes(32).toString('hex');
  hashToken(fakeToken);
  await sendLink(email, fakeToken);
}

// Miss-C: full sham (DB write + mail send), matching hit's work exactly.
// Insert a token row that nobody will ever redeem; the periodic expired-token
// sweeper (FR-13) drops it. NO post-hoc DELETE — that's extra work hit doesn't
// do, and it makes miss artificially faster by keeping the table small.
export async function loginMissShamFull(db, email) {
  const handle = deriveHandle(email);
  db.prepare('SELECT handle FROM handles WHERE handle = ?').get(handle);
  const token = issueToken(db, handle);
  await sendLink(email, token);
}
