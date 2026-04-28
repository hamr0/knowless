import { EventEmitter } from 'node:events';
import nodemailer from 'nodemailer';
import { createStore } from '../../src/store.js';
import { createMailer } from '../../src/mailer.js';
import { createHandlers } from '../../src/handlers.js';

export const TEST_SECRET = 'a'.repeat(64);
export const TEST_BASE = 'https://app.example.com';

/**
 * Build a knowless harness with in-memory SQLite and a streamTransport
 * mailer that captures every outgoing message. Returns the handlers
 * plus the mail buffer for inspection.
 */
export function newHarness(overrides = {}) {
  const store = createStore(':memory:');
  const sentMail = [];
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  // Wrap sendMail so we keep a copy of every message + envelope for tests.
  const origSendMail = transport.sendMail.bind(transport);
  transport.sendMail = async (opts) => {
    const info = await origSendMail(opts);
    sentMail.push({
      envelope: info.envelope,
      raw: info.message.toString(),
    });
    return info;
  };

  const mailer = createMailer({
    from: 'auth@app.example.com',
    transportOverride: transport,
  });

  const config = {
    secret: TEST_SECRET,
    baseUrl: TEST_BASE,
    from: 'auth@app.example.com',
    cookieDomain: 'app.example.com',
    ...overrides,
  };

  const handlers = createHandlers({ store, mailer, config });

  return {
    store,
    mailer,
    handlers,
    config,
    sentMail,
    close() {
      mailer.close();
      store.close();
    },
  };
}

/**
 * Construct a fake node:http-shaped request. Body is fed via 'data'
 * and 'end' events on the next tick.
 */
export function fakeReq({
  method = 'GET',
  url = '/',
  headers = {},
  body = '',
  ip = '127.0.0.1',
} = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { ...headers };
  req.socket = { remoteAddress: ip };
  setImmediate(() => {
    if (body) req.emit('data', Buffer.from(body));
    req.emit('end');
  });
  // make destroy a no-op for our fake
  req.destroy = () => {};
  return req;
}

/**
 * Construct a fake response that captures status, headers, and body
 * without writing to a real socket.
 */
export function fakeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res._headers = {};
  res._body = '';
  res._ended = false;
  res._setCookies = [];
  res.setHeader = (k, v) => {
    const lk = k.toLowerCase();
    if (lk === 'set-cookie') res._setCookies.push(v);
    res._headers[lk] = v;
  };
  res.getHeader = (k) => res._headers[k.toLowerCase()];
  res.write = (c) => {
    if (c) res._body += c;
    return true;
  };
  res.end = (c) => {
    if (c) res._body += c;
    res._ended = true;
    res.emit('finish');
  };
  return res;
}

/** Form-encode a body shape for POST tests. */
export function formBody(obj) {
  return new URLSearchParams(obj).toString();
}

/** Helper: parse a Set-Cookie value into a flat object. */
export function parseSetCookie(setCookie) {
  if (!setCookie) return null;
  const parts = setCookie.split(';').map((s) => s.trim());
  const [nv, ...attrs] = parts;
  const eq = nv.indexOf('=');
  const name = nv.slice(0, eq);
  const value = nv.slice(eq + 1);
  const attrMap = {};
  for (const a of attrs) {
    const aeq = a.indexOf('=');
    if (aeq < 0) attrMap[a.toLowerCase()] = true;
    else attrMap[a.slice(0, aeq).toLowerCase()] = a.slice(aeq + 1);
  }
  return { name, value, ...attrMap };
}

/** Extract the magic-link token from a captured raw mail message. */
export function extractToken(mailRaw) {
  const m = mailRaw.match(/\?t=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
