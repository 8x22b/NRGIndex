const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("кабинет: галочка «нет в списке» открывает форму добавления", () => {
  const js = read("public/cabinet.js");
  const html = read("public/cabinet.html");
  assert.match(html, /id="dup-gate-ack"/);
  assert.match(html, /id="dup-gate-search"/);
  assert.match(html, /id="dup-gate-results"/);
  assert.match(html, /id="dup-gate-status"/);
  assert.match(html, /id="smart-form"[^>]*hidden/);
  assert.match(js, /\$\("dup-gate-ack"\)\.addEventListener\("change"/);
  assert.match(js, /\$\("smart-form"\)\.hidden = !event\.target\.checked/);
  assert.match(js, /const renderDupGateResults = \(\) =>/);
  assert.match(js, /data-rate-found/);
  // После успешного добавления галочка снимается — следующая банка снова через проверку.
  assert.match(js, /\$\("dup-gate-ack"\)\.checked = false/);
});

test("кабинет: подтверждение разных энергосов уходит на сервер, 409 показывает похожие", () => {
  const js = read("public/cabinet.js");
  assert.match(js, /body\.confirmDifferent = true/);
  assert.match(js, /error\.payload\?\.similar\?\.length/);
  assert.match(js, /renderSimilar\(error\.payload\.similar\)/);
  assert.match(js, /disabled = pending\.similarCount > 0 && !pending\.duplicateAck/);
});

test("сервер: защита от дублей включена до создания банки", () => {
  const server = read("server/routes/cabinet.js");
  assert.match(server, /confirmDifferent !== true/);
  assert.match(server, /штрих-код совпал/);
  assert.match(server, /includeHidden: true/);
  assert.match(server, /code: "duplicate"/);
});
