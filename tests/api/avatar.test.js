const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { startServer, createUser, request, login } = require("../helpers");

let ctx;
let cookie;
let avatarDataUrl;

before(async () => {
  const raw = Buffer.alloc(120 * 80 * 4, 200);
  const png = await sharp(raw, { raw: { width: 120, height: 80, channels: 4 } }).png().toBuffer();
  avatarDataUrl = `data:image/png;base64,${png.toString("base64")}`;

  ctx = await startServer();
  await createUser(ctx.db, { username: "sanya", password: "sanya-pass-123", displayName: "Саша" });
  cookie = (await login(ctx.base, "sanya", "sanya-pass-123")).cookie;
});

after(async () => {
  await ctx.close();
});

test("аватар: загрузка, публичный список, замена и удаление", async () => {
  const saved = await request(ctx.base, "PUT", "/api/cabinet/avatar", {
    body: { imageDataUrl: avatarDataUrl },
    cookie,
  });
  assert.equal(saved.status, 200);
  assert.match(saved.json.user.avatar, /^\/uploads\/[a-z0-9-]+\.webp$/);
  const first = path.join(ctx.config.uploadsDir, path.basename(saved.json.user.avatar));
  assert.ok(fs.existsSync(first), "файл аватара должен появиться");
  const meta = await sharp(fs.readFileSync(first)).metadata();
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);

  const summary = await request(ctx.base, "GET", "/api/public/summary");
  const me = summary.json.participants.find((person) => person.id === "sanya");
  assert.equal(me.avatar, saved.json.user.avatar);

  const session = await request(ctx.base, "GET", "/api/auth/me", { cookie });
  assert.equal(session.json.user.avatar, saved.json.user.avatar);

  const replaced = await request(ctx.base, "PUT", "/api/cabinet/avatar", {
    body: { imageDataUrl: avatarDataUrl },
    cookie,
  });
  assert.notEqual(replaced.json.user.avatar, saved.json.user.avatar);
  assert.ok(!fs.existsSync(first), "старый файл аватара должен быть удалён");
  const second = path.join(ctx.config.uploadsDir, path.basename(replaced.json.user.avatar));
  assert.ok(fs.existsSync(second));

  const removed = await request(ctx.base, "PUT", "/api/cabinet/avatar", {
    body: { removeAvatar: true },
    cookie,
  });
  assert.equal(removed.json.user.avatar, "");
  assert.ok(!fs.existsSync(second), "файл удалённого аватара должен исчезнуть");

  const bad = await request(ctx.base, "PUT", "/api/cabinet/avatar", {
    body: { imageDataUrl: "data:image/png;base64,bm90" },
    cookie,
  });
  assert.equal(bad.status, 400);
});
