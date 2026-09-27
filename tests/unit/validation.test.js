const test = require("node:test");
const assert = require("node:assert/strict");
const { username, oneOf, int, color, slugify, bool } = require("../../server/lib/validate");

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

test("строгий bool: строка «false» не превращается в true", () => {
  assert.equal(bool(true), true);
  assert.equal(bool(false), false);
  assert.equal(bool(undefined, true), true);
  assert.throws(() => bool("false"), /true или false/);
  assert.throws(() => bool(0), /true или false/);
});
