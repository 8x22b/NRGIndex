const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { unauthorized, forbidden, tooMany } = require("./lib/errors");

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };
const SESSION_COOKIE = "nrg_session";

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(stored, password) {
  if (typeof stored !== "string" || !stored.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  if (!salt.length || !expected.length) return false;
  const key = await scrypt(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

function createAuth(db, config) {
  const ttlMs = config.sessionTtlDays * 24 * 60 * 60 * 1000;

  const stmt = {
    insertSession: db.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (?, ?, datetime('now', ?), ?, ?)",
    ),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
    findSession: db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.title, u.is_active,
             u.must_change_password, u.initials, u.color
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > datetime('now')
    `),
    touchSession: db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE token_hash = ?"),
    cleanup: db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    recordAttempt: db.prepare(
      "INSERT INTO login_attempts (username, ip, success) VALUES (?, ?, ?)",
    ),
    recentFailures: db.prepare(
      `SELECT COUNT(*) AS n FROM login_attempts
       WHERE ip = ? AND username = ? AND success = 0 AND created_at > datetime('now', '-15 minutes')`,
    ),
  };

  function createSession(userId, req) {
    const token = crypto.randomBytes(32).toString("base64url");
    stmt.insertSession.run(
      hashToken(token),
      userId,
      `+${config.sessionTtlDays} days`,
      String(req.ip || "").slice(0, 64),
      String(req.get("user-agent") || "").slice(0, 300),
    );
    return token;
  }

  function destroySession(token) {
    if (token) stmt.deleteSession.run(hashToken(token));
  }

  function destroyUserSessions(userId) {
    stmt.deleteUserSessions.run(userId);
  }

  function userFromRequest(req) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = stmt.findSession.get(tokenHash);
    if (!row || !row.is_active) return null;
    stmt.touchSession.run(tokenHash);
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      title: row.title,
      mustChangePassword: Boolean(row.must_change_password),
      initials: row.initials,
      color: row.color,
    };
  }

  function setSessionCookie(res, req, token) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure:
        config.cookieSecure === "true" || (config.cookieSecure === "auto" && Boolean(req.secure)),
      maxAge: ttlMs,
      path: "/",
    });
  }

  function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  const requireAuth = (req, res, next) => (req.user ? next() : next(unauthorized()));
  const requireRole =
    (...roles) =>
    (req, res, next) => {
      if (!req.user) return next(unauthorized());
      if (!roles.includes(req.user.role)) return next(forbidden());
      return next();
    };

  function checkLoginAllowed(ip, username) {
    const row = stmt.recentFailures.get(String(ip || ""), String(username || ""));
    if (row.n >= 5) throw tooMany("Слишком много неудачных попыток. Подождите 15 минут.");
  }

  function recordLogin(username, ip, success) {
    stmt.recordAttempt.run(
      String(username || "").slice(0, 64),
      String(ip || "").slice(0, 64),
      success ? 1 : 0,
    );
  }

  const cleanupTimer = setInterval(() => {
    try {
      stmt.cleanup.run();
    } catch {
      /* база может быть закрыта при остановке */
    }
  }, 60 * 60 * 1000);
  cleanupTimer.unref?.();

  return {
    createSession,
    destroySession,
    destroyUserSessions,
    userFromRequest,
    setSessionCookie,
    clearSessionCookie,
    requireAuth,
    requireRole,
    checkLoginAllowed,
    recordLogin,
    SESSION_COOKIE,
  };
}

module.exports = { hashPassword, verifyPassword, hashToken, createAuth, SESSION_COOKIE };
