const sharp = require("sharp");
const fs = require("node:fs");
const path = require("node:path");

const OG_W = 1200;
const OG_H = 630;

const TIER_COLORS = { S: "#ff5f5a", A: "#f1a653", B: "#e7d471", C: "#8ebd93", D: "#8093b7" };

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function resolveCanFile(imagePath, { publicDir, uploadsDir }) {
  if (!imagePath) return null;
  const clean = String(imagePath).split("?")[0];
  let file = null;
  if (clean.startsWith("/uploads/")) {
    file = path.join(uploadsDir, path.basename(clean));
  } else if (clean.startsWith("assets/")) {
    file = path.join(publicDir, clean);
  } else if (!clean.includes("://")) {
    file = path.join(publicDir, clean.replace(/^\//, ""));
  }
  if (!file || !fs.existsSync(file)) return null;
  if (!/\.(png|jpe?g|webp)$/i.test(file)) return null;
  return file;
}

// Карточка 1200x630: тёмный фон, акцентные круги, банка справа, текст слева.
async function renderOgCard({
  kicker = "NRG / INDEX",
  title = "NRG / INDEX",
  subtitle = "",
  bottom = "",
  tier = null,
  accentA = "#ff4f79",
  accentB = "#ff7448",
  imagePath = "",
  publicDir = "",
  uploadsDir = "",
}) {
  const tierColor = TIER_COLORS[tier] || accentA;
  const safeTitle = truncate(title, 42);
  const safeSubtitle = truncate(subtitle, 72);
  const safeBottom = truncate(bottom, 80);
  // Два размера заголовка: длинный — мельче.
  const titleSize = safeTitle.length > 24 ? 76 : 96;
  const titleLines = splitLines(safeTitle, safeTitle.length > 24 ? 16 : 12);

  const svg = `
<svg width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="halo" cx="78%" cy="46%" r="42%">
      <stop offset="0%" stop-color="${accentA}" stop-opacity="0.85"/>
      <stop offset="55%" stop-color="${accentB}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#141110" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1512"/>
      <stop offset="100%" stop-color="#0d0b0a"/>
    </linearGradient>
  </defs>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>
  <rect width="${OG_W}" height="${OG_H}" fill="url(#halo)"/>
  <circle cx="936" cy="290" r="196" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2"/>
  <circle cx="936" cy="290" r="150" fill="#ffffff" fill-opacity="0.10"/>
  <text x="72" y="108" font-family="Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="6" fill="${accentB}">${escapeXml(truncate(kicker, 34).toUpperCase())}</text>
  ${titleLines
    .map(
      (line, i) =>
        `<text x="72" y="${250 + i * (titleSize * 0.98)}" font-family="Georgia, serif" font-size="${titleSize}" font-weight="600" fill="#f2ede4">${escapeXml(line)}</text>`,
    )
    .join("")}
  ${
    safeSubtitle
      ? `<text x="72" y="${250 + (titleLines.length - 1) * (titleSize * 0.98) + 56}" font-family="Arial, sans-serif" font-size="30" letter-spacing="3" fill="#b9aca0">${escapeXml(safeSubtitle.toUpperCase())}</text>`
      : ""
  }
  <g>
    ${
      tier
        ? `<circle cx="104" cy="522" r="44" fill="${tierColor}"/><text x="104" y="540" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="52" font-weight="700" fill="#141110">${escapeXml(tier)}</text>
           <text x="168" y="516" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#f2ede4">ТИР ${escapeXml(tier)}</text>`
        : `<text x="72" y="522" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#f2ede4">ТИРЛИСТ ЭНЕРГЕТИКОВ</text>`
    }
    ${
      safeBottom
        ? `<text x="168" y="552" font-family="Arial, sans-serif" font-size="26" fill="#b9aca0">${escapeXml(safeBottom)}</text>`
        : ""
    }
    ${!tier && safeBottom ? `<text x="72" y="552" font-family="Arial, sans-serif" font-size="26" fill="#b9aca0">${escapeXml(safeBottom)}</text>` : ""}
  </g>
</svg>`;

  const layers = [{ input: Buffer.from(svg), top: 0, left: 0 }];
  const canFile = resolveCanFile(imagePath, { publicDir, uploadsDir });
  if (canFile) {
    try {
      const can = await sharp(canFile, { failOn: "none" })
        .rotate()
        .resize({ height: 460, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
      const meta = await sharp(can).metadata();
      layers.push({
        input: can,
        top: Math.max(0, Math.round((OG_H - (meta.height || 460)) / 2) - 10),
        left: Math.round(936 - (meta.width || 200) / 2),
      });
    } catch {
      // без банки — только текстовая карточка
    }
  }

  return sharp({
    create: { width: OG_W, height: OG_H, channels: 4, background: "#141110" },
  })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function splitLines(text, maxPerLine) {
  const words = String(text).split(" ").filter(Boolean);
  if (!words.length) return [""];
  const lines = [""];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (!last) {
      lines[lines.length - 1] = word;
    } else if (`${last} ${word}`.length <= maxPerLine * 2.2) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else if (lines.length < 2) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = truncate(`${lines[lines.length - 1]} ${word}`, Math.round(maxPerLine * 2.2));
    }
  }
  return lines.slice(0, 2);
}

module.exports = { renderOgCard, OG_W, OG_H, TIER_COLORS };
