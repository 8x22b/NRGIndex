const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { imageFromDataUrl } = require("./validate");

function saveDataUrlImage(uploadsDir, dataUrl, maxBytes) {
  const { ext, buffer } = imageFromDataUrl(dataUrl, { maxBytes });
  fs.mkdirSync(uploadsDir, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, name), buffer, { mode: 0o644 });
  return `/uploads/${name}`;
}

module.exports = { saveDataUrlImage };
