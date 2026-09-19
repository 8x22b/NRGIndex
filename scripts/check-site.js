const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const errors = [];
const fail = (msg) => errors.push(msg);

function loadWindow(file, context) {
  const code = fs.readFileSync(path.join(ROOT, file), "utf8");
  vm.runInContext(code, context, { filename: file });
}

const context = vm.createContext({ window: {} });
loadWindow("data.js", context);
loadWindow("participants.js", context);

const data = context.window.NRG_DATA;
const identities = context.window.NRG_IDENTITIES;

if (!data) fail("data.js: window.NRG_DATA не определён");
if (!Array.isArray(identities) || !identities.length) {
  fail("participants.js: window.NRG_IDENTITIES пуст");
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{2}\.\d{2}\.\d{4}$/;
const TIERS = ["S", "A", "B", "C", "D"];
const isLocalRef = (ref) => !/^(#|https?:|mailto:|tel:|\/\/)/.test(ref);

let drinksCount = 0;
let participantsCount = 0;
let tiersCount = 0;

if (data) {
  if (!DATE.test(data.updatedAt || "")) {
    fail(`updatedAt не в формате ДД.ММ.ГГГГ: ${data.updatedAt}`);
  }

  const tierIds = new Set();
  for (const tier of data.tiers || []) {
    if (tierIds.has(tier.id)) fail(`дубликат тира: ${tier.id}`);
    tierIds.add(tier.id);
    if (typeof tier.score !== "number") fail(`тир ${tier.id}: score не число`);
    if (!tier.title || !tier.note) fail(`тир ${tier.id}: нет title/note`);
  }
  tiersCount = tierIds.size;
  for (const required of TIERS) {
    if (!tierIds.has(required)) fail(`нет тира ${required}`);
  }

  const pids = new Set();
  for (const p of data.participants || []) {
    if (!p.id) fail("участник без id");
    if (pids.has(p.id)) fail(`дубликат участника: ${p.id}`);
    pids.add(p.id);
    if (!p.name) fail(`участник ${p.id}: нет name`);
    if (!HEX.test(p.color || "")) fail(`участник ${p.id}: color не HEX`);
  }
  participantsCount = pids.size;

  const identPids = new Set((identities || []).map((i) => i.pid));
  for (const id of pids) {
    if (!identPids.has(id)) fail(`участник ${id} отсутствует в participants.js`);
  }

  const ids = new Set();
  for (const drink of data.drinks || []) {
    const where = drink.id || "(без id)";
    if (!drink.id) fail("напиток без id");
    if (ids.has(drink.id)) fail(`дубликат напитка: ${drink.id}`);
    ids.add(drink.id);
    for (const field of ["brand", "name", "flavor", "edition", "image", "sourceLabel"]) {
      if (!drink[field]) fail(`напиток ${where}: пустое поле ${field}`);
    }
    if (drink.image && !fs.existsSync(path.join(ROOT, drink.image))) {
      fail(`напиток ${where}: нет файла ${drink.image}`);
    }
    if (
      !Array.isArray(drink.accent) ||
      drink.accent.length !== 2 ||
      !drink.accent.every((c) => HEX.test(c))
    ) {
      fail(`напиток ${where}: accent должен быть массивом из двух HEX-цветов`);
    }
    for (const [pid, rating] of Object.entries(drink.ratings || {})) {
      if (!pids.has(pid)) fail(`напиток ${where}: оценка от неизвестного участника ${pid}`);
      if (!tierIds.has(rating.tier)) fail(`напиток ${where}/${pid}: неизвестный тир ${rating.tier}`);
      if (rating.order !== undefined && typeof rating.order !== "number") {
        fail(`напиток ${where}/${pid}: order не число`);
      }
      if (rating.review !== undefined && typeof rating.review !== "string") {
        fail(`напиток ${where}/${pid}: review не строка`);
      }
    }
  }
  drinksCount = ids.size;

  for (const drink of data.drinks || []) {
    for (const rel of drink.related || []) {
      if (!ids.has(rel)) fail(`напиток ${drink.id}: related ссылается на неизвестный id ${rel}`);
      if (rel === drink.id) fail(`напиток ${drink.id}: related ссылается на себя`);
    }
  }
}

for (const file of ["index.html", "cabinet.html"]) {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  if (!/^<!DOCTYPE html>/i.test(html.trim())) fail(`${file}: нет <!DOCTYPE html>`);
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (!isLocalRef(ref)) continue;
    const clean = ref.split("#")[0].split("?")[0];
    if (!clean || clean === "keys.js") continue;
    if (!fs.existsSync(path.join(ROOT, clean))) {
      fail(`${file}: ссылка на отсутствующий файл ${clean}`);
    }
  }
}

if (errors.length) {
  console.error(`check-site: найдено ${errors.length} ошибок:`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}

console.log(
  `check-site: OK — ${drinksCount} напитков, ${participantsCount} участников, ${tiersCount} тиров.`,
);
