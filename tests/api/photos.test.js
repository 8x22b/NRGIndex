const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { startServer, createUser, request, login } = require("../helpers");

const SLUG = "burn-tropic";
let ctx;
let userCookie;
let testImageDataUrl;

before(async () => {
  const width = 60;
  const height = 60;
  const raw = Buffer.alloc(width * height * 4, 255);
  for (let y = 15; y < 45; y++) {
    for (let x = 18; x < 42; x++) {
      const offset = (y * width + x) * 4;
      raw[offset] = 30;
      raw[offset + 1] = 90;
      raw[offset + 2] = 220;
      raw[offset + 3] = 255;
    }
  }
  const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  testImageDataUrl = `data:image/png;base64,${png.toString("base64")}`;

  ctx = await startServer();
  await createUser(ctx.db, { username: "sanya", password: "sanya-pass-123", displayName: "Саша" });
  await createUser(ctx.db, { username: "kira", password: "kira-pass-123", displayName: "Кира" });
  userCookie = (await login(ctx.base, "sanya", "sanya-pass-123")).cookie;
  const kira = ctx.db.prepare("SELECT id FROM users WHERE username = 'kira'").get();
  ctx.db
    .prepare("INSERT INTO drinks (slug, brand, name, flavor, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(SLUG, "Burn", "Tropic", "манго", kira.id);
});

after(async () => {
  await ctx.close();
});

const photo = (cookie, body) =>
  request(ctx.base, "PUT", `/api/cabinet/drinks/${SLUG}/photo`, { body, cookie });

test("замену фото чужой банки делает любой участник — файл, акценты и история", async () => {
  const sanya = ctx.db.prepare("SELECT id FROM users WHERE username = 'sanya'").get();
  const res = await photo(userCookie, { imageDataUrl: testImageDataUrl });
  assert.equal(res.status, 200);
  assert.match(res.json.image, /^\/uploads\/[a-z0-9-]+\.webp$/);
  assert.equal(res.json.accent.length, 2);
  assert.ok(res.json.width > 0 && res.json.height > 0);

  const drink = ctx.db.prepare("SELECT * FROM drinks WHERE slug = ?").get(SLUG);
  assert.equal(drink.image_path, res.json.image);
  assert.equal(drink.accent_a, res.json.accent[0]);
  assert.equal(drink.accent_b, res.json.accent[1]);
  assert.match(drink.image_srcset, /\/uploads\//);
  assert.ok(fs.existsSync(path.join(ctx.config.uploadsDir, path.basename(res.json.image))));

  const audit = ctx.db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.action, "drink.update");
  assert.equal(audit.user_id, sanya.id);
  assert.equal(audit.entity, "drink");
  assert.ok(String(audit.details).includes("Картинка"), `история должна помнить правку фото: ${audit.details}`);
});

test("удаление фото очищает картинку, но сохраняет акценты и пишет историю", async () => {
  const before = ctx.db.prepare("SELECT * FROM drinks WHERE slug = ?").get(SLUG);
  assert.ok(before.image_path, "перед удалением фото должно быть");

  const res = await photo(userCookie, { removeImage: true });
  assert.equal(res.status, 200);
  assert.equal(res.json.image, "");

  const drink = ctx.db.prepare("SELECT * FROM drinks WHERE slug = ?").get(SLUG);
  assert.equal(drink.image_path, "");
  assert.equal(drink.image_srcset, "");
  assert.equal(drink.accent_a, before.accent_a);
  assert.equal(drink.accent_b, before.accent_b);

  const audit = ctx.db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.action, "drink.update");
  assert.ok(String(audit.details).includes("Картинка"));
});

test("без авторизации фото не поменять", async () => {
  const res = await request(ctx.base, "PUT", `/api/cabinet/drinks/${SLUG}/photo`, {
    body: { imageDataUrl: testImageDataUrl },
  });
  assert.equal(res.status, 401);
});

test("мусор вместо картинки и пустой запрос отвергаются", async () => {
  const svg = await photo(userCookie, { imageDataUrl: "data:image/svg+xml;base64,PHN2Zy8+" });
  assert.equal(svg.status, 400);

  const fake = await photo(userCookie, { imageDataUrl: "data:image/png;base64,bm90IGEgcG5n" });
  assert.equal(fake.status, 400);

  const empty = await photo(userCookie, {});
  assert.equal(empty.status, 400);
});

test("несуществующая банка — 404", async () => {
  const res = await request(ctx.base, "PUT", "/api/cabinet/drinks/no-such-drink/photo", {
    body: { removeImage: true },
    cookie: userCookie,
  });
  assert.equal(res.status, 404);
});
