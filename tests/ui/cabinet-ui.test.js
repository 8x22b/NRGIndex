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
  assert.match(cabinetHtml, /🍌 Перерисовать/);
  assert.match(cabinetHtml, /если ракурс плохой или фон удалился криво/);
  assert.match(cabinetSource, /api\("POST", "api\/cabinet\/ai\/photo-redraw"/);
  assert.match(cabinetRoutes, /router\.post\("\/ai\/photo-redraw"/);
});

test("перерисовка шлёт необработанный оригинал, а зелёный хромакей снимает заливкой", () => {
  assert.match(cabinetSource, /originalDataUrl/);
  assert.match(cabinetSource, /cutGreenBg/);
  assert.match(cabinetSource, /finishRedrawn/);
  assert.match(cabinetSource, /НЕОБРАБОТАННЫЙ оригинал/);
  assert.match(cabinetSource, /g - Math\.max\(r, b\)/, "градиент хромакея режется по доминированию зелёного");
  assert.match(cabinetSource, /canFill/, "заливка идёт только через не-контур — и в белом, и в зелёном резце");
});

test("промпт просит прямой ракурс и зелёный фон", () => {
  const geminiSource = fs.readFileSync(path.join(__dirname, "..", "..", "server", "lib", "gemini.js"), "utf8");
  assert.match(geminiSource, /straight-on front view/);
  assert.match(geminiSource, /#00FF00/);
});

test("редактор мнения: ИИ-разбор текста и голос на месте", () => {
  assert.match(cabinetHtml, /id="op-ai-text"/);
  assert.match(cabinetHtml, /id="op-ai-parse"/);
  assert.match(cabinetHtml, /id="op-record"/);
  assert.match(cabinetHtml, /id="op-voice-player"/);
  assert.match(cabinetHtml, /id="op-voice-audio"/);
  assert.match(cabinetSource, /op-ai-parse"\)\.onclick = parseOpinionText/);
  assert.match(cabinetSource, /api\("POST", "api\/cabinet\/ai\/parse", \{ text, drink: opinion\.drink \}\)/);
  assert.match(cabinetSource, /opinion\.drink = \{ brand: drink\.brand \|\| ""/);
  assert.match(cabinetSource, /const VOICE_UI/);
  assert.match(cabinetSource, /input: "op-ai-text"/);
});

test("редактор мнения: действия с фото спрятаны за превью, в диалоге нет свалки кнопок", () => {
  assert.match(cabinetHtml, /id="op-photo-open"/);
  assert.match(cabinetHtml, /id="op-photo-panel"[^>]*hidden/);
  assert.match(cabinetSource, /\$\("op-photo-open"\)\.onclick/);

  const panelStart = cabinetHtml.indexOf('id="op-photo-panel"');
  const panel = cabinetHtml.slice(panelStart, cabinetHtml.indexOf("</dialog>", panelStart));
  for (const id of ["op-photo-file", "op-photo-find", "op-photo-redraw", "op-photo-remove", "op-photo-strip"]) {
    assert.ok(panel.includes(`id="${id}"`), `${id} должен быть в панели фото`);
  }
  const actionsStart = cabinetHtml.indexOf('opinion-dialog__actions"');
  const actions = cabinetHtml.slice(actionsStart, cabinetHtml.indexOf("</div>", actionsStart));
  assert.match(actions, /id="op-save"/);
  assert.doesNotMatch(actions, /op-photo-/, "в нижнем ряду не должно быть кнопок фото");
});

test("оценка существующей банки: тир открывает редактор, а не сохраняется молча", () => {
  const handlerStart = cabinetSource.indexOf('$("unrated-list").addEventListener');
  assert.notEqual(handlerStart, -1);
  const handler = cabinetSource.slice(handlerStart, cabinetSource.indexOf('$("unrated-more")', handlerStart));
  assert.match(handler, /openOpinion\(card\.dataset\.drink, \{ tier: button\.dataset\.tier \}\)/);
  assert.doesNotMatch(handler, /api\("PUT"/, "тир не должен улетать в индекс без редакции");
});

test("похожая банка из ИИ-разбора: редактор открывается с готовым тиром и отзывом", () => {
  const handlerStart = cabinetSource.indexOf('$("similar-list").addEventListener');
  assert.notEqual(handlerStart, -1);
  const handler = cabinetSource.slice(handlerStart, cabinetSource.indexOf("const submitSmart", handlerStart));
  assert.match(handler, /openOpinion\(slug, \{/);
  assert.match(handler, /tier: TIERS\.includes\(parsed\.tier\)/);
  assert.match(handler, /aiText: \$\("smart-input"\)\.value\.trim\(\)/);
  assert.match(handler, /fromSmart: true/);
  assert.doesNotMatch(handler, /api\("PUT"/, "без редакции ничего не публикуем");
});

test("дубликаты: без явного «это не он» новую банку не сохранить", () => {
  assert.match(cabinetHtml, /id="similar-ack"/);
  assert.match(cabinetHtml, /Это не тот энергос — добавить новую банку/);
  assert.match(cabinetSource, /pending\.similarCount && !pending\.duplicateAck/);
  assert.match(cabinetSource, /similar-ack"\)\.addEventListener\("change"/);
  assert.match(cabinetSource, /\$\("btn-confirm"\)\.disabled = similar\.length > 0/);
});

test("поиск по индексу в кабинете: находит банку и открывает редактор мнения", () => {
  assert.match(cabinetHtml, /id="find-input"/);
  assert.match(cabinetHtml, /id="find-results"/);
  assert.match(cabinetSource, /const renderFind = \(\) =>/);
  assert.match(cabinetSource, /\$\("find-input"\)\.addEventListener\("input", renderFind\)/);
  assert.match(cabinetSource, /renderFind\(\);/);
  assert.match(
    cabinetSource,
    /openOpinion\(button\.closest\("\.unrated-card"\)\.dataset\.drink, \{ tier: button\.dataset\.tier \}\)/,
  );
});

test("перед сохранением сказано, что уйдут и текст, и фото", () => {
  assert.match(cabinetHtml, /id="parsed-save-note"/);
  assert.match(cabinetHtml, /тир, отзыв и фото/);
});
