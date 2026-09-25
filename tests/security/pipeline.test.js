// Пайплайн: тесты и деплой должны быть одним workflow и идти строго по цепочке.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOWS = path.join(__dirname, "..", "..", ".github", "workflows");
const read = (name) => fs.readFileSync(path.join(WORKFLOWS, name), "utf8");

test("pipeline: тесты и деплой живут в одном workflow", () => {
  const files = fs.readdirSync(WORKFLOWS).filter((name) => name.endsWith(".yml"));
  assert.deepEqual(files, ["pipeline.yml"], "вместо ci.yml + deploy.yml должен остаться один pipeline.yml");
  const yml = read("pipeline.yml");
  assert.match(yml, /^name: Pipeline/m);
  assert.match(yml, /^  pull_request:/m);
  assert.match(yml, /^  push:/m);
  assert.match(yml, /workflow_dispatch:/);
});

test("pipeline: деплой — только production и строго после тестов", () => {
  const yml = read("pipeline.yml");
  assert.match(yml, /pre-deploy:[\s\S]*?needs: test/);
  assert.match(yml, /deploy:[\s\S]*?needs: pre-deploy/);
  assert.match(yml, /github\.ref == 'refs\/heads\/production'/);

  const preDeploy = yml.slice(yml.indexOf("pre-deploy:"), yml.indexOf("deploy:"));
  const deploy = yml.slice(yml.indexOf("deploy:"));
  assert.doesNotMatch(preDeploy, /pull_request/, "самохост не должен просыпаться на PR");
  assert.doesNotMatch(deploy, /pull_request/, "деплой не должен просыпаться на PR");
  assert.match(deploy, /runs-on: \[self-hosted, nrgindex\]/);
  assert.match(deploy, /environment: production/);
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
