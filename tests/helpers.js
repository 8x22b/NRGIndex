const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../server/db");
const { createApp } = require("../server/app");
const { hashPassword } = require("../server/auth");

const ROOT = path.resolve(__dirname, "..");

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nrgindex-test-"));
  const config = {
    root: ROOT,
    publicDir: path.join(ROOT, "public"),
    dbPath: path.join(dir, "test.db"),
    uploadsDir: path.join(dir, "uploads"),
    port: 0,
    host: "127.0.0.1",
    trustProxy: false,
    cookieSecure: "false",
    sessionTtlDays: 1,
    maxUploadBytes: 1024 * 1024,
    jsonLimit: "2mb",
    dir,
  };
  const db = openDatabase(config.dbPath);
  const app = createApp({ db, config });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    config,
    db,
    base,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          db.close();
          fs.rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

async function createUser(db, { username, password, role = "user", displayName = "" } = {}) {
  const hash = await hashPassword(password);
  const info = db
    .prepare(
      "INSERT INTO users (username, display_name, role, password_hash) VALUES (?, ?, ?, ?)",
    )
    .run(username, displayName || username, role, hash);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
}

async function request(base, method, urlPath, options = {}) {
  const { body, cookie, raw, headers = {}, csrf = true } = options;
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (raw !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = raw;
  }
  if (csrf && !["GET", "HEAD"].includes(method)) init.headers["x-nrg-request"] = "1";
  if (cookie) init.headers.cookie = cookie;

  const res = await fetch(base + urlPath, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie() };
}

function sessionCookie(response) {
  const header = (response.setCookie || []).find((c) => c.startsWith("nrg_session="));
  return header ? header.split(";")[0] : "";
}

async function login(base, username, password) {
  const res = await request(base, "POST", "/api/auth/login", { body: { username, password } });
  return { res, cookie: sessionCookie(res) };
}

module.exports = { startServer, createUser, request, login, sessionCookie };
