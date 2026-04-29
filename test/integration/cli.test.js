import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';

const BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'bin',
  'knowless-server',
);
const PKG_VERSION = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'),
    'utf8',
  ),
).version;

const SECRET = 'a'.repeat(64);

function run(args, env = {}) {
  return spawnSync('node', [BIN, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('cli: --version prints package version', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), PKG_VERSION);
});

test('cli: --help lists every required env var', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  for (const v of ['KNOWLESS_SECRET', 'KNOWLESS_BASE_URL', 'KNOWLESS_FROM']) {
    assert.match(r.stdout, new RegExp(v));
  }
  // Also lists the standalone-only knobs
  assert.match(r.stdout, /KNOWLESS_PORT/);
});

test('cli: unknown flag exits 2 with hint', () => {
  const r = run(['--frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown option/);
  assert.match(r.stderr, /--help/);
});

test('cli: --print-config redacts secret as <set>', () => {
  const r = run(['--print-config'], {
    KNOWLESS_SECRET: SECRET,
    KNOWLESS_BASE_URL: 'https://x.example',
    KNOWLESS_FROM: 'a@x.example',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /KNOWLESS_SECRET=<set>/);
  // Must not leak the raw secret
  assert.equal(r.stdout.includes(SECRET), false);
  assert.match(r.stdout, /KNOWLESS_BASE_URL=https:\/\/x\.example/);
});

test('cli: --print-config marks unset secret as <unset>', () => {
  // Wipe the inherited KNOWLESS_* env so this test isn't polluted.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('KNOWLESS_')) delete env[k];
  const r = spawnSync('node', [BIN, '--print-config'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /KNOWLESS_SECRET=<unset>/);
});

test('cli: --config-check fails with missing required vars', () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('KNOWLESS_')) delete env[k];
  const r = spawnSync('node', [BIN, '--config-check'], { env, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /KNOWLESS_SECRET is missing/);
  assert.match(r.stderr, /KNOWLESS_BASE_URL is missing/);
});

test('cli: --config-check fails on short secret', () => {
  const r = run(['--config-check'], {
    KNOWLESS_SECRET: 'short',
    KNOWLESS_BASE_URL: 'https://x.example',
    KNOWLESS_FROM: 'a@x.example',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /at least 64 hex chars/);
});

test('cli: --config-check reports unreachable SMTP', () => {
  // Port 1 is reserved-and-typically-closed; whether closed or filtered,
  // the connect attempt must fail (fast on most systems via ECONNREFUSED).
  const r = run(['--config-check'], {
    KNOWLESS_SECRET: SECRET,
    KNOWLESS_BASE_URL: 'https://x.example',
    KNOWLESS_FROM: 'a@x.example',
    KNOWLESS_SMTP_HOST: '127.0.0.1',
    KNOWLESS_SMTP_PORT: '1',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SMTP 127\.0\.0\.1:1 not reachable/);
});

// --- Server boot smoke test ---
//
// Spawn knowless-server, hit it over HTTP, verify routing. Uses a
// listening loopback socket as a stand-in for the SMTP host so the
// startup config check passes without needing a real Postfix.

function pickPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
    s.once('error', reject);
  });
}

function startStubSmtp() {
  // Accept-and-immediately-close. The CLI's reachability check only
  // needs a successful TCP handshake; it does not speak SMTP.
  return new Promise((resolve, reject) => {
    const s = net.createServer((sock) => sock.destroy());
    s.listen(0, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    });
    let buf = '';
    sock.on('data', (d) => (buf += d.toString()));
    sock.on('end', () => resolve(buf));
    sock.on('error', reject);
  });
}

function waitFor(child, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      child.stdout.off('data', onData);
      reject(new Error('timeout waiting for output: ' + buf));
    }, timeoutMs);
    const onData = (d) => {
      buf += d.toString();
      if (predicate(buf)) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(buf);
      }
    };
    child.stdout.on('data', onData);
  });
}

test('cli: spawns, listens, routes loginForm and unknown 404', async (t) => {
  const port = await pickPort();
  const smtp = await startStubSmtp();
  const smtpPort = smtp.address().port;
  const dbDir = mkdtempSync(join(tmpdir(), 'knowless-cli-'));
  const dbPath = join(dbDir, 'k.sqlite');

  const child = spawn('node', [BIN], {
    env: {
      ...process.env,
      KNOWLESS_SECRET: SECRET,
      KNOWLESS_BASE_URL: `http://127.0.0.1:${port}`,
      KNOWLESS_FROM: 'a@x.example',
      KNOWLESS_COOKIE_DOMAIN: '127.0.0.1',
      KNOWLESS_COOKIE_SECURE: 'false',
      KNOWLESS_DB_PATH: dbPath,
      KNOWLESS_SMTP_HOST: '127.0.0.1',
      KNOWLESS_SMTP_PORT: String(smtpPort),
      KNOWLESS_HOST: '127.0.0.1',
      KNOWLESS_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => {
    child.kill('SIGTERM');
    smtp.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  const startup = await waitFor(child, (s) => s.includes('listening:'));
  assert.match(startup, /knowless-server started/);
  assert.match(startup, /KNOWLESS_SECRET=<set>/);

  const formRes = await get(port, '/login');
  assert.match(formRes, /^HTTP\/1\.1 200/);
  assert.match(formRes, /<form/i);

  const missRes = await get(port, '/nope');
  assert.match(missRes, /^HTTP\/1\.1 404/);
});

// 6.8 — Caddy forward-auth integration test.
// Skipped without Docker. Acts as a placeholder so the test file exists
// and operators can run it manually. Real implementation is deferred.
test('cli: Caddy forward-auth round-trip (skipped — needs docker)', { skip: 'requires docker' }, () => {});
