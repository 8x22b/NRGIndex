const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeParsed, parseDrinkText } = require("../server/lib/ai");

test("normalizeParsed дозаполняет пустые поля", () => {
  const clean = normalizeParsed({ name: "Monster White" });
  assert.equal(clean.brand, "Monster White");
  assert.ok(clean.flavor.length > 0);
  assert.ok(clean.edition.length > 0);
  assert.ok(clean.review.length > 0);
  assert.equal(clean.tier, "B");
});

test("normalizeParsed не трогает заполненные поля", () => {
  const clean = normalizeParsed({
    brand: "Burn",
    name: "Burn Original",
    flavor: "Классика",
    edition: "Чёрная банка",
    review: "Норм",
    tier: "A",
  });
  assert.deepEqual(clean, {
    brand: "Burn",
    name: "Burn Original",
    flavor: "Классика",
    edition: "Чёрная банка",
    review: "Норм",
    tier: "A",
  });
});

test("parseDrinkText дозапрашивает ИИ, если поля остались пустыми", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.messages.map((message) => message.content));
    const content =
      calls.length === 1
        ? JSON.stringify({ brand: "Monster", name: "Monster White", tier: "B" })
        : JSON.stringify({
            brand: "Monster",
            name: "Monster White",
            flavor: "Цитрус",
            edition: "Белая банка",
            review: "Лёгкий цитрус, бодрит.",
            tier: "B",
          });
    return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
  };

  const result = await parseDrinkText("монстр белый", { key: "test-key", fetchImpl });
  assert.equal(calls.length, 2);
  assert.match(calls[1][0], /Дозаполни/);
  assert.equal(result.flavor, "Цитрус");
  assert.equal(result.edition, "Белая банка");
  assert.equal(result.brand, "Monster");
});

test("parseDrinkText не делает лишних запросов, когда всё заполнено", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                brand: "Burn",
                name: "Burn Apple Kiwi",
                flavor: "Яблоко и киви",
                edition: "Зелёная банка",
                review: "Свежий вкус, беру ещё.",
                tier: "A",
              }),
            },
          },
        ],
      }),
    };
  };
  const result = await parseDrinkText("берн яблоко киви, вкусный", { key: "test-key", fetchImpl });
  assert.equal(calls, 1);
  assert.equal(result.tier, "A");
  assert.equal(result.flavor, "Яблоко и киви");
});

test("parseDrinkText без ключа сообщает об ошибке", async () => {
  await assert.rejects(() => parseDrinkText("тест", { key: "" }), /ключ/i);
});
