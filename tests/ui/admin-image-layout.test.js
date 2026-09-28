const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const adminHtml = fs.readFileSync(path.join(root, "admin", "index.html"), "utf8");
const adminRoutes = fs.readFileSync(path.join(root, "server", "routes", "admin.js"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "admin", "admin.js"), "utf8");

test("админская форма загружает картинку по HTTPS URL", () => {
  assert.match(adminHtml, /id="d-image-url"[^>]*type="url"/);
  assert.match(adminHtml, /id="btn-drink-image-url"/);
  assert.match(adminJs, /remoteImageToDataUrl/);
  assert.match(adminJs, /api\("POST", "api\/uploads", \{ dataUrl \}\)/);
});

test("сервер принимает только HTTP(S) URL для внешней картинки", () => {
  assert.match(adminRoutes, /new URL\(image\)/);
  assert.match(adminRoutes, /\["http:", "https:"\]\.includes\(parsed\.protocol\)/);
  assert.match(adminRoutes, /Картинка должна быть URL/);
});

test("поле похожих занимает отдельную строку от акцентных цветов", () => {
  assert.match(adminHtml, /class="drink-related"/);
  assert.match(adminHtml, /class="grid-2 drink-accent-fields"/);
});

test("настройки AI разделяют ключ OpenRouter для STT и ключ разбора текста", () => {
  assert.match(adminHtml, /id="s-openrouter-key"/);
  assert.match(adminHtml, /id="s-key"/);
  assert.match(adminJs, /payload\.textApiKey = \$\("s-key"\)\.value/);
  assert.match(adminJs, /payload\.openrouterKey = \$\("s-openrouter-key"\)\.value/);
  assert.match(adminJs, /textBaseUrl: \$\("s-base-url"\)\.value/);
});

test("чекбоксы в формах лежат в строку, а не сеткой", () => {
  assert.match(adminHtml, /label:has\(> input\[type="checkbox"\]\)/);
});

test("настройки Gemini: ключ, модель, проверка и очистка", () => {
  assert.match(adminHtml, /id="s-gemini-key"/);
  assert.match(adminHtml, /id="s-gemini-model"/);
  assert.match(adminHtml, /id="btn-gemini-check"/);
  assert.match(adminHtml, /id="btn-gemini-key-clear"/);
  assert.match(adminJs, /payload\.geminiKey = \$\("s-gemini-key"\)\.value/);
  assert.match(adminJs, /geminiImageModel: \$\("s-gemini-model"\)\.value/);
  assert.match(adminJs, /api\/admin\/settings\/gemini-check/);
  assert.match(adminRoutes, /router\.post\("\/settings\/gemini-check"/);
  assert.match(adminRoutes, /gemini_api_key/);
});

test("настройки перерисовки: провайдер Gemini/OpenRouter и модель", () => {
  assert.match(adminHtml, /id="s-image-provider"/);
  assert.match(adminHtml, /id="s-openrouter-image-model"/);
  assert.match(adminJs, /imageProvider: \$\("s-image-provider"\)\.value/);
  assert.match(adminJs, /openrouterImageModel: \$\("s-openrouter-image-model"\)\.value/);
  assert.match(adminRoutes, /image_provider/);
  assert.match(adminRoutes, /openrouter_image_model/);
  assert.match(adminRoutes, /DEFAULT_OPENROUTER_IMAGE_MODEL/);
});

test("настройки промптов генерации: поля, сохранение и сброс", () => {
  assert.match(adminHtml, /id="s-openrouter-image-prompt"/);
  assert.match(adminHtml, /id="s-gemini-image-prompt"/);
  assert.match(adminHtml, /id="btn-prompts-clear"/);
  assert.match(adminHtml, /settings-prompt/);
  assert.match(adminJs, /openrouterImagePrompt: \$\("s-openrouter-image-prompt"\)\.value/);
  assert.match(adminJs, /geminiImagePrompt: \$\("s-gemini-image-prompt"\)\.value/);
  assert.match(adminJs, /openrouterImagePrompt: "", geminiImagePrompt: ""/);
});

test("настройки распознавания ассортимента: модель Gemini", () => {
  assert.match(adminHtml, /id="s-gemini-vision-model"/);
  assert.match(adminJs, /geminiVisionModel: \$\("s-gemini-vision-model"\)\.value/);
  assert.match(adminRoutes, /gemini_vision_model/);
});

test("настройки фото-шаблона OpenRouter: загрузка, превью и сброс", () => {
  assert.match(adminHtml, /id="s-template-file"/);
  assert.match(adminHtml, /id="s-template-preview"/);
  assert.match(adminHtml, /id="btn-template-clear"/);
  assert.match(adminJs, /fileToOriginalDataUrl/);
  assert.match(adminJs, /api\("POST", "api\/admin\/settings\/image-template", \{ dataUrl \}\)/);
  assert.match(adminJs, /api\("DELETE", "api\/admin\/settings\/image-template"\)/);
  assert.match(adminRoutes, /\/settings\/image-template/);
});

test("лента фото в админке дожимает через прокси при хотлинк-бане", () => {
  assert.match(adminJs, /dataset\.proxied/);
  assert.match(adminJs, /api\/cabinet\/ai\/photo-proxy\?url=/);
});

test("кнопка 🍌 в форме напитка шлёт исходник до резки строго JPEG", () => {
  assert.match(adminHtml, /id="btn-drink-redraw"/);
  assert.match(adminJs, /\$\("btn-drink-redraw"\)\.onclick/);
  assert.match(adminJs, /adminOriginal/);
  assert.match(adminJs, /toJpegDataUrl/);
  assert.match(adminJs, /toDataURL\("image\/jpeg"/);
  assert.match(adminJs, /startsWith\("data:image\/jpeg"\)/);
  assert.match(adminJs, /api\("POST", "api\/cabinet\/ai\/photo-redraw", \{ imageDataUrl: source \}\)/);
  assert.match(adminJs, /оригинал не сохранился/);
});

test("кнопка перерисовки в админке не переводит OpenRouter-результат в JPEG", () => {
  assert.match(adminJs, /toPngDataUrl/);
  assert.match(adminJs, /provider === "openrouter"/);
  assert.match(adminJs, /api\("POST", "api\/uploads", \{ dataUrl: png \}\)/);
  assert.match(adminJs, /usesOpenRouter/);
});

test("форма напитка: все способы замены фото в панели за превью", () => {
  assert.match(adminHtml, /id="d-image-open"/);
  assert.match(adminHtml, /id="d-image-tools"[^>]*hidden/);
  assert.match(adminJs, /\$\("d-image-open"\)\.onclick/);

  const toolsStart = adminHtml.indexOf('id="d-image-tools"');
  const tools = adminHtml.slice(toolsStart, adminHtml.indexOf("</form>", toolsStart));
  for (const id of [
    "d-image-file",
    "d-image-url",
    "btn-drink-image-url",
    "d-photo-query",
    "btn-drink-photo-search",
    "btn-drink-redraw",
    "btn-drink-image-clear",
    "d-photo-strip",
  ]) {
    assert.ok(tools.includes(`id="${id}"`), `${id} должен быть в панели фото`);
  }

  const formStart = adminHtml.indexOf('id="drink-form"');
  const form = adminHtml.slice(formStart, adminHtml.indexOf("</form>", formStart));
  const actionsStart = form.lastIndexOf('class="admin-actions"');
  const formActions = form.slice(actionsStart);
  assert.match(formActions, /Сохранить/);
  assert.doesNotMatch(formActions, /btn-drink-image-clear|btn-drink-redraw/, "фото-кнопки не должны торчать в нижнем ряду");
  assert.match(adminJs, /d-image-tools"\)\.hidden = true/);
});

test("превью банки в таблице напитков сохраняет пропорции, а не квадрат", () => {
  const rule = adminHtml.match(/\.admin-table img \{[^}]*\}/)[0];
  assert.match(rule, /height: 48px/);
  assert.match(rule, /width: auto/);
  assert.doesNotMatch(rule, /width: 34px/);
  const mobile = adminHtml.match(/@media \(max-width: 720px\)[\s\S]*?\.admin-table img \{[^}]*\}/)[0];
  assert.match(mobile, /height: 72px/);
});

test("диплинк с тирлиста: admin?drink=<slug> открывает форму правки", () => {
  assert.match(adminJs, /new URLSearchParams\(location\.search\)\.get\("drink"\)/);
  assert.match(adminJs, /openDrinkForm\(drink\.id\)/);
});
