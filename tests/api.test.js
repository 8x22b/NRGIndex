const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, createUser, request, login } = require("./helpers");

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1}`;

let ctx;
let adminCookie;
let editorCookie;
let userCookie;
let createdDrink;

before(async () => {
  ctx = await startServer();
  await createUser(ctx.db, { username: "admin", password: "admin-pass-123", role: "admin", displayName: "Админ" });
  await createUser(ctx.db, { username: "editor", password: "editor-pass-123", role: "editor", displayName: "Редактор" });
  await createUser(ctx.db, { username: "sanya", password: "sanya-pass-123", role: "user", displayName: "Саша" });
  await createUser(ctx.db, { username: "other", password: "other-pass-123", role: "user", displayName: "Другой" });

  adminCookie = (await login(ctx.base, "admin", "admin-pass-123")).cookie;
  editorCookie = (await login(ctx.base, "editor", "editor-pass-123")).cookie;
  userCookie = (await login(ctx.base, "sanya", "sanya-pass-123")).cookie;
});

after(async () => {
  await ctx.close();
});

test("health отдаёт версию", async () => {
  const res = await request(ctx.base, "GET", "/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
});

test("публичная сводка: тиры, участники, пустые напитки", async () => {
  const res = await request(ctx.base, "GET", "/api/public/summary");
  assert.equal(res.status, 200);
  assert.equal(res.json.tiers.length, 5);
  assert.equal(res.json.participants.length, 4);
  assert.equal(res.json.drinks.length, 0);
  assert.match(res.json.updatedAt, /^\d{2}\.\d{2}\.\d{4}$/);
  assert.equal(res.json.participants[0].role, "");
  assert.ok(res.json.participants[0].color.startsWith("#"));
});

test("статичные страницы отдаются", async () => {
  for (const page of ["/", "/cabinet.html", "/styles.css"]) {
    const res = await fetch(ctx.base + page);
    assert.equal(res.status, 200, `${page} должен отдаваться`);
  }
  const adminPage = await fetch(ctx.base + "/admin", { redirect: "manual" });
  assert.equal(adminPage.status, 302);
});

test("логин: неверный пароль и отсутствие полей", async () => {
  const wrong = await request(ctx.base, "POST", "/api/auth/login", {
    body: { username: "admin", password: "nope" },
  });
  assert.equal(wrong.status, 401);
  const empty = await request(ctx.base, "POST", "/api/auth/login", { body: {} });
  assert.equal(empty.status, 400);
});

test("rate-limit: после 5 неудач — 429", async () => {
  for (let i = 0; i < 5; i++) {
    const res = await request(ctx.base, "POST", "/api/auth/login", {
      body: { username: "bruteforce", password: "bad" },
    });
    assert.equal(res.status, 401);
  }
  const blocked = await request(ctx.base, "POST", "/api/auth/login", {
    body: { username: "bruteforce", password: "bad" },
  });
  assert.equal(blocked.status, 429);
});

test("CSRF: без заголовка и с чужим Origin — отказ", async () => {
  const noHeader = await request(ctx.base, "POST", "/api/auth/login", {
    body: { username: "admin", password: "admin-pass-123" },
    csrf: false,
  });
  assert.equal(noHeader.status, 403);

  const badOrigin = await request(ctx.base, "POST", "/api/auth/login", {
    body: { username: "admin", password: "admin-pass-123" },
    headers: { origin: "https://evil.example" },
  });
  assert.equal(badOrigin.status, 403);
});

test("сессия: me и logout", async () => {
  const me = await request(ctx.base, "GET", "/api/auth/me", { cookie: adminCookie });
  assert.equal(me.json.user.role, "admin");

  const anon = await request(ctx.base, "GET", "/api/auth/me");
  assert.equal(anon.json.user, null);

  const logout = await request(ctx.base, "POST", "/api/auth/logout", { cookie: editorCookie });
  assert.equal(logout.status, 200);
  const afterLogout = await request(ctx.base, "GET", "/api/auth/me", { cookie: editorCookie });
  assert.equal(afterLogout.json.user, null);

  editorCookie = (await login(ctx.base, "editor", "editor-pass-123")).cookie;
});

test("смена пароля: старый перестаёт работать", async () => {
  await createUser(ctx.db, { username: "passuser", password: "old-pass-123", role: "user" });
  const { cookie } = await login(ctx.base, "passuser", "old-pass-123");

  const wrongCurrent = await request(ctx.base, "POST", "/api/auth/password", {
    cookie,
    body: { currentPassword: "nope", newPassword: "new-pass-123" },
  });
  assert.equal(wrongCurrent.status, 401);

  const changed = await request(ctx.base, "POST", "/api/auth/password", {
    cookie,
    body: { currentPassword: "old-pass-123", newPassword: "new-pass-123" },
  });
  assert.equal(changed.status, 200);

  const oldLogin = await login(ctx.base, "passuser", "old-pass-123");
  assert.equal(oldLogin.res.status, 401);
  const newLogin = await login(ctx.base, "passuser", "new-pass-123");
  assert.equal(newLogin.res.status, 200);
});

test("загрузки: аноним 401, валидный PNG 201, мусор 400", async () => {
  const anon = await request(ctx.base, "POST", "/api/uploads", { body: { dataUrl: PNG_DATA_URL } });
  assert.equal(anon.status, 401);

  const ok = await request(ctx.base, "POST", "/api/uploads", {
    cookie: userCookie,
    body: { dataUrl: PNG_DATA_URL },
  });
  assert.equal(ok.status, 201);
  assert.match(ok.json.path, /^\/uploads\/[a-z0-9-]+\.png$/);

  const served = await fetch(ctx.base + ok.json.path);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");

  const bad = await request(ctx.base, "POST", "/api/uploads", {
    cookie: userCookie,
    body: { dataUrl: "data:text/plain;base64,aGk=" },
  });
  assert.equal(bad.status, 400);
});

test("редактор не может управлять пользователями", async () => {
  const res = await request(ctx.base, "POST", "/api/admin/users", {
    cookie: editorCookie,
    body: { username: "nope", displayName: "Нельзя", role: "admin" },
  });
  assert.equal(res.status, 403);
});

test("админ создаёт напиток, оценка из кабинета видна в сводке", async () => {
  const created = await request(ctx.base, "POST", "/api/admin/drinks", {
    cookie: adminCookie,
    body: {
      brand: "Adrenaline",
      name: "Adrenaline Rush",
      flavor: "Юдзу-клубника",
      edition: "Лимитка",
      imageDataUrl: PNG_DATA_URL,
      published: true,
    },
  });
  assert.equal(created.status, 201);
  createdDrink = created.json.drink;
  assert.match(createdDrink.slug, /^adrenaline-/);

  const rated = await request(ctx.base, "PUT", `/api/cabinet/ratings/${createdDrink.slug}`, {
    cookie: userCookie,
    body: { tier: "S", review: "Топчик" },
  });
  assert.equal(rated.status, 200);

  const summary = await request(ctx.base, "GET", "/api/public/summary");
  const drink = summary.json.drinks.find((d) => d.id === createdDrink.slug);
  assert.equal(drink.ratings.sanya.tier, "S");
  assert.equal(drink.ratings.sanya.review, "Топчик");
  assert.equal(drink.image, createdDrink.image);
});

test("удаление тира, который используется — 409", async () => {
  const res = await request(ctx.base, "DELETE", "/api/admin/tiers/S", { cookie: adminCookie });
  assert.equal(res.status, 409);
});

test("кабинет: пользователь добавляет свой напиток с фото", async () => {
  const res = await request(ctx.base, "POST", "/api/cabinet/drinks", {
    cookie: userCookie,
    body: {
      brand: "Volt",
      name: "Volt Mango",
      flavor: "Манго",
      edition: "Классика",
      tier: "A",
      review: "Хорошо бодрит",
      imageDataUrl: PNG_DATA_URL,
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.drink.published, true);
  assert.match(res.json.drink.image, /^\/uploads\//);

  const slug = res.json.drink.slug;
  const otherCookie = (await login(ctx.base, "other", "other-pass-123")).cookie;
  const forbidden = await request(ctx.base, "DELETE", `/api/cabinet/drinks/${slug}`, {
    cookie: otherCookie,
  });
  assert.equal(forbidden.status, 404);

  const patched = await request(ctx.base, "PATCH", `/api/cabinet/drinks/${slug}`, {
    cookie: userCookie,
    body: { brand: "Volt", name: "Volt Mango", flavor: "Манго-маракуйя", tier: "A", review: "" },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.drink.flavor, "Манго-маракуйя");

  const removed = await request(ctx.base, "DELETE", `/api/cabinet/drinks/${slug}`, {
    cookie: userCookie,
  });
  assert.equal(removed.status, 200);
});

test("снятие с публикации скрывает напиток", async () => {
  const off = await request(ctx.base, "PATCH", `/api/admin/drinks/${createdDrink.id}`, {
    cookie: editorCookie,
    body: { published: false },
  });
  assert.equal(off.status, 200);
  let summary = await request(ctx.base, "GET", "/api/public/summary");
  assert.equal(summary.json.drinks.some((d) => d.id === createdDrink.slug), false);

  const on = await request(ctx.base, "PATCH", `/api/admin/drinks/${createdDrink.id}`, {
    cookie: editorCookie,
    body: { published: true },
  });
  assert.equal(on.status, 200);
  summary = await request(ctx.base, "GET", "/api/public/summary");
  assert.equal(summary.json.drinks.some((d) => d.id === createdDrink.slug), true);
});

test("пользователи: создание с временным паролем, роль, удаление", async () => {
  const created = await request(ctx.base, "POST", "/api/admin/users", {
    cookie: adminCookie,
    body: { username: "newbie", displayName: "Новичок", role: "user", title: "Соучастник" },
  });
  assert.equal(created.status, 201);
  assert.ok(created.json.tempPassword.length >= 10);

  const firstLogin = await login(ctx.base, "newbie", created.json.tempPassword);
  assert.equal(firstLogin.res.status, 200);
  assert.equal(firstLogin.res.json.user.mustChangePassword, true);

  const duplicate = await request(ctx.base, "POST", "/api/admin/users", {
    cookie: adminCookie,
    body: { username: "newbie", displayName: "Дубль" },
  });
  assert.equal(duplicate.status, 409);

  const promoted = await request(ctx.base, "PATCH", `/api/admin/users/${created.json.user.id}`, {
    cookie: adminCookie,
    body: { role: "editor", isActive: true },
  });
  assert.equal(promoted.status, 200);
  assert.equal(promoted.json.user.role, "editor");

  const removed = await request(ctx.base, "DELETE", `/api/admin/users/${created.json.user.id}`, {
    cookie: adminCookie,
  });
  assert.equal(removed.status, 200);
});

test("нельзя убрать последнего админа и удалить себя", async () => {
  const selfDemote = await request(ctx.base, "PATCH", "/api/admin/users/1", {
    cookie: adminCookie,
    body: { role: "user" },
  });
  assert.equal(selfDemote.status, 409);

  const selfDelete = await request(ctx.base, "DELETE", "/api/admin/users/1", {
    cookie: adminCookie,
  });
  assert.equal(selfDelete.status, 409);
});

test("настройки: редактору нельзя, админ меняет, ключ не утекает", async () => {
  const denied = await request(ctx.base, "PUT", "/api/admin/settings", {
    cookie: editorCookie,
    body: { siteTitle: "Хак" },
  });
  assert.equal(denied.status, 403);

  const updated = await request(ctx.base, "PUT", "/api/admin/settings", {
    cookie: adminCookie,
    body: { siteTitle: "NRG / INDEX", openrouterKey: "sk-test-secret", openrouterModel: "openai/gpt-4o-mini" },
  });
  assert.equal(updated.status, 200);

  const data = await request(ctx.base, "GET", "/api/admin/data", { cookie: adminCookie });
  assert.equal(data.json.settings.openrouterKeySet, true);
  assert.equal(JSON.stringify(data.json.settings).includes("sk-test-secret"), false);

  const editorData = await request(ctx.base, "GET", "/api/admin/data", { cookie: editorCookie });
  assert.equal(editorData.json.audit.length, 0);
  assert.equal(JSON.stringify(editorData.json.settings).includes("sk-test-secret"), false);
  assert.ok(data.json.audit.length > 0);
});

test("аудит: редактор не видит, админ видит", async () => {
  const asEditor = await request(ctx.base, "GET", "/api/admin/data", { cookie: editorCookie });
  assert.equal(asEditor.status, 200);
  assert.equal(asEditor.json.audit.length, 0);
  assert.equal(asEditor.json.drinks.length >= 1, true);
});
