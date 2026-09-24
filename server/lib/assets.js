// Размеры и srcset для картинок из public/assets (scripts/optimize-assets.js пишет manifest.json).
// Для /uploads размеры хранятся в БД (drinks.image_width/height/srcset).
const fs = require("node:fs");
const path = require("node:path");

let manifest = {};
try {
  manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "public", "assets", "manifest.json"), "utf8"),
  );
} catch {
  manifest = {};
}

// Нормализация пути из БД к ключу манифеста.
function responsiveFor(imagePath) {
  const clean = String(imagePath || "").split("?")[0].replace(/^\//, "");
  if (!clean.startsWith("assets/")) return null;
  const entry = manifest[clean];
  if (!entry) return null;
  // srcset в абсолютных путях от корня — карточка может открываться с /d/:slug.
  const abs = (p) => (String(p).startsWith("/") ? p : `/${p}`);
  const srcset = String(entry.srcset || "")
    .split(",")
    .map((part) => {
      const [url, w] = part.trim().split(/\s+/);
      if (!url) return "";
      return w ? `${abs(url)} ${w}` : abs(url);
    })
    .filter(Boolean)
    .join(", ");
  return { width: entry.w || entry.width || 0, height: entry.h || entry.height || 0, srcset };
}

// Итоговые поля картинки для API: сначала колонки БД (загрузки), потом манифест ассетов.
function drinkImage(row) {
  const width = Number(row?.image_width || 0);
  const height = Number(row?.image_height || 0);
  if (width > 0 && height > 0) {
    return { imageWidth: width, imageHeight: height, imageSrcSet: String(row.image_srcset || "") };
  }
  const found = responsiveFor(row?.image_path);
  if (found && found.width > 0) {
    return { imageWidth: found.width, imageHeight: found.height, imageSrcSet: found.srcset };
  }
  return { imageWidth: 0, imageHeight: 0, imageSrcSet: "" };
}

module.exports = { responsiveFor, drinkImage };
