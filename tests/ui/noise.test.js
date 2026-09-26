const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const styles = fs.readFileSync(path.join(__dirname, "..", "..", "public", "styles.css"), "utf8");
const noiseBlock = styles.match(/\.page-noise\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

test("шум покрывает viewport повторяющейся текстурой с крупным зерном", () => {
  assert.match(noiseBlock, /background-repeat:\s*repeat\s*;/);
  assert.match(noiseBlock, /background-size:\s*448px\s+448px\s*;/);
  assert.match(noiseBlock, /viewBox='0 0 256 256'/);
  assert.match(noiseBlock, /opacity:\s*\.12\s*;/);
});
