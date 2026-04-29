import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

const ASCII_RE = /^[\x00-\x7f]*$/;

/**
 * Compose a fully-formed RFC822 message per SPEC §12.1. Nodemailer's
 * own MimeNode disagreed with our SPEC on Content-Transfer-Encoding
 * (insisted on QP or base64 even for ASCII bodies, breaking the URL
 * with QP soft-breaks per the v0.11 POC finding). We sidestep its
 * encoding by providing the raw message and using nodemailer only as
 * the SMTP submission transport.
 *
 * @param {object} args
 * @param {string} args.from               bare RFC 5321 MAIL FROM address
 * @param {string} [args.fromName]         optional RFC 5322 display name
 *   (AF-27). When set, the From: header is `name <addr>`; when null/
 *   undefined, the From: header is the bare `addr`. envelope.from
 *   (caller-side) always uses the bare address.
 * @param {string} args.to
 * @param {string} args.subject
 * @param {string} args.body  ASCII-only plain text
 * @returns {string} RFC822 message with CRLF line endings
 */
function composeRaw({ from, fromName, to, subject, body }) {
  // AF-2.1: header-injection defense in depth. normalize() upstream
  // already rejects \r and \n in email addresses, but the mailer
  // shouldn't trust its callers — this is the layer that emits the
  // wire-format bytes, so it owns the invariant.
  for (const [name, value] of [
    ['from', from],
    ['to', to],
    ['subject', subject],
  ]) {
    if (typeof value !== 'string') {
      throw new Error(`mailer: ${name} must be a string`);
    }
    if (/[\r\n]/.test(value)) {
      throw new Error(`mailer: ${name} contains CR/LF — header injection blocked`);
    }
  }
  // AF-27: defensive re-check on fromName (createMailer already validated
  // at startup, but composeRaw owns the wire-format invariant).
  if (fromName != null && fromName !== '') {
    if (typeof fromName !== 'string' || /[\r\n<>"]/.test(fromName)) {
      throw new Error('mailer: fromName contains forbidden characters');
    }
  }
  const fromDomain = from.includes('@') ? from.split('@').pop() : 'localhost';
  const messageId = `<${crypto.randomUUID()}@${fromDomain}>`;
  const date = new Date().toUTCString();
  const fromHeader = fromName ? `${fromName} <${from}>` : from;
  const headers = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
  ].join('\r\n');
  const normalized = body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  return `${headers}\r\n\r\n${normalized}`;
}

/**
 * Validate an operator-supplied body footer per AF-8.2.
 *
 * Constraints (deliberately strict to preserve the URL-line invariant
 * and 7bit body encoding from the v0.11 POC finding):
 *   - ASCII only
 *   - ≤ 240 chars
 *   - No CR (LF allowed; line count ≤ 4)
 *   - No `http://` / `https://` substring (avoids URL-line confusion
 *     and avoids triggering MTA URL-rewriting heuristics)
 *
 * Throws on any violation. Returns the (already-trimmed) footer.
 *
 * @param {unknown} footer
 * @returns {string|null}
 */
export function validateBodyFooter(footer) {
  if (footer == null || footer === '') return null;
  if (typeof footer !== 'string') {
    throw new Error('bodyFooter must be a string');
  }
  if (footer.length > 240) throw new Error('bodyFooter must be ≤ 240 chars');
  if (!ASCII_RE.test(footer)) throw new Error('bodyFooter must be ASCII');
  if (footer.includes('\r')) throw new Error('bodyFooter must not contain CR');
  if (footer.split('\n').length > 4) {
    throw new Error('bodyFooter must be ≤ 4 lines');
  }
  if (/https?:\/\//i.test(footer)) {
    throw new Error('bodyFooter must not contain URLs (would conflict with the magic-link line)');
  }
  return footer;
}

/**
 * Compose the plain-text body of the magic-link email per SPEC §12.2.
 *
 * Body shape (default):
 *   Click to sign in:
 *
 *   <magic link URL>
 *
 *   This link expires in 15 minutes. If you didn't request this,
 *   ignore this email.
 *
 * Plus, when lastLoginAt is provided:
 *
 *   Last sign-in: <ISO 8601 UTC timestamp>.
 *   If that wasn't you, do not click the link above.
 *
 * Plus, when bodyFooter is provided (AF-8.2):
 *
 *   --
 *   <footer text>
 *
 * The URL appears on its own line. Body is ASCII-only.
 *
 * @param {object} args
 * @param {string} args.tokenRaw  43-char base64url token
 * @param {string} args.baseUrl   e.g. 'https://app.example.com'
 * @param {string} args.linkPath  e.g. '/auth/callback'
 * @param {number|null} [args.lastLoginAt] Unix ms; null/undefined to omit
 * @param {string|null} [args.bodyFooter] operator footer; pre-validated
 * @returns {string} the body text (ASCII)
 */
export function composeBody({ tokenRaw, baseUrl, linkPath, lastLoginAt, bodyFooter }) {
  const url = `${baseUrl}${linkPath}?t=${tokenRaw}`;
  let body =
    'Click to sign in:\n\n' +
    `${url}\n\n` +
    "This link expires in 15 minutes. If you didn't request this,\n" +
    'ignore this email.\n';
  if (lastLoginAt != null) {
    const iso = new Date(lastLoginAt).toISOString();
    body +=
      `\nLast sign-in: ${iso}.\n` + 'If that wasn\'t you, do not click the link above.\n';
  }
  if (bodyFooter) {
    // Standard email signature delimiter: "-- " (dash-dash-space) on
    // its own line. Mail clients strip this section from quoted replies.
    body += `\n-- \n${bodyFooter}\n`;
  }
  if (!ASCII_RE.test(body)) {
    throw new Error('mail body contains non-ASCII');
  }
  return body;
}

/**
 * Validate a body produced by `startLogin`'s `bodyOverride` template
 * function (AF-26). The override lets adopters phrase the email body
 * to match per-call subjects (pin confirmation, login, etc.) without
 * losing knowless's URL-composition / sham-work / 7bit invariants.
 *
 * Constraints (deliberately strict to preserve the v0.11 POC URL-line
 * invariant — QP soft-breaks WILL break the magic link):
 *   - non-empty string
 *   - ≤ 2048 chars (operator-side overflow guard)
 *   - ASCII only (0x00–0x7F). This excludes typographic punctuation
 *     that adopters reach for out of habit:
 *       em/en dashes (— –)        → use - or --
 *       smart quotes (" " ' ')    → use " and '
 *       ellipses (…)              → use ...
 *       middle dots (·)           → use | or -
 *     The constraint preserves 7bit transfer encoding; non-ASCII
 *     would force quoted-printable, which can soft-break the URL
 *     line and break the link.
 *   - no CR (LF allowed; defense-in-depth header-injection guard)
 *   - the magic-link URL appears EXACTLY ONCE
 *   - that occurrence is on its own line (no leading or trailing
 *     non-newline characters on the same line)
 *
 * Throws on any violation. Adopter is responsible for the rest of
 * the body content (security advice, expiry hint, etc.); knowless
 * does not enforce semantic content.
 *
 * @param {unknown} body
 * @param {string} url  the magic-link URL knowless composed
 * @returns {void} throws on invalid
 */
export function validateBodyOverride(body, url) {
  if (typeof body !== 'string' || body.length === 0) {
    throw new Error('bodyOverride must return a non-empty string');
  }
  if (body.length > 2048) {
    throw new Error('bodyOverride must return ≤ 2048 chars');
  }
  if (!ASCII_RE.test(body)) {
    throw new Error('bodyOverride must return ASCII');
  }
  if (body.includes('\r')) {
    throw new Error('bodyOverride must not contain CR (header-injection defense)');
  }
  const occurrences = body.split(url).length - 1;
  if (occurrences === 0) {
    throw new Error('bodyOverride must include the magic-link URL exactly once');
  }
  if (occurrences > 1) {
    throw new Error('bodyOverride must include the magic-link URL exactly once');
  }
  const lines = body.split('\n');
  const ownLineCount = lines.filter((l) => l === url).length;
  if (ownLineCount !== 1) {
    throw new Error(
      'bodyOverride must place the magic-link URL on its own line ' +
        '(preserves the 7bit URL-line invariant; QP soft-breaks would break the link)',
    );
  }
}

/**
 * Validate the operator-supplied display name for the `From:` header
 * (AF-27, v0.2.3). knowless splits the bare envelope sender (RFC 5321
 * MAIL FROM) from the RFC 5322 `From:` header, allowing operators to
 * brand the inbox preview as `addypin <noreply@addypin.com>` rather
 * than the bare `noreply@addypin.com` (which most clients display as
 * the local-part "noreply").
 *
 * Constraints (deliberately strict — same trap as bodyOverride for
 * typographic punctuation):
 *   - ≤ 60 chars (same ballpark as Subject)
 *   - ASCII only (0x00–0x7F). Excludes em/en dashes, smart quotes,
 *     ellipses, middle dots. Use plain ASCII equivalents.
 *   - No CR / LF (header-injection defense; same invariant as
 *     composeRaw enforces on `from` / `to` / `subject`)
 *   - No `<` / `>` / `"` (would break the `name <addr>` quoting)
 *
 * Returns the validated string (or `null` for null/empty input, so
 * callers can pass through). Throws on violation.
 *
 * @param {unknown} name
 * @returns {string|null}
 */
export function validateFromName(name) {
  if (name == null || name === '') return null;
  if (typeof name !== 'string') {
    throw new Error('fromName must be a string when provided');
  }
  if (name.length > 60) {
    throw new Error('fromName must be ≤ 60 chars');
  }
  if (!ASCII_RE.test(name)) {
    throw new Error('fromName must be ASCII (no em-dashes, smart quotes, ellipses, etc.)');
  }
  if (/[\r\n]/.test(name)) {
    throw new Error('fromName must not contain CR/LF (header-injection defense)');
  }
  if (/[<>"]/.test(name)) {
    throw new Error('fromName must not contain < > or " (would break From: header quoting)');
  }
  return name;
}

/**
 * Validate operator-overridden subject per SPEC §12.5.
 * Throws on invalid; warns (returns warnings array) on suspicious-but-allowed.
 *
 * @param {string} subject
 * @returns {string[]} warnings, possibly empty
 */
export function validateSubject(subject) {
  if (typeof subject !== 'string' || subject.length === 0) {
    throw new Error('subject must be a non-empty string');
  }
  if (subject.length > 60) throw new Error('subject longer than 60 chars');
  if (!ASCII_RE.test(subject)) throw new Error('subject contains non-ASCII');
  const warnings = [];
  const triggers = ['!!', '$$', 'FREE', 'URGENT', 'WINNER'];
  for (const t of triggers) {
    if (subject.includes(t)) warnings.push(`subject contains likely spam trigger: "${t}"`);
  }
  return warnings;
}

/**
 * Create a knowless mailer per SPEC §12.
 *
 * Submits to a localhost MTA over plain SMTP. Forces 7bit encoding,
 * strips X-Mailer, refuses non-ASCII bodies. The submit() method is
 * the only public surface.
 *
 * For tests: pass `transportOverride` (e.g. nodemailer.createTransport
 * with streamTransport:true) to capture the raw bytes without an MTA.
 *
 * @param {object} cfg
 * @param {string} cfg.from           bare RFC 5321 sender address (envelope
 *   MAIL FROM AND default From: header value when fromName is unset)
 * @param {string} [cfg.fromName]     AF-27 (v0.2.3). Optional RFC 5322
 *   display name. When set, the From: header is `name <addr>`; envelope
 *   sender stays bare. Validated by validateFromName() at startup.
 * @param {string} [cfg.smtpHost='localhost']
 * @param {number} [cfg.smtpPort=25]
 * @param {object} [cfg.transportOverride] for tests
 * @returns {{ submit(args: {to:string, subject:string, body:string}): Promise<any>, verify(): Promise<true>, close(): void }}
 */
export function createMailer(cfg) {
  const { from, fromName, smtpHost = 'localhost', smtpPort = 25, transportOverride } = cfg;
  if (typeof from !== 'string' || from.length === 0) {
    throw new Error('mailer: from is required');
  }
  if (!ASCII_RE.test(from)) throw new Error('mailer: from must be ASCII');
  // AF-27: validate display name at startup; fail-fast.
  const validatedFromName = validateFromName(fromName);

  const transport =
    transportOverride ??
    nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false,
      ignoreTLS: true, // localhost only; SPEC §10.4 / FR-15
      // Safety: refuse SMTP auth — this transport must not carry credentials.
      auth: undefined,
    });

  // AF-7.5: validate the resolved transport at startup. Without this,
  // a malformed transportOverride (or a bare options bag mistaken for a
  // transport) silently constructs something that throws "sendMail is
  // not a function" only at first submission — which in production may
  // be hours later. Fail fast at factory time instead.
  if (typeof transport.sendMail !== 'function') {
    throw new Error(
      'mailer: transport has no sendMail() — if you passed transportOverride, ' +
        'pass the result of nodemailer.createTransport(opts), not an opts bag.',
    );
  }

  return {
    async submit({ to, subject, body }) {
      if (typeof to !== 'string' || !ASCII_RE.test(to)) {
        throw new Error('mailer: recipient must be ASCII');
      }
      if (!ASCII_RE.test(body)) {
        throw new Error('mailer: body must be ASCII');
      }
      // AF-27: From: header may include display name; envelope.from
      // stays bare (RFC 5321 MAIL FROM doesn't allow display names).
      const raw = composeRaw({ from, fromName: validatedFromName, to, subject, body });
      return transport.sendMail({
        envelope: { from, to: [to] },
        raw,
      });
    },
    /**
     * Probe the underlying SMTP transport. Resolves to true on success,
     * rejects with the underlying error otherwise. Adopters call this
     * explicitly when they want fail-fast on misconfigured SMTP at boot.
     * No auto-on-boot variant: deployments where knowless starts before
     * Postfix (docker-compose ordering, k8s readiness probes) would
     * fail boot for the wrong reason. v0.2.1.
     *
     * Contract: non-rejection means success. The underlying nodemailer
     * transport may return a truthy value, falsy value, or throw —
     * non-throwing is treated as success and normalized to `true`.
     * Tests using `streamTransport` exercise this normalization
     * (streamTransport's verify() returns false even on healthy probes).
     */
    async verify() {
      if (typeof transport.verify !== 'function') {
        return true;
      }
      await transport.verify();
      return true;
    },
    close() {
      if (typeof transport.close === 'function') transport.close();
    },
  };
}
