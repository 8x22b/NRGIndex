const { ApiError } = require("./errors");

const TIERS = ["S", "A", "B", "C", "D"];
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const SYSTEM_PROMPT =
  "Ты разбираешь сообщение про энергетик и возвращаешь СТРОГО JSON без пояснений: " +
  '{"brand":"бренд","name":"полное название","flavor":"вкус по-русски","edition":"издание/дизайн банки, коротко","tier":"S|A|B|C|D","review":"живой отзыв 1-3 предложения по-русски"} ' +
  "tier выведи из описания: восторг=S, хвалят=A, норм=B, так себе=C, ругают=D. " +
  "Заполняй ВСЕ поля, даже если данных мало: вкус, издание и отзыв восстанови правдоподобно по бренду, названию и линейке. Пустых строк быть не должно.";
const REPAIR_PROMPT =
  "Дозаполни JSON напитка: верни строго тот же JSON, где все поля непустые и правдоподобные — " +
  "flavor (вкус), edition (серия/оформление банки), review (живой отзыв 1-3 предложения, согласованный с tier). " +
  'Ответ — только JSON вида {"brand":"...","name":"...","flavor":"...","edition":"...","tier":"S|A|B|C|D","review":"..."}.';
const FALLBACK_FLAVOR = "классический вкус";
const FALLBACK_EDITION = "классическая банка";
const FALLBACK_REVIEW = "Коротко: сойдёт — подробности при следующей дегустации.";

const isFilled = (value) => Boolean(value && String(value).trim());

function normalizeParsed(raw) {
  const parsed = raw && typeof raw === "object" ? raw : {};
  const clean = {
    brand: String(parsed.brand || "").trim().slice(0, 80),
    name: String(parsed.name || "").trim().slice(0, 120),
    flavor: String(parsed.flavor || "").trim().slice(0, 160),
    edition: String(parsed.edition || "").trim().slice(0, 160),
    review: String(parsed.review || "").trim().slice(0, 600),
    tier: TIERS.includes(parsed.tier) ? parsed.tier : "B",
  };
  if (!clean.name) return clean;
  if (!clean.brand) clean.brand = clean.name;
  if (!clean.flavor) clean.flavor = FALLBACK_FLAVOR;
  if (!clean.edition) clean.edition = FALLBACK_EDITION;
  if (!clean.review) clean.review = FALLBACK_REVIEW;
  return clean;
}

async function requestParsedJson(messages, { key, model, fetchImpl = fetch }) {
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
        temperature: 0.35,
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new ApiError(502, `OpenRouter ответил HTTP ${res.status}`, "ai_failed");
    const json = await res.json();
    const raw = String(json?.choices?.[0]?.message?.content || "")
      .replace(/```json|```/g, "")
      .trim();
    try {
      return JSON.parse(raw);
    } catch {
      throw new ApiError(502, "ИИ вернул не JSON, попробуйте переформулировать", "ai_bad_response");
    }
  } finally {
    clearTimeout(timer);
  }
}

async function parseDrinkText(text, { key, model, fetchImpl = fetch } = {}) {
  if (!key) {
    throw new ApiError(503, "OpenRouter-ключ не настроен (админка → Настройки)", "ai_not_configured");
  }
  const userText = String(text || "").slice(0, 4000);
  const first = await requestParsedJson(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
    { key, model, fetchImpl },
  );
  let clean = normalizeParsed(first);
  if (!clean.name) throw new ApiError(502, "ИИ вернул пустое название", "ai_bad_response");

  const incomplete =
    !isFilled(first?.flavor) || !isFilled(first?.edition) || !isFilled(first?.review);
  if (incomplete) {
    const repaired = await requestParsedJson(
      [
        { role: "system", content: REPAIR_PROMPT },
        { role: "user", content: JSON.stringify({ source: userText, current: clean }) },
      ],
      { key, model, fetchImpl },
    ).catch(() => null);
    if (repaired && isFilled(repaired.name)) {
      clean = normalizeParsed({ ...clean, ...repaired });
    }
  }
  return clean;
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

module.exports = { parseDrinkText, normalizeParsed, searchCanImages, TIERS, SYSTEM_PROMPT };
