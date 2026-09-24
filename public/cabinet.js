(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
    );
  const safeColor = (value, fallback) =>
    /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? value : fallback;
  const wordForm = (value, forms) => {
    const n = Math.abs(value) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  };

  const api = async (method, path, body) => {
    const res = await fetch(path, {
      method,
      headers: {
        "x-nrg-request": "1",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    return json;
  };

  const TIER_COLORS = { S: "#ff5f5a", A: "#f1a653", B: "#e7d471", C: "#8ebd93", D: "#8093b7" };
  const state = { me: null, summary: null, mine: [], addedSlugs: new Set() };
  const pending = {
    parsed: null,
    image: null,
    original: null, // необработанный оригинал для 🍌 (резаный с кривым фоном модель тупит)
    photoNote: "",
    photoSource: "auto",
    userPhoto: false,
  };

  /* ---------- views ---------- */
  const showAuth = () => {
    $("auth-view").hidden = false;
    $("password-view").hidden = true;
    $("cab-view").hidden = true;
  };
  const showPasswordChange = () => {
    $("auth-view").hidden = true;
    $("password-view").hidden = false;
    $("cab-view").hidden = true;
  };

  const enterCabinet = async () => {
    $("auth-view").hidden = true;
    $("password-view").hidden = true;
    $("cab-view").hidden = false;
    $("me-avatar").textContent =
      state.me.initials || String(state.me.displayName || "?").slice(0, 2).toUpperCase();
    $("me-avatar").style.setProperty("--person-color", safeColor(state.me.color, "#fff"));
    $("me-name").textContent = state.me.displayName;
    $("me-role").textContent = state.me.title || state.me.role;
    $("profile-button").href = `/profile.html?u=${encodeURIComponent(state.me.username)}`;
    $("profile-button").hidden = false;
    if (state.me.role === "admin") $("admin-button").hidden = false;
    if (state.me.role === "admin" || state.me.role === "editor") $("admin-link").hidden = false;
    $("profile-link").href = `profile.html?u=${encodeURIComponent(state.me.username)}`;
    $("profile-link").hidden = !state.me.isPublic;
    await refreshAll();
  };

  const refreshAll = async () => {
    const [summary, mine] = await Promise.all([
      api("GET", "api/public/summary"),
      api("GET", "api/cabinet/me"),
    ]);
    state.summary = summary;
    // мои оценки берём из /me: в summary их нет, если профиль скрыт
    state.mine = mine.ratings || [];
    state.addedSlugs = new Set((mine.addedDrinks || []).map((drink) => drink.slug));
    if (summary.site?.title) document.title = `${summary.site.title} — личный кабинет`;
    renderMine();
    renderUnrated();
  };

  /* ---------- auth ---------- */
  const login = async () => {
    $("auth-status").textContent = "Проверяю…";
    try {
      const { user } = await api("POST", "api/auth/login", {
        username: $("auth-user").value.trim(),
        password: $("auth-pass").value,
      });
      state.me = user;
      $("auth-pass").value = "";
      $("auth-status").textContent = "";
      if (user.mustChangePassword) showPasswordChange();
      else await enterCabinet();
    } catch (error) {
      $("auth-status").textContent = error.message;
    }
  };

  $("btn-login").onclick = login;
  $("auth-user").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  $("auth-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });

  $("btn-set-pass").onclick = async () => {
    const first = $("new-pass").value;
    const second = $("new-pass2").value;
    if (first !== second) {
      $("pass-status").textContent = "Пароли не совпадают";
      return;
    }
    try {
      await api("POST", "api/auth/password", { newPassword: first });
      state.me.mustChangePassword = false;
      $("new-pass").value = "";
      $("new-pass2").value = "";
      $("pass-status").textContent = "";
      await enterCabinet();
    } catch (error) {
      $("pass-status").textContent = error.message;
    }
  };

  $("btn-change-pass").onclick = async () => {
    try {
      await api("POST", "api/auth/password", {
        currentPassword: $("old-pass").value,
        newPassword: $("change-pass").value,
      });
      $("old-pass").value = "";
      $("change-pass").value = "";
      $("sync-status").textContent = "Пароль обновлён ✓";
    } catch (error) {
      $("sync-status").textContent = error.message;
    }
  };

  $("btn-logout").onclick = async () => {
    try {
      await api("POST", "api/auth/logout");
    } catch {
      /* всё равно перезагружаемся */
    }
    location.reload();
  };

  /* ---------- my ratings ---------- */
  const saveRating = async (slug, tier, review) => {
    const current = state.mine.find((item) => item.drink === slug) || {};
    try {
      await api("PUT", `api/cabinet/ratings/${encodeURIComponent(slug)}`, {
        tier: tier || current.tier || "B",
        review: review !== null && review !== undefined ? review : current.review || "",
      });
      await refreshAll();
    } catch (error) {
      alert(error.message);
    }
  };

  const renderMine = () => {
    const container = $("cabinet-my-ratings");
    const all = state.mine;
    $("me-count").textContent = all.length;
    $("me-count-label").textContent = wordForm(all.length, ["оценка", "оценки", "оценок"]);
    if (!all.length) {
      container.innerHTML = `<p class="hint">Пока пусто — опиши первую банку выше или оцени чужую ниже.</p>`;
      return;
    }
    const needle = $("mine-filter").value.trim().toLowerCase();
    const mine = needle
      ? all.filter((item) => `${item.name} ${item.flavor}`.toLowerCase().includes(needle))
      : all;
    if (!mine.length) {
      container.innerHTML = `<p class="hint">Ничего не нашлось по «${esc(needle)}».</p>`;
      return;
    }
    container.innerHTML = mine
      .map((item) => {
        const drink = { id: item.drink, name: item.name, flavor: item.flavor, image: item.image };
        const rating = item;
        const own = state.addedSlugs.has(drink.id);
        return `
        <div class="mine-row" data-drink="${esc(drink.id)}">
          <img src="${esc(drink.image)}" alt="" loading="lazy">
          <div class="mine-row__main">
            <b>${esc(drink.name)}</b><small>${esc(drink.flavor)}</small>
            <textarea rows="2" data-m-review placeholder="Отзыв…">${esc(rating.review || "")}</textarea>
          </div>
          <div class="mine-row__actions">
            <select data-m-tier>${state.summary.tiers
              .map((tier) => `<option ${tier.id === rating.tier ? "selected" : ""}>${esc(tier.id)}</option>`)
              .join("")}</select>
            <button class="btn btn--ghost" type="button" data-m-edit>мнение</button>
            <button class="btn btn--danger" type="button" data-m-del-rating>удалить</button>
            ${own ? `<button class="btn btn--danger" type="button" data-m-del-drink>× банка</button>` : ""}
          </div>
        </div>`;
      })
      .join("");

    container.querySelectorAll(".mine-row").forEach((row) => {
      const slug = row.dataset.drink;
      row.querySelector("[data-m-tier]").onchange = (e) => saveRating(slug, e.target.value, null);
      row.querySelector("[data-m-review]").onchange = (e) => saveRating(slug, null, e.target.value);
      const rating = state.mine.find((item) => item.drink === slug) || {};
      const drink = state.summary.drinks.find((item) => item.id === slug) || { name: rating.name };
      row.querySelector("[data-m-edit]").onclick = () => openOpinion(slug);
      row.querySelector("[data-m-del-rating]").onclick = async () => {
        const ok = await window.nrgConfirm({
          title: "Удалить оценку?",
          message: `Твоя оценка для «${drink?.name || slug}» пропадёт из индекса.`,
          details: [
            `Тир: ${rating.tier || "—"}`,
            rating.review ? `Отзыв: «${String(rating.review).slice(0, 140)}»` : "",
          ],
          confirmText: "Удалить оценку",
        });
        if (!ok) return;
        try {
          await api("DELETE", `api/cabinet/ratings/${encodeURIComponent(slug)}`);
          await refreshAll();
        } catch (error) {
          alert(error.message);
        }
      };
      row.querySelector("[data-m-del-drink]")?.addEventListener("click", async () => {
        const votes = Object.keys(drink?.ratings || {}).length;
        const ok = await window.nrgConfirm({
          title: "Удалить банку?",
          message: `«${drink?.name || slug}» исчезнет из индекса целиком.`,
          details: [votes ? `Вместе с ней удалятся все оценки: ${votes}` : ""],
          confirmText: "Удалить банку",
        });
        if (!ok) return;
        try {
          await api("DELETE", `api/cabinet/drinks/${encodeURIComponent(slug)}`);
          await refreshAll();
        } catch (error) {
          alert(error.message);
        }
      });
    });
  };

  $("mine-filter").addEventListener("input", () => renderMine());

  /* ---------- редактор своего мнения ---------- */
  // Своё мнение целиком: тир и отзыв плюс полное управление фото банки
  // (заменить своим файлом, найти в интернете, убрать). Всё с историей правок.
  const opinion = { slug: "", image: null, remove: false, original: null, originalUrl: null };

  const setOpStatus = (text, isError = false) => {
    $("op-status").textContent = text;
    $("op-status").style.color = isError ? "#ff8a8a" : "";
  };

  const setOpPhotoStatus = (text, isError = false) => {
    $("op-photo-status").textContent = text;
    $("op-photo-status").style.color = isError ? "#ff8a8a" : "";
  };

  const resetOpinionPhotos = () => {
    $("op-photo-strip").hidden = true;
    $("op-photo-track").innerHTML = "";
    $("op-strip-status").textContent = "";
    setOpPhotoStatus("");
  };

  const pickOpinionImage = (dataUrl, note) => {
    opinion.image = dataUrl;
    opinion.remove = false;
    $("op-image").src = dataUrl;
    $("op-image").hidden = false;
    setOpPhotoStatus(note);
  };

  const closeOpinion = () => {
    $("opinion-editor").close();
    document.body.classList.remove("is-dialog-open");
  };

  const openOpinion = (slug) => {
    const item = state.mine.find((row) => row.drink === slug);
    if (!item) return;
    opinion.slug = slug;
    opinion.image = null;
    opinion.remove = false;
    opinion.original = null;
    opinion.originalUrl = null;
    $("op-title").textContent = item.name;
    $("op-sub").textContent = item.flavor || "без вкуса";
    $("op-image").src = item.image || "assets/favicon.svg";
    $("op-image").hidden = false;
    $("op-tier").innerHTML = state.summary.tiers
      .map((tier) => `<option ${tier.id === item.tier ? "selected" : ""}>${esc(tier.id)}</option>`)
      .join("");
    $("op-review").value = item.review || "";
    $("op-photo-file").value = "";
    $("op-photo-query").value = [item.name, item.flavor].filter(Boolean).join(" ");
    resetOpinionPhotos();
    setOpStatus("");
    $("opinion-editor").showModal();
    document.body.classList.add("is-dialog-open");
  };

  $("op-close").onclick = closeOpinion;
  $("op-cancel").onclick = closeOpinion;
  $("opinion-editor").addEventListener("close", () => document.body.classList.remove("is-dialog-open"));

  $("op-photo-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    try {
      setOpPhotoStatus("режу фон…");
      const img = await loadImage(objectUrl);
      opinion.original = shrinkOnly(img);
      opinion.originalUrl = null;
      const { dataUrl, cut } = prepareImage(img);
      pickOpinionImage(dataUrl, cut ? "твоё фото · фон вырезан ✓" : "твоё фото · фон не вырезан");
    } catch {
      setOpPhotoStatus("не удалось прочитать файл", true);
    } finally {
      URL.revokeObjectURL(objectUrl);
      event.target.value = "";
    }
  });

  const searchOpinionPhotos = async () => {
    const query = $("op-photo-query").value.trim();
    if (query.replace(/\s+/g, "").length < 2) {
      setOpPhotoStatus("введи хотя бы 2 символа", true);
      return;
    }
    try {
      setOpPhotoStatus("ищу фото…");
      $("op-photo-strip").hidden = false;
      $("op-photo-track").innerHTML = "";
      const params = new URLSearchParams({ q: query });
      const { images } = await api("GET", `api/cabinet/ai/photo-search?${params}`);
      if (!images?.length) {
        setOpPhotoStatus("ничего не нашлось — уточни запрос", true);
        return;
      }
      setOpPhotoStatus(`${images.length} шт · жми нужное`);
      images.forEach((item) => {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "photo-tile";
        tile.title = item.title || "";
        const img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        bindTileImage(img, tile, item.url);
        tile.appendChild(img);
        tile.onclick = async () => {
          try {
            tile.classList.add("is-loading");
            const dataUrl = await processImageUrl(item.url);
            $("op-photo-track")
              .querySelectorAll(".photo-tile")
              .forEach((node) => node.classList.remove("is-selected"));
            tile.classList.remove("is-loading");
            tile.classList.add("is-selected");
            opinion.original = null;
            opinion.originalUrl = item.url;
            pickOpinionImage(dataUrl, "фото из ленты ✓");
          } catch {
            tile.classList.remove("is-loading");
            setOpPhotoStatus("не удалось взять это фото", true);
          }
        };
        $("op-photo-track").appendChild(tile);
      });
    } catch (error) {
      setOpPhotoStatus(error.message, true);
    }
  };

  $("op-photo-find").onclick = () => {
    $("op-photo-strip").hidden = false;
    $("op-photo-query").focus();
  };
  $("op-photo-search").onclick = searchOpinionPhotos;
  $("op-photo-query").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchOpinionPhotos();
    }
  });
  $("op-photo-remove").onclick = () => {
    opinion.image = null;
    opinion.remove = true;
    opinion.original = null;
    opinion.originalUrl = null;
    $("op-image").src = "assets/favicon.svg";
    setOpPhotoStatus("фото будет убрано при сохранении");
  };

  $("op-photo-redraw").onclick = () =>
    redrawCurrentPhoto({
      get: async () => {
        if (opinion.originalUrl) return originalDataUrl(opinion.originalUrl);
        return opinion.original;
      },
      set: ({ dataUrl, cut }) =>
        pickOpinionImage(dataUrl, cut ? "перерисовано 🍌 · фон снят ✓" : "перерисовано 🍌 · фон снять не вышло"),
      button: $("op-photo-redraw"),
      say: setOpPhotoStatus,
    });

  $("op-save").onclick = async () => {
    const slug = opinion.slug;
    if (!slug) return;
    try {
      setOpStatus("сохраняю…");
      await api("PUT", `api/cabinet/ratings/${encodeURIComponent(slug)}`, {
        tier: $("op-tier").value,
        review: $("op-review").value,
      });
      if (opinion.image) {
        await api("PUT", `api/cabinet/drinks/${encodeURIComponent(slug)}/photo`, {
          imageDataUrl: opinion.image,
        });
      } else if (opinion.remove) {
        await api("PUT", `api/cabinet/drinks/${encodeURIComponent(slug)}/photo`, { removeImage: true });
      }
      closeOpinion();
      await refreshAll();
    } catch (error) {
      setOpStatus(error.message, true);
    }
  };

  /* ---------- unrated ---------- */
  // Банки, которые завели другие, а я ещё не оценил. Тир — одним кликом.
  const UNRATED_PAGE = 12;
  let unratedShown = UNRATED_PAGE;

  const renderUnrated = () => {
    const rated = new Set(state.mine.map((item) => item.drink));
    const list = state.summary.drinks.filter((drink) => !rated.has(drink.id)).reverse();
    $("unrated-block").hidden = !list.length;
    if (!list.length) return;
    $("unrated-count").textContent = `${list.length} ${wordForm(list.length, ["банка", "банки", "банок"])}`;
    const tiers = state.summary.tiers.map((tier) => tier.id);
    $("unrated-list").innerHTML = list
      .slice(0, unratedShown)
      .map(
        (drink) => `
        <div class="unrated-card" data-drink="${esc(drink.id)}">
          <img src="${esc(drink.image)}" alt="" loading="lazy">
          <b>${esc(drink.name)}</b>
          <small>${esc(drink.flavor)}</small>
          <div class="unrated-card__tiers" role="group" aria-label="Тир для ${esc(drink.name)}">
            ${tiers.map((tier) => `<button type="button" data-tier="${esc(tier)}" style="--tier-color:${TIER_COLORS[tier] || "#ff4f79"}">${esc(tier)}</button>`).join("")}
          </div>
        </div>`,
      )
      .join("");
    $("unrated-more").hidden = list.length <= unratedShown;
  };

  $("unrated-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-tier]");
    if (!button) return;
    const card = button.closest(".unrated-card");
    card.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
    });
    try {
      await api("PUT", `api/cabinet/ratings/${encodeURIComponent(card.dataset.drink)}`, {
        tier: button.dataset.tier,
        review: "",
      });
      await refreshAll();
    } catch (error) {
      card.querySelectorAll("button").forEach((b) => {
        b.disabled = false;
      });
      alert(error.message);
    }
  });
  $("unrated-more").onclick = () => {
    unratedShown += UNRATED_PAGE;
    renderUnrated();
  };

  /* ---------- images ---------- */
  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  // Сайты часто режут хотлинк и не отдают CORS — тогда грузим через наш прокси:
  // он same-origin, canvas после него чистый.
  const proxiedPhotoUrl = (url) => `api/cabinet/ai/photo-proxy?url=${encodeURIComponent(url)}`;

  const loadImageWithFallback = async (src) => {
    try {
      return await loadImage(src);
    } catch (error) {
      if (/^(blob:|data:|api\/cabinet\/ai\/photo-proxy)/.test(src)) throw error;
      return await loadImage(proxiedPhotoUrl(src));
    }
  };

  // <img> в лентах: сначала напрямую (не жрём трафик сервера),
  // при ошибке — один раз через прокси, потом убираем плитку.
  const bindTileImage = (img, tile, url) => {
    img.src = url;
    img.onerror = () => {
      if (img.dataset.proxied) {
        tile.remove();
        return;
      }
      img.dataset.proxied = "1";
      img.src = proxiedPhotoUrl(url);
    };
  };

  // Стоковое фото = края картинки прозрачные или ровно белые/светло-серые.
  // Поисковики такого фильтра не дают, поэтому меряем сами по пикселям рамки.
  const STOCK_MIN = 0.8;
  const borderStats = (px, w, h) => {
    const border = [];
    for (let x = 0; x < w; x += 2) border.push(x * 4, ((h - 1) * w + x) * 4);
    for (let y = 0; y < h; y += 2) border.push(y * w * 4, (y * w + w - 1) * 4);
    let clear = 0;
    let white = 0;
    for (const offset of border) {
      if (px[offset + 3] < 16) clear++;
      else if (
        Math.min(px[offset], px[offset + 1], px[offset + 2]) > 225 &&
        Math.max(px[offset], px[offset + 1], px[offset + 2]) - Math.min(px[offset], px[offset + 1], px[offset + 2]) < 18
      ) {
        white++;
      }
    }
    const n = border.length || 1;
    return { border, transparent: clear / n, white: white / n, stock: (clear + white) / n };
  };

  const drawScaled = (img, maxSide) => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, ctx, w, h };
  };

  /**
   * Готовит фото: прозрачный PNG берём как есть, иначе режем белый фон заливкой от краёв.
   * Возвращает { dataUrl, cut, stock } — stock (0..1) = доля «стоковой» рамки.
   */
  const prepareImage = (img, maxSide = 640) => {
    const { canvas, ctx, w, h } = drawScaled(img, maxSide);
    const stats = borderStats(ctx.getImageData(0, 0, w, h).data, w, h);
    if (stats.transparent > 0.6) {
      // фон уже прозрачный: заливка по «цвету» прозрачных пикселей (обычно чёрному) съела бы банку
      return { dataUrl: canvas.toDataURL("image/png"), cut: true, stock: stats.stock };
    }
    const cut = cutWhiteBg(img, maxSide);
    return { dataUrl: cut || shrinkOnly(img, maxSide), cut: Boolean(cut), stock: stats.stock };
  };

  const cutWhiteBg = (img, maxSide = 640) => {
    const { canvas, ctx, w, h } = drawScaled(img, maxSide);
    const imageData = ctx.getImageData(0, 0, w, h);
    const px = imageData.data;

    const { border } = borderStats(px, w, h);
    const channels = [[], [], []];
    for (const offset of border) {
      if (px[offset + 3] < 16) continue;
      channels[0].push(px[offset]);
      channels[1].push(px[offset + 1]);
      channels[2].push(px[offset + 2]);
    }
    if (!channels[0].length) return null;
    const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    const bg = [median(channels[0]), median(channels[1]), median(channels[2])];

    const TOL = 52;
    const BRIGHT_MIN = 120;
    const NEUTRAL_MAX = 34;
    const isBgish = (offset) => {
      if (px[offset + 3] < 16) return true;
      const r = px[offset];
      const g = px[offset + 1];
      const b = px[offset + 2];
      if (Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < TOL) return true;
      return (
        Math.min(r, g, b) > BRIGHT_MIN && Math.max(r, g, b) - Math.min(r, g, b) < NEUTRAL_MAX
      );
    };

    const mask = new Uint8Array(w * h);
    const stack = [];
    const seed = (x, y) => {
      const i = y * w + x;
      if (!mask[i] && isBgish(i * 4)) {
        mask[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < w; x++) {
      seed(x, 0);
      seed(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      seed(0, y);
      seed(w - 1, y);
    }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0 && !mask[i - 1] && isBgish((i - 1) * 4)) {
        mask[i - 1] = 1;
        stack.push(i - 1);
      }
      if (x < w - 1 && !mask[i + 1] && isBgish((i + 1) * 4)) {
        mask[i + 1] = 1;
        stack.push(i + 1);
      }
      if (y > 0 && !mask[i - w] && isBgish((i - w) * 4)) {
        mask[i - w] = 1;
        stack.push(i - w);
      }
      if (y < h - 1 && !mask[i + w] && isBgish((i + w) * 4)) {
        mask[i + w] = 1;
        stack.push(i + w);
      }
    }

    let bgShare = 0;
    for (let i = 0; i < mask.length; i++) bgShare += mask[i];
    bgShare /= mask.length;
    if (bgShare < 0.005) return null;

    const grown = Uint8Array.from(mask);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) continue;
        if (
          (x > 0 && mask[y * w + x - 1]) ||
          (x < w - 1 && mask[y * w + x + 1]) ||
          (y > 0 && mask[(y - 1) * w + x]) ||
          (y < h - 1 && mask[(y + 1) * w + x])
        ) {
          grown[y * w + x] = 1;
        }
      }
    }
    for (let i = 0; i < grown.length; i++) if (grown[i]) px[i * 4 + 3] = 0;
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  };

  /**
   * Снимает зелёный хромакей (фон от Nano Banana) заливкой от краёв — как cutWhiteBg,
   * только предикат «зелёности». Заливка от краёв обязательна: зелёные элементы
   * этикетки внутри банки трогать нельзя. null — рамка не зелёная, не хромакей.
   */
  const cutGreenBg = (img, maxSide = 640) => {
    const { canvas, ctx, w, h } = drawScaled(img, maxSide);
    const imageData = ctx.getImageData(0, 0, w, h);
    const px = imageData.data;

    const isGreen = (r, g, b) => g > 100 && g - r > 50 && g - b > 50;
    const { border } = borderStats(px, w, h);
    const greens = [];
    for (const offset of border) {
      if (px[offset + 3] < 16) continue;
      const r = px[offset];
      const g = px[offset + 1];
      const b = px[offset + 2];
      if (isGreen(r, g, b)) greens.push([r, g, b]);
    }
    if (greens.length < border.length * 0.5) return null;
    const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    const bg = [0, 1, 2].map((channel) => median(greens.map((pixel) => pixel[channel])));

    const TOL = 60;
    const isBgish = (offset) => {
      if (px[offset + 3] < 16) return true;
      const r = px[offset];
      const g = px[offset + 1];
      const b = px[offset + 2];
      return isGreen(r, g, b) && Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < TOL;
    };

    const mask = new Uint8Array(w * h);
    const stack = [];
    const seed = (x, y) => {
      const i = y * w + x;
      if (!mask[i] && isBgish(i * 4)) {
        mask[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < w; x++) {
      seed(x, 0);
      seed(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      seed(0, y);
      seed(w - 1, y);
    }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0 && !mask[i - 1] && isBgish((i - 1) * 4)) {
        mask[i - 1] = 1;
        stack.push(i - 1);
      }
      if (x < w - 1 && !mask[i + 1] && isBgish((i + 1) * 4)) {
        mask[i + 1] = 1;
        stack.push(i + 1);
      }
      if (y > 0 && !mask[i - w] && isBgish((i - w) * 4)) {
        mask[i - w] = 1;
        stack.push(i - w);
      }
      if (y < h - 1 && !mask[i + w] && isBgish((i + w) * 4)) {
        mask[i + w] = 1;
        stack.push(i + w);
      }
    }

    let bgShare = 0;
    for (let i = 0; i < mask.length; i++) bgShare += mask[i];
    bgShare /= mask.length;
    if (bgShare < 0.005) return null;

    const grown = Uint8Array.from(mask);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) continue;
        if (
          (x > 0 && mask[y * w + x - 1]) ||
          (x < w - 1 && mask[y * w + x + 1]) ||
          (y > 0 && mask[(y - 1) * w + x]) ||
          (y < h - 1 && mask[(y + 1) * w + x])
        ) {
          grown[y * w + x] = 1;
        }
      }
    }
    for (let i = 0; i < grown.length; i++) if (grown[i]) px[i * 4 + 3] = 0;
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  };

  const shrinkOnly = (img, maxSide = 640) => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const processImageUrl = async (url) => prepareImage(await loadImageWithFallback(url)).dataUrl;

  // Необработанный оригинал по ссылке: только ужатие, без резки фона.
  // Нужен перерисовке — резаная картинка с кривым фоном путает модель.
  const originalDataUrl = async (url) => shrinkOnly(await loadImageWithFallback(url));

  // Финиш перерисовки: снимаем зелёный хромакей от Nano Banana (заливкой от краёв,
  // зелень этикетки не трогаем). Нет зелени — пробуем белый фон, иначе как есть.
  const finishRedrawn = async (dataUrl) => {
    const img = await loadImage(dataUrl);
    const green = cutGreenBg(img);
    if (green) return { dataUrl: green, cut: true };
    const white = cutWhiteBg(img);
    return { dataUrl: white || shrinkOnly(img), cut: Boolean(white) };
  };

  // Перерисовка через Nano Banana: НЕОБРАБОТАННЫЙ оригинал → прямой ракурс,
  // зелёный хромакей → снимаем его тем же заливным алгоритмом, что режет фон.
  // get/set/статус инжектятся, потому что превьюшек две: смарт-форма и редактор мнения.
  const redrawCurrentPhoto = async ({ get, set, button, say }) => {
    button.disabled = true;
    try {
      say("🍌 беру оригинал…");
      const current = await get();
      if (!current || !current.startsWith("data:")) {
        say("сначала выбери или приложи фото", true);
        return;
      }
      say("🍌 перерисовываю банку…");
      const { imageDataUrl } = await api("POST", "api/cabinet/ai/photo-redraw", { imageDataUrl: current });
      say("🍌 снимаю зелёный фон…");
      set(await finishRedrawn(imageDataUrl));
    } catch (error) {
      say(error.message, true);
    } finally {
      button.disabled = false;
    }
  };

  /* ---------- smart flow ---------- */
  const TIERS = ["S", "A", "B", "C", "D"];

  const fillManual = (parsed) => {
    if (!parsed) return;
    $("m-brand").value = parsed.brand || "";
    $("m-name").value = parsed.name || "";
    $("m-flavor").value = parsed.flavor || "";
    $("m-edition").value = parsed.edition || "";
    $("m-tier").value = TIERS.includes(parsed.tier) ? parsed.tier : "B";
    $("m-review").value = parsed.review || "";
  };

  const showPreview = () => {
    const parsed = pending.parsed;
    if (!parsed) return;
    $("smart-preview").hidden = false;
    $("parsed-title").textContent = `${parsed.brand} — ${parsed.name}`;
    $("parsed-sub").textContent = [parsed.flavor, parsed.edition].filter(Boolean).join(" · ");
    $("parsed-review").textContent =
      parsed.review || "Отзыва в сообщении не было — допиши вручную ниже, если хочешь.";
    $("parsed-tier").textContent = parsed.tier;
    $("parsed-tier").title = parsed.tierGuessed
      ? "Тир не был назван — стоит B по умолчанию, поправь ниже"
      : "Тир из твоего сообщения";
    $("parsed-tier").style.opacity = parsed.tierGuessed ? ".55" : "";
    fillManual(parsed);
    updatePreviewImage();
    $("smart-preview").scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  /* ---------- photo strip ---------- */
  // Лента найденных фото: ищет по бренду + названию + вкусу, каждое фото сразу
  // прогоняется через cutWhiteBg, выбор — кликом. Перезапрашивается при правке полей.
  // photoSource: "auto" — выбрано лентой само, "strip" — кликом, "user"/"url" — своё.
  const strip = { gen: 0, key: "", items: [], selected: -1, timer: null };
  const STRIP_CONCURRENCY = 4;
  const STRIP_DEBOUNCE_MS = 700;

  const photoQuery = () => ({
    brand: $("m-brand").value.trim(),
    name: $("m-name").value.trim(),
    flavor: $("m-flavor").value.trim(),
  });

  const updatePreviewImage = () => {
    const img = $("parsed-img");
    if (pending.image) {
      img.src = pending.image;
      img.hidden = false;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
    }
    if (!pending.parsed) return;
    $("parsed-photo-note").textContent = [
      pending.photoNote,
      pending.parsed.tierGuessed ? "тир не назван — стоит B по умолчанию" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const setStripStatus = (text) => {
    $("photo-strip-status").textContent = text;
  };

  const markSelected = () => {
    $("photo-track")
      .querySelectorAll(".photo-tile")
      .forEach((tile) => {
        const on = Number(tile.dataset.index) === strip.selected;
        tile.classList.toggle("is-selected", on);
        tile.setAttribute("aria-selected", on ? "true" : "false");
      });
  };

  const selectTile = (index, source) => {
    const item = strip.items[index];
    if (!item?.dataUrl) return;
    strip.selected = index;
    pending.image = item.dataUrl;
    pending.photoSource = source;
    pending.userPhoto = false;
    pending.photoNote =
      (source === "auto" ? "фото найдено автоматически ✓" : "фото выбрано из ленты ✓") +
      (item.isStock ? " · стоковое" : item.cut ? "" : " · фон не вырезан");
    markSelected();
    updatePreviewImage();
  };

  const renderTile = (index) => {
    const item = strip.items[index];
    let tile = $("photo-track").querySelector(`[data-index="${index}"]`);
    if (item.state === "failed") {
      tile?.remove();
      return;
    }
    if (!tile && item.state === "ready") {
      tile = document.createElement("button");
      tile.className = "photo-tile";
      tile.type = "button";
      tile.setAttribute("role", "option");
      tile.setAttribute("aria-selected", "false");
      tile.dataset.index = String(index);
      tile.title = item.title;
      $("photo-track").appendChild(tile);
    }
    if (!tile) return;
    tile.classList.toggle("is-loading", item.state === "loading");
    if (item.state !== "ready") return;
    const badge = item.isStock
      ? `<span class="photo-tile__badge photo-tile__badge--stock">сток</span>`
      : item.cut
        ? ""
        : `<span class="photo-tile__badge">фон</span>`;
    tile.innerHTML = `<img src="${item.dataUrl}" alt="">${badge}`;
    tile.classList.toggle("is-stock", item.isStock);
    tile.disabled = false;
    applyStockFilter();
  };

  const readyCount = () => strip.items.filter((item) => item.state === "ready").length;
  const stockCount = () => strip.items.filter((item) => item.state === "ready" && item.isStock).length;

  // «только сток»: прячем фото из жизни, но если стоковых нет вовсе — показываем всё
  const applyStockFilter = () => {
    const only = $("photo-stock-only").checked && stockCount() > 0;
    $("photo-track").classList.toggle("is-stock-only", only);
  };

  // стоковые — в начало ленты (порядок внутри групп сохраняем)
  const sortTiles = () => {
    const track = $("photo-track");
    const tiles = [...track.querySelectorAll(".photo-tile")];
    const rank = (tile) => (strip.items[Number(tile.dataset.index)]?.isStock ? 0 : 1);
    tiles
      .map((tile, order) => ({ tile, order }))
      .sort((a, b) => rank(a.tile) - rank(b.tile) || a.order - b.order)
      .forEach(({ tile }) => track.appendChild(tile));
    track.scrollLeft = 0;
  };

  const finishStrip = () => {
    const ready = readyCount();
    if (!ready) {
      setStripStatus("ничего подходящего — приложи своё фото или ссылку");
      if (pending.photoSource === "auto") {
        pending.image = null;
        pending.original = null;
        pending.photoNote = "фото не нашлось — приложи своё или выбери ссылкой";
        updatePreviewImage();
      }
      return;
    }
    sortTiles();
    applyStockFilter();
    const stock = stockCount();
    setStripStatus(
      `${ready} фото, ${stock ? `стоковых ${stock}` : "стоковых нет"} · листай вправо, жми нужное`,
    );
  };

  const processStrip = async (gen) => {
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < strip.items.length) {
        const index = next++;
        const item = strip.items[index];
        try {
          await new Promise((resolve) => setTimeout(resolve, 0));
          const result = prepareImage(await loadImageWithFallback(item.url));
          item.dataUrl = result.dataUrl;
          item.cut = result.cut;
          item.isStock = result.stock >= STOCK_MIN;
          item.state = "ready";
        } catch {
          item.state = "failed";
        }
        if (gen !== strip.gen) return;
        done++;
        setStripStatus(`режу фон… ${done} / ${strip.items.length}`);
        renderTile(index);
        // пока пользователь ничего не выбрал: берём первое готовое, а как появится
        // стоковое (белый/прозрачный фон) — переключаемся на него
        if (item.state === "ready" && pending.photoSource === "auto") {
          const current = strip.items[strip.selected];
          if (strip.selected < 0 || (!current?.isStock && item.isStock)) selectTile(index, "auto");
        }
      }
    };
    await Promise.all(Array.from({ length: STRIP_CONCURRENCY }, worker));
    if (gen === strip.gen) finishStrip();
  };

  const clearStrip = () => {
    strip.gen++;
    strip.key = "";
    strip.items = [];
    strip.selected = -1;
    clearTimeout(strip.timer);
    $("photo-track").innerHTML = "";
    $("photo-strip").hidden = true;
  };

  const refreshPhotos = async ({ force = false } = {}) => {
    const query = photoQuery();
    const key = [query.brand, query.name, query.flavor].join("|").toLowerCase();
    if (key.replace(/\|/g, "").length < 2) {
      clearStrip();
      return;
    }
    if (!force && key === strip.key) return;
    strip.key = key;
    const gen = ++strip.gen;
    strip.items = [];
    strip.selected = -1;
    $("photo-strip").hidden = false;
    $("photo-track").innerHTML = "";
    setStripStatus("ищу фото…");

    const params = new URLSearchParams();
    for (const [field, value] of Object.entries(query)) if (value) params.set(field, value);
    let images;
    try {
      ({ images } = await api("GET", `api/cabinet/ai/photo-search?${params}`));
    } catch (error) {
      if (gen === strip.gen) setStripStatus(`поиск не ответил: ${error.message}`);
      return;
    }
    if (gen !== strip.gen) return;

    strip.items = (images || []).map((hit) => ({
      url: typeof hit === "string" ? hit : hit.url,
      title: typeof hit === "string" ? "" : hit.title || "",
      state: "loading",
      dataUrl: "",
      cut: false,
      isStock: false,
    }));
    if (!strip.items.length) {
      finishStrip();
      return;
    }
    $("photo-track").innerHTML = "";
    $("photo-track").scrollLeft = 0;
    setStripStatus(`режу фон… 0 / ${strip.items.length}`);
    processStrip(gen);
  };

  const schedulePhotos = () => {
    clearTimeout(strip.timer);
    strip.timer = setTimeout(() => refreshPhotos(), STRIP_DEBOUNCE_MS);
  };

  $("photo-track").addEventListener("click", (event) => {
    const tile = event.target.closest(".photo-tile");
    if (tile && !tile.disabled) selectTile(Number(tile.dataset.index), "strip");
  });
  // колесо мыши листает ленту вбок
  $("photo-track").addEventListener(
    "wheel",
    (event) => {
      const track = event.currentTarget;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (track.scrollWidth <= track.clientWidth) return;
      event.preventDefault();
      track.scrollLeft += event.deltaY;
    },
    { passive: false },
  );
  $("btn-photo-refresh").onclick = () => refreshPhotos({ force: true });
  $("photo-stock-only").addEventListener("change", applyStockFilter);

  const retryPhoto = () => {
    const onlyStock = $("photo-track").classList.contains("is-stock-only");
    const ready = strip.items
      .map((item, index) => (item.state === "ready" && (!onlyStock || item.isStock) ? index : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => Number(!strip.items[a].isStock) - Number(!strip.items[b].isStock) || a - b);
    if (!ready.length) {
      $("smart-status").textContent = "Вариантов нет — приложи своё фото или вставь ссылку.";
      return;
    }
    const pos = ready.indexOf(strip.selected);
    const index = ready[(pos + 1) % ready.length];
    selectTile(index, "strip");
    $("photo-track")
      .querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  const saveDrink = async (parsed) => {
    const body = {
      brand: parsed.brand,
      name: parsed.name,
      flavor: parsed.flavor,
      edition: parsed.edition,
      tier: TIERS.includes(parsed.tier) ? parsed.tier : "B",
      review: parsed.review || "",
    };
    if (pending.image && pending.image.startsWith("data:")) body.imageDataUrl = pending.image;
    await api("POST", "api/cabinet/drinks", body);
    resetSmart();
    $("smart-status").textContent = "В индексе ✓";
    await refreshAll();
  };

  const resetSmart = () => {
    pending.parsed = null;
    pending.image = null;
    pending.original = null;
    pending.userPhoto = false;
    pending.photoSource = "auto";
    pending.photoNote = "";
    clearStrip();
    ["m-brand", "m-name", "m-flavor", "m-edition", "m-review", "m-image-url"].forEach((id) => {
      $(id).value = "";
    });
    $("smart-preview").hidden = true;
    $("smart-input").value = "";
    renderSimilar([]);
    clearVoice();
  };

  // Если ИИ распознал банку, которая уже есть в индексе, — предлагаем оценить её,
  // а не заводить дубль. Тир и отзыв берём из того же разбора.
  const renderSimilar = (similar) => {
    const box = $("similar-box");
    box.hidden = !similar.length;
    if (!similar.length) {
      $("similar-list").innerHTML = "";
      return;
    }
    $("similar-list").innerHTML = similar
      .map(
        (drink) => `
        <div class="similar-row" data-drink="${esc(drink.slug)}">
          <img src="${esc(drink.image)}" alt="" loading="lazy">
          <div><b>${esc(drink.name)}</b><small>${esc(drink.flavor)}${drink.myTier ? ` · у тебя уже ${esc(drink.myTier)}` : ""}</small></div>
          <button class="btn" type="button" data-rate-existing>${drink.myTier ? "Обновить оценку" : "Оценить эту"}</button>
        </div>`,
      )
      .join("");
  };

  $("similar-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-rate-existing]");
    if (!button || !pending.parsed) return;
    const slug = button.closest(".similar-row").dataset.drink;
    const parsed = pending.parsed;
    button.disabled = true;
    try {
      await api("PUT", `api/cabinet/ratings/${encodeURIComponent(slug)}`, {
        tier: TIERS.includes(parsed.tier) ? parsed.tier : "B",
        review: parsed.review || "",
      });
      resetSmart();
      $("smart-status").textContent = parsed.tierGuessed
        ? "Оценка сохранена ✓ Тир не был назван — стоит B, поправь в «Моих оценках»."
        : "Оценка сохранена ✓";
      await refreshAll();
    } catch (error) {
      button.disabled = false;
      $("smart-status").textContent = error.message;
    }
  });

  const submitSmart = async (event) => {
    event.preventDefault();
    const text = $("smart-input").value.trim();
    if (!text) {
      $("smart-status").textContent = "Напиши хоть пару слов или надиктуй войсом.";
      return;
    }
    if ($("btn-smart").disabled) return;
    $("smart-status").textContent = "Нейросеть разбирает…";
    $("btn-smart").disabled = true;
    try {
      const { parsed, similar } = await api("POST", "api/cabinet/ai/parse", { text });
      pending.parsed = parsed;
      renderSimilar(similar || []);
      if (!pending.userPhoto) {
        pending.image = null;
        pending.original = null;
        pending.photoSource = "auto";
        pending.photoNote = "ищу фото…";
      }
      showPreview();
      $("smart-status").textContent = "";
      refreshPhotos();
    } catch (error) {
      $("smart-status").textContent = `${error.message}. Заполни вручную ниже.`;
      document.querySelector("details.cabinet-ai").open = true;
    } finally {
      $("btn-smart").disabled = false;
    }
  };

  $("smart-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      $("smart-form").requestSubmit();
    }
  });

  const submitManual = async () => {
    const parsed = {
      brand: $("m-brand").value.trim(),
      name: $("m-name").value.trim(),
      flavor: $("m-flavor").value.trim(),
      edition: $("m-edition").value.trim(),
      tier: $("m-tier").value,
      review: $("m-review").value.trim(),
    };
    if (!parsed.brand || !parsed.name || !parsed.flavor) {
      $("smart-status").textContent = "Вручную нужны хотя бы бренд, название и вкус.";
      return;
    }
    try {
      await saveDrink(parsed);
    } catch (error) {
      $("smart-status").textContent = error.message;
    }
  };

  $("smart-form").addEventListener("submit", submitSmart);
  $("btn-confirm").onclick = async () => {
    if (!pending.parsed || $("btn-confirm").disabled) return;
    $("btn-confirm").disabled = true;
    $("smart-status").textContent = "Сохраняю…";
    try {
      await saveDrink(pending.parsed);
    } catch (error) {
      $("smart-status").textContent = error.message;
    } finally {
      $("btn-confirm").disabled = false;
    }
  };
  $("btn-retry-photo").onclick = retryPhoto;
  $("btn-manual-save").onclick = submitManual;

  for (const [id, field] of [
    ["m-brand", "brand"],
    ["m-name", "name"],
    ["m-flavor", "flavor"],
    ["m-edition", "edition"],
    ["m-tier", "tier"],
    ["m-review", "review"],
  ]) {
    $(id).addEventListener("input", (event) => {
      if (pending.parsed) {
        pending.parsed[field] = event.target.value;
        if (field === "tier") {
          pending.parsed.tierGuessed = false;
          $("parsed-tier").textContent = event.target.value;
          $("parsed-tier").style.opacity = "";
          $("parsed-tier").title = "Тир выбран вручную";
          updatePreviewImage();
        }
        if (field === "review") {
          $("parsed-review").textContent = event.target.value || "Отзыва нет.";
        }
        $("parsed-title").textContent = `${pending.parsed.brand} — ${pending.parsed.name}`;
        $("parsed-sub").textContent = [pending.parsed.flavor, pending.parsed.edition]
          .filter(Boolean)
          .join(" · ");
      }
      if (["brand", "name", "flavor"].includes(field)) schedulePhotos();
    });
  }

  $("smart-photo").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $("smart-status").textContent = "Режу фон…";
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await loadImage(objectUrl);
      pending.original = shrinkOnly(img);
      const { dataUrl, cut } = prepareImage(img);
      pending.image = dataUrl;
      pending.userPhoto = true;
      pending.photoSource = "user";
      pending.photoNote = cut ? "твоё фото · фон вырезан ✓" : "твоё фото ✓";
      strip.selected = -1;
      markSelected();
      $("smart-status").textContent = "Фото приложено ✓";
      updatePreviewImage();
    } catch {
      $("smart-status").textContent = "Не смог прочитать файл.";
    } finally {
      URL.revokeObjectURL(objectUrl);
      event.target.value = "";
    }
  });

  $("btn-manual-url").onclick = async () => {
    const url = $("m-image-url").value.trim();
    if (!url) return;
    try {
      pending.image = await processImageUrl(url);
      pending.photoSource = "url";
      pending.photoNote = "фото по ссылке ✓";
      strip.selected = -1;
      markSelected();
    } catch {
      pending.photoNote = "не удалось загрузить фото по ссылке (сайт не отдаёт картинку)";
    }
    updatePreviewImage();
    if (!pending.parsed) {
      $("smart-status").textContent = pending.photoSource === "url" ? "Фото взято ✓" : pending.photoNote;
    }
  };

  $("btn-redraw").onclick = () =>
    redrawCurrentPhoto({
      // Шлём НЕОБРАБОТАННЫЙ оригинал: лента — ужатый исходник по ссылке,
      // своё/по ссылке/повтор — сохранённый оригинал, а не резаный.
      get: async () => {
        if (strip.selected >= 0 && strip.items[strip.selected]?.url) {
          return originalDataUrl(strip.items[strip.selected].url);
        }
        if (pending.original) return pending.original;
        const url = $("m-image-url").value.trim();
        if (pending.photoSource === "url" && url) return originalDataUrl(url);
        return null;
      },
      set: ({ dataUrl, cut }) => {
        pending.image = dataUrl;
        pending.photoSource = "redraw";
        pending.photoNote = cut ? "перерисовано 🍌 · фон снят ✓" : "перерисовано 🍌 · фон снять не вышло";
        strip.selected = -1;
        markSelected();
        updatePreviewImage();
        $("smart-status").textContent = "Банка перерисована ✓";
      },
      button: $("btn-redraw"),
      say: (text) => {
        $("smart-status").textContent = text;
      },
    });

  /* ---------- voice ---------- */
  // Запись через MediaRecorder, распознавание — на сервере (Whisper через OpenRouter).
  const MAX_RECORD_MS = 120_000;
  const RECORD_LABEL = "● Войс вместо текста";
  const voice = {
    recorder: null,
    stream: null,
    chunks: [],
    recording: false,
    startedAt: 0,
    durationMs: 0,
    timer: null,
    blob: null,
    url: "",
    busy: false,
  };

  const fmtTime = (ms) => {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };

  const pickMimeType = () => {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
    return (
      ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      ) || ""
    );
  };

  const blobToBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(new Error("Не удалось прочитать запись"));
      reader.readAsDataURL(blob);
    });

  const setRecordButton = (recording) => {
    const button = $("btn-record");
    button.classList.toggle("btn--recording", recording);
    button.textContent = recording ? "■ Стоп" : RECORD_LABEL;
  };

  const clearVoice = () => {
    if (voice.url) URL.revokeObjectURL(voice.url);
    voice.url = "";
    voice.blob = null;
    voice.durationMs = 0;
    const audio = $("voice-audio");
    audio.removeAttribute("src");
    audio.load();
    $("voice-player").hidden = true;
    $("btn-voice-retry").hidden = true;
    $("voice-status").textContent = "";
  };

  // У webm из MediaRecorder в заголовке нет длительности: браузер отдаёт Infinity и плеер пишет 0:00.
  // Прыжок в «бесконечность» заставляет его просканировать файл и вычислить настоящую длительность.
  const fixDuration = (audio) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) return;
    const reset = () => {
      if (!Number.isFinite(audio.duration)) return;
      audio.removeEventListener("durationchange", reset);
      audio.currentTime = 0;
    };
    audio.addEventListener("durationchange", reset);
    try {
      audio.currentTime = Number.MAX_SAFE_INTEGER;
    } catch {
      /* плеер ещё не готов — останется наш таймер */
    }
  };

  const showRecording = () => {
    const audio = $("voice-audio");
    voice.url = URL.createObjectURL(voice.blob);
    audio.addEventListener("loadedmetadata", () => fixDuration(audio), { once: true });
    audio.src = voice.url;
    $("voice-duration").textContent = fmtTime(voice.durationMs);
    $("voice-player").hidden = false;
  };

  const transcribe = async () => {
    if (!voice.blob || voice.busy) return;
    const status = $("voice-status");
    voice.busy = true;
    $("btn-record").disabled = true;
    $("btn-voice-retry").hidden = true;
    status.textContent = "Распознаю голос…";
    try {
      const audio = await blobToBase64(voice.blob);
      const { text } = await api("POST", "api/cabinet/ai/transcribe", {
        audio,
        mimeType: voice.blob.type || "audio/webm",
      });
      const area = $("smart-input");
      area.value = (area.value.trim() ? `${area.value.trim()} ` : "") + text;
      status.textContent = "Распознано ✓ Проверь текст и жми «Распознать и добавить».";
      area.focus();
    } catch (error) {
      status.textContent = `${error.message}. Можно повторить или вписать текст руками.`;
      $("btn-voice-retry").hidden = false;
    } finally {
      voice.busy = false;
      $("btn-record").disabled = false;
    }
  };

  const stopRecording = () => {
    if (!voice.recording) return;
    voice.recording = false;
    voice.durationMs = Date.now() - voice.startedAt;
    clearInterval(voice.timer);
    setRecordButton(false);
    voice.recorder?.stop();
  };

  const startRecording = async () => {
    const status = $("voice-status");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      status.textContent = "Браузер не умеет записывать звук — впиши текст руками.";
      return;
    }
    try {
      voice.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      status.textContent = "Нет доступа к микрофону.";
      return;
    }
    clearVoice();
    const mimeType = pickMimeType();
    voice.chunks = [];
    voice.recorder = new MediaRecorder(voice.stream, mimeType ? { mimeType } : undefined);
    voice.recorder.ondataavailable = (event) => {
      if (event.data.size) voice.chunks.push(event.data);
    };
    voice.recorder.onstop = () => {
      voice.stream?.getTracks().forEach((track) => track.stop());
      voice.stream = null;
      const type = voice.recorder.mimeType || mimeType || "audio/webm";
      voice.blob = new Blob(voice.chunks, { type });
      voice.chunks = [];
      if (!voice.blob.size || voice.durationMs < 600) {
        clearVoice();
        status.textContent = "Слишком коротко — зажми подольше.";
        return;
      }
      showRecording();
      transcribe();
    };
    voice.recorder.start(250);
    voice.recording = true;
    voice.startedAt = Date.now();
    setRecordButton(true);
    status.textContent = "Запись 0:00 — говори, потом жми «Стоп»";
    voice.timer = setInterval(() => {
      const elapsed = Date.now() - voice.startedAt;
      status.textContent = `Запись ${fmtTime(elapsed)} — говори, потом жми «Стоп»`;
      if (elapsed >= MAX_RECORD_MS) stopRecording();
    }, 250);
  };

  $("btn-record").onclick = () => (voice.recording ? stopRecording() : startRecording());
  $("btn-voice-retry").onclick = transcribe;
  $("btn-voice-clear").onclick = clearVoice;
  $("voice-audio").addEventListener("timeupdate", (event) => {
    const audio = event.target;
    if (!voice.durationMs) return;
    const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : voice.durationMs;
    $("voice-duration").textContent =
      audio.currentTime > 0 && !audio.paused
        ? `${fmtTime(audio.currentTime * 1000)} / ${fmtTime(total)}`
        : fmtTime(total);
  });

  /* ---------- init ---------- */
  (async () => {
    try {
      const { user } = await api("GET", "api/auth/me");
      state.me = user;
    } catch {
      state.me = null;
    }
    if (!state.me) return showAuth();
    if (state.me.mustChangePassword) return showPasswordChange();
    return enterCabinet();
  })();
})();
