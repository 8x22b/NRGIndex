const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'editor', 'user')),
    title TEXT NOT NULL DEFAULT '',
    password_hash TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    initials TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#9fb7ff',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE tiers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    score INTEGER NOT NULL,
    position INTEGER NOT NULL
  );

  CREATE TABLE drinks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
    brand TEXT NOT NULL,
    name TEXT NOT NULL,
    flavor TEXT NOT NULL DEFAULT '',
    edition TEXT NOT NULL DEFAULT '',
    image_path TEXT NOT NULL DEFAULT '',
    source_label TEXT NOT NULL DEFAULT '',
    accent_a TEXT NOT NULL DEFAULT '#ff4f79',
    accent_b TEXT NOT NULL DEFAULT '#ff7448',
    is_published INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_drinks_published ON drinks(is_published);

  CREATE TABLE drink_relations (
    drink_id INTEGER NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
    related_id INTEGER NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
    PRIMARY KEY (drink_id, related_id),
    CHECK (drink_id <> related_id)
  );

  CREATE TABLE ratings (
    drink_id INTEGER NOT NULL REFERENCES drinks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier_id TEXT NOT NULL REFERENCES tiers(id),
    review TEXT NOT NULL DEFAULT '',
    order_index INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (drink_id, user_id)
  );
  CREATE INDEX idx_ratings_user ON ratings(user_id);
  CREATE INDEX idx_ratings_tier ON ratings(tier_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_audit_created ON audit_log(created_at);

  CREATE TABLE login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    success INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_login_attempts ON login_attempts(ip, username, created_at);

  INSERT INTO settings (key, value) VALUES
    ('site_title', 'NRG / INDEX'),
    ('site_description', 'Коллективный тирлист энергетиков'),
    ('openrouter_model', 'openai/gpt-4o-mini');

  INSERT INTO tiers (id, title, note, score, position) VALUES
    ('S', 'Supreme', 'Безоговорочно в холодильник', 5, 1),
    ('A', 'Excellent', 'Сильный повтор', 4, 2),
    ('B', 'Good', 'Нормальная смена', 3, 3),
    ('C', 'Situational', 'Только при обстоятельствах', 2, 4),
    ('D', 'Regret', 'Энергия ошибки', 1, 5);
  `,
  `
  ALTER TABLE users ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1;
  `,
  `
  ALTER TABLE audit_log ADD COLUMN summary TEXT NOT NULL DEFAULT '';
  ALTER TABLE audit_log ADD COLUMN undo_data TEXT;
  ALTER TABLE audit_log ADD COLUMN undo_of INTEGER;
  ALTER TABLE audit_log ADD COLUMN undone_at TEXT;
  ALTER TABLE audit_log ADD COLUMN undone_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE audit_log ADD COLUMN target_key TEXT NOT NULL DEFAULT '';
  CREATE INDEX idx_audit_target ON audit_log(target_key, id);
  `,
  `
  ALTER TABLE drinks ADD COLUMN image_width INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE drinks ADD COLUMN image_height INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE drinks ADD COLUMN image_srcset TEXT NOT NULL DEFAULT '';
  `,
  `
  ALTER TABLE users ADD COLUMN avatar_path TEXT NOT NULL DEFAULT '';
  `,
];

function migrate(db) {
  const current = db.pragma("user_version", { simple: true });
  for (let version = current; version < MIGRATIONS.length; version++) {
    const apply = db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    });
    apply();
  }
}

function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function getSetting(db, key, fallback = "") {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
}

function writeAudit(db, user, action, entity = "", entityId = "", details = "", extra = {}) {
  return db
    .prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, details, summary, undo_data, undo_of, target_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user?.id ?? null,
      action,
      entity,
      String(entityId ?? ""),
      details,
      extra.summary || "",
      extra.undoData ? JSON.stringify(extra.undoData) : null,
      extra.undoOf ?? null,
      extra.targetKey || "",
    ).lastInsertRowid;
}

module.exports = { openDatabase, migrate, getSetting, setSetting, writeAudit, MIGRATIONS };
