const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { startServer, createUser, request, login } = require("./helpers");

let testImageDataUrl;
const hexToRgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));

let ctx;
let adminCookie;
let editorCookie;
let userCookie;
let createdDrink;

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

test("загрузки: аноним 401, валидный PNG 201 c авто-цветом, мусор 400", async () => {
  const anon = await request(ctx.base, "POST", "/api/uploads", { body: { dataUrl: testImageDataUrl } });
  assert.equal(anon.status, 401);

  const ok = await request(ctx.base, "POST", "/api/uploads", {
    cookie: userCookie,
    body: { dataUrl: testImageDataUrl },
  });
  assert.equal(ok.status, 201);
  assert.match(ok.json.path, /^\/uploads\/[a-z0-9-]+\.png$/);
  assert.equal(ok.json.accent.length, 2);
  const [r, g, b] = hexToRgb(ok.json.accent[0]);
  assert.ok(b > r + 40 && b > g, `акцент должен быть синеватым: ${ok.json.accent[0]}`);

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
      imageDataUrl: testImageDataUrl,
      published: true,
    },
  });
  assert.equal(created.status, 201);
  createdDrink = created.json.drink;
  assert.match(createdDrink.slug, /^adrenaline-/);
  const [r, g, b] = hexToRgb(createdDrink.accent[0]);
  assert.ok(b > r + 40 && b > g, `акцент из картинки: ${createdDrink.accent[0]}`);

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
      imageDataUrl: testImageDataUrl,
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.drink.published, true);
  assert.match(res.json.drink.image, /^\/uploads\//);
  const [vr, vg, vb] = hexToRgb(res.json.drink.accent[0]);
  assert.ok(vb > vr + 40 && vb > vg, `акцент из картинки: ${res.json.drink.accent[0]}`);

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

test("переобработка картинки: редактор может, акцент остаётся по банке", async () => {
  const res = await request(
    ctx.base,
    "POST",
    `/api/admin/drinks/${createdDrink.id}/reprocess-image`,
    { cookie: editorCookie },
  );
  assert.equal(res.status, 200);
  assert.match(res.json.drink.image, /^\/uploads\//);
  const [r, g, b] = hexToRgb(res.json.drink.accent[0]);
  assert.ok(b > r && b > g, `акцент остаётся синеватым: ${res.json.drink.accent[0]}`);
});

test("переобработка недоступна для картинок не из uploads", async () => {
  const created = await request(ctx.base, "POST", "/api/admin/drinks", {
    cookie: adminCookie,
    body: { brand: "Asset", name: "Asset Drink", flavor: "Тест", image: "/assets/favicon.svg" },
  });
  assert.equal(created.status, 201);
  const res = await request(
    ctx.base,
    "POST",
    `/api/admin/drinks/${created.json.drink.id}/reprocess-image`,
    { cookie: adminCookie },
  );
  assert.equal(res.status, 400);
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

test("скрытый пользователь исчезает из публичной сводки вместе с оценками", async () => {
  const sanya = ctx.db.prepare("SELECT id FROM users WHERE username = 'sanya'").get();
  const hidden = await request(ctx.base, "PATCH", `/api/admin/users/${sanya.id}`, {
    cookie: adminCookie,
    body: { isPublic: false },
  });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.json.user.isPublic, false);

  const summary = await request(ctx.base, "GET", "/api/public/summary");
  assert.equal(summary.json.participants.some((p) => p.id === "sanya"), false);
  const drink = summary.json.drinks.find((d) => d.id === createdDrink.slug);
  assert.equal("sanya" in drink.ratings, false);

  const back = await request(ctx.base, "PATCH", `/api/admin/users/${sanya.id}`, {
    cookie: adminCookie,
    body: { isPublic: true },
  });
  assert.equal(back.json.user.isPublic, true);
});

test("журнал: понятное описание и откат удаления оценки", async () => {
  const slug = createdDrink.slug;
  const set = await request(ctx.base, "PUT", `/api/cabinet/ratings/${slug}`, {
    cookie: userCookie,
    body: { tier: "A", review: "Хорош" },
  });
  assert.equal(set.status, 200);
  const del = await request(ctx.base, "DELETE", `/api/cabinet/ratings/${slug}`, { cookie: userCookie });
  assert.equal(del.status, 200);

  let data = await request(ctx.base, "GET", "/api/admin/data", { cookie: adminCookie });
  const entry = data.json.audit.find((row) => row.action === "rating.delete");
  assert.match(entry.summary, /Удалил свою оценку/);
  assert.match(entry.details, /Была: A/);
  assert.equal(entry.canUndo, true);

  const earlier = data.json.audit.find((row) => row.action === "rating.set" && row.id < entry.id);
  assert.equal(earlier.canUndo, false, "более ранняя запись по тому же объекту заблокирована");

  const undo = await request(ctx.base, "POST", `/api/admin/audit/${entry.id}/undo`, { cookie: adminCookie });
  assert.equal(undo.status, 200);
  const summary = await request(ctx.base, "GET", "/api/public/summary");
  const drink = summary.json.drinks.find((d) => d.id === slug);
  assert.equal(drink.ratings.sanya.tier, "A");
  assert.equal(drink.ratings.sanya.review, "Хорош");

  const again = await request(ctx.base, "POST", `/api/admin/audit/${entry.id}/undo`, { cookie: adminCookie });
  assert.equal(again.status, 409);

  data = await request(ctx.base, "GET", "/api/admin/data", { cookie: adminCookie });
  const undoRow = data.json.audit.find((row) => row.action === "audit.undo");
  assert.equal(undoRow.undoOf, entry.id);
  assert.ok(data.json.audit.find((row) => row.id === entry.id).undoneAt);
});

test("журнал: откат удаления напитка восстанавливает его вместе с оценками", async () => {
  const created = await request(ctx.base, "POST", "/api/admin/drinks", {
    cookie: adminCookie,
    body: { brand: "Tornado", name: "Tornado Storm", flavor: "Кола" },
  });
  const drink = created.json.drink;
  await request(ctx.base, "PUT", `/api/cabinet/ratings/${drink.slug}`, {
    cookie: userCookie,
    body: { tier: "C", review: "так себе" },
  });
  const removed = await request(ctx.base, "DELETE", `/api/admin/drinks/${drink.id}`, { cookie: adminCookie });
  assert.equal(removed.status, 200);

  const data = await request(ctx.base, "GET", "/api/admin/data", { cookie: adminCookie });
  const entry = data.json.audit.find((row) => row.action === "admin.drink.delete" && row.entityId === drink.slug);
  assert.match(entry.summary, /Удалил напиток «Tornado Storm»/);
  assert.match(entry.details, /оценок: 1/);

  const editorUndo = await request(ctx.base, "POST", `/api/admin/audit/${entry.id}/undo`, { cookie: editorCookie });
  assert.equal(editorUndo.status, 403);

  const undo = await request(ctx.base, "POST", `/api/admin/audit/${entry.id}/undo`, { cookie: adminCookie });
  assert.equal(undo.status, 200);
  const summary = await request(ctx.base, "GET", "/api/public/summary");
  const back = summary.json.drinks.find((d) => d.id === drink.slug);
  assert.ok(back);
  assert.equal(back.ratings.sanya.tier, "C");
});

test("журнал: изменение напитка показывает «было → стало» и откатывается", async () => {
  const patched = await request(ctx.base, "PATCH", `/api/admin/drinks/${createdDrink.id}`, {
    cookie: adminCookie,
    body: { flavor: "Персик" },
  });
  assert.equal(patched.status, 200);
  const data = await request(ctx.base, "GET", "/api/admin/data", { cookie: adminCookie });
  const entry = data.json.audit.find((row) => row.action === "admin.drink.update");
  assert.match(entry.details, /Вкус: «Юдзу-клубника» → «Персик»/);
  const undo = await request(ctx.base, "POST", `/api/admin/audit/${entry.id}/undo`, { cookie: adminCookie });
  assert.equal(undo.status, 200);
  const after = await request(ctx.base, "GET", "/api/admin/data", { cookie: adminCookie });
  assert.equal(after.json.drinks.find((d) => d.id === createdDrink.id).flavor, "Юдзу-клубника");
});

test("настройки ИИ: base URL и STT-модель, кривой URL отклоняется", async () => {
  const bad = await request(ctx.base, "PUT", "/api/admin/settings", {
    cookie: adminCookie,
    body: { aiBaseUrl: "javascript:alert(1)" },
  });
  assert.equal(bad.status, 400);

  const ok = await request(ctx.base, "PUT", "/api/admin/settings", {
    cookie: adminCookie,
    body: { aiBaseUrl: "https://llm.example/v1/", sttModel: "" },
  });
  assert.equal(ok.status, 200);
  const data = await request(ctx.base, "GET", "/api/admin/data", { cookie: adminCookie });
  assert.equal(data.json.settings.aiBaseUrl, "https://llm.example/v1");
  assert.equal(data.json.settings.sttModel, "openai/whisper-large-v3-turbo");
  const entry = data.json.audit.find((row) => row.action === "admin.settings.update");
  assert.match(entry.details, /Base URL: «https:\/\/openrouter.ai\/api\/v1» → «https:\/\/llm.example\/v1»/);
});

test("транскрибация: валидация входа", async () => {
  const anon = await request(ctx.base, "POST", "/api/cabinet/ai/transcribe", {
    body: { audio: "AAAA", mimeType: "audio/webm" },
  });
  assert.equal(anon.status, 401);
  const badType = await request(ctx.base, "POST", "/api/cabinet/ai/transcribe", {
    cookie: userCookie,
    body: { audio: Buffer.alloc(400).toString("base64"), mimeType: "text/html" },
  });
  assert.equal(badType.status, 400);
});

test("CSP разрешает blob: для аудио", async () => {
  const res = await fetch(`${ctx.base}/cabinet.html`);
  assert.match(res.headers.get("content-security-policy"), /media-src 'self' blob:/);
});

test("несуществующий файл в /uploads отдаёт 404", async () => {
  const res = await fetch(`${ctx.base}/uploads/nope.png`);
  assert.equal(res.status, 404);
});

test("после повторного входа старая сессия перестаёт работать", async () => {
  const first = await login(ctx.base, "editor", "editor-pass-123");
  const second = await login(ctx.base, "editor", "editor-pass-123");
  const oldMe = await request(ctx.base, "GET", "/api/auth/me", { cookie: first.cookie });
  assert.equal(oldMe.json.user, null);
  const newMe = await request(ctx.base, "GET", "/api/auth/me", { cookie: second.cookie });
  assert.equal(newMe.json.user.username, "editor");
  editorCookie = second.cookie;
});

test("API-ответы помечены no-store, страницы — нет", async () => {
  const api = await fetch(`${ctx.base}/api/auth/me`);
  assert.equal(api.headers.get("cache-control"), "no-store");
  const page = await fetch(`${ctx.base}/`);
  assert.notEqual(page.headers.get("cache-control"), "no-store");
});

test("спуф X-Forwarded-For не обходит лимит логина", async () => {
  for (let i = 0; i < 5; i++) {
    await request(ctx.base, "POST", "/api/auth/login", {
      body: { username: "xff-target", password: "bad" },
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
  }
  const blocked = await request(ctx.base, "POST", "/api/auth/login", {
    body: { username: "xff-target", password: "bad" },
    headers: { "x-forwarded-for": "8.8.8.8" },
  });
  assert.equal(blocked.status, 429);
});

test("сессия истекает после длительного простоя", async () => {
  await createUser(ctx.db, { username: "idle-user", password: "idle-pass-123" });
  const { cookie } = await login(ctx.base, "idle-user", "idle-pass-123");
  ctx.db.prepare("UPDATE sessions SET last_seen_at = datetime('now', '-40 days')").run();
  const me = await request(ctx.base, "GET", "/api/auth/me", { cookie });
  assert.equal(me.json.user, null);
});
