const test = require("node:test");
const assert = require("node:assert/strict");
const { findSimilarDrinks, matchWords } = require("../../server/lib/content");

// Лёгкий фейковый db: findSimilarDrinks зовёт только prepare(...).all(includeHidden).
// Флаг приходит параметром (? = 1), а не склейкой SQL — повторяем это в моке.
const makeDb = (rows) => ({
  prepare: (sql) => ({
    all: (includeHidden = 0) =>
      sql.includes("? = 1") && includeHidden ? rows : rows.filter((item) => item.is_published),
  }),
});

const row = (id, slug, brand, name, flavor, extra = {}) => ({
  id,
  slug,
  brand,
  name,
  flavor,
  edition: "",
  image_path: null,
  is_published: 1,
  ...extra,
});

const DB = makeDb([
  row(1, "burn-apple-kiwi", "Burn", "Burn Apple Kiwi", "яблоко киви"),
  row(2, "monster-white", "Monster", "Monster Ultra White", "цитрус"),
  row(3, "volt-original", "Volt", "Volt Original", ""),
  row(4, "gorilla-mango", "Gorilla", "Gorilla Mango", "манго"),
  row(5, "red-bull-blueberry", "Ред Булл", "Ред Булл Original", "черника"),
  row(6, "hidden-volt", "Volt", "Volt Hidden", "манго", { is_published: 0 }),
]);

test("matchWords: регистр, ё, транслит, без объёмов и шума", () => {
  const words = new Set(matchWords("Red Bull Ёж 500 мл energy"));
  assert.ok(words.has("red"));
  assert.ok(words.has("bull"));
  assert.ok(words.has("еж"));
  assert.equal(words.has("500"), false);
  assert.equal(words.has("energy"), false);
  assert.equal(words.has("мл"), false);
});

test("findSimilarDrinks: находит дубль по бренду и порядку слов", () => {
  const hits = findSimilarDrinks(DB, { brand: "burn", name: "Burn Kiwi Apple", flavor: "" });
  assert.equal(hits[0]?.slug, "burn-apple-kiwi");
});

test("findSimilarDrinks: только бренд совпадает с «голой» банкой бренда", () => {
  const hits = findSimilarDrinks(DB, { brand: "Volt", name: "Volt", flavor: "" });
  assert.equal(hits[0]?.slug, "volt-original");
});

test("findSimilarDrinks: опечатку бренда ловит fuzzy-Dice, а не жёсткий отсев", () => {
  const hits = findSimilarDrinks(DB, { brand: "Gorila", name: "Gorila Mango", flavor: "" });
  assert.equal(hits[0]?.slug, "gorilla-mango");
  assert.equal(hits[0]?.confidence, "high");
  assert.match(hits[0]?.reason, /бренд/);
});

test("findSimilarDrinks: транслит «Ред Булл» ↔ «Red Bull» сходится", () => {
  const hits = findSimilarDrinks(DB, { brand: "Red Bull", name: "Red Bull", flavor: "черника" });
  assert.equal(hits[0]?.slug, "red-bull-blueberry");
});

test("findSimilarDrinks: разные вкусы и чужой бренд не совпадают", () => {
  assert.deepEqual(findSimilarDrinks(DB, { brand: "Burn", name: "Burn Original", flavor: "" }), []);
  assert.deepEqual(findSimilarDrinks(DB, { brand: "Red Bull", name: "Red Bull Apple Kiwi" }), []);
});

test("findSimilarDrinks: скрытые банки видны только с includeHidden", () => {
  const query = { brand: "Volt", name: "Volt Hidden Mango", flavor: "манго" };
  const visible = findSimilarDrinks(DB, query);
  assert.equal(visible.some((hit) => hit.slug === "hidden-volt"), false);
  const hidden = findSimilarDrinks(DB, query, { includeHidden: true }).find((hit) => hit.slug === "hidden-volt");
  assert.ok(hidden);
  assert.equal(hidden.hidden, true);
});
