const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { saveProcessedImage } = require("../../server/lib/images");
const { imageFromDataUrl } = require("../../server/lib/validate");

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("картинки: принимаем PNG, отвергаем подделку и SVG", () => {
  const ok = imageFromDataUrl(`data:image/png;base64,${PNG_1X1}`, { maxBytes: 1024 * 1024 });
  assert.equal(ok.ext, "png");
  assert.ok(ok.buffer.length > 0);

  assert.throws(
    () => imageFromDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", { maxBytes: 1024 }),
    /PNG, JPEG и WebP/,
  );

  const fakePng = Buffer.from("not a png").toString("base64");
  assert.throws(
    () => imageFromDataUrl(`data:image/png;base64,${fakePng}`, { maxBytes: 1024 }),
    /не совпадает/,
  );

  const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(2048)]).toString(
    "base64",
  );
  assert.throws(
    () => imageFromDataUrl(`data:image/png;base64,${big}`, { maxBytes: 1024 }),
    /больше/,
  );

  assert.throws(() => imageFromDataUrl("https://example.com/x.png", { maxBytes: 1024 }), /data:/);
});

const hexToRgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));

test("картинка автоматически кадрируется и получает акцент по цвету банки", async () => {
  const width = 80;
  const height = 80;
  const raw = Buffer.alloc(width * height * 4, 255);
  for (let y = 20; y < 60; y++) {
    for (let x = 25; x < 55; x++) {
      const offset = (y * width + x) * 4;
      raw[offset] = 220;
      raw[offset + 1] = 40;
      raw[offset + 2] = 60;
      raw[offset + 3] = 255;
    }
  }
  const png = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nrg-img-"));
  try {
    const result = await saveProcessedImage(
      dir,
      `data:image/png;base64,${png.toString("base64")}`,
      2 * 1024 * 1024,
    );
    assert.match(result.path, /^\/uploads\/[a-z0-9-]+\.webp$/);
    assert.equal(result.accent.length, 2);
    assert.match(result.accent[0], /^#[0-9a-f]{6}$/);
    assert.ok(result.width > 0 && result.height > 0);
    assert.match(result.srcset, /\/uploads\/[a-z0-9-]+\.webp \d+w/);

    const file = path.join(dir, path.basename(result.path));
    const meta = await sharp(fs.readFileSync(file)).metadata();
    assert.equal(meta.hasAlpha, true);
    assert.ok(meta.width < width, `ширина должна уменьшиться после обрезки: ${meta.width}`);
    assert.ok(meta.height < height, `высота должна уменьшиться после обрезки: ${meta.height}`);

    const [r, g, b] = hexToRgb(result.accent[0]);
    assert.ok(r > 150 && r > g + 40 && r > b + 40, `акцент должен быть красным: ${result.accent[0]}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("светлая банка с серой кромкой: заливка встаёт на контуре, нутро цело", async () => {
  const width = 120;
  const height = 120;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      raw[offset] = 255;
      raw[offset + 1] = 255;
      raw[offset + 2] = 255;
      raw[offset + 3] = 255;
    }
  }
  // «Банка»: светло-серое нутро (в допуске TOL от белого — старый код его съедал),
  // вокруг — серая кромка 2px (проходит по neutral-ветке, но перепад яркости ~105 — контур).
  for (let y = 20; y < 100; y++) {
    for (let x = 30; x < 90; x++) {
      const offset = (y * width + x) * 4;
      const edge = y < 22 || y > 97 || x < 32 || x > 87;
      const v = edge ? 150 : 235;
      raw[offset] = v;
      raw[offset + 1] = v;
      raw[offset + 2] = v;
    }
  }
  const jpeg = await sharp(raw, { raw: { width, height, channels: 4 } }).jpeg({ quality: 75 }).toBuffer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nrg-img-"));
  try {
    const result = await saveProcessedImage(dir, `data:image/jpeg;base64,${jpeg.toString("base64")}`, 2 * 1024 * 1024);
    const file = path.join(dir, path.basename(result.path));
    const { data, info } = await sharp(fs.readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    assert.equal(alphaAt(0, 0), 0, "угол фона должен стать прозрачным");
    assert.equal(alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2)), 255, "светлое нутро банки за контуром должно уцелеть");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("хромакей с градиентом и JPEG-шумом вырезается по доминированию зелёного", async () => {
  const width = 120;
  const height = 120;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Диагональный градиент #00FF00 → #6EAA3C: углы уходят от медианы дальше TOL=54.
      const t = (x + y) / (width + height - 2);
      const offset = (y * width + x) * 4;
      raw[offset] = Math.round(110 * t);
      raw[offset + 1] = Math.round(255 - 85 * t);
      raw[offset + 2] = Math.round(60 * t);
      raw[offset + 3] = 255;
    }
  }
  // Красная «банка» по центру — её зелёного нет, резать нельзя.
  for (let y = 20; y < 100; y++) {
    for (let x = 40; x < 80; x++) {
      const offset = (y * width + x) * 4;
      raw[offset] = 220;
      raw[offset + 1] = 40;
      raw[offset + 2] = 60;
    }
  }
  // Тёмная виньетка сверху/снизу — модель затемняет хромакей к краям кадра.
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      raw[offset] = 15;
      raw[offset + 1] = 55;
      raw[offset + 2] = 18;
    }
  }
  for (let y = 105; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      raw[offset] = 15;
      raw[offset + 1] = 55;
      raw[offset + 2] = 18;
    }
  }
  const jpeg = await sharp(raw, { raw: { width, height, channels: 4 } }).jpeg({ quality: 70 }).toBuffer();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nrg-img-"));
  try {
    const result = await saveProcessedImage(dir, `data:image/jpeg;base64,${jpeg.toString("base64")}`, 2 * 1024 * 1024);
    const file = path.join(dir, path.basename(result.path));
    const { data, info } = await sharp(fs.readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    assert.equal(alphaAt(0, 0), 0, "угол с чистым зелёным должен стать прозрачным");
    assert.equal(alphaAt(info.width - 1, info.height - 1), 0, "угол с тёмным зелёным должен стать прозрачным");
    assert.equal(alphaAt(Math.floor(info.width / 2), Math.floor(info.height / 2)), 255, "банка должна остаться непрозрачной");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
