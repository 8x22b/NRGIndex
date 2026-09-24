// Генерация WebP-вариантов для картинок из public/assets.
// node scripts/optimize-assets.js
// Для каждого PNG/JPG создаёт <name>.webp (полный размер) + <name>-640.webp + <name>-320.webp
// (только если исходник шире) и пишет public/assets/manifest.json с размерами для width/height в разметке.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const ASSETS = path.join(ROOT, "public", "assets");
const WIDTHS = [320, 640];
const QUALITY = 82;

async function main() {
  const files = fs
    .readdirSync(ASSETS)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort();
  const manifest = {};
  let srcBytes = 0;
  let outBytes = 0;

  for (const file of files) {
    const base = file.replace(/\.[^.]+$/, "");
    const srcPath = path.join(ASSETS, file);
    const srcStat = fs.statSync(srcPath);
    srcBytes += srcStat.size;
    const meta = await sharp(srcPath).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;

    // полный размер в webp
    const fullName = `${base}.webp`;
    const fullBuf = await sharp(srcPath).rotate().webp({ quality: QUALITY, effort: 6 }).toBuffer();
    fs.writeFileSync(path.join(ASSETS, fullName), fullBuf);
    outBytes += fullBuf.length;

    const variants = [];
    for (const vw of WIDTHS) {
      if (w <= vw) continue;
      const name = `${base}-${vw}.webp`;
      const buf = await sharp(srcPath)
        .rotate()
        .resize({ width: vw, withoutEnlargement: true })
        .webp({ quality: QUALITY, effort: 6 })
        .toBuffer();
      fs.writeFileSync(path.join(ASSETS, name), buf);
      outBytes += buf.length;
      const vm = await sharp(buf).metadata();
      variants.push({ file: `assets/${name}`, width: vw, height: vm.height || Math.round((h * vw) / w) });
    }
    // srcset от меньшего к большему + полный размер
    const srcset = [
      ...variants.map((v) => `${v.file} ${v.width}w`),
      `assets/${fullName} ${w}w`,
    ].join(", ");
    manifest[`assets/${file}`] = { w, h, src: `assets/${file}`, webp: `assets/${fullName}`, srcset, width: w, height: h };
    console.log(
      `${file}: ${w}x${h} ${(srcStat.size / 1024).toFixed(0)}KB -> webp ${(fullBuf.length / 1024).toFixed(0)}KB` +
        (variants.length ? ` + ${variants.map((v) => path.basename(v.file)).join(", ")}` : " (без даунскейлов)"),
    );
  }

  fs.writeFileSync(path.join(ASSETS, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `\nГотово: ${files.length} файлов, исходники ${(srcBytes / 1024 / 1024).toFixed(2)}MB -> webp ${(outBytes / 1024 / 1024).toFixed(2)}MB + manifest.json`,
  );

  // Второй проход: webp без PNG-близнеца (на них ссылаются напитки напрямую) —
  // только даунскейлы + запись в манифест, оригиналы не трогаем.
  const manifestPath = path.join(ASSETS, "manifest.json");
  const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const file of fs
    .readdirSync(ASSETS)
    .filter((f) => /\.webp$/i.test(f) && !/-(320|640)\.webp$/.test(f))
    .sort()) {
    const key = `assets/${file}`;
    if (existing[key]) continue;
    const srcPath = path.join(ASSETS, file);
    const meta = await sharp(srcPath).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    const variants = [];
    for (const vw of WIDTHS) {
      if (w <= vw) continue;
      const name = file.replace(/\.webp$/i, `-${vw}.webp`);
      await sharp(srcPath).rotate().resize({ width: vw, withoutEnlargement: true }).webp({ quality: QUALITY, effort: 6 }).toFile(path.join(ASSETS, name));
      variants.push(`assets/${name} ${vw}w`);
    }
    existing[key] = { w, h, src: key, webp: key, srcset: [...variants, `${key} ${w}w`].join(", "), width: w, height: h };
    console.log(`${file}: webp-оригинал ${w}x${h} оставлен, варианты: ${variants.length ? variants.join(", ") : "—"}`);
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(existing, null, 2)}\n`);
  console.log("Манифест дополнен webp-оригиналами.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
