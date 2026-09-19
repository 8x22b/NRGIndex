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

module.exports = { ACCENTS, touchContent, uniqueSlug, ratingsForDrink, relationsForDrink };
