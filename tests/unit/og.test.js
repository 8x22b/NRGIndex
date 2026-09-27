const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveCanFile } = require("../../server/lib/og");

test("OG: картинка не может выйти за public/ или uploads/", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nrg-og-"));
  const publicDir = path.join(root, "public");
  const uploadsDir = path.join(root, "uploads");
  fs.mkdirSync(path.join(publicDir, "assets"), { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(root, "secret.png"), "x");
  fs.writeFileSync(path.join(publicDir, "assets", "can.png"), "x");
  fs.writeFileSync(path.join(uploadsDir, "up.png"), "x");
  const opts = { publicDir, uploadsDir };

  assert.equal(resolveCanFile("../secret.png", opts), null);
  assert.equal(resolveCanFile("/../secret.png", opts), null);
  assert.equal(resolveCanFile("assets/../../secret.png", opts), null);
  assert.equal(resolveCanFile("/uploads/../../secret.png", opts), null);
  assert.equal(resolveCanFile("assets/can.png", opts), path.join(publicDir, "assets", "can.png"));
  assert.equal(resolveCanFile("/uploads/up.png", opts), path.join(uploadsDir, "up.png"));
});
