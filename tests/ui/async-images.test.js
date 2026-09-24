const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "..", "public", "cabinet.js"), "utf8");

test("лента изображений создаёт плитку при готовности результата", () => {
  assert.match(source, /if \(!tile && item\.state === "ready"\)/);
  assert.match(source, /tile = document\.createElement\("button"\)/);
  assert.match(source, /renderTile\(index\);/);
});

test("обработка изображений отдаёт браузеру кадр между задачами", () => {
  assert.match(source, /await new Promise\(\(resolve\) => setTimeout\(resolve, 0\)\);/);
  assert.doesNotMatch(source, /photo-track"\)\.innerHTML = strip\.items\s*\.map\(/);
});
