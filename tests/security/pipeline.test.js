// Пайплайн: единый workflow, запускается мержем в production. Тесты в облаке и
// пре-деплой-тесты на раннере идут параллельно, деплой — только после обоих.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOWS = path.join(__dirname, "..", "..", ".github", "workflows");
const read = (name) => fs.readFileSync(path.join(WORKFLOWS, name), "utf8");

// Тело job'а от его ключа до следующего ключа верхнего уровня.
const jobBlock = (yml, name) => {
  const start = yml.indexOf(`\n  ${name}:`);
  assert.notEqual(start, -1, `job ${name} должен быть в pipeline.yml`);
  const rest = yml.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z-]*:/);
  const body = next === -1 ? rest : rest.slice(0, next + 1);
  // отрезаем строку самого ключа, оставляя только его тело
  return body.slice(body.indexOf("\n"));
};

test("pipeline: тесты и деплой живут в одном workflow", () => {
  const files = fs.readdirSync(WORKFLOWS).filter((name) => name.endsWith(".yml"));
  assert.deepEqual(files, ["pipeline.yml"], "вместо ci.yml + deploy.yml должен остаться один pipeline.yml");
  const yml = read("pipeline.yml");
  assert.match(yml, /^name: Pipeline/m);
  assert.match(yml, /^  push:/m);
  assert.match(yml, /workflow_dispatch:/);
});

test("pipeline: запускается мержем в production — ни PR, ни master", () => {
  const yml = read("pipeline.yml");
  const onBlock = yml.slice(yml.indexOf("on:"), yml.indexOf("permissions:"));
  assert.match(onBlock, /push:[\s\S]*?branches: \[production\]/);
  assert.doesNotMatch(onBlock, /pull_request/, "отдельного прогона на PR больше нет");
  assert.doesNotMatch(onBlock, /master/, "пуш в master не должен запускать прогон");
});

test("pipeline: тесты и пре-деплой параллельно, деплой — после обоих", () => {
  const yml = read("pipeline.yml");
  const testJob = jobBlock(yml, "test");
  const preDeploy = jobBlock(yml, "pre-deploy");
  const deploy = jobBlock(yml, "deploy");
  assert.doesNotMatch(testJob, /\n    if:/, "облачные тесты без условий — стартуют сразу");
  assert.doesNotMatch(preDeploy, /\n    if:/, "пре-деплой без условий — стартует параллельно тестам");
  assert.doesNotMatch(preDeploy, /needs:/, "пре-деплой не должен ждать облачные тесты");
  assert.match(deploy, /needs: \[test, pre-deploy\]/, "деплой зависит от обеих проверок");
  assert.doesNotMatch(deploy, /\n    if:/, "у деплоя не должно быть своих условий — гейт через needs");
  assert.doesNotMatch(deploy, /pull_request/);
  assert.match(deploy, /runs-on: \[self-hosted, nrgindex\]/);
  assert.match(deploy, /environment: production/);
});

test("pipeline: на боевом раннере не качаем Node, берём системный", () => {
  const yml = read("pipeline.yml");
  const testJob = jobBlock(yml, "test");
  const preDeploy = jobBlock(yml, "pre-deploy");
  const deploy = jobBlock(yml, "deploy");
  assert.match(testJob, /actions\/setup-node@v7/, "на ubuntu setup-node с кешем npm остаётся");
  for (const [name, job] of [
    ["pre-deploy", preDeploy],
    ["deploy", deploy],
  ]) {
    assert.doesNotMatch(job, /uses:\s*actions\/setup-node/, `${name}: setup-node не нужен, Node уже стоит на раннере`);
    assert.match(job, /\/opt\/node\/bin/, `${name}: системный Node должен попадать в PATH`);
    assert.match(job, /--prefer-offline/, `${name}: npm должен уважать локальный кеш раннера`);
  }
});

test("pipeline: категории тестов разделены между джобами без дублей", () => {
  const yml = read("pipeline.yml");
  const testJob = jobBlock(yml, "test");
  const preDeploy = jobBlock(yml, "pre-deploy");
  assert.match(testJob, /npm run test:unit && npm run test:ui && npm run test:security/);
  assert.match(preDeploy, /npm run test:api/);
  assert.doesNotMatch(testJob, /npm run test:api/, "интеграция не дублируется в облаке");
  assert.doesNotMatch(preDeploy, /npm run test:unit|npm run test:ui|npm run test:security/, "быстрые категории не дублируются на раннере");
  assert.doesNotMatch(yml, /^\s*run: npm test\s*$/m, "полный npm test не гоняем дважды");
  assert.doesNotMatch(preDeploy, /npm audit/, "аудит уже прошёл в облаке");
});

test("pipeline: на месте смоук, аудит, бэкап, health-check и откат", () => {
  const yml = read("pipeline.yml");
  assert.match(yml, /npm audit --omit=dev --audit-level=high/);
  assert.match(yml, /Smoke: сервер стартует и отвечает/);
  assert.match(yml, /Backup and sync app to \/opt\/nrgindex/);
  assert.match(yml, /Restart and health check \(with rollback\)/);
  assert.match(yml, /Откат выполнен/);
});
