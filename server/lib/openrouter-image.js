const fs = require("node:fs");
const path = require("node:path");
const { ApiError } = require("./errors");
const { imageFromDataUrl } = require("./validate");

// OpenRouter Image API: POST {base}/images. Отдельная модель генерации картинок;
// рисует сразу на прозрачном фоне, поэтому Chroma-key и вырезка не нужны.
const DEFAULT_OPENROUTER_IMAGE_MODEL = "openai/gpt-image-2.5-sunburst";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const IMAGE_TIMEOUT_MS = 180_000;
const MAX_SOURCE_BYTES = 7 * 1024 * 1024;
const TEMPLATE_PATH = path.join(__dirname, "..", "assets", "can-template.jpg");

// Шаблон — эталон ракурса и композиции: у модели меняется только рисунок,
// блики и засветы запрещены, фон сразу альфа.
const REDRAW_PROMPT = [
  "Redraw the energy drink can from the first reference image as a clean studio packshot.",
  "Use the second reference image as the exact template for the camera angle and composition:",
  "straight-on eye-level front view, can vertical and centered, filling most of the frame, same proportions and rim shape.",
  "Replace only the can artwork with the design from the first image:",
  "keep its logo, colors and all text exact, readable and undistorted.",
  "Matte surface: no glossy highlights, no specular reflections, no glare, no light streaks.",
  "Output the can cut out on a fully transparent background (alpha), with no shadow and no backdrop.",
].join(" ");

let templateCache = null;

function templateDataUrl() {
  if (!templateCache) {
    let buffer;
    try {
      buffer = fs.readFileSync(TEMPLATE_PATH);
    } catch {
      throw new ApiError(503, "Шаблон перерисовки не найден на сервере (server/assets/can-template.jpg)", "template_missing");
    }
    templateCache = `data:image/jpeg;base64,${buffer.toString("base64")}`;
  }
  return templateCache;
}

const TEMPLATE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

// Шаблон из админки лежит в uploads как есть: обработка фона калечит
// тёмную банку на тёмном фоне, поэтому сохраняем и отдаём сырые байты.
function templateDataUrlFromUpload(uploadsDir, storedPath) {
  const name = path.basename(String(storedPath || ""));
  const mime = TEMPLATE_MIME[path.extname(name).toLowerCase()];
  let buffer = null;
  if (name && mime) {
    try {
      buffer = fs.readFileSync(path.join(uploadsDir, name));
    } catch {
      buffer = null;
    }
  }
  if (!buffer?.length) {
    throw new ApiError(503, "Фото-шаблон не найден — загрузите заново или сбросьте в админке", "template_missing");
  }
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function providerDetail(data, maxLength = 200) {
  const raw = data?.error?.message || data?.error || data?.message || data?.detail || "";
  return String(raw).replace(/\s+/g, " ").slice(0, maxLength);
}

function providerError(res, data) {
  const detail = providerDetail(data);
  return new ApiError(
    res.status >= 500 ? 502 : res.status,
    `OpenRouter: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
    "openrouter_failed",
  );
}

// Принимает dataURL исходного фото, возвращает dataURL PNG с альфой и usage с ценой.
async function redrawCanOnTransparent(imageDataUrl, { key, model = DEFAULT_OPENROUTER_IMAGE_MODEL, baseUrl = OPENROUTER_BASE_URL, prompt, template, fetchImpl = fetch } = {}) {
  if (!key) {
    throw new ApiError(503, "OpenRouter-ключ не настроен (админка → Настройки)", "openrouter_not_configured");
  }
  const { mime, buffer } = imageFromDataUrl(imageDataUrl, { maxBytes: MAX_SOURCE_BYTES });
  const startedAt = Date.now();
  let res;
  try {
    res = await fetchImpl(`${baseUrl}/images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-Title": "NRG/INDEX",
      },
      body: JSON.stringify({
        model,
        prompt: prompt || REDRAW_PROMPT,
        aspect_ratio: "9:16",
        quality: "low",
        background: "transparent",
        output_format: "png",
        input_references: [
          { type: "image_url", image_url: { url: `data:${mime};base64,${buffer.toString("base64")}` } },
          { type: "image_url", image_url: { url: template || templateDataUrl() } },
        ],
      }),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new ApiError(504, "OpenRouter не ответил вовремя", "openrouter_timeout");
    }
    throw new ApiError(502, "Не удалось связаться с OpenRouter", "openrouter_failed");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) throw providerError(res, data);
  const image = data?.data?.[0];
  if (!image?.b64_json) {
    const detail = providerDetail(data);
    throw new ApiError(502, `OpenRouter не вернул картинку${detail ? `: ${detail}` : ""}`, "openrouter_no_image");
  }
  const outMime = /image\/(png|jpeg|webp)/.test(image.media_type || "") ? image.media_type : "image/png";
  const usage = data?.usage || {};
  return {
    imageDataUrl: `data:${outMime};base64,${image.b64_json}`,
    usage: {
      promptTokens: Number(usage.prompt_tokens ?? 0) || 0,
      completionTokens: Number(usage.completion_tokens ?? 0) || 0,
      totalTokens: Number(usage.total_tokens ?? 0) || 0,
      // Точная стоимость от OpenRouter: ответ содержит usage.cost (USD).
      costUsd: Number(usage.cost ?? 0) || 0,
      ms: Date.now() - startedAt,
    },
  };
}

module.exports = {
  DEFAULT_OPENROUTER_IMAGE_MODEL,
  OPENROUTER_BASE_URL,
  REDRAW_PROMPT,
  redrawCanOnTransparent,
  templateDataUrl,
  templateDataUrlFromUpload,
};
