const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const styles = fs.readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");
const noiseBlock = styles.match(/\.page-noise\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

test("шум занимает весь viewport без повторения плитки", () => {
  assert.match(noiseBlock, /background-repeat:\s*no-repeat\s*;/);
  assert.match(noiseBlock, /background-size:\s*100%\s+100%\s*;/);
});
