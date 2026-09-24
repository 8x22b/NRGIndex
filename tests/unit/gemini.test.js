const test = require("node:test");
const assert = require("node:assert/strict");
const { redrawCanOnWhite, checkGeminiKey, DEFAULT_IMAGE_MODEL } = require("../../server/lib/gemini");

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DATA_URL = `data:image/png;base64,${PNG_1X1}`;

test("redrawCanOnWhite: шлёт картинку + промпт, возвращает dataURL", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return {
      ok: true,
      json: async () => ({ output_image: { mime_type: "image/png", data: PNG_1X1 } }),
    };
  };
  const { imageDataUrl } = await redrawCanOnWhite(DATA_URL, { key: "k", fetchImpl });
  assert.equal(imageDataUrl, DATA_URL);
  assert.match(seen[0].url, /generativelanguage\.googleapis\.com\/v1beta\/interactions/);
  assert.equal(seen[0].init.headers["x-goog-api-key"], "k");
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, DEFAULT_IMAGE_MODEL);
  assert.ok(body.input.some((part) => part.type === "text" && /white/i.test(part.text)));
  const imagePart = body.input.find((part) => part.type === "image");
  assert.equal(imagePart.mime_type, "image/png");
  assert.ok(imagePart.data.length > 10);
});

test("redrawCanOnWhite: без ключа сеть не трогаем", async () => {
  let called = false;
  await assert.rejects(() => redrawCanOnWhite(DATA_URL, { key: "", fetchImpl: async () => { called = true; } }), /Gemini/);
  assert.equal(called, false);
});

test("redrawCanOnWhite: битый dataURL — сеть не трогаем", async () => {
  let called = false;
  await assert.rejects(() => redrawCanOnWhite("https://example.com/x.png", { key: "k", fetchImpl: async () => { called = true; } }), /data:image/);
  assert.equal(called, false);
});

test("redrawCanOnWhite: HTTP-ошибка тащит статус и текст гугла", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: "API key not valid" } }),
  });
  const error = await redrawCanOnWhite(DATA_URL, { key: "bad", fetchImpl }).catch((err) => err);
  assert.equal(error.status, 400);
  assert.match(error.message, /API key not valid/);
});

test("redrawCanOnWhite: пустой ответ без картинки — ошибка", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(() => redrawCanOnWhite(DATA_URL, { key: "k", fetchImpl }), /не вернул картинку/);
});

test("checkGeminiKey: models.get возвращает модель и ms", async () => {
  const fetchImpl = async (url) => {
    assert.match(url, /models\/gemini-3\.1-flash-lite-image/);
    return { ok: true, json: async () => ({ name: "models/gemini-3.1-flash-lite-image" }) };
  };
  const info = await checkGeminiKey({ key: "k", model: "gemini-3.1-flash-lite-image", fetchImpl });
  assert.ok(info.ms >= 0);
  assert.match(info.model, /gemini-3\.1-flash-lite-image/);
});

test("checkGeminiKey: без ключа сеть не трогаем", async () => {
  let called = false;
  await assert.rejects(() => checkGeminiKey({ key: "", fetchImpl: async () => { called = true; } }), /Gemini/);
  assert.equal(called, false);
});
