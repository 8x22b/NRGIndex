const config = require("./config");
const { openDatabase } = require("./db");
const { createApp } = require("./app");

const db = openDatabase(config.dbPath);
const app = createApp({ db, config });

const server = app.listen(config.port, config.host, () => {
  console.log(`[nrgindex] listening on http://${config.host}:${config.port}`);
  console.log(`[nrgindex] db: ${config.dbPath}`);
  console.log(`[nrgindex] uploads: ${config.uploadsDir}`);
});

function shutdown(signal) {
  console.log(`[nrgindex] ${signal}: shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
