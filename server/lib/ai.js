const { ApiError } = require("./errors");

const TIERS = ["S", "A", "B", "C", "D"];
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const SYSTEM_PROMPT =
  "Ты разбираешь сообщение про энергетик и возвращаешь СТРОГО JSON без пояснений: " +
  '{"brand":"бренд","name":"полное название","flavor":"вкус по-русски","edition":"издание/дизайн банки, коротко","tier":"S|A|B|C|D","review":"живой отзыв 1-3 предложения по-русски"} ' +
  "tier выведи из описания: восторг=S, хвалят=A, норм=B, так себе=C, ругают=D. " +
  "Не выдумывай факты: если чего-то нет в тексте — оставь поле пустым.";

async function parseDrinkText(text, { key, model, fetchImpl = fetch }) {
  if (!key) {
    throw new ApiError(503, "OpenRouter-ключ не настроен (админка → Настройки)", "ai_not_configured");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-Title": "NRG/INDEX",
      },
      body: JSON.stringify({
        model: model || "openai/gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: String(text || "").slice(0, 4000) },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new ApiError(502, `OpenRouter ответил HTTP ${res.status}`, "ai_failed");
    const json = await res.json();
    const raw = String(json?.choices?.[0]?.message?.content || "")
      .replace(/```json|```/g, "")
      .trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApiError(502, "ИИ вернул не JSON, попробуйте переформулировать", "ai_bad_response");
    }
    const clean = {
      brand: String(parsed.brand || "").trim().slice(0, 80),
      name: String(parsed.name || "").trim().slice(0, 120),
      flavor: String(parsed.flavor || "").trim().slice(0, 160),
      edition: String(parsed.edition || "").trim().slice(0, 160),
      review: String(parsed.review || "").trim().slice(0, 600),
      tier: TIERS.includes(parsed.tier) ? parsed.tier : "B",
    };
    if (!clean.name) throw new ApiError(502, "ИИ вернул пустое название", "ai_bad_response");
    if (!clean.brand) clean.brand = clean.name;
    return clean;
  } finally {
    clearTimeout(timer);
  }
}

async function searchCanImages(query, { fetchImpl = fetch } = {}) {
  const url =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
    `&generator=search&gsrsearch=${encodeURIComponent(`${query} energy drink can`)}` +
    "&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url%7Csize&iiurlwidth=480";
  const res = await fetchImpl(url);
  if (!res.ok) throw new ApiError(502, "Поиск фото недоступен", "photo_search_failed");
  const data = await res.json();
  return Object.values(data?.query?.pages || {})
    .map((page) => page?.imageinfo?.[0]?.thumburl || page?.imageinfo?.[0]?.url)
    .filter(Boolean);
}

module.exports = { parseDrinkText, searchCanImages, TIERS };
