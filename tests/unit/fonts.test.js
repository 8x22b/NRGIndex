// Шрифты порезаны на сабсеты (см. scripts/subset-fonts.sh), набор символов —
// scripts/font-charset.txt. Эти тесты следят, чтобы сабсет не потерял символ,
// который реально встречается на страницах, и чтобы все файлы из fonts.css были на месте.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const PUBLIC = path.join(ROOT, "public");

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|html|css)$/.test(entry.name)) files.push(full);
  }
})(PUBLIC);

test("набор символов для сабсета покрывает весь текст публичных страниц", () => {
  const charset = new Set(fs.readFileSync(path.join(ROOT, "scripts", "font-charset.txt"), "utf8"));
  const missing = new Set();
  for (const file of files) {
    for (const ch of fs.readFileSync(file, "utf8")) {
      if (ch.codePointAt(0) < 32) continue;
      if (!charset.has(ch)) missing.add(ch);
    }
  }
  assert.equal(
    missing.size,
    0,
    `в scripts/font-charset.txt не хватает: ${[...missing].map((ch) => `U+${ch.codePointAt(0).toString(16)}`).join(", ")}`,
  );
});

test("все шрифты из fonts.css лежат в public/fonts", () => {
  const css = fs.readFileSync(path.join(PUBLIC, "fonts", "fonts.css"), "utf8");
  const missing = [...css.matchAll(/url\((\/fonts\/[^)]+)\)/g)]
    .map((match) => match[1])
    .filter((url) => !fs.existsSync(path.join(PUBLIC, url.replace(/^\//, ""))));
  assert.deepEqual(missing, [], "fonts.css ссылается на несуществующие файлы");
});
