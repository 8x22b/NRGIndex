const express = require("express");
const crypto = require("node:crypto");
const { hashPassword } = require("../auth");
const { notFound, badRequest, conflict, forbidden } = require("../lib/errors");
const { str, username, password, oneOf, int, color, idArray } = require("../lib/validate");
const { writeAudit, getSetting, setSetting } = require("../db");
const { ACCENTS, touchContent, uniqueSlug, ratingsForDrink, relationsForDrink } = require("../lib/content");
const { saveProcessedImage, reprocessStoredImage } = require("../lib/images");
const { userToApi, drinkToAdmin } = require("../lib/serialize");
const { TIERS, aiSettings, DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_STT_MODEL, normalizeBaseUrl, providerFailureDetail } = require("../lib/ai");
const history = require("../lib/history");
const { normalizeProxyUrl, maskProxyUrl, proxiedFetch } = require("../lib/proxy");

const ROLES = ["admin", "editor", "user"];

const tempPassword = () => crypto.randomBytes(9).toString("base64url");

module.exports = (db, auth, config) => {
  const router = express.Router();
  const isAdmin = (req) => req.user.role === "admin";
  const requireAdmin = (req, res, next) => (isAdmin(req) ? next() : next(forbidden()));

  const activeAdmins = () =>
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get().n;

  function getUser(id) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!row) throw notFound("Пользователь не найден");
    return row;
  }

  function ensureRelatedExist(relatedIds, selfId) {
    const check = db.prepare("SELECT 1 FROM drinks WHERE id = ?");
    for (const id of relatedIds) {
      if (id !== selfId && !check.get(id)) throw badRequest(`Напиток #${id} не найден`);
    }
  }

  function setRelations(drinkId, relatedIds) {
    ensureRelatedExist(relatedIds, drinkId);
    db.prepare("DELETE FROM drink_relations WHERE drink_id = ?").run(drinkId);
    const insert = db.prepare("INSERT OR IGNORE INTO drink_relations (drink_id, related_id) VALUES (?, ?)");
    for (const relatedId of relatedIds) {
      if (relatedId !== drinkId) insert.run(drinkId, relatedId);
    }
  }

  function drinkFields(body, drink = {}) {
    return {
      brand: str(body?.brand ?? drink.brand, "Бренд", { max: 80 }),
      name: str(body?.name ?? drink.name, "Название", { max: 120 }),
      flavor: str(body?.flavor ?? drink.flavor ?? "", "Вкус", { required: false, max: 160 }),
      edition: str(body?.edition ?? drink.edition ?? "", "Издание", { required: false, max: 160 }),
      sourceLabel: str(body?.sourceLabel ?? drink.source_label ?? "", "Источник", {
        required: false,
        max: 160,
      }),
      accentA: color(body?.accentA ?? drink.accent_a, "Акцент A", null),
      accentB: color(body?.accentB ?? drink.accent_b, "Акцент B", null),
      published:
        body?.published === undefined ? Boolean(drink.is_published ?? true) : Boolean(body.published),
    };
  }

  router.get("/data", (req, res) => {
    const drinks = db
      .prepare("SELECT * FROM drinks ORDER BY id")
      .all()
      .map((drink) => drinkToAdmin(drink, ratingsForDrink(db, drink.id), relationsForDrink(db, drink.id)));
    const tiers = db
      .prepare("SELECT id, title, note, score, position FROM tiers ORDER BY position, id")
      .all();
    const users = db.prepare("SELECT * FROM users ORDER BY id").all().map(userToApi);
    const ai = aiSettings(db);
    const settings = {
      siteTitle: getSetting(db, "site_title", "NRG / INDEX"),
      siteDescription: getSetting(db, "site_description", ""),
      openrouterModel: ai.model,
      sttModel: ai.sttModel,
      aiBaseUrl: ai.baseUrl,
      aiProxyUrl: maskProxyUrl(ai.proxyUrl),
      aiProxyFromEnv: !getSetting(db, "ai_proxy_url", "") && Boolean(process.env.AI_PROXY_URL),
      openrouterKeySet: Boolean(ai.key),
      defaults: { aiBaseUrl: DEFAULT_BASE_URL, openrouterModel: DEFAULT_MODEL, sttModel: DEFAULT_STT_MODEL },
    };
    const audit = isAdmin(req) ? history.listAudit(db) : [];
    res.json({ me: req.user, drinks, tiers, users, settings, audit });
  });

  router.post("/audit/:id/undo", requireAdmin, (req, res) => {
    const id = int(req.params.id, "id", { min: 1 });
    const { notes } = history.undoEntry(db, id, { actor: req.user, auth });
    touchContent(db);
    res.json({ ok: true, notes });
  });

  // ---------- drinks (editor+) ----------

  router.post("/drinks", async (req, res) => {
    const fields = drinkFields(req.body);
    const relatedIds = idArray(req.body?.relatedIds, "Похожие", { max: 50 });
    const image = req.body?.imageDataUrl
      ? await saveProcessedImage(config.uploadsDir, req.body.imageDataUrl, config.maxUploadBytes)
      : null;
    const imagePath = image
      ? image.path
      : str(req.body?.image ?? "", "Картинка", { required: false, max: 300 });
    const accent =
      image?.accent ||
      ACCENTS[db.prepare("SELECT COUNT(*) AS n FROM drinks").get().n % ACCENTS.length];
    const slug = uniqueSlug(db, `${fields.brand}-${fields.flavor || fields.name}`);

    const create = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO drinks (slug, brand, name, flavor, edition, image_path, source_label, accent_a, accent_b, is_published, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          slug,
          fields.brand,
          fields.name,
          fields.flavor,
          fields.edition,
          imagePath,
          fields.sourceLabel,
          fields.accentA || accent[0],
          fields.accentB || accent[1],
          fields.published ? 1 : 0,
          req.user.id,
        );
      setRelations(info.lastInsertRowid, relatedIds);
      return info.lastInsertRowid;
    });

    const id = create();
    history.recordDrink(db, req.user, "admin.drink.create", null, history.snapDrink(db, id));
    touchContent(db);
    const row = db.prepare("SELECT * FROM drinks WHERE id = ?").get(id);
    res.status(201).json({ drink: drinkToAdmin(row, ratingsForDrink(db, id), relationsForDrink(db, id)) });
  });

  router.patch("/drinks/:id", async (req, res) => {
    const id = int(req.params.id, "id", { min: 1 });
    const drink = db.prepare("SELECT * FROM drinks WHERE id = ?").get(id);
    if (!drink) throw notFound("Напиток не найден");
    const before = history.snapDrink(db, id);
    const fields = drinkFields(req.body, drink);
    const image = req.body?.imageDataUrl
      ? await saveProcessedImage(config.uploadsDir, req.body.imageDataUrl, config.maxUploadBytes)
      : null;
    const imagePath = image
      ? image.path
      : req.body?.removeImage
        ? ""
        : drink.image_path;
    const accentA = fields.accentA || image?.accent?.[0] || drink.accent_a;
    const accentB = fields.accentB || image?.accent?.[1] || drink.accent_b;
    db.prepare(
      `UPDATE drinks SET brand = ?, name = ?, flavor = ?, edition = ?, image_path = ?,
         source_label = ?, accent_a = ?, accent_b = ?, is_published = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      fields.brand,
      fields.name,
      fields.flavor,
      fields.edition,
      imagePath,
      fields.sourceLabel,
      accentA,
      accentB,
      fields.published ? 1 : 0,
      id,
    );
    if (req.body?.relatedIds !== undefined) {
      setRelations(id, idArray(req.body.relatedIds, "Похожие", { max: 50 }));
    }
    history.recordDrink(db, req.user, "admin.drink.update", before, history.snapDrink(db, id));
    touchContent(db);
    const row = db.prepare("SELECT * FROM drinks WHERE id = ?").get(id);
    res.json({ drink: drinkToAdmin(row, ratingsForDrink(db, id), relationsForDrink(db, id)) });
  });

  router.post("/drinks/:id/reprocess-image", async (req, res) => {
    const id = int(req.params.id, "id", { min: 1 });
    const drink = db.prepare("SELECT * FROM drinks WHERE id = ?").get(id);
    if (!drink) throw notFound("Напиток не найден");
    const result = await reprocessStoredImage(config.uploadsDir, drink.image_path);
    if (!result) throw badRequest("Переобработать можно только картинки из /uploads");
    const before = history.snapDrink(db, id);
    db.prepare(
      "UPDATE drinks SET image_path = ?, accent_a = ?, accent_b = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(result.path, result.accent[0], result.accent[1], id);
    history.recordDrink(db, req.user, "admin.drink.reprocess", before, history.snapDrink(db, id));
    touchContent(db);
    const row = db.prepare("SELECT * FROM drinks WHERE id = ?").get(id);
    res.json({ drink: drinkToAdmin(row, ratingsForDrink(db, id), relationsForDrink(db, id)) });
  });

  router.delete("/drinks/:id", (req, res) => {
    const id = int(req.params.id, "id", { min: 1 });
    const drink = db.prepare("SELECT * FROM drinks WHERE id = ?").get(id);
    if (!drink) throw notFound("Напиток не найден");
    const before = history.snapDrink(db, id, { full: true });
    db.prepare("DELETE FROM drinks WHERE id = ?").run(id);
    history.recordDrink(db, req.user, "admin.drink.delete", before, null);
    touchContent(db);
    res.json({ ok: true });
  });

  router.put("/ratings/:drinkId/:userId", (req, res) => {
    const drinkId = int(req.params.drinkId, "drinkId", { min: 1 });
    const userId = int(req.params.userId, "userId", { min: 1 });
    const drink = db.prepare("SELECT id, slug, name FROM drinks WHERE id = ?").get(drinkId);
    if (!drink) throw notFound("Напиток не найден");
    const user = getUser(userId);
    const tier = oneOf(String(req.body?.tier || ""), TIERS, "Тир");
    const review = str(req.body?.review ?? "", "Отзыв", { required: false, max: 1000 });
    const before = history.snapRating(db, drinkId, userId);
    db.prepare(
      `INSERT INTO ratings (drink_id, user_id, tier_id, review) VALUES (?, ?, ?, ?)
       ON CONFLICT(drink_id, user_id)
       DO UPDATE SET tier_id = excluded.tier_id, review = excluded.review, updated_at = datetime('now')`,
    ).run(drinkId, userId, tier, review);
    history.recordRating(db, req.user, "admin.rating.set", {
      drink,
      user,
      before,
      after: history.snapRating(db, drinkId, userId),
    });
    touchContent(db);
    res.json({ ok: true });
  });

  router.delete("/ratings/:drinkId/:userId", (req, res) => {
    const drinkId = int(req.params.drinkId, "drinkId", { min: 1 });
    const userId = int(req.params.userId, "userId", { min: 1 });
    const drink = db.prepare("SELECT id, slug, name FROM drinks WHERE id = ?").get(drinkId);
    if (!drink) throw notFound("Напиток не найден");
    const user = getUser(userId);
    const before = history.snapRating(db, drinkId, userId);
    if (!before) throw notFound("Оценки нет");
    db.prepare("DELETE FROM ratings WHERE drink_id = ? AND user_id = ?").run(drinkId, userId);
    history.recordRating(db, req.user, "admin.rating.delete", { drink, user, before, after: null });
    touchContent(db);
    res.json({ ok: true });
  });

  // ---------- tiers (admin) ----------

  router.post("/tiers", requireAdmin, (req, res) => {
    const id = str(req.body?.id, "ID тира", { min: 1, max: 8 }).toUpperCase();
    if (!/^[A-Z0-9]{1,8}$/.test(id)) throw badRequest("ID тира: латиница/цифры, до 8 символов");
    const title = str(req.body?.title, "Название", { max: 60 });
    const note = str(req.body?.note ?? "", "Описание", { required: false, max: 200 });
    const score = int(req.body?.score, "Балл", { min: 1, max: 100 });
    const position = int(req.body?.position, "Позиция", { min: 0, max: 1000 });
    try {
      db.prepare("INSERT INTO tiers (id, title, note, score, position) VALUES (?, ?, ?, ?, ?)").run(
        id,
        title,
        note,
        score,
        position,
      );
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw conflict("Такой тир уже есть");
      throw error;
    }
    history.recordTier(db, req.user, "admin.tier.create", null, history.snapTier(db, id));
    touchContent(db);
    res.status(201).json({ ok: true });
  });

  router.patch("/tiers/:id", requireAdmin, (req, res) => {
    const id = req.params.id.toUpperCase();
    const tier = db.prepare("SELECT * FROM tiers WHERE id = ?").get(id);
    if (!tier) throw notFound("Тир не найден");
    const title = str(req.body?.title ?? tier.title, "Название", { max: 60 });
    const note = str(req.body?.note ?? tier.note, "Описание", { required: false, max: 200 });
    const score = int(req.body?.score ?? tier.score, "Балл", { min: 1, max: 100 });
    const position = int(req.body?.position ?? tier.position, "Позиция", { min: 0, max: 1000 });
    db.prepare("UPDATE tiers SET title = ?, note = ?, score = ?, position = ? WHERE id = ?").run(
      title,
      note,
      score,
      position,
      id,
    );
    history.recordTier(db, req.user, "admin.tier.update", tier, history.snapTier(db, id));
    touchContent(db);
    res.json({ ok: true });
  });

  router.delete("/tiers/:id", requireAdmin, (req, res) => {
    const id = req.params.id.toUpperCase();
    const used = db.prepare("SELECT COUNT(*) AS n FROM ratings WHERE tier_id = ?").get(id).n;
    if (used) throw conflict("Тир используется в оценках — сначала переведите их");
    const before = history.snapTier(db, id);
    if (!before) throw notFound("Тир не найден");
    db.prepare("DELETE FROM tiers WHERE id = ?").run(id);
    history.recordTier(db, req.user, "admin.tier.delete", before, null);
    touchContent(db);
    res.json({ ok: true });
  });

  // ---------- users (admin) ----------

  router.post("/users", requireAdmin, async (req, res) => {
    const uname = username(req.body?.username);
    const displayName = str(req.body?.displayName, "Имя", { max: 80 });
    const role = oneOf(String(req.body?.role || "user"), ROLES, "Роль");
    const title = str(req.body?.title ?? "", "Должность", { required: false, max: 80 });
    const initials = str(req.body?.initials ?? "", "Инициалы", { required: false, max: 4 });
    const userColor = color(req.body?.color, "Цвет", "#9fb7ff");
    const isPublic = req.body?.isPublic === undefined ? true : Boolean(req.body.isPublic);
    const given = typeof req.body?.password === "string" && req.body.password ? password(req.body.password) : "";
    const generated = given ? "" : tempPassword();
    const hash = await hashPassword(given || generated);

    let id;
    try {
      const info = db
        .prepare(
          `INSERT INTO users (username, display_name, role, title, initials, color, password_hash, must_change_password, is_public)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(uname, displayName, role, title, initials, userColor, hash, given ? 0 : 1, isPublic ? 1 : 0);
      id = info.lastInsertRowid;
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw conflict("Логин уже занят");
      throw error;
    }
    history.recordUser(db, req.user, "admin.user.create", null, history.snapUser(db, id));
    const row = getUser(id);
    res.status(201).json({ user: userToApi(row), tempPassword: generated || undefined });
  });

  router.patch("/users/:id", requireAdmin, (req, res) => {
    const id = int(req.params.id, "id", { min: 1 });
    const target = getUser(id);
    const role = oneOf(String(req.body?.role ?? target.role), ROLES, "Роль");
    const isActive = req.body?.isActive === undefined ? Boolean(target.is_active) : Boolean(req.body.isActive);
    const losesAdmin = target.role === "admin" && (role !== "admin" || !isActive);
    if (losesAdmin && activeAdmins() <= 1) throw conflict("Нельзя убрать последнего админа");
    if (id === req.user.id && !isActive) throw conflict("Нельзя отключить себя");

    const uname = req.body?.username === undefined ? target.username : username(req.body.username);
    if (uname !== target.username) {
      const taken = db.prepare("SELECT 1 FROM users WHERE username = ? AND id != ?").get(uname, id);
      if (taken) throw conflict("Логин уже занят");
    }
    const displayName = str(req.body?.displayName ?? target.display_name, "Имя", { max: 80 });
    const title = str(req.body?.title ?? target.title, "Должность", { required: false, max: 80 });
    const initials = str(req.body?.initials ?? target.initials, "Инициалы", { required: false, max: 4 });
    const userColor = color(req.body?.color ?? target.color, "Цвет", target.color || "#9fb7ff");
    const isPublic =
      req.body?.isPublic === undefined ? Boolean(target.is_public) : Boolean(req.body.isPublic);

    try {
      db.prepare(
        `UPDATE users SET username = ?, display_name = ?, role = ?, title = ?, initials = ?, color = ?, is_active = ?,
           is_public = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(uname, displayName, role, title, initials, userColor, isActive ? 1 : 0, isPublic ? 1 : 0, id);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw conflict("Логин уже занят");
      throw error;
    }
    if (!isActive) auth.destroyUserSessions(id);
    history.recordUser(db, req.user, "admin.user.update", { row: target }, history.snapUser(db, id));
    if (target.is_public !== (isPublic ? 1 : 0) || target.username !== uname) touchContent(db);
    res.json({ user: userToApi(getUser(id)) });
  });

  router.post("/users/:id/password", requireAdmin, async (req, res) => {
    const id = int(req.params.id, "id", { min: 1 });
    getUser(id);
    const generated = req.body?.password ? password(req.body.password) : tempPassword();
    const hash = await hashPassword(generated);
    db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?",
    ).run(hash, id);
    auth.destroyUserSessions(id);
    const target = getUser(id);
    writeAudit(db, req.user, "admin.user.password", "user", String(id), "Старые сессии завершены, при входе потребуется сменить пароль", {
      summary: `Сбросил пароль ${target.display_name} (@${target.username})`,
    });
    res.json({ tempPassword: req.body?.password ? undefined : generated });
  });

  router.delete("/users/:id", requireAdmin, (req, res) => {
    const id = int(req.params.id, "id", { min: 1 });
    const target = getUser(id);
    if (id === req.user.id) throw conflict("Нельзя удалить себя");
    if (target.role === "admin" && activeAdmins() <= 1) throw conflict("Нельзя удалить последнего админа");
    const before = history.snapUser(db, id, { full: true });
    db.prepare("DELETE FROM users WHERE id = ?").run(id);
    history.recordUser(db, req.user, "admin.user.delete", before, null);
    touchContent(db);
    res.json({ ok: true });
  });

  // ---------- settings (admin) ----------

  router.put("/settings", requireAdmin, (req, res) => {
    const body = req.body || {};
    const next = {};
    if ("siteTitle" in body) next.site_title = str(body.siteTitle, "Заголовок", { max: 120 });
    if ("siteDescription" in body) {
      next.site_description = str(body.siteDescription ?? "", "Описание", { required: false, max: 300 });
    }
    if ("openrouterModel" in body) {
      next.openrouter_model = str(body.openrouterModel || DEFAULT_MODEL, "Модель", { max: 120 });
    }
    if ("sttModel" in body) {
      next.stt_model = str(body.sttModel || DEFAULT_STT_MODEL, "STT-модель", { max: 120 });
    }
    if ("aiBaseUrl" in body) {
      next.ai_base_url = normalizeBaseUrl(str(body.aiBaseUrl || DEFAULT_BASE_URL, "Base URL", { max: 300 }));
    }
    if ("openrouterKey" in body) {
      next.openrouter_key = str(body.openrouterKey ?? "", "Ключ", { required: false, max: 300 });
    }
    if ("aiProxyUrl" in body) {
      const raw = str(body.aiProxyUrl ?? "", "Прокси", { required: false, max: 500 });
      const stored = getSetting(db, "ai_proxy_url", "");
      // админка получает адрес с *** вместо пароля — если его не трогали, оставляем как есть
      if (!(stored && raw === maskProxyUrl(stored))) next.ai_proxy_url = normalizeProxyUrl(raw);
    }
    const ai = aiSettings(db);
    const effective = {
      openrouter_model: ai.model,
      stt_model: ai.sttModel,
      ai_base_url: ai.baseUrl,
      openrouter_key: getSetting(db, "openrouter_key", ""),
      ai_proxy_url: getSetting(db, "ai_proxy_url", ""),
    };
    const before = Object.fromEntries(
      Object.keys(next).map((key) => [key, key in effective ? effective[key] : getSetting(db, key, "")]),
    );
    const save = db.transaction(() => {
      for (const [key, value] of Object.entries(next)) setSetting(db, key, value);
      history.recordSettings(db, req.user, before, next);
    });
    save();
    if ("site_title" in next || "site_description" in next) touchContent(db);
    const changed = Object.keys(next).filter((key) => before[key] !== next[key]);
    res.json({ ok: true, changed });
  });

  // Проверка связи с ИИ-провайдером (через прокси, если задан): GET {base}/models.
  // Можно передать несохранённый прокси из формы — проверим его, ничего не сохраняя.
  router.post("/settings/ai-check", requireAdmin, async (req, res) => {
    const ai = aiSettings(db);
    let proxyUrl = ai.proxyUrl;
    if (req.body && "aiProxyUrl" in req.body) {
      const raw = str(req.body.aiProxyUrl ?? "", "Прокси", { required: false, max: 500 });
      proxyUrl = ai.proxyUrl && raw === maskProxyUrl(ai.proxyUrl) ? ai.proxyUrl : normalizeProxyUrl(raw);
    }
    const started = Date.now();
    let response;
    try {
      response = await proxiedFetch(proxyUrl)(`${ai.baseUrl}/models`, {
        headers: ai.key ? { Authorization: `Bearer ${ai.key}` } : {},
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      return res.json({
        ok: false,
        viaProxy: Boolean(proxyUrl),
        error: timeout ? "нет ответа за 15 с" : String(error?.message || "ошибка сети").slice(0, 200),
      });
    }
    let detail = "";
    if (!response.ok) detail = await providerFailureDetail(response);
    res.json({
      ok: response.ok,
      viaProxy: Boolean(proxyUrl),
      status: response.status,
      ms: Date.now() - started,
      error: response.ok ? "" : [`HTTP ${response.status}`, detail].filter(Boolean).join(" — "),
    });
  });

  return router;
};
