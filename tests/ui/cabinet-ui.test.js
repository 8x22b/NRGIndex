const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cabinetSource = fs.readFileSync(path.join(__dirname, "..", "..", "public", "cabinet.js"), "utf8");

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
