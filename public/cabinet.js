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

  const state = { me: null, summary: null, addedSlugs: new Set() };
  const pending = {
    parsed: null,
    image: null,
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
    if (state.me.role === "admin") $("admin-button").hidden = false;
    if (state.me.role === "admin" || state.me.role === "editor") $("admin-link").hidden = false;
    await refreshAll();
  };

  const refreshAll = async () => {
    const [summary, mine] = await Promise.all([
      api("GET", "api/public/summary"),
      api("GET", "api/cabinet/me"),
    ]);
    state.summary = summary;
    state.addedSlugs = new Set((mine.addedDrinks || []).map((drink) => drink.slug));
    if (summary.site?.title) document.title = `${summary.site.title} — личный кабинет`;
    renderMine();
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
    const drink = state.summary.drinks.find((item) => item.id === slug);
    const current = drink?.ratings?.[state.me.username] || {};
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
    const mine = state.summary.drinks.filter((drink) => drink.ratings?.[state.me.username]);
    $("me-count").textContent = mine.length;
    $("me-count-label").textContent = wordForm(mine.length, ["оценка", "оценки", "оценок"]);
    if (!mine.length) {
      container.innerHTML = `<p class="hint">Пока пусто — опиши первую банку выше.</p>`;
      return;
    }
    container.innerHTML = mine
      .map((drink) => {
        const rating = drink.ratings[state.me.username];
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
            <button class="btn btn--ghost" type="button" data-m-del-rating>− оценка</button>
            ${own ? `<button class="btn btn--danger" type="button" data-m-del-drink>× банка</button>` : ""}
          </div>
        </div>`;
      })
      .join("");

    container.querySelectorAll(".mine-row").forEach((row) => {
      const slug = row.dataset.drink;
      row.querySelector("[data-m-tier]").onchange = (e) => saveRating(slug, e.target.value, null);
      row.querySelector("[data-m-review]").onchange = (e) => saveRating(slug, null, e.target.value);
      const drink = state.summary.drinks.find((item) => item.id === slug);
      const rating = drink?.ratings?.[state.me.username] || {};
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

  /* ---------- images ---------- */
  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  const cutWhiteBg = (img, maxSide = 640) => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const px = imageData.data;

    const border = [];
    for (let x = 0; x < w; x += 2) border.push(x * 4, ((h - 1) * w + x) * 4);
    for (let y = 0; y < h; y += 2) border.push(y * w * 4, (y * w + w - 1) * 4);
    const channels = [[], [], []];
    for (const offset of border) {
      channels[0].push(px[offset]);
      channels[1].push(px[offset + 1]);
      channels[2].push(px[offset + 2]);
    }
    const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    const bg = [median(channels[0]), median(channels[1]), median(channels[2])];

    const TOL = 52;
    const BRIGHT_MIN = 120;
    const NEUTRAL_MAX = 34;
    const isBgish = (offset) => {
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

  const shrinkOnly = (img, maxSide = 640) => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const processImageUrl = async (url) => {
    const img = await loadImage(url);
    return cutWhiteBg(img) || shrinkOnly(img);
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
  const STRIP_CONCURRENCY = 3;
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
      (item.cut ? "" : " · фон не вырезан");
    markSelected();
    updatePreviewImage();
  };

  const renderTile = (index) => {
    const item = strip.items[index];
    const tile = $("photo-track").querySelector(`[data-index="${index}"]`);
    if (!tile) return;
    if (item.state === "failed") {
      tile.remove();
      return;
    }
    tile.classList.toggle("is-loading", item.state === "loading");
    if (item.state !== "ready") return;
    tile.innerHTML = `<img src="${item.dataUrl}" alt="">${
      item.cut ? "" : `<span class="photo-tile__badge">фон</span>`
    }`;
    tile.disabled = false;
  };

  const readyCount = () => strip.items.filter((item) => item.state === "ready").length;

  const finishStrip = () => {
    const ready = readyCount();
    if (!ready) {
      setStripStatus("ничего подходящего — приложи своё фото или ссылку");
      if (pending.photoSource === "auto") {
        pending.image = null;
        pending.photoNote = "фото не нашлось — приложи своё или выбери ссылкой";
        updatePreviewImage();
      }
      return;
    }
    setStripStatus(`${ready} ${wordForm(ready, ["фото", "фото", "фото"])} · листай вправо, жми нужное`);
  };

  const processStrip = async (gen) => {
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < strip.items.length) {
        const index = next++;
        const item = strip.items[index];
        try {
          const img = await loadImage(item.url);
          const cut = cutWhiteBg(img);
          item.dataUrl = cut || shrinkOnly(img);
          item.cut = Boolean(cut);
          item.state = "ready";
        } catch {
          item.state = "failed";
        }
        if (gen !== strip.gen) return;
        done++;
        setStripStatus(`режу фон… ${done} / ${strip.items.length}`);
        renderTile(index);
        // первое готовое фото подставляем само, пока пользователь ничего не выбрал
        if (item.state === "ready" && pending.photoSource === "auto" && strip.selected < 0) {
          selectTile(index, "auto");
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
    }));
    if (!strip.items.length) {
      finishStrip();
      return;
    }
    $("photo-track").innerHTML = strip.items
      .map(
        (item, index) =>
          `<button class="photo-tile is-loading" type="button" role="option" aria-selected="false"
             data-index="${index}" title="${esc(item.title)}" disabled></button>`,
      )
      .join("");
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

  const retryPhoto = () => {
    const ready = strip.items.map((item, index) => (item.state === "ready" ? index : -1)).filter((i) => i >= 0);
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
    pending.parsed = null;
    pending.image = null;
    pending.userPhoto = false;
    pending.photoSource = "auto";
    pending.photoNote = "";
    clearStrip();
    ["m-brand", "m-name", "m-flavor", "m-edition", "m-review", "m-image-url"].forEach((id) => {
      $(id).value = "";
    });
    $("smart-preview").hidden = true;
    $("smart-input").value = "";
    clearVoice();
    $("smart-status").textContent = "В индексе ✓";
    await refreshAll();
  };

  const submitSmart = async (event) => {
    event.preventDefault();
    const text = $("smart-input").value.trim();
    if (!text) {
      $("smart-status").textContent = "Напиши хоть пару слов или надиктуй войсом.";
      return;
    }
    $("smart-status").textContent = "Нейросеть разбирает…";
    try {
      const { parsed } = await api("POST", "api/cabinet/ai/parse", { text });
      pending.parsed = parsed;
      if (!pending.userPhoto) {
        pending.image = null;
        pending.photoSource = "auto";
        pending.photoNote = "ищу фото…";
      }
      showPreview();
      $("smart-status").textContent = "";
      refreshPhotos();
    } catch (error) {
      $("smart-status").textContent = `${error.message}. Заполни вручную ниже.`;
    }
  };

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
    if (!pending.parsed) return;
    try {
      await saveDrink(pending.parsed);
    } catch (error) {
      $("smart-status").textContent = error.message;
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
      const cut = cutWhiteBg(img);
      pending.image = cut || shrinkOnly(img);
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
