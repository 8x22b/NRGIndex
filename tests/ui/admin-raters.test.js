const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("админка: у напитка видно число оценок и кто именно оценил", () => {
  const js = read("admin/admin.js");
  const html = read("admin/index.html");
  assert.match(js, /data-raters="\$\{drink\.id\}"/);
  assert.match(js, /const openRaters = \(drink\)/);
  assert.match(js, /Кто оценил «\$\{drink\.name\}»/);
  assert.match(js, /state\.data\.users\.find\(\(item\) => item\.username === username\)/);
  assert.match(html, /\.admin-raters__list \{/);
});

test("дубликаты: повторный клик «Сохранить»/«В индекс» не заводит вторую банку", () => {
  assert.match(read("admin/admin.js"), /if \(drinkSaving\) return;/);
  assert.match(read("public/cabinet.js"), /if \(savingDrink\) return;/);
});
