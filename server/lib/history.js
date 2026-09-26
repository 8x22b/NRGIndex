// Журнал действий: человекочитаемые описания + снимки состояния для отката.
const { writeAudit, getSetting, setSetting } = require("../db");
const { conflict, notFound, badRequest, ApiError } = require("./errors");

const DRINK_COLS = [
  "slug",
  "brand",
  "name",
  "flavor",
  "edition",
  "image_path",
  "source_label",
  "accent_a",
  "accent_b",
  "is_published",
  "created_by",
  "created_at",
  "updated_at",
];
const USER_PROFILE_COLS = ["username", "display_name", "role", "title", "initials", "color", "is_active", "is_public"];
const TIER_COLS = ["title", "note", "score", "position"];

const DRINK_LABELS = {
  brand: "Бренд",
  name: "Название",
  flavor: "Вкус",
  edition: "Издание",
  image_path: "Картинка",
  source_label: "Подпись",
  accent_a: "Цвет A",
  accent_b: "Цвет B",
  is_published: "Публикация",
  related: "Похожие",
};
const USER_LABELS = {
  username: "Логин",
  display_name: "Имя",
  role: "Роль",
  title: "Должность",
  initials: "Инициалы",
  color: "Цвет",
  is_active: "Доступ",
  is_public: "На сайте",
};
const TIER_LABELS = { title: "Название", note: "Описание", score: "Балл", position: "Позиция" };
const SETTING_LABELS = {
  site_title: "Заголовок сайта",
  site_description: "Описание сайта",
  openrouter_model: "Текстовая модель",
  stt_model: "STT-модель",
  ai_base_url: "Base URL",
  parse_base_url: "Base URL разбора",
  openrouter_key: "API-ключ",
  parse_api_key: "API-ключ разбора",
  google_cse_key: "Ключ Google CSE",
  google_cse_cx: "ID поисковика Google (CX)",
  gemini_api_key: "Ключ Gemini",
  gemini_image_model: "Модель Gemini",
  ai_proxy_url: "Прокси для ИИ",
};
const SECRET_SETTINGS = new Set(["openrouter_key", "parse_api_key", "google_cse_key", "gemini_api_key", "ai_proxy_url"]);
const ROLE_NAMES = { admin: "админ", editor: "редактор", user: "юзер" };

const quote = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "пусто";
  return `«${text.length > 80 ? `${text.slice(0, 77)}…` : text}»`;
};
const drinkLabel = (row) => (row ? quote(row.name || row.slug) : "напиток");
const userLabel = (row) => (row ? `${row.display_name} (@${row.username})` : "пользователь");

function formatValue(field, value, db) {
  if (field === "is_published") return value ? "опубликован" : "скрыт";
  if (field === "is_active") return value ? "активен" : "отключён";
  if (field === "is_public") return value ? "виден" : "скрыт";
  if (field === "role") return ROLE_NAMES[value] || value;
  if (field === "image_path") return value ? "есть" : "нет";
  if (field === "related") {
    if (!value?.length) return "нет";
    const names = value.map((id) => db.prepare("SELECT name FROM drinks WHERE id = ?").get(id)?.name || `#${id}`);
    return names.join(", ");
  }
  if (typeof value === "number") return String(value);
  return quote(value);
}

function diffLines(before, after, labels, db) {
  const lines = [];
  for (const [field, label] of Object.entries(labels)) {
    const a = before?.[field];
    const b = after?.[field];
    const same = Array.isArray(a) || Array.isArray(b)
      ? JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())
      : a === b;
    if (same) continue;
    if (field === "image_path") {
      lines.push(`${label}: ${!a ? "добавлена" : !b ? "убрана" : "заменена"}`);
    } else {
      lines.push(`${label}: ${formatValue(field, a, db)} → ${formatValue(field, b, db)}`);
    }
  }
  return lines;
}

/* ---------- снимки ---------- */

function snapDrink(db, id, { full = false } = {}) {
  const row = db.prepare("SELECT * FROM drinks WHERE id = ?").get(id);
  if (!row) return null;
  const snap = {
    row,
    related: db.prepare("SELECT related_id FROM drink_relations WHERE drink_id = ?").all(id).map((r) => r.related_id),
  };
  if (full) {
    snap.incoming = db
      .prepare("SELECT drink_id FROM drink_relations WHERE related_id = ?")
      .all(id)
      .map((r) => r.drink_id);
    snap.ratings = db.prepare("SELECT * FROM ratings WHERE drink_id = ?").all(id);
  }
  return snap;
}

const snapRating = (db, drinkId, userId) =>
  db.prepare("SELECT * FROM ratings WHERE drink_id = ? AND user_id = ?").get(drinkId, userId) || null;

const snapTier = (db, id) => db.prepare("SELECT * FROM tiers WHERE id = ?").get(id) || null;

function snapUser(db, id, { full = false } = {}) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!row) return null;
  if (!full) return { row };
  return {
    row,
    ratings: db.prepare("SELECT * FROM ratings WHERE user_id = ?").all(id),
    createdDrinks: db.prepare("SELECT id FROM drinks WHERE created_by = ?").all(id).map((r) => r.id),
  };
}

/* ---------- запись в журнал ---------- */

const flatDrink = (snap) => (snap ? { ...snap.row, related: snap.related } : null);

function recordDrink(db, actor, action, before, after) {
  const drink = after?.row || before?.row;
  const id = drink.id;
  const common = { targetKey: `drink:${id}` };
  if (action.endsWith("create")) {
    return writeAudit(db, actor, action, "drink", drink.slug, "", {
      ...common,
      summary: `Добавил напиток ${drinkLabel(drink)}`,
      undoData: { kind: "drink.create", id },
    });
  }
  if (action.endsWith("delete")) {
    const count = before.ratings?.length || 0;
    return writeAudit(db, actor, action, "drink", drink.slug, count ? `Вместе с ним удалено оценок: ${count}` : "", {
      ...common,
      summary: `Удалил напиток ${drinkLabel(drink)}`,
      undoData: { kind: "drink.delete", before },
    });
  }
  const lines = diffLines(flatDrink(before), flatDrink(after), DRINK_LABELS, db);
  const verb = action.endsWith("reprocess") ? "Переобработал картинку" : "Изменил напиток";
  return writeAudit(db, actor, action, "drink", drink.slug, lines.join("\n") || "Без изменений", {
    ...common,
    summary: `${verb} ${drinkLabel(drink)}`,
    undoData: lines.length ? { kind: "drink.update", before } : null,
  });
}

function recordRating(db, actor, action, { drink, user, before, after }) {
  const who = actor?.id === user.id ? "свою оценку" : `оценку ${userLabel(user)}`;
  const target = drinkLabel(drink);
  let summary;
  let details = "";
  if (!after) {
    summary = `Удалил ${who} для ${target}`;
    if (before) details = `Была: ${before.tier_id}${before.review ? `, отзыв ${quote(before.review)}` : ""}`;
  } else if (!before) {
    summary = `Поставил ${who} ${after.tier_id} для ${target}`;
    if (after.review) details = `Отзыв: ${quote(after.review)}`;
  } else {
    summary = `Изменил ${who} для ${target}`;
    const lines = [];
    if (before.tier_id !== after.tier_id) lines.push(`Тир: ${before.tier_id} → ${after.tier_id}`);
    if (before.review !== after.review) lines.push(`Отзыв: ${quote(before.review)} → ${quote(after.review)}`);
    details = lines.join("\n") || "Без изменений";
  }
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  return writeAudit(db, actor, action, "rating", drink.slug, details, {
    summary,
    targetKey: `rating:${drink.id}:${user.id}`,
    undoData: changed ? { kind: "rating", drinkId: drink.id, userId: user.id, before } : null,
  });
}

function recordTier(db, actor, action, before, after) {
  const id = (after || before).id;
  let summary;
  let details = "";
  if (!before) summary = `Создал тир ${id} — ${quote(after.title)}`;
  else if (!after) summary = `Удалил тир ${id} — ${quote(before.title)}`;
  else {
    summary = `Изменил тир ${id}`;
    details = diffLines(before, after, TIER_LABELS, db).join("\n") || "Без изменений";
  }
  return writeAudit(db, actor, action, "tier", id, details, {
    summary,
    targetKey: `tier:${id}`,
    undoData: { kind: "tier", id, before },
  });
}

function recordUser(db, actor, action, before, after) {
  const row = after?.row || before?.row;
  const common = { targetKey: `user:${row.id}` };
  if (!before) {
    return writeAudit(db, actor, action, "user", row.id, `Роль: ${ROLE_NAMES[row.role] || row.role}`, {
      ...common,
      summary: `Создал пользователя ${userLabel(row)}`,
      undoData: { kind: "user.create", id: row.id },
    });
  }
  if (!after) {
    const count = before.ratings?.length || 0;
    return writeAudit(db, actor, action, "user", row.id, count ? `Вместе с ним удалено оценок: ${count}` : "", {
      ...common,
      summary: `Удалил пользователя ${userLabel(row)}`,
      undoData: { kind: "user.delete", before },
    });
  }
  const lines = diffLines(before.row, after.row, USER_LABELS, db);
  return writeAudit(db, actor, action, "user", row.id, lines.join("\n") || "Без изменений", {
    ...common,
    summary: `Изменил пользователя ${userLabel(row)}`,
    undoData: lines.length ? { kind: "user.update", before: before.row } : null,
  });
}

function recordSettings(db, actor, before, after) {
  const lines = [];
  const restorable = {};
  for (const key of Object.keys(after)) {
    if (before[key] === after[key]) continue;
    const label = SETTING_LABELS[key] || key;
    if (SECRET_SETTINGS.has(key)) {
      lines.push(`${label}: ${after[key] ? (before[key] ? "заменён" : "задан") : "убран"}`);
    } else {
      lines.push(`${label}: ${quote(before[key])} → ${quote(after[key])}`);
      restorable[key] = before[key];
    }
  }
  if (!lines.length) return null;
  return writeAudit(db, actor, "admin.settings.update", "settings", "", lines.join("\n"), {
    summary: "Изменил настройки",
    targetKey: "settings",
    undoData: Object.keys(restorable).length ? { kind: "settings", values: restorable } : null,
  });
}

/* ---------- откат ---------- */

function insertRow(db, table, row) {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(
    ...cols.map((c) => row[c]),
  );
}

function restoreRatings(db, ratings) {
  const userOk = db.prepare("SELECT 1 FROM users WHERE id = ?");
  const drinkOk = db.prepare("SELECT 1 FROM drinks WHERE id = ?");
  const tierOk = db.prepare("SELECT 1 FROM tiers WHERE id = ?");
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ratings (drink_id, user_id, tier_id, review, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let lost = 0;
  for (const r of ratings || []) {
    if (!userOk.get(r.user_id) || !drinkOk.get(r.drink_id) || !tierOk.get(r.tier_id)) {
      lost += 1;
      continue;
    }
    insert.run(r.drink_id, r.user_id, r.tier_id, r.review, r.order_index, r.created_at, r.updated_at);
  }
  return lost;
}

function setOutgoingRelations(db, drinkId, related) {
  db.prepare("DELETE FROM drink_relations WHERE drink_id = ?").run(drinkId);
  const exists = db.prepare("SELECT 1 FROM drinks WHERE id = ?");
  const insert = db.prepare("INSERT OR IGNORE INTO drink_relations (drink_id, related_id) VALUES (?, ?)");
  for (const id of related || []) if (id !== drinkId && exists.get(id)) insert.run(drinkId, id);
}

const activeAdmins = (db) =>
  db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get().n;

function applyUndo(db, data, { actor, auth }) {
  const notes = [];
  switch (data.kind) {
    case "drink.create": {
      const rated = db.prepare("SELECT COUNT(*) AS n FROM ratings WHERE drink_id = ?").get(data.id).n;
      if (rated) notes.push(`вместе с напитком удалено оценок: ${rated}`);
      const info = db.prepare("DELETE FROM drinks WHERE id = ?").run(data.id);
      if (!info.changes) throw conflict("Напиток уже удалён");
      break;
    }
    case "drink.update": {
      const { row, related } = data.before;
      if (!db.prepare("SELECT 1 FROM drinks WHERE id = ?").get(row.id)) throw conflict("Напиток уже удалён");
      const cols = DRINK_COLS.filter((c) => !["slug", "created_by", "created_at"].includes(c));
      db.prepare(`UPDATE drinks SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
        ...cols.map((c) => row[c]),
        row.id,
      );
      setOutgoingRelations(db, row.id, related);
      break;
    }
    case "drink.delete": {
      const { row, related, incoming, ratings } = data.before;
      if (db.prepare("SELECT 1 FROM drinks WHERE id = ? OR slug = ?").get(row.id, row.slug)) {
        throw conflict("Напиток с таким id или slug уже существует");
      }
      const creatorOk = row.created_by && db.prepare("SELECT 1 FROM users WHERE id = ?").get(row.created_by);
      insertRow(db, "drinks", { ...row, created_by: creatorOk ? row.created_by : null });
      setOutgoingRelations(db, row.id, related);
      const insert = db.prepare("INSERT OR IGNORE INTO drink_relations (drink_id, related_id) VALUES (?, ?)");
      for (const id of incoming || []) {
        if (db.prepare("SELECT 1 FROM drinks WHERE id = ?").get(id)) insert.run(id, row.id);
      }
      const lost = restoreRatings(db, ratings);
      if (lost) notes.push(`не восстановлено оценок: ${lost} (нет пользователя или тира)`);
      break;
    }
    case "rating": {
      const { drinkId, userId, before } = data;
      if (!db.prepare("SELECT 1 FROM drinks WHERE id = ?").get(drinkId)) throw conflict("Напиток уже удалён");
      if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) throw conflict("Пользователь уже удалён");
      if (!before) {
        db.prepare("DELETE FROM ratings WHERE drink_id = ? AND user_id = ?").run(drinkId, userId);
      } else {
        if (!db.prepare("SELECT 1 FROM tiers WHERE id = ?").get(before.tier_id)) {
          throw conflict(`Тира ${before.tier_id} больше нет`);
        }
        db.prepare(
          `INSERT INTO ratings (drink_id, user_id, tier_id, review, order_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(drink_id, user_id) DO UPDATE SET tier_id = excluded.tier_id, review = excluded.review,
             order_index = excluded.order_index, updated_at = excluded.updated_at`,
        ).run(drinkId, userId, before.tier_id, before.review, before.order_index, before.created_at, before.updated_at);
      }
      break;
    }
    case "tier": {
      const { id, before } = data;
      if (!before) {
        const used = db.prepare("SELECT COUNT(*) AS n FROM ratings WHERE tier_id = ?").get(id).n;
        if (used) throw conflict(`Тир ${id} уже используется в оценках — удалить нельзя`);
        db.prepare("DELETE FROM tiers WHERE id = ?").run(id);
      } else {
        db.prepare(
          `INSERT INTO tiers (id, title, note, score, position) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET ${TIER_COLS.map((c) => `${c} = excluded.${c}`).join(", ")}`,
        ).run(id, before.title, before.note, before.score, before.position);
      }
      break;
    }
    case "user.create": {
      if (data.id === actor.id) throw conflict("Нельзя удалить себя");
      const rated = db.prepare("SELECT COUNT(*) AS n FROM ratings WHERE user_id = ?").get(data.id).n;
      if (rated) notes.push(`вместе с пользователем удалено оценок: ${rated}`);
      const info = db.prepare("DELETE FROM users WHERE id = ?").run(data.id);
      if (!info.changes) throw conflict("Пользователь уже удалён");
      break;
    }
    case "user.update": {
      const row = data.before;
      if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(row.id)) throw conflict("Пользователь уже удалён");
      if (row.id === actor.id && !row.is_active) throw conflict("Нельзя отключить себя");
      db.prepare(
        `UPDATE users SET ${USER_PROFILE_COLS.map((c) => `${c} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`,
      ).run(...USER_PROFILE_COLS.map((c) => row[c]), row.id);
      if (!row.is_active) auth?.destroyUserSessions(row.id);
      break;
    }
    case "user.delete": {
      const { row, ratings, createdDrinks } = data.before;
      if (db.prepare("SELECT 1 FROM users WHERE id = ? OR username = ?").get(row.id, row.username)) {
        throw conflict("Пользователь с таким id или логином уже существует");
      }
      insertRow(db, "users", row);
      const lost = restoreRatings(db, ratings);
      if (lost) notes.push(`не восстановлено оценок: ${lost}`);
      const setCreator = db.prepare("UPDATE drinks SET created_by = ? WHERE id = ? AND created_by IS NULL");
      for (const id of createdDrinks || []) setCreator.run(row.id, id);
      break;
    }
    case "settings": {
      for (const [key, value] of Object.entries(data.values || {})) {
        if (SECRET_SETTINGS.has(key)) continue;
        setSetting(db, key, value ?? "");
      }
      break;
    }
    default:
      throw badRequest("Это действие нельзя откатить");
  }
  if (activeAdmins(db) < 1) throw conflict("После отката не останется ни одного админа");
  return notes;
}

function blockingEntry(db, entry) {
  if (!entry.target_key) return null;
  return db
    .prepare(
      `SELECT id FROM audit_log WHERE target_key = ? AND id > ? AND undone_at IS NULL AND undo_of IS NULL
       ORDER BY id LIMIT 1`,
    )
    .get(entry.target_key, entry.id);
}

function undoEntry(db, entryId, { actor, auth }) {
  const entry = db.prepare("SELECT * FROM audit_log WHERE id = ?").get(entryId);
  if (!entry) throw notFound("Запись журнала не найдена");
  if (entry.undone_at) throw conflict("Это действие уже откачено");
  if (!entry.undo_data) throw badRequest("Это действие нельзя откатить");
  const blocker = blockingEntry(db, entry);
  if (blocker) {
    throw conflict(`Объект менялся позже (запись #${blocker.id}) — сначала откатите более поздние изменения`);
  }
  const data = JSON.parse(entry.undo_data);
  let notes = [];
  const run = db.transaction(() => {
    notes = applyUndo(db, data, { actor, auth });
    db.prepare("UPDATE audit_log SET undone_at = datetime('now'), undone_by = ? WHERE id = ?").run(actor.id, entry.id);
    writeAudit(db, actor, "audit.undo", entry.entity, entry.entity_id, notes.join("\n"), {
      summary: `Откатил: ${entry.summary || entry.action}`,
      undoOf: entry.id,
      targetKey: entry.target_key,
    });
  });
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (/constraint/i.test(String(error.message))) {
      throw conflict("Откат невозможен: данные уже изменились и конфликтуют");
    }
    throw error;
  }
  return { notes };
}

function listAudit(db, limit = 300) {
  const rows = db
    .prepare(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.summary, a.created_at, a.target_key,
              a.undo_of, a.undone_at, a.undo_data IS NOT NULL AS has_undo,
              u.username, u.display_name, ub.display_name AS undone_by_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN users ub ON ub.id = a.undone_by
       WHERE a.entity NOT IN ('ai', 'error')
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit);
  const seenTargets = new Set();
  // строки идут от новых к старым: откатить можно, только если после записи объект не трогали
  return rows.map((row) => {
    let canUndo = Boolean(row.has_undo) && !row.undone_at && !row.undo_of;
    if (canUndo && row.target_key && seenTargets.has(row.target_key)) canUndo = false;
    if (row.target_key && !row.undone_at && !row.undo_of) seenTargets.add(row.target_key);
    return {
      id: row.id,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      summary: row.summary,
      details: row.details,
      createdAt: row.created_at,
      username: row.username,
      displayName: row.display_name,
      undoOf: row.undo_of,
      undoneAt: row.undone_at,
      undoneBy: row.undone_by_name,
      canUndo,
      undoable: Boolean(row.has_undo),
    };
  });
}

// Логи для админки: запросы к ИИ/STT и ошибки сервера. Отдельно от действий,
// чтобы лимит listAudit не вытеснял откатываемые записи машинными логами.
function listLogs(db, limit = 300) {
  return db
    .prepare(
      `SELECT a.id, a.action, a.entity, a.summary, a.details, a.created_at,
              u.username, u.display_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.entity IN ('ai', 'error')
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({
      id: row.id,
      action: row.action,
      entity: row.entity,
      summary: row.summary,
      details: row.details,
      createdAt: row.created_at,
      username: row.username,
      displayName: row.display_name,
    }));
}

function readSettings(db, keys, defaults = {}) {
  return Object.fromEntries(keys.map((key) => [key, getSetting(db, key, defaults[key] ?? "")]));
}

module.exports = {
  snapDrink,
  snapRating,
  snapTier,
  snapUser,
  recordDrink,
  recordRating,
  recordTier,
  recordUser,
  recordSettings,
  undoEntry,
  listAudit,
  listLogs,
  readSettings,
  quote,
  drinkLabel,
};
