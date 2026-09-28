const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSettings, parseDrinkText, transcribeAudio } = require("../../server/lib/ai");

function dbWith(values) {
  // как better-sqlite3: нет строки в settings — .get() возвращает undefined,
  // и getSetting отдаёт fallback
  return { prepare: (sql) => ({ get: (key) => (key in values ? { value: values[key] } : undefined) }) };
}

test("aiSettings разделяет ключ разбора и OpenRouter STT", () => {
  const settings = aiSettings(dbWith({
    parse_api_key: "parse-secret",
    parse_base_url: "https://llm.example/v1",
    openrouter_key: "or-secret",
  }));
  assert.equal(settings.parseKey, "parse-secret");
  assert.equal(settings.parseBaseUrl, "https://llm.example/v1");
  assert.equal(settings.sttKey, "or-secret");
  assert.equal(settings.sttBaseUrl, "https://openrouter.ai/api/v1");
  assert.equal(settings.imageProvider, "gemini");
  assert.equal(settings.openrouterImageModel, "openai/gpt-image-2.5-sunburst");
  assert.equal(settings.openrouterImageTemplate, "");
  assert.match(settings.openrouterImagePrompt, /transparent/i);
  assert.match(settings.geminiImagePrompt, /#00FF00/);
  assert.equal(settings.geminiVisionModel, "gemini-3.8-flash");
});

test("aiSettings отдаёт кастомные промпты генерации", () => {
  const settings = aiSettings(dbWith({
    openrouter_image_prompt: "custom-or",
    gemini_image_prompt: "custom-g",
    openrouter_image_template: "/uploads/template-x.png",
    gemini_vision_model: "gemini-x",
  }));
  assert.equal(settings.openrouterImagePrompt, "custom-or");
  assert.equal(settings.geminiImagePrompt, "custom-g");
  assert.equal(settings.openrouterImageTemplate, "/uploads/template-x.png");
  assert.equal(settings.geminiVisionModel, "gemini-x");
});

test("разбор текста использует отдельный API key и переданный прокси fetch", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"name":"Test"}' } }] }) };
  };
  const parsed = await parseDrinkText("Test", {
    parseKey: "parse-secret",
    parseBaseUrl: "https://llm.example/v1",
    fetchImpl,
  });
  assert.equal(parsed.name, "Test");
  assert.equal(captured.url, "https://llm.example/v1/chat/completions");
  assert.equal(captured.init.headers.Authorization, "Bearer parse-secret");
});

test("STT всегда обращается к OpenRouter endpoint с отдельным ключом", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, json: async () => ({ text: "распознано" }) };
  };
  const result = await transcribeAudio(Buffer.alloc(300, 1), "audio/wav", {
    sttKey: "or-secret",
    fetchImpl,
  });
  assert.equal(result, "распознано");
  assert.equal(captured.url, "https://openrouter.ai/api/v1/audio/transcriptions");
  assert.equal(captured.init.headers.Authorization, "Bearer or-secret");
});
