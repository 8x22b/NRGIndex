const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, createUser, request, login } = require("../helpers");

let ctx;
let adminCookie;
let editorCookie;
let sanyaId;
let kiraId;

const UNSET = "2000-01-01 00:00:00";
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 19).replace("T", " ");

const addDrink = (slug, brand, name, { published = 1, createdBy = null, createdAt = UNSET } = {}) => {
  const info = ctx.db
    .prepare("INSERT INTO drinks (slug, brand, name, flavor, is_published, created_by) VALUES (?, ?, ?, '', ?, ?)")
    .run(slug, brand, name, published, createdBy);
  ctx.db.prepare("UPDATE drinks SET created_at = ? WHERE id = ?").run(createdAt, info.lastInsertRowid);
  return info.lastInsertRowid;
};

const rate = (drinkId, userId, tier, review = "", updatedAt = UNSET) =>
  ctx.db
    .prepare("INSERT INTO ratings (drink_id, user_id, tier_id, review, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(drinkId, userId, tier, review, updatedAt, updatedAt);

const addAudit = (userId, summary, at) =>
  ctx.db
    .prepare("INSERT INTO audit_log (user_id, action, entity, summary, created_at) VALUES (?, 'rating.set', 'rating', ?, ?)")
    .run(userId, summary, at);

before(async () => {
  ctx = await startServer();
  const sanya = await createUser(ctx.db, { username: "sanya", password: "sanya-pass-123", displayName: "Саша" });
  const kira = await createUser(ctx.db, { username: "kira", password: "kira-pass-123", displayName: "Кира" });
  await createUser(ctx.db, { username: "admin", password: "admin-pass-123", role: "admin", displayName: "Админ" });
  await createUser(ctx.db, { username: "editor", password: "editor-pass-123", role: "editor", displayName: "Редактор" });
  sanyaId = sanya.id;
  kiraId = kira.id;

  const burn = addDrink("burn-tropic", "Burn", "Tropic", { createdBy: sanyaId, createdAt: daysAgo(10) });
  const volt = addDrink("volt-mango", "Volt", "Mango", { createdBy: kiraId, createdAt: daysAgo(2) });
  addDrink("ghost-cola", "Ghost", "Cola", { published: 0, createdAt: daysAgo(3) });
  rate(burn, sanyaId, "S", "Огонь", daysAgo(0));
  rate(burn, kiraId, "B", "", daysAgo(0));
  rate(volt, sanyaId, "A", "", daysAgo(2));
  addAudit(sanyaId, "Саша изменил напиток", daysAgo(5));
  addAudit(kiraId, "Кира поставила оценку B", daysAgo(0));

  // ИИ-запросы: свежий разбор + старая перерисовка (выйдет из окна 30 дней)
  ctx.db
    .prepare(
      "INSERT INTO ai_usage (kind, model, user_id, prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("parse", "openai/gpt-4o-mini", sanyaId, 900, 100, 1000, 0.000195, daysAgo(0));
  ctx.db
    .prepare(
      "INSERT INTO ai_usage (kind, model, user_id, prompt_tokens, completion_tokens, total_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run("redraw", "gemini-3.1-flash-lite-image", kiraId, 120, 0, 120, 0.01, daysAgo(40));

  adminCookie = (await login(ctx.base, "admin", "admin-pass-123")).cookie;
  editorCookie = (await login(ctx.base, "editor", "editor-pass-123")).cookie;
  await login(ctx.base, "sanya", "sanya-pass-123");
  await login(ctx.base, "kira", "kira-pass-123");
  // Кира заходила 40 минут назад — в онлайне её быть не должно
  ctx.db.prepare("UPDATE sessions SET last_seen_at = datetime('now', '-40 minutes') WHERE user_id = ?").run(kiraId);
});

after(async () => {
  await ctx.close();
});

const stats = (cookie, query = "") => request(ctx.base, "GET", `/api/admin/stats${query}`, { cookie });

test("статистика: только для админов", async () => {
  assert.equal((await stats("")).status, 401);
  assert.equal((await stats(editorCookie)).status, 403);
  assert.equal((await stats(adminCookie)).status, 200);
});

test("статистика: сводные цифры по сайту", async () => {
  const res = await stats(adminCookie);
  assert.equal(res.status, 200);
  const { totals } = res.json;
  assert.equal(totals.drinks, 3);
  assert.equal(totals.published, 2);
  assert.equal(totals.hidden, 1);
  assert.equal(totals.users, 4);
  assert.equal(totals.activeUsers, 4);
  assert.equal(totals.ratings, 3);
  assert.equal(totals.reviews, 1);
  assert.equal(totals.avgScore, 4, "S+A+B = (5+4+3)/3");
  assert.equal(totals.ratingsPerDrink, 1);
});

test("статистика: активность по дням и период", async () => {
  const res = await stats(adminCookie, "?days=7");
  const { days, period } = res.json;
  assert.equal(days.length, 7);
  assert.equal(period.days, 7, "длина периода приходит отдельно от серии дней");
  assert.equal(period.ratings, 3);
  assert.equal(period.drinks, 2, "volt + ghost за последние 7 дней");
  assert.ok(period.bestDay && period.bestDay.events >= 1);
  const today = days.at(-1);
  assert.equal(today.ratings, 2, "сегодня две оценки");
  assert.equal(today.drinks, 0, "сегодня банок не добавляли");
  assert.equal(days.at(-4).drinks, 1, "скрытая банка создана 3 дня назад и попадает в серию");
  assert.ok(days.every((row) => typeof row.label === "string" && row.label.length));
});

test("статистика: период зажимается в 7..90", async () => {
  assert.equal((await stats(adminCookie, "?days=2")).json.days.length, 7);
  assert.equal((await stats(adminCookie, "?days=999")).json.days.length, 90);
});

test("статистика: распределение по тирам и топы", async () => {
  const res = await stats(adminCookie);
  const { tiers, topDrinks, topUsers } = res.json;
  const byTier = Object.fromEntries(tiers.map((tier) => [tier.tier, tier.count]));
  assert.equal(byTier.S, 1);
  assert.equal(byTier.A, 1);
  assert.equal(byTier.B, 1);
  assert.equal(tiers.reduce((sum, tier) => sum + tier.count, 0), 3);

  assert.equal(topDrinks[0].slug, "burn-tropic");
  assert.equal(topDrinks[0].votes, 2);
  assert.equal(topDrinks[1].slug, "volt-mango");
  assert.equal(topUsers[0].username, "sanya");
  assert.deepEqual(
    { ratings: topUsers[0].ratings, reviews: topUsers[0].reviews, added: topUsers[0].added },
    { ratings: 2, reviews: 1, added: 1 },
  );
});

test("статистика: онлайн без тех, кто ушёл, и последние изменения", async () => {
  const res = await stats(adminCookie);
  const { online, recent } = res.json;
  const names = online.map((user) => user.username);
  assert.ok(names.includes("admin"), "админ только что заходил");
  assert.ok(names.includes("sanya"), "сания только что заходила");
  assert.ok(!names.includes("kira"), "кира 40 минут назад — уже не онлайн");
  const onlineUser = online.find((user) => user.username === "sanya");
  assert.match(onlineUser.device, /PowerShell|curl|браузер/i);
  assert.equal(typeof onlineUser.ip, "string");

  assert.equal(recent.length, 2);
  assert.match(recent[0].summary, /Кира/);
  assert.equal(recent[0].who, "Кира");
  assert.match(recent[1].summary, /Саша/);
});

test("статистика: тепловая карта неделя×час и последние изменения по времени", async () => {
  const res = await stats(adminCookie);
  const { heatmap, recent } = res.json;
  assert.ok(Array.isArray(heatmap) && heatmap.length >= 2);
  for (const cell of heatmap) {
    assert.ok(cell.w >= 0 && cell.w <= 6, `день недели ${cell.w}`);
    assert.ok(cell.h >= 0 && cell.h <= 23, `час ${cell.h}`);
    assert.ok(cell.n >= 1);
  }
  assert.match(recent[0].at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("статистика: ИИ-запросы — виды, модели и трата за всё время", async () => {
  const res = await stats(adminCookie);
  assert.equal(res.status, 200);
  const { ai } = res.json;
  const parse = ai.kinds.find((row) => row.kind === "parse");
  assert.equal(parse.requests, 1);
  assert.equal(parse.totalTokens, 1000);
  assert.ok(Math.abs(parse.costUsd - 0.000195) < 1e-9);
  assert.ok(!ai.kinds.some((row) => row.kind === "redraw"), "перерисовка 40 дней назад — вне окна 30 дней");
  const model = ai.models.find((row) => row.model === "openai/gpt-4o-mini");
  assert.equal(model.requests, 1);
  assert.equal(ai.allTime.requests, 2, "за всё время считаются оба запроса");
  assert.ok(Math.abs(ai.allTime.costUsd - 0.010195) < 1e-9);
});
