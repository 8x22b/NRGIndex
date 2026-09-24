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

test("лента фото в админке дожимает через прокси при хотлинк-бане", () => {
  assert.match(adminJs, /dataset\.proxied/);
  assert.match(adminJs, /api\/cabinet\/ai\/photo-proxy\?url=/);
});
