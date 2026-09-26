const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const styles = fs.readFileSync(path.join(__dirname, "..", "..", "public", "styles.css"), "utf8");
const noiseBlock = styles.match(/\.page-noise\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

test("шум покрывает viewport повторяющейся текстурой поверх контента", () => {
  assert.match(noiseBlock, /position:\s*fixed\s*;/);
  assert.match(noiseBlock, /background-repeat:\s*repeat\s*;/);
  assert.match(noiseBlock, /background-size:\s*256px\s+256px\s*;/);
  assert.match(noiseBlock, /viewBox='0 0 256 256'/);
});
