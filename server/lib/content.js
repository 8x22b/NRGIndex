const { setSetting } = require("../db");
const { slugify } = require("./validate");

const ACCENTS = [
  ["#ff4f79", "#ff7448"],
  ["#00b8d9", "#7ee6e1"],
  ["#8b3bc4", "#ef3ea6"],
  ["#39a844", "#b7e43b"],
  ["#f1c46c", "#ff7448"],
  ["#9fb7ff", "#cf8cff"],
];

function touchContent(db) {
  setSetting(db, "content_updated_at", new Date().toISOString());
}

function uniqueSlug(db, base) {
  const root = slugify(base);
  let slug = root;
  for (let i = 1; i <= 60; i++) {
    const exists = db.prepare("SELECT 1 FROM drinks WHERE slug = ?").get(slug);
    if (!exists) return slug;
    slug = `${root}-${i + 1}`;
  }
  return `${root}-${Math.random().toString(36).slice(2, 10)}`;
}

function ratingsForDrink(db, drinkId) {
  const rows = db
    .prepare(
      `SELECT u.username AS user, r.tier_id AS tier, r.review, r.order_index AS "order"
       FROM ratings r JOIN users u ON u.id = r.user_id WHERE r.drink_id = ?`,
    )
    .all(drinkId);
  const map = {};
  for (const row of rows) {
    map[row.user] = { tier: row.tier, review: row.review, order: row.order };
  }
  return map;
}

function relationsForDrink(db, drinkId) {
  return db
    .prepare("SELECT related_id FROM drink_relations WHERE drink_id = ?")
    .all(drinkId)
    .map((row) => row.related_id);
}

// Слова для сравнения названий: нижний регистр, ё→е, без знаков, без «шумовых» слов.
const NOISE_WORDS = new Set([
  "energy", "drink", "энергетик", "энергетический", "напиток", "вкус", "со", "и", "the",
  "original", "classic", "оригинал", "оригинальный", "классический", "классика",
]);
function matchWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !NOISE_WORDS.has(word));
}

/**
 * Ищет уже заведённые банки, похожие на { brand, name, flavor } — чтобы ИИ-поток
 * не плодил дубли. Бренд должен совпасть хотя бы одним словом; дальше считаем
 * долю совпавших слов названия/вкуса. Возвращает до `limit` лучших с score 0..1.
 */
function findSimilarDrinks(db, { brand = "", name = "", flavor = "" } = {}, { limit = 3, min = 0.6 } = {}) {
  const brandWords = new Set(matchWords(brand));
  const wanted = new Set(matchWords(`${name} ${flavor}`).filter((word) => !brandWords.has(word)));
  if (!brandWords.size && !wanted.size) return [];
  const rows = db
    .prepare("SELECT id, slug, brand, name, flavor, edition, image_path FROM drinks WHERE is_published = 1")
    .all();
  const scored = [];
  for (const row of rows) {
    const rowBrand = new Set(matchWords(row.brand));
    if (brandWords.size && ![...brandWords].some((word) => rowBrand.has(word))) continue;
    const words = (text) => new Set(matchWords(text).filter((word) => !rowBrand.has(word)));
    const nameWords = words(row.name);
    let score;
    if (!wanted.size) {
      // назвали только бренд: похожа лишь «голая» банка бренда
      score = nameWords.size ? 0 : 1;
    } else {
      // вкус часто продублирован по-русски («Apple Kiwi» / «яблоко киви»),
      // поэтому сравниваем с названием, вкусом и их объединением — берём лучшее
      const variants = [nameWords, words(row.flavor), words(`${row.name} ${row.flavor} ${row.edition}`)];
      score = 0;
      for (const have of variants) {
        if (!have.size) continue;
        let hit = 0;
        for (const word of wanted) if (have.has(word)) hit++;
        score = Math.max(score, hit / Math.max(wanted.size, have.size));
      }
    }
    if (score >= min) scored.push({ row, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.row.id - b.row.id)
    .slice(0, limit)
    .map(({ row, score }) => ({
      slug: row.slug,
      brand: row.brand,
      name: row.name,
      flavor: row.flavor,
      image: row.image_path || "assets/favicon.svg",
      score: Math.round(score * 100) / 100,
    }));
}

module.exports = {
  ACCENTS,
  touchContent,
  uniqueSlug,
  ratingsForDrink,
  relationsForDrink,
  findSimilarDrinks,
  matchWords,
};
