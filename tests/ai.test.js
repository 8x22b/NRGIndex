const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeParsed,
  parseDrinkText,
  transcribeAudio,
  normalizeBaseUrl,
  audioFormat,
  decodeAudio,
  SYSTEM_PROMPT,
} = require("../server/lib/ai");

const chatReply = (payload) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
});

test("normalizeParsed не выдумывает отзыв и вкус", () => {
  const clean = normalizeParsed({ name: "Monster White" });
  assert.equal(clean.brand, "Monster");
  assert.equal(clean.flavor, "");
  assert.equal(clean.edition, "");
  assert.equal(clean.review, "");
  assert.equal(clean.tier, "B");
  assert.equal(clean.tierGuessed, true);
});

test("normalizeParsed сохраняет заполненные поля и явный тир", () => {
  const clean = normalizeParsed({
    brand: "Burn",
    name: "Burn Original",
    flavor: "Классика",
    edition: "Чёрная банка",
    review: "Норм",
    tier: "a",
  });
  assert.deepEqual(clean, {
    brand: "Burn",
    name: "Burn Original",
    flavor: "Классика",
    edition: "Чёрная банка",
    review: "Норм",
    tier: "A",
    tierGuessed: false,
  });
});

test("промпт запрещает выдумывать мнение", () => {
  assert.match(SYSTEM_PROMPT, /Ничего не выдумывай/);
  assert.match(SYSTEM_PROMPT, /review = ""/);
  assert.match(SYSTEM_PROMPT, /tier = null/);
});

test("parseDrinkText делает один запрос на base URL и оставляет пустыми неизвестные поля", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return chatReply({ brand: "Monster", name: "Monster White", flavor: "", edition: "", review: "", tier: null });
  };
  const result = await parseDrinkText("монстр белый", {
    key: "test-key",
    baseUrl: "https://llm.example/v1",
    fetchImpl,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://llm.example/v1/chat/completions");
  assert.equal(result.review, "");
  assert.equal(result.tierGuessed, true);
});

test("parseDrinkText достаёт JSON даже с мусором вокруг", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'Вот:\n```json\n{"brand":"Burn","name":"Burn Apple Kiwi","tier":"A","review":"Вкусный"}\n```' } }],
    }),
  });
  const result = await parseDrinkText("берн яблоко киви, вкусный, A", { key: "k", fetchImpl });
  assert.equal(result.tier, "A");
  assert.equal(result.review, "Вкусный");
});

test("parseDrinkText без ключа сообщает об ошибке", async () => {
  await assert.rejects(() => parseDrinkText("тест", { key: "" }), /ключ/i);
});

test("transcribeAudio: OpenRouter получает JSON с input_audio", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, body: JSON.parse(options.body), headers: options.headers };
    return { ok: true, json: async () => ({ text: " Burn манго, топчик " }) };
  };
  const text = await transcribeAudio(Buffer.alloc(500, 1), "audio/webm;codecs=opus", {
    key: "k",
    sttModel: "openai/whisper-large-v3-turbo",
    baseUrl: "https://openrouter.ai/api/v1",
    fetchImpl,
  });
  assert.equal(text, "Burn манго, топчик");
  assert.equal(captured.url, "https://openrouter.ai/api/v1/audio/transcriptions");
  assert.equal(captured.body.model, "openai/whisper-large-v3-turbo");
  assert.equal(captured.body.input_audio.format, "webm");
  assert.equal(captured.body.language, "ru");
  assert.ok(captured.body.input_audio.data.length > 0);
});

test("transcribeAudio: другой провайдер получает multipart", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, body: options.body };
    return { ok: true, json: async () => ({ text: "привет" }) };
  };
  await transcribeAudio(Buffer.alloc(500, 1), "audio/mp4", { key: "k", baseUrl: "https://api.groq.com/openai/v1", fetchImpl });
  assert.equal(captured.url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.ok(captured.body instanceof FormData);
  assert.equal(captured.body.get("model"), "openai/whisper-large-v3-turbo");
});

test("transcribeAudio: пустой текст — ошибка", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ text: "" }) });
  await assert.rejects(
    () => transcribeAudio(Buffer.alloc(500, 1), "audio/webm", { key: "k", fetchImpl }),
    /речь/,
  );
});

test("normalizeBaseUrl, audioFormat, decodeAudio валидируют ввод", () => {
  assert.equal(normalizeBaseUrl("https://openrouter.ai/api/v1/"), "https://openrouter.ai/api/v1");
  assert.throws(() => normalizeBaseUrl("ftp://x"), /http/);
  assert.throws(() => normalizeBaseUrl("не адрес"), /Base URL/);
  assert.equal(audioFormat("audio/ogg;codecs=opus"), "ogg");
  assert.throws(() => audioFormat("text/plain"), /формат/);
  assert.throws(() => decodeAudio("aGk="), /короткая/);
  assert.equal(decodeAudio(Buffer.alloc(300).toString("base64")).length, 300);
});
