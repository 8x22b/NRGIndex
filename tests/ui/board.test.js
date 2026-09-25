const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "..", "public", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "..", "..", "public", "index.html"), "utf8");
const profileSource = fs.readFileSync(path.join(__dirname, "..", "..", "public", "profile.js"), "utf8");

test("доска: строка поиска и фильтры тиров в разметке", () => {
  assert.match(indexHtml, /id="board-search"/);
  assert.match(indexHtml, /id="board-filters"/);
  for (const tier of ["all", "S", "A", "B", "C", "D"]) {
    assert.match(indexHtml, new RegExp(`data-tier-filter="${tier}"`));
  }
});

test("доска: поиск фильтрует по бренду/названию/вкусу", () => {
  assert.match(appSource, /let searchQuery = ""/);
  assert.match(appSource, /matchesSearch\(entry\.drink\)/);
  assert.match(appSource, /drink\.brand, drink\.name, drink\.flavor, drink\.edition/);
  assert.match(appSource, /ничего не найдено — ослабьте фильтры/);
  assert.match(appSource, /найдено: \$\{shown\}/);
});

test("доска: фильтр тиров переключает чипы", () => {
  assert.match(appSource, /tierFilter = button\.dataset\.tierFilter/);
  assert.match(appSource, /querySelectorAll\("\[data-tier-filter\]"\)/);
});

test("доска: карточка не крутится за курсором — бейджи тира/оценки не мерцают", () => {
  assert.doesNotMatch(appSource, /setProperty\("--r[xy]"/);
  assert.doesNotMatch(appSource, /is-tilting/);
  assert.match(appSource, /attachCards/);
});

test("диплинк: /d/:slug открывает карточку, закрытие чистит URL", () => {
  assert.match(appSource, /location\.pathname\.match\(\/\^\\\/d\\\//);
  assert.match(appSource, /history\.replaceState\(null, "", `\/d\/\$\{encodeURIComponent\(drink\.id\)\}`\)/);
  assert.match(appSource, /if \(location\.pathname\.startsWith\("\/d\/"\)\) history\.replaceState\(null, "", "\/"\)/);
});

test("диалог: кнопка копирования ссылки на банку", () => {
  assert.match(appSource, /data-share-drink/);
  assert.match(appSource, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(appSource, /\/d\/\$\{encodeURIComponent\(button\.dataset\.shareDrink\)\}/);
});

test("профиль: карточки ведут на /d/:slug", () => {
  assert.match(profileSource, /href="\/d\/\$\{encodeURIComponent\(rating\.drink\)\}"/);
  assert.doesNotMatch(profileSource, /\?drink=\$/);
});

test("главная: ссылка на профиль одна — в чипе участника, без дубля в описании", () => {
  assert.match(appSource, /class="view-chip__profile" href="profile\.html\?u=/);
  assert.doesNotMatch(appSource, /Профиль и отзывы/);
  assert.doesNotMatch(appSource, /viewDescription\.insertAdjacentHTML/);
});
