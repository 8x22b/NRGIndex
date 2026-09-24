const express = require("express");
const { verifyPassword, hashPassword, DUMMY_HASH } = require("../auth");
const { unauthorized, badRequest } = require("../lib/errors");
const { password } = require("../lib/validate");
const { userToApi } = require("../lib/serialize");

module.exports = (db, auth) => {
  const router = express.Router();

  router.post("/login", async (req, res) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const pass = String(req.body?.password || "");
    const ip = req.ip || "";
    if (!username || !pass) throw badRequest("Укажите логин и пароль");

    auth.checkLoginAllowed(ip, username);
    const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    let ok = false;
    if (row && row.is_active && row.password_hash) {
      ok = await verifyPassword(row.password_hash, pass);
    } else {
      await verifyPassword(DUMMY_HASH, pass);
    }
    auth.recordLogin(username, ip, ok);
    if (!ok) throw unauthorized("Неверный логин или пароль");

    // Не трогаем сессии других устройств: вход на телефоне не выкидывает с ноутбука.
    // Все сессии по-прежнему сбрасываются при смене пароля.
    const token = auth.createSession(row.id, req);
    auth.setSessionCookie(res, req, token);
    res.json({ user: userToApi(row) });
  });

  router.post("/logout", (req, res) => {
    auth.destroySession(req.cookies?.[auth.SESSION_COOKIE]);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    res.json({ user: req.user || null });
  });

  router.post("/password", auth.requireAuth, async (req, res) => {
    const newPassword = password(req.body?.newPassword);
    const currentPassword = String(req.body?.currentPassword || "");
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!row) throw unauthorized();

    if (!row.must_change_password) {
      const valid = await verifyPassword(row.password_hash, currentPassword);
      if (!valid) throw unauthorized("Текущий пароль неверный");
    }

    const hash = await hashPassword(newPassword);
    db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?",
    ).run(hash, row.id);
    auth.destroyUserSessions(row.id);
    const token = auth.createSession(row.id, req);
    auth.setSessionCookie(res, req, token);
    res.json({ ok: true });
  });

  return router;
};
