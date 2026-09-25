// Пайплайн: тесты и деплой должны быть одним workflow и идти строго по цепочке.
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
  assert.match(yml, /^  pull_request:/m);
  assert.match(yml, /^  push:/m);
  assert.match(yml, /workflow_dispatch:/);
});

test("pipeline: master не гоняет тесты — только путь к production", () => {
  const yml = read("pipeline.yml");
  const onBlock = yml.slice(yml.indexOf("on:"), yml.indexOf("permissions:"));
  assert.match(onBlock, /pull_request:[\s\S]*?branches: \[production\]/);
  assert.match(onBlock, /push:[\s\S]*?branches: \[production\]/);
  assert.doesNotMatch(onBlock, /master/, "пуш в master не должен запускать прогон");
  assert.match(yml, /if: \$\{\{ github\.event_name == 'pull_request' \}\}/, "ubuntu-тесты — только на PR");
});

test("pipeline: деплой — только production и строго после тестов", () => {
  const yml = read("pipeline.yml");
  assert.match(yml, /pre-deploy:[\s\S]*?needs: test/);
  assert.match(yml, /deploy:[\s\S]*?needs: pre-deploy/);
  assert.match(yml, /github\.ref == 'refs\/heads\/production'/);

  const preDeploy = jobBlock(yml, "pre-deploy");
  const deploy = jobBlock(yml, "deploy");
  assert.doesNotMatch(preDeploy, /pull_request/, "самохост не должен просыпаться на PR");
  assert.doesNotMatch(deploy, /pull_request/, "деплой не должен просыпаться на PR");
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

test("pipeline: на месте смоук, аудит, бэкап, health-check и откат", () => {
  const yml = read("pipeline.yml");
  assert.match(yml, /npm test/);
  assert.match(yml, /npm audit --omit=dev --audit-level=high/);
  assert.match(yml, /Smoke: сервер стартует и отвечает/);
  assert.match(yml, /Backup and sync app to \/opt\/nrgindex/);
  assert.match(yml, /Restart and health check \(with rollback\)/);
  assert.match(yml, /Откат выполнен/);
});
