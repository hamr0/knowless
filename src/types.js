// Shared JSDoc typedefs for knowless. This file ships no runtime code —
// it exists only so the hand-written .js + JSDoc typechecks cleanly under
// `tsc --strict` (types toolchain only; see tsconfig.json "// note").
//
// knowless is deliberately framework-agnostic: it duck-types the (req, res)
// pair rather than importing node:http or Express types. The shapes below
// capture EXACTLY the request/response surface the handler bodies read and
// call — no more. Adding a field here means the code actually touches it.
export {};

/**
 * Minimal request shape knowless reads. Framework-agnostic: a node:http
 * IncomingMessage satisfies it, but so does any object exposing these
 * members. Only the members the handlers actually touch are declared.
 *
 * Members:
 *   - headers      request headers, lowercased keys (node:http convention).
 *                  Indexed for arbitrary header names (content-length,
 *                  content-type, x-forwarded-for, x-real-ip, cookie,
 *                  origin, referer, referrer).
 *   - url          request target (path + query); used with `new URL(url, base)`.
 *   - socket       connection peer; remoteAddress feeds source-IP derivation.
 *   - connection   legacy alias for socket (pre-Node-13 / some frameworks).
 *   - on           stream event subscription (data/end/error) for body reads.
 *   - destroy      abort the request stream when the body exceeds the cap.
 *
 * @typedef {Object} KnowlessHttpRequest
 * @property {Record<string, string | string[] | undefined>} [headers]
 * @property {string} [url]
 * @property {{ remoteAddress?: string }} [socket]
 * @property {{ remoteAddress?: string }} [connection]
 * @property {(event: string, listener: (...args: any[]) => void) => unknown} on
 * @property {(error?: Error) => unknown} destroy
 */

/**
 * Minimal response shape knowless writes. A node:http ServerResponse
 * satisfies it. Only the members the handlers actually set/call are declared.
 *
 * Members:
 *   - statusCode  assigned before end() (200/302/401/403).
 *   - setHeader   set a single response header (Content-Type, Location,
 *                 Set-Cookie, Cache-Control, X-User-Handle).
 *   - end         finish the response, optionally with a body string.
 *
 * @typedef {Object} KnowlessHttpResponse
 * @property {number} statusCode
 * @property {(name: string, value: string | number | readonly string[]) => unknown} setHeader
 * @property {(chunk?: string) => unknown} end
 */

/**
 * The merged, defaults-applied handler config. Built as
 * `{ ...DEFAULTS, ...config }` inside createHandlers, then validated.
 * Required fields (secret/baseUrl/from) are asserted present at startup;
 * cookieDomain is derived from baseUrl when omitted. The remaining fields
 * come from DEFAULTS or operator overrides.
 *
 * @typedef {Object} KnowlessConfig
 * @property {string} secret
 * @property {string} baseUrl
 * @property {string} from
 * @property {string} cookieDomain
 * @property {string} cookieName
 * @property {string} linkPath
 * @property {string} loginPath
 * @property {string} verifyPath
 * @property {string} logoutPath
 * @property {number} tokenTtlSeconds
 * @property {number} sessionTtlSeconds
 * @property {string} subject
 * @property {string} confirmationMessage
 * @property {boolean} includeLastLoginInEmail
 * @property {boolean} openRegistration
 * @property {number} maxActiveTokensPerHandle
 * @property {number} maxLoginRequestsPerIpPerHour
 * @property {number} maxNewHandlesPerIpPerHour
 * @property {string} honeypotFieldName
 * @property {string} shamRecipient
 * @property {(Set<string> | string[] | import('node:net').BlockList)} trustedProxies
 * @property {string | null} failureRedirect
 * @property {boolean} cookieSecure
 * @property {string} [bodyFooter]    operator-supplied plain-text footer (AF-8.2)
 * @property {boolean} [devLogMagicLinks]  AF-6.2 dev-mode link logging
 */

/**
 * Operator-visibility hooks (v0.2.1). createHandlers normalizes these to
 * non-optional no-ops internally, so the duck-typed surface is the
 * already-normalized set of four callables.
 *
 * @typedef {Object} HandlerEvents
 * @property {() => void} [shamHit]
 * @property {() => void} [rateLimitHit]
 * @property {(payload: { messageId: string | null, handle: string, timestamp: number }) => void} [onMailerSubmit]
 * @property {(payload: { error: unknown, timestamp: number }) => void} [onTransportFailure]
 */

/**
 * A stored token row as returned by store.getToken (or null when absent).
 *
 * @typedef {Object} TokenRow
 * @property {string} handle
 * @property {number} expiresAt
 * @property {number | null} usedAt
 * @property {string | null} nextUrl
 * @property {boolean} isSham
 */

/**
 * A stored session row as returned by store.getSession (or null when absent).
 *
 * @typedef {Object} SessionRow
 * @property {string} handle
 * @property {number} expiresAt
 */

/**
 * The knowless storage backend (return shape of createStore, SPEC §13).
 * Captures exactly the methods the handlers / index / abuse modules call.
 *
 * @typedef {Object} KnowlessStore
 * @property {(handle: string) => boolean} handleExists
 * @property {(handle: string) => void} upsertHandle
 * @property {(handle: string) => void} deleteHandle
 * @property {(args: { tokenHash: string, handle: string, expiresAt: number, nextUrl?: string | null, isSham?: boolean, maxActive?: number, now?: number }) => number} insertToken
 * @property {(tokenHash: string) => (TokenRow | null)} getToken
 * @property {(tokenHash: string, usedAt: number) => boolean} markTokenUsed
 * @property {(handle: string, now?: number) => number} countActiveTokens
 * @property {(handle: string, now?: number) => number} evictOldestActiveToken
 * @property {(now?: number, graceMs?: number) => number} sweepTokens
 * @property {(handle: string, at: number) => void} upsertLastLogin
 * @property {(handle: string) => (number | null)} getLastLogin
 * @property {(sidHash: string, handle: string, expiresAt: number) => void} insertSession
 * @property {(sidHash: string) => (SessionRow | null)} getSession
 * @property {(sidHash: string) => boolean} deleteSession
 * @property {(handle: string) => number} revokeSessions
 * @property {(now?: number) => number} sweepSessions
 * @property {(scope: string, key: string, windowStart: number) => number} rateLimitIncrement
 * @property {(scope: string, key: string, windowStart: number) => number} rateLimitGet
 * @property {(olderThan: number) => number} sweepRateLimits
 * @property {() => void} close
 */

/**
 * The knowless mailer (return shape of createMailer, SPEC §12). submit()
 * resolves to whatever the underlying transport returns (info bag whose
 * messageId knowless optionally reads), so the resolved value is opaque.
 *
 * @typedef {Object} KnowlessMailer
 * @property {(args: { to: string, subject: string, body: string }) => Promise<any>} submit
 * @property {() => Promise<true>} verify
 * @property {() => void} [close]
 */

/**
 * The nodemailer transport surface knowless uses. createTransport returns
 * an object; knowless only calls sendMail (and probes for verify/close).
 *
 * @typedef {Object} KnowlessMailTransport
 * @property {(message: any) => Promise<any>} sendMail
 * @property {() => Promise<unknown>} [verify]
 * @property {() => void} [close]
 */
