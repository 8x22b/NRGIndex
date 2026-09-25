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
  "energy", "drink", "drinks", "энергетик", "энергетический", "напиток", "вкус", "вкусом", "вкуса",
  "со", "и", "the", "original", "classic", "оригинал", "оригинальный", "классический", "классика",
  "can", "cans", "банка", "банки", "бутылка", "bottle", "мл", "ml", "литр", "литра",
]);

// Кириллица → латиница: чтобы «Ред Булл» и «Red Bull» сходились в одном алфавите.
const CYR_TO_LAT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function translit(text) {
  let out = "";
  for (const ch of String(text || "")) out += CYR_TO_LAT[ch] ?? ch;
  return out;
}

// Грубая нормализация для сравнения строк: без регистра, диакритики, знаков, в латинице.
function normalizeTerm(text) {
  return translit(String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ё/g, "е"))
    .replace(/[^a-z0-9]/g, "");
}

// Кривой стемминг: снимает только очевидные плюрали (apples→apple, банки→банк).
function stem(word) {
  if (word.length > 3 && /[s]$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
  if (word.length > 3 && /[ыий]$/.test(word)) return word.slice(0, -1);
  return word;
}

function matchWords(text) {
  const out = new Set();
  const folded = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ё/g, "е");
  for (const raw of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || NOISE_WORDS.has(raw) || /^\d+$/.test(raw)) continue;
    for (const form of [raw, translit(raw)]) {
      if (!form) continue;
      out.add(form);
      out.add(stem(form));
    }
  }
  return [...out];
}

// Dice по биграммам символов: ловит опечатки и перестановки, которые наборы слов не видят.
function bigrams(text) {
  const s = normalizeTerm(text);
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function dice(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.size || !right.size) return 0;
  let hit = 0;
  for (const gram of left) if (right.has(gram)) hit++;
  return (2 * hit) / (left.size + right.size);
}

const union = (...sets) => {
  const out = new Set();
  for (const set of sets) for (const word of set) out.add(word);
  return out;
};

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const word of a) if (b.has(word)) inter++;
  return inter / (a.size + b.size - inter);
}

function similarityReason(brandScore, score) {
  if (brandScore >= 0.99 && score >= 0.85) return "бренд и вкус совпали";
  if (brandScore >= 0.99) return "бренд совпал";
  if (brandScore >= 0.7) return "похожий бренд";
  return "совпало название или вкус";
}

/**
 * Ищет уже заведённые банки, похожие на { brand, name, flavor, edition } — чтобы
 * ИИ-поток не плодил дубли. Бренд даёт вес (точное слово или fuzzy-Dice), а не
 * жёсткий отсев: опечатки и транслит («Redbul», «Ред Булл») тоже проходят.
 * Название/вкус сравниваются Jaccard'ом по нормализованным словам + бонусы за
 * полное покрытие и точную фразу. Возвращает до `limit` лучших со score 0..1,
 * уверенностью (high/medium) и причиной совпадения.
 */
function findSimilarDrinks(
  db,
  { brand = "", name = "", flavor = "", edition = "" } = {},
  { limit = 3, min = 0.6, includeHidden = false } = {},
) {
  const queryBrand = new Set(matchWords(brand));
  const queryWanted = new Set(matchWords(`${name} ${flavor} ${edition}`));
  for (const word of queryBrand) queryWanted.delete(word);
  const queryName = normalizeTerm(`${name} ${flavor}`);
  if (!queryBrand.size && !queryWanted.size) return [];

  const rows = db
    .prepare(
      `SELECT id, slug, brand, name, flavor, edition, image_path, is_published FROM drinks
       WHERE ? = 1 OR is_published = 1`,
    )
    .all(includeHidden ? 1 : 0);

  const scored = [];
  for (const row of rows) {
    const rowBrand = new Set(matchWords(row.brand));
    const rowName = new Set(matchWords(row.name));
    const rowFlavor = new Set(matchWords(row.flavor));
    const rowEdition = new Set(matchWords(row.edition));
    for (const word of rowBrand) {
      rowName.delete(word);
      rowFlavor.delete(word);
      rowEdition.delete(word);
    }

    let brandScore = 0;
    if (queryBrand.size && rowBrand.size) {
      let shared = false;
      for (const word of queryBrand) {
        if (rowBrand.has(word)) {
          shared = true;
          break;
        }
      }
      if (shared) {
        brandScore = 1;
      } else {
        const fuzzy = dice(brand, row.brand);
        brandScore = fuzzy >= 0.7 ? fuzzy : 0;
      }
    }

    let nameScore;
    if (!queryWanted.size) {
      // назвали только бренд: похожа лишь «голая» банка бренда без лишних слов
      nameScore = rowName.size || rowFlavor.size || rowEdition.size ? 0 : 1;
    } else {
      const combined = union(rowName, rowFlavor, rowEdition);
      // вкус часто продублирован по-русски («Apple Kiwi» / «яблоко киви») —
      // поэтому сравниваем с именем, вкусом, edition и их объединением, берём лучшее
      const variants = [rowName, rowFlavor, union(rowName, rowEdition), combined];
      nameScore = 0;
      for (const variant of variants) nameScore = Math.max(nameScore, jaccard(queryWanted, variant));
      let covered = 0;
      for (const word of queryWanted) if (combined.has(word)) covered++;
      if (covered === queryWanted.size) nameScore = Math.min(1, nameScore + 0.1);
      const rowNorm = normalizeTerm(`${row.name} ${row.flavor}`);
      if (
        queryName.length >= 4 &&
        rowNorm.length >= 4 &&
        (queryName.includes(rowNorm) || rowNorm.includes(queryName))
      ) {
        nameScore = Math.min(1, nameScore + 0.1);
      }
    }

    const score = queryBrand.size ? 0.5 * brandScore + 0.5 * nameScore : nameScore;
    if (score >= min) scored.push({ row, score, brandScore });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.row.id - b.row.id)
    .slice(0, limit)
    .map(({ row, score, brandScore }) => ({
      slug: row.slug,
      brand: row.brand,
      name: row.name,
      flavor: row.flavor,
      image: row.image_path || "assets/favicon.svg",
      score: Math.round(score * 100) / 100,
      confidence: score >= 0.85 ? "high" : "medium",
      reason: similarityReason(brandScore, score),
      hidden: !row.is_published,
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
