const test = require("node:test");
const assert = require("node:assert/strict");
const { transcribeAudio, refineTranscription, STT_CLEANUP_PROMPT } = require("../../server/lib/ai");

test("refineTranscription отправляет текст через отдельную text API настройку", async () => {
  let call;
  const fetchImpl = async (url, options) => {
    call = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ text: "Burn манго, топчик." }) } }] }) };
  };
  const result = await refineTranscription("burn манго топчик", {
    parseKey: "text-key",
    parseBaseUrl: "https://text.example/v1",
    fetchImpl,
  });
  assert.equal(result, "Burn манго, топчик.");
  assert.equal(call.url, "https://text.example/v1/chat/completions");
  assert.equal(call.body.messages[1].content, "burn манго топчик");
  assert.match(STT_CLEANUP_PROMPT, /Не добавляй факты/);
});

test("transcribeAudio не валит ввод, если чистка STT вернула пустой текст — отдаёт сырую расшифровку", async () => {
  let count = 0;
  const fetchImpl = async () => {
    count += 1;
    return count === 1
      ? { ok: true, json: async () => ({ text: "сомнительная фраза" }) }
      : { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ text: "" }) } }] }) };
  };
  const text = await transcribeAudio(Buffer.alloc(500, 1), "audio/webm", {
    sttKey: "stt-key",
    parseKey: "text-key",
    sttBaseUrl: "https://openrouter.ai/api/v1",
    parseBaseUrl: "https://text.example/v1",
    fetchImpl,
  });
  assert.equal(text, "сомнительная фраза");
});

test("transcribeAudio не валит ввод, если провайдер чистки ответил ошибкой", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("audio/transcriptions")) {
      return { ok: true, json: async () => ({ text: "сырой текст" }) };
    }
    return { ok: false, status: 502, text: async () => "bad gateway" };
  };
  const text = await transcribeAudio(Buffer.alloc(500, 1), "audio/webm", {
    sttKey: "stt-key",
    parseKey: "text-key",
    sttBaseUrl: "https://openrouter.ai/api/v1",
    parseBaseUrl: "https://text.example/v1",
    fetchImpl,
  });
  assert.equal(text, "сырой текст");
  assert.equal(calls.length, 2, "чистку попробовали и упали в фолбэк");
});
