const { ApiError, badRequest } = require("./errors");
const { getSetting } = require("../db");

const TIERS = ["S", "A", "B", "C", "D"];
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_STT_MODEL = "openai/whisper-large-v3-turbo";
const DEFAULT_TIER = "B";
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const SYSTEM_PROMPT = [
  "Ты — парсер. Из сообщения пользователя про энергетик извлеки данные и верни СТРОГО JSON без пояснений и markdown:",
  '{"brand":"","name":"","flavor":"","edition":"","tier":"S|A|B|C|D|null","review":""}',
  "",
  "Правила:",
  "1. Ничего не выдумывай. Особенно мнение: ты не пробовал напиток, у тебя нет вкуса и оценок.",
  "2. review — только мнение самого автора из его сообщения: перескажи коротко (1–3 предложения, по-русски, от первого лица),",
  "   сохраняя его слова и смысл. Не добавляй ни одного впечатления, эпитета или вывода, которого нет в тексте.",
  "   Если автор не высказал мнения — review = \"\".",
  "3. tier — только если автор явно оценил напиток: прямо назвал тир (S/A/B/C/D) или однозначно выразил отношение",
  "   (восторг, «лучший» = S; хвалит, «возьму ещё» = A; «норм», «пойдёт» = B; «так себе», «на любителя» = C; ругает, «не бери» = D).",
  "   Если оценки нет — tier = null. Не выводи тир из репутации бренда.",
  "4. brand и name — из текста; можно исправить опечатки и транслитерацию до официального написания (берн → Burn, монстр → Monster).",
  "   name — полное название продукта (например, \"Burn Apple Kiwi\"). Если в тексте есть только бренд, name = бренд.",
  "5. flavor — вкус по-русски, если он указан в тексте ИЛИ точно известен для этого конкретного продукта. Не угадывай; не уверен — \"\".",
  "6. edition — серия/оформление банки, только если упомянуто в тексте или однозначно следует из названия (Zero, Ultra, лимитка). Иначе \"\".",
  "7. Пустая строка лучше выдуманного значения.",
].join("\n");

function normalizeParsed(raw) {
  const parsed = raw && typeof raw === "object" ? raw : {};
  const tierRaw = String(parsed.tier ?? "").trim().toUpperCase();
  const tierGiven = TIERS.includes(tierRaw);
  const clean = {
    brand: String(parsed.brand || "").trim().slice(0, 80),
    name: String(parsed.name || "").trim().slice(0, 120),
    flavor: String(parsed.flavor || "").trim().slice(0, 160),
    edition: String(parsed.edition || "").trim().slice(0, 160),
    review: String(parsed.review || "").trim().slice(0, 600),
    tier: tierGiven ? tierRaw : DEFAULT_TIER,
    tierGuessed: !tierGiven,
  };
  if (!clean.name && clean.brand) clean.name = clean.brand;
  if (!clean.brand && clean.name) clean.brand = clean.name.split(/\s+/)[0];
  return clean;
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("Base URL должен быть полным адресом, например https://openrouter.ai/api/v1");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw badRequest("Base URL: только http или https");
  if (url.username || url.password) throw badRequest("Base URL не должен содержать логин/пароль");
  if (url.search || url.hash) throw badRequest("Base URL без ?query и #hash");
  return raw;
}

function aiSettings(db) {
  return {
    key: getSetting(db, "openrouter_key", "") || process.env.OPENROUTER_KEY || "",
    model: getSetting(db, "openrouter_model", "") || DEFAULT_MODEL,
    sttModel: getSetting(db, "stt_model", "") || DEFAULT_STT_MODEL,
    baseUrl: getSetting(db, "ai_base_url", "") || process.env.AI_BASE_URL || DEFAULT_BASE_URL,
  };
}

const isOpenRouter = (baseUrl) => {
  try {
    return new URL(baseUrl).hostname.endsWith("openrouter.ai");
  } catch {
    return false;
  }
};

function requireKey(key) {
  if (!key) {
    throw new ApiError(503, "API-ключ ИИ не настроен (админка → Настройки)", "ai_not_configured");
  }
}

async function postWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new ApiError(504, "ИИ не ответил вовремя", "ai_timeout");
    throw new ApiError(502, "Не удалось связаться с ИИ-провайдером", "ai_failed");
  } finally {
    clearTimeout(timer);
  }
}

async function providerError(res, what) {
  let detail = "";
  try {
    const body = await res.json();
    detail = String(body?.error?.message || body?.error || "").slice(0, 200);
  } catch {
    /* тело не JSON */
  }
  return new ApiError(502, `${what}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`, "ai_failed");
}

const authHeaders = (key) => ({
  Authorization: `Bearer ${key}`,
  "X-Title": "NRG/INDEX",
});

async function requestParsedJson(messages, { key, model, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch }) {
  const res = await postWithTimeout(
    fetchImpl,
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(key) },
      body: JSON.stringify({ model: model || DEFAULT_MODEL, temperature: 0.1, messages }),
    },
    30_000,
  );
  if (!res.ok) throw await providerError(res, "ИИ ответил ошибкой");
  const json = await res.json();
  const raw = String(json?.choices?.[0]?.message?.content || "")
    .replace(/```json|```/g, "")
    .trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  try {
    return JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  } catch {
    throw new ApiError(502, "ИИ вернул не JSON, попробуйте переформулировать", "ai_bad_response");
  }
}

async function parseDrinkText(text, { key, model, baseUrl, fetchImpl = fetch } = {}) {
  requireKey(key);
  const userText = String(text || "").slice(0, 4000);
  const parsed = await requestParsedJson(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
    { key, model, baseUrl, fetchImpl },
  );
  const clean = normalizeParsed(parsed);
  if (!clean.name) {
    throw new ApiError(502, "Не понял, что за напиток — назови хотя бы бренд", "ai_bad_response");
  }
  return clean;
}

const AUDIO_FORMATS = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
};

function audioFormat(mimeType) {
  const base = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const format = AUDIO_FORMATS[base];
  if (!format) throw badRequest("Неподдерживаемый формат аудио");
  return format;
}

function decodeAudio(base64) {
  const clean = String(base64 || "").replace(/^data:[^,]*,/, "");
  if (!clean || !/^[A-Za-z0-9+/=\s]+$/.test(clean)) throw badRequest("Ожидается аудио в base64");
  const buffer = Buffer.from(clean, "base64");
  if (buffer.length < 200) throw badRequest("Запись слишком короткая");
  if (buffer.length > MAX_AUDIO_BYTES) throw badRequest("Запись слишком длинная (до 5 МБ)");
  return buffer;
}

async function transcribeAudio(buffer, mimeType, { key, sttModel, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
  requireKey(key);
  const format = audioFormat(mimeType);
  const model = sttModel || DEFAULT_STT_MODEL;
  const url = `${baseUrl}/audio/transcriptions`;
  let init;
  if (isOpenRouter(baseUrl)) {
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(key) },
      body: JSON.stringify({
        model,
        input_audio: { data: buffer.toString("base64"), format },
        language: "ru",
        temperature: 0,
      }),
    };
  } else {
    // OpenAI-совместимые провайдеры принимают multipart/form-data
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: String(mimeType).split(";")[0] }), `voice.${format}`);
    form.append("model", model);
    form.append("language", "ru");
    form.append("temperature", "0");
    init = { method: "POST", headers: authHeaders(key), body: form };
  }
  const res = await postWithTimeout(fetchImpl, url, init, 60_000);
  if (!res.ok) throw await providerError(res, "Распознавание речи не удалось");
  const json = await res.json();
  const text = String(json?.text || "").trim();
  if (!text) throw new ApiError(422, "В записи не удалось разобрать речь", "stt_empty");
  return text.slice(0, 2000);
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

module.exports = {
  parseDrinkText,
  normalizeParsed,
  normalizeBaseUrl,
  transcribeAudio,
  decodeAudio,
  audioFormat,
  aiSettings,
  searchCanImages,
  TIERS,
  SYSTEM_PROMPT,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_STT_MODEL,
  MAX_AUDIO_BYTES,
};
