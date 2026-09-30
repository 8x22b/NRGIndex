// Собирает scripts/font-charset.txt — набор символов для сабсета шрифтов.
// Берёт весь текст из public/**/*.{js,html,css} плюс (по желанию) дамп текстов
// из БД, чтобы ни одна литера с сайта не пропала при пересборке шрифтов:
//   node scripts/build-font-charset.js [dump.txt]
// Затем: ./scripts/subset-fonts.sh
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(__dirname, "font-charset.txt");
const dumpPath = process.argv[2] || "";

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|html|css)$/.test(entry.name)) files.push(full);
  }
})(PUBLIC);

const chars = new Set();
for (const file of files) {
  for (const ch of fs.readFileSync(file, "utf8")) chars.add(ch);
}
if (dumpPath && fs.existsSync(dumpPath)) {
  for (const ch of fs.readFileSync(dumpPath, "utf8")) chars.add(ch);
  console.log(`учтён дамп контента: ${dumpPath}`);
}

const base =
  " АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  ".,:;!?()[]{}<>@#$%^&*+-=_/|~`\"'«»„“”‘’—–−…·•№°±×÷→←↑↓✦✓✗↻★☆●○■□▸©®™€₽‰\t";
for (const ch of base) chars.add(ch);

const list = [...chars].filter((ch) => ch.codePointAt(0) >= 32).sort();
fs.writeFileSync(OUT, list.join(""), "utf8");
console.log(`готово: ${list.length} символов → scripts/font-charset.txt`);
