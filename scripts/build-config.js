/* NRG/INDEX — сборка keys.js из секретов.
 * Локально:  cp .env.example .env  (+ вписать значения),  node scripts/build-config.js
 * В CI: значения берутся из GitHub Secrets (см. .github/workflows/deploy.yml).
 * keys.js НЕ коммитится — генерится при деплое. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadDotEnv();

const fail = (msg) => { console.error("build-config: " + msg); process.exit(1); };

let keys;
try {
  keys = JSON.parse(process.env.LOGIN_KEYS_JSON || "[]");
} catch { fail("LOGIN_KEYS_JSON — битый JSON."); }
if (!Array.isArray(keys) || !keys.length) fail("LOGIN_KEYS_JSON пуст. Добавь хотя бы один {key, hash, pid}.");
for (const k of keys) {
  if (!k.hash || !k.pid) fail("В LOGIN_KEYS_JSON каждая запись обязана иметь hash и pid.");
}

const orKey = process.env.OPENROUTER_KEY || "";
const orModel = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

const out = `/* СГЕНЕРИРОВАНО из секретов — не править руками, не коммитить.
 * Локально: node scripts/build-config.js (.env). В проде: GitHub Actions. */
window.NRG_KEYS = ${JSON.stringify(keys.map((k) => ({ hash: k.hash, pid: k.pid })), null, 2)};

window.NRG_AI = {
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  model: ${JSON.stringify(orModel)},
  key: ${JSON.stringify(orKey)},
};
`;

fs.writeFileSync(path.join(ROOT, "keys.js"), out);
console.log(`build-config: keys.js собран (${keys.length} ключей, OR-ключ ${orKey ? "есть" : "ПУСТО"}).`);
