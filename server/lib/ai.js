const { ApiError, badRequest } = require("./errors");
const { getSetting } = require("../db");
const { proxiedFetch } = require("./proxy");

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
  const proxyUrl = getSetting(db, "ai_proxy_url", "") || process.env.AI_PROXY_URL || "";
  const sttKey = getSetting(db, "openrouter_key", "") || process.env.OPENROUTER_KEY || "";
  const parseKey = getSetting(db, "parse_api_key", "") || getSetting(db, "text_api_key", "") || process.env.PARSE_API_KEY || sttKey;
  const parseBaseUrl = getSetting(db, "parse_base_url", "") || getSetting(db, "text_base_url", "") || process.env.PARSE_BASE_URL || getSetting(db, "ai_base_url", "") || process.env.AI_BASE_URL || DEFAULT_BASE_URL;
  return {
    key: sttKey,
    sttKey,
    parseKey,
    model: getSetting(db, "openrouter_model", "") || DEFAULT_MODEL,
    sttModel: getSetting(db, "stt_model", "") || DEFAULT_STT_MODEL,
    baseUrl: parseBaseUrl,
    parseBaseUrl,
    textApiKey: parseKey,
    textBaseUrl: parseBaseUrl,
    sttBaseUrl: DEFAULT_BASE_URL,
    proxyUrl,
    // все запросы к ИИ-провайдеру идут через этот fetch: прозрачно, с прокси или без
    fetchImpl: proxiedFetch(proxyUrl),
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
    const viaProxy = String(error?.message || "").startsWith("прокси:");
    throw new ApiError(
      502,
      viaProxy
        ? `Не удалось связаться с ИИ через ${String(error.message).slice(0, 160)}`
        : "Не удалось связаться с ИИ-провайдером",
      "ai_failed",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function providerFailureDetail(res, maxLength = 200) {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return "";
  }
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  try {
    const json = JSON.parse(trimmed);
    const fromJson = json?.error?.message || json?.error || json?.message || json?.detail;
    if (fromJson) return String(fromJson).replace(/\s+/g, " ").slice(0, maxLength);
  } catch {
    /* тело не JSON */
  }
  const withoutTags = trimmed
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return withoutTags.slice(0, maxLength);
}

async function providerError(res, what) {
  const detail = await providerFailureDetail(res);
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

async function parseDrinkText(text, { key, parseKey, model, baseUrl, parseBaseUrl, fetchImpl = fetch } = {}) {
  const requestKey = parseKey || key;
  const requestBaseUrl = parseBaseUrl || baseUrl || DEFAULT_BASE_URL;
  requireKey(requestKey);
  const userText = String(text || "").slice(0, 4000);
  const parsed = await requestParsedJson(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
    { key: requestKey, model, baseUrl: requestBaseUrl, fetchImpl },
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

const STT_CLEANUP_PROMPT = [
  "Ты аккуратно редактируешь результат распознавания русской речи.",
  "Исправь только очевидные ошибки распознавания, регистр и пунктуацию.",
  "Сохрани все исходные слова и смысл. Не добавляй факты, названия, оценки или слова, которых нет в исходнике.",
  "Если фраза неясна, оставь сомнительный фрагмент как есть. Верни только JSON без markdown: {\\\"text\\\":\\\"...\\\"}.",
].join("\n");

async function refineTranscription(text, { parseKey, textApiKey, parseBaseUrl, textBaseUrl, parseModel, model, fetchImpl = fetch } = {}) {
  const key = parseKey || textApiKey;
  if (!key) return text;
  const baseUrl = parseBaseUrl || textBaseUrl || DEFAULT_BASE_URL;
  const result = await requestParsedJson(
    [
      { role: "system", content: STT_CLEANUP_PROMPT },
      { role: "user", content: String(text).slice(0, 2000) },
    ],
    { key, model: parseModel || model || DEFAULT_MODEL, baseUrl, fetchImpl },
  );
  const cleaned = String(result?.text ?? "").trim();
  if (!cleaned) throw new ApiError(502, "Модель исправления STT вернула пустой текст", "ai_bad_response");
  return cleaned.slice(0, 2000);
}

async function transcribeAudio(buffer, mimeType, { key, sttKey, sttModel, sttBaseUrl, baseUrl, parseKey, textApiKey, parseBaseUrl, textBaseUrl, parseModel, model: textModel, fetchImpl = fetch } = {}) {
  key = sttKey || key;
  const effectiveBaseUrl = sttBaseUrl || baseUrl || DEFAULT_BASE_URL;
  requireKey(key);
  const format = audioFormat(mimeType);
  const sttModelEffective = sttModel || DEFAULT_STT_MODEL;
  const url = `${effectiveBaseUrl}/audio/transcriptions`;
  let init;
  if (isOpenRouter(effectiveBaseUrl)) {
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(key) },
      body: JSON.stringify({
        model: sttModelEffective,
        input_audio: { data: buffer.toString("base64"), format },
        language: "ru",
        temperature: 0,
      }),
    };
  } else {
    // OpenAI-совместимые провайдеры принимают multipart/form-data
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: String(mimeType).split(";")[0] }), `voice.${format}`);
    form.append("model", sttModelEffective);
    form.append("language", "ru");
    form.append("temperature", "0");
    init = { method: "POST", headers: authHeaders(key), body: form };
  }
  const res = await postWithTimeout(fetchImpl, url, init, 60_000);
  if (!res.ok) throw await providerError(res, "Распознавание речи не удалось");
  const json = await res.json();
  const text = String(json?.text || "").trim();
  if (!text) throw new ApiError(422, "В записи не удалось разобрать речь", "stt_empty");
  return refineTranscription(text.slice(0, 2000), {
    parseKey,
    textApiKey,
    parseBaseUrl,
    textBaseUrl,
    parseModel,
    model: parseModel || textModel,
    fetchImpl,
  });
}

const PHOTO_UA = "NRGIndex/2.0 (energy drink tier list)";
const PHOTO_TIMEOUT_MS = 8000;
const PHOTO_LIMIT = 24;
const RASTER_MIME = /^image\/(jpeg|png|webp)$/;

// Разбивает поля на уникальные слова без спецсимволов поискового синтаксиса.
function photoTerms(...parts) {
  const seen = new Set();
  const words = [];
  for (const word of parts.join(" ").split(/\s+/)) {
    const clean = word.replace(/[^\p{L}\p{N}'.-]/gu, "").slice(0, 40);
    const key = clean.toLowerCase();
    if (clean.length < 2 || seen.has(key)) continue;
    seen.add(key);
    words.push(clean);
  }
  return words.slice(0, 12).join(" ");
}

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(url, {
    headers: { "user-agent": PHOTO_UA, accept: "application/json" },
    signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const lowerWords = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);

// Open Food Facts: фронтальные фото упаковок. Фильтр категории режет слишком много
// (у половины банок её нет), поэтому ищем шире, отсекаем чужие бренды и
// поднимаем выше те, где в названии совпали слова названия/вкуса.
async function searchOpenFoodFacts(terms, brand, fetchImpl) {
  const data = await fetchJson(
    fetchImpl,
    `https://search.openfoodfacts.org/search?q=${encodeURIComponent(terms)}` +
      "&page_size=30&fields=code,product_name,brands,image_front_url",
  );
  const brandWords = lowerWords(brand);
  const wanted = new Set(lowerWords(terms).filter((word) => !brandWords.includes(word)));
  return (data?.hits || [])
    .filter((hit) => /^https:\/\/images\.openfoodfacts\.org\//.test(hit?.image_front_url || ""))
    .map((hit, order) => {
      const brands = [].concat(hit.brands || []).join(", ");
      const name = String(hit.product_name || "");
      const nameWords = lowerWords(name);
      const brandMatches = lowerWords(brands).filter((word) => brandWords.includes(word)).length;
      const score = nameWords.filter((word) => wanted.has(word)).length + brandMatches * 3;
      return { hit, brands, name, score, order };
    })
    .filter(({ brands }) => {
      if (!brandWords.length) return true;
      const have = lowerWords(brands);
      return brandWords.some((word) => have.includes(word));
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ hit, brands, name }) => ({
      url: hit.image_front_url,
      title: [brands, name].filter(Boolean).join(" · ").slice(0, 120),
      source: "openfoodfacts",
    }));
}

// Слова в названии/описании файла, намекающие на стоковый снимок на белом/прозрачном фоне.
const STOCK_HINT = /white[\s_-]*background|transparent|isolated|cut[\s_-]*out|packshot|product[\s_-]*shot|на[\s_]*белом|прозрачн/i;

// Отдельные «стоковые» запросы в Commons (filemime:png, "white background") проверял —
// тянут мусор (скриншоты, ожоги), а OR там ломает выдачу. Поэтому один запрос,
// а сток определяет браузер по пикселям рамки; stockHint только поднимает кандидатов.
async function searchWikimedia(terms, fetchImpl) {
  const data = await fetchJson(
    fetchImpl,
    "https://commons.wikimedia.org/w/api.php?action=query&format=json" +
      `&generator=search&gsrsearch=${encodeURIComponent(`${terms} energy drink`)}` +
      "&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url%7Cmime&iiurlwidth=480",
  );
  return Object.values(data?.query?.pages || {})
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((page) => ({ page, info: page?.imageinfo?.[0] }))
    .filter(({ info }) => info && RASTER_MIME.test(info.mime || ""))
    .map(({ page, info }, order) => {
      const title = String(page.title || "").replace(/^File:/, "").replace(/\.\w+$/, "").slice(0, 120);
      const wanted = new Set(lowerWords(terms));
      const relevance = lowerWords(title).filter((word) => wanted.has(word)).length;
      return {
        url: info.thumburl || info.url,
        title,
        source: "wikimedia",
        // PNG на Commons почти всегда вырезка с альфой; плюс явные слова в названии
        stockHint: info.mime === "image/png" || STOCK_HINT.test(page.title || ""),
        relevance,
        order,
      };
    })
    .filter((item) => /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(item.url));
}



/**
 * Ищет фото банки по бренду, названию и вкусу.
 * Принимает строку (старый формат) или { brand, name, flavor }.
 * Источники опрашиваются параллельно; упавший источник не валит весь поиск.
 */
async function searchCanImages(query, { fetchImpl = fetch } = {}) {
  const fields = typeof query === "string" ? { name: query } : query || {};
  const product = photoTerms(fields.brand || "", fields.name || "");
  const full = photoTerms(fields.brand || "", fields.name || "", fields.flavor || "");
  if (!full) return [];

  const settled = await Promise.allSettled([
    searchOpenFoodFacts(full, fields.brand || "", fetchImpl),
    searchWikimedia(product || full, fetchImpl),
  ]);
  if (settled.every((item) => item.status === "rejected")) {
    throw new ApiError(502, "Поиск фото недоступен", "photo_search_failed");
  }
  const seen = new Map();
  const results = [];
  for (const item of settled) {
    if (item.status !== "fulfilled") continue;
    for (const hit of item.value) {
      if (!hit?.url) continue;
      const canonicalUrl = String(hit.url).split("?")[0];
      const clean = { url: hit.url, title: hit.title, source: hit.source, stockHint: Boolean(hit.stockHint), relevance: Number(hit.relevance) || 0 };
      const prev = seen.get(canonicalUrl);
      if (prev) {
        prev.stockHint ||= clean.stockHint;
        continue;
      }
      seen.set(canonicalUrl, clean);
      results.push(clean);
    }
  }
  // Кандидаты в сток — вперёд. Окончательно фон проверяет браузер по пикселям рамки,
  // а stockHint лишь поднимает вероятные варианты, чтобы они влезли в лимит.
  return results
    .map((hit, order) => ({ hit, order }))
    .sort((a, b) => Number(b.hit.stockHint) - Number(a.hit.stockHint) || a.order - b.order)
    .map(({ hit }) => hit)
    .slice(0, PHOTO_LIMIT);
}

module.exports = {
  parseDrinkText,
  normalizeParsed,
  normalizeBaseUrl,
  providerFailureDetail,
  transcribeAudio,
  refineTranscription,
  decodeAudio,
  audioFormat,
  aiSettings,
  searchCanImages,
  photoTerms,
  TIERS,
  SYSTEM_PROMPT,
  STT_CLEANUP_PROMPT,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_STT_MODEL,
  MAX_AUDIO_BYTES,
};
