const test = require("node:test");
const assert = require("node:assert/strict");
const { transcribeAudio, refineTranscription, STT_CLEANUP_PROMPT } = require("../server/lib/ai");

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

test("transcribeAudio возвращает ошибку, если очистка STT вернула пустой текст", async () => {
  let count = 0;
  const fetchImpl = async () => {
    count += 1;
    return count === 1
      ? { ok: true, json: async () => ({ text: "сомнительная фраза" }) }
      : { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ text: "" }) } }] }) };
  };
  await assert.rejects(
    () => transcribeAudio(Buffer.alloc(500, 1), "audio/webm", {
      sttKey: "stt-key",
      parseKey: "text-key",
      sttBaseUrl: "https://openrouter.ai/api/v1",
      parseBaseUrl: "https://text.example/v1",
      fetchImpl,
    }),
    /пустой текст/,
  );
});
