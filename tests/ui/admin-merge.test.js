const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("админка: у напитка есть кнопка «Объединить» и диалог выбора цели", () => {
  const js = read("admin/admin.js");
  const html = read("admin/index.html");
  assert.match(js, /data-merge="\$\{drink\.id\}"/);
  assert.match(js, /const openMergeDialog = \(source\)/);
  assert.match(js, /api\("POST", `api\/admin\/drinks\/\$\{source\.id\}\/merge`, \{ targetId: target\.id \}\)/);
  assert.match(js, /name="merge-target"/);
  assert.match(js, /const submitMerge = async \(\) =>/);
  assert.match(html, /\.admin-merge__row label \{/);
});

test("мердж: роли и защита от склейки с самим собой на сервере", () => {
  const server = read("server/routes/admin.js");
  assert.match(server, /router\.post\("\/drinks\/:id\/merge"/);
  assert.match(server, /Нельзя объединить напиток с самим собой/);
  assert.match(server, /throw notFound\("Напиток для объединения не найден"\)/);
  const history = read("server/lib/history.js");
  assert.match(history, /case "drink\.merge"/);
  assert.match(history, /recordMerge/);
});
