const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, createUser, request, login } = require("./helpers");
const { findSimilarDrinks } = require("../server/lib/content");

let ctx;
let sanyaCookie;

const addDrink = (db, slug, brand, name, flavor, createdBy = null) =>
  db
    .prepare("INSERT INTO drinks (slug, brand, name, flavor, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(slug, brand, name, flavor, createdBy).lastInsertRowid;
const rate = (db, drinkId, userId, tier, review = "") =>
  db.prepare("INSERT INTO ratings (drink_id, user_id, tier_id, review) VALUES (?, ?, ?, ?)").run(drinkId, userId, tier, review);

before(async () => {
  ctx = await startServer();
  const sanya = await createUser(ctx.db, { username: "sanya", password: "sanya-pass-123", displayName: "Саня Петров" });
  const kira = await createUser(ctx.db, { username: "kira", password: "kira-pass-123", displayName: "Кира" });
  const ghost = await createUser(ctx.db, { username: "ghost", password: "ghost-pass-123", displayName: "Призрак" });
  ctx.db.prepare("UPDATE users SET is_public = 0 WHERE id = ?").run(ghost.id);

  const burn = addDrink(ctx.db, "burn-apple-kiwi", "Burn", "Burn Apple Kiwi", "яблоко киви", sanya.id);
  const monster = addDrink(ctx.db, "monster-white", "Monster", "Monster Ultra White", "цитрус", kira.id);
  const volt = addDrink(ctx.db, "volt-original", "Volt", "Volt Original", "", kira.id);
  rate(ctx.db, burn, sanya.id, "S", "Лучший, возьму ящик");
  rate(ctx.db, monster, sanya.id, "D");
  rate(ctx.db, burn, kira.id, "A");
  rate(ctx.db, monster, kira.id, "D", "Сладко");
  rate(ctx.db, volt, ghost.id, "B");
  sanyaCookie = (await login(ctx.base, "sanya", "sanya-pass-123")).cookie;
});

after(async () => {
  await ctx.close();
});

test("профиль: статистика, распределение и согласие со столом", async () => {
  const res = await request(ctx.base, "GET", "/api/public/profile/sanya");
  assert.equal(res.status, 200);
  const { profile, stats, ratings } = res.json;
  assert.equal(profile.id, "sanya");
  assert.equal(profile.initials, "СП");
  assert.equal(stats.ratings, 2);
  assert.equal(stats.reviews, 1);
  assert.equal(stats.added, 1);
  assert.equal(stats.average, 3);
  assert.deepEqual(stats.distribution, { S: 1, A: 0, B: 0, C: 0, D: 1 });
  // S против A (1 тир) и D против D (0) → среднее расхождение 0.5 → 88%
  assert.equal(stats.agreement, 88);
  const burn = ratings.find((item) => item.drink === "burn-apple-kiwi");
  assert.equal(burn.othersAvg, 4);
  assert.equal(burn.addedByUser, true);
  assert.equal(burn.review, "Лучший, возьму ящик");
});

test("профиль: скрытый и несуществующий участник — 404, голос скрытого не влияет на стол", async () => {
  assert.equal((await request(ctx.base, "GET", "/api/public/profile/ghost")).status, 404);
  assert.equal((await request(ctx.base, "GET", "/api/public/profile/nobody")).status, 404);
  const kira = await request(ctx.base, "GET", "/api/public/profile/kira");
  assert.equal(kira.json.stats.ratings, 2);
  assert.equal(kira.json.ratings.find((item) => item.drink === "burn-apple-kiwi").othersAvg, 5);
});

test("профиль: пустой участник без оценок", async () => {
  await createUser(ctx.db, { username: "newbie", password: "newbie-pass-123", displayName: "Новичок" });
  const res = await request(ctx.base, "GET", "/api/public/profile/newbie");
  assert.equal(res.status, 200);
  assert.equal(res.json.stats.ratings, 0);
  assert.equal(res.json.stats.average, null);
  assert.equal(res.json.stats.agreement, null);
});

test("страница профиля отдаётся статикой", async () => {
  const res = await request(ctx.base, "GET", "/profile.html?u=sanya");
  assert.equal(res.status, 200);
  assert.match(res.text, /profile\.js/);
});

test("кабинет /me отдаёт название и картинку оценённых банок и флаг публичности", async () => {
  const res = await request(ctx.base, "GET", "/api/cabinet/me", { cookie: sanyaCookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.user.isPublic, true);
  const burn = res.json.ratings.find((item) => item.drink === "burn-apple-kiwi");
  assert.equal(burn.name, "Burn Apple Kiwi");
  assert.equal(burn.image, "assets/favicon.svg");
});

test("findSimilarDrinks находит дубль по бренду и вкусу, игнорирует регистр и порядок слов", () => {
  const hits = findSimilarDrinks(ctx.db, { brand: "burn", name: "Burn Kiwi Apple", flavor: "" });
  assert.equal(hits[0]?.slug, "burn-apple-kiwi");
});

test("findSimilarDrinks не путает разные вкусы и чужие бренды", () => {
  assert.deepEqual(findSimilarDrinks(ctx.db, { brand: "Burn", name: "Burn Original", flavor: "" }), []);
  assert.deepEqual(findSimilarDrinks(ctx.db, { brand: "Red Bull", name: "Red Bull Apple Kiwi" }), []);
});

test("findSimilarDrinks: только бренд совпадает с «голой» банкой бренда", () => {
  const hits = findSimilarDrinks(ctx.db, { brand: "Volt", name: "Volt", flavor: "" });
  assert.equal(hits[0]?.slug, "volt-original");
});
