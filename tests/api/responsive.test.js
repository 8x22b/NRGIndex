const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startServer, createUser } = require("../helpers");
const { drinkImage } = require("../../server/lib/assets");

let ctx;

before(async () => {
  ctx = await startServer();
  ctx.db
    .prepare(
      `INSERT INTO drinks (slug, brand, name, flavor, edition, image_path, accent_a, accent_b, is_published)
       VALUES ('resp-test', 'Burn', 'Burn Original', 'оригинал', '', 'assets/burn-original.png', '#ff4f79', '#ff7448', 1)`,
    )
    .run();
});

after(async () => {
  await ctx.close();
});

test("манифест ассетов: все записи с размерами и webp-srcset", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "public", "assets", "manifest.json"), "utf8"),
  );
  assert.ok(Object.keys(manifest).length >= 10);
  for (const [key, entry] of Object.entries(manifest)) {
    assert.ok(entry.width > 0 && entry.height > 0, key);
    assert.match(entry.srcset, /\.webp \d+w/, key);
  }
});

test("drinkImage: манифест для assets, колонки БД в приоритете", () => {
  const fromManifest = drinkImage({
    image_path: "assets/burn-original.png",
    image_width: 0,
    image_height: 0,
    image_srcset: "",
  });
  assert.equal(fromManifest.imageWidth, 313);
  assert.equal(fromManifest.imageHeight, 768);
  assert.match(fromManifest.imageSrcSet, /burn-original\.webp/);
  const fromDb = drinkImage({
    image_path: "/uploads/x.webp",
    image_width: 100,
    image_height: 200,
    image_srcset: "/uploads/x.webp 100w",
  });
  assert.deepEqual(fromDb, { imageWidth: 100, imageHeight: 200, imageSrcSet: "/uploads/x.webp 100w" });
  assert.deepEqual(drinkImage({ image_path: "assets/favicon.svg" }), {
    imageWidth: 0,
    imageHeight: 0,
    imageSrcSet: "",
  });
});

test("миграция: колонки image_* в drinks", () => {
  const cols = ctx.db.prepare("PRAGMA table_info(drinks)").all().map((c) => c.name);
  assert.ok(cols.includes("image_width"));
  assert.ok(cols.includes("image_height"));
  assert.ok(cols.includes("image_srcset"));
});

test("summary отдаёт размеры и srcset для ассета", async () => {
  const res = await fetch(`${ctx.base}/api/public/summary`);
  assert.equal(res.status, 200);
  const drink = (await res.json()).drinks.find((d) => d.id === "resp-test");
  assert.equal(drink.imageWidth, 313);
  assert.equal(drink.imageHeight, 768);
  assert.match(drink.imageSrcSet, /\/assets\/burn-original.*\.webp/);
});

test("профиль отдаёт размеры картинки", async () => {
  const user = await createUser(ctx.db, { username: "respuser", password: "secret12345" });
  const drinkId = ctx.db.prepare("SELECT id FROM drinks WHERE slug = 'resp-test'").get().id;
  ctx.db
    .prepare("INSERT INTO ratings (drink_id, user_id, tier_id, review) VALUES (?, ?, 'S', 'топ')")
    .run(drinkId, user.id);
  const res = await fetch(`${ctx.base}/api/public/profile/respuser`);
  assert.equal(res.status, 200);
  const rating = (await res.json()).ratings[0];
  assert.equal(rating.imageWidth, 313);
  assert.match(rating.imageSrcSet, /burn-original/);
});
