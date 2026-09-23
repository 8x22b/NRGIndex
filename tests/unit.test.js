const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { hashPassword, verifyPassword, hashToken } = require("../server/auth");
const { saveProcessedImage } = require("../server/lib/images");
const {
  username,
  oneOf,
  int,
  color,
  slugify,
  imageFromDataUrl,
} = require("../server/lib/validate");

test("хеш пароля: scrypt с параметрами и солью", async () => {
  const hash = await hashPassword("super-secret-123");
  assert.ok(hash.startsWith("scrypt$32768$8$1$"));
  assert.ok(!hash.includes("super-secret-123"));
  const parts = hash.split("$");
  assert.equal(parts.length, 6);
  assert.ok(parts[4].length > 0);
  assert.ok(parts[5].length > 0);
});

test("одинаковые пароли дают разные хеши (соль)", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert.notEqual(a, b);
});

test("проверка пароля", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.equal(await verifyPassword(hash, "correct horse battery"), true);
  assert.equal(await verifyPassword(hash, "wrong"), false);
  assert.equal(await verifyPassword(null, "x"), false);
  assert.equal(await verifyPassword("plain-text", "plain-text"), false);
  assert.equal(await verifyPassword("scrypt$1$2$3$bad", "x"), false);
});

test("hashToken стабилен и не равен токену", () => {
  const token = "abc";
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), token);
});

test("валидация логина", () => {
  assert.equal(username("Sanya"), "sanya");
  assert.throws(() => username("ab"), /логин/i);
  assert.throws(() => username("bad login!"), /логин/i);
  assert.throws(() => username(""), /логин/i);
});

test("валидация значений", () => {
  assert.equal(oneOf("S", ["S", "A"], "tier"), "S");
  assert.throws(() => oneOf("X", ["S", "A"], "tier"), /tier/);
  assert.equal(int("5", "n", { min: 1, max: 10 }), 5);
  assert.throws(() => int("5.5", "n"), /целым/);
  assert.throws(() => int("99", "n", { max: 10 }), /диапазона/);
  assert.equal(color("#AABBCC", "цвет", null), "#aabbcc");
  assert.throws(() => color("red", "цвет", null), /#RRGGBB/);
  assert.equal(slugify("Burn Tropical Mix!"), "burn-tropical-mix");
  assert.equal(slugify(""), "drink");
});

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
    assert.match(result.path, /^\/uploads\/[a-z0-9-]+\.png$/);
    assert.equal(result.accent.length, 2);
    assert.match(result.accent[0], /^#[0-9a-f]{6}$/);

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

const { normalizeInitials, userToParticipant, userToApi } = require("../server/lib/serialize");

test("инициалы нормализуются до двух символов", () => {
  assert.equal(normalizeInitials("ДАУН", "Рома"), "ДА");
  assert.equal(normalizeInitials("F", "Саня"), "F");
  assert.equal(normalizeInitials("", "Рома"), "РО");
  assert.equal(normalizeInitials("", "Саня Тестов"), "СТ");
});

test("длинные инициалы не ломают кружок и титул сохраняется", () => {
  const row = {
    id: 3,
    username: "roma",
    display_name: "Рома",
    initials: "ДАУН",
    title: "долбаеб",
    role: "user",
    is_active: 1,
    is_public: 1,
    must_change_password: 0,
    has_password: 1,
    color: "#00ff00",
    created_at: "2026-01-01",
  };
  const participant = userToParticipant(row);
  assert.equal(participant.initials, "ДА");
  assert.equal(participant.role, "долбаеб");
  assert.equal(userToApi(row).initials, "ДА");
});
