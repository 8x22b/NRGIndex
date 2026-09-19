const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword, hashToken } = require("../server/auth");
const {
  username,
  oneOf,
  int,
  color,
  slugify,
  imageFromDataUrl,
} = require("../server/lib/validate");

test("хеш пароля: scrypt с параметрами и солью", async () => {
  const hash = await hashPassword("super-secret-123");
  assert.ok(hash.startsWith("scrypt$32768$8$1$"));
  assert.ok(!hash.includes("super-secret-123"));
  const parts = hash.split("$");
  assert.equal(parts.length, 6);
  assert.ok(parts[4].length > 0);
  assert.ok(parts[5].length > 0);
});

test("одинаковые пароли дают разные хеши (соль)", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert.notEqual(a, b);
});

test("проверка пароля", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.equal(await verifyPassword(hash, "correct horse battery"), true);
  assert.equal(await verifyPassword(hash, "wrong"), false);
  assert.equal(await verifyPassword(null, "x"), false);
  assert.equal(await verifyPassword("plain-text", "plain-text"), false);
  assert.equal(await verifyPassword("scrypt$1$2$3$bad", "x"), false);
});

test("hashToken стабилен и не равен токену", () => {
  const token = "abc";
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), token);
});

test("валидация логина", () => {
  assert.equal(username("Sanya"), "sanya");
  assert.throws(() => username("ab"), /логин/i);
  assert.throws(() => username("bad login!"), /логин/i);
  assert.throws(() => username(""), /логин/i);
});

test("валидация значений", () => {
  assert.equal(oneOf("S", ["S", "A"], "tier"), "S");
  assert.throws(() => oneOf("X", ["S", "A"], "tier"), /tier/);
  assert.equal(int("5", "n", { min: 1, max: 10 }), 5);
  assert.throws(() => int("5.5", "n"), /целым/);
  assert.throws(() => int("99", "n", { max: 10 }), /диапазона/);
  assert.equal(color("#AABBCC", "цвет", null), "#aabbcc");
  assert.throws(() => color("red", "цвет", null), /#RRGGBB/);
  assert.equal(slugify("Burn Tropical Mix!"), "burn-tropical-mix");
  assert.equal(slugify(""), "drink");
});

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("картинки: принимаем PNG, отвергаем подделку и SVG", () => {
  const ok = imageFromDataUrl(`data:image/png;base64,${PNG_1X1}`, { maxBytes: 1024 * 1024 });
  assert.equal(ok.ext, "png");
  assert.ok(ok.buffer.length > 0);

  assert.throws(
    () => imageFromDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", { maxBytes: 1024 }),
    /PNG, JPEG и WebP/,
  );

  const fakePng = Buffer.from("not a png").toString("base64");
  assert.throws(
    () => imageFromDataUrl(`data:image/png;base64,${fakePng}`, { maxBytes: 1024 }),
    /не совпадает/,
  );

  const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2048)]).toString(
    "base64",
  );
  assert.throws(
    () => imageFromDataUrl(`data:image/png;base64,${big}`, { maxBytes: 1024 }),
    /больше/,
  );

  assert.throws(() => imageFromDataUrl("https://example.com/x.png", { maxBytes: 1024 }), /data:/);
});
