const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("кабинет: форма и камера на месте, галочка «нет в списке» скрыта до неудачных попыток", () => {
  const js = read("public/cabinet.js");
  const html = read("public/cabinet.html");
  assert.doesNotMatch(html, /id="smart-form"[^>]*hidden/, "форма добавления не прячется");
  assert.match(html, /id="btn-camera"/, "кнопка камеры остаётся на месте");
  assert.match(html, /data-camera-mode="code"/, "режим скана штрих-кода остаётся");
  assert.match(html, /id="dup-gate-ack"/);
  assert.match(html, /id="dup-gate-search"/);
  assert.match(html, /id="dup-gate-ack-wrap" hidden/, "подтверждение скрыто по умолчанию");
  assert.match(js, /const renderDupGateResults = \(\) =>/);
  assert.match(js, /const showDupAck = \(\) =>/);
  assert.match(js, /const hideDupAck = \(\) =>/);
  assert.match(js, /data-rate-found/);
});

test("галочка «нет в списке» появляется после неудачных поисков", () => {
  const js = read("public/cabinet.js");
  // поиск по индексу ничего не нашёл
  assert.match(js, /if \(!list\.length\) showDupAck\(\)/);
  // ИИ-разбор не нашёл похожих
  assert.match(js, /if \(!\(similar \|\| \[\]\)\.length\) showDupAck\(\)/);
  // штрих-код не нашёлся в индексе
  assert.match(js, /if \(!\(data\.similar \|\| \[\]\)\.length\) showDupAck\(\)/);
  // попытка сохранить без проверки тоже показывает галочку
  assert.match(js, /!pending\.similarCount && !pending\.absenceAck/);
  // подтверждение обязательно для сохранения и сбрасывается после добавления
  assert.match(js, /pending\.absenceAck = event\.target\.checked/);
  assert.match(js, /const syncConfirmState = \(\) =>/);
  assert.match(js, /hideDupAck\(\)/);
});

test("кабинет: подтверждение разных энергосов уходит на сервер, 409 показывает похожие", () => {
  const js = read("public/cabinet.js");
  assert.match(js, /body\.confirmDifferent = true/);
  assert.match(js, /error\.payload\?\.similar\?\.length/);
  assert.match(js, /renderSimilar\(error\.payload\.similar\)/);
});

test("сервер: защита от дублей включена до создания банки", () => {
  const server = read("server/routes/cabinet.js");
  assert.match(server, /confirmDifferent !== true/);
  assert.match(server, /штрих-код совпал/);
  assert.match(server, /includeHidden: true/);
  assert.match(server, /code: "duplicate"/);
});
