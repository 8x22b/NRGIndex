// Починка метаданных старых загрузок: если у напитка картинка из /uploads без
// width/height/srcset, достраиваем -320/-640 рядом с файлом (пиксели не трогаем)
// и записываем метаданные в БД. Идемпотентно.
//   node scripts/repair-responsive.js
const config = require("../server/config");
const { openDatabase } = require("../server/db");
const { ensureUploadResponsive } = require("../server/lib/images");
const { touchContent } = require("../server/lib/content");

async function main() {
  const db = openDatabase(config.dbPath);
  const rows = db
    .prepare(
      "SELECT id, slug, image_path, image_width, image_height, image_srcset FROM drinks WHERE image_path LIKE '/uploads/%' ORDER BY id",
    )
    .all();
  const update = db.prepare(
    "UPDATE drinks SET image_width = ?, image_height = ?, image_srcset = ?, updated_at = datetime('now') WHERE id = ?",
  );
  let fixed = 0;
  let skipped = 0;
  for (const row of rows) {
    const hasMeta =
      Number(row.image_width) > 0 && Number(row.image_height) > 0 && String(row.image_srcset || "").trim();
    if (hasMeta) continue;
    const info = await ensureUploadResponsive(config.uploadsDir, row.image_path);
    if (!info) {
      console.log(`пропуск ${row.slug}: ${row.image_path}`);
      skipped += 1;
      continue;
    }
    update.run(info.width, info.height, info.srcset, row.id);
    console.log(`починен ${row.slug}: ${info.width}x${info.height} · ${info.srcset}`);
    fixed += 1;
  }
  if (fixed) touchContent(db);
  console.log(`готово: починено ${fixed}, пропущено ${skipped}, всего загрузок ${rows.length}`);
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
