const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeParsed,
  parseDrinkText,
  transcribeAudio,
  normalizeBaseUrl,
  providerFailureDetail,
  audioFormat,
  decodeAudio,
  searchCanImages,
  photoTerms,
  SYSTEM_PROMPT,
} = require("../../server/lib/ai");

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

test("photoTerms: слова без дублей и спецсимволов поиска", () => {
  assert.equal(photoTerms("Burn", "Burn Juicy Energy", 'малина "личи":'), "Burn Juicy Energy малина личи");
  assert.equal(photoTerms("", "  ", "x"), "");
});

test("searchCanImages ищет по бренду+названию+вкусу и сливает источники", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("openfoodfacts")) {
      return {
        ok: true,
        json: async () => ({
          hits: [
            { brands: ["Volt"], product_name: "Volt Cola", image_front_url: "https://images.openfoodfacts.org/c.jpg" },
            { brands: "Volt", product_name: "Малина-личи", image_front_url: "https://images.openfoodfacts.org/a.jpg" },
            { brands: "Burn", product_name: "Малина", image_front_url: "https://images.openfoodfacts.org/b.jpg" },
            { brands: "Volt", image_front_url: "https://evil.example/x.jpg" },
          ],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        query: {
          pages: {
            1: { index: 2, title: "File:Doc.pdf", imageinfo: [{ mime: "application/pdf", url: "https://upload.wikimedia.org/d.pdf" }] },
            2: { index: 1, title: "File:Volt can.jpg", imageinfo: [{ mime: "image/jpeg", thumburl: "https://upload.wikimedia.org/v.jpg" }] },
          },
        },
      }),
    };
  };
  const images = await searchCanImages({ brand: "Volt", name: "Volt", flavor: "малина личи" }, { fetchImpl });
  assert.deepEqual(
    images.map((item) => item.url),
    ["https://images.openfoodfacts.org/a.jpg", "https://images.openfoodfacts.org/c.jpg", "https://upload.wikimedia.org/v.jpg"],
  );
  assert.equal(images[2].title, "Volt can");
  const off = decodeURIComponent(urls.find((url) => url.includes("openfoodfacts")));
  assert.match(off, /Volt малина личи/);
  // вкус в Commons не шлём — там по нему почти ничего нет
  assert.doesNotMatch(decodeURIComponent(urls.find((url) => url.includes("wikimedia"))), /малина/);
});

test("searchCanImages: один источник упал — отдаём второй, оба — 502", async () => {
  const offOnly = async (url) =>
    url.includes("wikimedia")
      ? { ok: false, status: 503 }
      : { ok: true, json: async () => ({ hits: [{ image_front_url: "https://images.openfoodfacts.org/b.jpg" }] }) };
  assert.equal((await searchCanImages("burn", { fetchImpl: offOnly })).length, 1);
  const down = async () => ({ ok: false, status: 503 });
  await assert.rejects(() => searchCanImages("burn", { fetchImpl: down }), /недоступен/);
});

test("searchCanImages: PNG и «white background» с Commons идут первыми как stockHint", async () => {
  const fetchImpl = async (url) =>
    url.includes("openfoodfacts")
      ? { ok: true, json: async () => ({ hits: [{ brands: "Burn", image_front_url: "https://images.openfoodfacts.org/o.jpg" }] }) }
      : {
          ok: true,
          json: async () => ({
            query: {
              pages: {
                1: { index: 1, title: "File:Burn can.jpg", imageinfo: [{ mime: "image/jpeg", thumburl: "https://upload.wikimedia.org/j.jpg" }] },
                2: { index: 2, title: "File:Burn can.png", imageinfo: [{ mime: "image/png", thumburl: "https://upload.wikimedia.org/p.png" }] },
                3: { index: 3, title: "File:Burn on white background.jpg", imageinfo: [{ mime: "image/jpeg", thumburl: "https://upload.wikimedia.org/w.jpg" }] },
              },
            },
          }),
        };
  const images = await searchCanImages({ brand: "Burn", name: "Burn" }, { fetchImpl });
  assert.deepEqual(
    images.map((item) => [item.url.split("/").pop(), item.stockHint]),
    [["p.png", true], ["w.jpg", true], ["o.jpg", false], ["j.jpg", false]],
  );
});

test("providerFailureDetail достаёт текст ошибки из JSON провайдера", async () => {
  const res = new Response(
    JSON.stringify({ success: false, error: "Access denied by security policy." }),
    { status: 403 },
  );
  assert.equal(await providerFailureDetail(res), "Access denied by security policy.");
});

test("providerFailureDetail чистит HTML и режет длину", async () => {
  const html = new Response("<html><head><title>Blocked</title></head><body>no</body></html>", {
    status: 403,
  });
  const detail = await providerFailureDetail(html);
  assert.ok(detail.includes("Blocked"));
  assert.ok(!detail.includes("<"));
  const long = new Response("z".repeat(400), { status: 500 });
  assert.equal((await providerFailureDetail(long, 50)).length, 50);
});

test("providerFailureDetail: пустое тело — пустая строка", async () => {
  assert.equal(await providerFailureDetail(new Response("", { status: 500 })), "");
});
