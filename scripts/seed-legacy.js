const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const config = require("../server/config");
const { openDatabase } = require("../server/db");
const { touchContent } = require("../server/lib/content");

function loadLegacy() {
  const context = vm.createContext({ window: {} });
  for (const file of ["legacy/data.js", "legacy/participants.js"]) {
    const full = path.join(config.root, file);
    if (!fs.existsSync(full)) throw new Error(`Не найден ${file}`);
    vm.runInContext(fs.readFileSync(full, "utf8"), context, { filename: file });
  }
  if (!context.window.NRG_DATA) throw new Error("legacy/data.js не содержит window.NRG_DATA");
  return { data: context.window.NRG_DATA, identities: context.window.NRG_IDENTITIES || [] };
}

function main() {
  const force = process.argv.includes("--force");
  const db = openDatabase(config.dbPath);
  const users = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  const drinks = db.prepare("SELECT COUNT(*) AS n FROM drinks").get().n;
  if (!force && (users || drinks)) {
    console.log(`База не пуста (пользователей: ${users}, напитков: ${drinks}) — сид пропущен.`);
    console.log("Для перезаписи: node scripts/seed-legacy.js --force");
    db.close();
    return;
  }

  const { data, identities } = loadLegacy();
  const identByPid = new Map(identities.map((item) => [item.pid, item]));

  const seed = db.transaction(() => {
    if (force) {
      db.exec(
        "DELETE FROM drink_relations; DELETE FROM ratings; DELETE FROM drinks; DELETE FROM tiers; DELETE FROM users;",
      );
    }

    const upsertTier = db.prepare(
      `INSERT INTO tiers (id, title, note, score, position) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, note = excluded.note,
         score = excluded.score, position = excluded.position`,
    );
    (data.tiers || []).forEach((tier, index) => {
      upsertTier.run(tier.id, tier.title || tier.id, tier.note || "", tier.score ?? 5 - index, index + 1);
    });

    const insertUser = db.prepare(
      `INSERT INTO users (username, display_name, role, title, initials, color, password_hash, must_change_password, is_active)
       VALUES (?, ?, 'user', ?, ?, ?, NULL, 1, 1)`,
    );
    for (const person of data.participants || []) {
      const identity = identByPid.get(person.id) || {};
      insertUser.run(
        person.id,
        identity.name || person.name || person.id,
        identity.role || person.role || "",
        person.initials || "",
        person.color || "#9fb7ff",
      );
    }

    const insertDrink = db.prepare(
      `INSERT INTO drinks (slug, brand, name, flavor, edition, image_path, source_label, accent_a, accent_b, is_published, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL)`,
    );
    const drinkIdBySlug = new Map();
    for (const drink of data.drinks || []) {
      const accent = Array.isArray(drink.accent) ? drink.accent : ["#ff4f79", "#ff7448"];
      const image = drink.image ? (drink.image.startsWith("/") ? drink.image : `/${drink.image}`) : "";
      insertDrink.run(
        drink.id,
        drink.brand || drink.name,
        drink.name,
        drink.flavor || "",
        drink.edition || "",
        image,
        drink.sourceLabel || "",
        accent[0],
        accent[1],
      );
      const row = db.prepare("SELECT id FROM drinks WHERE slug = ?").get(drink.id);
      drinkIdBySlug.set(drink.id, row.id);
    }

    const insertRelation = db.prepare(
      "INSERT OR IGNORE INTO drink_relations (drink_id, related_id) VALUES (?, ?)",
    );
    for (const drink of data.drinks || []) {
      for (const related of drink.related || []) {
        const from = drinkIdBySlug.get(drink.id);
        const to = drinkIdBySlug.get(related);
        if (from && to && from !== to) insertRelation.run(from, to);
      }
    }

    const userIdByLogin = new Map(
      db.prepare("SELECT id, username FROM users").all().map((user) => [user.username, user.id]),
    );
    const insertRating = db.prepare(
      `INSERT INTO ratings (drink_id, user_id, tier_id, review, order_index) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(drink_id, user_id)
       DO UPDATE SET tier_id = excluded.tier_id, review = excluded.review, order_index = excluded.order_index`,
    );
    for (const drink of data.drinks || []) {
      const drinkId = drinkIdBySlug.get(drink.id);
      for (const [pid, rating] of Object.entries(drink.ratings || {})) {
        const userId = userIdByLogin.get(pid);
        if (!drinkId || !userId || !rating?.tier) continue;
        insertRating.run(drinkId, userId, rating.tier, rating.review || "", rating.order ?? null);
      }
    }

    touchContent(db);
  });

  seed();
  const stats = {
    tiers: db.prepare("SELECT COUNT(*) AS n FROM tiers").get().n,
    users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
    drinks: db.prepare("SELECT COUNT(*) AS n FROM drinks").get().n,
    ratings: db.prepare("SELECT COUNT(*) AS n FROM ratings").get().n,
  };
  console.log(
    `Сид готов: тиров ${stats.tiers}, пользователей ${stats.users}, напитков ${stats.drinks}, оценок ${stats.ratings}.`,
  );
  console.log("Пользователям нужны пароли: админка → Пользователи → Сбросить пароль (или scripts/create-admin.js).");
  db.close();
}

try {
  main();
} catch (error) {
  console.error(`Ошибка сида: ${error.message}`);
  process.exit(1);
}
