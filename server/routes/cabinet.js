const express = require("express");
const { notFound, tooMany } = require("../lib/errors");
const { str, oneOf, slugify } = require("../lib/validate");
const { parseDrinkText, searchCanImages, TIERS } = require("../lib/ai");
const { saveProcessedImage } = require("../lib/images");
const { writeAudit, getSetting } = require("../db");
const { ACCENTS, touchContent, uniqueSlug, ratingsForDrink, relationsForDrink } = require("../lib/content");
const { drinkToAdmin } = require("../lib/serialize");

function drinkFields(body) {
  return {
    brand: str(body?.brand, "Бренд", { max: 80 }),
    name: str(body?.name, "Название", { max: 120 }),
    flavor: str(body?.flavor ?? "", "Вкус", { required: false, max: 160 }),
    edition: str(body?.edition ?? "", "Издание", { required: false, max: 160 }),
    tier: oneOf(String(body?.tier || "B"), TIERS, "Тир"),
    review: str(body?.review ?? "", "Отзыв", { required: false, max: 1000 }),
  };
}

module.exports = (db, auth, config) => {
  const router = express.Router();
  const aiUsage = new Map();
  const AI_LIMIT = 40;
  const AI_WINDOW_MS = 60 * 60 * 1000;

  function checkAiLimit(userId) {
    const now = Date.now();
    const entry = aiUsage.get(userId);
    if (!entry || entry.resetAt < now) {
      aiUsage.set(userId, { count: 1, resetAt: now + AI_WINDOW_MS });
      return;
    }
    entry.count += 1;
    if (entry.count > AI_LIMIT) throw tooMany("Лимит ИИ-запросов: 40 в час");
  }

  function findDrink(slug) {
    const drink = db.prepare("SELECT * FROM drinks WHERE slug = ?").get(slug);
    if (!drink) throw notFound("Напиток не найден");
    return drink;
  }

  router.get("/me", (req, res) => {
    const ratings = db
      .prepare(
        `SELECT d.slug AS drink, r.tier_id AS tier, r.review
         FROM ratings r JOIN drinks d ON d.id = r.drink_id
         WHERE r.user_id = ? ORDER BY r.updated_at DESC`,
      )
      .all(req.user.id);
    const added = db
      .prepare("SELECT id, slug FROM drinks WHERE created_by = ? ORDER BY id DESC")
      .all(req.user.id);
    res.json({ user: req.user, ratings, addedDrinks: added });
  });

  router.put("/ratings/:slug", (req, res) => {
    const drink = findDrink(req.params.slug);
    const tier = oneOf(String(req.body?.tier || ""), TIERS, "Тир");
    const review = str(req.body?.review ?? "", "Отзыв", { required: false, max: 1000 });
    db.prepare(
      `INSERT INTO ratings (drink_id, user_id, tier_id, review) VALUES (?, ?, ?, ?)
       ON CONFLICT(drink_id, user_id)
       DO UPDATE SET tier_id = excluded.tier_id, review = excluded.review, updated_at = datetime('now')`,
    ).run(drink.id, req.user.id, tier, review);
    writeAudit(db, req.user, "rating.set", "drink", drink.slug, `tier=${tier}`);
    touchContent(db);
    res.json({ ok: true });
  });

  router.delete("/ratings/:slug", (req, res) => {
    const drink = findDrink(req.params.slug);
    db.prepare("DELETE FROM ratings WHERE drink_id = ? AND user_id = ?").run(
      drink.id,
      req.user.id,
    );
    writeAudit(db, req.user, "rating.delete", "drink", drink.slug);
    touchContent(db);
    res.json({ ok: true });
  });

  router.post("/drinks", async (req, res) => {
    const fields = drinkFields(req.body);
    const image = req.body?.imageDataUrl
      ? await saveProcessedImage(config.uploadsDir, req.body.imageDataUrl, config.maxUploadBytes)
      : null;
    const accent =
      image?.accent ||
      ACCENTS[db.prepare("SELECT COUNT(*) AS n FROM drinks").get().n % ACCENTS.length];
    const slug = uniqueSlug(db, `${fields.brand}-${fields.flavor || fields.name}`);

    const create = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO drinks (slug, brand, name, flavor, edition, image_path, source_label, accent_a, accent_b, is_published, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          slug,
          fields.brand,
          fields.name,
          fields.flavor,
          fields.edition,
          image?.path || "",
          `добавил ${req.user.displayName}`,
          accent[0],
          accent[1],
          req.user.id,
        );
      db.prepare("INSERT INTO ratings (drink_id, user_id, tier_id, review) VALUES (?, ?, ?, ?)").run(
        info.lastInsertRowid,
        req.user.id,
        fields.tier,
        fields.review,
      );
      return info.lastInsertRowid;
    });

    const id = create();
    writeAudit(db, req.user, "drink.create", "drink", slug);
    touchContent(db);
    const row = db.prepare("SELECT * FROM drinks WHERE id = ?").get(id);
    res.status(201).json({ drink: drinkToAdmin(row, ratingsForDrink(db, id), relationsForDrink(db, id)) });
  });

  router.patch("/drinks/:slug", async (req, res) => {
    const drink = findDrink(req.params.slug);
    const isOwner = drink.created_by === req.user.id;
    const canEditAny = req.user.role === "admin" || req.user.role === "editor";
    if (!isOwner && !canEditAny) throw notFound("Напиток не найден");

    const fields = drinkFields(req.body);
    const image = req.body?.imageDataUrl
      ? await saveProcessedImage(config.uploadsDir, req.body.imageDataUrl, config.maxUploadBytes)
      : null;
    const imagePath = image ? image.path : drink.image_path;
    const accentA = image ? image.accent[0] : drink.accent_a;
    const accentB = image ? image.accent[1] : drink.accent_b;
    db.prepare(
      `UPDATE drinks SET brand = ?, name = ?, flavor = ?, edition = ?, image_path = ?,
         accent_a = ?, accent_b = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(fields.brand, fields.name, fields.flavor, fields.edition, imagePath, accentA, accentB, drink.id);
    if (req.body?.tier !== undefined || req.body?.review !== undefined) {
      db.prepare(
        `INSERT INTO ratings (drink_id, user_id, tier_id, review) VALUES (?, ?, ?, ?)
         ON CONFLICT(drink_id, user_id)
         DO UPDATE SET tier_id = excluded.tier_id, review = excluded.review, updated_at = datetime('now')`,
      ).run(drink.id, req.user.id, fields.tier, fields.review);
    }
    writeAudit(db, req.user, "drink.update", "drink", drink.slug);
    touchContent(db);
    const row = db.prepare("SELECT * FROM drinks WHERE id = ?").get(drink.id);
    res.json({ drink: drinkToAdmin(row, ratingsForDrink(db, drink.id), relationsForDrink(db, drink.id)) });
  });

  router.delete("/drinks/:slug", (req, res) => {
    const drink = findDrink(req.params.slug);
    const isOwner = drink.created_by === req.user.id;
    const canEditAny = req.user.role === "admin" || req.user.role === "editor";
    if (!isOwner && !canEditAny) throw notFound("Напиток не найден");
    db.prepare("DELETE FROM drinks WHERE id = ?").run(drink.id);
    writeAudit(db, req.user, "drink.delete", "drink", drink.slug);
    touchContent(db);
    res.json({ ok: true });
  });

  router.post("/ai/parse", async (req, res) => {
    checkAiLimit(req.user.id);
    const text = str(req.body?.text, "Текст", { min: 2, max: 2000 });
    const key = getSetting(db, "openrouter_key", process.env.OPENROUTER_KEY || "");
    const model = getSetting(db, "openrouter_model", "openai/gpt-4o-mini");
    const parsed = await parseDrinkText(text, { key, model });
    writeAudit(db, req.user, "ai.parse", "drink", "", text.slice(0, 120));
    res.json({ parsed });
  });

  router.get("/ai/photo-search", async (req, res) => {
    checkAiLimit(req.user.id);
    const query = str(req.query?.q, "Запрос", { min: 2, max: 120 });
    const images = await searchCanImages(query);
    res.json({ images });
  });

  return router;
};
