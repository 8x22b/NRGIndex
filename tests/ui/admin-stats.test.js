const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("админка: вкладка статистики с периодами 7/30/90", () => {
  const html = read("admin/index.html");
  assert.match(html, /data-tab="stats"[^>]*data-admin-only/);
  assert.match(html, /id="tab-stats"/);
  assert.match(html, /id="stats-period"/);
  for (const days of [7, 30, 90]) assert.match(html, new RegExp(`data-days="${days}"`));

  const js = read("admin/admin.js");
  assert.match(js, /api\/admin\/stats\?days=\$\{state\.statsDays\}/);
  assert.match(js, /stats-period"\)\.addEventListener/);
  assert.match(js, /state\.stats\.period\.days === state\.statsDays/);
});

test("админка: разные типы графиков, всё без внешних библиотек", () => {
  const js = read("admin/admin.js");
  assert.match(js, /const barsChart/);
  assert.match(js, /const areaChart/);
  assert.match(js, /const donutChart/);
  assert.match(js, /const heatmapGrid/);
  assert.match(js, /const topDrinksList/);
  assert.match(js, /const topUsersList/);
  assert.match(js, /stats-donut__total/);
  assert.doesNotMatch(read("admin/index.html"), /<script[^>]+https?:/);
});

test("админка: онлайн и последние изменения обновляются сами", () => {
  const js = read("admin/admin.js");
  assert.match(js, /document\.visibilityState === "visible"/);
  assert.match(js, /}, 60_000\);/);
  assert.match(js, /const timeAgo/);
  assert.match(js, /onlineMarkup/);
  assert.match(js, /recentMarkup/);
});

test("профиль: блок активности рисуется из stats.activity", () => {
  const js = read("public/profile.js");
  assert.match(js, /stats\.activity/);
  assert.match(js, /class="profile-activity"/);
  assert.match(js, /activity-month__bar/);
  assert.match(js, /за полгода/);
  assert.match(js, /const timeAgoSoft/);

  const css = read("public/styles.css");
  assert.match(css, /\.profile-activity/);
  assert.match(css, /\.activity-month__bar/);
});

test("сервер: у профиля есть статистика активности, у админки — свой эндпоинт", () => {
  const routes = read("server/routes/public.js");
  assert.match(routes, /activity: \{/);
  assert.match(routes, /const monthByKey/);
  const admin = read("server/routes/admin.js");
  assert.match(admin, /router\.get\("\/stats", requireAdmin/);
  assert.match(admin, /function deviceLabel/);
});
