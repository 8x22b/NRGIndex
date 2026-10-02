const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, createUser, request, login } = require("../helpers");

let ctx;
let cookie;
let originalFetch;

before(async () => {
  ctx = await startServer();
  await createUser(ctx.db, { username: "sanya", password: "sanya-pass-123", displayName: "Саша" });
  cookie = (await login(ctx.base, "sanya", "sanya-pass-123")).cookie;
  ctx.db
    .prepare("INSERT INTO drinks (slug, brand, name, flavor) VALUES (?, ?, ?, ?)")
    .run("burn-tropic", "Burn", "Tropic", "манго");
  originalFetch = global.fetch;
});

after(async () => {
  global.fetch = originalFetch;
  await ctx.close();
});

const withFetch = (handler) => {
  global.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith(ctx.base)) return originalFetch(url, init);
    return handler(href, init);
  };
};

const barcode = (code) =>
  request(ctx.base, "POST", "/api/cabinet/ai/barcode", { cookie, body: { code } });

test("OFF не нашёл — база штрих-кодов даёт название, бренд угадывается по индексу", async () => {
  const calls = [];
  const html = `<html><head><title>Напиток энергетический BURN 0.449 - Штрих-код: 4600682003106</title></head>
    <body><table class="randomBarcodes"><tr class="even"><td>1</td><td>4600682003106</td><td>НАПИТОК ЭНЕРГЕТИЧЕСКИЙ BURN 0.449</td><td>ШТ.</td><td>120</td></tr></table></body></html>`;
  withFetch((href) => {
    calls.push(href);
    if (href.includes("openfoodfacts")) return new Response('{"status":0}', { status: 200 });
    if (href.includes("barcode-list.ru")) return new Response(html, { status: 200 });
    throw new Error("unexpected fetch: " + href);
  });

  const res = await barcode("4600682003106");
  assert.equal(res.status, 200);
  assert.equal(res.json.product?.source, "barcode-list");
  assert.equal(res.json.product?.name, "Напиток энергетический BURN 0.449");
  assert.equal(res.json.product?.brand, "Burn");
  assert.ok(calls.some((u) => u.includes("openfoodfacts")), "сначала пробуем Open Food Facts");
  assert.ok(calls.some((u) => u.includes("barcode-list.ru")), "потом базу штрих-кодов");
});

test("OFF нашёл товар — внешнюю базу не дёргаем", async () => {
  const calls = [];
  withFetch((href) => {
    calls.push(href);
    return new Response(
      '{"status":1,"product":{"product_name":"Flash UP Energy","brands":"Flash UP","quantity":"450 ml"}}',
      { status: 200 },
    );
  });

  const res = await barcode("4600494223013");
  assert.equal(res.json.product?.source, "openfoodfacts");
  assert.equal(res.json.product?.brand, "Flash UP");
  assert.ok(!calls.some((u) => u.includes("barcode-list")), "при успехе OFF во внешнюю базу не ходим");
});

test("Data Matrix: TrueMark раньше OFF, GS сохранён, кэш отделён от EAN и серийника", async () => {
  const calls = [];
  const raw = "0104600494223013215Fabc\x1D93a+/=Z";
  withFetch((href) => {
    calls.push(href);
    return Response.json({ m: { codeFounded: true, catalogData: [{
      good_name: "Напиток", brand_name: "Brand", good_img: "https://example.com/can.jpg",
      good_attrs: [{ attr_name: "Вкус", attr_value: "манго" }],
    }] } });
  });
  const res = await barcode(raw);
  assert.equal(res.status, 200);
  assert.equal(res.json.kind, "datamatrix");
  assert.equal(res.json.code, "4600494223013");
  assert.equal(res.json.rawCode, raw);
  assert.equal(res.json.product.source, "truemark");
  assert.equal(res.json.product.name, "Напиток");
  assert.equal(res.json.product.brand, "Brand");
  assert.equal(res.json.product.flavor, "манго");
  assert.equal(res.json.product.image, "https://example.com/can.jpg");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /truemark.*%1D/);
  assert.equal(new URL(calls[0]).searchParams.get("code"), raw);
  assert.deepEqual((await barcode(raw)).json, res.json);
  assert.equal(calls.length, 1);
  await barcode(raw + "2");
  assert.equal(calls.length, 2);
  const ean = await barcode("4600494223013");
  assert.equal(ean.json.kind, "ean");
  assert.equal(ean.json.product.source, "openfoodfacts");
});

test("Data Matrix: отказ и ошибка TrueMark запускают OFF → CRPT → barcode-list", async () => {
  for (const failure of ["not-found", "network", "ok-false"]) {
    const calls = [];
    withFetch((href) => {
      const source = new URL(href).hostname;
      calls.push(source);
      if (source === "truemark.ru") {
        if (failure === "network") throw new Error("network down");
        if (failure === "ok-false") return Response.json({ ok: false, m: { catalogData: [{ good_name: "Не найден" }] } });
        return Response.json({ m: { codeFounded: false, catalogData: [{ good_name: "Не найден" }] } });
      }
      if (source.includes("openfoodfacts")) return Response.json({ status: 0 });
      if (source.includes("crpt")) return Response.json({ codeFounded: false });
      return new Response("ничего не найдено");
    });
    const res = await barcode(`010468003691262921${failure}\x1D93test`);
    assert.equal(res.status, 200);
    assert.equal(res.json.product, null);
    assert.deepEqual(calls, ["truemark.ru", "world.openfoodfacts.org", "mobile.api.crpt.ru", "barcode-list.ru"]);
  }
});

test("Data Matrix: пример пользователя, {GS} и ]d2 дают тот же сырой код", async () => {
  const raw = "0104680036912629215JuVJmTnOR:3H\x1D93kjJw";
  const calls = [];
  withFetch((href, init) => {
    calls.push(href);
    assert.equal(new URL(href).searchParams.get("code"), raw);
    assert.match(href, /%1D/);
    assert.equal(init.headers.referer, "https://truemark.ru/proverka-koda-markirovki/");
    return Response.json({ m: { codeFounded: true, catalogData: [{ good_name: "Напиток" }] } });
  });
  for (const code of ["]d20104680036912629215JuVJmTnOR:3H{GS}93kjJw", raw, `]d2${raw}`, raw.replace("\x1D", "{GS}")]) {
    const res = await barcode(code);
    assert.equal(res.status, 200);
    assert.equal(res.json.rawCode, raw);
    assert.equal(res.json.code, "4680036912629");
    assert.equal(res.json.product.source, "truemark");
  }
  assert.equal(calls.length, 1);
});

test("Data Matrix: локальный индекс раньше TrueMark, кэш оценок изолирован по пользователю", async () => {
  ctx.db.prepare("UPDATE drinks SET barcode = ? WHERE slug = ?").run("4680036912629", "burn-tropic");
  const firstUser = ctx.db.prepare("SELECT id FROM users WHERE username = ?").get("sanya");
  const drink = ctx.db.prepare("SELECT id FROM drinks WHERE slug = ?").get("burn-tropic");
  ctx.db.prepare("INSERT INTO ratings (drink_id, user_id, tier_id) VALUES (?, ?, ?)").run(drink.id, firstUser.id, "A");
  const secondUser = await createUser(ctx.db, { username: "other", password: "other-pass-123" });
  ctx.db.prepare("INSERT INTO ratings (drink_id, user_id, tier_id) VALUES (?, ?, ?)").run(drink.id, secondUser.id, "B");
  const otherCookie = (await login(ctx.base, "other", "other-pass-123")).cookie;
  const calls = [];
  withFetch((href) => { calls.push(href); throw new Error("unexpected fetch"); });
  const res = await barcode("010468003691262921local\x1D93test");
  assert.equal(res.json.product.source, "index");
  assert.equal(res.json.inIndex.slug, "burn-tropic");
  assert.equal(res.json.similar[0].myTier, "A");
  const other = await request(ctx.base, "POST", "/api/cabinet/ai/barcode", {
    cookie: otherCookie, body: { code: "010468003691262921local\x1D93test" },
  });
  assert.equal(other.status, 200);
  assert.equal(other.json.similar[0].myTier, "B");
  assert.equal((await barcode("010468003691262921local\x1D93test")).json.similar[0].myTier, "A");
  assert.equal(ctx.db.prepare("SELECT barcode FROM drinks WHERE id = ?").get(drink.id).barcode, "4680036912629");
  assert.deepEqual(calls, []);
});
