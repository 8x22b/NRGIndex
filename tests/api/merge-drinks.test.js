const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, createUser, request, login } = require("../helpers");

let ctx;
let editorCookie;
let adminCookie;
let userCookie;
let targetId;
let sourceId;
let extraId;

const insertDrink = (fields) => {
  const info = ctx.db
    .prepare(
      `INSERT INTO drinks (slug, brand, name, flavor, edition, barcode, image_path, image_width, image_height, image_srcset, accent_a, accent_b, is_published)
       VALUES (@slug, @brand, @name, @flavor, @edition, @barcode, @image_path, @image_width, @image_height, @image_srcset, @accent_a, @accent_b, @is_published)`,
    )
    .run({
      slug: "",
      brand: "",
      name: "",
      flavor: "",
      edition: "",
      barcode: "",
      image_path: "",
      image_width: 0,
      image_height: 0,
      image_srcset: "",
      accent_a: "#ff4f79",
      accent_b: "#ff7448",
      is_published: 1,
      ...fields,
    });
  return info.lastInsertRowid;
};

const rate = (drinkId, username, tier, review, updatedAt) => {
  const user = ctx.db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  ctx.db
    .prepare(
      `INSERT INTO ratings (drink_id, user_id, tier_id, review, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(drinkId, user.id, tier, review, updatedAt || "2026-09-01 00:00:00");
};

before(async () => {
  ctx = await startServer();
  await createUser(ctx.db, { username: "editor", password: "editor-pass-123", role: "editor", displayName: "Ред" });
  await createUser(ctx.db, { username: "root", password: "root-pass-123", role: "admin", displayName: "Админ" });
  await createUser(ctx.db, { username: "sanya", password: "sanya-pass-123", displayName: "Саша" });
  await createUser(ctx.db, { username: "kira", password: "kira-pass-123", displayName: "Кира" });
  await createUser(ctx.db, { username: "lev", password: "lev-pass-123", displayName: "Лев" });
  editorCookie = (await login(ctx.base, "editor", "editor-pass-123")).cookie;
  adminCookie = (await login(ctx.base, "root", "root-pass-123")).cookie;
  userCookie = (await login(ctx.base, "sanya", "sanya-pass-123")).cookie;

  targetId = insertDrink({
    slug: "burn-tropic",
    brand: "Burn",
    name: "Tropic",
    flavor: "манго",
    is_published: 0,
  });
  sourceId = insertDrink({
    slug: "burn-tropik",
    brand: "Burn",
    name: "Tropik",
    barcode: "4601234567890",
    image_path: "/uploads/dup.webp",
    image_width: 120,
    image_height: 200,
    image_srcset: "/uploads/dup.webp 1x",
    accent_a: "#111111",
    accent_b: "#222222",
    is_published: 1,
  });
  extraId = insertDrink({ slug: "adrenaline-rush", brand: "Adrenaline", name: "Rush" });

  rate(targetId, "sanya", "S", "вкусно", "2026-09-01 00:00:00");
  rate(sourceId, "sanya", "A", "норм, беру ещё", "2026-09-10 00:00:00");
  rate(targetId, "kira", "C", "", "2026-09-20 00:00:00");
  rate(sourceId, "kira", "S", "огонь", "2026-09-01 00:00:00");
  rate(sourceId, "lev", "B", "сойдёт", "2026-09-05 00:00:00");

  ctx.db.prepare("INSERT INTO drink_relations (drink_id, related_id) VALUES (?, ?)").run(sourceId, extraId);
  ctx.db.prepare("INSERT INTO drink_relations (drink_id, related_id) VALUES (?, ?)").run(extraId, sourceId);
  ctx.db.prepare("INSERT INTO drink_relations (drink_id, related_id) VALUES (?, ?)").run(sourceId, targetId);
});

after(async () => {
  await ctx.close();
});

const merge = (cookie, id, body) =>
  request(ctx.base, "POST", `/api/admin/drinks/${id}/merge`, { body, cookie });

test("мердж недоступен без прав и валидирует входные данные", async () => {
  const anon = await merge("", sourceId, { targetId });
  assert.equal(anon.status, 401);

  const asUser = await merge(userCookie, sourceId, { targetId });
  assert.equal(asUser.status, 403);

  const self = await merge(editorCookie, sourceId, { targetId: sourceId });
  assert.equal(self.status, 400);

  const missing = await merge(editorCookie, sourceId, { targetId: 99999 });
  assert.equal(missing.status, 404);

  const noBody = await merge(editorCookie, sourceId, {});
  assert.equal(noBody.status, 400);
});

test("мердж переносит оценки, связи и пустые поля в оставшийся напиток", async () => {
  const res = await merge(editorCookie, sourceId, { targetId });
  assert.equal(res.status, 200);
  assert.equal(res.json.movedRatings, 1);
  assert.equal(res.json.mergedRatings, 2);
  assert.equal(res.json.movedRelations, 2);
  assert.ok(res.json.filled.includes("Штрих-код"));
  assert.ok(res.json.filled.includes("Картинка"));
  assert.ok(res.json.filled.includes("Публикация"));

  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM drinks WHERE id = ?").get(sourceId).n, 0);

  const target = ctx.db.prepare("SELECT * FROM drinks WHERE id = ?").get(targetId);
  assert.equal(target.barcode, "4601234567890");
  assert.equal(target.image_path, "/uploads/dup.webp");
  assert.equal(target.image_width, 120);
  assert.equal(target.image_srcset, "/uploads/dup.webp 1x");
  assert.equal(target.accent_a, "#111111");
  assert.equal(target.is_published, 1);
  assert.equal(target.flavor, "манго", "непустой вкус оставшегося напитка не трогаем");

  const ratings = ctx.db
    .prepare("SELECT u.username, r.tier_id AS tier, r.review FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.drink_id = ? ORDER BY u.username")
    .all(targetId);
  assert.deepEqual(ratings, [
    { username: "kira", tier: "S", review: "огонь" },
    { username: "lev", tier: "B", review: "сойдёт" },
    { username: "sanya", tier: "A", review: "норм, беру ещё" },
  ]);

  const relations = ctx.db
    .prepare("SELECT drink_id, related_id FROM drink_relations ORDER BY drink_id, related_id")
    .all();
  assert.deepEqual(relations, [
    { drink_id: targetId, related_id: extraId },
    { drink_id: extraId, related_id: targetId },
  ]);

  const audit = ctx.db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.action, "admin.drink.merge");
  assert.equal(audit.entity, "drink");
  assert.equal(audit.entity_id, "burn-tropik");
  assert.equal(audit.target_key, `drink:${targetId}`);
  assert.match(audit.summary, /Объединил напиток/);
  assert.match(audit.details, /Оценок перенесено: 1/);
  assert.match(audit.details, /@sanya: оставлена оценка дубля A вместо S/);
});

test("мердж откатывается из журнала: дубль и поля возвращаются", async () => {
  const audit = ctx.db.prepare("SELECT id FROM audit_log WHERE action = 'admin.drink.merge' ORDER BY id DESC LIMIT 1").get();
  const res = await request(ctx.base, "POST", `/api/admin/audit/${audit.id}/undo`, { cookie: adminCookie });
  assert.equal(res.status, 200);

  const source = ctx.db.prepare("SELECT * FROM drinks WHERE id = ?").get(sourceId);
  assert.ok(source, "дубль должен вернуться");
  assert.equal(source.slug, "burn-tropik");
  assert.equal(source.barcode, "4601234567890");
  assert.equal(source.image_path, "/uploads/dup.webp");
  assert.equal(source.is_published, 1);

  const sourceRatings = ctx.db
    .prepare("SELECT u.username, r.tier_id AS tier FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.drink_id = ? ORDER BY u.username")
    .all(sourceId);
  assert.deepEqual(sourceRatings, [
    { username: "kira", tier: "S" },
    { username: "lev", tier: "B" },
    { username: "sanya", tier: "A" },
  ]);

  const target = ctx.db.prepare("SELECT * FROM drinks WHERE id = ?").get(targetId);
  assert.equal(target.barcode, "");
  assert.equal(target.image_path, "");
  assert.equal(target.is_published, 0);

  const targetRatings = ctx.db
    .prepare("SELECT u.username, r.tier_id AS tier FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.drink_id = ? ORDER BY u.username")
    .all(targetId);
  assert.deepEqual(targetRatings, [
    { username: "kira", tier: "C" },
    { username: "sanya", tier: "S" },
  ]);

  const relations = ctx.db
    .prepare("SELECT drink_id, related_id FROM drink_relations ORDER BY drink_id, related_id")
    .all();
  assert.deepEqual(relations, [
    { drink_id: sourceId, related_id: targetId },
    { drink_id: sourceId, related_id: extraId },
    { drink_id: extraId, related_id: sourceId },
  ]);
});
