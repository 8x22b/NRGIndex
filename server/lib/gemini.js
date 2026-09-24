const { ApiError } = require("./errors");
const { imageFromDataUrl } = require("./validate");

// Nano Banana 2 Lite — быстрая и дешёвая модель перерисовки картинок.
// Ключ бесплатный: aistudio.google.com → Get API key. Лимиты free tier
// для ~10 перерисовок в день хватает с запасом.
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-lite-image";
const GEMINI_TIMEOUT_MS = 120000;
const REDRAW_MAX_BYTES = 7 * 1024 * 1024;

const REDRAW_PROMPT =
  "Redraw this energy drink can as a clean studio product shot: " +
  "the exact same can with the same design, logo and text kept readable, " +
  "straight-on front view, vertically centered, pure white (#ffffff) background, " +
  "soft realistic shadow under the can, photorealistic.";

function geminiError(res, data) {
  const message = data?.error?.message || data?.error?.status || "";
  return new ApiError(res.status >= 500 ? 502 : res.status, `Gemini: HTTP ${res.status}${message ? ` — ${message}` : ""}`, "gemini_failed");
}

// Перерисовывает банку на белом фоне под прямым ракурсом.
// Принимает dataURL (своё фото, фото из ленты), возвращает dataURL результата.
async function redrawCanOnWhite(imageDataUrl, { key, model = DEFAULT_IMAGE_MODEL, fetchImpl = fetch } = {}) {
  if (!key) {
    throw new ApiError(503, "Ключ Gemini не настроен (админка → Настройки)", "gemini_not_configured");
  }
  const { mime, buffer } = imageFromDataUrl(imageDataUrl, { maxBytes: REDRAW_MAX_BYTES });
  let res;
  try {
    res = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model,
        input: [
          { type: "text", text: REDRAW_PROMPT },
          { type: "image", mime_type: mime, data: buffer.toString("base64") },
        ],
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
  const out = data?.output_image;
  if (!out?.data) throw new ApiError(502, "Gemini не вернул картинку", "gemini_no_image");
  const outMime = /image\/(png|jpeg|webp)/.test(out.mime_type || "") ? out.mime_type : "image/png";
  return { imageDataUrl: `data:${outMime};base64,${out.data}` };
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

module.exports = {
  DEFAULT_IMAGE_MODEL,
  redrawCanOnWhite,
  checkGeminiKey,
};
