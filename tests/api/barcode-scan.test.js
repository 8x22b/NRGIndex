const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { startServer, createUser, request, login } = require("../helpers");
const { ean13Png } = require("../helpers/ean13");
const { dataMatrixPng } = require("../helpers/datamatrix");

let ctx;
let userCookie;

before(async () => {
  ctx = await startServer();
  await createUser(ctx.db, { username: "sanya", password: "sanya-pass-123", displayName: "Саша" });
  userCookie = (await login(ctx.base, "sanya", "sanya-pass-123")).cookie;
});

after(async () => {
  await ctx.close();
});

const scan = (cookie, body) =>
  request(ctx.base, "POST", "/api/cabinet/ai/barcode-scan", { cookie, body });

test("скан фото: сервер сам читает код снимка (фолбэк для Firefox/Safari)", async () => {
  const png = await ean13Png("468003691262");
  const sideways = await sharp(png).rotate(90).toBuffer();
  const res = await scan(userCookie, {
    imageDataUrl: `data:image/png;base64,${sideways.toString("base64")}`,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { found: true, code: "4680036912629", format: "ean_13" });
});

test("скан фото: без кода — found:false, а не ошибка", async () => {
  const blank = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 240, g: 240, b: 240 } },
  })
    .png()
    .toBuffer();
  const res = await scan(userCookie, { imageDataUrl: `data:image/png;base64,${blank.toString("base64")}` });
  assert.equal(res.status, 200);
  assert.equal(res.json.found, false);
});

test("скан фото: Data Matrix GS1 читает точный код в сложных вариантах", async () => {
  // zxing-wasm в Plain-режиме не отдаёт начальный FNC1: внутренний GS на месте.
  const expected = "0104680036912629215JuVJmTnOR:3H\x1D93kjJw";
  const png = await dataMatrixPng({ scale: 12 });
  const variants = [
    png,
    await sharp(png).rotate(90).toBuffer(),
    await sharp(png).rotate(270).toBuffer(),
    await sharp(png).negate().toBuffer(),
    await dataMatrixPng({ scale: 2 }),
    await sharp(png).linear(0.65, -25).toBuffer(),
    await sharp(png).blur(0.35).jpeg({ quality: 82 }).toBuffer(),
  ];
  for (const image of variants) {
    const mime = image[0] === 255 ? "image/jpeg" : "image/png";
    const res = await scan(userCookie, { imageDataUrl: `data:${mime};base64,${image.toString("base64")}` });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { found: true, code: expected, format: "data_matrix" });
  }
});

test("скан фото: реальное фото Data Matrix с крышки банки", async () => {
  const { readFile } = require("node:fs/promises");
  const path = require("node:path");
  const jpeg = await readFile(path.join(__dirname, "..", "fixtures", "dm-can-top.jpg"));
  const res = await scan(userCookie, { imageDataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}` });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, {
    found: true,
    code: "0104680036912629215JuVJmTnOR:3H\x1D93kjJw",
    format: "data_matrix",
  });
});

test("скан фото: аноним — 401, мусор — 400", async () => {
  const png = await ean13Png("468003691262");
  const anon = await scan("", { imageDataUrl: `data:image/png;base64,${png.toString("base64")}` });
  assert.equal(anon.status, 401);

  const html = await scan(userCookie, { imageDataUrl: "data:text/html;base64,PGI+SGk8L2I+" });
  assert.equal(html.status, 400);

  const empty = await scan(userCookie, {});
  assert.equal(empty.status, 400);
});
