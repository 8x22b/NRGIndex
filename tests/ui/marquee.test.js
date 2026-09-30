const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const css = fs.readFileSync(path.join(ROOT, "public", "styles.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");

test("бегущая строка склеена без рывка на стыке", () => {
  const track = css.match(/\.marquee__track \{[^}]*\}/)[0];
  assert.doesNotMatch(track, /\bgap:/, "flex-gap даёт несимметричный стык при -50%");
  assert.match(css, /\.marquee__track > \* \{ margin-right:/, "отступ должен быть у каждого элемента, включая последний");
  assert.match(css, /@keyframes marquee \{ to \{ transform: translate3d\(-50%, 0, 0\); \} \}/);
});

test("лента дожимает копии после загрузки шрифтов", () => {
  assert.match(js, /document\.fonts\?\.ready/);
  assert.match(js, /copies % 2 === 1/);
});
