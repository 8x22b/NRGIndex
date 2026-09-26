const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const adminJs = fs.readFileSync(path.join(root, "admin", "admin.js"), "utf8");
const history = fs.readFileSync(path.join(root, "server", "lib", "history.js"), "utf8");

test("логи админки: время из createdAt, а не Invalid Date", () => {
  // listLogs отдаёт camelCase createdAt — как listAudit, поэтому рендер логов его находит.
  assert.match(history, /createdAt: row\.created_at/);
  const logsStart = history.indexOf("function listLogs");
  const logsBody = history.slice(logsStart, history.indexOf("function readSettings", logsStart));
  assert.match(logsBody, /createdAt: row\.created_at/, "listLogs должен маппить created_at → createdAt");
  assert.match(adminJs, /parseUtc\(row\.createdAt\)/, "логи читают row.createdAt");
  assert.match(adminJs, /Number\.isNaN\(date\.getTime\(\)\)/, "битая дата не должна печататься как Invalid Date");
});
