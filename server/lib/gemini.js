const { ApiError } = require("./errors");
const { imageFromDataUrl } = require("./validate");

// Nano Banana 2 Lite — быстрая и дешёвая модель перерисовки картинок.
// Ключ бесплатный: aistudio.google.com → Get API key. Лимиты free tier
// для ~10 перерисовок в день хватает с запасом.
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-lite-image";
const GEMINI_TIMEOUT_MS = 120000;
const REDRAW_MAX_BYTES = 7 * 1024 * 1024;
// Модель распознавания ассортимента по фото полки: дешёвая мультимодальная,
// работает по тому же ключу Gemini, что и перерисовка.
const DEFAULT_VISION_MODEL = "gemini-3.8-flash";
const RECOGNIZE_MAX_BYTES = 7 * 1024 * 1024;
const RECOGNIZE_TIMEOUT_MS = 90_000;
// Примерная цена одной перерисовки, USD. Точного прайса у Interactions API нет —
// поправить в одном месте при смене модели.
// ponytail: константа вместо настройки; провайдер не отдаёт стоимость картинки.
const REDRAW_COST_USD = 0.01;

const REDRAW_PROMPT =
  "Redraw this energy drink can as a studio product photo: " +
  "keep the exact same can design, logo, colors and all text readable; " +
  "correct the viewing angle to a perfectly straight-on front view, " +
  "can vertical and centered, filling most of the frame; " +
  "solid pure green (#00FF00) chroma-key background, " +
  "even lighting, no shadows on the background, photorealistic.";

const ASSORTMENT_PROMPT = [
  "Ты смотришь на фото полки магазина с энергетическими напитками.",
  'Найди все банки энергетиков и верни СТРОГО JSON без пояснений и markdown: {"items":[{"brand":"","name":"","flavor":""}]}',
  "",
  "Правила:",
  "1. brand — торговая марка (Adrenaline Rush, Burn, Monster, Lit); name — полное название без вкуса (марка + линейка); если известна только марка, name = brand.",
  '2. flavor — вкус, только если читается на банке или точно известен для этого продукта; иначе "".',
  "3. Не выдумывай. Пропускай неэнергетики (вода, газировка, сок) и нечитаемые банки.",
  "4. Повторы одной банки оставляй один раз. Максимум 40 позиций.",
  "5. Можно исправлять опечатки и транслитерацию до официального написания.",
].join("\n");

function geminiError(res, data) {
  const message = data?.error?.message || data?.error?.status || "";
  return new ApiError(res.status >= 500 ? 502 : res.status, `Gemini: HTTP ${res.status}${message ? ` — ${message}` : ""}`, "gemini_failed");
}

// Картинка в ответе Interactions API лежит НЕ в output_image (это аксессор SDK),
// а в steps[].content[]: { type: "image", data: base64, mime_type }.
// Дополнительно держим output_image и candidates[].parts[].inlineData на случай
// других форм ответа — лишь бы base64 не потерять.
function extractImage(data) {
  for (const step of data?.steps || []) {
    for (const item of step?.content || []) {
      if (item?.type === "image" && typeof item?.data === "string" && item.data.length > 0) {
        return { data: item.data, mime: item.mime_type };
      }
    }
  }
  const out = data?.output_image;
  if (typeof out?.data === "string" && out.data.length > 0) return { data: out.data, mime: out.mime_type };
  for (const part of data?.candidates?.[0]?.content?.parts || []) {
    const inline = part?.inlineData || part?.inline_data;
    if (typeof inline?.data === "string" && inline.data.length > 0) {
      return { data: inline.data, mime: inline.mimeType || inline.mime_type };
    }
  }
  return null;
}

// Текст ответа Interactions API: steps[].content[] + candidates[0].content.parts[].
function extractText(data) {
  const texts = [];
  for (const step of data?.steps || []) {
    for (const item of step?.content || []) {
      if (item?.type === "text" && item?.text) texts.push(item.text);
    }
  }
  for (const part of data?.candidates?.[0]?.content?.parts || []) {
    if (part?.text) texts.push(part.text);
  }
  return texts;
}

// HTTP 200, но картинки нет: тащим причину из ответа вместо глухой заглушки —
// текст из steps/candidates, blockReason, status, finishReason; в крайнем случае
// показываем поля ответа, чтобы было видно реальную форму JSON.
function noImageError(data) {
  const text = extractText(data).join(" ").trim().slice(0, 300);
  if (text) return new ApiError(502, `Gemini не вернул картинку: ${text}`, "gemini_no_image");
  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) return new ApiError(502, `Gemini отклонил запрос: ${blocked}`, "gemini_blocked");
  if (data?.status && data.status !== "completed") {
    return new ApiError(502, `Gemini не завершил задачу: ${data.status}`, "gemini_no_image");
  }
  const finish = data?.candidates?.[0]?.finishReason;
  if (finish && finish !== "STOP") {
    return new ApiError(502, `Gemini оборвал генерацию: ${finish}`, "gemini_no_image");
  }
  const keys = data && typeof data === "object" ? Object.keys(data).join(", ") : "";
  return new ApiError(502, `Gemini не вернул картинку${keys ? ` (поля ответа: ${keys})` : ""}`, "gemini_no_image");
}

// Перерисовывает банку на зелёном хромакее под прямым ракурсом.
// Принимает dataURL (своё фото, фото из ленты), возвращает dataURL результата.
async function redrawCanOnWhite(imageDataUrl, { key, model = DEFAULT_IMAGE_MODEL, prompt, fetchImpl = fetch } = {}) {
  if (!key) {
    throw new ApiError(503, "Ключ Gemini не настроен (админка → Настройки)", "gemini_not_configured");
  }
  const { mime, buffer } = imageFromDataUrl(imageDataUrl, { maxBytes: REDRAW_MAX_BYTES });
  const startedAt = Date.now();
  let res;
  try {
    res = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model,
        input: [
          { type: "text", text: prompt || REDRAW_PROMPT },
          { type: "image", mime_type: mime, data: buffer.toString("base64") },
        ],
        response_format: { type: "image", mime_type: "image/jpeg" },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new ApiError(504, "Gemini не ответил вовремя", "gemini_timeout");
    throw new ApiError(502, "Не удалось связаться с Gemini", "gemini_failed");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw geminiError(res, data);
  const found = extractImage(data);
  if (!found) throw noImageError(data);
  const outMime = /image\/(png|jpeg|webp)/.test(found.mime || "") ? found.mime : "image/png";
  const meta = data?.usage_metadata || data?.usageMetadata || {};
  return {
    imageDataUrl: `data:${outMime};base64,${found.data}`,
    usage: {
      promptTokens: Number(meta.promptTokenCount ?? meta.prompt_token_count ?? 0) || 0,
      completionTokens: Number(meta.candidatesTokenCount ?? meta.candidates_token_count ?? 0) || 0,
      totalTokens: Number(meta.totalTokenCount ?? meta.total_token_count ?? 0) || 0,
      costUsd: REDRAW_COST_USD,
      ms: Date.now() - startedAt,
    },
  };
}

// Дешёвая проверка ключа и модели: models.get ничего не генерирует,
// квоту картинок не тратит. 404 — нет такой модели, 400/403 — ключ.
async function checkGeminiKey({ key, model = DEFAULT_IMAGE_MODEL, fetchImpl = fetch } = {}) {
  if (!key) throw new ApiError(503, "Ключ Gemini не настроен (админка → Настройки)", "gemini_not_configured");
  const startedAt = Date.now();
  let res;
  try {
    res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
      {
        headers: { "x-goog-api-key": key, accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch (error) {
    if (error?.name === "AbortError") throw new ApiError(504, "Gemini не ответил вовремя", "gemini_timeout");
    throw new ApiError(502, "Не удалось связаться с Gemini", "gemini_failed");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw geminiError(res, data);
  return { ms: Date.now() - startedAt, model: data?.name || model };
}

// Чистка распознанного ассортимента: обрезаем поля, чиним пустые brand/name,
// убираем повторы и мусор, ограничиваем список.
function normalizeAssortment(raw) {
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  const seen = new Set();
  const items = [];
  for (const entry of source) {
    let brand = String(entry?.brand || "").trim().slice(0, 80);
    let name = String(entry?.name || "").trim().slice(0, 120);
    const flavor = String(entry?.flavor || "").trim().slice(0, 160);
    if (!name) name = brand;
    if (!brand) brand = name.slice(0, 80);
    if (!brand && !name) continue;
    const key = `${brand}|${name}|${flavor}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ brand, name, flavor });
    if (items.length >= 40) break;
  }
  return items;
}

// Текст модели → JSON: снимаем ```json-обёртки, берём первый объект или массив.
function parseAssortment(text) {
  const raw = String(text || "").replace(/```[a-z]*/gi, " ").trim();
  const objectStart = raw.indexOf("{");
  const arrayStart = raw.indexOf("[");
  let slice = "";
  if (objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart)) {
    slice = raw.slice(objectStart, raw.lastIndexOf("}") + 1);
  } else if (arrayStart >= 0) {
    slice = raw.slice(arrayStart, raw.lastIndexOf("]") + 1);
  }
  try {
    return JSON.parse(slice);
  } catch {
    throw new ApiError(502, "Gemini вернул не JSON со списком банок", "gemini_bad_assortment");
  }
}

// Фото полки магазина → список банок энергетиков. Ключ и модель — как у перерисовки.
async function recognizeAssortment(imageDataUrl, { key, model = DEFAULT_VISION_MODEL, fetchImpl = fetch } = {}) {
  if (!key) {
    throw new ApiError(503, "Ключ Gemini не настроен (админка → Настройки)", "gemini_not_configured");
  }
  const { mime, buffer } = imageFromDataUrl(imageDataUrl, { maxBytes: RECOGNIZE_MAX_BYTES });
  const startedAt = Date.now();
  let res;
  try {
    res = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model,
        input: [
          { type: "text", text: ASSORTMENT_PROMPT },
          { type: "image", mime_type: mime, data: buffer.toString("base64") },
        ],
      }),
      signal: AbortSignal.timeout(RECOGNIZE_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new ApiError(504, "Gemini не ответил вовремя", "gemini_timeout");
    throw new ApiError(502, "Не удалось связаться с Gemini", "gemini_failed");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw geminiError(res, data);
  const text = extractText(data).join("\n").trim();
  if (!text) throw new ApiError(502, "Gemini не вернул список банок", "gemini_no_assortment");
  const items = normalizeAssortment(parseAssortment(text));
  const meta = data?.usage_metadata || data?.usageMetadata || {};
  return {
    items,
    usage: {
      promptTokens: Number(meta.promptTokenCount ?? meta.prompt_token_count ?? 0) || 0,
      completionTokens: Number(meta.candidatesTokenCount ?? meta.candidates_token_count ?? 0) || 0,
      totalTokens: Number(meta.totalTokenCount ?? meta.total_token_count ?? 0) || 0,
      costUsd: 0,
      ms: Date.now() - startedAt,
    },
  };
}

module.exports = {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VISION_MODEL,
  REDRAW_PROMPT,
  ASSORTMENT_PROMPT,
  normalizeAssortment,
  recognizeAssortment,
  redrawCanOnWhite,
  checkGeminiKey,
};
