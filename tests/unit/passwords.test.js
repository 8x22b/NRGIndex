const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword, hashToken } = require("../../server/auth");

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
