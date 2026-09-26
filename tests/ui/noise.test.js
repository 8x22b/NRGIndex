const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const styles = fs.readFileSync(path.join(ROOT, "public", "styles.css"), "utf8");
const noiseVar = styles.match(/--noise:\s*url\("([^"]+)"\)/)?.[1] ?? "";
const backgroundRule = styles.match(/body,[^{]*\{[^}]*var\(--noise\)[^}]*\}/)?.[0] ?? "";

test("зерно фона лежит в фоне секций, а не оверлеем поверх контента", () => {
  assert.match(noiseVar, /viewBox='0 0 256 256'/, "плитка шума на месте");
  assert.match(noiseVar, /opacity='\.1'/, "яркость зерна");
  assert.match(backgroundRule, /\.rating-section/, "фон секции рейтинга");
  assert.match(backgroundRule, /\.cab-cta/, "фон CTA-секции");
  assert.match(backgroundRule, /\.site-footer/, "фон футера");
  assert.match(backgroundRule, /\.cabinet-section/, "фон секции кабинетов");
  assert.match(backgroundRule, /background-size:\s*384px\s+384px/, "зерно");
  assert.doesNotMatch(styles, /\.page-noise/, "оверлей поверх контента убран");
});

test("в разметке нет пустого оверлея шума", () => {
  for (const file of ["public/index.html", "public/cabinet.html", "public/profile.html", "admin/index.html"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), "utf8"), /page-noise/, file);
  }
});
