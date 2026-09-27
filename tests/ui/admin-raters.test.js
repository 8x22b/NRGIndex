const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("админка: у напитка видно число оценок и кто именно оценил", () => {
  const js = read("admin/admin.js");
  const html = read("admin/index.html");
  assert.match(js, /data-raters="\$\{drink\.id\}"/);
  assert.match(js, /const openRaters = \(drink\)/);
  assert.match(js, /id="raters-title">Кто оценил/);
  assert.match(js, /state\.data\.users\.find\(\(item\) => item\.username === username\)/);
  assert.match(js, /const sortDrinks = \(\) =>/);
  assert.match(js, /state\.drinksSort = event\.target\.value/);
  assert.match(html, /id="drinks-sort"/);
  assert.match(js, /aria-labelledby", "raters-title"/);
  assert.match(html, /\.admin-raters__list \{/);
});

test("сортировка напитков: оба направления, кириллица, числа, равные оценки и неизменность данных", () => {
  const js = read("admin/admin.js");
  const drinks = [
    { id: 1, name: "Банка 10", brand: "Ягодный", ratings: { a: {}, b: {} } },
    { id: 2, name: "Банка 2", brand: "Ягодный", ratings: { a: {} } },
    { id: 3, name: "Арбуз", brand: "Альфа", ratings: {} },
    { id: 4, name: "Яблоко", brand: "Альфа" },
  ];
  const state = { data: { drinks } };
  const context = vm.createContext({ state });
  vm.runInContext(js.slice(js.indexOf("  const drinkCollator"), js.indexOf("  const renderDrinks")), context);
  for (const [sort, expected] of Object.entries({
    "id-desc": [4, 3, 2, 1], "id-asc": [1, 2, 3, 4],
    "ratings-desc": [1, 2, 4, 3], "ratings-asc": [4, 3, 2, 1],
    "name-asc": [3, 2, 1, 4], "brand-asc": [3, 4, 2, 1],
  })) {
    state.drinksSort = sort;
    assert.deepEqual(Array.from(vm.runInContext("sortDrinks()", context), (drink) => drink.id), expected, sort);
  }
  assert.deepEqual(drinks.map((drink) => drink.id), [1, 2, 3, 4]);
});

test("дубликаты: повторный клик «Сохранить»/«В индекс» не заводит вторую банку", () => {
  assert.match(read("admin/admin.js"), /if \(drinkSaving\) return;/);
  assert.match(read("public/cabinet.js"), /if \(savingDrink\) return;/);
});
