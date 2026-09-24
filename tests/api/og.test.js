const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { startServer } = require("../helpers");

let ctx;

before(async () => {
  ctx = await startServer();
  ctx.db
    .prepare(
      `INSERT INTO drinks (slug, brand, name, flavor, edition, image_path, accent_a, accent_b, is_published)
       VALUES ('test-og-drink', 'TestBrand', 'Test Can', 'юдзу', '', 'assets/adrenaline-mango.png', '#ff4f79', '#ff7448', 1)`,
    )
    .run();
});

after(async () => {
  await ctx.close();
});

async function pngMeta(res) {
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /image\/png/);
  const buf = Buffer.from(await res.arrayBuffer());
  return sharp(buf).metadata();
}

test("главная отдаёт OG/Twitter-теги и canonical", async () => {
  const res = await fetch(`${ctx.base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  const html = await res.text();
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<meta property="og:image" content="http[^"]*\/og\/site\.png"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<link rel="canonical"/);
});

test("карточка сайта 1200x630", async () => {
  const meta = await pngMeta(await fetch(`${ctx.base}/og/site.png`));
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});

test("страница банки /d/:slug с OG на свою карточку", async () => {
  const res = await fetch(`${ctx.base}/d/test-og-drink`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Test Can/);
  assert.match(html, /\/og\/drink\/test-og-drink\.png/);
  assert.match(html, /<link rel="canonical" href="http[^"]*\/d\/test-og-drink">/);
});

test("карточка банки 1200x630", async () => {
  const meta = await pngMeta(await fetch(`${ctx.base}/og/drink/test-og-drink.png`));
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});

test("неизвестная банка: 404, но с базовыми OG-тегами", async () => {
  const res = await fetch(`${ctx.base}/d/no-such-drink`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /<meta property="og:title"/);
});

test("неизвестная OG-картинка: 404", async () => {
  const res = await fetch(`${ctx.base}/og/drink/no-such-drink.png`);
  assert.equal(res.status, 404);
});
