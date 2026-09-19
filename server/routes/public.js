const express = require("express");
const { formatDate, userToParticipant, drinkToPublic } = require("../lib/serialize");

function ratingsMap(db) {
  const rows = db
    .prepare(
      `SELECT r.drink_id, r.tier_id AS tier, r.review, r.order_index AS "order", u.username
       FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE u.is_active = 1 AND u.is_public = 1`,
    )
    .all();
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.drink_id)) map.set(row.drink_id, {});
    map.get(row.drink_id)[row.username] = {
      tier: row.tier,
      review: row.review,
      order: row.order,
    };
  }
  return map;
}

function relationsMap(db) {
  const slugs = new Map(
    db.prepare("SELECT id, slug FROM drinks").all().map((row) => [row.id, row.slug]),
  );
  const map = new Map();
  for (const row of db.prepare("SELECT drink_id, related_id FROM drink_relations").all()) {
    if (!map.has(row.drink_id)) map.set(row.drink_id, []);
    const slug = slugs.get(row.related_id);
    if (slug) map.get(row.drink_id).push(slug);
  }
  return map;
}

function contentUpdatedAt(db) {
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'content_updated_at'").get();
  if (setting) return setting.value;
  const row = db
    .prepare(
      `SELECT MAX(updated_at) AS ts FROM (
         SELECT updated_at FROM drinks
         UNION ALL SELECT updated_at FROM ratings
       )`,
    )
    .get();
  return row?.ts || new Date().toISOString();
}

module.exports = (db) => {
  const router = express.Router();

  router.get("/summary", (req, res) => {
    const tiers = db
      .prepare("SELECT id, title, note, score FROM tiers ORDER BY position, id")
      .all();
    const participants = db
      .prepare(
        "SELECT username, display_name, initials, title, color FROM users WHERE is_active = 1 AND is_public = 1 ORDER BY id",
      )
      .all()
      .map(userToParticipant);
    const drinks = db.prepare("SELECT * FROM drinks WHERE is_published = 1 ORDER BY id").all();
    const ratings = ratingsMap(db);
    const relations = relationsMap(db);
    const site = {
      title: db.prepare("SELECT value FROM settings WHERE key = 'site_title'").get()?.value || "NRG / INDEX",
      description:
        db.prepare("SELECT value FROM settings WHERE key = 'site_description'").get()?.value || "",
    };

    res.json({
      site,
      updatedAt: formatDate(contentUpdatedAt(db)),
      tiers,
      participants,
      drinks: drinks.map((drink) =>
        drinkToPublic(drink, ratings.get(drink.id) || {}, relations.get(drink.id) || []),
      ),
    });
  });

  return router;
};
