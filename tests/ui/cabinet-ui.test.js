const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cabinetSource = fs.readFileSync(path.join(__dirname, "..", "..", "public", "cabinet.js"), "utf8");
const cabinetHtml = fs.readFileSync(path.join(__dirname, "..", "..", "public", "cabinet.html"), "utf8");
const cabinetRoutes = fs.readFileSync(path.join(__dirname, "..", "..", "server", "routes", "cabinet.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "..", "public", "styles.css"), "utf8");

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
  assert.match(cabinetSource, /g - Math\.max\(r, b\) > 60/, "режем только насыщенный зелёный, не белую часть банки");
  assert.doesNotMatch(cabinetSource, /g - Math\.max\(r, b\) > 25/, "слабый порог съедал белые части банки");
  assert.match(cabinetSource, /canFill/, "заливка идёт только через не-контур — и в белом, и в зелёном резце");
});

test("OpenRouter-перерисовку кабинет не режет и сохраняет прозрачность", () => {
  assert.match(cabinetSource, /provider === "openrouter"/);
  assert.match(cabinetSource, /shrinkPng/);
  assert.match(cabinetSource, /toDataURL\("image\/png"\)/);
  assert.match(cabinetSource, /прозрачный фон/);
  assert.match(cabinetRoutes, /redrawCanOnTransparent/);
  assert.match(cabinetRoutes, /provider: viaOpenRouter \? "openrouter" : "gemini"/);
});

test("штрих-код: сканер, ручной ввод и сохранение кода", () => {
  assert.match(cabinetHtml, /id="smart-barcode"/);
  assert.match(cabinetHtml, /id="smart-barcode-code"/);
  assert.match(cabinetHtml, /id="btn-barcode-lookup"/);
  assert.match(cabinetHtml, /id="barcode-status"/);
  assert.match(cabinetSource, /BarcodeDetector/);
  assert.match(cabinetSource, /data_matrix/);
  assert.match(cabinetSource, /api\("POST", "api\/cabinet\/ai\/barcode", \{ code \}\)/);
  assert.match(cabinetSource, /pending\.barcode/);
  assert.match(cabinetSource, /body\.barcode = pending\.barcode/);
  assert.match(cabinetRoutes, /router\.post\("\/ai\/barcode"/);
  assert.match(stylesSource, /\.barcode-row/);
});

test("рулетка по ассортименту: фото, распознавание и общий барабан", () => {
  assert.match(cabinetHtml, /id="assortment-photo"/);
  assert.match(cabinetHtml, /id="assortment-reel"/);
  assert.match(cabinetHtml, /id="assortment-spin"/);
  assert.match(cabinetHtml, /id="assortment-result"/);
  assert.match(cabinetHtml, /id="assortment-clear"/);
  assert.ok(cabinetHtml.indexOf("roulette.js") < cabinetHtml.indexOf("cabinet.js"), "барабан подключён до cabinet.js");
  assert.match(cabinetSource, /api\("POST", "api\/cabinet\/ai\/assortment"/);
  assert.match(cabinetSource, /NrgRoulette\.create/);
  assert.match(cabinetSource, /openOpinion\(slug\)/);
  assert.match(cabinetSource, /data-assortment-add/);
  assert.match(cabinetRoutes, /router\.post\("\/ai\/assortment"/);
  assert.match(stylesSource, /\.roulette__item--text/);
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

test("редактор мнения: поля тянутся под текст, без горизонтального скролла", () => {
  assert.match(cabinetHtml, /<textarea id="op-ai-text" rows="1"/, "ИИ-строка — переносимый textarea, а не однострочный input");
  assert.doesNotMatch(cabinetHtml, /<input id="op-ai-text"/);
  assert.match(cabinetSource, /const autoGrow = \(node, max = 420\)/, "есть автоподбор высоты");
  assert.match(cabinetSource, /node\.style\.minHeight = "0px"/, "высота мерится от нуля — поле ужимается");
  assert.match(cabinetSource, /autoGrow\(\$\("op-ai-text"\), 160\)/, "ИИ-строка растёт после открытия");
  assert.match(cabinetSource, /autoGrow\(\$\("op-review"\)\)/, "отзыв растёт после разбора и открытия");
  assert.match(cabinetSource, /\$\("op-review"\)\.addEventListener\("input", \(\) => autoGrow\(\$\("op-review"\)\)\)/, "отзыв тянется при вводе");
  assert.match(cabinetSource, /autoGrow\(area\)/, "голосовая расшифровка тоже растягивает поле");
  assert.match(stylesSource, /\.opinion-ai__row \{ display: flex; flex-wrap: wrap/, "строка ИИ переносит кнопки, а не торчит вбок");
  assert.match(stylesSource, /\.opinion-dialog__inner > \* \{ min-width: 0; \}/, "грид-дети не распирают диалог");
  assert.match(stylesSource, /\.opinion-ai > \* \{ min-width: 0; \}/, "дети блока ИИ не вылазят в сторону");
  assert.match(stylesSource, /\.opinion-dialog__fields textarea \{ resize: none; overflow-y: hidden/, "ручной resize выключен — рулит автоподбор");
  assert.doesNotMatch(stylesSource, /\.opinion-dialog__fields textarea \{[^}]*min-height/, "отзыв не зафиксирован — сжимается");
  assert.match(stylesSource, /\.voice-player \{[^}]*min-width: 0;/, "плеер сжимается, а не вылезает вбок");
  assert.match(stylesSource, /\.voice-player \.btn \{[^}]*height: 2\.2rem/, "кнопки плеера одной высоты с аудио — отступы ровные");
  assert.match(stylesSource, /\.voice-player audio \{ display: block/, "аудио без inline-зазора");
  assert.match(stylesSource, /\.voice-player__time \{[^}]*height: 2\.2rem/, "таймер на одной линии с кнопками");
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

test("диплинк с тирлиста: cabinet.html?rate=<slug> открывает редактор мнения", () => {
  assert.match(cabinetSource, /new URLSearchParams\(location\.search\)\.get\("rate"\)/);
  assert.match(cabinetSource, /openOpinion\(decodeURIComponent\(rateSlug\)\)/);
});

test("мои оценки: кнопка редактора подписана «изменить»", () => {
  assert.match(cabinetSource, /data-m-edit>изменить<\/button>/);
  assert.doesNotMatch(cabinetSource, /data-m-edit>мнение<\/button>/);
});

test("мои оценки: перерисовка не теряет текст, двойное сохранение не проходит", () => {
  assert.match(cabinetSource, /if \(item && review !== undefined\) item\.review = review/);
  assert.match(cabinetSource, /if \(savingRatings\.has\(slug\)\) return;/);
  assert.match(cabinetSource, /if \(!slug \|\| savingOpinion\) return;/);
});

test("перед сохранением сказано, что уйдут и текст, и фото", () => {
  assert.match(cabinetHtml, /id="parsed-save-note"/);
  assert.match(cabinetHtml, /тир, отзыв и фото/);
});

test("кабинет: одна камера с трафаретом и превью вместо четырёх кнопок", () => {
  const photoInputs = cabinetHtml.match(/id="smart-photo"/g) || [];
  assert.equal(photoInputs.length, 1, "должен остаться ровно один инпут камеры");
  assert.match(cabinetHtml, /id="smart-photo"[^>]*accept="image\/\*"/);
  assert.match(cabinetHtml, /id="smart-photo"[^>]*capture="environment"/);
  assert.match(cabinetHtml, /id="camera-guide"/);
  assert.match(cabinetHtml, /class="camera-guide__frame"/);
  assert.match(cabinetHtml, /id="camera-preview"/);
  assert.doesNotMatch(cabinetHtml, /Приложить фото/, "старая кнопка «Приложить фото» не должна вернуться");
  assert.doesNotMatch(cabinetHtml, /Скан штрих-кода/, "старая кнопка «Скан штрих-кода» не должна вернуться");
  assert.doesNotMatch(cabinetHtml, /id="btn-photo"/);
  assert.doesNotMatch(cabinetHtml, /id="btn-barcode-live"/);
  assert.doesNotMatch(cabinetHtml, /class="smart-tools"/);
  assert.match(cabinetSource, /const scanBarcodeImage = async \(file\) =>/);
  assert.match(cabinetSource, /cameraPreview\.src = URL\.createObjectURL\(file\)/);
  assert.match(cabinetSource, /await scanBarcodeImage\(file\)/, "код читается с того же снимка");
});

test("кабинет: «Подготовить карточку» недоступна без ввода или кода", () => {
  assert.match(cabinetHtml, /id="btn-smart"[^>]*disabled>✦ Подготовить карточку</);
  assert.match(cabinetSource, /const updateSmartAvailability = \(\) =>/);
  assert.match(cabinetSource, /\$\("btn-smart"\)\.disabled = !hasInput/);
  assert.match(cabinetSource, /\$\("smart-input"\)\.addEventListener\("input", updateSmartAvailability\)/);
  assert.match(cabinetSource, /\$\("smart-barcode-code"\)\.addEventListener\("input", updateSmartAvailability\)/);
});

test("кабинет: этапы обработки — голос, код, фото, карточка, проверка", () => {
  assert.match(cabinetHtml, /id="smart-steps"/);
  for (const step of ["voice", "barcode", "photo", "card", "ready"]) {
    assert.match(cabinetHtml, new RegExp(`data-step="${step}"`), `должен быть этап ${step}`);
  }
  assert.match(cabinetSource, /const setSmartStep = \(step, text, error = false\) =>/);
  assert.match(cabinetSource, /setSmartStep\("voice", "Распознаю голос…"\)/);
  assert.match(cabinetSource, /setSmartStep\("photo", "Обрабатываю фото…"\)/);
  assert.match(cabinetSource, /setSmartStep\("card", "Собираю карточку…"\)/);
});

test("кабинет: превью карточки правится вручную и сохраняется из полей", () => {
  for (const field of ["brand", "name", "flavor", "edition", "tier", "review"]) {
    assert.match(cabinetHtml, new RegExp(`id="parsed-${field}"`), `должно быть поле parsed-${field}`);
  }
  for (const [id, field] of [
    ["parsed-brand", "brand"],
    ["parsed-name", "name"],
    ["parsed-flavor", "flavor"],
    ["parsed-edition", "edition"],
    ["parsed-tier", "tier"],
    ["parsed-review", "review"],
  ]) {
    assert.match(cabinetSource, new RegExp(`\\["${id}", "${field}"\\]`), `${id} должен писать в ${field}`);
  }
  assert.match(cabinetSource, /pending\.parsed\[field\] = event\.target\.value/);
  assert.doesNotMatch(cabinetHtml, /id="parsed-title"/);
  assert.doesNotMatch(cabinetHtml, /id="parsed-sub"/);
  assert.doesNotMatch(cabinetSource, /parsed-title/);
  assert.doesNotMatch(cabinetSource, /parsed-sub/);
});

test("кабинет: пять вкладок с переключением и запоминанием", () => {
  assert.match(cabinetHtml, /<nav class="cab-tabs" id="cab-tabs"/);
  assert.match(cabinetHtml, /class="cab-pane" id="cab-add"/);
  for (const name of ["add", "ratings", "find", "roulette", "account"]) {
    assert.match(cabinetHtml, new RegExp(`data-cab="${name}"`), `должна быть кнопка ${name}`);
    assert.match(cabinetHtml, new RegExp(`id="cab-${name}"`), `должна быть панель ${name}`);
  }
  for (const name of ["cab-ratings", "cab-find", "cab-roulette", "cab-account"]) {
    assert.match(cabinetHtml, new RegExp(`id="${name}" hidden`), `${name} скрыта по умолчанию`);
  }
  const ratings = cabinetHtml.slice(
    cabinetHtml.indexOf('id="cab-ratings"'),
    cabinetHtml.indexOf('id="cab-find"'),
  );
  assert.match(ratings, /id="unrated-block"/, "«Ещё не оценил» — внутри оценок");
  const account = cabinetHtml.slice(
    cabinetHtml.indexOf('id="cab-account"'),
    cabinetHtml.indexOf('id="avatar-dialog"'),
  );
  for (const id of ["profile-link", "admin-button", "btn-logout"]) {
    assert.match(account, new RegExp(`id="${id}"`), `${id} переехал в аккаунт`);
  }
  assert.match(cabinetSource, /const CAB_SECTIONS = \["add", "ratings", "find", "roulette", "account"\]/);
  assert.match(cabinetSource, /const switchCabTab = \(name\) =>/);
  assert.match(cabinetSource, /localStorage\.getItem\("cab-tab"\)/);
  assert.match(cabinetSource, /localStorage\.setItem\("cab-tab", name\)/);
  assert.match(stylesSource, /\.cab-tabs \{ display: flex/);
});
