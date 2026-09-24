const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cabinetSource = fs.readFileSync(path.join(__dirname, "..", "..", "public", "cabinet.js"), "utf8");
const cabinetHtml = fs.readFileSync(path.join(__dirname, "..", "..", "public", "cabinet.html"), "utf8");
const cabinetRoutes = fs.readFileSync(path.join(__dirname, "..", "..", "server", "routes", "cabinet.js"), "utf8");

test("кабинет показывает красную кнопку удаления оценки", () => {
  assert.match(cabinetSource, /<button class=\"btn btn--danger\" type=\"button\" data-m-del-rating>удалить<\/button>/);
  assert.doesNotMatch(cabinetSource, /data-m-del-rating>− оценка<\/button>/);
});

test("кнопка удаления оценки сохраняет DELETE обработчик", () => {
  const handlerStart = cabinetSource.indexOf('row.querySelector("[data-m-del-rating]")');
  assert.notEqual(handlerStart, -1);
  const handler = cabinetSource.slice(handlerStart, cabinetSource.indexOf('row.querySelector("[data-m-del-drink]")', handlerStart));
  assert.match(handler, /api\("DELETE", `api\/cabinet\/ratings\/\$\{encodeURIComponent\(slug\)\}`\)/);
});

test("ленты фото дожимают через прокси при хотлинк-бане, а не молча пустуют", () => {
  assert.match(cabinetSource, /loadImageWithFallback/);
  assert.match(cabinetSource, /dataset\.proxied/);
  assert.match(cabinetSource, /api\/cabinet\/ai\/photo-proxy\?url=/);
  assert.match(cabinetRoutes, /router\.get\("\/ai\/photo-proxy"/);
});

test("кнопки перерисовки на белом фоне есть в смарт-форме и редакторе мнения", () => {
  assert.match(cabinetHtml, /id="btn-redraw"/);
  assert.match(cabinetHtml, /id="op-photo-redraw"/);
  assert.match(cabinetSource, /api\("POST", "api\/cabinet\/ai\/photo-redraw"/);
  assert.match(cabinetRoutes, /router\.post\("\/ai\/photo-redraw"/);
});

test("перерисовка шлёт необработанный оригинал, а зелёный хромакей снимает заливкой", () => {
  assert.match(cabinetSource, /originalDataUrl/);
  assert.match(cabinetSource, /cutGreenBg/);
  assert.match(cabinetSource, /finishRedrawn/);
  assert.match(cabinetSource, /НЕОБРАБОТАННЫЙ оригинал/);
  assert.match(cabinetSource, /g - Math\.max\(r, b\)/, "градиент хромакея режется по доминированию зелёного");
});

test("промпт просит прямой ракурс и зелёный фон", () => {
  const geminiSource = fs.readFileSync(path.join(__dirname, "..", "..", "server", "lib", "gemini.js"), "utf8");
  assert.match(geminiSource, /straight-on front view/);
  assert.match(geminiSource, /#00FF00/);
});
