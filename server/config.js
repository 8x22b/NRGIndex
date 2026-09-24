const path = require("node:path");

const ROOT = path.join(__dirname, "..");

const config = {
  root: ROOT,
  publicDir: process.env.PUBLIC_DIR || path.join(ROOT, "public"),
  dbPath: process.env.DB_PATH || path.join(ROOT, "data", "nrgindex.db"),
  uploadsDir: process.env.UPLOADS_DIR || path.join(ROOT, "data", "uploads"),
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  trustProxy: process.env.TRUST_PROXY || "false",
  cookieSecure: process.env.COOKIE_SECURE || "auto",
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 90),
  sessionIdleDays: Number(process.env.SESSION_IDLE_DAYS || 30),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 4 * 1024 * 1024),
  jsonLimit: process.env.JSON_LIMIT || "8mb",
  siteUrl: process.env.SITE_URL || "",
};

module.exports = config;
