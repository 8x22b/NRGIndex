const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSettings, parseDrinkText, transcribeAudio } = require("../server/lib/ai");

function dbWith(values) {
  return { prepare: (sql) => ({ get: (key) => ({ value: values[key] }) }) };
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
