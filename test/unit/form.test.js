import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLoginForm, htmlEscape } from '../../src/form.js';

test('htmlEscape: escapes the five HTML-significant characters', () => {
  assert.equal(htmlEscape('a&b'), 'a&amp;b');
  assert.equal(htmlEscape('<x>'), '&lt;x&gt;');
  assert.equal(htmlEscape('"'), '&quot;');
  assert.equal(htmlEscape("'"), '&#x27;');
  assert.equal(
    htmlEscape('<script>alert("xss")</script>'),
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
  );
});

test('renderLoginForm: produces valid-looking HTML5 with no JS', () => {
  const html = renderLoginForm({ loginPath: '/login', honeypotName: 'website' });
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html /);
  assert.match(html, /<\/html>/);
  assert.equal(/<script/i.test(html), false, 'no <script> tags allowed');
  // No external resources
  assert.equal(/<link[^>]+href=/i.test(html), false);
  assert.equal(/<img/i.test(html), false);
  assert.equal(/<iframe/i.test(html), false);
});

test('renderLoginForm: form posts to loginPath with email + honeypot fields', () => {
  const html = renderLoginForm({ loginPath: '/login', honeypotName: 'website' });
  assert.match(html, /<form[^>]+method="POST"[^>]+action="\/login"/);
  assert.match(html, /<input[^>]+name="email"[^>]+type="email"[^>]+required/);
  assert.match(html, /<input[^>]+name="website"/);
});

test('renderLoginForm: honeypot has aria-hidden and tabindex=-1', () => {
  const html = renderLoginForm({ loginPath: '/login', honeypotName: 'website' });
  // Honeypot wrapper has aria-hidden
  assert.match(html, /aria-hidden="true"/);
  // The honeypot input itself has tabindex=-1
  assert.match(html, /<input[^>]+name="website"[^>]+tabindex="-1"/);
});

test('renderLoginForm: confirmationMessage replaces {email} placeholder', () => {
  const html = renderLoginForm({
    loginPath: '/login',
    honeypotName: 'website',
    confirmationMessage:
      'Thanks. If <code>{email}</code> is registered, a sign-in link is on its way.',
    echoedEmail: 'alice@example.com',
  });
  assert.match(html, /class="msg"[^>]*role="status"/);
  assert.match(html, /alice@example\.com/);
});

test('renderLoginForm: HTML-escapes echoed email (XSS defence)', () => {
  const html = renderLoginForm({
    loginPath: '/login',
    honeypotName: 'website',
    confirmationMessage: 'Thanks for {email}',
    echoedEmail: '"><script>alert(1)</script>',
  });
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('renderLoginForm: HTML-escapes echoed email in input value too', () => {
  const html = renderLoginForm({
    loginPath: '/login',
    honeypotName: 'website',
    echoedEmail: '" autofocus onfocus="alert(1)',
  });
  assert.equal(html.includes('onfocus="alert(1)'), false);
  assert.match(html, /value="&quot; autofocus onfocus=&quot;alert\(1\)"/);
});

test('renderLoginForm: omits message block when confirmationMessage is null', () => {
  const html = renderLoginForm({ loginPath: '/login', honeypotName: 'website' });
  assert.equal(/class="msg"/.test(html), false);
});

test('renderLoginForm: includes hidden next field when next is set', () => {
  const html = renderLoginForm({
    loginPath: '/login',
    honeypotName: 'website',
    next: 'https://kuma.example.com/dash?from=mail',
  });
  assert.match(
    html,
    /<input type="hidden" name="next" value="https:\/\/kuma\.example\.com\/dash\?from=mail">/,
  );
});

test('renderLoginForm: omits next field when not provided', () => {
  const html = renderLoginForm({ loginPath: '/login', honeypotName: 'website' });
  assert.equal(/name="next"/.test(html), false);
});

test('renderLoginForm: HTML-escapes loginPath and honeypotName too', () => {
  const html = renderLoginForm({
    loginPath: '/login"><script>alert(1)',
    honeypotName: 'web"site',
  });
  assert.equal(html.includes('<script>alert(1)'), false);
  assert.match(html, /action="\/login&quot;&gt;&lt;script&gt;alert\(1\)"/);
  assert.match(html, /name="web&quot;site"/);
});

test('renderLoginForm: includes referrer policy meta', () => {
  const html = renderLoginForm({ loginPath: '/login', honeypotName: 'website' });
  // Forward-auth deployments often span subdomains; no-referrer keeps the
  // protected service URL out of HTTP referers when the user clicks through.
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});
