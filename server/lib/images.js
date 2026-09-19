const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const sharp = require("sharp");
const { imageFromDataUrl } = require("./validate");

const MAX_SIDE = 1000;
const PAD = 12;
const BG = { TOL: 54, BRIGHT_MIN: 118, NEUTRAL_MAX: 36, MIN_SHARE: 0.01 };
const FALLBACK_ACCENT = ["#ff4f79", "#ff7448"];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function median(values) {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function removeBorderBackground(px, width, height) {
  const border = [];
  for (let x = 0; x < width; x += 2) border.push(x * 4, ((height - 1) * width + x) * 4);
  for (let y = 0; y < height; y += 2) border.push(y * width * 4, (y * width + width - 1) * 4);

  const channels = [[], [], []];
  for (const offset of border) {
    if (px[offset + 3] < 16) continue;
    channels[0].push(px[offset]);
    channels[1].push(px[offset + 1]);
    channels[2].push(px[offset + 2]);
  }
  if (!channels[0].length) return false;
  const bg = [median(channels[0]), median(channels[1]), median(channels[2])];

  const isBgish = (offset) => {
    if (px[offset + 3] < 16) return true;
    const r = px[offset];
    const g = px[offset + 1];
    const b = px[offset + 2];
    if (Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < BG.TOL) return true;
    return (
      Math.min(r, g, b) > BG.BRIGHT_MIN && Math.max(r, g, b) - Math.min(r, g, b) < BG.NEUTRAL_MAX
    );
  };

  const size = width * height;
  const mask = new Uint8Array(size);
  const stack = [];
  const seed = (x, y) => {
    const index = y * width + x;
    if (!mask[index] && isBgish(index * 4)) {
      mask[index] = 1;
      stack.push(index);
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }
  while (stack.length) {
    const index = stack.pop();
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0 && !mask[index - 1] && isBgish((index - 1) * 4)) {
      mask[index - 1] = 1;
      stack.push(index - 1);
    }
    if (x < width - 1 && !mask[index + 1] && isBgish((index + 1) * 4)) {
      mask[index + 1] = 1;
      stack.push(index + 1);
    }
    if (y > 0 && !mask[index - width] && isBgish((index - width) * 4)) {
      mask[index - width] = 1;
      stack.push(index - width);
    }
    if (y < height - 1 && !mask[index + width] && isBgish((index + width) * 4)) {
      mask[index + width] = 1;
      stack.push(index + width);
    }
  }

  let bgShare = 0;
  for (let index = 0; index < size; index++) bgShare += mask[index];
  bgShare /= size;
  if (bgShare < BG.MIN_SHARE) return false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (mask[index]) {
        px[index * 4 + 3] = 0;
        continue;
      }
      const touchesMask =
        (x > 0 && mask[index - 1]) ||
        (x < width - 1 && mask[index + 1]) ||
        (y > 0 && mask[index - width]) ||
        (y < height - 1 && mask[index + width]);
      if (touchesMask && isBgish(index * 4)) px[index * 4 + 3] = 0;
    }
  }
  return true;
}

function contentBox(px, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function rgbToHsl(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const delta = max - min;
  let h = 0;
  let s = 0;
  if (delta) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === rr) h = ((gg - bb) / delta + (gg < bb ? 6 : 0)) / 6;
    else if (max === gg) h = ((bb - rr) / delta + 2) / 6;
    else h = ((rr - gg) / delta + 4) / 6;
  }
  return [h, s, l];
}

function hslToHex(h, s, l) {
  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (value) =>
    Math.round(clamp(value, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function accentFromPixels(px, width, height) {
  const samples = [];
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  for (let i = 0; i < width * height; i += 2) {
    const offset = i * 4;
    if (px[offset + 3] < 160) continue;
    const r = px[offset];
    const g = px[offset + 1];
    const b = px[offset + 2];
    rSum += r;
    gSum += g;
    bSum += b;
    count += 1;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l > 0.08 && l < 0.95 && s > 0.12) samples.push([h, s, l]);
  }
  if (!count) return [...FALLBACK_ACCENT];

  let h;
  let s;
  let l;
  if (samples.length >= 24) {
    samples.sort((a, b) => b[1] - a[1]);
    const top = samples.slice(0, Math.max(12, Math.floor(samples.length * 0.5)));
    let x = 0;
    let y = 0;
    let sSum = 0;
    let lSum = 0;
    for (const [hh, ss, ll] of top) {
      x += Math.cos(hh * Math.PI * 2);
      y += Math.sin(hh * Math.PI * 2);
      sSum += ss;
      lSum += ll;
    }
    h = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
    s = sSum / top.length;
    l = lSum / top.length;
  } else {
    [h, s, l] = rgbToHsl(rSum / count, gSum / count, bSum / count);
    s = Math.max(s, 0.35);
  }

  const accentA = hslToHex(h, clamp(s, 0.45, 0.92), clamp(l, 0.45, 0.6));
  const accentB = hslToHex((h + 0.05) % 1, clamp(s * 0.9, 0.4, 0.9), clamp(l * 0.68, 0.2, 0.4));
  return [accentA, accentB];
}

async function processImageBuffer(buffer) {
  const base = sharp(buffer, { failOn: "error" }).rotate();
  const meta = await base.metadata();
  let pipeline = base;
  if ((meta.width || 0) > MAX_SIDE || (meta.height || 0) > MAX_SIDE) {
    pipeline = pipeline.resize({
      width: MAX_SIDE,
      height: MAX_SIDE,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  removeBorderBackground(data, info.width, info.height);
  const accent = accentFromPixels(data, info.width, info.height);
  const box = contentBox(data, info.width, info.height);
  let out = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (box) out = out.extract(box);
  out = out.extend({
    top: PAD,
    bottom: PAD,
    left: PAD,
    right: PAD,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  const png = await out.png({ compressionLevel: 9 }).toBuffer();
  return { buffer: png, accent };
}

async function saveProcessedImage(uploadsDir, dataUrl, maxBytes) {
  const { buffer } = imageFromDataUrl(dataUrl, { maxBytes });
  const processed = await processImageBuffer(buffer);
  fs.mkdirSync(uploadsDir, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}.png`;
  fs.writeFileSync(path.join(uploadsDir, name), processed.buffer, { mode: 0o644 });
  return { path: `/uploads/${name}`, accent: processed.accent };
}

async function reprocessStoredImage(uploadsDir, imagePath) {
  const name = path.basename(String(imagePath || ""));
  if (!/^[a-z0-9-]+\.(png|jpe?g|webp)$/i.test(name)) return null;
  const source = path.join(uploadsDir, name);
  if (!fs.existsSync(source)) return null;
  const processed = await processImageBuffer(fs.readFileSync(source));
  const newName = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}.png`;
  fs.writeFileSync(path.join(uploadsDir, newName), processed.buffer, { mode: 0o644 });
  return { path: `/uploads/${newName}`, accent: processed.accent };
}

module.exports = {
  saveProcessedImage,
  reprocessStoredImage,
  processImageBuffer,
  accentFromPixels,
  removeBorderBackground,
};
