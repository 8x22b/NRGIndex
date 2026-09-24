const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("админка: поиск фото прямо в форме напитка и лёгкая замена", () => {
  const html = read("admin/index.html");
  assert.match(html, /id="d-photo-query"/);
  assert.match(html, /id="btn-drink-photo-search"/);
  assert.match(html, /id="d-photo-track"/);

  const js = read("admin/admin.js");
  assert.match(js, /api\/cabinet\/ai\/photo-search/);
  assert.match(js, /api\/uploads/);
  assert.match(js, /const pickDrinkPhoto/);
  assert.match(js, /const searchDrinkPhotos/);
  assert.match(js, /resetPhotoStrip\(\)/);
});

test("кабинет: редактор мнения с заменой, поиском и удалением фото", () => {
  const html = read("public/cabinet.html");
  assert.match(html, /id="opinion-editor"/);
  assert.match(html, /id="op-photo-file"/);
  assert.match(html, /id="op-photo-find"/);
  assert.match(html, /id="op-photo-remove"/);
  assert.match(html, /id="op-photo-track"/);
  assert.match(html, /id="op-save"/);

  const js = read("public/cabinet.js");
  assert.match(js, /data-m-edit/);
  assert.match(js, /const openOpinion/);
  assert.match(js, /api\/cabinet\/ratings\/\$\{encodeURIComponent\(slug\)\}/);
  assert.match(js, /drinks\/\$\{encodeURIComponent\(slug\)\}\/photo/);
  assert.match(js, /removeImage: true/);
});

test("сервер: эндпоинт фото живёт под авторизацией", () => {
  const routes = read("server/routes/cabinet.js");
  assert.match(routes, /router\.put\("\/drinks\/:slug\/photo"/);
  assert.match(routes, /removeImage/);
  assert.match(routes, /saveProcessedImage/);

  const app = read("server/app.js");
  assert.match(app, /app\.use\("\/api\/cabinet", auth\.requireAuth/);
});
