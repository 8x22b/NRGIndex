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
