const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  redrawCanOnTransparent,
  templateDataUrl,
  templateDataUrlFromUpload,
  DEFAULT_OPENROUTER_IMAGE_MODEL,
} = require("../../server/lib/openrouter-image");

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DATA_URL = `data:image/png;base64,${PNG_1X1}`;

test("redrawCanOnTransparent: шлёт исходник и шаблон, возвращает прозрачный PNG и цену", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return {
      ok: true,
      json: async () => ({
        data: [{ b64_json: PNG_1X1, media_type: "image/png" }],
        usage: { prompt_tokens: 10, completion_tokens: 116, total_tokens: 126, cost: 0.04174 },
      }),
    };
  };
  const { imageDataUrl, usage } = await redrawCanOnTransparent(DATA_URL, { key: "k", fetchImpl });

  assert.equal(seen[0].url, "https://openrouter.ai/api/v1/images");
  assert.equal(seen[0].init.headers.Authorization, "Bearer k");
  assert.equal(seen[0].init.headers["X-Title"], "NRG/INDEX");
  assert.equal(seen[0].init.method, "POST");

  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.model, "openai/gpt-image-2.5-sunburst");
  assert.equal(body.model, DEFAULT_OPENROUTER_IMAGE_MODEL);
  assert.equal(body.aspect_ratio, "9:16");
  assert.equal(body.quality, "low");
  assert.equal(body.background, "transparent");
  assert.equal(body.output_format, "png");
  assert.match(body.prompt, /transparent/i);
  assert.match(body.prompt, /no glossy highlights/i);
  assert.match(body.prompt, /template/i);

  assert.equal(body.input_references.length, 2);
  assert.ok(body.input_references[0].image_url.url.startsWith("data:image/png;base64,"));
  assert.ok(body.input_references[1].image_url.url.startsWith("data:image/jpeg;base64,"));
  assert.ok(body.input_references[1].image_url.url.length > 1000);
  assert.equal(body.input_references[1].image_url.url, templateDataUrl());

  assert.ok(imageDataUrl.startsWith("data:image/png;base64,"));
  assert.equal(usage.costUsd, 0.04174);
  assert.equal(usage.totalTokens, 126);
  assert.ok(usage.ms >= 0);
});

test("redrawCanOnTransparent: кастомный промпт уходит вместо стандартного", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: PNG_1X1, media_type: "image/png" }] }),
    };
  };
  await redrawCanOnTransparent(DATA_URL, { key: "k", prompt: "Custom OR prompt", fetchImpl });
  const body = JSON.parse(captured.init.body);
  assert.equal(body.prompt, "Custom OR prompt");
});

test("redrawCanOnTransparent: кастомный шаблон идёт вторым reference", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      json: async () => ({ data: [{ b64_json: PNG_1X1, media_type: "image/png" }] }),
    };
  };
  await redrawCanOnTransparent(DATA_URL, { key: "k", template: "data:image/webp;base64,AAAA", fetchImpl });
  const body = JSON.parse(captured.init.body);
  assert.equal(body.input_references[1].image_url.url, "data:image/webp;base64,AAAA");
});

test("templateDataUrlFromUpload: читает файл и отсекает чужое", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nrg-template-"));
  try {
    fs.writeFileSync(path.join(dir, "template-x.png"), Buffer.from(PNG_1X1, "base64"));
    assert.ok(templateDataUrlFromUpload(dir, "/uploads/template-x.png").startsWith("data:image/png;base64,"));
    assert.throws(() => templateDataUrlFromUpload(dir, "/uploads/template-x.gif"), /не найден/);
    assert.throws(() => templateDataUrlFromUpload(dir, "/uploads/template-missing.png"), /не найден/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("redrawCanOnTransparent: без ключа сеть не трогаем", async () => {
  let called = false;
  await assert.rejects(
    () => redrawCanOnTransparent(DATA_URL, { key: "", fetchImpl: async () => { called = true; } }),
    /OpenRouter/,
  );
  assert.equal(called, false);
});

test("redrawCanOnTransparent: битый dataURL — сеть не трогаем", async () => {
  let called = false;
  await assert.rejects(
    () => redrawCanOnTransparent("https://example.com/x.png", { key: "k", fetchImpl: async () => { called = true; } }),
    /data:image/,
  );
  assert.equal(called, false);
});

test("redrawCanOnTransparent: HTTP-ошибка тащит статус и текст провайдера", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 402,
    json: async () => ({ error: { message: "Insufficient credits" } }),
  });
  const error = await redrawCanOnTransparent(DATA_URL, { key: "bad", fetchImpl }).catch((err) => err);
  assert.equal(error.status, 402);
  assert.match(error.message, /Insufficient credits/);
});

test("redrawCanOnTransparent: пустой ответ без картинки — ошибка", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(
    () => redrawCanOnTransparent(DATA_URL, { key: "k", fetchImpl }),
    /не вернул картинку/,
  );
});

test("redrawCanOnTransparent: неизвестный media_type трактуем как PNG", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ data: [{ b64_json: PNG_1X1, media_type: "application/octet-stream" }] }),
  });
  const { imageDataUrl } = await redrawCanOnTransparent(DATA_URL, { key: "k", fetchImpl });
  assert.ok(imageDataUrl.startsWith("data:image/png;base64,"));
});
