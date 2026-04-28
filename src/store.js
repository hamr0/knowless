import Database from 'better-sqlite3';

/**
 * Default token-sweeper grace: keep used tokens for 24h after redemption
 * to support audit correlation, then delete. SPEC §4.6.
 */
const DEFAULT_TOKEN_GRACE_MS = 24 * 60 * 60 * 1000;

const SCHEMA_VERSION = '1';

/**
 * Validate a 64-char lowercase hex string at the store boundary.
 * Handles, token hashes, and session ID hashes are all this shape per
 * SPEC §3.1, §4.1, §5.3. A bug elsewhere passing a wrong-format value
 * would otherwise silently corrupt the table or fail at SELECT time
 * with a less-actionable error. Closes AF-5.4.
 *
 * @param {unknown} value
 * @param {string} name parameter name for the thrown error
 */
function assertHexHash(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    const got =
      typeof value === 'string'
        ? `"${value.slice(0, 16)}${value.length > 16 ? '...' : ''}"`
        : typeof value;
    throw new Error(
      `store: ${name} must be 64-char lowercase hex (got ${got})`,
    );
  }
}

const DDL = `
  CREATE TABLE IF NOT EXISTS handles (
    handle         TEXT    PRIMARY KEY,
    last_login_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS tokens (
    token_hash   TEXT    PRIMARY KEY,
    handle       TEXT    NOT NULL,
    expires_at   INTEGER NOT NULL,
    used_at      INTEGER,
    next_url     TEXT,
    is_sham      INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tokens_expires ON tokens(expires_at);
  CREATE INDEX IF NOT EXISTS idx_tokens_handle  ON tokens(handle);

  CREATE TABLE IF NOT EXISTS sessions (
    sid_hash    TEXT    PRIMARY KEY,
    handle      TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS rate_limits (
    scope         TEXT    NOT NULL,
    key           TEXT    NOT NULL,
    window_start  INTEGER NOT NULL,
    count         INTEGER NOT NULL,
    PRIMARY KEY (scope, key, window_start)
  );
  CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/**
 * Create a knowless storage backend. SPEC §6 (schema), §13 (interface).
 *
 * @param {string} [dbPath=':memory:'] path to SQLite file, or ':memory:'
 * @returns {Store}
 */
export function createStore(dbPath = ':memory:') {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = OFF');
  db.pragma('temp_store = MEMORY');
  db.exec(DDL);

  const existing = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get();
  if (!existing) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
      SCHEMA_VERSION,
    );
  } else if (existing.value !== SCHEMA_VERSION) {
    throw new Error(`unsupported schema_version: ${existing.value}`);
  }

  const stmt = {
    handleExists: db.prepare('SELECT 1 AS one FROM handles WHERE handle = ?'),
    upsertHandleNoLogin: db.prepare(
      `INSERT INTO handles (handle, last_login_at) VALUES (?, NULL)
       ON CONFLICT(handle) DO NOTHING`,
    ),
    upsertLastLogin: db.prepare(
      `INSERT INTO handles (handle, last_login_at) VALUES (?, ?)
       ON CONFLICT(handle) DO UPDATE SET last_login_at = excluded.last_login_at`,
    ),
    getLastLogin: db.prepare(
      'SELECT last_login_at AS lastLoginAt FROM handles WHERE handle = ?',
    ),
    deleteHandleRow: db.prepare('DELETE FROM handles WHERE handle = ?'),
    deleteHandleTokens: db.prepare('DELETE FROM tokens WHERE handle = ?'),
    deleteHandleSessions: db.prepare('DELETE FROM sessions WHERE handle = ?'),

    insertToken: db.prepare(
      `INSERT INTO tokens (token_hash, handle, expires_at, used_at, next_url, is_sham)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    ),
    getToken: db.prepare(
      `SELECT handle, expires_at AS expiresAt, used_at AS usedAt,
              next_url AS nextUrl, is_sham AS isSham
       FROM tokens WHERE token_hash = ?`,
    ),
    markTokenUsed: db.prepare(
      `UPDATE tokens SET used_at = ?
       WHERE token_hash = ? AND used_at IS NULL`,
    ),
    countActiveTokens: db.prepare(
      `SELECT COUNT(*) AS n FROM tokens
       WHERE handle = ? AND used_at IS NULL AND expires_at > ?`,
    ),
    evictOldestActive: db.prepare(
      `DELETE FROM tokens
       WHERE token_hash = (
         SELECT token_hash FROM tokens
         WHERE handle = ? AND used_at IS NULL AND expires_at > ?
         ORDER BY expires_at ASC LIMIT 1
       )`,
    ),
    sweepTokens: db.prepare(
      `DELETE FROM tokens
       WHERE expires_at <= ?
          OR (used_at IS NOT NULL AND used_at <= ?)`,
    ),

    insertSession: db.prepare(
      'INSERT INTO sessions (sid_hash, handle, expires_at) VALUES (?, ?, ?)',
    ),
    getSession: db.prepare(
      'SELECT handle, expires_at AS expiresAt FROM sessions WHERE sid_hash = ?',
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE sid_hash = ?'),
    sweepSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

    rateLimitIncrement: db.prepare(
      `INSERT INTO rate_limits (scope, key, window_start, count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(scope, key, window_start)
       DO UPDATE SET count = count + 1
       RETURNING count`,
    ),
    rateLimitGet: db.prepare(
      `SELECT count FROM rate_limits
       WHERE scope = ? AND key = ? AND window_start = ?`,
    ),
    sweepRateLimits: db.prepare('DELETE FROM rate_limits WHERE window_start < ?'),
  };

  // Transactional cap-check + insert per SPEC §4.7.
  const insertTokenAtomic = db.transaction(
    (tokenHash, handle, expiresAt, nextUrl, isSham, maxActive, now) => {
      if (maxActive > 0) {
        const { n: count } = stmt.countActiveTokens.get(handle, now);
        let toEvict = count - maxActive + 1;
        while (toEvict > 0) {
          stmt.evictOldestActive.run(handle, now);
          toEvict--;
        }
      }
      stmt.insertToken.run(tokenHash, handle, expiresAt, nextUrl, isSham);
    },
  );

  // Transactional account deletion per FR-37a.
  const deleteHandleAtomic = db.transaction((handle) => {
    stmt.deleteHandleSessions.run(handle);
    stmt.deleteHandleTokens.run(handle);
    stmt.deleteHandleRow.run(handle);
  });

  return {
    // --- Handle ---
    handleExists(handle) {
      assertHexHash(handle, 'handle');
      return !!stmt.handleExists.get(handle);
    },
    upsertHandle(handle) {
      assertHexHash(handle, 'handle');
      stmt.upsertHandleNoLogin.run(handle);
    },
    deleteHandle(handle) {
      assertHexHash(handle, 'handle');
      deleteHandleAtomic(handle);
    },

    // --- Token ---
    insertToken(args) {
      const {
        tokenHash,
        handle,
        expiresAt,
        nextUrl = null,
        isSham = false,
        maxActive = 0,
        now = Date.now(),
      } = args;
      assertHexHash(tokenHash, 'tokenHash');
      assertHexHash(handle, 'handle');
      insertTokenAtomic(
        tokenHash,
        handle,
        expiresAt,
        nextUrl,
        isSham ? 1 : 0,
        maxActive,
        now,
      );
    },
    getToken(tokenHash) {
      assertHexHash(tokenHash, 'tokenHash');
      const row = stmt.getToken.get(tokenHash);
      if (!row) return null;
      return {
        handle: row.handle,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        nextUrl: row.nextUrl,
        isSham: row.isSham === 1,
      };
    },
    markTokenUsed(tokenHash, usedAt) {
      assertHexHash(tokenHash, 'tokenHash');
      return stmt.markTokenUsed.run(usedAt, tokenHash).changes > 0;
    },
    countActiveTokens(handle, now = Date.now()) {
      assertHexHash(handle, 'handle');
      return stmt.countActiveTokens.get(handle, now).n;
    },
    evictOldestActiveToken(handle, now = Date.now()) {
      assertHexHash(handle, 'handle');
      return stmt.evictOldestActive.run(handle, now).changes;
    },
    sweepTokens(now = Date.now(), graceMs = DEFAULT_TOKEN_GRACE_MS) {
      return stmt.sweepTokens.run(now, now - graceMs).changes;
    },

    // --- Last login ---
    upsertLastLogin(handle, at) {
      assertHexHash(handle, 'handle');
      stmt.upsertLastLogin.run(handle, at);
    },
    getLastLogin(handle) {
      assertHexHash(handle, 'handle');
      const row = stmt.getLastLogin.get(handle);
      return row ? row.lastLoginAt : null;
    },

    // --- Session ---
    insertSession(sidHash, handle, expiresAt) {
      assertHexHash(sidHash, 'sidHash');
      assertHexHash(handle, 'handle');
      stmt.insertSession.run(sidHash, handle, expiresAt);
    },
    getSession(sidHash) {
      assertHexHash(sidHash, 'sidHash');
      return stmt.getSession.get(sidHash) ?? null;
    },
    deleteSession(sidHash) {
      assertHexHash(sidHash, 'sidHash');
      return stmt.deleteSession.run(sidHash).changes > 0;
    },
    sweepSessions(now = Date.now()) {
      return stmt.sweepSessions.run(now).changes;
    },

    // --- Rate limiting ---
    rateLimitIncrement(scope, key, windowStart) {
      return stmt.rateLimitIncrement.get(scope, key, windowStart).count;
    },
    rateLimitGet(scope, key, windowStart) {
      const row = stmt.rateLimitGet.get(scope, key, windowStart);
      return row ? row.count : 0;
    },
    sweepRateLimits(olderThan) {
      return stmt.sweepRateLimits.run(olderThan).changes;
    },

    // --- Lifecycle ---
    close() {
      db.close();
    },
  };
}
